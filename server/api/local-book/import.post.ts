import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getHeader, getQuery, setHeader, setResponseStatus } from 'h3'
import { studyFileTypes, wordFileTypes } from '#shared/study-file'

const maxInput = 64 * 1024 * 1024
const maxOutput = 32 * 1024 * 1024
let importing = false

type ParsedBook = {
  title: string
  format: string
  chapterCount: number
  articles?: Array<{ id: number; title: string; text: string; textTranslate?: string }>
  words?: Array<{ word: string; meanings: string[] }>
  skipped?: number
  error?: string
}

/** 通过 stdin 将本机文件交给 Python，按格式及 words 模式生成书籍或词条。 */
function parseBook(python: string, parser: string, input: Buffer, format: string, words: boolean): Promise<ParsedBook> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', parser], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TYPEWORDS_BOOK_FORMAT: format, TYPEWORDS_BOOK_NODE: process.execPath,
        TYPEWORDS_IMPORT_WORDS: words ? '1' : '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output: Buffer[] = []
    let size = 0
    let limitError = ''
    const timer = setTimeout(() => {
      limitError = 'Reading timed out. Split the file and try again.'
      child.kill()
    }, 180_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxOutput) {
        limitError = 'The import is too large. Split the file and try again.'
        child.kill()
        return
      }
      output.push(chunk)
    })
    // 消耗 stderr，避免解析器日志占满管道。源文件正文不进入服务日志。
    child.stderr.resume()
    child.stdin.on('error', () => child.kill())
    child.on('error', () => {
      clearTimeout(timer)
      reject(createError({ statusCode: 503, statusMessage: 'Book parser unavailable' }))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (limitError || code !== 0) {
        reject(createError({ statusCode: 422, data: { message: limitError || 'Could not read the book.' } }))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(output).toString('utf8')))
      } catch {
        reject(createError({ statusCode: 422, data: { message: 'The book reader returned incomplete data.' } }))
      }
    })
    child.stdin.end(input)
  })
}

/** 接收本机文件或已配对手机的书籍。解析格式、大小和并发限制共用。 */
export default defineEventHandler(async event => {
  const request = event.node.req
  const host = getHeader(event, 'host') ?? ''
  const origin = getHeader(event, 'origin')
  const address = request.socket.remoteAddress ?? ''
  const words = getQuery(event).kind === 'word'
  const local = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
    && (!origin || origin === `http://${host}`)
  if (!local && (!event.context.mobilePaired || words)) {
    setResponseStatus(event, 403)
    return { error: 'Import on this computer or use a paired Android app for books.' }
  }
  const mime = getHeader(event, 'content-type')?.split(';', 1)[0].trim().toLowerCase()
  const format = Object.entries(studyFileTypes).find(([, type]) => type === mime)?.[0]
  if (!format || (words && !wordFileTypes.some(type => type === format))) {
    setResponseStatus(event, 415)
    return { error: words ? 'Choose a supported Excel, ODS, CSV, TSV, or PDF file.' : 'Choose a supported book, Word document, or spreadsheet.' }
  }
  const length = Number(getHeader(event, 'content-length'))
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxInput) {
    setResponseStatus(event, 413)
    return { error: 'The file is empty or larger than 64 MB.' }
  }
  const python = process.env.TYPEWORDS_BOOK_PYTHON
  const parser = process.env.TYPEWORDS_BOOK_PARSER
  if (!python || !parser) {
    setResponseStatus(event, 503)
    return { error: 'The local book reader is not configured.' }
  }
  if (importing) {
    setResponseStatus(event, 429)
    return { error: 'Another file is being processed. Try again shortly.' }
  }

  importing = true
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxInput) {
        setResponseStatus(event, 413)
        return { error: 'The file exceeds 64 MB. Split it before importing.' }
      }
      chunks.push(bytes)
    }
    const input = Buffer.concat(chunks, size)
    const result = await parseBook(python, parser, input, format, words)
    if (result.error || !(words ? result.words?.length : result.articles?.length)) {
      setResponseStatus(event, 422)
      return { error: result.error || (words ? 'No importable entries were found.' : 'No readable text was found.') }
    }
    if (result.format !== format.toUpperCase()) {
      setResponseStatus(event, 415)
      return { error: 'The file does not match its extension.' }
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return { ...result, id: `local-${words ? 'words' : 'book'}-${createHash('sha256').update(input).digest('hex').slice(0, 24)}` }
  } catch (error) {
    const failure = error as { statusCode?: number; data?: { message?: string } }
    setResponseStatus(event, failure.statusCode ?? 503)
    return { error: failure.data?.message ?? 'The local book reader is unavailable. Try again shortly.' }
  } finally {
    importing = false
  }
})

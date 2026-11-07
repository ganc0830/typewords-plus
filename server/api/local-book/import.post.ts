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
      limitError = '解析超时，请拆分文件后重试。'
      child.kill()
    }, 180_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxOutput) {
        limitError = '导入结果过大，请拆分文件后重试。'
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
        reject(createError({ statusCode: 422, data: { message: limitError || '书籍解析失败。' } }))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(output).toString('utf8')))
      } catch {
        reject(createError({ statusCode: 422, data: { message: '书籍解析结果不完整。' } }))
      }
    })
    child.stdin.end(input)
  })
}

/** 接收本机文件字节，书籍和词书共用回环校验、上传限制和解析进程互斥。 */
export default defineEventHandler(async event => {
  const request = event.node.req
  const host = getHeader(event, 'host') ?? ''
  const origin = getHeader(event, 'origin')
  const address = request.socket.remoteAddress ?? ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)
      || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
      || (origin && origin !== `http://${host}`)) {
    setResponseStatus(event, 403)
    return { error: '请从本机 TypeWords 页面导入。' }
  }
  const mime = getHeader(event, 'content-type')?.split(';', 1)[0].trim().toLowerCase()
  const format = Object.entries(studyFileTypes).find(([, type]) => type === mime)?.[0]
  const words = getQuery(event).kind === 'word'
  if (!format || (words && !wordFileTypes.some(type => type === format))) {
    setResponseStatus(event, 415)
    return { error: words ? '请选择支持的 Excel、ODS、CSV、TSV 或 PDF 文件。' : '请选择支持的书籍、Word 或表格文件。' }
  }
  const length = Number(getHeader(event, 'content-length'))
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxInput) {
    setResponseStatus(event, 413)
    return { error: '文件为空或超过 64 MB。' }
  }
  const python = process.env.TYPEWORDS_BOOK_PYTHON
  const parser = process.env.TYPEWORDS_BOOK_PARSER
  if (!python || !parser) {
    setResponseStatus(event, 503)
    return { error: '本地书籍解析器尚未配置。' }
  }
  if (importing) {
    setResponseStatus(event, 429)
    return { error: '正在解析另一个文件，请稍后重试。' }
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
        return { error: '文件超过 64 MB，请分卷导入。' }
      }
      chunks.push(bytes)
    }
    const input = Buffer.concat(chunks, size)
    const result = await parseBook(python, parser, input, format, words)
    if (result.error || !(words ? result.words?.length : result.articles?.length)) {
      setResponseStatus(event, 422)
      return { error: result.error || (words ? '没有找到可导入的词条。' : '没有可学习的正文。') }
    }
    if (result.format !== format.toUpperCase()) {
      setResponseStatus(event, 415)
      return { error: '文件内容与扩展名不符。' }
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return { ...result, id: `local-${words ? 'words' : 'book'}-${createHash('sha256').update(input).digest('hex').slice(0, 24)}` }
  } catch (error) {
    const failure = error as { statusCode?: number; data?: { message?: string } }
    setResponseStatus(event, failure.statusCode ?? 503)
    return { error: failure.data?.message ?? '本地书籍解析服务暂不可用，请稍后重试。' }
  } finally {
    importing = false
  }
})

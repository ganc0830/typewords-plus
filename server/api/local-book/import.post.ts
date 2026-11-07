import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getHeader, setHeader, setResponseStatus } from 'h3'
import { studyFileTypes } from '#shared/study-file'

const maxInput = 64 * 1024 * 1024
const maxOutput = 32 * 1024 * 1024
let importing = false

type ParsedBook = {
  title: string
  format: string
  chapterCount: number
  articles: Array<{ id: number; title: string; text: string; textTranslate?: string }>
  error?: string
}

/** 本地解析进程只从 stdin 读取书籍。限制输出和执行时间，退出后释放全部解析内存。 */
function parseBook(python: string, parser: string, input: Buffer, format: string): Promise<ParsedBook> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', parser], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', TYPEWORDS_BOOK_FORMAT: format, TYPEWORDS_BOOK_NODE: process.execPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output: Buffer[] = []
    let size = 0
    let limitError = ''
    const timer = setTimeout(() => {
      limitError = '解析超时，请将书籍分卷后再导入。'
      child.kill()
    }, 180_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxOutput) {
        limitError = '导入后的正文过长，请分卷导入。'
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

/** 本机网站接收文档或表格字节。前端将成功结果保存到既有个人书籍。 */
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
  if (!format) {
    setResponseStatus(event, 415)
    return { error: '请选择支持的书籍、Word 或表格文件。' }
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
    return { error: '正在导入另一本书，请稍后重试。' }
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
    const result = await parseBook(python, parser, input, format)
    if (result.error || !result.articles?.length) {
      setResponseStatus(event, 422)
      return { error: result.error || '没有可学习的正文。' }
    }
    if (result.format !== format.toUpperCase()) {
      setResponseStatus(event, 415)
      return { error: '文件内容与扩展名不符。' }
    }
    setHeader(event, 'Cache-Control', 'no-store')
    return { ...result, id: `local-book-${createHash('sha256').update(input).digest('hex').slice(0, 24)}` }
  } catch (error) {
    const failure = error as { statusCode?: number; data?: { message?: string } }
    setResponseStatus(event, failure.statusCode ?? 503)
    return { error: failure.data?.message ?? '本地书籍解析服务暂不可用，请稍后重试。' }
  } finally {
    importing = false
  }
})

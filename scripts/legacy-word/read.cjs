const WordExtractor = require('word-extractor')

/** 在独立进程中读取旧式 DOC 字节，只返回正文，不启动 Office 或执行宏。 */
async function readWord() {
  try {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const document = await new WordExtractor().extract(Buffer.concat(chunks))
    const body = document.getBody()
    if (!body || body.length > 16_000_000) {
      process.exitCode = 1
      return
    }
    process.stdout.write(body)
  } catch (error) {
    process.stderr.write(error.name)
    process.exitCode = 1
  }
}

readWord()

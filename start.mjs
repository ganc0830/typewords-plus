import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localPath = (path) => fileURLToPath(new URL(path, import.meta.url))
const venvPython = localPath('./.venv/Scripts/python.exe')
const modelDirectory = localPath('./voices/')
const runtimeTemp = localPath('./runtime-temp/')

// 只监听本机。安装时创建的 venv 与模型目录和源码放在同一目录。
process.env.NITRO_HOST = '127.0.0.1'
process.env.NITRO_PORT = '5567'
process.env.NUXT_TELEMETRY_DISABLED = '1'
process.env.TYPEWORDS_BOOK_PYTHON ??= existsSync(venvPython) ? venvPython : 'python'
process.env.TYPEWORDS_BOOK_PARSER ??= localPath('./scripts/import-local-book.py')
if (existsSync(modelDirectory)) process.env.TYPEWORDS_VOICE_DIR ??= modelDirectory

// 运行时临时文件留在项目目录，方便将整个项目放到 D 盘。
mkdirSync(runtimeTemp, { recursive: true })
process.env.TEMP = runtimeTemp
process.env.TMP = runtimeTemp
process.env.NUMBA_CACHE_DIR ??= runtimeTemp

await import('./.output/server/index.mjs')

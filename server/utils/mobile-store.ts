import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const root = resolve(process.env.TYPEWORDS_MOBILE_DATA || 'mobile-data')
let queue: Promise<unknown> = Promise.resolve()

/** 所有状态更新按序执行，避免同时上传时丢失已确认的结果。 */
export function mobileTransaction<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action, action)
  queue = next.catch(() => undefined)
  return next
}

/** 配对密钥持久化于电脑服务的数据目录，首次使用时生成。 */
export async function mobileToken() {
  await mkdir(root, { recursive: true })
  const file = join(root, 'pairing.key')
  try { return (await readFile(file, 'utf8')).trim() } catch {}
  const token = randomBytes(24).toString('hex')
  try { await writeFile(file, token, { flag: 'wx' }); return token }
  catch { return (await readFile(file, 'utf8')).trim() }
}

/** 读取上次成功提交的数据；仅初次运行允许没有状态文件。 */
export async function readMobileState() {
  try { return JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, state: null }; return null }
}

/** 先完整落盘临时文件，再替换主记录。写入失败不返回上传成功。 */
export async function writeMobileState(data: unknown) {
  await mkdir(root, { recursive: true })
  const file = join(root, 'state.json')
  await writeFile(file + '.tmp', JSON.stringify(data))
  await rename(file + '.tmp', file)
}

import { defineEventHandler, getRouterParam, getRequestIP, getHeader, readBody, setResponseStatus, setHeader } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { mobileToken, mobileTransaction, readMobileState, writeMobileState } from '../../utils/mobile-store'

/** 手机服务只接受配对访问，桌面本机可发布资料；revision 防止并发覆盖。 */
export default defineEventHandler(event => mobileTransaction(async () => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!process.env.TYPEWORDS_MOBILE_DATA) {
    setResponseStatus(event, 404); return { error: 'Device sync is disabled on this server.' }
  }
  const action = getRouterParam(event, 'action')
  const ip = getRequestIP(event) || ''
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
  if (action === 'health' && event.method === 'GET') return { online: true, app: 'TypeWords', protocol: 1 }
  const token = await mobileToken()
  const supplied = getHeader(event, 'x-typewords-pairing') || ''
  if (!local && (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))) {
    setResponseStatus(event, 401); return { error: 'Incorrect pairing code. Check the code shown on your computer.' }
  }
  if (action === 'pair' && local && event.method === 'GET') {
    // 手机应连接局域网网卡。排除明确的虚拟机内部网络，保留可连接 LAN 的外部交换机。
    const addresses = Object.entries(networkInterfaces())
      .filter(([name]) => !/VMware|VMnet\d+|VirtualBox|vboxnet|vEthernet \((WSL|Default Switch)/i.test(name))
      .sort(([left], [right]) => Number(/wi[ -]?fi|wlan|wireless|无线/i.test(right)) - Number(/wi[ -]?fi|wlan|wireless|无线/i.test(left)))
      .flatMap(([, interfaces]) => (interfaces || []).filter(item => item.family === 'IPv4' && !item.internal))
      .map(item => `http://${item.address}:5567`)
    return { token, addresses }
  }
  const current = await readMobileState()
  if (!current) { setResponseStatus(event, 503); return { error: 'The computer could not read the sync data. Check the server logs.' } }
  if (action === 'state' && event.method === 'GET') return current
  if (action !== 'state' || event.method !== 'POST') { setResponseStatus(event, 404); return { error: 'Endpoint not found.' } }
  const origin = getHeader(event, 'origin')
  if (local && origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    setResponseStatus(event, 403); return { error: 'This origin is not allowed to publish the computer library.' }
  }
  const body = await readBody(event)
  if (!Array.isArray(body?.state?.word?.bookList) || !Array.isArray(body?.state?.article?.bookList) || !Number.isInteger(body.revision)) {
    setResponseStatus(event, 400); return { error: 'Invalid sync data.' }
  }
  if (body.revision !== current.revision) { setResponseStatus(event, 409); return { error: 'The library changed on your computer. Check again and merge your progress.' } }
  if (!local) {
    // 手机可上传从文件导入的阅读书籍，词书仍只能向已有书目追加词条。
    for (const kind of ['word', 'article']) {
      const ids = new Set(current.state?.[kind]?.bookList.map((book: any) => String(book.id)) || [])
      if (body.state[kind].bookList.some((book: any) => {
        if (!book) return true
        if (ids.has(String(book.id))) return false
        return kind !== 'article' || !/^local-book-[a-f0-9]{24}$/.test(String(book.id)) || book.custom !== true || !Array.isArray(book.articles) || !book.articles.length
      })) {
        setResponseStatus(event, 400); return { error: 'Download the library from your computer before adding entries to a book.' }
      }
    }
  }
  const next = { revision: current.revision + 1, updatedAt: new Date().toISOString(), state: body.state }
  try { await writeMobileState(next); return { revision: next.revision, updatedAt: next.updatedAt } }
  catch { setResponseStatus(event, 503); return { error: 'The computer could not save the changes. Try again.' } }
}))

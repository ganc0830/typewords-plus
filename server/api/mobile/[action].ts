import { defineEventHandler, getRouterParam, getRequestIP, getHeader, readBody, setResponseStatus, setHeader } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { mobileToken, mobileTransaction, readMobileState, writeMobileState } from '../../utils/mobile-store'

/** 手机服务只接受配对访问，桌面本机可发布资料；revision 防止并发覆盖。 */
export default defineEventHandler(event => mobileTransaction(async () => {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!process.env.TYPEWORDS_MOBILE_DATA) {
    setResponseStatus(event, 404); return { error: '此实例未启用手机同步。' }
  }
  const action = getRouterParam(event, 'action')
  const ip = getRequestIP(event) || ''
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
  if (action === 'health' && event.method === 'GET') return { online: true, app: 'TypeWords', protocol: 1 }
  const token = await mobileToken()
  const supplied = getHeader(event, 'x-typewords-pairing') || ''
  if (!local && (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))) {
    setResponseStatus(event, 401); return { error: '配对码不正确，请在电脑端查看配对码。' }
  }
  if (action === 'pair' && local && event.method === 'GET') {
    const addresses = Object.values(networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal).map(item => `http://${item!.address}:5567`)
    return { token, addresses }
  }
  const current = await readMobileState()
  if (!current) { setResponseStatus(event, 503); return { error: '电脑同步数据无法读取，请检查服务日志。' } }
  if (action === 'state' && event.method === 'GET') return current
  if (action !== 'state' || event.method !== 'POST') { setResponseStatus(event, 404); return { error: '接口不存在' } }
  const origin = getHeader(event, 'origin')
  if (local && origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    setResponseStatus(event, 403); return { error: '来源不允许发布电脑资料。' }
  }
  const body = await readBody(event)
  if (!Array.isArray(body?.state?.word?.bookList) || !Array.isArray(body?.state?.article?.bookList) || !Number.isInteger(body.revision)) {
    setResponseStatus(event, 400); return { error: '同步数据格式不正确' }
  }
  if (body.revision !== current.revision) { setResponseStatus(event, 409); return { error: '电脑数据已更新，请重新检查并合并进度。' } }
  if (!local) {
    // 手机只能给已有词书添加词条，书目由电脑发布。
    for (const kind of ['word', 'article']) {
      const ids = new Set(current.state?.[kind]?.bookList.map((book: any) => String(book.id)) || [])
      if (body.state[kind].bookList.some((book: any) => !ids.has(String(book.id)))) {
        setResponseStatus(event, 400); return { error: '手机端不能新建词书或书籍，请先下载电脑资料。' }
      }
    }
  }
  const next = { revision: current.revision + 1, updatedAt: new Date().toISOString(), state: body.state }
  try { await writeMobileState(next); return { revision: next.revision, updatedAt: next.updatedAt } }
  catch { setResponseStatus(event, 503); return { error: '电脑保存失败，请重试。' } }
}))

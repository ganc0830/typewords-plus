import { defineEventHandler, getRequestIP, getHeader, setResponseStatus } from 'h3'
import { timingSafeEqual } from 'node:crypto'
import { BlockList } from 'node:net'
import { networkInterfaces } from 'node:os'
import { mobileToken } from '../utils/mobile-store'

/** 本机网页保持同源访问，局域网请求需配对密钥且只能使用手机所需接口。 */
export default defineEventHandler(async event => {
  if (!process.env.TYPEWORDS_MOBILE_DATA) return
  const ip = getRequestIP(event) || ''
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    if (/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(getHeader(event, 'host') || '')) return
    setResponseStatus(event, 403)
    return { error: '请使用电脑本机地址访问。' }
  }
  const localNetworks = new BlockList()
  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (entry?.family === 'IPv4' && !entry.internal && entry.cidr) {
      const [address, prefix] = entry.cidr.split('/')
      localNetworks.addSubnet(address, Number(prefix))
    }
  }
  if (!localNetworks.check(ip.replace(/^::ffff:/, ''))) {
    setResponseStatus(event, 403)
    return { error: '手机须与电脑连接同一局域网。' }
  }
  const path = event.path.split('?')[0]
  if (path === '/api/mobile/health') return
  const allowed = ['/api/mobile/state', '/api/voice', '/api/word-details'].includes(path)
  if (!allowed) {
    setResponseStatus(event, 403)
    return { error: '请使用配对后的 Android 应用访问电脑服务。' }
  }
  const supplied = Buffer.from(getHeader(event, 'x-typewords-pairing') || '')
  const expected = Buffer.from(await mobileToken())
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    setResponseStatus(event, 403)
    return { error: '请使用配对后的 Android 应用访问电脑服务。' }
  }
})

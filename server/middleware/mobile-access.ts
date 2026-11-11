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
    return { error: 'Open the page using the computer’s local address.' }
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
    return { error: 'Connect your phone and computer to the same local network.' }
  }
  const path = event.path.split('?')[0]
  if (path === '/api/mobile/health') return
  if (event.method === 'GET' && ['/api/mobile/update', '/api/mobile/update.apk'].includes(path)) return
  const allowed = ['/api/mobile/state', '/api/voice', '/api/word-details'].includes(path) ||
    (event.method === 'POST' && path === '/api/local-book/import')
  if (!allowed) {
    setResponseStatus(event, 403)
    return { error: 'Pair the Android app with this computer first.' }
  }
  const supplied = Buffer.from(getHeader(event, 'x-typewords-pairing') || '')
  const expected = Buffer.from(await mobileToken())
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    setResponseStatus(event, 403)
    return { error: 'Pair the Android app with this computer first.' }
  }
  event.context.mobilePaired = true
})

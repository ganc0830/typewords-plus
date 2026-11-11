import { defineEventHandler, setHeader, setResponseStatus } from 'h3'
import { readAndroidRelease } from '../../utils/android-release'

/** 返回当前发布版本及校验信息，供 App 比较已安装版本。 */
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const release = await readAndroidRelease()
  if (!release) {
    setResponseStatus(event, 404)
    return { error: 'No Android update has been published on this computer.' }
  }
  const { path, ...metadata } = release
  return metadata
})

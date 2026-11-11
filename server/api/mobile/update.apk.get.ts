import { createReadStream } from 'node:fs'
import { defineEventHandler, sendStream, setHeader, setResponseStatus } from 'h3'
import { readAndroidRelease } from '../../utils/android-release'

/** 以附件下载固定的签名 APK。手机由 Android 系统完成覆盖安装。 */
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const release = await readAndroidRelease()
  if (!release) {
    setResponseStatus(event, 404)
    return { error: 'No Android update has been published on this computer.' }
  }
  setHeader(event, 'Content-Type', 'application/vnd.android.package-archive')
  setHeader(event, 'Content-Disposition', `attachment; filename="TypeWords-Android-${release.versionName}.apk"`)
  setHeader(event, 'Content-Length', release.size)
  return sendStream(event, createReadStream(release.path))
})

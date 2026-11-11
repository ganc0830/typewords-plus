import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 读取电脑发布的 APK 清单，仅解析固定目录下对应版本的安装包。 */
export async function readAndroidRelease() {
  const data = process.env.TYPEWORDS_MOBILE_DATA
  if (!data) return null
  const root = join(data, 'android-releases')
  try {
    const release = JSON.parse(await readFile(join(root, 'latest.json'), 'utf8'))
    if (!Number.isSafeInteger(release.versionCode) || release.versionCode < 1 ||
      typeof release.versionName !== 'string' || !/^[\d.]+$/.test(release.versionName) ||
      !/^[a-f0-9]{64}$/i.test(release.sha256)) return null
    const path = join(root, String(release.versionCode), 'TypeWords-Android.apk')
    const file = await stat(path)
    if (!file.isFile() || file.size !== release.size) return null
    return { versionCode: release.versionCode, versionName: release.versionName, sha256: release.sha256, size: file.size, path }
  } catch {
    return null
  }
}

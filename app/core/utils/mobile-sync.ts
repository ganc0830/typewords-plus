import { ref } from 'vue'
import { get, set } from 'idb-keyval'
import { mergeMobileState, type SyncConflict } from '#shared/mobile-merge'
import { getDefaultBaseState, useBaseStore } from '../stores/base'
import { useDataSyncPersistence } from '../composables/useDataSyncPersistence'
import { _getDictDataByUrl, isSameDictResource } from './index'
import { DictType } from '../types/enum'

export const isAndroidApp = () => typeof window !== 'undefined' && !!(window as any).TypeWordsAndroid
export const mobileStatus = ref('No computer connected')
export const mobileBusy = ref(false)
export const mobileConflicts = ref<SyncConflict[]>([])
let conflictRevision: number | undefined
const baselineKey = 'typewords-mobile-baseline'

/** 同源桌面调用或 Android 原生请求代理，body 是待提交的 JSON 数据。 */
export async function mobileRequest(path: string, body?: unknown): Promise<any> {
  if (isAndroidApp()) {
    const bridge = (window as any).TypeWordsAndroid
    // 大书库由原生同源流提供，避免把全文复制到 evaluateJavascript 的通知中。
    if (path === 'state' && body === undefined && typeof bridge.stateUrl === 'function') {
      try {
        const response = await fetch(bridge.stateUrl(), { cache: 'no-store', signal: AbortSignal.timeout(120000) })
        return await response.json()
      } catch {
        return { error: 'Library download failed. Keep your computer online and try again.' }
      }
    }
    return new Promise(resolve => {
      const id = crypto.randomUUID()
      const timer = window.setTimeout(() => { window.removeEventListener('typewords-native', receive); resolve({ error: 'The computer is offline or the connection timed out.' }) }, path === 'state' ? 120000 : 30000)
      function receive(event: Event) {
        const detail = (event as CustomEvent).detail
        if (detail.id !== id) return
        clearTimeout(timer)
        window.removeEventListener('typewords-native', receive)
        resolve(detail.data)
      }
      window.addEventListener('typewords-native', receive)
      ;(window as any).TypeWordsAndroid.request(id, path, body === undefined ? '' : JSON.stringify(body))
    })
  }
  try {
    const response = await fetch('/api/mobile/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    return await response.json()
  } catch { return { error: 'The computer is offline or the connection timed out.' } }
}

/** 捕获当前学习数据和书签，用于判断同步期间是否产生了新修改。 */
function capture() {
  const store = useBaseStore()
  const state = JSON.parse(JSON.stringify(store.$state))
  delete state.load
  delete state._ignoreWatch
  state.readerPositions = {}
  for (const key of Object.keys(localStorage).filter(key => key.startsWith('typewords-reader:'))) {
    try { state.readerPositions[key] = JSON.parse(localStorage.getItem(key) || '{}') } catch { /* 跳过损坏的旧书签。 */ }
  }
  return JSON.stringify(state)
}

export const mobileFullLibraryKey = 'typewords-mobile-full-library'

/** 按词书身份查找已缓存正文，兼容词书 ID 和英文名两种历史格式。 */
function libraryBook(library: any, kind: 'word' | 'article', book: any) {
  const field = kind === 'word' ? 'words' : 'articles'
  return library?.[kind]?.bookList?.find(item => item[field]?.length && isSameDictResource(item, book))
}

/** 将缺失正文从手机离线缓存或服务器补入 raw 快照，再尝试 APK 内置资源。 */
async function snapshot(raw: string, remote: any, offline: any) {
  const state = JSON.parse(raw)
  const android = isAndroidApp()
  for (const kind of ['word', 'article'] as const) {
    const field = kind === 'word' ? 'words' : 'articles'
    for (const book of state[kind].bookList) {
      if (book[field]?.length || book.custom || book.system) continue
      if (android) {
        const cached = libraryBook(offline, kind, book) ?? libraryBook(remote, kind, book)
        if (cached) {
          book[field] = cached[field]
          continue
        }
      }
      if (!book.url) continue
      const load = _getDictDataByUrl(book, kind === 'word' ? DictType.word : DictType.article)
      // 手机缺少单个 APK 资源时，仍可合并其他词书和学习进度。
      const loaded = await (android ? load.catch(() => undefined) : load)
      // 词书加载器返回浅响应式数组，IndexedDB 只能克隆普通数组。
      if (loaded) book[field] = [...loaded[field]]
    }
  }
  return state
}

/** 保存下载资料。expected 是开始同步时的本机数据，期间有新修改则保留当前界面。 */
async function applySnapshot(state: any, expected: string) {
  const store = useBaseStore()
  if (capture() !== expected) return false
  // Android 缓存完整内容，避免普通词书的既有精简保存逻辑清掉离线全文。
  await set(mobileFullLibraryKey, state)
  if (capture() !== expected) return false
  for (const [key, value] of Object.entries(state.readerPositions || {})) {
    if (key.startsWith('typewords-reader:')) localStorage.setItem(key, JSON.stringify(value))
  }
  const { readerPositions, ...learning } = state
  store.$patch({ ...learning, load: true })
  await useDataSyncPersistence().saveDictState(store.$state, { canSyncRemote: false })
  return true
}

/** 检查电脑在线后合并资料。upload=true 才上传手机学习记录。 */
export async function synchronizeMobile(upload = false, choices: Record<string, 'local' | 'remote'> = {}) {
  if (mobileBusy.value || !useBaseStore().load) return
  if (!upload && window.location.pathname.includes('practice-')) return
  mobileBusy.value = true
  try {
    const health = await mobileRequest('health')
    if (!health.online || health.app !== 'TypeWords') { mobileStatus.value = health.error || 'Computer offline'; return }
    mobileStatus.value = 'Computer online. Syncing…'
    const remote = await mobileRequest('state')
    if (remote.error) { mobileStatus.value = remote.error; return }
    if (isAndroidApp() && !remote.state) { mobileStatus.value = 'Computer online. Sync your library from the computer first.'; return }
    if (Object.keys(choices).length && remote.revision !== conflictRevision) {
      mobileStatus.value = 'The other device has changed again. Review the conflicts and choose which versions to keep.'
      mobileConflicts.value = []
      return
    }
    const captured = capture()
    const previous = await get<any>(baselineKey)
    const offline = isAndroidApp() ? await get<any>(mobileFullLibraryKey) : undefined
    const local = await snapshot(captured, remote.state, offline ?? previous?.state)
    let merged = local
    if (remote.state) {
      // 首次配对也保留两端已有的学习记录，以应用默认状态作为共同起点。
      const { load, _ignoreWatch, ...defaults } = getDefaultBaseState()
      const base = previous?.state ?? { ...defaults, readerPositions: {} }
      const result = mergeMobileState(base, local, remote.state, choices)
      mobileConflicts.value = result.conflicts
      if (result.conflicts.length) {
        conflictRevision = remote.revision
        mobileStatus.value = 'Progress changed on both devices. Resolve the conflicts to continue.'
        return
      }
      merged = result.state
    }
    if ((!isAndroidApp() || upload) && JSON.stringify(remote.state) !== JSON.stringify(merged)) {
      const saved = await mobileRequest('state', { revision: remote.revision, state: merged })
      if (saved.error) { mobileStatus.value = saved.error; return }
      remote.revision = saved.revision
      remote.state = merged
    }
    // 用实际页面状态做比较，不能因为快照临时补齐了正文而跳过落盘。
    const needsApply = captured !== JSON.stringify(merged)
    const needsCache = isAndroidApp() && (['word', 'article'] as const).some(kind => {
      const field = kind === 'word' ? 'words' : 'articles'
      return merged[kind].bookList.some(book => !book.custom && !book.system && book[field]?.length && !libraryBook(offline, kind, book))
    })
    if ((needsApply || needsCache) && !await applySnapshot(merged, captured)) {
      mobileStatus.value = 'New activity on this device will be merged during the next sync.'
      return
    }
    await set(baselineKey, { revision: remote.revision, state: remote.state ?? merged })
    mobileStatus.value = upload ? 'Computer online. Progress uploaded.' : 'Computer online. Library updated and available offline.'
  } catch (error) {
    console.warn('Device sync failed', error)
    mobileStatus.value = 'Could not confirm that sync completed. Try again.'
  } finally { mobileBusy.value = false }
}

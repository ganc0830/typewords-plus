import { ref } from 'vue'
import { get, set } from 'idb-keyval'
import { mergeMobileState, type SyncConflict } from '#shared/mobile-merge'
import { getDefaultBaseState, useBaseStore } from '../stores/base'
import { useDataSyncPersistence } from '../composables/useDataSyncPersistence'
import { _getDictDataByUrl } from './index'
import { DictType } from '../types/enum'

export const isAndroidApp = () => typeof window !== 'undefined' && !!(window as any).TypeWordsAndroid
export const mobileStatus = ref('尚未连接电脑')
export const mobileBusy = ref(false)
export const mobileConflicts = ref<SyncConflict[]>([])
let conflictRevision: number | undefined
const baselineKey = 'typewords-mobile-baseline'

/** 同源桌面调用或 Android 原生请求代理，body 是待提交的 JSON 数据。 */
export async function mobileRequest(path: string, body?: unknown): Promise<any> {
  if (isAndroidApp()) {
    return new Promise(resolve => {
      const id = crypto.randomUUID()
      const timer = window.setTimeout(() => { window.removeEventListener('typewords-native', receive); resolve({ error: '电脑服务器离线或连接超时。' }) }, 30000)
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
  } catch { return { error: '电脑服务器离线或连接超时。' } }
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

/** 填充 raw 快照里的内置词书与文章，供手机离线使用。 */
async function snapshot(raw: string) {
  const state = JSON.parse(raw)
  for (const kind of ['word', 'article']) {
    const field = kind === 'word' ? 'words' : 'articles'
    for (const book of state[kind].bookList) {
      if (!book[field]?.length && book.url && !book.custom && !book.system) {
        const loaded = await _getDictDataByUrl(book, kind === 'word' ? DictType.word : DictType.article)
        book[field] = loaded[field]
      }
    }
  }
  return state
}

/** 保存下载资料。expected 是开始同步时的本机数据，期间有新修改则保留当前界面。 */
async function applySnapshot(state: any, expected: string) {
  const store = useBaseStore()
  // Android 缓存完整内容，避免普通词书的既有精简保存逻辑清掉离线全文。
  await set('typewords-mobile-full-library', state)
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
    if (!health.online || health.app !== 'TypeWords') { mobileStatus.value = health.error || '电脑服务器离线'; return }
    mobileStatus.value = '电脑服务器在线，正在同步资料…'
    const remote = await mobileRequest('state')
    if (remote.error) { mobileStatus.value = remote.error; return }
    if (isAndroidApp() && !remote.state) { mobileStatus.value = '电脑服务器在线，请先在电脑网页发布词书和文章。'; return }
    if (Object.keys(choices).length && remote.revision !== conflictRevision) {
      mobileStatus.value = '对端资料已再次更新，请重新检查冲突后选择。'
      mobileConflicts.value = []
      return
    }
    const captured = capture()
    const local = await snapshot(captured)
    const previous = await get<any>(baselineKey)
    let merged = local
    if (remote.state) {
      // 首次配对也保留两端已有的学习记录，以应用默认状态作为共同起点。
      const { load, _ignoreWatch, ...defaults } = getDefaultBaseState()
      const base = previous?.state ?? { ...defaults, readerPositions: {} }
      const result = mergeMobileState(base, local, remote.state, choices)
      mobileConflicts.value = result.conflicts
      if (result.conflicts.length) {
        conflictRevision = remote.revision
        mobileStatus.value = '两端有进度冲突，请选择后继续。'
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
    if (JSON.stringify(local) !== JSON.stringify(merged) && !await applySnapshot(merged, captured)) {
      mobileStatus.value = '本机有新学习记录，将在下次同步时合并。'
      return
    }
    await set(baselineKey, { revision: remote.revision, state: remote.state ?? merged })
    mobileStatus.value = upload ? '电脑服务器在线，进度已上传保存' : '电脑服务器在线，资料已更新，可离线学习'
  } catch (error) {
    console.warn('手机同步失败', error)
    mobileStatus.value = '同步失败，本次资料未确认同步完成，请重试。'
  } finally { mobileBusy.value = false }
}

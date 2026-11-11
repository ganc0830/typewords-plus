import { watch } from 'vue'
import { get } from 'idb-keyval'
import { useBaseStore } from '@/core/stores/base'
import { isAndroidApp, mobileFullLibraryKey, synchronizeMobile } from '@/core/utils/mobile-sync'
import { isSameDictResource } from '@/core/utils'

/** 启动及恢复联网时自动下载电脑资料，上传仍由用户明确点击。 */
export default defineNuxtPlugin(nuxt => {
  const store = useBaseStore()
  const router = useRouter()
  if (isAndroidApp()) {
    document.documentElement.classList.add('android-app')
    router.beforeEach(to => {
      if (['/import', '/dict-list', '/book-list', '/feedback', '/help', '/doc', '/user'].includes(to.path) || to.path === '/book/new' || to.query.isAdd) return '/words'
    })
  }
  let started = false
  watch(() => store.load, async loaded => {
    if (!loaded || started) return
    started = true
    if (isAndroidApp()) {
      const full = await get<any>(mobileFullLibraryKey)
      if (full) {
        for (const kind of ['word', 'article'] as const) {
          const field = kind === 'word' ? 'words' : 'articles'
          for (const book of store[kind].bookList) {
            const cached = full[kind]?.bookList?.find(item => item[field]?.length && isSameDictResource(item, book))
            if (!book[field].length && cached) book[field] = cached[field]
          }
        }
      }
    }
    await synchronizeMobile(false)
  }, { immediate: true })
  window.addEventListener('online', () => synchronizeMobile(false))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) synchronizeMobile(false) })
  window.setInterval(() => {
    if (!document.hidden && !router.currentRoute.value.path.includes('practice-')) synchronizeMobile(false)
  }, 60000)
})

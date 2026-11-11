import { watch } from 'vue'
import { useBaseStore } from '@/core/stores/base'
import { isAndroidApp, synchronizeMobile } from '@/core/utils/mobile-sync'

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
    // base.init 已在 load=true 前恢复缓存，避免页面抢先请求 APK 中没有的个人资源。
    await synchronizeMobile(false)
  }, { immediate: true })
  window.addEventListener('online', () => synchronizeMobile(false))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) synchronizeMobile(false) })
  window.setInterval(() => {
    if (!document.hidden && !router.currentRoute.value.path.includes('practice-')) synchronizeMobile(false)
  }, 60000)
})

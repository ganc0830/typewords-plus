<script setup lang="ts">
import { ref } from 'vue'
import ImportLocalBook from '@/components/article/ImportLocalBook.vue'
import { isAndroidApp } from '@/core/utils/mobile-sync'

const androidApp = isAndroidApp()
const address = ref('https://z-library.sk/')
const errorMessage = ref('')

/** 校验用户输入的 HTTPS 地址，再交由独立的原生浏览器打开。 */
function openSite() {
  errorMessage.value = ''
  let url: URL
  try { url = new URL(address.value.trim()) }
  catch { errorMessage.value = 'Enter a valid HTTPS address.'; return }
  if (url.protocol !== 'https:' || url.username || url.password) {
    errorMessage.value = 'Enter an HTTPS address without a username or password.'
    return
  }
  const bridge = (window as Window & { TypeWordsAndroid?: { openBookBrowser?: (url: string) => void } }).TypeWordsAndroid
  if (!bridge?.openBookBrowser) {
    errorMessage.value = 'Update the Android app to use the in-app browser.'
    return
  }
  bridge.openBookBrowser(url.href)
}
</script>

<template>
  <main class="browse-books">
    <h1>Browse and import</h1>
    <template v-if="androidApp">
      <section class="browse-card" aria-labelledby="browse-site-title">
        <h2 id="browse-site-title">Open a book website</h2>
        <form novalidate @submit.prevent="openSite">
          <label for="book-website">Website address</label>
          <input id="book-website" v-model="address" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" />
          <p v-if="errorMessage" class="browse-error" role="alert">{{ errorMessage }}</p>
          <button type="submit">Open in app</button>
        </form>
      </section>
      <section class="browse-card" aria-labelledby="browse-import-title">
        <h2 id="browse-import-title">Import a downloaded book</h2>
        <p>After downloading, choose the file from Downloads. Your paired computer reads the file and adds it to this bookshelf.</p>
        <ImportLocalBook />
      </section>
    </template>
    <p v-else>Open this page in TypeWords for Android to browse and import downloaded books.</p>
  </main>
</template>

<style scoped>
.browse-books { max-width: 650px; margin: auto; padding: 24px var(--android-gutter, 20px); color: var(--android-text, inherit); }
.browse-books h1 { margin: 0 0 18px; font-size: 32px; font-weight: 700; line-height: 1.2; letter-spacing: -.045em; }
.browse-card { display: grid; gap: 10px; margin-bottom: 14px; padding: 18px; border: 1px solid var(--android-line); border-radius: 22px; background: var(--android-surface); }
.browse-card h2 { font-size: 18px; font-weight: 650; }
.browse-card p { color: var(--android-muted); font-size: 14px; }
.browse-card form { display: grid; gap: 10px; }
.browse-card label { color: var(--android-muted); font-size: 13px; }
.browse-card input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid var(--android-line); border-radius: 12px; background: var(--android-canvas); color: var(--android-text); font-size: 16px; }
.browse-card button { justify-self: start; min-height: 44px; padding: 8px 18px; border-radius: 24px; background: var(--android-accent); color: var(--android-on-accent, #fff); font-weight: 650; }
.browse-card .browse-error { color: var(--android-text); }
</style>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { BaseButton } from '@/base'
import { useBaseStore } from '@/core/stores/base'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { DictType, getDefaultArticle, getDefaultDict, type Article } from '@/core/types'
import { withAppBaseURL } from '@/core/utils/base-url'
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { studyFileTypes } from '#shared/study-file'

const store = useBaseStore()
const persistence = useDataSyncPersistence()
const androidApp = isAndroidApp()
const picker = ref<HTMLInputElement>()
const importing = ref(false)
const message = ref('')
const failed = ref(false)
const accepted = Object.keys(studyFileTypes).map(extension => '.' + extension).join(',')
const invalidBook = 'Could not import the book. Check its file format.'

type ParsedBook = {
  id?: string
  title?: string
  format?: string
  articles?: Array<Pick<Article, 'id' | 'title' | 'text'> & { textTranslate?: string }>
  error?: string
}
type PickResult = { result?: string; filename?: string; error?: string }
type AndroidBookBridge = { pickBook?: (id: string) => void }
let cancelPick: (() => void) | undefined

onUnmounted(() => cancelPick?.())

/** 导入文本进入现有逐句练习。保留段落，只在句子边界加入换行。 */
function toStudyText(text: string, segmenter: Intl.Segmenter) {
  return text.split(/\n\s*\n/).map(paragraph =>
    Array.from(segmenter.segment(paragraph), value => value.segment.trim()).filter(Boolean).join('\n'),
  ).filter(Boolean).join('\n\n')
}

/** 读取解析结果，保留服务端给出的错误信息。 */
async function readResult(response: Response): Promise<ParsedBook> {
  const data = await response.json() as ParsedBook
  return response.ok ? data : { error: data.error || invalidBook }
}

/** 将桌面或手机解析出的文章写入同一本地书架，保存失败时撤销本次新增。 */
async function importBook(load: () => Promise<{ data: ParsedBook; filename: string } | undefined>, pendingMessage: string) {
  if (importing.value || !store.load) return
  failed.value = false
  importing.value = true
  message.value = pendingMessage
  let insertedId = ''
  try {
    const result = await load()
    if (!result) {
      message.value = ''
      return
    }
    const { data, filename } = result
    if (!data.id || !data.format || !Array.isArray(data.articles) || !data.articles.length) {
      failed.value = true
      message.value = data.error || invalidBook
      return
    }
    const existing = store.article.bookList.find(book => book.id === data.id)
    if (existing) {
      message.value = `“${existing.name}” is already in your library.`
      return
    }
    const sourceName = filename.replace(/\.[^.]+$/, '').replace(/\s*\([^()]*(?:z-library|1lib|z-lib)[^()]*\)$/i, '').trim()
    const name = `${data.title || sourceName}（${data.format}）`
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    // 表格每行已经和译文配好。继续拆句会导致原文和译文错位。
    const articles = data.articles.map(article => getDefaultArticle({
      ...article,
      text: typeof article.textTranslate === 'string' ? article.text : toStudyText(article.text, segmenter),
    }))
    const book = getDefaultDict({
      id: data.id, name, enName: name, description: `Local import · ${articles.length} ${articles.length === 1 ? 'article' : 'articles'}`,
      language: 'en', translateLanguage: 'zh-CN', type: DictType.article,
      category: 'Local imports', tags: [data.format], custom: true, length: articles.length, articles,
    })
    store.article.bookList.push(book)
    insertedId = data.id
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    message.value = `Imported “${name}” with ${articles.length} ${articles.length === 1 ? 'article' : 'articles'}. Open the book to start practicing.`
  } catch (error) {
    if (insertedId) {
      const index = store.article.bookList.findIndex(book => book.id === insertedId)
      if (index >= 0) store.article.bookList.splice(index, 1)
    }
    failed.value = true
    message.value = (error as Error).name === 'TimeoutError'
      ? 'Import timed out. Split the file into smaller parts and try again.'
      : 'Import failed. Check the local service and available browser storage.'
  } finally {
    importing.value = false
  }
}

/** 桌面通过本地文件输入上传，沿用格式和 64 MB 限制。 */
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value || !store.load) return
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!Object.hasOwn(studyFileTypes, extension)) {
    failed.value = true
    message.value = 'Choose a supported book, Word document, or spreadsheet.'
    return
  }
  if (!file.size || file.size > 64 * 1024 * 1024) {
    failed.value = true
    message.value = 'The file is empty or exceeds 64 MB. Check the file or split it into smaller parts.'
    return
  }
  await importBook(async () => {
    const response = await fetch(withAppBaseURL('/api/local-book/import'), {
      method: 'POST',
      headers: { 'Content-Type': studyFileTypes[extension as keyof typeof studyFileTypes] },
      body: file,
      signal: AbortSignal.timeout(195_000),
    })
    return { data: await readResult(response), filename: file.name }
  }, `Extracting ${extension.toUpperCase()} text. Large files may take a few minutes.`)
}

/** 等待本次 Android 文件选择与电脑解析完成，离开页面时清除监听。 */
function pickAndroidBook(bridge: AndroidBookBridge, id: string) {
  return new Promise<PickResult | undefined>(resolve => {
    function finish(result?: PickResult) {
      clearTimeout(timer)
      window.removeEventListener('typewords-native', receive)
      cancelPick = undefined
      resolve(result)
    }
    function receive(event: Event) {
      const detail = (event as CustomEvent<{ id: string; data: PickResult }>).detail
      if (detail?.id === id) finish(detail.data)
    }
    const timer = window.setTimeout(() => finish({ error: 'Import timed out. Try again with a smaller file.' }), 600_000)
    cancelPick = () => finish()
    window.addEventListener('typewords-native', receive)
    try { bridge.pickBook?.(id) }
    catch { finish({ error: 'Could not open the Android file picker.' }) }
  })
}

/** 手机由原生选择器处理文件，只从本次请求对应的本地结果地址读取解析内容。 */
async function startImport() {
  if (!androidApp) {
    picker.value?.click()
    return
  }
  const bridge = (window as Window & { TypeWordsAndroid?: AndroidBookBridge }).TypeWordsAndroid
  if (!bridge?.pickBook) {
    failed.value = true
    message.value = 'Update the Android app to import downloaded files.'
    return
  }
  await importBook(async () => {
    const id = crypto.randomUUID()
    const picked = await pickAndroidBook(bridge, id)
    if (!picked) return
    const filename = picked.filename || 'Downloaded book'
    if (picked.result !== `/api/android/import-result/${id}`) {
      return { data: { error: picked.error || invalidBook }, filename }
    }
    const response = await fetch(withAppBaseURL(picked.result), { signal: AbortSignal.timeout(30_000) })
    return { data: await readResult(response), filename }
  }, 'Choose a downloaded file. Large books may take a few minutes to import.')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" aria-label="Import local books">
    <input v-if="!androidApp" ref="picker" type="file" :accept="accepted" hidden @change="importFile" />
    <BaseButton :disabled="!store.load || importing" :loading="importing" @click="startImport">{{ androidApp ? 'Import downloaded file' : 'Import books, Word, or spreadsheets' }}</BaseButton>
    <span class="text-sm">PDF, EPUB, DOC, DOCX, Excel, ODS, CSV, TSV</span>
    <span v-if="message" class="text-sm" :role="failed ? 'alert' : 'status'">{{ message }}</span>
  </div>
</template>

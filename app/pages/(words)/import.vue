<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, triggerRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BackIcon, BaseButton, BaseInput, BasePage, Textarea } from '@/base'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { useBaseStore } from '@/core/stores/base'
import { getDefaultDict, getDefaultWord } from '@/core/types/func'
import { withAppBaseURL } from '@/core/utils/base-url'
import { fillWordDetails, lookupWordDetails } from '@/core/utils/word-details'
import type { Word } from '@/core/types/types'
import { studyFileTypes, wordFileTypes } from '#shared/study-file'

type WordFile = {
  id: string
  format: string
  skipped: number
  words: Array<{ word: string; meanings: string[]; error?: string; details?: Omit<Word, 'id' | 'word' | 'custom'> }>
}

const route = useRoute()
const router = useRouter()
const store = useBaseStore()
const persistence = useDataSyncPersistence()
const picker = ref<HTMLInputElement>()
const preview = shallowRef<WordFile>()
const name = ref('')
const message = ref('')
const failed = ref(false)
const busy = ref(false)
const pastedWords = ref('')
const lookup = shallowRef<AbortController>()
onBeforeUnmount(() => lookup.value?.abort())
const accepted = wordFileTypes.map(extension => '.' + extension).join(',')
const targetId = computed(() => typeof route.query.targetId === 'string' ? route.query.targetId : '')
const target = computed(() => store.word.bookList.find(book =>
  String(book.id) === targetId.value && (book.custom || book.system),
))

/** 将每行一个单词或词组的纯文本整理成与文件导入相同的预览。 */
function previewText() {
  const lines = pastedWords.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length > 50_000) {
    failed.value = true
    message.value = 'Preview up to 50,000 lines at a time.'
    return
  }
  const unique = new Map<string, string>()
  let skipped = 0
  for (const line of lines) {
    if (line.length > 100) skipped++
    else if (!unique.has(line.toLowerCase())) unique.set(line.toLowerCase(), line)
  }
  if (!unique.size) {
    failed.value = true
    message.value = 'Enter one English word or phrase per line, up to 100 characters each.'
    return
  }
  preview.value = {
    id: 'local-words-text-' + crypto.randomUUID(), format: 'Text', skipped,
    words: [...unique.values()].map(word => ({ word, meanings: [] })),
  }
  if (!name.value) name.value = 'My wordbook'
  failed.value = false
  message.value = ''
}

/** 分批查词并保留已得到的结果。未收录或断网时，原始词条仍可导入。 */
async function enrichPreview() {
  const file = preview.value
  if (!file || busy.value) return
  const controller = new AbortController()
  lookup.value = controller
  busy.value = true
  failed.value = false
  const rows = file.words.filter(row => !row.details)
  let checked = 0
  let matched = file.words.length - rows.length
  try {
    for (let i = 0; i < rows.length && !controller.signal.aborted; i += 4) {
      message.value = `Looking up entries (${checked}/${rows.length})…`
      await Promise.all(rows.slice(i, i + 4).map(async row => {
        const result = await lookupWordDetails(row.word, controller.signal)
        // 每条错误留在原词旁，方便定位拼写问题并重试。
        row.error = result.error
        if (result.details) {
          row.details = result.details
          matched++
        }
        checked++
      }))
      triggerRef(preview)
    }
    const label = controller.signal.aborted ? 'Lookup stopped' : 'Lookup complete'
    message.value = `${label}. ${matched} updated, ${file.words.length - matched} kept as entered.`
  } finally {
    lookup.value = undefined
    busy.value = false
  }
}

/** 从文件选择器读取词表，通过本机接口生成预览，确认前不写入词书。 */
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  preview.value = undefined
  const extension = wordFileTypes.find(type => file.name.toLowerCase().endsWith('.' + type))
  if (!extension || !file.size || file.size > 64 * 1024 * 1024) {
    failed.value = true
    message.value = 'Choose a non-empty Excel, ODS, CSV, TSV, or PDF file up to 64 MB.'
    return
  }

  busy.value = true
  failed.value = false
  message.value = 'Reading word list…'
  try {
    const response = await fetch(withAppBaseURL('/api/local-book/import?kind=word'), {
      method: 'POST',
      headers: { 'Content-Type': studyFileTypes[extension] },
      body: file,
      signal: AbortSignal.timeout(195_000),
    })
    const result = await response.json()
    if (!response.ok || !result.words?.length) {
      failed.value = true
      message.value = result.error || 'No entries found.'
      return
    }
    name.value = file.name.slice(0, -(extension.length + 1)).trim().slice(0, 20)
    preview.value = result
    message.value = ''
  } catch (error) {
    failed.value = true
    message.value = (error as Error).name === 'TimeoutError'
      ? 'Reading timed out. Split the file and try again.' : 'Could not read the file. Check the local server and try again.'
  } finally {
    busy.value = false
  }
}

/** 确认后写入当前词书或新词书。跳过已有拼写，失败时撤销本次列表变更。 */
async function saveWords() {
  const file = preview.value
  if (!file || busy.value || !store.load) return
  const existing = target.value
  const bookName = name.value.trim()
  failed.value = true
  if (targetId.value && !existing) {
    message.value = 'No editable destination wordbook found.'
    return
  }
  const list = store.word.bookList
  if (!existing && (!bookName || list.some(book => book.id === file.id || book.name === bookName))) {
    message.value = !bookName ? 'Enter a name for the wordbook.' : 'This file or name already exists. Open the original wordbook to add entries.'
    return
  }

  const spellings = new Set(existing?.words.map(word => word.word.trim().toLowerCase()))
  const words = file.words.filter(row => !spellings.has(row.word.toLowerCase())).map(row => {
    const word = getDefaultWord({ custom: true, word: row.word, trans: row.meanings.map(cn => ({ pos: '', cn })) })
    return row.details ? fillWordDetails(word, row.details) : word
  })
  if (!words.length) {
    message.value = 'These entries are already in the wordbook.'
    return
  }

  busy.value = true
  failed.value = false
  const previousLength = existing?.length ?? 0
  const previousWords = existing?.words.length ?? 0
  if (existing) {
    // 分条追加避免大型词表碰到 JavaScript 的函数参数数量上限。
    for (const word of words) existing.words.push(word)
    existing.length = existing.words.length
  } else {
    list.push(getDefaultDict({
      id: file.id, name: bookName, enName: bookName, description: 'Local word list · ' + file.format,
      translateLanguage: 'zh-CN', custom: true, length: words.length, words,
    }))
  }
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    preview.value = undefined
    const duplicates = file.words.length - words.length
    message.value = `Saved ${words.length} entries` + (duplicates ? `, skipped ${duplicates} duplicates.` : '.')
  } catch {
    if (existing) {
      existing.words.splice(previousWords, words.length)
      existing.length = previousLength
    } else {
      const index = list.findIndex(book => book.id === file.id)
      if (index !== -1) list.splice(index, 1)
    }
    failed.value = true
    message.value = 'Could not save. Check your browser storage and try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BasePage>
    <section class="card flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <BackIcon @click="router.back()" />
        <h1 class="page-title">Import a wordbook</h1>
      </div>
      <p v-if="target">Add to {{ target.name }}</p>
      <Textarea v-model="pastedWords" placeholder="Type or paste one English word or phrase per line" :autosize="{ minRows: 3, maxRows: 6 }" />
      <p>Supports XLS, XLSX, XLSM, ODS, CSV, TSV, and PDF. Use Word and Meaning columns in spreadsheets. Use one entry per line in text PDFs and run OCR on scans first.</p>
      <input ref="picker" type="file" :accept="accepted" hidden @change="readFile" />
      <div class="flex flex-wrap gap-2">
        <BaseButton :disabled="busy || !store.load || (!!targetId && !target)" @click="previewText">Preview entries</BaseButton>
        <BaseButton :disabled="busy || !store.load || (!!targetId && !target)" @click="picker?.click()">Choose a file</BaseButton>
        <BaseButton type="info" :disabled="busy" @click="router.push('/words')">Back to wordbooks</BaseButton>
      </div>
      <p v-if="targetId && store.load && !target" role="alert">No editable destination wordbook found.</p>
      <p v-if="message" :role="failed ? 'alert' : 'status'">{{ message }}</p>
      <div v-if="preview" class="flex flex-col gap-3">
        <p>Found {{ preview.words.length }} entries<span v-if="preview.skipped"> and skipped {{ preview.skipped }} over the length limit</span>. Showing the first {{ Math.min(10, preview.words.length) }}.</p>
        <ul>
          <li v-for="word in preview.words.slice(0, 10)" :key="word.word" class="py-1">
            <strong>{{ word.word }}</strong>
            <span v-if="word.meanings.length || word.details?.trans.length">
              · {{ word.meanings.length ? word.meanings.join('；') : word.details?.trans.map(entry => entry.cn).join('；') }}
            </span>
            <span v-if="word.details" class="ml-2 text-sm">Completed</span>
            <span v-if="word.error" class="ml-2 text-sm text-red-600" role="alert">{{ word.error }}</span>
          </li>
        </ul>
        <label v-if="!targetId" class="flex items-center gap-2">
          Wordbook name <BaseInput v-model="name" :maxlength="20" />
        </label>
        <div class="flex flex-wrap gap-2">
          <BaseButton type="info" :disabled="busy" @click="enrichPreview">Complete entries online</BaseButton>
          <BaseButton v-if="lookup" type="info" @click="lookup.abort()">Stop lookup</BaseButton>
          <BaseButton :disabled="busy" @click="saveWords">Import entries</BaseButton>
        </div>
      </div>
    </section>
  </BasePage>
</template>

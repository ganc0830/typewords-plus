<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BackIcon, BaseButton, BaseInput, BasePage } from '@/base'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { useBaseStore } from '@/core/stores/base'
import { getDefaultDict, getDefaultWord } from '@/core/types/func'
import { withAppBaseURL } from '@/core/utils/base-url'
import { studyFileTypes, wordFileTypes } from '#shared/study-file'

type WordFile = {
  id: string
  format: string
  skipped: number
  words: Array<{ word: string; meanings: string[] }>
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
const accepted = wordFileTypes.map(extension => '.' + extension).join(',')
const targetId = computed(() => typeof route.query.targetId === 'string' ? route.query.targetId : '')
const target = computed(() => store.word.bookList.find(book =>
  String(book.id) === targetId.value && (book.custom || book.system),
))

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
    message.value = '请选择非空且不超过 64 MB 的 Excel、ODS、CSV、TSV 或 PDF 文件。'
    return
  }

  busy.value = true
  failed.value = false
  message.value = '正在解析词表…'
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
      message.value = result.error || '未找到可导入的词条。'
      return
    }
    name.value = file.name.slice(0, -(extension.length + 1)).trim().slice(0, 20)
    preview.value = result
    message.value = ''
  } catch (error) {
    failed.value = true
    message.value = (error as Error).name === 'TimeoutError'
      ? '解析超时，请拆分文件后重试。' : '解析失败，请检查本地服务后重试。'
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
    message.value = '找不到可编辑的目标词书。'
    return
  }
  const list = store.word.bookList
  if (!existing && (!bookName || list.some(book => book.id === file.id || book.name === bookName))) {
    message.value = !bookName ? '请输入词书名称。' : '该文件或同名词书已导入，可打开原词书追加词条。'
    return
  }

  const spellings = new Set(existing?.words.map(word => word.word.trim().toLowerCase()))
  const words = file.words.filter(row => !spellings.has(row.word.toLowerCase())).map(row => getDefaultWord({
    custom: true,
    word: row.word,
    trans: row.meanings.map(cn => ({ pos: '', cn })),
  }))
  if (!words.length) {
    message.value = '词书已包含这些词条。'
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
      id: file.id, name: bookName, enName: bookName, description: '本地词表 · ' + file.format,
      translateLanguage: 'zh-CN', custom: true, length: words.length, words,
    }))
  }
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    preview.value = undefined
    const duplicates = file.words.length - words.length
    message.value = '已保存 ' + words.length + ' 个词条' + (duplicates ? '，跳过 ' + duplicates + ' 个已有词条。' : '。')
  } catch {
    if (existing) {
      existing.words.splice(previousWords, words.length)
      existing.length = previousLength
    } else {
      const index = list.findIndex(book => book.id === file.id)
      if (index !== -1) list.splice(index, 1)
    }
    failed.value = true
    message.value = '保存失败，请检查浏览器的存储空间后重试。'
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
        <h1 class="page-title">导入词书</h1>
      </div>
      <p v-if="target">追加到「{{ target.name }}」</p>
      <p>支持 XLS、XLSX、XLSM、ODS、CSV、TSV、PDF。表格建议使用「单词」和「释义」列。PDF 请使用每行一个词条的文字版词表，扫描件需先做 OCR。</p>
      <input ref="picker" type="file" :accept="accepted" hidden @change="readFile" />
      <div class="flex flex-wrap gap-2">
        <BaseButton :disabled="busy || !store.load || (!!targetId && !target)" @click="picker?.click()">选择词表文件</BaseButton>
        <BaseButton type="info" :disabled="busy" @click="router.push('/words')">返回我的词典</BaseButton>
      </div>
      <p v-if="targetId && store.load && !target" role="alert">找不到可编辑的目标词书。</p>
      <p v-if="message" :role="failed ? 'alert' : 'status'">{{ message }}</p>
      <div v-if="preview" class="flex flex-col gap-3">
        <p>识别到 {{ preview.words.length }} 个词条<span v-if="preview.skipped">，跳过 {{ preview.skipped }} 个过长词条</span>。以下预览前 {{ Math.min(10, preview.words.length) }} 条。</p>
        <ul>
          <li v-for="word in preview.words.slice(0, 10)" :key="word.word" class="py-1">
            <strong>{{ word.word }}</strong>
            <span v-if="word.meanings.length"> · {{ word.meanings.join('；') }}</span>
          </li>
        </ul>
        <label v-if="!targetId" class="flex items-center gap-2">
          词书名称 <BaseInput v-model="name" :maxlength="20" />
        </label>
        <div><BaseButton :loading="busy" :disabled="busy" @click="saveWords">确认导入</BaseButton></div>
      </div>
    </section>
  </BasePage>
</template>

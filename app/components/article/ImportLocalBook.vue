<script setup lang="ts">
import { ref } from 'vue'
import { BaseButton } from '@/base'
import { useBaseStore } from '@/core/stores/base'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { DictType, getDefaultArticle, getDefaultDict } from '@/core/types'
import { withAppBaseURL } from '@/core/utils/base-url'
import { studyFileTypes } from '#shared/study-file'

const store = useBaseStore()
const persistence = useDataSyncPersistence()
const picker = ref<HTMLInputElement>()
const importing = ref(false)
const message = ref('')
const failed = ref(false)
const accepted = Object.keys(studyFileTypes).map(extension => '.' + extension).join(',')

/** 导入文本进入现有逐句练习。保留段落，只在句子边界加入换行。 */
function toStudyText(text: string, segmenter: Intl.Segmenter) {
  return text.split(/\n\s*\n/).map(paragraph =>
    Array.from(segmenter.segment(paragraph), value => value.segment.trim()).filter(Boolean).join('\n'),
  ).filter(Boolean).join('\n\n')
}

/** 使用既有个人书籍与 IndexedDB 持久化，保存成功后才显示导入完成。 */
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value || !store.load) return
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  failed.value = true
  if (!Object.hasOwn(studyFileTypes, extension)) {
    message.value = '请选择支持的书籍、Word 或表格文件。'
    return
  }
  if (!file.size || file.size > 64 * 1024 * 1024) {
    message.value = '文件为空或超过 64 MB，请检查文件或分卷导入。'
    return
  }
  failed.value = false
  importing.value = true
  message.value = `正在提取 ${extension.toUpperCase()} 正文，大文件可能需要几分钟。`
  let insertedId = ''
  try {
    const response = await fetch(withAppBaseURL('/api/local-book/import'), {
      method: 'POST',
      headers: { 'Content-Type': studyFileTypes[extension as keyof typeof studyFileTypes] },
      body: file,
      signal: AbortSignal.timeout(195_000),
    })
    const data = await response.json()
    if (!response.ok || !data.articles?.length) {
      failed.value = true
      message.value = data.error || '没有导入成功，请检查书籍格式。'
      return
    }
    const existing = store.article.bookList.find(book => book.id === data.id)
    if (existing) {
      message.value = `《${existing.name}》已在书籍列表中。`
      return
    }
    const sourceName = file.name.replace(/\.[^.]+$/, '').replace(/\s*\([^()]*(?:z-library|1lib|z-lib)[^()]*\)$/i, '').trim()
    const name = `${data.title || sourceName}（${data.format}）`
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
    // 表格每行已经和译文配好。继续拆句会导致原文和译文错位。
    const articles = data.articles.map(article => getDefaultArticle({
      ...article,
      text: typeof article.textTranslate === 'string' ? article.text : toStudyText(article.text, segmenter),
    }))
    const book = getDefaultDict({
      id: data.id, name, enName: name, description: `本地导入 · ${articles.length} 篇`,
      language: 'en', translateLanguage: 'zh-CN', type: DictType.article,
      category: '本地导入', tags: [data.format], custom: true, length: articles.length, articles,
    })
    store.article.bookList.push(book)
    insertedId = data.id
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    message.value = `已导入《${name}》，共 ${articles.length} 篇。点击书籍即可学习。`
  } catch (error) {
    if (insertedId) {
      const index = store.article.bookList.findIndex(book => book.id === insertedId)
      if (index >= 0) store.article.bookList.splice(index, 1)
    }
    failed.value = true
    message.value = (error as Error).name === 'TimeoutError' ? '导入超时，请分卷后重试。' : '导入失败，请检查本地服务和浏览器存储空间。'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" aria-label="导入本地书籍">
    <input ref="picker" type="file" :accept="accepted" hidden @change="importFile" />
    <BaseButton :disabled="!store.load || importing" :loading="importing" @click="picker?.click()">导入书籍 / Word / 表格</BaseButton>
    <span class="text-sm">PDF、EPUB、DOC、DOCX、Excel、ODS、CSV、TSV</span>
    <span v-if="message" class="text-sm" :role="failed ? 'alert' : 'status'">{{ message }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { useWordOptions } from '@/core/hooks/dict'
import { useBaseStore } from '@/core/stores/base'
import { getDefaultWord } from '@/core/types/func'
import type { Dict, Word } from '@/core/types/types'
import { cloneDeep, getDictDisplayName } from '@/core/utils'
import { fillWordDetails, lookupWordDetails } from '@/core/utils/word-details'

const route = useRoute()
const store = useBaseStore()
const persistence = useDataSyncPersistence()
const { getCollectibleDicts, addWordToDict } = useWordOptions()
const sheet = ref<HTMLElement>()
const term = ref('')
const view = ref<'actions' | 'definitions' | 'lists'>('actions')
const result = ref<Word>()
const lookupError = ref('')
const feedback = ref('')
const loading = ref(false)
const saving = ref(false)
const lists = computed(() => getCollectibleDicts())
let request: AbortController | undefined

const controls = 'a, button, input, textarea, select, label, [role="button"], [contenteditable], .base-button'
const textBlock = 'p, li, h1, h2, h3, h4, h5, h6, td, blockquote, div'

/** 将选择文本和词书词条转成可比较的单词或短语。 */
function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[‐‑–]/g, '-')
}

/** 只从正文内的同一个文本块读词，保留输入框、链接和整段选择的原生操作。 */
function readSelection(selection: Selection) {
  if (selection.isCollapsed || selection.rangeCount !== 1) return ''
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const root = start?.closest('.main-content')
  const block = start?.closest(textBlock)
  if (!start || !end || !root || !root.contains(end) || !block || block !== end.closest(textBlock) ||
    start.closest(controls) || end.closest(controls)) return ''

  const raw = range.toString().trim()
  const text = normalize(raw).replace(/^["']+|["'.,!?;:]+$/g, '')
  if (/[\r\n]/.test(raw) || text.length > 100 || text.split(' ').length > 12 ||
    !/[a-z]/i.test(text) || !/^[a-z0-9][a-z0-9 .'+/&-]*$/i.test(text)) return ''
  if (normalize(block.textContent ?? '') === normalize(raw) && /[.!?…]$/.test(raw)) return ''
  return text
}

/** 关闭面板时取消查词。是否清除系统选区由调用场景决定。 */
function reset(clearSelection = false) {
  request?.abort()
  request = undefined
  term.value = ''
  view.value = 'actions'
  result.value = undefined
  lookupError.value = ''
  feedback.value = ''
  loading.value = false
  if (clearSelection) window.getSelection()?.removeAllRanges()
}

/** 系统选区有词时打开面板，点面板按钮导致选区收起时仍保留原词。 */
function selectionChanged() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || saving.value ||
    (selection.anchorNode && sheet.value?.contains(selection.anchorNode))) return
  const text = readSelection(selection)
  if (text === term.value) return
  reset()
  term.value = text
}

/** 长按后的点击可能冒泡到学习界面，保留系统选区时只拦截所选正文上的点击。 */
function outsideClick(event: MouseEvent) {
  const target = event.target
  if (!term.value || !(target instanceof Element) || sheet.value?.contains(target)) return
  const selection = window.getSelection()
  if (target.closest('.main-content') && selection && readSelection(selection) === term.value &&
    selection.getRangeAt(0).intersectsNode(target)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  reset()
}

/** 优先查当前词书，再检查已缓存的词条和文章生词。 */
function cachedWord(text: string) {
  const key = text.toLowerCase()
  let fallback: Word | undefined
  const groups = [
    store.sdict.words,
    ...store.word.bookList.filter(book => book.id !== store.sdict.id).map(book => book.words),
    ...store.article.bookList.flatMap(book => book.articles.flatMap(article => article.newWords?.length ? [article.newWords] : [])),
  ]
  for (const group of groups) {
    for (const word of group) {
      if (normalize(word.word).toLowerCase() !== key) continue
      if (word.trans?.some(item => item.cn)) return word
      fallback ??= word
    }
  }
  return fallback
}

/** 只在本地释义不足时查联网词典，新选择会取消旧请求。 */
async function lookUp() {
  if (loading.value) return
  view.value = 'definitions'
  feedback.value = ''
  lookupError.value = ''
  const text = term.value
  const cached = result.value ?? cachedWord(text)
  result.value = cached
  if (cached?.trans?.some(item => item.cn)) return

  const controller = new AbortController()
  request = controller
  loading.value = true
  const response = await lookupWordDetails(text, controller.signal)
  if (request !== controller) return
  request = undefined
  loading.value = false
  if (response.details) result.value = fillWordDetails(cached ?? getDefaultWord({ word: text }), response.details)
  if (!result.value?.trans?.some(item => item.cn)) {
    lookupError.value = response.error ?? 'No definition was found. You can still save this text.'
  }
}

/** 写入已有词单，存储失败时只回滚本次加入的词条。 */
async function saveToList(list: Dict) {
  if (saving.value) return
  const text = term.value
  const key = text.toLowerCase()
  const name = getDictDisplayName(list)
  if (list.words.some(word => normalize(word.word).toLowerCase() === key)) {
    feedback.value = `Already in ${name}.`
    return
  }
  const cached = result.value ?? cachedWord(text)
  const { id: _id, ...details } = cloneDeep(cached ?? ({} as Partial<Word>))
  const entry = getDefaultWord({ ...details, word: text, custom: true })
  if (!addWordToDict(entry, list).ok) {
    feedback.value = `Already in ${name}.`
    return
  }
  saving.value = true
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    if (term.value === text) feedback.value = `Added to ${name}.`
  } catch {
    const index = list.words.findIndex(word => word.id === entry.id)
    if (index >= 0) list.words.splice(index, 1)
    list.length = list.words.length
    if (term.value === text) feedback.value = 'Could not save the entry. Try again.'
  } finally {
    saving.value = false
  }
}

/** 切换到现有词单列表，保留当前选词和已查到的释义。 */
function showLists() {
  view.value = 'lists'
  feedback.value = ''
}

onMounted(() => {
  document.addEventListener('selectionchange', selectionChanged)
  document.addEventListener('contextmenu', selectionChanged)
  document.addEventListener('click', outsideClick, true)
})
onUnmounted(() => {
  document.removeEventListener('selectionchange', selectionChanged)
  document.removeEventListener('contextmenu', selectionChanged)
  document.removeEventListener('click', outsideClick, true)
  reset()
})
watch(() => route.path, () => reset())
</script>

<template>
  <section v-if="term" ref="sheet" class="selection-sheet" aria-label="Selected text actions">
    <header class="selection-header">
      <strong>{{ term }}</strong>
      <button type="button" class="selection-close" aria-label="Close selected text actions" @click="reset(true)">
        <IconFluentDismiss20Regular />
      </button>
    </header>
    <div class="selection-buttons">
      <button type="button" :aria-pressed="view === 'definitions'" @click="lookUp">Look up</button>
      <button type="button" :aria-pressed="view === 'lists'" @click="showLists">Add to list</button>
    </div>
    <div v-if="view === 'definitions'" class="selection-body">
      <h2>Definitions</h2>
      <p v-if="loading" role="status">Looking up…</p>
      <p v-else-if="lookupError" role="status">{{ lookupError }}</p>
      <template v-else-if="result">
        <p v-if="result.phonetic0 || result.phonetic1" class="selection-phonetic">/{{ result.phonetic0 || result.phonetic1 }}/</p>
        <ul>
          <li v-for="(item, index) in result.trans" :key="index">
            <span v-if="item.pos" class="selection-phonetic">{{ item.pos }} </span>{{ item.cn }}
          </li>
        </ul>
      </template>
    </div>
    <div v-else-if="view === 'lists'" class="selection-body">
      <h2>Add to vocabulary list</h2>
      <p v-if="!lists.length">No vocabulary lists are available.</p>
      <button v-for="list in lists" :key="list.id" type="button" class="selection-list" :disabled="saving" @click="saveToList(list)">
        {{ getDictDisplayName(list) }}
      </button>
      <p v-if="feedback" role="status">{{ feedback }}</p>
    </div>
  </section>
</template>

<style scoped>
.selection-sheet {
  position: fixed;
  z-index: 25;
  inset-inline: var(--android-gutter, 16px);
  bottom: 12px;
  max-width: 560px;
  max-height: min(48dvh, 360px);
  overflow: auto;
  margin-inline: auto;
  padding: 12px 16px 16px;
  border: 1px solid var(--android-line);
  border-radius: 22px;
  background: var(--android-surface);
  color: var(--android-text);
  box-shadow: 0 8px 30px var(--android-shadow);
}
.android-tab-page .selection-sheet { bottom: calc(var(--android-bottom-nav-height, 56px) + 8px); }
.selection-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.selection-header strong { overflow-wrap: anywhere; font-size: 17px; }
.selection-close { flex: none; display: grid; place-items: center; width: 44px; height: 44px; color: var(--android-muted); }
.selection-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.selection-buttons button { min-height: 44px; padding-inline: 14px; border-radius: 16px; background: var(--android-tint); color: var(--android-accent); font-weight: 600; }
.selection-buttons button[aria-pressed="true"] { background: var(--android-accent); color: var(--android-on-accent); }
.selection-body { margin-top: 12px; }
.selection-body h2 { margin-bottom: 6px; font-size: 14px; font-weight: 650; }
.selection-body p, .selection-body li { margin-block: 5px; overflow-wrap: anywhere; }
.selection-phonetic { color: var(--android-muted); }
.selection-list { display: block; width: 100%; min-height: 44px; padding-block: 7px; border-top: 1px solid var(--android-line); color: var(--android-accent); text-align: left; overflow-wrap: anywhere; }
.selection-list:disabled { opacity: 0.55; }
</style>

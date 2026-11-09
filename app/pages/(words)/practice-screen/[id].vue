<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BaseButton, Toast } from '@/base'
import { useBaseStore } from '@/core/stores/base'
import { useSettingStore } from '@/core/stores/setting'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { usePlayWordAudio } from '@/core/hooks/sound'
import { useWordOptions } from '@/core/hooks/dict'
import { getShortcutKey } from '@/core/hooks/event'
import { openWordCollectPicker, wordCollectPickerState } from '@/core/hooks/useWordCollectPicker'
import { ShortcutKey } from '@/core/types/enum'
import type { Word } from '@/core/types/types'
import { _getDictDataByUrl, isDictIdMatch } from '@/core/utils'

type Position = { nextIndex: number; done: number; added: number }
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const playAudio = usePlayWordAudio()
const { isWordCollect, toggleWordCollect } = useWordOptions()
const route = useRoute()
const book = computed(() => store.word.bookList.find(item => isDictIdMatch(item, route.params.id)))
const storageKey = computed(() => 'typewords-screen:' + String(book.value?.id))
const position = ref<Position>({ nextIndex: 0, done: 0, added: 0 })
const source = ref<Word[]>([])
const loading = ref(true)
const started = ref(false)
const saving = ref(false)
const spelling = ref('')
const mistake = ref(false)
const collectAnchor = ref<HTMLElement>()
const normalize = (value: string) => value.trim().toLowerCase()
const known = computed(() => new Set(store.known.words.map(word => normalize(word.word))))
const unique = computed(() => {
  const seen = new Set<string>()
  return source.value.flatMap((word, index) => {
    const key = normalize(word.word)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ word, index, key }]
  })
})
const remaining = computed(() => unique.value.filter(item => item.index >= position.value.nextIndex && !known.value.has(item.key)))
const current = computed(() => remaining.value[0])
const mastered = computed(() => unique.value.filter(item => known.value.has(item.key)).length)
const shortcutKeys = computed(() => settings.shortcutKeyMap)
const collected = computed(() => !!current.value && isWordCollect(current.value.word))

/** 加载当前词书以及本书独立的筛词位置。 */
watch([() => store.load, book, () => book.value?.words.length], async ([ready]) => {
  if (!ready) return
  const selected = book.value
  if (!selected) { loading.value = false; return }
  try {
    source.value = selected.words.length || !selected.url ? selected.words : (await _getDictDataByUrl(selected)).words
    const saved = JSON.parse(localStorage.getItem(storageKey.value) || 'null') as Position | null
    if (saved && Number.isInteger(saved.nextIndex) && saved.nextIndex > 0 && saved.nextIndex < source.value.length && saved.done >= 0 && saved.added >= 0) {
      position.value = saved
    }
    if (source.value.length && (position.value.done || !current.value)) {
      await saveBookProgress(current.value?.index ?? source.value.length)
    }
  } catch {
    Toast.warning('无法读取词书或筛词位置，请检查后重试。')
  } finally { loading.value = false }
}, { immediate: true })

/** 保存本书的筛词位置并清空可选的跟写输入。 */
function advance(index: number, added = false) {
  position.value = { nextIndex: index + 1, done: position.value.done + 1, added: position.value.added + Number(added) }
  try { localStorage.setItem(storageKey.value, JSON.stringify(position.value)) }
  catch { Toast.warning('筛词位置保存失败。') }
  spelling.value = ''
  mistake.value = false
}

/** 将原书位置及可选的已掌握词条一起写入词书主记录和逐书副本。 */
async function saveBookProgress(nextIndex: number, entry?: Word): Promise<boolean> {
  const selected = book.value
  if (!selected || saving.value) return false
  const previousIndex = selected.lastLearnIndex
  const previousComplete = selected.complete
  const newIndex = Math.max(previousIndex, nextIndex)
  const complete = previousComplete || newIndex >= source.value.length
  if (!entry && newIndex === previousIndex && complete === previousComplete) return true

  saving.value = true
  selected.lastLearnIndex = newIndex
  selected.complete = complete
  const knownBook = store.known
  if (entry) {
    knownBook.words.push(entry)
    knownBook.length = knownBook.words.length
  }
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    return true
  } catch {
    if (selected.lastLearnIndex === newIndex && selected.complete === complete) {
      selected.lastLearnIndex = previousIndex
      selected.complete = previousComplete
    }
    if (entry) {
      const index = knownBook.words.findIndex(word => toRaw(word) === entry)
      if (index >= 0) knownBook.words.splice(index, 1)
      knownBook.length = knownBook.words.length
    }
    Toast.warning('词书进度保存失败，请重试。')
    return false
  } finally { saving.value = false }
}

/** 按原书推进到下一待筛词。只有主动跳过才新增已掌握记录。 */
async function finishWord(action: 'write' | 'skip' | 'next') {
  const item = current.value
  if (!item || saving.value) return
  mistake.value = action === 'write' && normalize(spelling.value) !== item.key
  if (mistake.value) return
  const skipped = action === 'skip'
  const entry = skipped ? { ...item.word } : undefined
  const nextIndex = remaining.value[1]?.index ?? source.value.length
  if (await saveBookProgress(nextIndex, entry)) advance(item.index, skipped)
}

/** 切换当前词的默认收藏状态，写入已有词典存储。 */
async function collect() {
  const item = current.value
  if (!item || saving.value) return
  const target = store.collectWord
  const previous = [...target.words]
  saving.value = true
  toggleWordCollect(item.word)
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
  } catch {
    target.words.splice(0, target.words.length, ...previous)
    target.length = previous.length
    Toast.warning('收藏保存失败，请重试。')
  } finally { saving.value = false }
}

/** 使用与普通单词练习相同的收藏词书选择器。 */
function chooseCollectBook() {
  if (current.value && collectAnchor.value && !saving.value) {
    openWordCollectPicker(current.value.word, collectAnchor.value, { excludeDictId: String(book.value?.id ?? '') })
  }
}

/** 在筛词页面处理现有快捷键，同时让已打开的收藏选择器自行接收按键。 */
function handleKey(event: KeyboardEvent) {
  if (!started.value || !current.value || event.defaultPrevented || event.isComposing || wordCollectPickerState.visible) return
  const key = getShortcutKey(event)
  if (!key) return
  const keys = shortcutKeys.value
  const action = key === keys[ShortcutKey.Ignore] ? () => finishWord('skip')
    : key === keys[ShortcutKey.ToggleCollect] ? collect
    : key === keys[ShortcutKey.CollectToDict] ? chooseCollectBook
    : key === keys[ShortcutKey.Next] ? () => finishWord('next') : undefined
  if (!action) return
  event.preventDefault()
  if (!event.repeat && !saving.value) void action()
}

onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <main class="max-w-2xl mx-auto p-6">
    <NuxtLink to="/words" class="color-link">返回单词</NuxtLink>
    <h1 class="text-2xl my-4">整本筛词</h1>
    <p v-if="loading">正在读取词书…</p>
    <p v-else-if="!source.length">这本词书没有可筛选的单词。</p>
    <section v-else class="card space-y-4">
      <h2 class="text-lg">{{ book?.name }}</h2>
      <p>词书学习进度 {{ book?.lastLearnIndex }} / {{ source.length }} 条</p>
      <template v-if="!started && current">
        <p>全书 {{ source.length }} 条 · 已掌握 {{ mastered }} 词 · 重复 {{ source.length - unique.length }} 条</p>
        <p>待筛 {{ remaining.length }} 词。主动跳过会将当前词加入「已掌握」。</p>
        <BaseButton @click="started = true">{{ position.done ? '继续筛词' : '开始筛词' }}</BaseButton>
      </template>
      <template v-else-if="current">
        <p>第 {{ position.done + 1 }} / {{ position.done + remaining.length }} 词 · 本次新增已掌握 {{ position.added }} 词</p>
        <div class="flex items-center gap-3">
          <strong class="text-3xl">{{ current.word.word }}</strong>
          <BaseButton type="info" @click="playAudio(current.word.word)">播放发音</BaseButton>
        </div>
        <p v-if="current.word.trans?.length">{{ current.word.trans.map(item => [item.pos, item.cn].filter(Boolean).join(' ')).join('；') }}</p>
        <div class="flex flex-wrap gap-3 items-center">
          <BaseButton type="info" :disabled="saving" @click="finishWord('skip')">跳过并标为已掌握</BaseButton>
          <BaseButton type="info" :disabled="saving" @click="collect">{{ collected ? '取消收藏' : '收藏' }}</BaseButton>
          <span ref="collectAnchor"><BaseButton type="info" :disabled="saving" @click.stop="chooseCollectBook">收藏到词书</BaseButton></span>
          <BaseButton :disabled="saving" @click="finishWord('next')">下一词</BaseButton>
        </div>
        <p class="text-sm">跳过 {{ shortcutKeys[ShortcutKey.Ignore] }} · 收藏 {{ shortcutKeys[ShortcutKey.ToggleCollect] }} · 收藏到词书 {{ shortcutKeys[ShortcutKey.CollectToDict] }} · 下一词 {{ shortcutKeys[ShortcutKey.Next] }}</p>
        <form class="space-y-3" @submit.prevent="finishWord('write')">
          <input v-model="spelling" class="w-full border rounded p-3" aria-label="跟写当前单词" placeholder="跟写当前单词（可选）" autocomplete="off" spellcheck="false" :readonly="saving" />
          <p v-if="mistake" role="alert" class="text-red-600">拼写有误，请对照单词再试一次。</p>
          <BaseButton type="info" :disabled="saving" @click="finishWord('write')">检查拼写并继续</BaseButton>
        </form>
      </template>
      <template v-else>
        <p>{{ position.done ? `筛词完成，本次新增已掌握 ${position.added} 词。` : '这本词书的单词都已掌握。' }}</p>
        <NuxtLink to="/words" class="color-link">返回单词</NuxtLink>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BaseButton, Toast } from '@/base'
import { useBaseStore } from '@/core/stores/base'
import { useSettingStore } from '@/core/stores/setting'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { usePlayWordAudio } from '@/core/hooks/sound'
import { ShortcutKey } from '@/core/types/enum'
import type { Word } from '@/core/types/types'
import { _getDictDataByUrl, isDictIdMatch } from '@/core/utils'

type Position = { nextIndex: number; done: number; added: number }
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const playAudio = usePlayWordAudio()
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
const input = ref<HTMLInputElement>()
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
const skipKey = computed(() => settings.shortcutKeyMap[ShortcutKey.Ignore])

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
  } catch {
    Toast.warning('无法读取词书或筛词位置，请检查后重试。')
  } finally { loading.value = false }
}, { immediate: true })

/** 更新本书的筛词位置并把输入焦点移到下一词。 */
function advance(index: number, added = false) {
  position.value = { nextIndex: index + 1, done: position.value.done + 1, added: position.value.added + Number(added) }
  try { localStorage.setItem(storageKey.value, JSON.stringify(position.value)) }
  catch { Toast.warning('筛词位置保存失败。') }
  spelling.value = ''
  mistake.value = false
  void nextTick(() => input.value?.focus())
}

/** 主动跳过时先保存掌握记录，再推进筛词位置。 */
async function skip() {
  const item = current.value
  if (!item || saving.value) return
  if (known.value.has(item.key)) { advance(item.index); return }
  saving.value = true
  const knownBook = store.known
  const entry = { ...item.word }
  knownBook.words.push(entry)
  knownBook.length = knownBook.words.length
  try {
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    advance(item.index, true)
  } catch {
    const index = knownBook.words.findIndex(word => toRaw(word) === entry)
    if (index >= 0) knownBook.words.splice(index, 1)
    knownBook.length = knownBook.words.length
    Toast.warning('已掌握记录保存失败，请重试。')
  } finally { saving.value = false }
}

/** 跟写正确后进入下一词。 */
function finishWord() {
  if (!current.value || saving.value) return
  mistake.value = normalize(spelling.value) !== current.value.key
  if (!mistake.value) advance(current.value.index)
}

/** 输入框里沿用用户设置的跳过快捷键，其他键保留浏览器行为。 */
function handleKey(event: KeyboardEvent) {
  if (!skipKey.value || event.key !== skipKey.value || event.repeat || event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
  event.preventDefault()
  void skip()
}
</script>

<template>
  <main class="max-w-2xl mx-auto p-6">
    <NuxtLink to="/words" class="color-link">返回单词</NuxtLink>
    <h1 class="text-2xl my-4">整本筛词</h1>
    <p v-if="loading">正在读取词书…</p>
    <p v-else-if="!source.length">这本词书没有可筛选的单词。</p>
    <section v-else class="card space-y-4">
      <h2 class="text-lg">{{ book?.name }}</h2>
      <template v-if="!started && current">
        <p>全书 {{ source.length }} 条 · 已掌握 {{ mastered }} 词 · 重复 {{ source.length - unique.length }} 条</p>
        <p>待筛 {{ remaining.length }} 词。主动跳过会将当前词加入「已掌握」。</p>
        <BaseButton @click="started = true; nextTick(() => input?.focus())">{{ position.done ? '继续筛词' : '开始筛词' }}</BaseButton>
      </template>
      <template v-else-if="current">
        <p>第 {{ position.done + 1 }} / {{ position.done + remaining.length }} 词 · 本次新增已掌握 {{ position.added }} 词</p>
        <div class="flex items-center gap-3">
          <strong class="text-3xl">{{ current.word.word }}</strong>
          <BaseButton type="info" @click="playAudio(current.word.word)">播放发音</BaseButton>
        </div>
        <p v-if="current.word.trans?.length">{{ current.word.trans.map(item => [item.pos, item.cn].filter(Boolean).join(' ')).join('；') }}</p>
        <form class="space-y-3" @submit.prevent="finishWord">
          <input ref="input" v-model="spelling" class="w-full border rounded p-3" aria-label="跟写当前单词" placeholder="跟写当前单词" autocomplete="off" spellcheck="false" :readonly="saving" @keydown="handleKey" />
          <p v-if="mistake" role="alert" class="text-red-600">拼写有误，请对照单词再试一次。</p>
          <div class="flex flex-wrap gap-3">
            <BaseButton type="info" :loading="saving" @click="skip">跳过并标为已掌握</BaseButton>
            <BaseButton :disabled="saving" @click="finishWord">练完，下一词</BaseButton>
          </div>
          <p v-if="skipKey" class="text-sm">跳过快捷键 {{ skipKey }}</p>
        </form>
      </template>
      <template v-else>
        <p>{{ position.done ? `筛词完成，本次新增已掌握 ${position.added} 词。` : '这本词书的单词都已掌握。' }}</p>
        <NuxtLink to="/words" class="color-link">返回单词</NuxtLink>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
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
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { saveScreeningChanges, waitForScreeningWrites, type ScreeningPosition } from '@/core/utils/screening-journal'

type Position = ScreeningPosition
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const playAudio = usePlayWordAudio()
const { isWordCollect, toggleWordCollect } = useWordOptions()
const route = useRoute()
const androidApp = isAndroidApp()
const book = computed(() => store.word.bookList.find(item => isDictIdMatch(item, route.params.id)))
const storageKey = computed(() => 'typewords-screen:' + String(book.value?.id))
const position = ref<Position>({ nextIndex: 0, done: 0, added: 0 })
const source = ref<Word[]>([])
const loading = ref(true)
const started = ref(false)
const saving = ref(false)
const leaving = ref(false)
let leavingTask: Promise<boolean> | undefined
const busy = computed(() => saving.value || leaving.value)
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
    Toast.warning('Could not load the wordbook or screening progress. Try again.')
  } finally { loading.value = false }
}, { immediate: true })

/** 保存本书的筛词位置并清空可选的跟写输入。 */
function advance(index: number, added = false) {
  position.value = { nextIndex: index + 1, done: position.value.done + 1, added: position.value.added + Number(added) }
  try { localStorage.setItem(storageKey.value, JSON.stringify(position.value)) }
  catch { Toast.warning('Could not save the screening position.') }
  spelling.value = ''
  mistake.value = false
}

/** 将原书位置、筛词位置和本次已掌握词单写入轻量日志，退出时再合并主库。 */
async function saveBookProgress(nextIndex: number, entry?: Word, nextPosition = position.value): Promise<boolean> {
  const selected = book.value
  if (!selected || busy.value) return false
  const previousIndex = selected.lastLearnIndex
  const previousComplete = selected.complete
  const newIndex = Math.max(previousIndex, nextIndex)
  const complete = previousComplete || newIndex >= source.value.length
  if (!entry && newIndex === previousIndex && complete === previousComplete && nextPosition === position.value) return true

  saving.value = true
  selected.lastLearnIndex = newIndex
  selected.complete = complete
  const knownBook = store.known
  if (entry) {
    knownBook.words.push(entry)
    knownBook.length = knownBook.words.length
  }
  try {
    await saveScreeningChanges(selected, nextPosition, entry ? [knownBook] : [])
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
    Toast.warning('Could not save wordbook progress. Reload the page and try again.')
    return false
  } finally { saving.value = false }
}

/** 按原书推进到下一待筛词。只有主动跳过才新增已掌握记录。 */
async function finishWord(action: 'write' | 'skip' | 'next') {
  const item = current.value
  if (!item || busy.value) return
  mistake.value = action === 'write' && normalize(spelling.value) !== item.key
  if (mistake.value) return
  const skipped = action === 'skip'
  const entry = skipped ? { ...item.word } : undefined
  const nextIndex = remaining.value[1]?.index ?? source.value.length
  const nextPosition = { nextIndex: item.index + 1, done: position.value.done + 1, added: position.value.added + Number(skipped) }
  if (await saveBookProgress(nextIndex, entry, nextPosition)) advance(item.index, skipped)
}

/** 切换当前词的默认收藏状态，写入已有词典存储。 */
async function collect() {
  const item = current.value
  if (!item || busy.value) return
  const target = store.collectWord
  const previous = [...target.words]
  saving.value = true
  toggleWordCollect(item.word)
  try {
    await saveScreeningChanges(undefined, undefined, [target])
  } catch {
    target.words.splice(0, target.words.length, ...previous)
    target.length = previous.length
    Toast.warning('Could not save the favorite. Reload the page and try again.')
  } finally { saving.value = false }
}

/** 重复导航共用同一次保存，避免先结束的导航提前解除操作锁。 */
function finishScreening() {
  if (!leavingTask) leavingTask = flushScreening().finally(() => { leavingTask = undefined })
  return leavingTask
}

/** 离开或切换词书前合并已落盘的变更，保存失败时留在页面以便重试。 */
async function flushScreening() {
  leaving.value = true
  try {
    await waitForScreeningWrites()
    saving.value = true
    await persistence.saveDictState(store.$state, { canSyncRemote: false })
    return true
  } catch {
    Toast.warning('Could not finish saving. Your screening changes are stored locally. Reload the page and try again.')
    return false
  } finally {
    saving.value = false
    leaving.value = false
  }
}

onBeforeRouteLeave(finishScreening)
onBeforeRouteUpdate(finishScreening)

/** 使用与普通单词练习相同的收藏词书选择器。 */
function chooseCollectBook() {
  if (current.value && collectAnchor.value && !busy.value) {
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
  if (!event.repeat && !busy.value) void action()
}

onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <main v-if="androidApp" class="screen-mobile">
    <header class="screen-mobile__heading">
      <h1>Screen entire book</h1>
      <p v-if="book?.name">{{ book.name }}</p>
    </header>

    <p v-if="loading" class="screen-mobile__note" role="status">Loading wordbook…</p>
    <p v-else-if="!source.length" class="screen-mobile__note">There are no words to screen in this book.</p>
    <template v-else>
      <section v-if="!started && current" class="screen-mobile__intro">
        <span class="screen-mobile__count">{{ remaining.length }}</span>
        <p class="screen-mobile__count-label">Words to screen</p>
        <p class="screen-mobile__note">{{ source.length }} entries · {{ mastered }} mastered · {{ source.length - unique.length }} duplicates</p>
        <p class="screen-mobile__note">{{ remaining.length }} words to screen. Skipping marks the current word as mastered.</p>
        <button type="button" class="screen-action screen-action--primary" @click="started = true">
          {{ position.done ? 'Continue screening' : 'Start screening' }}
        </button>
      </section>
      <template v-else-if="current">
        <section class="screen-mobile__progress" aria-label="Screening progress">
          <p>Word {{ position.done + 1 }} / {{ position.done + remaining.length }} · Newly mastered: {{ position.added }}</p>
          <progress :value="position.done" :max="position.done + remaining.length" aria-label="Words screened this session"></progress>
        </section>
        <section class="screen-mobile__word" aria-label="Current word">
          <strong>{{ current.word.word }}</strong>
          <p v-if="current.word.trans?.length">{{ current.word.trans.map(item => [item.pos, item.cn].filter(Boolean).join(' ')).join('；') }}</p>
          <button type="button" class="screen-action screen-action--text" @click="playAudio(current.word.word)">Play pronunciation</button>
        </section>
        <div class="screen-mobile__actions">
          <button type="button" class="screen-action screen-action--primary" :disabled="busy" @click="finishWord('next')">Next word</button>
          <button type="button" class="screen-action screen-action--subtle" :disabled="busy" @click="finishWord('skip')">Skip and mark as mastered</button>
          <div class="screen-mobile__favorites">
            <button type="button" class="screen-action screen-action--text" :aria-pressed="collected" :disabled="busy" @click="collect">{{ collected ? 'Remove favorite' : 'Favorite' }}</button>
            <span ref="collectAnchor"><button type="button" class="screen-action screen-action--text" :disabled="busy" @click.stop="chooseCollectBook">Add to wordbook</button></span>
          </div>
        </div>
        <details class="screen-mobile__details">
          <summary>Spelling and shortcuts</summary>
          <form @submit.prevent="finishWord('write')">
            <input v-model="spelling" aria-label="Type the current word" placeholder="Type the word (optional)" autocomplete="off" spellcheck="false" :readonly="busy" />
            <p v-if="mistake" role="alert" class="text-red-600">Check the spelling and try again.</p>
            <button type="submit" class="screen-action screen-action--subtle" :disabled="busy">Check spelling and continue</button>
          </form>
          <p class="screen-mobile__note">Skip {{ shortcutKeys[ShortcutKey.Ignore] }} · Favorite {{ shortcutKeys[ShortcutKey.ToggleCollect] }} · Add to wordbook {{ shortcutKeys[ShortcutKey.CollectToDict] }} · Next word {{ shortcutKeys[ShortcutKey.Next] }}</p>
        </details>
      </template>
      <section v-else class="screen-mobile__intro">
        <h2>Session complete</h2>
        <p class="screen-mobile__note">{{ position.done ? `Screening complete. Newly mastered: ${position.added}.` : 'All words in this book are mastered.' }}</p>
        <NuxtLink to="/words" class="screen-action screen-action--primary">Back to words</NuxtLink>
      </section>
      <p class="screen-mobile__note screen-mobile__book-progress">Book progress {{ book?.lastLearnIndex }} / {{ source.length }}</p>
    </template>
  </main>
  <main v-else class="max-w-2xl mx-auto p-6">
    <NuxtLink to="/words" class="color-link">Back to words</NuxtLink>
    <h1 class="text-2xl my-4">Screen entire book</h1>
    <p v-if="loading">Loading wordbook…</p>
    <p v-else-if="!source.length">There are no words to screen in this book.</p>
    <section v-else class="card space-y-4">
      <h2 class="text-lg">{{ book?.name }}</h2>
      <p>Book progress {{ book?.lastLearnIndex }} / {{ source.length }}</p>
      <template v-if="!started && current">
        <p>{{ source.length }} entries · {{ mastered }} mastered · {{ source.length - unique.length }} duplicates</p>
        <p>{{ remaining.length }} words to screen. Skipping marks the current word as mastered.</p>
        <BaseButton @click="started = true">{{ position.done ? 'Continue screening' : 'Start screening' }}</BaseButton>
      </template>
      <template v-else-if="current">
        <p>Word {{ position.done + 1 }} / {{ position.done + remaining.length }} · Newly mastered: {{ position.added }}</p>
        <div class="flex items-center gap-3">
          <strong class="text-3xl">{{ current.word.word }}</strong>
          <BaseButton type="info" @click="playAudio(current.word.word)">Play pronunciation</BaseButton>
        </div>
        <p v-if="current.word.trans?.length">{{ current.word.trans.map(item => [item.pos, item.cn].filter(Boolean).join(' ')).join('；') }}</p>
        <div class="flex flex-wrap gap-3 items-center">
          <BaseButton type="info" :disabled="busy" @click="finishWord('skip')">Skip and mark as mastered</BaseButton>
          <BaseButton type="info" :disabled="busy" @click="collect">{{ collected ? 'Remove favorite' : 'Favorite' }}</BaseButton>
          <span ref="collectAnchor"><BaseButton type="info" :disabled="busy" @click.stop="chooseCollectBook">Add to wordbook</BaseButton></span>
          <BaseButton :disabled="busy" @click="finishWord('next')">Next word</BaseButton>
        </div>
        <p class="text-sm">Skip {{ shortcutKeys[ShortcutKey.Ignore] }} · Favorite {{ shortcutKeys[ShortcutKey.ToggleCollect] }} · Add to wordbook {{ shortcutKeys[ShortcutKey.CollectToDict] }} · Next word {{ shortcutKeys[ShortcutKey.Next] }}</p>
        <form class="space-y-3" @submit.prevent="finishWord('write')">
          <input v-model="spelling" class="w-full border rounded p-3" aria-label="Type the current word" placeholder="Type the word (optional)" autocomplete="off" spellcheck="false" :readonly="busy" />
          <p v-if="mistake" role="alert" class="text-red-600">Check the spelling and try again.</p>
          <BaseButton type="info" :disabled="busy" @click="finishWord('write')">Check spelling and continue</BaseButton>
        </form>
      </template>
      <template v-else>
        <p>{{ position.done ? `Screening complete. Newly mastered: ${position.added}.` : 'All words in this book are mastered.' }}</p>
        <NuxtLink to="/words" class="color-link">Back to words</NuxtLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.screen-mobile {
  box-sizing: border-box;
  width: min(100%, 560px);
  margin-inline: auto;
  padding: 24px clamp(16px, 5vw, 28px) 28px;
  display: grid;
  gap: 16px;
  color: var(--android-text, #1d1d1f);
}

.screen-mobile__heading h1 {
  font-size: clamp(28px, 8.6vw, 38px);
  font-weight: 700;
  line-height: 1.14;
  letter-spacing: -0.035em;
}

.screen-mobile__heading p {
  margin-top: 6px;
  color: var(--android-muted, #6e6e73);
  overflow-wrap: anywhere;
}

.screen-mobile__intro,
.screen-mobile__word {
  display: grid;
  gap: 8px;
  padding: clamp(20px, 6vw, 34px);
  border-radius: 24px;
  text-align: center;
  background: var(--android-surface, #fff);
}

.screen-mobile__intro h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 650;
}

.screen-mobile__intro .screen-action {
  margin-top: 14px;
}

.screen-mobile__count {
  font-size: clamp(46px, 13vw, 64px);
  line-height: 1.05;
  font-weight: 650;
  letter-spacing: -0.06em;
  font-variant-numeric: tabular-nums;
}

.screen-mobile__count-label {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 600;
}

.screen-mobile__note,
.screen-mobile__progress p {
  color: var(--android-muted, #6e6e73);
  font-size: 14px;
  line-height: 1.55;
}

.screen-mobile__progress {
  display: grid;
  gap: 7px;
  font-variant-numeric: tabular-nums;
}

.screen-mobile__progress progress {
  width: 100%;
  height: 6px;
  border: 0;
  border-radius: 99px;
  overflow: hidden;
  appearance: none;
  background: var(--android-line, #e5e5ea);
}

.screen-mobile__progress progress::-webkit-progress-bar {
  background: var(--android-line, #e5e5ea);
}

.screen-mobile__progress progress::-webkit-progress-value {
  border-radius: 99px;
  background: var(--android-accent, #0071e3);
}

.screen-mobile__word {
  min-height: 178px;
  align-content: center;
  justify-items: center;
  gap: 10px;
}

.screen-mobile__word strong {
  min-width: 0;
  max-width: 100%;
  font-size: clamp(32px, 10vw, 56px);
  font-weight: 650;
  line-height: 1.04;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}

.screen-mobile__word p {
  max-width: 100%;
  font-size: 16px;
  line-height: 1.55;
  color: var(--android-muted, #6e6e73);
  overflow-wrap: anywhere;
}

.screen-mobile__actions,
.screen-mobile__details form {
  display: grid;
  gap: 8px;
}

.screen-mobile__favorites {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.screen-mobile__favorites .screen-action {
  width: 100%;
}

.screen-action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 9px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--android-accent, #0071e3);
  font-size: 15px;
  font-weight: 600;
  text-align: center;
}

.screen-action--primary {
  color: #fff;
  background: var(--android-accent, #0071e3);
}

:global(html.dark) .screen-action--primary {
  color: #101114;
}

.screen-action--subtle {
  background: var(--android-surface, #fff);
  color: var(--android-text, #1d1d1f);
}

.screen-action--text[aria-pressed='true'] {
  background: var(--android-tint, #e8f2ff);
}

.screen-action:disabled {
  opacity: 0.5;
}

.screen-action:focus-visible,
.screen-mobile__details summary:focus-visible,
.screen-mobile__details input:focus-visible {
  outline: 2px solid var(--android-accent, #0071e3);
  outline-offset: 2px;
}

.screen-mobile__details {
  border-block: 1px solid var(--android-line, #e5e5ea);
  font-size: 14px;
  color: var(--android-muted, #6e6e73);
}

.screen-mobile__details summary {
  box-sizing: border-box;
  min-height: 44px;
  padding: 12px 0;
}

.screen-mobile__details input {
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  padding: 10px 14px;
  border: 1px solid var(--android-line, #e5e5ea);
  border-radius: 12px;
  background: var(--android-surface, #fff);
  color: var(--android-text, #1d1d1f);
  font-size: 16px;
}

.screen-mobile__details .screen-mobile__note {
  padding: 10px 0;
}

.screen-mobile__book-progress {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>

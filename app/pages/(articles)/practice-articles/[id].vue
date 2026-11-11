<script setup lang="ts">
import { BaseIcon, Toast, Tooltip } from '@/base'
import ConflictNotice from '@/components/dialog/ConflictNotice.vue'
import ArticleList from '@/components/list/ArticleList.vue'
import Panel from '@/components/Panel.vue'
import PracticeLayout from '@/components/PracticeLayout.vue'
import SettingDialog from '@/components/setting/SettingDialog.vue'
import { DICT_LIST } from '@/core/config/env.ts'
import { genArticleSectionData, usePlayArticleTextAudio, usePlaySentenceAudio } from '@/core/hooks/article.ts'
import { cancelWordPracticeAudio, localSpeechUrl, splitSpeechText } from '@/core/hooks/sound'
import { selectedSpeechVoice } from '#shared/speech-voices'
import { useArticleOptions } from '@/core/hooks/dict.ts'
import { useOnKeyboardEventListener, useStartKeyboardEventListener } from '@/core/hooks/event.ts'
import { useDisableEventListener } from '@/core/hooks/event'
import useTheme from '@/core/hooks/theme.ts'
import ArticleAudio from '@/components/article/ArticleAudio.vue'
import EditSingleArticleModal from '@/components/article/EditSingleArticleModal.vue'
import TypingArticle from '@/components/article/TypingArticle.vue'
import { useBaseStore } from '@/core/stores/base.ts'
import { usePracticeStore } from '@/core/stores/practice.ts'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { getDefaultArticle, getDefaultDict, getDefaultWord } from '@/core/types/func.ts'
import type { Article, ArticleItem, ArticleWord, Dict, Statistics, Word } from '@/core/types/types.ts'
import {
  _getDictDataByUrl,
  _nextTick,
  cloneDeep,
  ensureCustomDictCopy,
  msToMinute,
  resourceWrap,
  total,
} from '@/core/utils'
import { getPracticeArticleCacheLocal } from '@/core/utils/cache.ts'
import { usePracticeArticlePersistence } from '@/core/composables/usePracticePersistence'
import { emitter, EventKey, useEvents } from '@/core/utils/eventBus'
import { computed, nextTick, onMounted, onUnmounted, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DictType, PracticeArticleWordType, ShortcutKey } from '@/core/types/enum.ts'

const store = useBaseStore()
const runtimeStore = useRuntimeStore()
const settingStore = useSettingStore()
const statStore = usePracticeStore()
const articlePersistence = usePracticeArticlePersistence()
const { toggleTheme } = useTheme()

let articleData = $ref({
  list: [],
  article: getDefaultArticle(),
})
let showEditArticle = $ref(false)
let typingArticleRef = $ref<any>()
let footerRef = $ref<HTMLElement>()
let showConflictNotice = $ref(false)
let loading = $ref<boolean>(false)
let allWrongWords = new Set()
let editArticle = $ref<Article>(getDefaultArticle())
let audioRef = $ref<HTMLAudioElement>()
let timer = $ref<ReturnType<typeof setInterval> | number>(0)
let isFocus = true
let isTyped = $ref(false)
//用于解决 手动改文章时改了lastLearnIndex，同时又监听了store.sbook.lastLearnIndex，会冲突
let lock = false
let reading = $ref(false)
let readingSession = $ref(false)
let readingPosition = $ref<{ section: number; sentence: number } | null>(null)
let readGeneration = 0
let readAudio: HTMLAudioElement | undefined
let preparedAudio: HTMLAudioElement | undefined
let endReadAudio: ((played: boolean) => void) | undefined
let resumeReading: (() => void) | undefined

/** 取消当前读音、下一段预加载和正在等待的读音回调。 */
function stopReading() {
  readGeneration++
  reading = false
  readingSession = false
  readingPosition = null
  endReadAudio?.(false)
  endReadAudio = undefined
  resumeReading?.()
  resumeReading = undefined
  for (const player of [readAudio, preparedAudio]) {
    if (!player) continue
    player.onended = player.onerror = player.onplaying = null
    player.pause()
    player.removeAttribute('src')
    player.load()
  }
  readAudio = preparedAudio = undefined
}

/** 读取当前句的文本，播放时提前加载下一段，始终使用文章音量与速度。 */
function playReadChunk(text: string, upcoming?: string) {
  const voice = selectedSpeechVoice(settingStore.speechVoice, settingStore.soundType)
  const url = new URL(localSpeechUrl(text, voice), location.href).href
  const player = preparedAudio?.src === url ? preparedAudio : new Audio(url)
  if (preparedAudio && preparedAudio !== player) {
    preparedAudio.removeAttribute('src')
    preparedAudio.load()
  }
  readAudio = player
  preparedAudio = undefined
  player.volume = settingStore.articleSoundVolume / 100
  player.playbackRate = settingStore.articleSoundSpeed
  return new Promise<boolean>(resolve => {
    endReadAudio = resolve
    player.onended = () => resolve(true)
    player.onerror = () => resolve(false)
    player.onplaying = () => {
      player.onplaying = null
      if (upcoming) {
        preparedAudio = new Audio(localSpeechUrl(upcoming, voice))
        preparedAudio.preload = 'auto'
      }
    }
    void player.play().catch(() => {
      if (reading) resolve(false)
    })
  })
}

/** 句首所在行离开正文可视区时翻屏，把接下来要读的句子放在新屏上方。 */
function turnReadingPage() {
  const sentence = document.querySelector('#article-content .reading-sentence')
  const line = sentence?.querySelector('.word')?.getBoundingClientRect()
  if (!line) return

  // 窄屏布局由正文外层滚动，桌面通常由文档滚动。
  const main = sentence?.closest('.main-content')
  const inner = main && main.scrollHeight > main.clientHeight ? main : null
  const scroller = inner ?? document.scrollingElement
  if (!scroller) return
  const bounds = inner?.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
  const navBottom = document.querySelector('.mobile-top-nav')?.getBoundingClientRect().bottom ?? 0
  const header = sentence?.closest('.typing-article')?.querySelector('header')
  const headerBottom = header && getComputedStyle(header).position === 'fixed' ? header.getBoundingClientRect().bottom : 0
  const top = Math.max(viewportTop, bounds?.top ?? 0, navBottom, headerBottom)
  const bottom = Math.min(viewportBottom, bounds?.bottom ?? viewportBottom,
    footerRef?.getBoundingClientRect().top ?? viewportBottom)
  // 底栏遮挡的行不算可见。留 1px 容差，避免子像素换行引起不必要的切屏。
  if (bottom <= top || (line.top >= top - 1 && line.bottom <= bottom + 1)) return
  scroller.scrollTo({ top: scroller.scrollTop + line.top - top - 12, behavior: 'instant' })
}

/** 从打字光标所在句开始朗读。跨篇使用现有切篇流程，不记作打字完成。 */
async function readArticles(generation: number, firstSection: number, firstSentence: number) {
  try {
    while (generation === readGeneration) {
      const chunks = articleData.article.sections.flatMap((section, i) =>
        section.flatMap((sentence, j) =>
          i > firstSection || (i === firstSection && j >= firstSentence)
            ? splitSpeechText(sentence.text).map(text => ({ text, section: i, sentence: j }))
            : [],
        ),
      )
      for (let i = 0; i < chunks.length; i++) {
        if (!reading && generation === readGeneration) await new Promise<void>(resolve => { resumeReading = resolve })
        if (generation !== readGeneration) return
        const { text, section, sentence } = chunks[i]
        const previous = chunks[i - 1]
        if (!previous || previous.section !== section || previous.sentence !== sentence) {
          readingPosition = { section, sentence }
          await nextTick()
          if (generation !== readGeneration) return
          turnReadingPage()
        }
        const nextArticleText = articleData.list[store.sbook.lastLearnIndex + 1]?.text?.trim().split('\n', 1)[0] ?? ''
        const upcoming = chunks[i + 1]?.text ?? splitSpeechText(nextArticleText)[0]
        const played = await playReadChunk(text, upcoming)
        if (generation !== readGeneration) return
        endReadAudio = undefined
        readAudio = undefined
        if (!played) {
          Toast.warning('Read-aloud is temporarily unavailable. Try again.')
          return
        }
      }
      const nextIndex = store.sbook.lastLearnIndex + 1
      if (nextIndex >= articleData.list.length) return
      await articlePersistence.clear()
      if (generation !== readGeneration) return
      lock = true
      store.sbook.lastLearnIndex = nextIndex
      getCurrentPractice()
      await nextTick()
      lock = false
      firstSection = firstSentence = 0
    }
  } catch (error) {
    if (generation === readGeneration) {
      console.warn('连续朗读失败', (error as Error).name)
      Toast.warning('Read-aloud is temporarily unavailable. Try again.')
    }
  } finally {
    if (generation === readGeneration) stopReading()
  }
}

/** 底栏按钮切换朗读和暂停，恢复时保留当前音频位置。 */
function toggleReading() {
  if (!articleData.article.sections.length) return
  if (reading) {
    reading = false
    readAudio?.pause()
    return
  }
  reading = true
  if (readingSession) {
    resumeReading?.()
    resumeReading = undefined
    void readAudio?.play().catch(() => {
      if (reading) endReadAudio?.(false)
    })
    return
  }
  cancelWordPracticeAudio()
  audioRef?.pause()
  readingSession = true
  const position = typingArticleRef?.getIndex()
  void readArticles(++readGeneration, position?.sectionIndex ?? 0, position?.sentenceIndex ?? 0)
}

function write() {
  // console.log('write')
  settingStore.dictation = true
  repeat()
}

//TODO 需要判断是否已忽略
//todo 使用场景是？
function repeat() {
  stopReading()
  // console.log('repeat')
  getCurrentPractice()
}

function prev() {
  stopReading()
  // console.log('next')
  if (store.sbook.lastLearnIndex === 0) {
    Toast.warning('You are already on the first article.')
  } else {
    store.sbook.lastLearnIndex--
    getCurrentPractice()
  }
}

const toggleShowTranslate = () => (settingStore.translate = !settingStore.translate)
const toggleDictation = () => (settingStore.dictation = !settingStore.dictation)
const togglePanel = () => (settingStore.showPanel = !settingStore.showPanel)
const skip = () => {
  stopReading()
  typingArticleRef?.nextSentence()
}
const collect = () => toggleArticleCollect(articleData.article)
const shortcutKeyEdit = () => edit()

function toggleConciseMode() {
  settingStore.showToolbar = !settingStore.showToolbar
  settingStore.showPanel = settingStore.showToolbar
}

function next() {
  stopReading()
  articlePersistence.clear()
  if (store.sbook.lastLearnIndex >= articleData.list.length - 1) {
    store.sbook.complete = true
    store.sbook.lastLearnIndex = 0
    //todo 这里应该弹窗
  } else store.sbook.lastLearnIndex++
  getCurrentPractice()
}

const router = useRouter()
const route = useRoute()

async function init() {
  // console.log('load好了开始加载')
  let dict = getDefaultDict()
  let dictId = route.params.id
  if (dictId) {
    //先在自己的词典列表里面找，如果没有再在资源列表里面找
    dict = store.article.bookList.find(v => v.id == dictId)
    let r = await fetch(resourceWrap(DICT_LIST.ARTICLE.ALL))
    let book_list = await r.json()
    if (!dict) dict = book_list.find(v => v.id === dictId) as Dict
    if (dict && dict.id) {
      //如果是不是自定义词典，就请求数据
      if (!dict.custom) dict = await _getDictDataByUrl(dict, DictType.article)
      if (!dict.articles.length) {
        router.push('/articles')
        return Toast.warning('There are no articles to practice.')
      }
      await store.changeBook(dict)
      articleData.list = cloneDeep(store.sbook.articles)
      getCurrentPractice()
      loading = false
    } else {
      router.push('/articles')
    }
  } else {
    router.push('/articles')
  }
}

const initAudio = () => {
  _nextTick(() => {
    if (import.meta.server || !audioRef) return
    audioRef.volume = settingStore.articleSoundVolume / 100
    audioRef.playbackRate = settingStore.articleSoundSpeed
  })
}

const handleVolumeUpdate = (volume: number) => {
  settingStore.articleSoundVolume = volume
}

const handleSpeedUpdate = (speed: number) => {
  settingStore.articleSoundSpeed = speed
}

watch(
  [() => store.load, () => loading],
  ([a, b]) => {
    if (a && b) init()
  },
  { immediate: true }
)

watch(
  () => settingStore.$state,
  n => {
    initAudio()
  },
  { immediate: true, deep: true }
)

//用于远程拉了新数据，被动更新当前文章
watch(
  () => store.sbook.lastLearnIndex,
  n => {
    if (lock) return
    getCurrentPractice()
  }
)

onActivated(() => {
  console.log('onActivated')
})
onMounted(() => {
  document.removeEventListener('visibilitychange', onvisibilitychange)
  document.addEventListener('visibilitychange', onvisibilitychange)

  console.log('onMounted')
  if (store.sbook?.articles?.length) {
    articleData.list = cloneDeep(store.sbook.articles)
    getCurrentPractice()
  } else {
    loading = true
  }
  if (route.query.guide) {
    showConflictNotice = false
  } else {
    showConflictNotice = true
  }
})

async function unmount() {
  stopReading()
  document.removeEventListener('visibilitychange', onvisibilitychange)
  console.log('onUnmounted')
  const cache = await getPracticeArticleCacheLocal()
  //如果有缓存，则更新花费的时间；因为用户不输入不会保存数据
  if (cache) {
    if (runtimeStore.globalLoading) return
    runtimeStore.globalLoading = true
    cache.statStoreData.spend = statStore.spend
    await articlePersistence.save(cache)
    runtimeStore.globalLoading = false
  }
  timer && clearInterval(timer)
}

onUnmounted(unmount)

useStartKeyboardEventListener()
useDisableEventListener(() => loading)

const onvisibilitychange = async () => {
  isFocus = !document.hidden
  if (isFocus) {
    if (runtimeStore.globalLoading) return
    runtimeStore.globalLoading = true
    try {
      const cache = await articlePersistence.fetch()
      if (cache) {
        statStore.$patch(cache.statStoreData)
        typingArticleRef?.applyPracticeCache?.(cache)
      }
    } finally {
      runtimeStore.globalLoading = false
    }
  }
}

function setArticle(val: Article) {
  statStore.wrong = 0
  statStore.total = 0
  statStore.startDate = Date.now()
  statStore.spend = 0
  allWrongWords = new Set()
  articleData.list[store.sbook.lastLearnIndex] = val
  articleData.article = val
  let ignoreSet = [store.allIgnoreWordsSet, store.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1]
  articleData.article.sections.map((v, i) => {
    v.map(w => {
      w.words.map(s => {
        if (!ignoreSet.has(s.word.toLowerCase()) && s.type === PracticeArticleWordType.Word) {
          statStore.total++
        }
      })
    })
  })

  isTyped = false
  clearInterval(timer)
  timer = setInterval(() => {
    if (isFocus) {
      statStore.spend += 1000
    }
  }, 1000)

  _nextTick(typingArticleRef?.init)
}

async function complete() {
  clearInterval(timer)
  //todo 有空了改成实时保存
  let data: Partial<Statistics> & { title: string; articleId: number } = {
    articleId: Number(articleData.article.id),
    title: articleData.article.title,
    spend: statStore.spend,
    startDate: statStore.startDate,
    total: statStore.total,
    wrong: statStore.wrong,
  }

  let reportData = {
    name: store.sbook.name,
    index: store.sbook.lastLearnIndex,
    custom: store.sbook.custom,
    complete: store.sbook.complete,
    title: articleData.article.title,
    spend: Number(statStore.spend / 1000 / 60).toFixed(1),
    s: '',
  }
  reportData.s = `name:${store.sbook.name},title:${store.sbook.lastLearnIndex}.${data.title},spend:${Number(statStore.spend / 1000 / 60).toFixed(1)}`
  window.umami?.track('endStudyArticle', reportData)

  if (store.sbook.lastLearnIndex >= store.sbook.length - 1) {
    store.sdict.complete = true
  }
  store.sbook.statistics.push(data as any)

  //重置
  statStore.wrong = 0
  statStore.startDate = Date.now()
}

function getCurrentPractice() {
  emitter.emit(EventKey.resetWord)
  let currentArticle = articleData.list[store.sbook.lastLearnIndex]
  let article = getDefaultArticle(currentArticle)
  if (article.sections.length) {
    setArticle(article)
  } else {
    genArticleSectionData(article)
    setArticle(article)
  }
}

function saveArticle(val: Article) {
  console.log('saveArticle', val, JSON.stringify(val?.lrcPosition))
  console.log('saveArticle', val.textTranslate)
  showEditArticle = false
  const nextBook = ensureCustomDictCopy(store.sbook)
  const rIndex = nextBook.articles.findIndex(v => v.id === val.id)
  if (rIndex > -1) {
    nextBook.articles[rIndex] = cloneDeep(val)
  }
  if (store.article.studyIndex > -1) {
    store.article.bookList[store.article.studyIndex] = getDefaultDict(nextBook)
  }
  setArticle(val)
}

function edit(val: Article = articleData.article) {
  stopReading()
  editArticle = val
  showEditArticle = true
}

function wrong(word: Word) {
  let temp = word.word.toLowerCase()
  //过滤简单词
  if (settingStore.ignoreSimpleWord) {
    if (store.simpleWords.includes(temp)) return
  }
  if (!allWrongWords.has(temp)) {
    allWrongWords.add(temp)
    statStore.wrong++
  }

  if (!store.wrong.words.find((v: Word) => v.word.toLowerCase() === temp)) {
    store.wrong.words.push(getDefaultWord(word))
    store.wrong.length = store.wrong.words.length
  }
}

function nextWord(word: ArticleWord) {
  if (readingSession) stopReading()
  if (!store.allIgnoreWords.includes(word.word.toLowerCase()) && word.type === PracticeArticleWordType.Word) {
    statStore.inputWordNumber++
  }
}

async function changeArticle(val: ArticleItem) {
  if (lock) return
  stopReading()
  lock = true
  await articlePersistence.clear()
  let rIndex = articleData.list.findIndex(v => v.id === val.item.id)
  if (rIndex > -1) {
    store.sbook.lastLearnIndex = rIndex
    getCurrentPractice()
  }
  initAudio()
  lock = false
}

const handlePlayNext = (nextArticle: Article) => {
  let rIndex = articleData.list.findIndex(v => v.id === nextArticle.id)
  if (rIndex > -1) {
    store.sbook.lastLearnIndex = rIndex
    getCurrentPractice()
  }
}

const { isArticleCollect, toggleArticleCollect } = useArticleOptions()

function play() {
  typingArticleRef?.play()
}

function show() {
  typingArticleRef?.showSentence()
}

function onKeyUp() {
  typingArticleRef?.hideSentence()
}

async function onKeyDown(e: KeyboardEvent) {}

useOnKeyboardEventListener(onKeyDown, onKeyUp)

useEvents([
  [EventKey.write, write],
  [EventKey.repeatStudy, repeat],
  [EventKey.continueStudy, next],

  [ShortcutKey.PreviousChapter, prev],
  [ShortcutKey.RepeatChapter, repeat],
  [ShortcutKey.DictationChapter, write],
  [ShortcutKey.ToggleShowTranslate, toggleShowTranslate],
  [ShortcutKey.ToggleDictation, toggleDictation],
  [ShortcutKey.ToggleTheme, toggleTheme],
  [ShortcutKey.ToggleConciseMode, toggleConciseMode],
  [ShortcutKey.TogglePanel, togglePanel],
  [ShortcutKey.NextChapter, next],
  [ShortcutKey.PlayWordPronunciation, play],
  [ShortcutKey.ShowWord, show],
  [ShortcutKey.Next, skip],
  [ShortcutKey.ToggleCollect, collect],
  [ShortcutKey.EditArticle, shortcutKeyEdit],
])

const { playSentenceAudio } = usePlaySentenceAudio()
const { playArticleTextAudio } = usePlayArticleTextAudio()

function play2(e) {
  _nextTick(() => {
    if (readingSession && !e.handle) return
    if (readingSession) stopReading()
    if (settingStore.articleSound || e.handle) {
      playSentenceAudio(e.sentence, audioRef)
    }
  })
}

function playArticleHeadAudio(e) {
  stopReading()
  _nextTick(() => {
    playArticleTextAudio(e, audioRef)
  })
}

const currentPractice = computed(() => {
  if (store.sbook.statistics?.length) {
    return store.sbook.statistics.filter((v: any) => v.title === articleData.article.title)
  }
  return []
})

provide('currentPractice', currentPractice)
</script>
<template>
  <PracticeLayout v-loading="loading" panelLeft="var(--article-panel-margin-left)">
    <template v-slot:practice>
      <TypingArticle
        ref="typingArticleRef"
        @wrong="wrong"
        @next="next"
        @nextWord="nextWord"
        @play="play2"
        @play-article-text-audio="playArticleHeadAudio"
        @replay="setArticle(articleData.article)"
        @complete="complete"
        :article="articleData.article"
        :reading-position="readingPosition"
      />
    </template>
    <template v-slot:panel>
      <Panel :style="{ width: 'var(--article-panel-width)' }">
        <template v-slot:title>
          <span>{{ store.sbook.name }} ({{ store.sbook.lastLearnIndex + 1 }} / {{ articleData.list.length }})</span>
        </template>
        <div class="panel-page-item pl-4">
          <ArticleList
            :isActive="settingStore.showPanel"
            :static="false"
            :show-translate="settingStore.translate"
            @click="changeArticle"
            :active-id="articleData.article.id ?? ''"
            :list="articleData.list"
          >
          </ArticleList>
        </div>
      </Panel>
    </template>
    <template v-slot:footer>
      <div ref="footerRef" class="footer pb-3">
        <div class="center h-10">
          <Tooltip
            :title="`${settingStore.showToolbar ? $t('collapse') : $t('expand')}(${settingStore.shortcutKeyMap[ShortcutKey.ToggleToolbar]})`"
          >
            <IconFluentChevronLeft20Filled
              @click="settingStore.showToolbar = !settingStore.showToolbar"
              :class="!settingStore.showToolbar && 'down'"
              color="#999"
              class="arrow"
            />
          </Tooltip>
        </div>
        <div class="bottom">
          <div class="flex justify-between items-center gap-2">
            <div class="stat">
              <div class="row">
                <div class="num">{{ currentPractice.length }} sessions · {{ msToMinute(total(currentPractice, 'spend'), true) }}</div>
                <div class="line"></div>
                <div class="name">History</div>
              </div>
              <div class="row">
                <!--                <div class="num">{{statStore.spend }}分钟</div>-->
                <div class="num">{{ Math.floor(statStore.spend / 1000 / 60) }} min</div>
                <div class="line"></div>
                <div class="name">Time</div>
              </div>
              <div class="row">
                <div class="num center gap-1">
                  {{ statStore.total }}
                  <Tooltip>
                    <IconFluentQuestionCircle20Regular width="18" />
                    <template #reference>
                      <div>
                        {{ settingStore.ignoreSimpleWord ? 'Simple words are excluded.' : 'Simple words are included.' }} Mastered words are always excluded.
                        <div>To change this, open Settings → Practice → Simple word filter.</div>
                      </div>
                    </template>
                  </Tooltip>
                </div>
                <div class="line"></div>
                <div class="name">Total words</div>
              </div>
            </div>
            <ArticleAudio
              ref="audioRef"
              :article="articleData.article"
              @update-speed="handleSpeedUpdate"
              @update-volume="handleVolumeUpdate"
            ></ArticleAudio>
            <div class="flex flex-col items-center justify-center gap-1">
              <div class="flex gap-2 center">
                <div class="contents" @click.capture="stopReading">
                  <SettingDialog type="article" />
                </div>

                <BaseIcon :title="`Next sentence (${settingStore.shortcutKeyMap[ShortcutKey.Next]})`" @click="skip">
                  <IconFluentArrowBounce20Regular class="transform-rotate-180" />
                </BaseIcon>
                <BaseIcon
                  :title="`Play current sentence (${settingStore.shortcutKeyMap[ShortcutKey.PlayWordPronunciation]})`"
                  @click="play"
                >
                  <IconFluentReplay20Regular />
                </BaseIcon>
                <BaseIcon
                  :title="reading ? 'Pause reading' : readingSession ? 'Resume reading' : 'Read aloud'"
                  :aria-label="reading ? 'Pause reading' : readingSession ? 'Resume reading' : 'Read aloud'"
                  role="button"
                  tabindex="0"
                  :aria-pressed="reading"
                  :active="reading"
                  @click="toggleReading"
                  @keydown.enter.stop.prevent="toggleReading"
                  @keydown.space.stop.prevent="toggleReading"
                >
                  <IconFluentPause20Regular v-if="reading" />
                  <IconFluentPlay20Regular v-else />
                </BaseIcon>
                <BaseIcon
                  @click="settingStore.dictation = !settingStore.dictation"
                  :title="`Toggle dictation (${settingStore.shortcutKeyMap[ShortcutKey.ToggleDictation]})`"
                >
                  <IconFluentEyeOff16Regular v-if="settingStore.dictation" />
                  <IconFluentEye16Regular v-else />
                </BaseIcon>

                <BaseIcon
                  :title="`Toggle translation (${settingStore.shortcutKeyMap[ShortcutKey.ToggleShowTranslate]})`"
                  @click="settingStore.translate = !settingStore.translate"
                >
                  <IconPhTranslate v-if="settingStore.translate" />
                  <IconFluentTranslateOff16Regular v-else />
                </BaseIcon>

                <!--              <BaseIcon-->
                <!--                  :title="`编辑(${settingStore.shortcutKeyMap[ShortcutKey.EditArticle]})`"-->
                <!--                  icon="tabler:edit"-->
                <!--                  @click="emitter.emit(ShortcutKey.EditArticle)"-->
                <!--              />-->
                <BaseIcon
                  @click="settingStore.showPanel = !settingStore.showPanel"
                  :title="`Toggle panel (${settingStore.shortcutKeyMap[ShortcutKey.TogglePanel]})`"
                >
                  <IconFluentTextListAbcUppercaseLtr20Regular />
                </BaseIcon>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </PracticeLayout>

  <EditSingleArticleModal v-model="showEditArticle" :article="editArticle" @save="saveArticle" />

  <ConflictNotice v-if="showConflictNotice" />
</template>

<style scoped lang="scss">
.footer {
  width: var(--article-toolbar-width);
  @apply bg-primary;

  .bottom {
    @apply relative w-full box-border rounded-lg bg-second shadow-lg z-2;
    padding: 0.5rem var(--space);
    border: 1px solid var(--color-item-border);

    .stat {
      margin-top: 0.5rem;
      display: flex;
      justify-content: space-around;
      gap: var(--stat-gap);

      .row {
        @apply flex flex-col items-center gap-1 text-gray-500;

        .num,
        .name {
          word-break: keep-all;
          padding: 0 0.4rem;
        }

        .line {
          height: 1px;
          width: 100%;
          background: var(--color-sub-gray);
        }
      }
    }
  }

  .arrow {
    cursor: pointer;
    transition: all 0.5s;
    transform: rotate(-90deg);
    padding: 0.5rem;
    font-size: 1.2rem;

    &.down {
      transform: rotate(90deg);
    }
  }
}

@media (max-width: 768px) {
  // 优化练习区域布局
  .practice-article {
    padding-top: 3rem; // 为固定标题留出空间
  }

  // 优化标题区域
  .typing-article {
    header {
      position: fixed;
      top: 4.5rem; // 避开顶部导航栏
      left: 0;
      right: 0;
      z-index: 100;
      background: var(--bg-color);
      padding: 0.5rem 1rem;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      margin-bottom: 0;

      .title {
        font-size: 1rem;
        line-height: 1.4;
        word-break: break-word;

        .font-family {
          font-size: 0.9rem;
        }
      }

      .titleTranslate {
        font-size: 0.8rem;
        margin-top: 0.2rem;
        opacity: 0.8;
      }
    }

    .article-content {
      margin-top: 2rem; // 为固定标题留出空间
    }
  }

  .footer {
    width: 100%;

    .bottom {
      padding: 0.3rem 0.5rem 0.5rem 0.5rem;
      border-radius: 0.4rem;

      .stat {
        margin-top: 0.3rem;
        gap: 0.2rem;
        flex-direction: row;
        overflow-x: auto;

        .row {
          min-width: 3.5rem;
          gap: 0.2rem;

          .num {
            font-size: 0.8rem;
            font-weight: bold;
          }

          .name {
            font-size: 0.7rem;
          }
        }
      }

      .flex.flex-col.items-center.justify-center.gap-1 {
        .flex.gap-2.center {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.4rem;

          .base-icon {
            padding: 0.3rem;
            font-size: 1rem;
            min-height: 44px;
            min-width: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }
      }
    }

    .arrow {
      font-size: 1rem;
      padding: 0.3rem;
    }
  }
}
</style>

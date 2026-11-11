<script setup lang="ts">
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { useBaseStore } from '@/core/stores/base.ts'
import { useRouter } from 'vue-router'
import {
  BaseButton,
  BaseIcon,
  BasePage,
  Calendar,
  DeleteIcon,
  Dialog,
  OptionButton,
  PopConfirm,
  Progress,
  Switch,
  Toast,
  Tooltip,
} from '@/base'
import {
  _getAccomplishDate,
  _getDictDataByUrl,
  _nextTick,
  debounce,
  getDictDisplayName,
  getShufflePracticeWords,
  isMobile,
  loadJsLib,
  msToHourMinute,
  resourceWrap,
  type ShufflePracticeSetting,
  total,
  useNav,
} from '@/core/utils'
import type { DictResource, Statistics } from '@/core/types/types.ts'
import { onMounted, onUnmounted, watch } from 'vue'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import Book from '@/components/Book.vue'
import { getDefaultDict } from '@/core/types/func.ts'
import PracticeSettingDialog from '@/components/word/PracticeSettingDialog.vue'
import ChangeLastPracticeIndexDialog from '@/components/word/ChangeLastPracticeIndexDialog.vue'
import { useSettingStore } from '@/core/stores/setting.ts'
import { useFetch } from '@vueuse/core'
import {
  APP_NAME,
  DICT_LIST,
  LIB_JS_URL,
  Old_Host,
  Origin,
  TourConfig,
  WordPracticeModeNameMap,
  WordPracticeModeUrlMap,
} from '@/core/config/env.ts'
import PracticeWordListDialog from '@/components/word/PracticeWordListDialog.vue'
import ShufflePracticeSettingDialog from '@/components/word/ShufflePracticeSettingDialog.vue'
import { flushStatToStore } from '@/core/composables/usePracticePersistence'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { WordPracticeMode } from '@/core/types/enum.ts'
import {
  type PracticeWordCache,
  UnsupportedPracticeCacheVersionError,
  usePracticeWordPersistence,
} from '@/core/composables/practice-words/practice-word-session.ts'
import dayjs from 'dayjs'
import { getActiveCustomFlowId, getUserFlow } from '@/core/composables/practice-words/practice-flow-runtime.ts'
import { createStudyTask } from '@/core/composables/practice-words/study-task.ts'

const store = useBaseStore()
const settingStore = useSettingStore()
const wordPersistence = usePracticeWordPersistence()
const dataSync = useDataSyncPersistence()
const router = useRouter()
const { nav } = useNav()
const runtimeStore = useRuntimeStore()
let loading = $ref(true)
let isSaveData = $ref(false)
let unsupportedCacheVersion = false
let practiceCacheChecked = false

async function loadPracticeCache() {
  try {
    return await wordPersistence.load()
  } catch (error) {
    if (!(error instanceof UnsupportedPracticeCacheVersionError)) throw error
    unsupportedCacheVersion = true
    Toast.error('This practice was saved by a newer version. Update to continue.')
    return null
  }
}

const shouldShowDialogPracticeMode = [WordPracticeMode.Shuffle, WordPracticeMode.ShuffleWordsTest]

useSeoMeta({
  title: `Vocabulary and Typing Practice | ${APP_NAME}`,
  description: 'Learn vocabulary with typing, spelling, and spaced repetition across CET, GRE, and IELTS wordbooks.',
  ogTitle: `Vocabulary and Typing Practice | ${APP_NAME}`,
  ogDescription: 'Practice English vocabulary with typing and spaced repetition.',
  twitterTitle: `Vocabulary and Typing Practice | ${APP_NAME}`,
  twitterDescription: 'Practice English vocabulary with typing and spaced repetition.',
})

let practiceData = $ref<PracticeWordCache>({
  taskWords: {
    new: [],
    review: [],
  },
} as any)
let dueReviewCount = $ref(0)

function refreshStudyTask() {
  const result = createStudyTask()
  practiceData.taskWords = result.taskWords
  dueReviewCount = result.dueReviewCount
  return result
}

function toggleAutoAddRandomReview(enabled: boolean) {
  settingStore.autoAddRandomReviewWhenNoDue = enabled
  const result = refreshStudyTask()
  if (!enabled) return
  if (result.randomReviewCount > 0) {
    Toast.success(`Added ${result.randomReviewCount} random review words.`)
  } else {
    Toast.warning('No words are due. Learn some new words first.')
  }
}

const effectiveReviewRatio = $computed(() => {
  const dict = store.sdict
  const isEnd = dict.length !== 1 && dict.lastLearnIndex >= dict.length - 1
  return isEnd ? settingStore.wordReviewRatio || 1 : settingStore.wordReviewRatio
})

const reviewWordLimit = $computed(() => {
  return Math.max(0, Math.floor(store.sdict.perDayStudyNumber * effectiveReviewRatio))
})

const reviewWordTip = $computed(() => {
  const dailyGoal = store.sdict.perDayStudyNumber
  const actualCount = practiceData?.taskWords?.review?.length ?? 0
  const rule = `Review uses words due by today, excluding new, mastered, and ignored words. Your daily goal of ${dailyGoal} × ${effectiveReviewRatio} caps this session at ${reviewWordLimit} words.\n`

  if (isSaveData) {
    return `${rule}This saved session contains ${actualCount} review words based on what was due when it was created.`
  }
  if (reviewWordLimit === 0) {
    return `${rule}The review limit is zero.`
  }
  if (dueReviewCount === 0 && actualCount > 0) {
    return `${rule}No words were due, so ${actualCount} previously learned words were selected at random.`
  }
  if (actualCount < reviewWordLimit) {
    return `${rule}Only ${actualCount} eligible words are due for review.`
  }
  return `${rule}This session contains the maximum of ${actualCount} review words.`
})

async function resetCacheData() {
  if (unsupportedCacheVersion) return
  isSaveData && flushStatToStore(practiceData.statStoreData)
  isSaveData = false
  practiceData.practiceData = null
  practiceData.statStoreData = null
  practiceData.sessionSnapshot = undefined
  await wordPersistence.clear()
}

// runtimeStore.globalLoading练习界面，退出时会调用一个保存，可能会卡住。当调用完成再init
//  immediate: true 比 onUmMounted 先执行，只能延时执行
watch(
  [() => store.load, () => runtimeStore.globalLoading],
  debounce(([a, b]) => {
    if (a && !b) {
      init()
      _nextTick(async () => {
        const Shepherd = await loadJsLib('Shepherd', LIB_JS_URL.SHEPHERD)
        const tour = new Shepherd.Tour(TourConfig)
        tour.on('cancel', () => {
          localStorage.setItem('tour-guide', '1')
        })
        tour.addStep({
          id: 'step1',
          text: 'Choose a wordbook to begin.',
          attachTo: {
            element: '#step1',
            on: 'bottom',
          },
          buttons: [
            {
              text: `Next (1/${TourConfig.total})`,
              action() {
                tour.next()
                router.push('/dict-list')
              },
            },
          ],
        })
        const r = localStorage.getItem('tour-guide')
        if (settingStore.first && !r && !isMobile()) tour.start()
      }, 500)
    }
  }),
  { immediate: true }
)

async function onvisibilitychange() {
  if (!document.hidden) {
    //当页面可见时，检查是否需要从缓存恢复
    const d = await loadPracticeCache()
    if (d) {
      practiceData = d
      isSaveData = true
    }
  }
}

async function init() {
  document.removeEventListener('visibilitychange', onvisibilitychange)
  document.addEventListener('visibilitychange', onvisibilitychange)

  let studyIndex = store.word.studyIndex
  if (studyIndex >= 3) {
    if (!store.sdict.custom && !store.sdict.words.length) {
      let dictList = await fetch(resourceWrap(DICT_LIST.WORD.ALL)).then(r => r.json())
      let dict = await _getDictDataByUrl(store.sdict)
      let r = dictList.find(v => [v.enName, v.id].includes(store.sdict.id))
      if (r) {
        store.word.bookList[studyIndex].words = dict.words
        store.word.bookList[studyIndex].id = r.id
        store.word.bookList[studyIndex].enName = r.enName
        store.word.bookList[studyIndex].cover = r.cover
        store.word.bookList[studyIndex].category = r.category
        store.word.bookList[studyIndex].tags = r.tags
        store.word.bookList[studyIndex].url = r.url
        store.word.bookList[studyIndex].description = r.description
        store.word.bookList[studyIndex].name = r.name
      } else {
        store.word.bookList[studyIndex] = dict
      }
      store.word.bookList[studyIndex].length = dict.words.length
      let s = store.word.bookList[studyIndex]
      if (s.lastLearnIndex > s.length) {
        store.word.bookList[studyIndex].lastLearnIndex = s.length
        store.word.bookList[studyIndex].complete = true
        await resetCacheData()
      }
    }
  }

  if (!practiceData?.taskWords.new.length && store.sdict.words.length) {
    const d = await loadPracticeCache()
    practiceCacheChecked = true
    if (d) {
      practiceData = d
      isSaveData = true
    } else if (!unsupportedCacheVersion) {
      refreshStudyTask()
    }
  }
  loading = false
}

// 同步可在当前页面加载完成后替换词书和进度。只重算新任务，保留未完成练习。
watch([
  () => store.sdict.id,
  () => store.sdict.lastLearnIndex,
  () => store.sdict.perDayStudyNumber,
  () => store.sdict.complete,
  () => store.sdict.words,
  () => store.sdict.words.length,
  () => store.getIgnoreWordsSet(),
  () => Object.entries(store.fsrsData).map(([word, card]) => [word, card.due]),
], debounce(async () => {
  if (!store.load || loading || runtimeStore.globalLoading || isSaveData || unsupportedCacheVersion) return
  if (!practiceCacheChecked && store.sdict.words.length) {
    loading = true
    try { await init() } finally { loading = false }
    return
  }
  refreshStudyTask()
}, 200))

async function startPractice(practiceMode: WordPracticeMode, resetCache: boolean = false): Promise<void> {
  if (unsupportedCacheVersion) {
    Toast.error('This version cannot read the saved practice. Update to continue.')
    return
  }
  if (practiceMode === WordPracticeMode.Custom) {
    const activeCustomFlowId = getActiveCustomFlowId()
    if (!activeCustomFlowId || !getUserFlow(activeCustomFlowId)) {
      Toast.warning('Create and activate a custom flow first.')
      router.push('/practice-flow-editor')
      return
    }
  }
  if (resetCache) await resetCacheData()

  if (shouldShowDialogPracticeMode.includes(practiceMode) && !isSaveData) {
    editingWordPracticeMode = practiceMode
    showShufflePracticeSettingDialog = true
    return
  }

  if (store.sdict.id) {
    if (!store.sdict.words.length) {
      Toast.warning('There are no words to study.')
      return
    }

    settingStore.wordPracticeMode = practiceMode

    window.umami?.track('startStudyWord', {
      name: store.sdict.name,
      index: String(store.sdict.lastLearnIndex),
      perDayStudyNumber: String(store.sdict.perDayStudyNumber),
      custom: store.sdict.custom,
      complete: store.sdict.complete,
      wordPracticeMode: String(settingStore.wordPracticeMode),
    })
    //把是否是第一次设置为false
    if (settingStore.first) settingStore.first = false
    nav(WordPracticeModeUrlMap[practiceMode] + '/' + store.sdict.id, {}, practiceData)
  } else {
    window.umami?.track('no-dict')
    Toast.warning('Choose a wordbook first.')
  }
}

function freePractice() {
  startPractice(WordPracticeMode.Free, settingStore.wordPracticeMode !== WordPracticeMode.Free)
}

function systemPractice() {
  const currentMode = settingStore.wordPracticeMode
  const isFree = currentMode === WordPracticeMode.Free
  startPractice(isFree ? WordPracticeMode.System : currentMode, isFree)
}

let editingWordPracticeMode = $ref(0)

let showPracticeSettingDialog = $ref(false)
let showShufflePracticeSettingDialog = $ref(false)
let showChangeLastPracticeIndexDialog = $ref(false)
let showPracticeWordListDialog = $ref(false)

type StudyDayRow = Statistics & { dictName: string }

let showStudyDayDialog = $ref(false)
let selectedStudyDateKey = $ref('')
let studyDayRecords = $ref<StudyDayRow[]>([])

const allWordStatistics = $computed(() => store.word.bookList.flatMap(book => book.statistics ?? []))

const cacheSpendMs = $computed(() => practiceData.statStoreData?.spend ?? 0)

const todayDateKey = $computed(() => dayjs().format('YYYY-MM-DD'))

/**
 * 缓存记录中每一天对应的学习毫秒数 Map<'YYYY-MM-DD', spendMs>
 * 有 segments 时按片段精确分组，否则退回到 startDate + spend 整体归一天
 */
const cacheDaySpendMap = $computed((): Map<string, number> => {
  const st = practiceData.statStoreData
  const map = new Map<string, number>()
  if (!st?.spend) return map
  if (Array.isArray(st.segments) && st.segments.length > 0) {
    for (const [segStart, segEnd] of st.segments) {
      const key = dayjs(segStart).format('YYYY-MM-DD')
      map.set(key, (map.get(key) ?? 0) + (segEnd - segStart))
    }
  } else {
    // 老数据 / 无 segments：全部归到 startDate 那天
    map.set(dayjs(st.startDate).format('YYYY-MM-DD'), st.spend)
  }
  return map
})

const todayCacheMs = $computed(() => cacheDaySpendMap.get(todayDateKey) ?? 0)

const calendarHighlightDates = $computed(() => {
  const set = new Set<string>()
  for (const s of allWordStatistics) {
    set.add(dayjs(s.startDate).format('YYYY-MM-DD'))
  }
  // 把缓存记录中所有出现过的天都高亮（支持跨天）
  for (const key of cacheDaySpendMap.keys()) {
    set.add(key)
  }
  return [...set]
})

/** 已落库统计总毫秒（全 bookList） */
const persistedTotalMs = $computed(() => total(allWordStatistics, 'spend'))

const totalSpend = $computed(() => {
  const sum = persistedTotalMs + cacheSpendMs
  if (!sum) return 0
  return msToHourMinute(sum)
})

const todayTotalSpend = $computed(() => {
  const todayPersistedMs = total(
    allWordStatistics.filter(v => dayjs(v.startDate).isSame(dayjs(), 'day')),
    'spend'
  )
  const sum = todayPersistedMs + todayCacheMs
  if (!sum) return 0
  return msToHourMinute(sum)
})

const totalDay = $computed(() => {
  const set = new Set(allWordStatistics.map(v => dayjs(v.startDate).format('YYYY-MM-DD')))
  // 把缓存记录中所有出现过的天都计入（支持跨天）
  for (const key of cacheDaySpendMap.keys()) {
    set.add(key)
  }
  return set.size
})

const studyDayDialogTitle = $computed(() =>
  selectedStudyDateKey ? `${dayjs(selectedStudyDateKey).format('MMM D, YYYY')} study history` : ''
)

function isStudyDayKeyToday(dateKey: string) {
  return dateKey === dayjs().format('YYYY-MM-DD')
}

function onSelectCalendarDate(dateKey: string) {
  selectedStudyDateKey = dateKey
  const rows: StudyDayRow[] = []
  for (const book of store.word.bookList) {
    for (const stat of book.statistics ?? []) {
      if (dayjs(stat.startDate).format('YYYY-MM-DD') === dateKey) {
        rows.push({ ...stat, dictName: book.name })
      }
    }
  }
  const st = practiceData.statStoreData
  // 缓存记录跨天时，只要该天在 cacheDaySpendMap 中有记录就展示
  if (st?.spend && cacheDaySpendMap.has(dateKey)) {
    const daySpend = cacheDaySpendMap.get(dateKey)!
    const cacheKeys = [...cacheDaySpendMap.keys()]
    const keyIdx = cacheKeys.indexOf(dateKey)
    const isMultiDay = cacheKeys.length > 1
    // 推算该天在整次练习中的角色（练习未结束，最后一天标为"学习中"而非"学习结束"）
    let sessionRole: StudyDayRow['sessionRole']
    if (!isMultiDay) {
      sessionRole = 'single'
    } else if (keyIdx === 0) {
      sessionRole = 'start'
    } else if (keyIdx === cacheKeys.length - 1) {
      sessionRole = 'middle' // 最后一天仍在进行中，用 middle 表示
    } else {
      sessionRole = 'middle'
    }
    rows.push({
      ...st,
      spend: daySpend,
      new: st.newWordNumber,
      review: st.reviewWordNumber,
      dictName: store.sdict.name,
      sessionRole,
    })
  }
  if (!rows.length) return Toast.info('No study records.')
  studyDayRecords = rows
  showStudyDayDialog = true
}

async function goDictDetail(val: DictResource) {
  if (!val.id) return nav('dict-list')
  runtimeStore.editDict = getDefaultDict(val)
  nav('/dict', {})
}

let isManageDict = $ref(false)
let selectIds = $ref([])
let draggedBookId = $ref<DictResource['id'] | null>(null)
let dropBookId = $ref<DictResource['id'] | null>(null)
let savingBookOrder = $ref(false)

/** 拖动只在普通词书之间生效，内置的三个词单保留原位。 */
function startBookDrag(event: DragEvent, id: DictResource['id'], index: number) {
  if (index < 3 || isManageDict || savingBookOrder || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(id))
  draggedBookId = id
}

/** 只接受本站已开始的词书拖动，并高亮可放置的目标。 */
function dragOverBook(event: DragEvent, id: DictResource['id'], index: number) {
  if (index < 3 || draggedBookId === null || draggedBookId === id || isManageDict || savingBookOrder) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropBookId = id
}

/** 结束拖动并清除目标提示。 */
function clearBookDrag() {
  draggedBookId = dropBookId = null
}

/** 按落点重排并保存，使用原词书身份重新计算正在学习的下标。 */
async function dropBook(event: DragEvent, id: DictResource['id']) {
  if (draggedBookId === null || isManageDict || savingBookOrder) return
  event.preventDefault()
  const previous = store.word.bookList
  const studyIndex = store.word.studyIndex
  const activeBookId = previous[studyIndex]?.id
  const from = previous.findIndex(book => book.id === draggedBookId)
  const to = previous.findIndex(book => book.id === id)
  clearBookDrag()
  if (from < 3 || to < 3 || from === to) return
  const books = [...previous]
  const [moved] = books.splice(from, 1)
  books.splice(to, 0, moved)
  savingBookOrder = true
  store.$patch(state => {
    state.word.bookList = books
    state.word.studyIndex = books.findIndex(book => book.id === activeBookId)
  })
  const applied = store.word.bookList
  try {
    await dataSync.saveDictState(store.$state, { canSyncRemote: false })
    Toast.success('Wordbook order saved.')
  } catch {
    if (store.word.bookList === applied) {
      store.$patch(state => {
        state.word.bookList = previous
        state.word.studyIndex = studyIndex
      })
    }
    Toast.warning('Could not save wordbook order. Try again.')
  } finally {
    savingBookOrder = false
  }
}

async function handleBatchDel() {
  selectIds.forEach(id => {
    let r = store.word.bookList.findIndex(v => v.id === id)
    if (r !== -1) {
      if (store.word.studyIndex === r) {
        store.word.studyIndex = -1
      }
      if (store.word.studyIndex > r) {
        store.word.studyIndex--
      }
      store.word.bookList.splice(r, 1)
    }
  })
  selectIds = []
  Toast.success('Deleted.')
}

function toggleSelect(item) {
  let rIndex = selectIds.findIndex(v => v === item.id)
  if (rIndex > -1) {
    selectIds.splice(rIndex, 1)
  } else {
    selectIds.push(item.id)
  }
}

const progressTextLeft = $computed(() => {
  if (store.sdict.complete) return 'Completed. Ready for review.'
  return 'Progress: ' + store.currentStudyProgress + '%'
})

function check(cb: Function) {
  if (!store.sdict.id) {
    Toast.warning('Choose a wordbook first.')
  } else {
    runtimeStore.editDict = getDefaultDict(store.sdict)
    cb()
  }
}

async function savePracticeSetting() {
  await resetCacheData()
  await store.changeDict(runtimeStore.editDict, true)
  refreshStudyTask()
  Toast.success('Changes saved.')
}

async function onShufflePracticeSettingOk(setting: ShufflePracticeSetting) {
  await dataSync.saveDictState()
  await resetCacheData()
  settingStore.wordPracticeMode = editingWordPracticeMode

  window.umami?.track('startStudyWord', {
    name: store.sdict.name,
    index: store.sdict.lastLearnIndex,
    perDayStudyNumber: store.sdict.perDayStudyNumber,
    custom: store.sdict.custom,
    complete: store.sdict.complete,
    wordPracticeMode: settingStore.wordPracticeMode,
  })

  const result = getShufflePracticeWords(store.sdict.words, setting, store.getIgnoreWordsSet())
  practiceData.taskWords.review = result.words
  nav(
    WordPracticeModeUrlMap[editingWordPracticeMode] + '/' + store.sdict.id,
    {},
    {
      ...practiceData,
      total: result.words.length,
      shuffleRange: result.range,
    }
  )
}

async function saveLastPracticeIndex(e) {
  runtimeStore.editDict.lastLearnIndex = e
  showChangeLastPracticeIndexDialog = false
  await resetCacheData()
  await store.changeDict(runtimeStore.editDict, true)
  refreshStudyTask()
  Toast.success('Changes saved.')
}

const { data: recommendDictList, isFetching } = useFetch(resourceWrap(DICT_LIST.WORD.RECOMMENDED)).json()

const systemPracticeText = $computed(() => {
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) {
    return 'Start learning'
  } else if (settingStore.wordPracticeMode === WordPracticeMode.Custom) {
    return isSaveData ? 'Resume custom practice' : 'Start custom practice'
  } else {
    return isSaveData
      ? 'Resume ' + WordPracticeModeNameMap[settingStore.wordPracticeMode]
      : 'Start ' + WordPracticeModeNameMap[settingStore.wordPracticeMode]
  }
})

let isOldHost = $ref(false)
onMounted(() => {
  isOldHost = window.location.host === Old_Host
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onvisibilitychange)
})
</script>

<template>
  <BasePage>
    <div class="my-100 text-4xl font-bold text-red" v-if="isOldHost">
      A new address is available.
      <a class="mr-4" :href="`${Origin}/words?from_old_site=1`">{{ Origin }}</a
      >The 2study.top address will be retired on July 3.
    </div>

    <section v-if="isAndroidApp()" class="android-learning">
      <header class="android-learning-heading">
        <h1>Today's study</h1>
        <button v-if="store.sdict.id" type="button" class="android-text-action" @click="showPracticeWordListDialog = true">Word list</button>
      </header>
      <article class="android-learning-card">
        <div class="android-book-toolbar">
          <span>Current wordbook</span>
          <a href="#android-word-books" class="android-text-action">My wordbooks</a>
        </div>
        <template v-if="store.sdict.id">
          <button type="button" class="android-book-name" @click="goDictDetail(store.sdict)">{{ getDictDisplayName(store.sdict) }}</button>
          <div class="android-progress-label">
            <strong>{{ store.currentStudyProgress }}<small>%</small></strong>
            <span>{{ store.sdict.lastLearnIndex }} / {{ store.sdict.length }} words</span>
          </div>
          <progress :value="store.currentStudyProgress" max="100" aria-label="Wordbook progress"></progress>
          <p v-if="store.sdict.complete" class="android-completed">{{ progressTextLeft }}</p>
          <div class="android-learning-actions">
            <button type="button" class="android-primary-action" :disabled="loading" @click="systemPractice">{{ systemPracticeText }}</button>
            <NuxtLink :to="'/practice-screen/' + encodeURIComponent(String(store.sdict.id))" class="android-secondary-action">Screen entire book</NuxtLink>
          </div>
        </template>
        <p v-else class="android-empty-book">Open a wordbook below and tap Learn.</p>
      </article>

      <div v-if="store.sdict.id" class="android-task-strip">
        <div><strong>{{ practiceData?.taskWords?.new?.length ?? 0 }}</strong><span>New words</span></div>
        <div><strong>{{ practiceData?.taskWords?.review?.length ?? 0 }}</strong><span>Due for review</span></div>
        <PopConfirm :disabled="!isSaveData" title="Changing this setting will regenerate your unfinished session." @confirm="check(() => (showPracticeSettingDialog = true))">
          <button type="button" class="android-text-action">Daily goal {{ store.sdict.perDayStudyNumber }}</button>
        </PopConfirm>
      </div>
      <details v-if="store.sdict.id" class="android-home-details">
        <summary>More practice and settings</summary>
        <div class="android-details-actions">
          <button type="button" @click="freePractice()">Free practice</button>
          <button type="button" :disabled="!practiceData?.taskWords?.review?.length" @click="startPractice(WordPracticeMode.Review, true)">Review</button>
          <button type="button" :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete" @click="startPractice(WordPracticeMode.Shuffle, true)">Random review</button>
          <button type="button" :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete" @click="startPractice(WordPracticeMode.ReviewWordsTest, true)">Word test</button>
          <button type="button" :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete" @click="startPractice(WordPracticeMode.ShuffleWordsTest, true)">Random word test</button>
          <button type="button" @click="startPractice(WordPracticeMode.System, true)">Smart learning</button>
          <PopConfirm :disabled="!isSaveData" title="Changing this setting will regenerate your unfinished session." @confirm="check(() => (showChangeLastPracticeIndexDialog = true))">
            <button type="button">Edit book progress</button>
          </PopConfirm>
          <label v-if="!isSaveData && dueReviewCount === 0" class="flex items-center gap-2 py-2">
            Add random review <Switch :model-value="settingStore.autoAddRandomReviewWhenNoDue" @change="toggleAutoAddRandomReview" />
          </label>
        </div>
      </details>
    </section>

    <div v-else class="card flex flex-col md:flex-row gap-4">
      <div class="flex-1 flex flex-col justify-between">
        <div class="flex gap-3">
          <div class="p-1 center rounded-full bg-white">
            <IconFluentBookNumber20Filled class="text-xl color-link" />
          </div>
          <div @click="goDictDetail(store.sdict)" class="text-2xl font-bold cursor-pointer">
            {{ getDictDisplayName(store.sdict) || $t('no_dict_selected') }}
          </div>
        </div>

        <template v-if="store.sdict.id">
          <div class="mt-4 space-y-2">
            <div class="text-sm flex justify-between">
              <span v-opacity="store.sdict.id && store.sdict.lastLearnIndex < store.sdict.length">
                {{ $t('estimated_completion') }}：{{
                  _getAccomplishDate(
                    store.sdict.words.length - store.sdict.lastLearnIndex,
                    store.sdict.perDayStudyNumber
                  )
                }}
              </span>
            </div>
            <Progress size="large" :percentage="store.currentStudyProgress" :show-text="false"></Progress>

            <div class="text-sm flex justify-between">
              <span>{{ progressTextLeft }}</span>
              <span> {{ store.sdict?.lastLearnIndex }} / {{ store.sdict.length }} words</span>
            </div>
          </div>
          <div class="flex items-center mt-4 gap-4">
            <BaseButton type="info" size="small" @click="router.push('/dict-list')">
              <div class="center gap-1">
                <IconFluentArrowSwap20Regular />
                <span>{{ $t('select_dict') }}</span>
              </div>
            </BaseButton>
            <PopConfirm
              :disabled="!isSaveData"
              title="Changing this setting will regenerate your unfinished session. Continue?"
              @confirm="check(() => (showChangeLastPracticeIndexDialog = true))"
            >
              <BaseButton type="info" size="small" v-if="store.sdict.id">
                <div class="center gap-1">
                  <IconFluentSlideTextTitleEdit20Regular />
                  <span>{{ $t('change_progress') }}</span>
                </div>
              </BaseButton>
            </PopConfirm>
          </div>
        </template>

        <div class="flex items-center gap-4 mt-2 flex-1" v-else>
          <div class="title">{{ $t('select_dict_to_start') }}</div>
          <BaseButton id="step1" type="primary" size="large" @click="router.push('/dict-list')">
            <div class="center gap-1">
              <IconFluentAdd16Regular />
              <span>{{ $t('select_dict') }}</span>
            </div>
          </BaseButton>
        </div>
      </div>
      <div class="flex-1 mt-4 md:mt-0" :class="!store.sdict.id && 'opacity-30 cursor-not-allowed'">
        <div class="flex justify-between android-task-heading">
          <div class="flex items-center gap-2">
            <div class="p-2 center rounded-full bg-white">
              <IconFluentStar20Filled class="text-lg color-amber" />
            </div>
            <div class="text-xl font-bold">
              {{ isSaveData ? $t('last_task') : $t('today_task') }}
            </div>
            <span class="color-link cursor-pointer" v-if="store.sdict.id" @click="showPracticeWordListDialog = true">{{
              $t('word_list')
            }}</span>
            <!--            <span class="color-link cursor-pointer ml-2" @click="nav('/practice-flow-editor', {})">流程编排</span>-->
          </div>
          <div class="flex gap-1 items-center" v-if="store.sdict.id">
            {{ $t('daily_goal') }}
            <div style="color: #ac6ed1" class="bg-third px-2 h-10 flex center text-2xl rounded">
              {{ store.sdict.id ? store.sdict.perDayStudyNumber : 0 }}
            </div>
            {{ $t('words_count') }}
            <PopConfirm
              :disabled="!isSaveData"
              title="Changing this setting will regenerate your unfinished session. Continue?"
              @confirm="check(() => (showPracticeSettingDialog = true))"
            >
              <BaseButton type="info" size="small">{{ $t('change') }}</BaseButton>
            </PopConfirm>
          </div>
        </div>
        <div class="flex mt-4 justify-between">
          <div class="stat">
            <div class="num">{{ practiceData?.taskWords?.new?.length }}</div>
            <div class="txt">{{ $t('new_words') }}</div>
          </div>
          <div class="stat">
            <div class="num flex center">
              {{ practiceData?.taskWords?.review?.length }}
              <span class="text-base color-reverse-black" v-if="!practiceData?.taskWords?.review?.length"
                >(none due)</span
              >
            </div>
            <div class="txt flex center gap-1">
              <span>{{ $t('review') }}</span>
              <Tooltip>
                <IconFluentQuestionCircle20Regular class="mt-.5" width="18" />
                <template #reference>
                  <div class="whitespace-pre-wrap">{{ reviewWordTip }}</div>
                </template>
              </Tooltip>
            </div>
            <div class="center gap-2 mt-1 text-sm" v-if="!isSaveData && dueReviewCount === 0">
              <span>Add random review</span>
              <Switch :model-value="settingStore.autoAddRandomReviewWhenNoDue" @change="toggleAutoAddRandomReview" />
            </div>
          </div>
        </div>
        <div class="flex items-end mt-4 gap-4 btn-no-margin">
          <OptionButton
            :class="settingStore.wordPracticeMode !== WordPracticeMode.Free ? 'flex-1 orange-btn' : 'primary-btn'"
          >
            <BaseButton
              size="large"
              :type="settingStore.wordPracticeMode !== WordPracticeMode.Free ? 'orange' : 'primary'"
              :disabled="!store.sdict.id"
              :loading="loading"
              @click="systemPractice"
            >
              <div class="flex items-center gap-2">
                <span class="line-height-[2]">{{ systemPracticeText }}</span>
                <IconFluentArrowCircleRight16Regular class="text-xl" />
              </div>
            </BaseButton>
            <template #options>
              <BaseButton
                v-if="!isAndroidApp()"
                class="w-full"
                :disabled="!store.sdict.id"
                @click="router.push('/practice-screen/' + encodeURIComponent(String(store.sdict.id)))"
              >
                Screen entire book
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="
                  settingStore.wordPracticeMode !== WordPracticeMode.System &&
                  settingStore.wordPracticeMode !== WordPracticeMode.Free
                "
                @click="startPractice(WordPracticeMode.System, true)"
              >
                {{ $t('smart_learning') }}
              </BaseButton>

              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.Review"
                :disabled="!practiceData?.taskWords?.review?.length"
                @click="startPractice(WordPracticeMode.Review, true)"
              >
                {{ $t('review') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.Shuffle"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.Shuffle, true)"
              >
                {{ $t('random_review') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.ReviewWordsTest"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.ReviewWordsTest, true)"
              >
                {{ $t('words') }}{{ $t('test') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.ShuffleWordsTest"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.ShuffleWordsTest, true)"
              >
                {{ $t('random_words_test') }}
              </BaseButton>
            </template>
          </OptionButton>

          <BaseButton
            :class="settingStore.wordPracticeMode === WordPracticeMode.Free ? 'flex-1' : ''"
            :type="settingStore.wordPracticeMode === WordPracticeMode.Free ? 'orange' : 'primary'"
            size="large"
            :loading="loading"
            @click="freePractice()"
          >
            <div class="flex items-center gap-2">
              <span class="line-height-[2]">
                {{
                  settingStore.wordPracticeMode === WordPracticeMode.Free && isSaveData
                    ? $t('continue_free_practice')
                    : $t('free_practice')
                }}
              </span>
              <IconStreamlineColorPenDrawFlat class="text-xl" />
            </div>
          </BaseButton>
        </div>
      </div>
    </div>

    <details v-if="isAndroidApp()" class="android-home-details android-history">
      <summary>Study history <span>Today {{ todayTotalSpend }}</span></summary>
      <div class="android-history-body">
        <p>{{ totalDay }} study days · {{ totalSpend }} total</p>
        <Calendar :highlighted-dates="calendarHighlightDates" @select-date="onSelectCalendarDate" :weekHeaderTitle="$t('this_week_record')" />
      </div>
    </details>
    <div v-else class="card flex flex-col md:flex-row gap-4 xl:gap-20 p-4 md:p-6">
      <div class="flex-1 flex flex-col gap-3 min-w-0">
        <div class="title">Statistics</div>
        <div class="flex gap-3 items-center w-full">
          <div class="stat2">
            <div class="num">{{ todayTotalSpend }}</div>
            <div class="txt">{{ $t('today_study_time') }}</div>
          </div>
          <div class="stat2">
            <div class="num">{{ totalDay }}</div>
            <div class="txt">{{ $t('total_study_days') }}</div>
          </div>
          <div class="stat2">
            <div class="num">{{ totalSpend }}</div>
            <div class="txt">{{ $t('total_study_time') }}</div>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center">
        <Calendar
          :highlighted-dates="calendarHighlightDates"
          @select-date="onSelectCalendarDate"
          :weekHeaderTitle="$t('this_week_record')"
        >
        </Calendar>
      </div>
    </div>

    <div :id="isAndroidApp() ? 'android-word-books' : undefined" class="card flex flex-col" :class="{ 'android-word-books': isAndroidApp() }">
      <div class="flex justify-between">
        <div class="title">{{ $t('my_dictionaries') }}</div>
        <div class="flex gap-4 items-center">
          <PopConfirm title="Delete the selected wordbooks?" @confirm="handleBatchDel" v-if="selectIds.length">
            <BaseIcon class="del" :title="$t('delete')">
              <DeleteIcon />
            </BaseIcon>
          </PopConfirm>

          <div
            class="color-link cursor-pointer"
            v-if="store.word.bookList.length > 3"
            @click="
              () => {
                isManageDict = !isManageDict
                selectIds = []
              }
            "
          >
            {{ isManageDict ? $t('cancel') : $t('manage_dict') }}
          </div>
          <div v-if="!isAndroidApp()" class="color-link cursor-pointer" @click="nav('/dict', { isAdd: true })">
            {{ $t('create_personal_dict') }}
          </div>
          <NuxtLink v-if="!isAndroidApp()" class="color-link" to="/import">Import a wordbook</NuxtLink>
        </div>
      </div>
      <p v-if="!isAndroidApp() && store.word.bookList.length > 4 && !isManageDict" class="mt-2 text-sm">Drag wordbooks to reorder them.</p>
      <div class="flex gap-4 flex-wrap mt-4" :class="{ 'android-list': isAndroidApp() }">
        <div
          v-for="(item, j) in store.word.bookList"
          :key="item.id"
          :draggable="!isAndroidApp() && j >= 3 && !isManageDict && !savingBookOrder"
          :class="{ 'opacity-50': draggedBookId === item.id, 'ring-2 ring-blue-500 rounded': dropBookId === item.id }"
          @dragstart="startBookDrag($event, item.id, j)"
          @dragover="dragOverBook($event, item.id, j)"
          @drop="dropBook($event, item.id)"
          @dragend="clearBookDrag"
        >
          <Book
            :is-add="false"
            :compact="isAndroidApp()"
            quantifier=" words"
            :item="item"
            :checked="selectIds.includes(item.id)"
            @check="() => toggleSelect(item)"
            :show-checkbox="isManageDict && j >= 3"
            @click="goDictDetail(item)"
          />
        </div>
        <Book v-if="!isAndroidApp()" :is-add="true" @click="router.push('/dict-list')" />
      </div>
    </div>

    <div class="card flex flex-col overflow-hidden" v-loading="isFetching">
      <div class="flex justify-between">
        <div class="title">{{ $t('recommend') }}</div>
        <div class="flex gap-4 items-center">
          <div class="color-link cursor-pointer" @click="router.push('/dict-list')">{{ $t('more') }}</div>
        </div>
      </div>

      <div class="flex gap-4 flex-wrap mt-4 min-h-50">
        <Book
          :is-add="false"
          quantifier=" words"
          :item="item as any"
          v-for="(item, j) in recommendDictList"
          @click="goDictDetail(item as any)"
        />
      </div>
    </div>
  </BasePage>

  <PracticeSettingDialog
    :show-left-option="false"
    v-model="showPracticeSettingDialog"
    :onConfirm="savePracticeSetting"
  />

  <ChangeLastPracticeIndexDialog v-model="showChangeLastPracticeIndexDialog" @ok="saveLastPracticeIndex" />

  <PracticeWordListDialog :data="practiceData?.taskWords" v-model="showPracticeWordListDialog" />

  <ShufflePracticeSettingDialog
    v-model="showShufflePracticeSettingDialog"
    :onConfirm="onShufflePracticeSettingOk"
    :wordPracticeMode="editingWordPracticeMode"
  />

  <Dialog v-model="showStudyDayDialog" :title="studyDayDialogTitle" :footer="false" :padding="true">
    <div
      v-if="!studyDayRecords.length && !(isStudyDayKeyToday(selectedStudyDateKey) && todayCacheMs > 0)"
      class="text-gray-500 py-6 text-center"
    >
      No study records for this day.
    </div>
    <ul v-if="studyDayRecords.length" class="study-day-list max-h-70vh overflow-y-auto space-y-3">
      <li v-for="(row, idx) in studyDayRecords" :key="idx" class="border-b border-gray-200 pb-3 last:border-0">
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ row.dictName }}</span>
          <span
            v-if="row.sessionRole && row.sessionRole !== 'single'"
            class="text-xs px-1.5 py-0.5 rounded-full"
            :class="{
              'bg-green-100 text-green-700': row.sessionRole === 'start',
              'bg-blue-100 text-blue-700': row.sessionRole === 'middle',
              'bg-orange-100 text-orange-700': row.sessionRole === 'end',
            }"
          >
            {{ { start: 'Started', middle: 'In progress', end: 'Finished' }[row.sessionRole] }}
          </span>
        </div>
        <div class="text-sm text-gray-600 mt-1">
          Duration {{ msToHourMinute(row.spend, true) }} · New {{ row.new }} · Reviewed {{ row.review }} · Errors {{ row.wrong }}
          <template v-if="row.total"> · {{ row.total }} words</template>
        </div>
      </li>
    </ul>
  </Dialog>
</template>

<style scoped lang="scss">
.android-learning { padding: 20px 20px 6px; max-width: 650px; margin: auto; color: var(--android-text); }
.android-learning-heading, .android-book-toolbar, .android-progress-label { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.android-learning-heading { margin-bottom: 17px; }
.android-learning-heading h1 { margin: 0; font-size: 32px; font-weight: 700; line-height: 1.17; letter-spacing: -.045em; }
.android-learning-card { padding: 18px; border: 1px solid var(--android-line); border-radius: 22px; background: var(--android-surface); }
.android-book-toolbar { color: var(--android-muted); font-size: 13px; font-weight: 600; }
.android-text-action { color: var(--android-accent); font-size: 14px; min-height: 44px; display: inline-flex; align-items: center; text-align: end; }
.android-book-name { display: block; text-align: start; font-size: clamp(21px, 6vw, 27px); font-weight: 650; line-height: 1.22; overflow-wrap: anywhere; }
.android-progress-label { align-items: baseline; margin: 16px 0 6px; }
.android-progress-label strong { font-size: 32px; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.05em; }
.android-progress-label small { font-size: 17px; margin-left: 2px; }
.android-progress-label span, .android-completed, .android-empty-book { color: var(--android-muted); font-size: 13px; }
.android-completed, .android-empty-book { margin-top: 10px; }
.android-learning-card progress { display: block; appearance: none; width: 100%; height: 6px; border: 0; border-radius: 6px; overflow: hidden; }
.android-learning-card progress::-webkit-progress-bar { background: var(--android-line); }
.android-learning-card progress::-webkit-progress-value { background: var(--android-accent); border-radius: 6px; }
.android-learning-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }
.android-primary-action, .android-secondary-action { display: grid; place-items: center; min-height: 44px; border-radius: 24px; text-align: center; font-size: 14px; font-weight: 650; padding: 5px 8px; }
.android-primary-action { background: var(--android-accent); color: var(--android-on-accent, #fff); }
.android-primary-action:disabled, .android-details-actions button:disabled { opacity: .4; }
.android-secondary-action { background: var(--android-tint); color: var(--android-accent); }
.android-task-strip { display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; align-items: center; padding: 12px 2px 8px; }
.android-task-strip > div { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
.android-task-strip strong { font-size: 21px; font-weight: 650; }
.android-task-strip span { color: var(--android-muted); font-size: 13px; }
.android-home-details { border-bottom: 1px solid var(--android-line); }
.android-home-details summary { min-height: 44px; align-content: center; color: var(--android-text); font-size: 14px; font-weight: 600; }
.android-home-details summary span { float: right; color: var(--android-muted); font-weight: 400; }
.android-details-actions { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-bottom: 8px; }
.android-details-actions button { color: var(--android-accent); font-size: 14px; min-height: 44px; }
.android-history { margin: 0 auto 14px; width: calc(100% - 40px); max-width: 610px; }
.android-history-body { padding: 4px 0 14px; color: var(--android-muted); }
.android-word-books { scroll-margin-top: 70px; }

.stat {
  @apply w-49% box-border flex flex-col items-center justify-center rounded-xl p-2 bg-[var(--bg-history)];
  border: 1px solid gainsboro;

  .num {
    @apply color-[#409eff] text-4xl font-bold;
  }

  .txt {
    @apply color-gray-500;
  }
}

.stat2 {
  @extend .stat;
  @apply py-4 flex-1;
  width: unset;

  .num {
    @apply text-2xl break-keep;
  }
}
</style>

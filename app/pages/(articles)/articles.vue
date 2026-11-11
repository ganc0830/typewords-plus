<script setup lang="ts">
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { BaseButton, BaseIcon, BasePage, DeleteIcon, PopConfirm, Progress, Toast } from '@/base'
import Book from '@/components/Book.vue'
import ImportLocalBook from '@/components/article/ImportLocalBook.vue'
import { APP_NAME, DICT_LIST } from '@/core/config/env.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { getDefaultDict } from '@/core/types/func.ts'
import type { DictResource } from '@/core/types/types.ts'
import { _getDictDataByUrl, msToHourMinute, resourceWrap, total, useNav } from '@/core/utils'
import { useFetch } from '@vueuse/core'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isoWeek from 'dayjs/plugin/isoWeek'
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { DictType } from '@/core/types/enum.ts'
import { usePracticeArticlePersistence } from '@/core/composables/usePracticePersistence.ts'

dayjs.extend(isoWeek)
dayjs.extend(isBetween)

useSeoMeta({
  title: `English Article Practice | ${APP_NAME}`,
  description: 'Practice English reading, listening, and spelling by typing articles and listening sentence by sentence.',
  ogTitle: `English Article Practice | ${APP_NAME}`,
  ogDescription: 'Practice reading and listening with English articles.',
  twitterTitle: `English Article Practice | ${APP_NAME}`,
  twitterDescription: 'Practice reading and listening with English articles.',
})

const { nav } = useNav()
const base = useBaseStore()
const store = useBaseStore()
const settingStore = useSettingStore()
const router = useRouter()
const runtimeStore = useRuntimeStore()
const androidApp = isAndroidApp()
let isSaveData = $ref(false)
const articlePersistence = usePracticeArticlePersistence()

watch(
  [() => store.load, () => runtimeStore.globalLoading],
  ([a, b]) => {
    if (a && !b) {
      init()
    }
  },
  { immediate: true }
)

async function onvisibilitychange() {
  if (!document.hidden) {
    //当页面可见时，检查是否需要从远程拉取数据
    const d = await articlePersistence.load()
    if (d) {
      isSaveData = true
    }
  }
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onvisibilitychange)
})

async function init() {
  document.removeEventListener('visibilitychange', onvisibilitychange)
  document.addEventListener('visibilitychange', onvisibilitychange)
  let studyIndex = store.article.studyIndex
  if (studyIndex >= 1) {
    if (!store.sbook.custom && !store.sbook.articles.length) {
      let dictList = await fetch(resourceWrap(DICT_LIST.ARTICLE.ALL)).then(r => r.json())
      let dict = await _getDictDataByUrl(store.sbook, DictType.article)
      let r = dictList.find(v => [v.enName, v.id].includes(store.sbook.id))
      if (r) {
        store.article.bookList[studyIndex].articles = dict.articles
        store.article.bookList[studyIndex].id = r.id
        store.article.bookList[studyIndex].enName = r.enName
        store.article.bookList[studyIndex].cover = r.cover
        store.article.bookList[studyIndex].category = r.category
        store.article.bookList[studyIndex].tags = r.tags
        store.article.bookList[studyIndex].url = r.url
        store.article.bookList[studyIndex].description = r.description
        store.article.bookList[studyIndex].name = r.name
      } else {
        store.article.bookList[studyIndex] = dict
      }
      store.article.bookList[studyIndex].length = dict.articles.length
      let s = store.article.bookList[studyIndex]
      if (s.lastLearnIndex > s.length) {
        store.article.bookList[studyIndex].lastLearnIndex = s.length
        store.article.bookList[studyIndex].complete = true
        //todo 后续加上
        // await resetCacheData()
      }
    }
  }
  const d = await articlePersistence.load()
  if (d) {
    isSaveData = true
  }
}

function startStudy() {
  // console.log(store.sbook.articles[1])
  // genArticleSectionData(cloneDeep(store.sbook.articles[1]))
  // return
  if (base.sbook.id) {
    if (!base.sbook.articles.length) {
      return Toast.warning('There are no articles to practice.')
    }
    window.umami?.track('startStudyArticle', {
      name: base.sbook.name,
      custom: base.sbook.custom,
      complete: base.sbook.complete,
      s: `name:${base.sbook.name},index:${base.sbook.lastLearnIndex},title:${base.sbook.articles[base.sbook.lastLearnIndex].title}`,
    })
    nav('/practice-articles/' + store.sbook.id)
  } else {
    window.umami?.track('no-book')
    Toast.warning('Choose a book first.')
  }
}

let isMultiple = $ref(false)
let selectIds = $ref([])

function handleBatchDel() {
  selectIds.forEach(id => {
    let r = base.article.bookList.findIndex(v => v.id === id)
    if (r !== -1) {
      if (base.article.studyIndex === r) {
        base.article.studyIndex = -1
      }
      if (base.article.studyIndex > r) {
        base.article.studyIndex--
      }
      base.article.bookList.splice(r, 1)
    }
  })
  selectIds = []
  Toast.success('Selected books deleted.')
}

function toggleSelect(item) {
  let rIndex = selectIds.findIndex(v => v === item.id)
  if (rIndex > -1) {
    selectIds.splice(rIndex, 1)
  } else {
    selectIds.push(item.id)
  }
}

async function goBookDetail(val: DictResource) {
  runtimeStore.editDict = getDefaultDict(val)
  // nav('book',{id: val.id})
  nav('/book/' + val.id)
}

const totalSpend = $computed(() => {
  if (base.sbook.statistics?.length) {
    return msToHourMinute(total(base.sbook.statistics, 'spend'), true)
  }
  return 0
})
const todayTotalSpend = $computed(() => {
  if (base.sbook.statistics?.length) {
    return msToHourMinute(
      total(
        base.sbook.statistics.filter(v => dayjs(v.startDate).isSame(dayjs(), 'day')),
        'spend'
      ),
      true
    )
  }
  return 0
})

const totalDay = $computed(() => {
  if (base.sbook.statistics?.length) {
    return new Set(base.sbook.statistics.map(v => dayjs(v.startDate).format('YYYY-MM-DD'))).size
  }
  return 0
})

const weekList = $computed(() => {
  const list = Array(7).fill(false)

  // 获取本周的起止时间
  const startOfWeek = dayjs().startOf('isoWeek') // 周一
  const endOfWeek = dayjs().endOf('isoWeek') // 周日

  store.sbook.statistics?.forEach(item => {
    const date = dayjs(item.startDate)
    if (date.isBetween(startOfWeek, endOfWeek, null, '[]')) {
      let idx = date.day()
      // dayjs().day() 0=周日, 1=周一, ..., 6=周六
      // 需要转换为 0=周一, ..., 6=周日
      if (idx === 0) {
        idx = 6 // 周日放到最后
      } else {
        idx = idx - 1 // 其余前移一位
      }
      list[idx] = true
    }
  })
  return list
})

const { data: recommendBookList, isFetching } = useFetch(resourceWrap(DICT_LIST.ARTICLE.RECOMMENDED)).json()
</script>

<template>
  <BasePage>
    <section v-if="androidApp" class="android-articles" aria-labelledby="android-articles-title">
      <header class="android-articles-heading">
        <h1 id="android-articles-title">Articles</h1>
        <a href="#android-article-books" class="android-article-link">My books</a>
      </header>
      <article class="android-article-hero">
        <p class="android-article-eyebrow">Current practice</p>
        <template v-if="base.sbook.id">
          <button type="button" class="android-article-name" @click="goBookDetail(base.sbook)">{{ base.sbook.name }}</button>
          <div class="android-article-progress">
            <strong>{{ base.currentBookProgress }}<small>%</small></strong>
            <span>{{ base.sbook.lastLearnIndex }} / {{ base.sbook.length }} articles</span>
          </div>
          <progress :value="base.currentBookProgress" max="100" aria-label="Article practice progress"></progress>
          <button type="button" class="android-article-primary" @click="startStudy">
            {{ isSaveData ? $t('continue_learning') : $t('start_learning') }}
          </button>
        </template>
        <template v-else>
          <h2>Start with an article</h2>
          <p class="android-article-empty">Pick a book to practice listening and typing.</p>
          <a href="#android-article-books" class="android-article-primary">Choose a book</a>
        </template>
      </article>
      <details v-if="base.sbook.id" class="android-article-history">
        <summary>Study history <span>Today {{ todayTotalSpend }}</span></summary>
        <p>{{ totalDay }} study {{ totalDay === 1 ? 'day' : 'days' }} · {{ totalSpend }} total</p>
        <div class="android-article-week" :aria-label="$t('this_week_record')">
          <span v-for="(studied, i) in weekList" :key="i" :class="{ 'is-studied': studied }" :aria-label="`Day ${i + 1}, ${studied ? 'studied' : 'no activity'}`">{{ i + 1 }}</span>
        </div>
      </details>
    </section>
    <div v-else class="card flex flex-col md:flex-row justify-between gap-space p-4 md:p-6">
      <div class="">
        <Book
          v-if="base.sbook.id"
          :is-add="false"
          quantifier=" articles"
          :item="base.sbook"
          :show-progress="false"
          @click="goBookDetail(base.sbook)"
        />
        <Book v-else :is-add="true" @click="router.push('/book-list')" />
      </div>
      <div class="flex-1">
        <div class="flex justify-between items-start">
          <div class="flex items-center min-w-0">
            <div class="title mr-4 truncate">{{ $t('this_week_record') }}</div>
            <div class="flex gap-4 color-gray">
              <div
                class="w-6 h-6 md:w-8 md:h-8 rounded-md center text-sm md:text-base"
                :class="item ? 'bg-[#409eff] color-white' : 'bg-gray-200'"
                v-for="(item, i) in weekList"
                :key="i"
              >
                {{ i + 1 }}
              </div>
            </div>
          </div>
          <div class="flex gap-4 items-center" v-opacity="base.sbook.id">
            <div class="color-link cursor-pointer" @click="router.push('/book-list')">{{ $t('change_book') }}</div>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 items-center mt-3 gap-space w-full">
          <div
            class="w-full sm:flex-1 rounded-xl p-4 box-border relative bg-[var(--bg-history)] border border-gray-200"
          >
            <div class="text-[#409eff] text-xl font-bold">{{ todayTotalSpend }}</div>
            <div class="text-gray-500">{{ $t('today_study_time') }}</div>
          </div>
          <div
            class="w-full sm:flex-1 rounded-xl p-4 box-border relative bg-[var(--bg-history)] border border-gray-200"
          >
            <div class="text-[#409eff] text-xl font-bold">{{ totalDay }}</div>
            <div class="text-gray-500">{{ $t('total_study_days') }}</div>
          </div>
          <div
            class="w-full sm:flex-1 rounded-xl p-4 box-border relative bg-[var(--bg-history)] border border-gray-200"
          >
            <div class="text-[#409eff] text-xl font-bold">{{ totalSpend }}</div>
            <div class="text-gray-500">{{ $t('total_study_time') }}</div>
          </div>
        </div>
        <div class="flex gap-3 mt-3">
          <Progress
            class="w-full md:w-auto"
            size="large"
            :percentage="base.currentBookProgress"
            :format="() => `${base.sbook?.lastLearnIndex || 0}/${base.sbook?.length || 0} articles`"
            :show-text="true"
          ></Progress>

          <BaseButton size="large" class="w-full md:w-auto" @click="startStudy" :disabled="!base.sbook.name">
            <div class="flex items-center gap-2 justify-center w-full">
              <span class="line-height-[2]">{{ isSaveData ? $t('continue_learning') : $t('start_learning') }}</span>
              <IconFluentArrowCircleRight16Regular class="text-xl" />
            </div>
          </BaseButton>
        </div>
      </div>
    </div>

    <div :id="androidApp ? 'android-article-books' : undefined" class="card flex flex-col" :class="{ 'android-article-books': androidApp }">
      <div class="flex justify-between">
        <div class="title">{{ $t('my_books') }}</div>
        <div class="flex gap-4 items-center">
          <NuxtLink to="/library" class="color-link">Bookshelf</NuxtLink>
          <PopConfirm title="Delete all selected books?" @confirm="handleBatchDel" v-if="selectIds.length">
            <BaseIcon class="del" :title="$t('delete')">
              <DeleteIcon />
            </BaseIcon>
          </PopConfirm>

          <div
            class="color-link cursor-pointer"
            v-if="base.article.bookList.length > 1"
            @click="
              () => {
                isMultiple = !isMultiple
                selectIds = []
              }
            "
          >
            {{ isMultiple ? $t('cancel') : $t('manage_books') }}
          </div>
          <div v-if="!isAndroidApp()" class="color-link cursor-pointer" @click="nav('/book/new', { isAdd: true })">
            {{ $t('create_personal_book') }}
          </div>
        </div>
      </div>
      <ImportLocalBook v-if="!isAndroidApp()" class="mt-4" />
      <div class="flex gap-4 flex-wrap mt-4" :class="{ 'android-list': isAndroidApp() }">
        <Book
          :is-add="false"
          :compact="isAndroidApp()"
          :is-user="true"
          quantifier=" articles"
          :item="item"
          :checked="selectIds.includes(item.id)"
          @check="() => toggleSelect(item)"
          :show-checkbox="isMultiple && j >= 1"
          v-for="(item, j) in base.article.bookList"
          @click="goBookDetail(item)"
        />
        <Book v-if="!isAndroidApp()" :is-add="true" @click="router.push('/book-list')" />
      </div>
    </div>

    <div class="card flex flex-col min-h-50" :class="{ 'android-article-books': androidApp }" v-loading="isFetching">
      <div class="flex justify-between">
        <div class="title">{{ $t('recommend') }}</div>
        <div v-if="!androidApp" class="flex gap-4 items-center">
          <div class="color-link cursor-pointer" @click="router.push('/book-list')">{{ $t('more') }}</div>
        </div>
      </div>

      <div class="flex gap-4 flex-wrap mt-4" :class="{ 'android-list': androidApp }">
        <Book
          :is-add="false"
          :compact="androidApp"
          quantifier=" articles"
          :item="item as any"
          v-for="(item, j) in recommendBookList"
          @click="goBookDetail(item as any)"
        />
      </div>
    </div>
  </BasePage>
</template>

<style scoped lang="scss">
.android-articles { padding: 20px 20px 6px; max-width: 650px; margin: auto; color: var(--android-text); }
.android-articles-heading, .android-article-progress { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.android-articles-heading { margin-bottom: 17px; }
.android-articles-heading h1 { margin: 0; font-size: 32px; font-weight: 700; line-height: 1.17; letter-spacing: -.045em; }
.android-article-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--android-accent); font-size: 14px; }
.android-article-hero { padding: 18px; border: 1px solid var(--android-line); border-radius: 22px; background: var(--android-surface); }
.android-article-eyebrow { margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--android-muted); }
.android-article-name, .android-article-hero h2 { display: block; text-align: start; font-size: clamp(21px, 6vw, 27px); font-weight: 650; line-height: 1.22; overflow-wrap: anywhere; }
.android-article-progress { align-items: baseline; margin: 16px 0 6px; }
.android-article-progress strong { font-size: 32px; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.05em; }
.android-article-progress small { font-size: 17px; margin-left: 2px; }
.android-article-progress span, .android-article-empty { color: var(--android-muted); font-size: 13px; }
.android-article-empty { margin-top: 10px; }
.android-article-hero progress { display: block; appearance: none; width: 100%; height: 6px; border: 0; border-radius: 6px; overflow: hidden; }
.android-article-hero progress::-webkit-progress-bar { background: var(--android-line); }
.android-article-hero progress::-webkit-progress-value { background: var(--android-accent); border-radius: 6px; }
.android-article-primary { display: grid; place-items: center; width: 100%; min-height: 44px; margin-top: 18px; padding: 5px 8px; border-radius: 24px; text-align: center; font-size: 14px; font-weight: 650; color: var(--android-on-accent, #fff); background: var(--android-accent); }
.android-article-history { margin-top: 8px; border-bottom: 1px solid var(--android-line); color: var(--android-muted); }
.android-article-history summary { min-height: 44px; align-content: center; color: var(--android-text); font-size: 14px; font-weight: 600; }
.android-article-history summary span { float: right; color: var(--android-muted); font-weight: 400; }
.android-article-history p { font-size: 13px; }
.android-article-week { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 0; }
.android-article-week span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; font-size: 13px; background: var(--android-surface); border: 1px solid var(--android-line); }
.android-article-week .is-studied { background: var(--android-tint); color: var(--android-accent); border-color: transparent; }
.android-article-books { scroll-margin-top: 70px; }
.android-article-books .title { color: var(--android-text); }

.stat {
  @apply rounded-xl p-4 box-border relative flex-1 bg-[var(--bg-history)];
  border: 1px solid gainsboro;

  .num {
    @apply color-[#409eff] text-xl font-bold;
  }

  .txt {
    @apply color-gray-500;
  }
}
</style>

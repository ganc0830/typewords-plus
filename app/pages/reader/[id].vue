<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useGetDict } from '@/core/hooks/dict'
import { useRuntimeStore } from '@/core/stores/runtime'
import { getDefaultDict } from '@/core/types/func'
const route = useRoute()
const runtime = useRuntimeStore()
// 直接按路由查找书籍，避免沿用上一页遗留的编辑书籍。
runtime.editDict = getDefaultDict()
useGetDict()
const book = computed(() => runtime.editDict)
const chapter = ref(0)
const page = ref(0)
const pages = ref(1)
const size = ref(22)
const dark = ref(false)
const contents = ref(false)
const viewport = ref<HTMLElement>()
const paper = ref<HTMLElement>()
const width = ref(1)
const key = 'typewords-reader:' + String(route.params.id)
const article = computed(() => book.value?.articles?.[chapter.value])
const paragraphs = computed(() => article.value?.sections?.length
  ? article.value.sections.map(section => section.map(sentence => sentence.text).join(' '))
  : (article.value?.text || '').split(/\n+/).filter(Boolean))
let observer: ResizeObserver | undefined
let touchX = 0
let restoredPage: number | undefined

/** 按当前视口与字号重新测量横向排版页数。 */
async function measure() {
  await nextTick()
  if (!viewport.value || !paper.value) return
  if (!article.value) return
  width.value = viewport.value.clientWidth
  await nextTick()
  pages.value = Math.max(1, Math.ceil(paper.value.scrollWidth / width.value))
  page.value = Math.min(restoredPage ?? page.value, pages.value - 1)
  restoredPage = undefined
}

/** 保存本书阅读位置，和打字练习进度各自记忆。 */
function remember() {
  try { localStorage.setItem(key, JSON.stringify({ chapter: chapter.value, page: page.value, size: size.value, dark: dark.value })) }
  catch { /* 存储不可用时仍允许继续阅读。 */ }
}

/** direction 指定前后翻页，到章节边界时进入相邻章节。 */
async function turn(direction: number) {
  if (page.value + direction >= 0 && page.value + direction < pages.value) page.value += direction
  else if (direction > 0 && chapter.value + 1 < (book.value?.articles?.length || 0)) { chapter.value++; page.value = 0 }
  else if (direction < 0 && chapter.value > 0) { chapter.value--; await measure(); page.value = pages.value - 1 }
}

/** 目录选择 index 对应章节并从第一页开始。 */
function selectChapter(index: number) { chapter.value = index; page.value = 0; contents.value = false }

watch([article, size], measure)
watch([chapter, page, size, dark], remember)
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    chapter.value = Math.max(0, Number(saved.chapter) || 0)
    page.value = Math.max(0, Number(saved.page) || 0)
    restoredPage = page.value
    size.value = Math.min(36, Math.max(16, Number(saved.size) || 22))
    dark.value = saved.dark === true
  } catch { /* 损坏的书签按第一页读取。 */ }
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
})
onBeforeUnmount(() => { observer?.disconnect(); remember() })
</script>

<template>
  <main class="reader" :class="{ night: dark }">
    <header>
      <NuxtLink to="/library">返回书架</NuxtLink>
      <button @click="contents = !contents">目录</button>
      <button :disabled="size <= 16" @click="size -= 2">A−</button>
      <button :disabled="size >= 36" @click="size += 2">A＋</button>
      <button @click="dark = !dark">{{ dark ? '日间' : '夜间' }}</button>
    </header>
    <h1>{{ article?.title || book?.name || '正在打开书籍…' }}</h1>
    <nav v-if="contents" class="contents">
      <button v-for="(item, index) in book?.articles || []" :key="item.id || index" @click="selectChapter(index)">{{ index + 1 }}. {{ item.title }}</button>
    </nav>
    <div ref="viewport" class="viewport" @touchstart.passive="touchX = $event.touches[0].clientX" @touchend.passive="Math.abs($event.changedTouches[0].clientX - touchX) > 60 && turn($event.changedTouches[0].clientX < touchX ? 1 : -1)">
      <article ref="paper" :style="{ fontSize: size + 'px', columnWidth: width + 'px', transform: `translateX(-${page * width}px)` }">
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
      </article>
    </div>
    <footer>
      <button :disabled="chapter === 0 && page === 0" @click="turn(-1)">上一页</button>
      <span>第 {{ chapter + 1 }} 章 · {{ page + 1 }}/{{ pages }} 页</span>
      <button :disabled="chapter + 1 >= (book?.articles?.length || 0) && page + 1 >= pages" @click="turn(1)">下一页</button>
    </footer>
  </main>
</template>

<style scoped>
.reader { position: relative; height: calc(100dvh - 80px); min-height: 300px; max-width: 920px; margin: 12px auto; padding: 16px 24px; background: #f4ecd9; color: #363025; display: flex; flex-direction: column; border-radius: 10px; }
.night { background: #222725; color: #d7dacf; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
button, header a { padding: 7px 9px; border-radius: 6px; }
button:disabled { opacity: .35; }
h1 { margin: 10px 0 14px; font-size: 18px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.viewport { flex: 1; min-height: 0; overflow: hidden; }
article { height: 100%; width: 100%; column-gap: 0; column-fill: auto; line-height: 1.9; overflow-wrap: anywhere; }
p { margin: 0 0 1em; white-space: pre-wrap; }
footer { padding-top: 12px; font-size: 13px; }
.contents { position: absolute; z-index: 5; top: 65px; bottom: 60px; left: 12px; right: 12px; background: inherit; overflow-y: auto; box-shadow: 0 2px 12px #0004; }
.contents button { display: block; text-align: left; width: 100%; border-bottom: 1px solid #8884; }
@media(max-width: 600px) { .reader { padding: 10px 16px; margin: 5px; } }
</style>

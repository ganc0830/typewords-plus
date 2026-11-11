<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { BaseButton, BasePage } from '@/base'
import QRCode from 'qrcode'
import ResourceCard from '@/components/ResourceCard.vue'
import { APP_NAME, Origin } from '@/core/config/env.ts'
import type { Resource } from '@/core'

let route = useRoute()
let title = APP_NAME + ' English Learning Resources'
useSeoMeta({
  title: title,
  description: title,
  ogTitle: title,
  ogDescription: title,
  ogUrl: Origin + route.fullPath,
  twitterTitle: title,
  twitterDescription: title,
})

interface Subcategory {
  name: string
  description?: string
  resources: Resource[]
}

interface Category {
  id: string
  name: string
  icon?: string
  description?: string
  resources?: Resource[]
  subcategories?: Subcategory[]
}

// 资源分类
const categories = ref<Category[]>([
  {
    id: 'new-concept',
    name: 'New Concept English',
    description: 'Classic course books for structured English study.',
    resources: [
      {
        name: 'New Concept English collection',
        description: '',
        difficulty: 'Includes all items below',
        link: 'https://pan.quark.cn/s/6b12da160020',
      },
      {
        type: 'list',
        children: [
          {
            name: 'New Concept English for Young Learners',
            description: 'Reading for children',
            difficulty: 'Ages 7 to 14',
          },
          {
            name: 'New Concept English, Book 1',
            description: 'For learners starting English.',
            difficulty: 'Introductory',
          },
          {
            name: 'New Concept English, Book 2',
            description: 'Build core grammar and vocabulary.',
            difficulty: 'Elementary',
          },
          {
            name: 'New Concept English, Book 3',
            description: 'Develop English proficiency and reading skills.',
            difficulty: 'Intermediate',
          },
          {
            name: 'New Concept English, Book 4',
            description: 'Develop a wider range of advanced English skills.',
            difficulty: 'Advanced',
          },
        ],
      },
      {
        type: 'list',
        children: [
          {
            name: 'New Concept English Books 1–4 (high-resolution PDFs)',
            description: 'High-resolution textbook scans for Books 1–4.',
            difficulty: 'PDF',
          },
          {
            name: 'New Oriental: New Concept English Books 1–4',
            description: 'Video lessons from a language school.',
            difficulty: 'New Oriental',
          },
          {
            name: 'New Oriental: New Concept English Grammar',
            description: 'Video lessons from a language school.',
            difficulty: 'New Oriental',
          },
          {
            name: 'Hujiang: Complete New Concept English',
            description: 'Video lessons from a language school.',
            difficulty: 'Hujiang',
          },
          {
            name: 'More New Concept English lessons',
            description: 'Videos from language schools and independent teachers.',
            difficulty: 'Other',
          },
        ],
      },
    ],
  },
  {
    id: 'exam',
    name: 'TV and film',
    description: 'British and American series for listening and speaking practice.',
    resources: [
      {
        name: 'British and American TV collection',
        difficulty: 'Includes all items below',
        link: 'https://v.v8l.cn/s/TG3sgVg',
      },
      {
        type: 'list',
        children: [
          {
            name: 'Friends',
            description: '',
            difficulty: 'Comedy / Romance',
          },
          {
            name: 'The Big Bang Theory',
            description: '',
            difficulty: 'Comedy / Romance',
          },
          {
            name: 'Yes Minister / Yes, Prime Minister',
            description: '',
            difficulty: 'Comedy / Satire',
          },
          {
            name: 'Breaking Bad',
            description: '',
            difficulty: 'Crime / Drama',
          },
          {
            name: 'The Walking Dead',
            description: '',
            difficulty: 'Horror / Thriller / Zombies',
          },
          {
            name: 'Prison Break',
            description: '',
            difficulty: 'Crime / Drama',
          },
          {
            name: 'The Wire',
            description: '',
            difficulty: 'Drama / Crime / Thriller',
          },
          {
            name: 'House of Cards',
            description: '',
            difficulty: 'Political drama',
          },
          {
            name: 'Money Heist',
            description: '',
            difficulty: 'Drama / Action / Mystery',
          },
          {
            name: 'Harry Potter',
            description: '',
            difficulty: 'Fantasy / Adventure',
          },
          {
            name: 'The Good Doctor',
            description: '',
            difficulty: 'Medical drama',
          },
        ],
      },
      {
        type: 'list',
        children: [
          {
            name: 'The Sopranos',
            description: '',
            difficulty: 'Drama / Thriller / Crime',
          },
          {
            name: 'Better Call Saul',
            description: '',
            difficulty: 'Drama / Comedy / Crime',
          },
          {
            name: 'Love, Death & Robots',
            description: '',
            difficulty: 'Comedy / Sci-fi / Animation / Fantasy',
          },
          {
            name: 'Narcos',
            description: '',
            difficulty: 'Drama / Biography / Action / Crime',
          },
          {
            name: 'Westworld',
            description: '',
            difficulty: 'Sci-fi / Western',
          },
          {
            name: '2 Broke Girls',
            description: '',
            difficulty: 'Comedy',
          },
          {
            name: 'Grey’s Anatomy',
            description: '',
            difficulty: 'Drama / Romance',
          },
          {
            name: 'Downton Abbey',
            description: '',
            difficulty: 'Drama',
          },
          {
            name: '2 Broke Girls',
            description: '',
            difficulty: 'Comedy',
          },
          {
            name: 'The Crown',
            description: '',
            difficulty: 'Historical drama',
          },
          {
            name: 'Classic English-language films',
            description: '',
            difficulty: 'Film',
          },
        ],
      },
    ],
  },
  {
    id: 'grammar',
    name: 'Grammar',
    description: '',
    subcategories: [
      {
        name: 'Core textbooks',
        description: '',
        resources: [
          {
            name: '英语语法新思维',
            author: '张满胜',
            features: 'Three books explain how grammar works from beginner to advanced, with an emphasis on understanding.',
            suitable: 'Learners who want a structured approach to grammar.',
            difficulty: '',
            link: 'https://pan.quark.cn/s/d06abef6c737',
          },
          {
            name: '薄冰英语语法',
            author: '薄冰',
            features: 'A comprehensive reference with detailed sections for looking up grammar points.',
            suitable: 'Secondary students and learners building a foundation.',
            difficulty: '',
            link: 'https://pan.quark.cn/s/30777ceba5b9',
          },
          // {
          //   name: '实用英语语法',
          //   author: '张道真',
          //   features: '国内经典语法教材，内容详实全面，例句丰富，适合作为工具书查阅',
          //   suitable: '需要权威参考书的学生或教师',
          //   difficulty: '',
          //   link: 'https://pan.baidu.com/s/xxx',
          // },
          {
            name: '旋元佑语法',
            author: '旋元佑',
            features: 'Explains difficult grammar in plain language and shows the logic behind it.',
            suitable: 'Learners looking for an accessible explanation of the logic behind grammar.',
            difficulty: 'Traditional Chinese edition',
            link: 'https://pan.quark.cn/s/0d0de559794e',
          },
        ],
      },
      {
        name: 'Further study',
        description: '',
        resources: [
          {
            name: 'English Grammar in Use',
            author: 'Cambridge University Press',
            features: 'A self-study series in three levels, with concise explanations and plenty of exercises.',
            suitable: 'Learners preparing for international exams.',
            description: '',
            difficulty: 'Chinese edition',
            link: 'https://pan.quark.cn/s/d4a6ef53c04d',
          },
          {
            name: 'Oxford English Grammar',
            author: 'Sidney Greenbaum & Gerald Nelson',
            features: 'Three levels of British English grammar with clear explanations and natural examples for IELTS and TOEFL preparation.',
            suitable: 'Learners who want a comprehensive grammar review.',
            difficulty: 'English edition',
            link: 'https://pan.quark.cn/s/ca505875e68c',
          },
          {
            name: 'Practical English Usage',
            author: 'Michael Swan',
            features: 'Detailed explanations of common mistakes and points of confusion.',
            suitable: 'A grammar reference for intermediate and advanced learners.',
            difficulty: 'Chinese and English editions',
            link: 'https://pan.quark.cn/s/05006e705a77',
          },
        ],
      },
    ],
  },
  {
    id: 'listening',
    name: 'Listening practice',
    description: 'Develop your English listening skills.',
    resources: [
      {
        name: 'VOA Learning English collection',
        description: 'News recordings at an accessible pace across a range of topics.',
        difficulty: 'Beginner',
        link: 'https://pan.quark.cn/s/681794bffc6e',
      },
      // {
      //   name: 'BBC Learning English',
      //   description: 'BBC官方英语学习资源，涵盖多方面内容',
      //   difficulty: 'Intermediate to advanced',
      //   link: 'https://pan.baidu.com/s/xxx',
      // },
      {
        name: 'TED-Ed animated lessons',
        description: 'Short educational animations for middle and high school students.',
        difficulty: 'Beginner',
        link: 'https://pan.quark.cn/s/d3d83038afb9',
      },
      {
        name: 'Harvard talks',
        description: 'Talks that build listening skills and introduce new topics.',
        difficulty: 'Intermediate to advanced',
        link: 'https://pan.quark.cn/s/62e8d536a34f',
      },
    ],
  },
])

// 当前选中的分类
const selectedCategory = ref('all')

// 筛选后的资源
const filteredResources = computed(() => {
  if (selectedCategory.value === 'all') {
    return categories.value
  }
  return categories.value.filter(cat => cat.id === selectedCategory.value)
})

const Dialog = defineAsyncComponent(() => import('@/base/dialog/Dialog.vue'))

// QR 弹窗状态
let showQrDialog = $ref(false)
let currentResourceName = $ref('')
let qrDataUrl = $ref('')

// 生成二维码并显示弹窗
async function openLink(url: string, name?: string) {
  if (url === 'https://v.v8l.cn/s/TG3sgVg') {
    window.open(url, '_blank')
    return
  }
  currentResourceName = name || ''
  try {
    qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
  } catch {
    qrDataUrl = ''
  }
  showQrDialog = true
}
</script>

<template>
  <BasePage>
    <div class="flex flex-col items-center justify-center px-4 py-8">
      <!-- 页面标题 -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold mb-4">{{ $t('resource_sharing') }}</h1>
        <p class="text-lg text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
          Explore this collection of resources for learning English.
        </p>
      </div>

      <!-- 分类筛选 -->
      <div class="card-white flex flex-wrap justify-center gap-2 mb-8 p-4">
        <BaseButton :type="selectedCategory === 'all' ? 'primary' : 'info'" @click="selectedCategory = 'all'">
          {{ $t('all_resources') }}
        </BaseButton>
        <BaseButton
          v-for="category in categories"
          :key="category.id"
          :type="selectedCategory === category.id ? 'primary' : 'info'"
          @click="selectedCategory = category.id"
        >
          {{ category.name }}
        </BaseButton>
      </div>

      <!-- 资源列表 -->
      <div class="w-full">
        <div v-for="category in filteredResources" :key="category.id" class="mb-12">
          <div class="text-center mb-6">
            <h2 class="text-2xl font-bold mb-2">{{ category.icon }} {{ category.name }}</h2>
            <p v-if="category.description" class="text-gray-600 dark:text-gray-300">
              {{ category.description }}
            </p>
          </div>

          <!-- 如果有子分类，显示子分类 -->
          <template v-if="category.subcategories">
            <div v-for="subcategory in category.subcategories" :key="subcategory.name" class="mb-10">
              <div class="text-center mb-4">
                <h3 class="text-xl font-semibold mb-2 text-gray-800 dark:text-gray-200">
                  {{ subcategory.name }}
                </h3>
                <p v-if="subcategory.description" class="text-gray-600 dark:text-gray-300">
                  {{ subcategory.description }}
                </p>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                <ResourceCard
                  v-for="resource in subcategory.resources"
                  :key="resource.name"
                  :resource="resource"
                  @openLink="(url: string) => openLink(url, resource.name)"
                />
              </div>
            </div>
          </template>

          <!-- 如果没有子分类，直接显示资源 -->
          <template v-else>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <ResourceCard
                v-for="resource in category.resources"
                :key="resource.name"
                :resource="resource"
                @openLink="(url: string) => openLink(url, resource.name)"
              />
            </div>
          </template>
        </div>
      </div>

      <!-- 页面底部 -->
      <div class="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
        <div class="card-white">
          <div class="text-xl font-bold mb-4">About these resources</div>
          <ul class="space-y-2 text-gray-600 dark:text-gray-300">
            <li>These resources are collected from the web and are shared for learning and discussion.</li>
            <li>
              If a link stops working, <a :href="`https://v.wjx.cn/vm/ev0W7fv.aspx#`" target="_blank">report it</a> so it can be updated.
            </li>
          </ul>
        </div>
      </div>
    </div>

    <Dialog v-model="showQrDialog" title="Scan to open this resource">
      <div class="w-90 p-6 pt-0 flex flex-col items-center">
        <p class="text-center text-gray-600 text-xl dark:text-gray-300">
          {{ currentResourceName }}
        </p>
        <div class="text-center">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code" class="w-70 rounded-lg shadow-md" />
        </div>
        <p class="text-center text-gray-600 text-xl font-bold dark:text-gray-300">Open Quark on your phone and scan the code.</p>
      </div>
    </Dialog>
  </BasePage>
</template>

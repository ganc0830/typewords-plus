<script setup lang="ts">
import { computed } from 'vue'
import { useBaseStore } from '@/core/stores/base'
const store = useBaseStore()
const books = computed(() => store.article.bookList.filter(book => !book.system))
</script>

<template>
  <main class="library">
    <h1>小说与书籍</h1>
    <p>选择一本书继续阅读</p>
    <p v-if="store.load && !books.length">还没有书籍，请在电脑端添加。</p>
    <div class="shelf">
      <NuxtLink v-for="book in books" :key="book.id" :to="'/reader/' + encodeURIComponent(String(book.id))" class="cover">
        <strong>{{ book.name }}</strong>
        <span>{{ book.articles?.length || book.length }} 章</span>
      </NuxtLink>
    </div>
  </main>
</template>

<style scoped>
.library { max-width: 1100px; margin: auto; padding: 28px 20px; }
h1 { font-size: 26px; margin-bottom: 12px; }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 20px; margin-top: 24px; }
.cover { display: flex; flex-direction: column; justify-content: space-between; min-height: 215px; padding: 22px 16px; border-radius: 5px 12px 12px 5px; background: #e9dfca; color: #443b2e; border-left: 8px solid #a28d69; box-shadow: 3px 5px 12px #0002; }
.cover strong { overflow-wrap: anywhere; }
.cover span { font-size: 13px; margin-top: 18px; }
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useBaseStore } from '@/core/stores/base'
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { withAppBaseURL } from '@/core/utils/base-url'
const store = useBaseStore()
const androidApp = isAndroidApp()
const books = computed(() => store.article.bookList.filter(book => !book.system))
</script>

<template>
  <main v-if="androidApp" class="android-library">
    <header>
      <h1>Books</h1>
      <p>Pick a book to continue reading.</p>
      <NuxtLink to="/browse-books" class="android-library-import">Browse and import</NuxtLink>
    </header>
    <section v-if="books.length" aria-labelledby="android-books-title">
      <div class="android-library-section-title">
        <h2 id="android-books-title">My bookshelf</h2>
        <span>{{ books.length }} {{ books.length === 1 ? 'book' : 'books' }}</span>
      </div>
      <div class="android-library-list">
        <NuxtLink v-for="book in books" :key="book.id" :to="'/reader/' + encodeURIComponent(String(book.id))" class="android-library-book">
          <img v-if="book.cover" :src="withAppBaseURL(book.cover)" alt="" loading="lazy" />
          <div v-else class="android-library-placeholder" aria-hidden="true"><IconFluentBookLetter20Regular /></div>
          <div class="android-library-meta">
            <strong>{{ book.name }}</strong>
            <span>{{ book.articles?.length || book.length }} {{ (book.articles?.length || book.length) === 1 ? 'chapter' : 'chapters' }}</span>
          </div>
          <IconFluentChevronRight16Regular class="android-library-arrow" aria-hidden="true" />
        </NuxtLink>
      </div>
    </section>
    <section v-else-if="store.load" class="android-library-empty">
      <div class="android-library-placeholder" aria-hidden="true"><IconFluentBookLetter20Regular /></div>
      <h2>Your bookshelf is empty</h2>
      <p>Add books on your computer, then sync them to this device.</p>
      <NuxtLink to="/mobile-sync">Open sync</NuxtLink>
    </section>
  </main>
  <main v-else class="library">
    <h1>Books</h1>
    <p>Pick a book to continue reading.</p>
    <p v-if="store.load && !books.length">No books yet. Add a book on your computer.</p>
    <div class="shelf">
      <NuxtLink v-for="book in books" :key="book.id" :to="'/reader/' + encodeURIComponent(String(book.id))" class="cover">
        <strong>{{ book.name }}</strong>
        <span>{{ book.articles?.length || book.length }} {{ (book.articles?.length || book.length) === 1 ? 'chapter' : 'chapters' }}</span>
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

.android-library { max-width: 650px; margin: auto; padding: 32px var(--android-gutter, 20px) 20px; color: var(--android-text); }
.android-library header { margin-bottom: 24px; }
.android-library h1 { margin: 0 0 8px; font-size: 32px; font-weight: 700; line-height: 1.17; letter-spacing: -.045em; }
.android-library header p { color: var(--android-muted); font-size: 14px; }
.android-library-import { display: inline-flex; align-items: center; min-height: 44px; margin-top: 12px; padding: 8px 16px; border-radius: 24px; background: var(--android-tint); color: var(--android-accent); font-size: 14px; font-weight: 650; }
.android-library-section-title { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 0 2px 10px; }
.android-library-section-title h2 { font-size: 18px; font-weight: 650; }
.android-library-section-title span { color: var(--android-muted); font-size: 13px; }
.android-library-list, .android-library-empty { border: 1px solid var(--android-line); border-radius: 22px; background: var(--android-surface); }
.android-library-list { overflow: hidden; }
.android-library-book { display: flex; align-items: center; gap: 14px; min-height: 80px; padding: 12px 15px; color: inherit; }
.android-library-book + .android-library-book { border-top: 1px solid var(--android-line); }
.android-library-book:focus-visible { outline-offset: -3px; }
.android-library-book img, .android-library-placeholder { width: 40px; height: 52px; flex: none; border-radius: 8px; }
.android-library-book img { object-fit: cover; }
.android-library-placeholder { display: grid; place-items: center; color: var(--android-accent); background: var(--android-tint); }
.android-library-meta { flex: 1; min-width: 0; display: grid; gap: 4px; }
.android-library-meta strong { line-height: 1.35; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.android-library-meta span { color: var(--android-muted); font-size: 13px; }
.android-library-arrow { flex: none; color: var(--android-muted); }
.android-library-empty { display: grid; justify-items: center; gap: 8px; padding: 24px 16px; text-align: center; }
.android-library-empty h2 { font-size: 18px; font-weight: 650; }
.android-library-empty p { color: var(--android-muted); font-size: 14px; }
.android-library-empty a { display: inline-flex; align-items: center; min-height: 44px; color: var(--android-accent); font-size: 14px; }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import useTheme from '@/core/hooks/theme'
import { mobileStatus } from '@/core/utils/mobile-sync'

const route = useRoute()
const { toggleTheme, getTheme } = useTheme()
const drawer = ref<HTMLDialogElement>()
const section = computed(() => {
  if (/^\/(library|reader|browse-books)(\/|$)/.test(route.path)) return 'library'
  if (/^\/(articles|book|practice-articles|practice-sentences)(\/|$)/.test(route.path)) return 'articles'
  return 'words'
})
const showTabs = computed(() => ['/words', '/articles', '/library'].includes(route.path))
const title = computed(() => ({ words: 'Words', articles: 'Articles', library: 'Library' })[section.value])
watch(() => route.path, () => drawer.value?.close())

/** 从原生桥接检查已配对电脑上的 APK 版本。 */
function checkUpdate() {
  ;(window as any).TypeWordsAndroid?.checkUpdate?.()
}
</script>

<template>
  <header class="app-header">
    <button v-if="showTabs" type="button" class="menu-button" aria-label="Open menu" aria-haspopup="dialog" @click="drawer?.showModal()">TW</button>
    <NuxtLink v-else :to="'/' + section" class="header-button" aria-label="Back to section"><IconFluentArrowLeft16Regular /></NuxtLink>
    <strong>{{ showTabs ? 'TypeWords' : title }}</strong>
    <NuxtLink to="/mobile-sync" class="header-button" aria-label="Sync with computer"><IconFluentArrowSync20Regular /></NuxtLink>
  </header>
  <nav v-if="showTabs" class="app-tabs" aria-label="Mobile navigation">
    <NuxtLink to="/words"><IconFluentTextUnderlineDouble20Regular /><span>Words</span></NuxtLink>
    <NuxtLink to="/articles"><IconFluentDocument20Regular /><span>Articles</span></NuxtLink>
    <NuxtLink to="/library"><IconFluentBookLetter20Regular /><span>Library</span></NuxtLink>
  </nav>
  <dialog ref="drawer" class="app-drawer" aria-label="TypeWords menu" @click.self="drawer?.close()">
    <div class="drawer-content">
      <div class="drawer-heading">
        <div class="drawer-identity">
          <span class="drawer-mark" aria-hidden="true">TW</span>
          <strong>TypeWords</strong>
        </div>
        <button type="button" class="header-button" aria-label="Close menu" @click="drawer?.close()"><IconFluentDismiss20Regular /></button>
      </div>
      <p class="connection">{{ mobileStatus }}</p>
      <div class="drawer-actions">
        <NuxtLink to="/mobile-sync" @click="drawer?.close()"><IconFluentArrowSync20Regular />Sync with computer</NuxtLink>
        <NuxtLink to="/setting" @click="drawer?.close()"><IconFluentSettings20Regular />Study settings</NuxtLink>
        <button type="button" @click="toggleTheme()"><IconFluentWeatherMoon16Regular />{{ getTheme() === 'dark' ? 'Light mode' : 'Dark mode' }}</button>
        <button type="button" @click="checkUpdate"><IconFluentArrowCircleRight16Regular />Check for updates</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 15;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  box-sizing: border-box;
  min-height: var(--android-header-height);
  padding: 6px var(--android-gutter);
  color: var(--android-text);
  background: var(--android-canvas);
  background: color-mix(in srgb, var(--android-canvas) 93%, transparent);
  backdrop-filter: blur(18px);
  text-align: center;
}
.app-header strong { font-size: 17px; font-weight: 650; letter-spacing: -0.025em; }
.menu-button, .header-button { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: inherit; }
.menu-button { font-size: 12px; font-weight: 700; letter-spacing: -0.04em; background: var(--android-surface); }
.header-button svg { font-size: 21px; }
.menu-button:active, .header-button:active { background: var(--android-tint); color: var(--android-accent); }

.app-tabs {
  position: fixed;
  z-index: 15;
  bottom: 0;
  inset-inline: 0;
  box-sizing: border-box;
  height: var(--android-bottom-nav-height);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--android-line);
  background: var(--android-surface);
}
.app-tabs a { display: grid; justify-items: center; align-content: center; gap: 3px; color: var(--android-muted); font-size: 12px; font-weight: 550; }
.app-tabs svg { font-size: 22px; }
.app-tabs a:active { background: var(--android-tint); }
.app-tabs .router-link-exact-active { color: var(--android-accent); font-weight: 650; }

.app-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  margin: 0;
  height: 100dvh;
  max-height: none;
  width: min(87vw, 340px);
  max-width: none;
  padding: 0;
  border: 0;
  border-radius: 0 26px 26px 0;
  background: var(--android-canvas);
  color: var(--android-text);
  box-shadow: 12px 0 44px var(--android-shadow);
}
.app-drawer::backdrop { background: rgba(22, 22, 23, 0.36); }
.drawer-content { padding: 20px var(--android-gutter); }
.drawer-heading, .drawer-identity { display: flex; align-items: center; gap: 12px; }
.drawer-heading { justify-content: space-between; font-size: 20px; letter-spacing: -0.025em; }
.drawer-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: var(--android-tint); color: var(--android-accent); font-size: 12px; font-weight: 700; }
.connection { margin: 12px 0 20px; color: var(--android-muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.drawer-actions { overflow: hidden; border: 1px solid var(--android-line); border-radius: 18px; background: var(--android-surface); }
.drawer-actions > a, .drawer-actions > button { display: flex; gap: 13px; align-items: center; width: 100%; min-height: 50px; padding-inline: 14px; text-align: left; color: inherit; font-size: 15px; }
.drawer-actions > :not(:first-child) { border-top: 1px solid var(--android-line); }
.drawer-actions > :active { background: var(--android-tint); }
.drawer-actions svg { flex: none; font-size: 20px; color: var(--android-accent); }
</style>

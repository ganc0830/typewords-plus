<script setup lang="ts">
import { BaseIcon, ToastComponent } from '@/base'
import Logo from '@/components/Logo.vue'
import IeDialog from '@/components/dialog/IeDialog.vue'
import useTheme from '@/core/hooks/theme.ts'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { ShortcutKey } from '@/core/types/enum.ts'
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useInit } from '@/core/composables/useInit.ts'
import { Supabase } from '@/core/utils/supabase.ts'
import MiniProgram from '@/components/MiniProgram.vue'
import WordCollectPopover from '@/components/word/WordCollectPopover.vue'
import AndroidSelectionActions from '@/components/word/AndroidSelectionActions.vue'
import AndroidNavigation from '@/components/AndroidNavigation.vue'
import { isAndroidApp, mobileStatus } from '@/core/utils/mobile-sync'
const androidApp = isAndroidApp()

const router = useRouter()
const { toggleTheme, getTheme, setTheme } = useTheme()
const runtimeStore = useRuntimeStore()
const settingStore = useSettingStore()
let expand = $ref(false)
const init = useInit()

function toggleExpand(n: boolean) {
  expand = n
  document.documentElement.style.setProperty('--aside-width', n ? '14rem' : '4.5rem')
}

/** 应用页面主题，并让 Android 的系统栏颜色与图标一起更新。 */
function applyTheme(theme: string) {
  setTheme(theme)
  if (androidApp) {
    ;(window as any).TypeWordsAndroid?.setSystemBarsDark?.(getTheme() === 'dark')
  }
}

watch(
  () => settingStore.load,
  n => {
    if (!n) return
    toggleExpand(settingStore.sideExpand)
    applyTheme(settingStore.theme)
  }
)

watch(
  () => settingStore.theme,
  n => {
    applyTheme(n)
  }
)

const route = useRoute()

const showIcon = $computed(() => {
  return ['/words', '/articles', '/setting', '/help', '/doc', '/feedback'].includes(route.path)
})

onMounted(() => {
  if (androidApp) applyTheme(settingStore.theme)
  init()
  window.umami?.track('sync', { check: Supabase.check() })
})

function onMouseEnter() {
  !settingStore.sideExpand && toggleExpand(true)
}

function onMouseLeave() {
  !settingStore.sideExpand && toggleExpand(false)
}
</script>

<template>
  <div class="layout anim" :class="{ 'android-shell': androidApp, 'android-tab-page': androidApp && ['/words', '/articles', '/library'].includes(route.path) }">
    <AndroidNavigation v-if="androidApp" />
    <!--    第一个aside 占位用-->
    <div v-if="!androidApp" class="aside space"></div>
    <div v-if="!androidApp" class="aside fixed" :class="!expand && 'hidden-span'" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
      <div class="top p-4">
        <div v-if="expand" class="flex justify-between">
          <Logo />
          <BaseIcon
            class="transform-scale-80 border border-1 border-solid border-gray"
            @click="settingStore.sideExpand = !settingStore.sideExpand"
          >
            <IconFluentPin24Filled
              v-if="settingStore.sideExpand"
              class="flex-shrink-0 -transform-rotate-45 color-gray"
            />
            <IconFluentPin20Regular v-else class="flex-shrink-0 -transform-rotate-45" />
          </BaseIcon>
        </div>
        <NuxtLink to="/words" class="row">
          <IconFluentTextUnderlineDouble20Regular />
          <span>{{ $t('words') }}</span>
        </NuxtLink>
        <NuxtLink id="article" to="/articles" class="row">
          <IconFluentBookLetter20Regular />
          <span>{{ $t('articles') }}</span>
        </NuxtLink>
        <NuxtLink to="/library" class="row">
          <IconFluentBookLetter20Regular />
          <span>Library</span>
        </NuxtLink>
        <NuxtLink v-if="!androidApp" to="/feedback" class="row">
          <IconFluentCommentEdit20Regular />
          <span>{{ $t('feedback') }}</span>
        </NuxtLink>
        <NuxtLink v-if="!androidApp" to="/doc" class="row">
          <IconFluentDocument20Regular />
          <span>{{ $t('document') }}</span>
        </NuxtLink>
        <NuxtLink v-if="!androidApp" to="/help" class="row">
          <IconFluentQuestionCircle20Regular />
          <span>{{ $t('help') }}</span>
        </NuxtLink>
        <!--        <div class="row" @click="router.push('/user')">-->
        <!--          <IconFluentPerson20Regular/>-->
        <!--          <span >用户</span>-->
        <!--        </div>-->
      </div>
      <div class="px-4 pb-2 border-0 border-t-1 border-solid border-[var(--color-line)]">
        <NuxtLink to="/setting" class="row">
          <IconFluentSettings20Regular />
          <span>{{ $t('setting') }}</span>
          <div class="red-point" :class="!settingStore.sideExpand && 'top-1 right-0'" v-if="runtimeStore.isError"></div>
        </NuxtLink>
      </div>
    </div>

    <!-- 移动端顶部菜单栏 -->
    <div v-if="!androidApp" class="mobile-top-nav" :class="{ collapsed: settingStore.mobileNavCollapsed }">
      <div class="nav-items">
        <div v-if="!androidApp" class="nav-item" @click="router.push('/')" :class="{ active: route.path === '/' }">
          <IconFluentHome20Regular />
          <span>{{ $t('home_page') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/words')" :class="{ active: route.path?.includes('/words') }">
          <IconFluentTextUnderlineDouble20Regular />
          <span>{{ $t('words') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/articles')" :class="{ active: route.path?.includes('/articles') }">
          <IconFluentBookLetter20Regular />
          <span>{{ $t('articles') }}</span>
        </div>
        <div class="nav-item" @click="router.push('/library')" :class="{ active: route.path === '/library' }">
          <IconFluentBookLetter20Regular />
          <span>Library</span>
        </div>
        <div v-if="!androidApp" class="nav-item" @click="router.push('/setting')" :class="{ active: route.path === '/setting' }">
          <IconFluentSettings20Regular />
          <span>{{ $t('setting') }}</span>
          <div class="red-point" v-if="runtimeStore.isError"></div>
        </div>
      </div>
      <div class="nav-toggle" @click="settingStore.mobileNavCollapsed = !settingStore.mobileNavCollapsed">
        <IconFluentChevronDown20Filled v-if="!settingStore.mobileNavCollapsed" />
        <IconFluentChevronUp20Filled v-else />
      </div>
    </div>

    <IeDialog />

    <div class="flex-1 z-1 relative main-content overflow-x-hidden">
      <NuxtLink v-if="!androidApp" to="/mobile-sync" class="block text-sm px-4 py-2 color-link">{{ mobileStatus }} · Sync</NuxtLink>
      <div
        class="mt-3 center relative z-9999 pointer-events-none"
        @click="router.push('/setting?index=6 ')"
        v-if="runtimeStore.isError"
      >
        <ToastComponent
          type="error"
          :duration="0"
          :shadow="false"
          :showClose="false"
          :message="$t('sync_failed_toast')"
        />
      </div>
      <!--      <slot></slot>-->
      <router-view></router-view>

      <div class="absolute right-4 top-4 flex z-1 gap-2" v-if="showIcon && !androidApp">
        <MiniProgram v-if="settingStore.load && !settingStore.first" />

        <BaseIcon
          :title="`${$t('toggle_theme')}(${settingStore.shortcutKeyMap[ShortcutKey.ToggleTheme]})`"
          @click="toggleTheme"
        >
          <IconFluentWeatherMoon16Regular v-if="getTheme() === 'light'" />
          <IconFluentWeatherSunny16Regular v-else />
        </BaseIcon>
      </div>
    </div>
    <AndroidSelectionActions v-if="androidApp" />
    <WordCollectPopover />
  </div>
</template>

<style scoped lang="scss">
// 手机原生按钮采用各页面的视觉样式，同时保留浏览器的键盘焦点。
:where(.layout.android-shell) :deep(button) {
  appearance: none;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0;
}

.layout.android-shell {
  // 手机外壳统一提供页面、导航和操作色，桌面样式沿用原变量。
  --android-canvas: #f5f5f7;
  --android-surface: #fff;
  --android-text: #1d1d1f;
  --android-muted: #626267;
  --android-line: #e5e5ea;
  --android-accent: #0071e3;
  --android-on-accent: #fff;
  --android-tint: #eaf3fd;
  --android-shadow: rgba(29, 29, 31, 0.11);
  --android-gutter: clamp(16px, 5vw, 24px);
  --android-header-height: 56px;
  --android-bottom-nav-height: 56px;
  --btn-primary: var(--android-accent);
  --btn-primary-hover: var(--android-accent);
  --btn-orange: var(--android-tint);
  --btn-orange-hover: var(--android-tint);
  display: block;
  min-height: 100dvh;
  background: var(--android-canvas);
  color: var(--android-text);
  font-family: -apple-system, BlinkMacSystemFont, system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;

  .main-content { box-sizing: border-box; padding-top: 0; min-height: calc(100dvh - var(--android-header-height)); }
  &.android-tab-page .main-content { padding-bottom: var(--android-bottom-nav-height); }
  :deep(.page) { width: 100%; max-width: 720px; margin: 0; padding: 12px 0 20px; min-height: 0; }
  :deep(.page > .card) { margin: 0 var(--android-gutter) 14px; border: 1px solid var(--android-line); border-radius: 22px; box-shadow: none; background: var(--android-surface); }
  :deep(.android-list) { display: block; }
  :deep(.android-task-heading) { flex-wrap: wrap; gap: 8px 16px; }
  :deep(.android-task-heading > div) { flex-wrap: wrap; }
  :deep(.android-task-heading .text-xl) { white-space: nowrap; }
  :deep(.base-button.orange) { color: var(--android-accent); }
  :deep(.base-button.primary) { color: var(--android-on-accent); }
  :deep(.android-screen-link) { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; margin-top: 12px; border-radius: 24px; background: var(--android-accent); color: var(--android-on-accent); font-weight: 600; }
  :deep(.library) { max-width: 720px; padding-inline: var(--android-gutter); }
  :deep(.library h1) { font-size: 32px; font-weight: 700; letter-spacing: -0.035em; }
  :deep(.library > p) { color: var(--android-muted); }
  :deep(.shelf) { display: block; overflow: hidden; border: 1px solid var(--android-line); border-radius: 22px; background: var(--android-surface); }
  :deep(.shelf:empty) { display: none; }
  :deep(.shelf .cover) { min-height: 68px; flex-direction: row; align-items: center; gap: 12px; padding: 12px 16px; background: transparent; color: var(--android-text); border: 0; border-radius: 0; box-shadow: none; }
  :deep(.shelf .cover + .cover) { border-top: 1px solid var(--android-line); }
  :deep(.shelf .cover span) { flex: none; margin: 0; color: var(--android-muted); }
}

html.dark .layout.android-shell {
  --android-canvas: #101012;
  --android-surface: #1d1d1f;
  --android-text: #f5f5f7;
  --android-muted: #a5a5aa;
  --android-line: #343437;
  --android-accent: #68b6ff;
  --android-on-accent: #151517;
  --android-tint: #172c41;
  --android-shadow: rgba(0, 0, 0, 0.32);
}

.layout {
  width: 100%;
  height: 100%;
  display: flex;
  background: var(--color-primary);
}

.aside {
  background: var(--color-second);
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: rgb(0 0 0 / 3%) 0px 0px 12px 0px;
  width: var(--aside-width);
  transition: all 0.3s;
  z-index: 2;
  overflow: hidden;

  &.hidden-span {
    span {
      opacity: 0;
    }
  }
  .row {
    @apply cp rounded-md text p-2 my-2 flex items-center gap-2 relative shrink-0 hover:bg-fourth;
    transition: all 0.5s;
    color: var(--color-main-text);

    &.router-link-active {
      background: var(--color-fourth);
    }

    svg {
      @apply shrink-0 text-lg;
    }
    span {
      @apply shrink-0;
    }
  }
}

// 移动端顶部菜单栏
.mobile-top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: var(--color-second);
  border-bottom: 1px solid var(--color-item-border);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  transition: all 0.3s ease;

  .nav-items {
    display: flex;
    justify-content: space-around;
    padding: 0.5rem 0;

    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.5rem;
      cursor: pointer;
      transition: all 0.2s;
      min-height: 44px;
      min-width: 44px;
      justify-content: center;
      position: relative;

      svg {
        font-size: 1.2rem;
        margin-bottom: 0.2rem;
        color: var(--color-main-text);
      }

      span {
        font-size: 0.7rem;
        color: var(--color-main-text);
        text-align: center;
      }

      &.active {
        svg,
        span {
          color: var(--color-select-bg);
        }
      }

      &:active {
        transform: scale(0.95);
      }

      .red-point {
        position: absolute;
        top: 0.2rem;
        right: 0.2rem;
        width: 0.4rem;
        height: 0.4rem;
        background: #ff4444;
        border-radius: 50%;
      }
    }
  }

  .nav-toggle {
    position: absolute;
    bottom: -1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-second);
    border: 1px solid var(--color-item-border);
    border-top: none;
    border-radius: 0 0 0.5rem 0.5rem;
    padding: 0.3rem 0.8rem;
    cursor: pointer;
    transition: all 0.3s;

    svg {
      font-size: 1rem;
      color: var(--color-main-text);
    }

    &:active {
      transform: translateX(-50%) scale(0.95);
    }
  }

  &.collapsed {
    transform: translateY(calc(-100% + 1.5rem));

    .nav-items {
      opacity: 0;
      pointer-events: none;
    }
  }
}

.main-content {
  // 移动端时为主内容区域添加顶部内边距，避免被顶部菜单遮挡
  @media (max-width: 768px) {
    padding-top: 4rem;
  }
}

// 移动端隐藏左侧菜单栏
@media (max-width: 768px) {
  .aside {
    display: none;
  }

  .aside.space {
    display: none;
  }

  .main-content {
    width: 100%;
    margin-left: 0;
  }
}

// 桌面端隐藏移动端顶部菜单栏
@media (min-width: 769px) {
  .mobile-top-nav {
    display: none;
  }
}
</style>

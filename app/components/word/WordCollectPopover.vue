<script setup lang="ts">
import { BaseIcon, BaseInput, Toast } from '@/base'
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useWordOptions } from '@/core/hooks/dict.ts'
import { closeWordCollectPicker, wordCollectPickerState } from '@/core/hooks/useWordCollectPicker.ts'
import type { Dict } from '@/core/types'
import { useDisableEventListener } from '@/core/hooks/event'
import { useBaseStore } from '@/core/stores/base'
import { isDictIdMatch } from '@/core/utils'
import { isAndroidApp } from '@/core/utils/mobile-sync'
import { saveScreeningChanges } from '@/core/utils/screening-journal'

const { t: $t } = useI18n()
const { getCollectibleDicts, addWordToDict, createCustomDict } = useWordOptions()
const canCreateDict = !isAndroidApp()
const store = useBaseStore()
const route = useRoute()
const router = useRouter()

const popoverRef = ref<HTMLElement | null>(null)
const positionStyle = ref({ left: '0px', top: '0px' })
let creatingLoading = $ref(false)
let collectingLoading = $ref(false)
const busy = computed(() => creatingLoading || collectingLoading)
const screening = computed(() => /(?:^|\/)practice-screen(?:\/|$)/.test(route.path))

// 弹层在全局布局中，写入结束前拦住导航，防止新建词书尚未入日志就退出筛词。
const removeNavigationGuard = router.beforeEach(() => !(screening.value && busy.value))

const dictList = computed(() => getCollectibleDicts(wordCollectPickerState.excludeDictId || undefined))

function adjustPosition() {
  nextTick(() => {
    const el = popoverRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = wordCollectPickerState.x - rect.width / 2
    let top = wordCollectPickerState.y
    const padding = 8
    if (left < padding) left = padding
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = wordCollectPickerState.y - rect.height - 16
    }
    positionStyle.value = {
      left: `${left}px`,
      top: `${top}px`,
    }
  })
}

/** 将当前词加入 dict 对应的实际词书，筛词时等待日志落盘，失败仅撤回本次新增。 */
async function selectDict(dict: Dict) {
  const word = wordCollectPickerState.word
  if (!word || busy.value) return
  const target = store.word.bookList.find(item => isDictIdMatch(item, dict.id))
  if (!target) {
    Toast.error($t('add_failed'))
    return
  }
  const previousLength = target.length
  const previousWordCount = target.words.length
  if (!addWordToDict(word, target).ok) {
    Toast.warning($t('already_in_dict'))
    return
  }
  collectingLoading = true
  try {
    if (screening.value) await saveScreeningChanges(undefined, undefined, [target])
    Toast.success($t('add_success'))
    closeWordCollectPicker()
  } catch {
    const index = target.words.findIndex(item => toRaw(item) === toRaw(word))
    if (index >= 0) target.words.splice(index, 1)
    target.length = target.words.length === previousWordCount ? previousLength : target.words.length
    Toast.error(screening.value ? 'Could not save. Reload the page and try again.' : $t('add_failed'))
  } finally {
    collectingLoading = false
  }
}

function selectDictByIndex(index: number) {
  const dict = dictList.value[index]
  if (dict) selectDict(dict)
}

function startCreating() {
  if (busy.value) return
  wordCollectPickerState.creating = true
  wordCollectPickerState.newDictName = ''
}

function cancelCreating() {
  if (busy.value) return
  wordCollectPickerState.creating = false
  wordCollectPickerState.newDictName = ''
}

/** 新建命名词书；筛词时持久化 store 内的副本，失败移除本次创建的空词书。 */
async function confirmCreateDict() {
  if (!canCreateDict || busy.value) return
  creatingLoading = true
  let created: Dict | undefined
  try {
    const result = await createCustomDict(wordCollectPickerState.newDictName)
    if (!result.ok) {
      if (result.reason === 'duplicate') Toast.warning($t('name_already_exists'))
      else if (result.reason === 'api') Toast.error($t('add_failed'))
      return
    }
    // createCustomDict 返回源对象，真正存储的是其 clone，日志和回滚都使用列表实例。
    created = store.word.bookList.find(item => isDictIdMatch(item, result.dict.id))
    if (!created) {
      Toast.error($t('add_failed'))
      return
    }
    if (screening.value) await saveScreeningChanges(undefined, undefined, [created])
    wordCollectPickerState.creating = false
    wordCollectPickerState.newDictName = ''
    Toast.success($t('add_success'))
    nextTick(() => {
      const listEl = popoverRef.value?.querySelector('.dict-list')
      if (listEl) listEl.scrollTop = listEl.scrollHeight
    })
  } catch {
    const index = store.word.bookList.findIndex(item => item === created)
    if (index >= 0 && created?.words.length === 0) store.word.bookList.splice(index, 1)
    Toast.error(screening.value ? 'Could not save. Reload the page and try again.' : $t('add_failed'))
  } finally {
    creatingLoading = false
  }
}

function onDocumentClick(e: MouseEvent) {
  if (busy.value) return
  const el = popoverRef.value
  if (el && !el.contains(e.target as Node)) {
    closeWordCollectPicker()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!wordCollectPickerState.visible) return
  if (busy.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    return
  }

  if (e.key === 'Escape') {
    e.stopPropagation()
    if (wordCollectPickerState.creating) {
      cancelCreating()
    } else {
      closeWordCollectPicker()
    }
    return
  }

  if (wordCollectPickerState.creating) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      confirmCreateDict()
    }
    return
  }

  const digitMatch = e.key.match(/^[1-9]$/)
  if (digitMatch) {
    e.preventDefault()
    e.stopImmediatePropagation()
    selectDictByIndex(Number(digitMatch[0]) - 1)
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown, true)
})

onUnmounted(() => {
  removeNavigationGuard()
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown, true)
})

watch(
  () => [wordCollectPickerState.visible, wordCollectPickerState.x, wordCollectPickerState.y],
  () => {
    if (wordCollectPickerState.visible) adjustPosition()
  }
)

useDisableEventListener(() => wordCollectPickerState.visible)
</script>

<template>
  <Teleport to="body">
    <div v-if="wordCollectPickerState.visible && busy" class="word-collect-blocker" aria-hidden="true" @click.stop />
    <Transition name="fade">
      <div
        v-if="wordCollectPickerState.visible"
        ref="popoverRef"
        class="word-collect-popover"
        :class="{ 'is-busy': busy }"
        :aria-busy="busy"
        :style="positionStyle"
        @click.stop
      >
        <div class="font-medium mb-2 pr-1">{{ $t('collect_to_dict') }}</div>

        <div v-if="dictList.length" class="dict-list">
          <div v-for="(dict, index) in dictList" :key="dict.id" class="dict-item" @click="selectDict(dict)">
            <span class="dict-name">{{ dict.name }}</span>
            <span v-if="index < 9" class="dict-shortcut">{{ $t('shortcut') }} {{ index + 1 }}</span>
          </div>
        </div>

        <div v-if="canCreateDict" class="popover-footer" :class="{ 'has-divider': dictList.length }">
          <div v-if="wordCollectPickerState.creating" class="create-row">
            <BaseInput
              v-model="wordCollectPickerState.newDictName"
              class="flex-1"
              autofocus
              :placeholder="$t('please_enter_dict_name')"
              :maxlength="20"
              @keydown.enter.prevent="confirmCreateDict"
            />
            <BaseIcon class="action-btn" :title="$t('cancel')" @click="cancelCreating">
              <IconFluentDismiss16Regular />
            </BaseIcon>
            <BaseIcon
              class="action-btn"
              :class="{ disabled: !wordCollectPickerState.newDictName.trim() || creatingLoading }"
              :title="$t('confirm')"
              @click="confirmCreateDict"
            >
              <IconFluentCheckmark16Regular />
            </BaseIcon>
          </div>
          <div v-else class="add-dict-btn" @click="startCreating">
            <IconFluentAdd16Regular class="text-base" />
            <span>{{ $t('add_custom_dict') }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.word-collect-blocker {
  position: fixed;
  inset: 0;
  z-index: 10000;
  cursor: progress;
}

.word-collect-popover {
  position: fixed;
  z-index: 10001;
  min-width: 12rem;
  max-width: 18rem;
  background: var(--color-tooltip-bg);
  border: 1px solid var(--color-item-border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  pointer-events: auto;

  &.is-busy {
    cursor: progress;

    .dict-item,
    .add-dict-btn,
    .action-btn,
    .create-row input {
      pointer-events: none;
      opacity: 0.6;
    }
  }
}

.dict-list {
  display: flex;
  flex-direction: column;
  max-height: 16rem;
  overflow-y: auto;
  overflow-x: hidden;
}

.dict-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--color-main-text);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.3s;
  box-sizing: border-box;

  &:hover {
    background-color: var(--color-fourth);

    .dict-shortcut {
      opacity: 1;
    }
  }
}

.dict-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dict-shortcut {
  flex-shrink: 0;
  color: var(--color-gray);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
}

.popover-footer {
  &.has-divider {
    margin-top: 0.375rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-item-border);
  }
}

.add-dict-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--color-gray);
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background-color 0.3s,
    color 0.3s;

  &:hover {
    background-color: var(--color-fourth);
    color: var(--color-main-text);
  }
}

.create-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.action-btn {
  flex-shrink: 0;
  cursor: pointer;

  &.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

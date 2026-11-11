<script setup lang="ts">
import { _getAccomplishDays } from '@/core/utils'
import { BaseButton, BaseInput, InputNumber, Slider, Tooltip, Toast } from '@/base'
import { computed, defineAsyncComponent, watch } from 'vue'
import { useSettingStore } from '@/core/stores/setting'
import ChangeLastPracticeIndexDialog from './ChangeLastPracticeIndexDialog.vue'
import { useRuntimeStore } from '@/core/stores/runtime'

const Dialog = defineAsyncComponent(() => import('@/base/dialog/Dialog.vue'))

const settings = useSettingStore()
const runtimeStore = useRuntimeStore()

const model = defineModel()

const props = defineProps<{
  showLeftOption: boolean
  onConfirm?: () => Promise<void | boolean>
}>()

const emit = defineEmits<{
  ok: []
}>()

let show = $ref(false)
let tempPerDayStudyNumber = $ref(0)
let tempWordReviewRatio = $ref(0)
let tempLastLearnIndex = $ref(0)
// 词书仅保留目录元数据时，仍以已知总数限制学习位置。
const wordCount = computed(() => runtimeStore.editDict.words.length || runtimeStore.editDict.length)

async function changePerDayStudyNumber() {
  runtimeStore.editDict.perDayStudyNumber = Number(tempPerDayStudyNumber)
  runtimeStore.editDict.lastLearnIndex = Number(tempLastLearnIndex)
  settings.wordReviewRatio = tempWordReviewRatio
  return props?.onConfirm?.()
}

watch(
  () => model.value,
  n => {
    if (n) {
      if (runtimeStore.editDict.id) {
        tempPerDayStudyNumber = runtimeStore.editDict.perDayStudyNumber
        tempLastLearnIndex = runtimeStore.editDict.lastLearnIndex
        if (tempLastLearnIndex >= wordCount.value) tempLastLearnIndex = wordCount.value
        tempWordReviewRatio = settings.wordReviewRatio
      } else {
        Toast.warning($t('please_select_dict'))
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <Dialog
    v-model="model"
    :title="$t('learning_settings')"
    padding
    fit-viewport
    :footer="true"
    :onConfirm="changePerDayStudyNumber"
    @ok="emit('ok')"
  >
    <div class="target-modal color-main" id="mode">
      <div class="study-settings-summary">
        <span>{{ $t('total') }} <strong>{{ wordCount }}</strong> {{ $t('words_count') }}</span>
        <span>{{ $t('estimated') }} <strong>{{ _getAccomplishDays(wordCount - tempLastLearnIndex, tempPerDayStudyNumber) }}</strong> {{ $t('days_to_complete') }}</span>
      </div>

      <div class="study-settings-field">
        <div class="study-settings-label">
          <span>{{ $t('learning_progress') }}</span>
          <BaseInput v-model="tempLastLearnIndex" class="study-settings-number" inputmode="numeric" :aria-label="$t('learning_progress')" />
        </div>
        <Slider :min="0" :max="wordCount" show-text v-model="tempLastLearnIndex" />
        <BaseButton type="info" class="study-settings-picker" @click="show = true">{{ $t('select_from_dict') }}</BaseButton>
      </div>

      <div class="study-settings-field">
        <div class="study-settings-label">
          <span>{{ $t('daily_learning') }}</span>
          <BaseInput v-model="tempPerDayStudyNumber" class="study-settings-number" inputmode="numeric" :aria-label="$t('daily_learning')" />
        </div>
        <Slider :min="1" :max="500" show-text v-model="tempPerDayStudyNumber" />
      </div>

      <div class="study-settings-field">
        <div class="study-settings-label">
          <Tooltip :title="$t('review_ratio_tooltip')">
            <div class="study-settings-review">
              <span>{{ $t('review_ratio') }}</span>
              <IconFluentQuestionCircle20Regular />
            </div>
          </Tooltip>
          <InputNumber :min="0" :max="10" v-model="tempWordReviewRatio" />
        </div>
        <div class="study-settings-note" v-if="!tempWordReviewRatio">
          <p>{{ $t('review_ratio_notice_1') }}</p>
          <p>{{ $t('review_ratio_notice_2') }}</p>
        </div>
        <p v-else class="study-settings-note">Up to {{ tempPerDayStudyNumber * tempWordReviewRatio }} review words per day</p>
      </div>
    </div>
  </Dialog>
  <ChangeLastPracticeIndexDialog
    v-model="show"
    @ok="
      e => {
        tempLastLearnIndex = e
        show = false
      }
    "
  />
</template>

<style scoped lang="scss">
.target-modal {
  box-sizing: border-box;
  width: 35rem;
  max-width: 100%;
  min-width: 0;
  display: grid;
  gap: 1rem;
  padding-block: 1rem 0.25rem;
}

.study-settings-summary,
.study-settings-note {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--color-sub-text);
  overflow-wrap: anywhere;
}

.study-settings-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
}

.study-settings-field {
  display: grid;
  min-width: 0;
  gap: 0.5rem;
}

.study-settings-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}

.study-settings-review {
  display: flex;
  align-items: center;
  gap: 0.35rem;

  svg {
    flex-shrink: 0;
  }
}

.study-settings-label > .study-settings-number {
  width: 7rem;
  max-width: 100%;
  min-height: 2.75rem;
  font-variant-numeric: tabular-nums;

  :deep(input) {
    min-width: 0;
    text-align: center;
  }
}

.study-settings-picker {
  justify-self: start;
  max-width: 100%;
  white-space: normal;
}

@media (max-width: 480px) {
  .study-settings-picker {
    justify-self: stretch;
    min-height: 2.75rem;
  }
}
</style>

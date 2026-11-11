<script setup lang="ts">
import { computed } from 'vue'
import { Option, Select, Slider, Switch, VolumeIcon } from '@/base'
import SettingItem from './SettingItem.vue'
import SoundMasterControl from './SoundMasterControl.vue'
import { useSettingStore } from '@/core/stores/setting.ts'
import { ENV, SoundFileOptions } from '@/core/config/env.ts'
import { getAudioFileUrl, usePlayAudio, useTTsPlayAudio } from '@/core/hooks/sound.ts'
import { selectedSpeechVoice, speechVoices, type SpeechVoice } from '#shared/speech-voices'
import {
  useSoundMasterSettings,
  SOUND_VOLUME_ITEMS,
  SOUND_SPEED_ITEMS,
} from '@/core/composables/useSoundMasterSettings.ts'

const settingStore = useSettingStore()
const {
  volumeExpanded,
  volumeIsUnified,
  volumeMaster,
  volumeToggleExpanded,
  speedExpanded,
  speedIsUnified,
  speedMaster,
  speedToggleExpanded,
} = useSoundMasterSettings()

const showVolumeSubsInSections = computed(() => !volumeIsUnified.value && !volumeExpanded.value)
const showSpeedSubsInSections = computed(() => !speedIsUnified.value && !speedExpanded.value)
const showVolumeSubsInMaster = computed(() => volumeExpanded.value)
const showSpeedSubsInMaster = computed(() => speedExpanded.value)

const voice = computed<SpeechVoice>({
  get: () => selectedSpeechVoice(settingStore.speechVoice, settingStore.soundType),
  set: value => {
    settingStore.speechVoice = value
    settingStore.soundType = speechVoices[value].accent
  },
})
const exampleText = 'It was a quiet morning. She opened the window and listened to the birds in the garden.'
const speak = useTTsPlayAudio()

/** 用与正式练习相同的本地音源试听，选择前也可以比较两种口音。 */
function previewTtsVoice(voice: SpeechVoice) {
  speak(exampleText, {
    voice,
    volume: settingStore.sentenceSoundVolume / 100,
    rate: settingStore.sentenceSoundSpeed,
  })
}
</script>

<template>
  <div>
    <!-- 总音量 / 总倍速 -->
    <SoundMasterControl
      v-model="volumeMaster"
      type="volume"
      :is-unified="volumeIsUnified"
      :expanded="volumeExpanded"
      :show-subs-in-master="showVolumeSubsInMaster"
      :items="SOUND_VOLUME_ITEMS"
      @toggle-expanded="volumeToggleExpanded()"
    />
    <SoundMasterControl
      v-model="speedMaster"
      type="speed"
      :is-unified="speedIsUnified"
      :expanded="speedExpanded"
      :show-subs-in-master="showSpeedSubsInMaster"
      :items="SOUND_SPEED_ITEMS"
      @toggle-expanded="speedToggleExpanded()"
    />

    <div class="line"></div>

    <!-- 单词发音 -->
    <SettingItem :mainTitle="$t('word_pronunciation')" />

    <SettingItem :title="$t('word_auto_pronunciation')">
      <Switch v-model="settingStore.wordSound" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('volume')">
      <Slider v-model="settingStore.wordSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('speed')">
      <Slider v-model="settingStore.wordSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>

    <!-- 例句发音 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('sentence_pronunciation')" />
    <SettingItem :title="$t('auto_play_first_sentence')" :desc="$t('auto_play_first_sentence_desc')">
      <Switch v-model="settingStore.autoPlayFirstSentence" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('sentence_volume')">
      <Slider v-model="settingStore.sentenceSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('sentence_speed')">
      <Slider v-model="settingStore.sentenceSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>
    <SettingItem title="Pronunciation voice" desc="Applies to words, examples, and reading aloud. Tap the speaker to preview.">
      <Select v-model="voice" class="w-82!">
        <Option v-for="(item, id) in speechVoices" :key="id" :label="item.name" :value="id">
          <div class="flex justify-between items-center w-full">
            <span>{{ item.name }}</span>
            <VolumeIcon :time="100" @click.stop="previewTtsVoice(id)" />
          </div>
        </Option>
      </Select>
    </SettingItem>

    <!-- 文章音效 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('article_sound_settings')" />
    <SettingItem :title="$t('auto_play_sentence')">
      <Switch v-model="settingStore.articleSound" />
    </SettingItem>
    <SettingItem :title="$t('play_next_after_end')">
      <Switch v-model="settingStore.articleAutoPlayNext" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('article_volume')">
      <Slider v-model="settingStore.articleSoundVolume" showText showValue unit="%" />
    </SettingItem>
    <SettingItem v-if="showSpeedSubsInSections" :title="$t('article_speed')">
      <Slider v-model="settingStore.articleSoundSpeed" :step="0.1" :min="0.5" :max="3" showText showValue />
    </SettingItem>

    <!-- 按键音效 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('keyboard_sound_settings')" />
    <SettingItem :title="$t('keyboard_sound')">
      <Switch v-model="settingStore.keyboardSound" />
    </SettingItem>
    <SettingItem :title="$t('keyboard_sound_effect')">
      <Select v-model="settingStore.keyboardSoundFile" :placeholder="$t('please_select')" class="w-50!">
        <Option v-for="item in SoundFileOptions" :key="item.value" :label="item.label" :value="item.value">
          <div class="flex justify-between items-center w-full">
            <span>{{ item.label }}</span>
            <VolumeIcon :time="100" @click="usePlayAudio(ENV.RESOURCE_URL + getAudioFileUrl(item.value)[0])" />
          </div>
        </Option>
      </Select>
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('volume')">
      <Slider v-model="settingStore.keyboardSoundVolume" showText showValue unit="%" />
    </SettingItem>

    <!-- 效果音 -->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('effect_sound_settings')" />
    <SettingItem :title="$t('effect_sound')">
      <Switch v-model="settingStore.effectSound" />
    </SettingItem>
    <SettingItem v-if="showVolumeSubsInSections" :title="$t('effect_volume')">
      <Slider v-model="settingStore.effectSoundVolume" showText showValue unit="%" />
    </SettingItem>
  </div>
</template>

<style scoped lang="scss">
.line {
  border-bottom: 1px solid var(--color-line, #c4c3c3);
  margin: 0.8rem 0;
}
</style>

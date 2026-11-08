<script setup lang="ts">
import { ref } from 'vue'
import { isAndroidApp, mobileBusy, mobileConflicts, mobileRequest, mobileStatus, synchronizeMobile } from '@/core/utils/mobile-sync'
import { useBaseStore } from '@/core/stores/base'
import { useSettingStore } from '@/core/stores/setting'
import { speechVoices, selectedSpeechVoice } from '#shared/speech-voices'
import { localSpeechUrl, splitSpeechText } from '@/core/hooks/sound'
const pair = ref<any>()
const choices = ref<Record<string, 'local' | 'remote'>>({})
const settings = useSettingStore()
const voiceProgress = ref('')
const downloading = ref(false)
const stopAudio = ref(false)
/** 下载当前书架的选定音色，逐条请求避免同时占满电脑语音服务。 */
async function downloadVoices() {
  if (downloading.value) return
  const health = await mobileRequest('health')
  if (!health.online) { voiceProgress.value = '电脑服务器离线，暂时不能下载声音。'; return }
  downloading.value = true
  stopAudio.value = false
  const store = useBaseStore()
  const texts = new Set<string>()
  for (const book of store.word.bookList) for (const word of book.words) texts.add(word.word)
  for (const book of store.article.bookList) for (const article of book.articles) {
    const sentences = article.sections?.flat().map(sentence => sentence.text) || []
    for (const text of sentences.length ? sentences : splitSpeechText(article.text || '')) texts.add(text)
  }
  const voice = selectedSpeechVoice(settings.speechVoice, settings.soundType)
  let completed = 0
  try {
    for (const text of texts) {
      if (stopAudio.value) break
      for (const part of splitSpeechText(text)) {
        const response = await fetch(localSpeechUrl(part, voice), { signal: AbortSignal.timeout(60000) })
        if (!response.ok || (await response.blob()).size < 44) { voiceProgress.value = '语音下载失败，已下载的声音已保存，可以稍后重试。'; return }
      }
      voiceProgress.value = `已下载 ${++completed}/${texts.size} 条语音`
    }
  } catch { voiceProgress.value = '连接中断，已下载的声音已保存。' }
  finally { downloading.value = false }
}
/** 显示本机配对信息，Android 则打开原生连接设置。 */
async function connect() {
  if (isAndroidApp()) (window as any).TypeWordsAndroid.configure()
  else pair.value = await mobileRequest('pair')
}
</script>
<template>
  <main class="p-6 max-w-4xl mx-auto">
    <h1 class="text-2xl mb-4">电脑与手机同步</h1>
    <p role="status" class="my-4">{{ mobileStatus }}</p>
    <div class="flex gap-4 flex-wrap">
      <button class="border rounded p-3" @click="connect">{{ isAndroidApp() ? '连接电脑' : '查看手机配对码' }}</button>
      <button class="border rounded p-3" :disabled="mobileBusy" @click="synchronizeMobile(false)">{{ isAndroidApp() ? '检查并下载最新资料' : '同步电脑资料' }}</button>
      <button v-if="isAndroidApp()" class="border rounded p-3" :disabled="mobileBusy" @click="synchronizeMobile(true)">上传学习进度</button>
    </div>
    <div v-if="pair" class="my-6">
      <p v-for="address in pair.addresses" :key="address">电脑地址 {{ address }}</p>
      <p class="break-all">配对码 {{ pair.token }}</p>
    </div>
    <section v-if="isAndroidApp()" class="my-6">
      <label>离线发音 <select v-model="settings.speechVoice"><option v-for="(voice, key) in speechVoices" :value="key" :key="key">{{ voice.name }}</option></select></label>
      <button class="border rounded p-3 ml-3" :disabled="downloading" @click="downloadVoices">下载所选声音</button>
      <button v-if="downloading" class="p-3" @click="stopAudio = true">停止下载</button>
      <p>{{ voiceProgress }}</p>
    </section>
    <div v-if="mobileConflicts.length" class="my-6">
      <p>以下进度在两端均有修改，请逐项选择。</p>
      <div v-for="item in mobileConflicts" :key="item.path" class="my-4 border rounded p-3">
        <p class="break-all">{{ item.path }}</p>
        <label class="block"><input v-model="choices[item.path]" type="radio" value="local"> 保留本机 {{ JSON.stringify(item.local) }}</label>
        <label class="block"><input v-model="choices[item.path]" type="radio" value="remote"> 保留对端 {{ JSON.stringify(item.remote) }}</label>
      </div>
      <button class="border rounded p-3" :disabled="mobileBusy || mobileConflicts.some(item => !choices[item.path])" @click="synchronizeMobile(isAndroidApp(), choices)">确认合并</button>
    </div>
  </main>
</template>

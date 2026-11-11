/** 全局可选的离线音色。旧版只保存口音，默认转换到对应的 Kokoro 女声。 */
export const speechVoices = {
  'kokoro-af_heart': { name: 'Kokoro · Heart (US, female)', engine: 'kokoro', accent: 'us' },
  'kokoro-bf_emma': { name: 'Kokoro · Emma (UK, female)', engine: 'kokoro', accent: 'uk' },
  'kokoro-bm_george': { name: 'Kokoro · George (UK, male)', engine: 'kokoro', accent: 'uk' },
  'chatterbox-nano': { name: 'Chatterbox Nano · default', engine: 'chatterbox', accent: 'us' },
} as const

export type SpeechVoice = keyof typeof speechVoices

export function selectedSpeechVoice(value: unknown, accent?: string): SpeechVoice {
  if (typeof value === 'string' && Object.hasOwn(speechVoices, value)) return value as SpeechVoice
  return accent === 'uk' ? 'kokoro-bf_emma' : 'kokoro-af_heart'
}

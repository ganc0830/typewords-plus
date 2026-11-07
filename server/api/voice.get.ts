import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { defineEventHandler, getQuery, setResponseStatus, setHeader } from 'h3'
import { synthesizeLocalSpeech } from '../utils/local-speech'
import { selectedSpeechVoice, speechVoices } from '#shared/speech-voices'

const run = promisify(execFile)
const speechHost = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
// 固定代码接收 Base64 环境变量。文本只传给 Speak，不参与 PowerShell 命令解析。
const program = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$m=New-Object IO.MemoryStream;try{$s.SelectVoice('Microsoft Zira Desktop');$s.SetOutputToWaveStream($m);$s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TYPEWORDS_SPEAK)));$s.SetOutputToNull();[Console]::OpenStandardOutput().Write($m.ToArray(),0,[int]$m.Length)}finally{$s.Dispose();$m.Dispose()}`
const encodedProgram = Buffer.from(program, 'utf16le').toString('base64')
let active = 0

/** 仅供同机网页按需生成英文 WAV。限制输入、并发和超时，音频允许浏览器本地缓存。 */
export default defineEventHandler(async event => {
  const query = getQuery(event)
  const q = query.audio
  if (typeof q !== 'string' || !q.trim() || q.length > 512) { setResponseStatus(event, 400); return '' }
  if (query.voice !== undefined && (typeof query.voice !== 'string' || !Object.hasOwn(speechVoices, query.voice))) {
    setResponseStatus(event, 400)
    return ''
  }
  const voice = selectedSpeechVoice(query.voice, query.type === '1' ? 'uk' : 'us')
  if (active >= 3) { setResponseStatus(event, 429); return '' }
  active++
  try {
    const input = Buffer.from(q, 'utf8').toString('base64')
    const python = process.env.TYPEWORDS_BOOK_PYTHON
    const parser = process.env.TYPEWORDS_BOOK_PARSER
    const natural = !!(python && parser && process.env.TYPEWORDS_VOICE_DIR)
    const stdout = natural
      ? await synthesizeLocalSpeech(python, join(dirname(parser), 'speak.py'), q, voice)
      : (await run(speechHost, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encodedProgram], {
          env: { ...process.env, TYPEWORDS_SPEAK: input },
          encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 12 * 1024 * 1024,
        })).stdout
    if (stdout.subarray(0,4).toString() !== 'RIFF') { setResponseStatus(event,502); return '' }
    setHeader(event,'Content-Type','audio/wav')
    setHeader(event, 'X-TypeWords-Voice', natural ? voice : 'windows-sapi')
    setHeader(event,'Cache-Control','private, max-age=604800')
    return stdout
  } catch (error) {
    console.error('离线语音合成失败', (error as Error).name)
    setResponseStatus(event,503)
    return ''
  } finally { active-- }
})

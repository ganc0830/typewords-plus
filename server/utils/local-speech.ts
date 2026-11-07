import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { speechVoices, type SpeechVoice } from '#shared/speech-voices'

type PendingSpeech = {
  resolve: (wav: Buffer) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
type SpeechEngine = (typeof speechVoices)[SpeechVoice]['engine']
type SpeechWorker = {
  child: ChildProcessWithoutNullStreams
  pending: Map<number, PendingSpeech>
  idle?: ReturnType<typeof setTimeout>
}
const workers = new Map<SpeechEngine, SpeechWorker>()
let requestId = 0

/** 结束故障进程及其等待请求，下一次调用可以重新加载。 */
function resetWorker(engine: SpeechEngine, worker: SpeechWorker, message: string) {
  if (workers.get(engine) !== worker) return
  workers.delete(engine)
  clearTimeout(worker.idle)
  for (const item of worker.pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error(message))
  }
  worker.pending.clear()
  worker.child.kill()
}

/** 两种模型使用各自的依赖和子进程。重复发音复用模型，空闲后回收。 */
export function synthesizeLocalSpeech(python: string, script: string, text: string, voice: SpeechVoice) {
  const engine = speechVoices[voice].engine
  // 切换引擎时卸载闲置的旧模型，避免两套权重长时间占用内存。
  for (const [otherEngine, otherWorker] of workers) {
    if (otherEngine === engine || otherWorker.pending.size) continue
    workers.delete(otherEngine)
    clearTimeout(otherWorker.idle)
    otherWorker.child.stdin.end()
  }
  let worker = workers.get(engine)
  if (!worker) {
    const models = process.env.TYPEWORDS_VOICE_DIR ?? ''
    const child = spawn(python, ['-B', script], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: join(dirname(models), 'voice-libs', engine),
        TYPEWORDS_VOICE_ENGINE: engine,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
      },
    })
    const current: SpeechWorker = { child, pending: new Map() }
    worker = current
    workers.set(engine, current)
    child.stderr.resume()
    child.stdin.on('error', () => resetWorker(engine, current, 'Speech input failed'))
    child.on('error', () => resetWorker(engine, current, 'Speech worker unavailable'))
    child.on('close', () => resetWorker(engine, current, 'Speech worker closed'))
    createInterface({ input: child.stdout }).on('line', line => {
      if (workers.get(engine) !== current) return
      try {
        const result = JSON.parse(line)
        const item = current.pending.get(result.id)
        if (!item) return
        clearTimeout(item.timer)
        current.pending.delete(result.id)
        if (typeof result.wav === 'string') item.resolve(Buffer.from(result.wav, 'base64'))
        else item.reject(new Error('Speech synthesis failed'))
        if (!current.pending.size) {
          current.idle = setTimeout(() => {
            if (workers.get(engine) !== current || current.pending.size) return
            workers.delete(engine)
            child.stdin.end()
          }, 90_000)
          current.idle.unref()
        }
      } catch {
        resetWorker(engine, current, 'Invalid speech response')
      }
    })
  }
  const current = worker
  clearTimeout(current.idle)
  return new Promise<Buffer>((resolve, reject) => {
    const id = ++requestId
    const timer = setTimeout(() => resetWorker(engine, current, 'Speech generation timed out'), engine === 'chatterbox' ? 150_000 : 95_000)
    current.pending.set(id, { resolve, reject, timer })
    current.child.stdin.write(JSON.stringify({ id, text, voice }) + '\n')
  })
}

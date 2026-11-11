import { get, update } from 'idb-keyval'
import { nanoid } from 'nanoid'
import type { BaseState } from '../stores/base'
import type { Dict } from '../types'
import { getDefaultDict } from '../types'
import { isSameDictResource } from './index'

export const SCREENING_JOURNAL_KEY = 'typewords-screen-pending'
export type ScreeningPosition = { nextIndex: number; done: number; added: number }

type ScreeningProgress = {
  identity: Pick<Dict, 'id' | 'enName'>
  lastLearnIndex: number
  complete: boolean
  position?: ScreeningPosition
}
type ScreeningJournal = {
  revision: string
  updatedAt: string
  progress: ScreeningProgress[]
  collections: Dict[]
}

let screeningRevision: string | undefined
let writes: Promise<void> = Promise.resolve()

/** 返回当前内存已覆盖的日志版本，完整保存只可清理这个版本。 */
export function getScreeningRevision(): string | undefined {
  return screeningRevision
}

/** 完整保存成功后仅清除对应的内存版本，不影响等待期间产生的新日志。 */
export function markScreeningSaved(expectedRevision: string): void {
  if (screeningRevision === expectedRevision) screeningRevision = undefined
}

/** 等待本页面已经发起的日志写入，失败由操作调用方回滚并提示。 */
export function waitForScreeningWrites(): Promise<void> {
  return writes
}

/** 将 progressBook 的位置及 collections 的词单快照原子追加到轻量日志。 */
export function saveScreeningChanges(
  progressBook?: Dict,
  position?: ScreeningPosition,
  collections: Dict[] = []
): Promise<void> {
  // 入队前固定本次值，避免等待前一笔写入时又读到后续界面修改。
  const progress: ScreeningProgress | undefined = progressBook ? {
    identity: { id: progressBook.id, enName: progressBook.enName },
    lastLearnIndex: progressBook.lastLearnIndex,
    complete: progressBook.complete,
    position: position ? { ...position } : undefined,
  } : undefined
  const snapshots: Dict[] = JSON.parse(JSON.stringify(collections))
  const write = writes.then(async () => {
    const revision = nanoid()
    let coversPrevious = false
    let concurrentChange = false
    await update<ScreeningJournal>(SCREENING_JOURNAL_KEY, previous => {
      coversPrevious = !previous || previous.revision === screeningRevision
      // 同一词单或词书被其它标签修改时，保留原日志并让当前操作回滚。
      if (previous && !coversPrevious && (
        snapshots.some(book => previous.collections.some(item => isSameDictResource(item, book))) ||
        (progress && previous.progress.some(item => isSameDictResource(item.identity, progress.identity)))
      )) {
        concurrentChange = true
        return previous
      }
      const pending = {
        revision,
        updatedAt: new Date().toISOString(),
        progress: [...(previous?.progress ?? [])],
        collections: [...(previous?.collections ?? [])],
      }
      if (progress) {
        const index = pending.progress.findIndex(item => isSameDictResource(item.identity, progress.identity))
        if (index >= 0) pending.progress[index] = progress
        else pending.progress.push(progress)
      }
      for (const collection of snapshots) {
        const index = pending.collections.findIndex(item => isSameDictResource(item, collection))
        if (index >= 0) pending.collections[index] = collection
        else pending.collections.push(collection)
      }
      return pending
    })
    if (concurrentChange) return Promise.reject(new Error('Screening changed in another tab. Reload before continuing.'))
    // 其它标签页的日志尚未合入当前 state 时，保留日志供下次恢复。
    screeningRevision = coversPrevious ? revision : undefined
  })
  writes = write.catch(() => undefined)
  return write
}

/** 将日志合入已升级的 state，恢复独立筛词位置并返回最新保存时间。 */
export async function restoreScreeningChanges(state: BaseState): Promise<string | undefined> {
  await waitForScreeningWrites()
  const pending = await get<ScreeningJournal>(SCREENING_JOURNAL_KEY)
  if (!pending) { screeningRevision = undefined; return }
  if (typeof pending.revision !== 'string' || !Array.isArray(pending.progress) || !Array.isArray(pending.collections)) {
    console.warn('Invalid screening journal. Keeping it for recovery.')
    screeningRevision = undefined
    return
  }
  for (const collection of pending.collections) {
    const existing = state.word.bookList.find(book => isSameDictResource(book, collection))
    if (existing) {
      existing.words = collection.words
      existing.length = collection.words.length
    } else if (collection.custom) {
      state.word.bookList.push(getDefaultDict(collection))
    }
  }
  for (const progress of pending.progress) {
    const book = state.word.bookList.find(item => isSameDictResource(item, progress.identity))
    if (!book) continue
    book.lastLearnIndex = progress.lastLearnIndex
    book.complete = progress.complete
    if (progress.position) {
      try { localStorage.setItem('typewords-screen:' + book.id, JSON.stringify(progress.position)) }
      catch (error) { console.warn('Could not restore the screening position.', error) }
    }
  }
  screeningRevision = pending.revision
  return pending.updatedAt
}

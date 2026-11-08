import { getMany } from 'idb-keyval'
import type { Dict } from '../types'
import { getDictIdentityList } from './index'

export const WORD_BOOK_PROGRESS_PREFIX = 'typing-word-book-progress:'
type Progress = Pick<Dict, 'lastLearnIndex' | 'perDayStudyNumber' | 'complete' | 'statistics'>
type Backup = { progress: Progress; updatedAt: string }

/** 取单本词书的学习位置、每日目标和历史，不复制词条或全局词单。 */
export function wordBookProgress(book: Dict): Progress {
  return {
    lastLearnIndex: book.lastLearnIndex,
    perDayStudyNumber: book.perDayStudyNumber,
    complete: book.complete,
    statistics: book.statistics,
  }
}

/** 生成与主数据同事务保存的逐书副本，同时保留旧版英文名查找入口。 */
export function wordBookProgressEntries(books: Dict[], updatedAt: string): [string, string][] {
  return books.flatMap(book => {
    const value = JSON.stringify({ progress: wordBookProgress(book), updatedAt } satisfies Backup)
    return getDictIdentityList(book).map(id => [WORD_BOOK_PROGRESS_PREFIX + id, value] as [string, string])
  })
}

/** 词书从列表移除后，再添加时按同一身份读回最近一次副本。 */
export async function readWordBookProgress(book: Dict): Promise<Progress | undefined> {
  const identities = getDictIdentityList(book)
  if (!identities.length) return
  const rows = await getMany<string>(identities.map(id => WORD_BOOK_PROGRESS_PREFIX + id))
  let newest: Backup | undefined
  for (const row of rows) {
    if (!row) continue
    try {
      const value: Backup = JSON.parse(row)
      if (value?.progress && (!newest || value.updatedAt > newest.updatedAt)) newest = value
    } catch (error) {
      console.warn('无法读取词书进度副本', error)
    }
  }
  return newest?.progress
}

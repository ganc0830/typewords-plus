import type { Word } from '../types/types'
import { withAppBaseURL } from './base-url'

type Details = Omit<Word, 'id' | 'word' | 'custom'>

/** 通过同源服务查词。区分未收录与联网故障，方便批量导入汇报结果。 */
export async function lookupWordDetails(word: string, signal?: AbortSignal): Promise<
  { details: Details; error?: never } | { details?: never; error: string }
> {
  try {
    const query = new URLSearchParams({ word })
    const response = await fetch(withAppBaseURL('/api/word-details') + '?' + query, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    })
    const result = await response.json()
    if (response.ok && Array.isArray(result.trans)) return { details: result }
    return { error: result.error || 'The online dictionary is unavailable. Try again shortly.' }
  } catch {
    return { error: 'The online dictionary is unavailable. Check your connection and try again.' }
  }
}

/** 只填写空白字段，保留原拼写、词条身份及已有手写内容。 */
export function fillWordDetails(word: Word, details: Details): Word {
  return {
    ...word,
    phonetic0: word.phonetic0?.trim() ? word.phonetic0 : details.phonetic0,
    phonetic1: word.phonetic1?.trim() ? word.phonetic1 : details.phonetic1,
    trans: word.trans?.length ? word.trans : details.trans,
    sentences: word.sentences?.length ? word.sentences : details.sentences,
    phrases: word.phrases?.length ? word.phrases : details.phrases,
    synos: word.synos?.length ? word.synos : details.synos,
    relWords: word.relWords?.root || word.relWords?.rels?.length ? word.relWords : details.relWords,
    etymology: word.etymology?.length ? word.etymology : details.etymology,
  }
}

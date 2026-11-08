import { defineEventHandler, getQuery, setHeader, setResponseStatus } from 'h3'
import type { Word } from '../../app/core/types/types'

const endpoint = 'https://api.typewords.cc/public.word/query'
let active = 0

/** 仅把用户主动查询的英文词发给 TypeWords，并返回词条所需字段。 */
export default defineEventHandler(async event => {
  const query = getQuery(event).word
  const word = typeof query === 'string' ? query.trim().replace(/’/g, "'").toLowerCase() : ''
  if (!word || word.length > 100 || !/^[a-z0-9][a-z0-9 .'+/&-]*$/i.test(word)) {
    setResponseStatus(event, 400)
    return { error: '请输入英文单词或词组。' }
  }
  if (active >= 8) {
    setResponseStatus(event, 429)
    return { error: '查询过于频繁，请稍后重试。' }
  }
  active++
  try {
    const url = new URL(endpoint)
    url.searchParams.set('word', word)
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' })
    if (!response.ok && response.status !== 404) {
      setResponseStatus(event, 502)
      return { error: '在线词典暂不可用。' }
    }
    const result: { success?: boolean; data?: Partial<Word> & { rel_words?: Word['relWords'] } } =
      response.ok ? await response.json() : {}
    const item = result.data
    if (!result.success || item?.word?.toLowerCase() !== word) {
      setResponseStatus(event, 404)
      return { error: '找不到这个词，请检查拼写。' }
    }
    const related = item.relWords ?? item.rel_words
    setHeader(event, 'Cache-Control', 'private, max-age=3600')
    return {
      phonetic0: item.phonetic0 ?? '',
      phonetic1: item.phonetic1 ?? '',
      trans: item.trans ?? [],
      sentences: item.sentences ?? [],
      phrases: item.phrases ?? [],
      synos: item.synos ?? [],
      relWords: related ? { root: related.root ?? '', rels: related.rels ?? [] } : { root: '', rels: [] },
      etymology: item.etymology ?? [],
    } satisfies Omit<Word, 'word'>
  } catch {
    setResponseStatus(event, 502)
    return { error: '在线词典暂不可用，请检查网络后重试。' }
  } finally {
    active--
  }
})

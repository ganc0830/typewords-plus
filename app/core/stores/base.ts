import { defineStore } from 'pinia'
import { type Dict, getDefaultDict, type SaveData, type Word } from '../types'
import { _getStudyProgress, checkAndUpgradeSaveDict, isSameDictResource, parseJsonStr } from '../utils'
import { shallowReactive } from 'vue'
import { get, setMany } from 'idb-keyval'
import { readWordBookProgress, wordBookProgress, wordBookProgressEntries } from '../utils/word-book-progress'
import { restoreScreeningChanges } from '../utils/screening-journal'
import { DictId, IS_DEV, SAVE_DICT_KEY } from '../config/env'
import type { Card } from 'ts-fsrs'
import { useSettingStore } from './setting.ts'

export interface BaseState {
  simpleWords: string[]
  load: boolean
  word: {
    studyIndex: number
    bookList: Dict[]
  }
  article: {
    bookList: Dict[]
    studyIndex: number
  }
  dictListVersion: number
  fsrsData: Record<string, Card>
  noteData: Record<string, string> // 集中存储单词笔记，key 为单词字符串
  _ignoreWatch: boolean //忽略监听，避免重复保存和上传
}

export const getDefaultBaseState = (): BaseState => ({
  simpleWords: [
    'a',
    'an',
    'i',
    'my',
    'me',
    'you',
    'your',
    'he',
    'his',
    'she',
    'her',
    'it',
    'what',
    'who',
    'where',
    'how',
    'when',
    'which',
    'be',
    'am',
    'is',
    'was',
    'are',
    'were',
    'do',
    'did',
    'can',
    'could',
    'will',
    'would',
    'the',
    'that',
    'this',
    'and',
    'not',
    'no',
    'yes',
    'to',
    'of',
    'for',
    'at',
    'in',
  ],
  load: false,
  word: {
    bookList: [
      getDefaultDict({ id: DictId.wordCollect, enName: DictId.wordCollect, name: '收藏', system: true }),
      getDefaultDict({ id: DictId.wordWrong, enName: DictId.wordWrong, name: '错词', system: true }),
      getDefaultDict({
        id: DictId.wordKnown,
        enName: DictId.wordKnown,
        name: '已掌握',
        description: '已掌握后的单词不会出现在练习中',
        system: true,
      }),
    ],
    studyIndex: -1,
  },
  article: {
    bookList: [
      getDefaultDict({ id: DictId.articleCollect, enName: DictId.articleCollect, name: '收藏', system: true }),
    ],
    studyIndex: -1,
  },
  dictListVersion: 1,
  fsrsData: {},
  noteData: {},
  _ignoreWatch: false,
})

export const useBaseStore = defineStore('base', {
  state: (): BaseState => {
    return getDefaultBaseState()
  },
  getters: {
    collectWord(): Dict {
      let res = this.word.bookList.find(v => [v.enName, v.id].includes(DictId.wordCollect))
      return res ?? getDefaultDict()
    },
    collectArticle(): Dict {
      let res = this.article.bookList.find(v => [v.enName, v.id].includes(DictId.articleCollect))
      return res ?? getDefaultDict()
    },
    wrong(): Dict {
      let res = this.word.bookList.find(v => [v.enName, v.id].includes(DictId.wordWrong))
      return res ?? getDefaultDict()
    },
    known(): Dict {
      let res = this.word.bookList.find(v => [v.enName, v.id].includes(DictId.wordKnown))
      return res ?? getDefaultDict()
    },
    knownWords(): string[] {
      return this.known.words.map((v: Word) => v.word.toLowerCase())
    },
    allIgnoreWords(): string[] {
      return this.known.words
        .map((v: Word) => v.word.toLowerCase())
        .concat(this.simpleWords.map((v: string) => v.toLowerCase()))
    },
    knownWordsSet(): Set<string> {
      return new Set<string>(this.known.words.map((v: Word) => v.word))
    },
    allIgnoreWordsSet(): Set<string> {
      return new Set<string>(this.known.words.map((v: Word) => v.word).concat(this.simpleWords.map((v: string) => v)))
    },
    sdict(): Dict {
      if (this.word.studyIndex >= 0) {
        return this.word.bookList[this.word.studyIndex] ?? getDefaultDict()
      }
      return getDefaultDict()
    },
    groupLength(): number {
      return Math.ceil(this.sdict.length / this.sdict.perDayStudyNumber)
    },
    currentGroup(): number {
      //当能除尽时，应该加1
      let s = this.sdict.lastLearnIndex % this.sdict.perDayStudyNumber
      let d = this.sdict.lastLearnIndex / this.sdict.perDayStudyNumber
      return Math.floor(s === 0 ? d + 1 : d)
    },
    currentStudyProgress(): number {
      if (!this.sdict.length) return 0
      return _getStudyProgress(this.sdict.lastLearnIndex, this.sdict.length)
    },
    sbook(): Dict {
      return this.article.bookList[this.article.studyIndex] ?? getDefaultDict()
    },
    currentBookProgress(): number {
      if (!this.sbook.length) return 0
      if (this.sbook.complete) return 100
      return _getStudyProgress(this.sbook.lastLearnIndex, this.sbook.length)
    },
  },
  actions: {
    getIgnoreWordsSet(): Set<string> {
      let settingStore = useSettingStore()
      return [this.allIgnoreWordsSet, this.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1]
    },
    setState(obj: BaseState) {
      obj.word.bookList.map(book => {
        book.words = shallowReactive(book.words)
        book.articles = shallowReactive(book.articles)
        book.statistics = shallowReactive(book.statistics)
      })
      obj.article.bookList.map(book => {
        book.words = shallowReactive(book.words)
        book.articles = shallowReactive(book.articles)
        book.statistics = shallowReactive(book.statistics)
      })
      //必须先 reset, 只 $patch 无法将 state 恢复到默认值
      this.$reset()
      console.time('$patch')
      if (IS_DEV) {
        this.$state = obj
      } else {
        this.$patch(obj)
      }
      console.timeEnd('$patch')
    },
    async init(): Promise<SaveData | null> {
      return new Promise(async resolve => {
        try {
          let jsonStr: string = await get(SAVE_DICT_KEY.key)
          if (jsonStr) {
            let result = await parseJsonStr(jsonStr, checkAndUpgradeSaveDict)
            const screeningUpdatedAt = await restoreScreeningChanges(result.val)
            if (screeningUpdatedAt && (!result.updated_at || screeningUpdatedAt > result.updated_at)) result.updated_at = screeningUpdatedAt
            // console.log('data', data)
            this.setState(result.val)
            // 首次升级时也给现有词书建立副本，主数据可读时仍可继续学习。
            try {
              await setMany(wordBookProgressEntries(this.word.bookList, result.updated_at ?? new Date().toISOString()))
            } catch (error) {
              console.warn('词书进度副本写入失败', error)
            }
            resolve(result)
          } else {
            const restored = getDefaultBaseState()
            const updated_at = await restoreScreeningChanges(restored)
            if (updated_at) {
              this.setState(restored)
              resolve({ val: restored, version: SAVE_DICT_KEY.version, updated_at })
            }
          }
          resolve(null)
        } catch (e) {
          console.error('读取本地dict数据失败', e)
          resolve(null)
        }
      })
    },
    /** 优先使用列表中的进度，重新添加同一本词书时再读取本机副本。 */
    async getSavedWordBookProgress(val: Dict) {
      const saved = this.word.bookList.find(book => isSameDictResource(book, val))
      if (saved) return wordBookProgress(saved)
      return await readWordBookProgress(val)
    },
    /** 切换词书默认沿用进度。applySettings 仅用于用户确认过的起点及每日目标。 */
    async changeDict(val: Dict, applySettings = false) {
      const rIndex = this.word.bookList.findIndex(book => isSameDictResource(book, val))
      const saved = this.word.bookList[rIndex]
      const progress = saved ? wordBookProgress(saved) : await readWordBookProgress(val)
      const words = val.words?.length ? val.words : saved?.words ?? []
      const length = words.length || val.length
      const requestedIndex = applySettings ? val.lastLearnIndex : progress?.lastLearnIndex ?? val.lastLearnIndex
      const requestedDaily = applySettings ? val.perDayStudyNumber : progress?.perDayStudyNumber ?? val.perDayStudyNumber
      const lastLearnIndex = Math.max(0, Math.min(Math.trunc(
        Number.isFinite(requestedIndex) ? requestedIndex : progress?.lastLearnIndex ?? 0
      ), length))
      const perDayStudyNumber = Math.min(Math.max(1, Math.trunc(
        Number.isFinite(requestedDaily) ? requestedDaily : progress?.perDayStudyNumber ?? 20
      )), length)
      const samePosition = lastLearnIndex === progress?.lastLearnIndex
      const complete = length > 0 && (lastLearnIndex >= length ||
        ((!applySettings || samePosition) && (progress?.complete ?? val.complete)))

      //把其他的词典的单词数据都删掉，全保存在内存里太卡了
      this.word.bookList.slice(3).map(v => {
        if (!v.custom) {
          v.words = shallowReactive([])
        }
      })
      if (saved) {
        this.word.studyIndex = rIndex
        Object.assign(saved, {
          words: shallowReactive(words), id: val.id, enName: val.enName,
          length, perDayStudyNumber, lastLearnIndex, userDictId: val.userDictId, complete,
        })
      } else {
        this.word.bookList.push(getDefaultDict({
          ...val, words, length, lastLearnIndex, perDayStudyNumber, complete,
          statistics: progress?.statistics ?? val.statistics,
        }))
        this.word.studyIndex = this.word.bookList.length - 1
      }
    },
    //改变书籍
    async changeBook(val: Dict) {
      //把其他的书籍里面的文章数据都删掉，全保存在内存里太卡了
      this.article.bookList.slice(1).map(v => {
        if (!v.custom) {
          v.articles = shallowReactive([])
        }
      })
      if (val.articles?.length) {
        val.length = val.articles.length
      }
      if (val.lastLearnIndex > val.length) {
        val.lastLearnIndex = val.length
        val.complete = true
      }
      let rIndex = this.article.bookList.findIndex((v: Dict) => isSameDictResource(v, val))
      if (rIndex > -1) {
        this.article.studyIndex = rIndex
        //不要整个等于，不然统计没了
        // this.article.bookList[this.article.studyIndex] = getDefaultDict(val)
        this.article.bookList[this.article.studyIndex].articles = shallowReactive(val.articles)
        this.article.bookList[this.article.studyIndex].id = val.id
        this.article.bookList[this.article.studyIndex].enName = val.enName
        this.article.bookList[this.article.studyIndex].length = val.length
        this.article.bookList[this.article.studyIndex].cover = val.cover
        this.article.bookList[this.article.studyIndex].name = val.name
        this.article.bookList[this.article.studyIndex].description = val.description
      } else {
        this.article.bookList.push(getDefaultDict(val))
        this.article.studyIndex = this.article.bookList.length - 1
      }
    },
  },
})

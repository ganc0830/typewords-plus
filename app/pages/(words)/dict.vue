<script setup lang="tsx">
import { isAndroidApp } from '@/core/utils/mobile-sync'
import {
  BackIcon,
  BaseButton,
  BaseIcon,
  BaseInput,
  BasePage,
  DeleteIcon,
  Form,
  FormItem,
  PopConfirm,
  Textarea,
  Toast,
} from '@/base'
import EditBook from '@/components/article/EditBook.vue'
import BaseTable from '@/components/BaseTable.vue'
import PracticeSettingDialog from '@/components/word/PracticeSettingDialog.vue'
import WordItem from '@/components/word/WordItem.vue'
import { flushStatToStore, usePracticeWordPersistence } from '@/core/composables/usePracticePersistence'
import { useDataSyncPersistence } from '@/core/composables/useDataSyncPersistence'
import { DICT_LIST, LIB_JS_URL, TourConfig } from '@/core/config/env.ts'
import { getCurrentStudyWord } from '@/core/hooks/dict.ts'
import { useBaseStore } from '@/core/stores/base.ts'
import { useRuntimeStore } from '@/core/stores/runtime.ts'
import { useSettingStore } from '@/core/stores/setting.ts'
import { Sort, WordPracticeMode } from '@/core/types/enum.ts'
import { getDefaultDict, getDefaultWord } from '@/core/types/func.ts'
import type { Dict, Word } from '@/core/types/types.ts'
import {
  _getDictDataByUrl,
  _nextTick,
  convertToWord,
  ensureCustomDictCopy,
  getDictDisplayName,
  isMobile,
  loadJsLib,
  resourceWrap,
  reverse,
  shuffle,
  useNav,
} from '@/core/utils'
import { getPracticeWordCacheLocal } from '@/core/utils/cache.ts'
import { fillWordDetails, lookupWordDetails } from '@/core/utils/word-details'
import saveAs from 'file-saver'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const runtimeStore = useRuntimeStore()
const wordPersistence = usePracticeWordPersistence()
const base = useBaseStore()
const persistence = useDataSyncPersistence()
const router = useRouter()
const route = useRoute()
const isMob = isMobile()
const { t: $t } = useI18n()
let loading = $ref(false)
let allList = $ref([])

const getDefaultFormWord = () => {
  return {
    id: '',
    word: '',
    phonetic0: '',
    phonetic1: '',
    note: '',
    trans: '',
    sentences: '',
    phrases: '',
    synos: '',
    relWords: '',
    etymology: '',
  }
}
let isOperate = $ref(false)
let wordForm = $ref(getDefaultFormWord())
let wordFormRef = $ref()
const wordRules = reactive({
  word: [
    { required: true, message: 'Enter a word.', trigger: 'blur' },
    { max: 100, message: 'Use at most 100 characters.', trigger: 'blur' },
  ],
})
let studyLoading = $ref(false)
let officialWordSnapshot = $ref<Word | null>(null)
let wordSearchLoading = $ref(false)
let enrichingWord = $ref<string | null>(null)

function resetWordForm() {
  wordForm = getDefaultFormWord()
  officialWordSnapshot = null
}

function wordContentKey(word: Word) {
  return JSON.stringify({
    word: word.word,
    phonetic0: word.phonetic0 ?? '',
    phonetic1: word.phonetic1 ?? '',
    trans: word.trans ?? [],
    sentences: word.sentences ?? [],
    phrases: word.phrases ?? [],
    synos: word.synos ?? [],
    relWords: word.relWords ?? { root: '', rels: [] },
    etymology: word.etymology ?? [],
  })
}

function isSameWordContent(a: Word, b: Word) {
  return wordContentKey(a) === wordContentKey(b)
}

function onWordFormWordChange(value: string) {
  wordForm.word = value
  if (officialWordSnapshot && value !== officialWordSnapshot.word) {
    officialWordSnapshot = null
  }
}

/** 搜索图标补全表单，底部按钮可同时保存当前词条。 */
async function searchOfficialWord(save = false) {
  const word = wordForm.word?.trim()
  if (!word || word.length > 100) {
    Toast.warning('Enter an English word or phrase of 1 to 100 characters.')
    return
  }
  if (wordSearchLoading || enrichingWord !== null) return
  const form = wordForm
  const bookId = runtimeStore.editDict.id
  wordSearchLoading = true
  try {
    const result = await lookupWordDetails(word)
    if (wordForm !== form || wordForm.word.trim() !== word || runtimeStore.editDict.id !== bookId) return
    if (!result.details) {
      Toast.warning(result.error)
      return
    }
    const current = convertToWord({ ...wordForm, word })
    const filled = fillWordDetails(current, result.details)
    if (save) {
      const entry = getDefaultWord({ ...filled, id: wordForm.id || getDefaultWord().id, custom: true })
      if (await saveEnrichedWord(entry, bookId, wordForm.id, wordForm.note)) {
        if (wordForm === form) {
          if (form.id) editWord(entry)
          else resetWordForm()
        }
        Toast.success(form.id ? 'Completed and saved.' : 'Completed and added.')
      }
    } else {
      wordForm = { ...word2Str(filled), note: form.note }
      officialWordSnapshot = convertToWord({ ...wordForm })
    }
  } finally {
    wordSearchLoading = false
  }
}

/** 把补全结果写入原词书，保留词书 ID、学习位置和词条顺序。 */
async function saveEnrichedWord(entry: Word, bookId: Dict['id'], originalId?: Word['id'], note?: string) {
  const index = base.word.bookList.findIndex(book => book.id === bookId && (book.custom || book.system))
  if (index < 0) {
    Toast.warning('No editable wordbook found.')
    return false
  }
  const book = base.word.bookList[index]
  const position = originalId ? book.words.findIndex(word => word.id === originalId) : -1
  if (originalId && position < 0) {
    Toast.warning('This entry was removed. Refresh the list.')
    return false
  }
  if (book.words.some((word, i) => i !== position && word.word.trim().toLowerCase() === entry.word.toLowerCase())) {
    Toast.warning('This word already exists.')
    return false
  }
  const words = [...book.words]
  if (originalId) words[position] = entry
  else words.push(entry)
  const oldNote = base.noteData[entry.word]
  if (note?.trim()) base.noteData[entry.word] = note.trim()
  base.word.bookList[index] = getDefaultDict({ ...book, words, length: words.length })
  const updated = base.word.bookList[index]
  try {
    await persistence.saveDictState(base.$state, { canSyncRemote: false })
  } catch {
    if (base.word.bookList[index] === updated) base.word.bookList[index] = book
    if (note?.trim() && base.noteData[entry.word] === note.trim()) {
      if (oldNote === undefined) delete base.noteData[entry.word]
      else base.noteData[entry.word] = oldNote
    }
    Toast.warning('Could not save. Try again.')
    return false
  }
  if (runtimeStore.editDict.id === bookId) {
    runtimeStore.editDict = getDefaultDict(updated)
    allList = runtimeStore.editDict.words
    tableRef.value?.getData()
  }
  return true
}

/** 已保存词条可直接补全，同时保留编辑区里正在输入的内容。 */
async function enrichSavedWord(word: Word) {
  if (wordSearchLoading || enrichingWord !== null || !word.id) return
  const bookId = runtimeStore.editDict.id
  enrichingWord = String(word.id)
  try {
    const result = await lookupWordDetails(word.word)
    if (runtimeStore.editDict.id !== bookId) return
    if (!result.details) {
      Toast.warning(result.error)
      return
    }
    const current = allList.find(item => item.id === word.id && item.word === word.word)
    if (!current) return
    const filled = fillWordDetails(current, result.details)
    if (isSameWordContent(current, filled)) {
      Toast.success('This entry is already complete.')
      return
    }
    if (await saveEnrichedWord(filled, bookId, current.id)) {
      if (wordForm.id === current.id && wordForm.word === current.word) {
        const details = word2Str(filled)
        for (const key of Object.keys(details) as Array<keyof typeof wordForm>) {
          if (typeof wordForm[key] === 'string' && !wordForm[key].trim()) wordForm[key] = details[key]
        }
      }
      Toast.success('Entry completed.')
    }
  } finally {
    enrichingWord = null
  }
}

function syncDictInMyStudyList(study = false) {
  _nextTick(() => {
    const originalId = runtimeStore.editDict.id

    runtimeStore.editDict.words = allList
    const dict = runtimeStore.editDict
    let temp = dict.custom || dict.system ? getDefaultDict(dict) : ensureCustomDictCopy(dict)
    let rIndex = base.word.bookList.findIndex(v => v.id === originalId)
    temp.length = temp.words.length
    runtimeStore.editDict = temp
    if (rIndex > -1) {
      base.word.bookList[rIndex] = getDefaultDict(temp)
      if (study) base.word.studyIndex = rIndex
    } else {
      base.word.bookList.push(getDefaultDict(temp))
      if (study) base.word.studyIndex = base.word.bookList.length - 1
    }
    tableRef.value.getData()
  }, 100)
}

async function onSubmitWord() {
  // return console.log('wordFormRef',wordFormRef,wordFormRef.validate)
  await wordFormRef.validate(valid => {
    if (valid) {
      let data: any = convertToWord(wordForm)
      data.custom = !officialWordSnapshot || !isSameWordContent(data, officialWordSnapshot)
      // 笔记集中存储，不保存在 Word 对象内
      const noteVal = wordForm.note?.trim()
      const wordKey = wordForm.word
      if (noteVal) {
        base.noteData[wordKey] = noteVal
      } else {
        delete base.noteData[wordKey]
      }
      //todo 可以检查的更准确些，比如json对比
      if (data.id) {
        let r = allList.find(v => v.id === data.id)
        if (r) {
          Object.assign(r, data)
          Toast.success('Changes saved.')
        } else {
          Toast.success('Could not find the word to update.')
          return
        }
      } else {
        data.id = allList.length + 1
        data.checked = false
        let r = allList.find(v => v.word === wordForm.word)
        if (r) {
          Toast.warning('This word already exists.')
          return
        } else allList.push(data)
        Toast.success('Added.')
        resetWordForm()
      }
      syncDictInMyStudyList()
    } else {
      Toast.warning('Complete the required fields.')
    }
  })
}

async function batchDel(ids: string[]) {
  let localHandle = () => {
    ids.map(id => {
      let rIndex2 = allList.findIndex(v => v.id === id)
      if (rIndex2 > -1) {
        if (id === wordForm.id) {
          resetWordForm()
        }
        allList.splice(rIndex2, 1)
      }
    })
    tableRef.value.getData()
    syncDictInMyStudyList()
  }
  localHandle()
}

//把word对象的字段全转成字符串
function word2Str(word) {
  let res = getDefaultFormWord()
  res.id = word.id
  res.word = word.word
  res.phonetic1 = word.phonetic1
  res.phonetic0 = word.phonetic0
  res.note = base.noteData[word.word] ?? ''
  res.trans = word.trans.map(v => (v.pos + v.cn).replaceAll('"', '')).join('\n')
  res.sentences = word.sentences.map(v => (v.c + '\n' + v.cn).replaceAll('"', '')).join('\n\n')
  res.phrases = word.phrases.map(v => (v.c + '\n' + v.cn).replaceAll('"', '')).join('\n\n')
  res.synos = word.synos.map(v => (v.pos + v.cn + '\n' + v.ws.join('/')).replaceAll('"', '')).join('\n\n')
  res.relWords = word.relWords.root
    ? 'Root: ' +
      word.relWords.root +
      '\n\n' +
      word.relWords.rels
        .map(v => (v.pos + '\n' + v.words.map(v => v.c + ':' + v.cn).join('\n')).replaceAll('"', ''))
        .join('\n\n')
    : ''
  res.etymology = word.etymology.map(v => (v.t + '\n' + v.d).replaceAll('"', '')).join('\n\n')
  return res
}

function editWord(word) {
  isOperate = true
  wordForm = word2Str(word)
  officialWordSnapshot = word.custom ? null : convertToWord({ ...wordForm, id: word.id })
  if (isMob) activeTab = 'edit'
}

function addWord() {
  // setTimeout(wordListRef?.scrollToBottom, 100)
  isOperate = true
  resetWordForm()
  if (isMob) activeTab = 'edit'
}

function closeWordForm() {
  isOperate = false
  resetWordForm()
  if (isMob) activeTab = 'list'
}

let isEdit = $ref(false)
let isAdd = $ref(false)
let activeTab = $ref<'list' | 'edit'>('list') // 移动端标签页状态
let _copyData: Dict | null = null // createCopy 生成的副本数据，作为 initialData 传给 EditBook

const showBookDetail = computed(() => {
  return !(isAdd || isEdit)
})

function createCopy() {
  // 生成副本数据，不写入 store。经由 initialData 传给 EditBook，确认后才写入
  const copy = ensureCustomDictCopy(runtimeStore.editDict)
  copy.name = runtimeStore.editDict.name + ' (Copy)'
  _copyData = copy
  isAdd = true
}

onMounted(async () => {
  if (route.query?.isAdd) {
    isAdd = true
    runtimeStore.editDict = getDefaultDict()
  } else {
    if (!runtimeStore.editDict.id) {
      return router.push('/words')
    } else {
      // 目录只有默认值，设置对话框打开前应显示这本书已保存的进度。
      const progress = await base.getSavedWordBookProgress(runtimeStore.editDict)
      if (progress) Object.assign(runtimeStore.editDict, progress)
      if (!runtimeStore.editDict.words.length && !runtimeStore.editDict.custom && !runtimeStore.editDict.system) {
        loading = true
        let dictList = await fetch(resourceWrap(DICT_LIST.WORD.ALL)).then(r => r.json())
        let dict = await _getDictDataByUrl(runtimeStore.editDict)
        let r = dictList.find(v => [v.enName, v.id].includes(runtimeStore.editDict.id))
        if (r) {
          runtimeStore.editDict.words = dict.words
          runtimeStore.editDict.id = r.id
          runtimeStore.editDict.enName = r.enName
          runtimeStore.editDict.cover = r.cover
          runtimeStore.editDict.category = r.category
          runtimeStore.editDict.tags = r.tags
          runtimeStore.editDict.url = r.url
          runtimeStore.editDict.description = r.description
          runtimeStore.editDict.name = r.name
        } else {
          runtimeStore.editDict = dict
        }
        runtimeStore.editDict.length = dict.words.length
      }
      loading = false
    }
  }

  allList = runtimeStore.editDict.words
  tableRef.value.getData()
})

function formClose() {
  if (isEdit) {
    isEdit = false
  } else if (isAdd) {
    _copyData = null
    isAdd = false
  } else {
    router.back()
  }
}

function handleSubmit() {
  _copyData = null
  isEdit = false
  isAdd = false
}

let showPracticeSettingDialog = $ref(false)

const store = useBaseStore()
const settingStore = useSettingStore()
const { nav } = useNav()

//todo 可以和首页合并
async function startPractice(query = {}) {
  // debugger
  //这里重置一下，因为下面切换词典后，导致学习进度为0，而切换前的模式有可能需要有进度才可以用
  if (![WordPracticeMode.Free, WordPracticeMode.System].includes(settingStore.wordPracticeMode)) {
    settingStore.wordPracticeMode = WordPracticeMode.System
  }
  // 切换词典前，先将进行中的练习统计落库，避免学习记录丢失
  const cache = await getPracticeWordCacheLocal()
  if (cache) {
    flushStatToStore((cache as any)?.statStoreData)
    await wordPersistence.clear()
  }
  await base.changeDict(runtimeStore.editDict, true)
  window.umami?.track('startStudyWord', {
    name: store.sdict.name,
    index: store.sdict.lastLearnIndex,
    perDayStudyNumber: store.sdict.perDayStudyNumber,
    custom: store.sdict.custom,
    complete: store.sdict.complete,
    wordPracticeMode: settingStore.wordPracticeMode,
  })
  let currentStudy = getCurrentStudyWord()
  nav('practice-words/' + store.sdict.id, query, { taskWords: currentStudy })
}

/** 打开设置前读取当前词书进度，避免沿用详情页挂载时的旧快照。 */
async function addMyStudyList() {
  if (studyLoading) return
  const selected = runtimeStore.editDict
  if (!selected.words.length) {
    return Toast.warning('There are no words to study.')
  }
  studyLoading = true
  try {
    const progress = await base.getSavedWordBookProgress(selected)
    if (runtimeStore.editDict !== selected) return
    if (progress) Object.assign(selected, progress)
    showPracticeSettingDialog = true
  } catch {
    Toast.warning('Could not load saved study progress. Try again.')
  } finally {
    studyLoading = false
  }
}

async function startTest() {
  loading = true
  //这里重置一下，因为下面切换词典后，导致学习进度为0，而切换前的模式有可能需要有进度才可以用
  if (![WordPracticeMode.Free, WordPracticeMode.System].includes(settingStore.wordPracticeMode)) {
    settingStore.wordPracticeMode = WordPracticeMode.System
  }
  await base.changeDict(runtimeStore.editDict)
  loading = false
  nav('words-test/' + store.sdict.id, {}, {})
}

let exportXlsxLoading = $ref(false)
let exportJsonLoading = $ref(false)

let tableRef = ref()

function goImportPage() {
  nav('/import', {
    type: 'word',
    targetId: String(runtimeStore.editDict.id),
    step: '2',
  })
}

async function exportXlsxData() {
  if (exportXlsxLoading) return
  exportXlsxLoading = true
  const XLSX = await loadJsLib('XLSX', LIB_JS_URL.XLSX)
  let list = runtimeStore.editDict.words
  let filename = runtimeStore.editDict.name
  let wb = XLSX.utils.book_new()
  let sheetData = list.map(v => {
    let t = word2Str(v)
    return {
      单词: t.word,
      '音标①': t.phonetic0,
      '音标②': t.phonetic1,
      笔记: t.note,
      翻译: t.trans,
      例句: t.sentences,
      短语: t.phrases,
      近义词: t.synos,
      同根词: t.relWords,
      词源: t.etymology,
    }
  })
  wb.Sheets['Sheet1'] = XLSX.utils.json_to_sheet(sheetData)
  wb.SheetNames = ['Sheet1']
  XLSX.writeFile(wb, `${filename}.xlsx`)
  Toast.success(filename + ' exported.')
  exportXlsxLoading = false
}

async function exportJsonData() {
  if (exportJsonLoading) return
  exportJsonLoading = true
  let list = runtimeStore.editDict.words.map(w => {
    delete w.custom
    delete w.id
    return w
  })
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' })
  saveAs(blob, `${runtimeStore.editDict.name}.json`)
  exportJsonLoading = false
}

watch(
  () => loading,
  val => {
    if (!val) return
    _nextTick(async () => {
      const Shepherd = await loadJsLib('Shepherd', LIB_JS_URL.SHEPHERD)
      const tour = new Shepherd.Tour(TourConfig)
      tour.on('cancel', () => {
        localStorage.setItem('tour-guide', '1')
      })
      tour.addStep({
        id: 'step3',
        text: 'Tap here to start learning.',
        attachTo: { element: '#study', on: 'bottom' },
        buttons: [
          {
            text: `Next (3/${TourConfig.total})`,
            action() {
              tour.next()
              addMyStudyList()
            },
          },
        ],
      })

      tour.addStep({
        id: 'step4',
        text: 'Choose a mode, set your daily goal, or edit your progress here.',
        attachTo: { element: '#mode', on: 'bottom' },
        beforeShowPromise() {
          return new Promise(resolve => {
            const timer = setInterval(() => {
              if (document.querySelector('#mode')) {
                clearInterval(timer)
                setTimeout(resolve, 500)
              }
            }, 100)
          })
        },
        buttons: [
          {
            text: `Next (4/${TourConfig.total})`,
            action: async () => {
              tour.next()
              await startPractice({ guide: 1 })
            },
          },
        ],
      })

      const r = localStorage.getItem('tour-guide')
      if (settingStore.first && !r && !isMobile()) {
        tour.start()
      }
    }, 500)
  }
)

const dict = $computed(() => runtimeStore.editDict)

//获取本地单词列表
function getLocalList({ pageNo, pageSize, searchKey }) {
  let list = allList
  let total = allList.length
  if (searchKey.trim()) {
    list = allList.filter(v => v.word.toLowerCase().includes(searchKey.trim().toLowerCase()))
    total = list.length
  }
  list = list.slice((pageNo - 1) * pageSize, (pageNo - 1) * pageSize + pageSize)
  return { list, total }
}

async function requestList({ pageNo, pageSize, searchKey }) {
  if (!dict.custom && !dict.system && dict.url) {
    // 非自定义词典，直接请求json

    //如果没数据则请求
    if (!allList.length) {
      let r = await _getDictDataByUrl(dict)
      allList = r.words
    }
    return getLocalList({ pageNo, pageSize, searchKey })
  } else {
    // 自定义词典
    allList = dict.words
    return getLocalList({ pageNo, pageSize, searchKey })
  }
}

function onSort(type: Sort, pageNo: number, pageSize: number) {
  let fun = reverse
  if ([Sort.reverse, Sort.reverseAll].includes(type)) {
    fun = reverse
  } else if ([Sort.random, Sort.randomAll].includes(type)) {
    fun = shuffle
  }
  allList = allList
    .slice(0, pageSize * (pageNo - 1))
    .concat(fun(allList.slice(pageSize * (pageNo - 1), pageSize * (pageNo - 1) + pageSize)))
    .concat(allList.slice(pageSize * (pageNo - 1) + pageSize))
  runtimeStore.editDict.words = allList
  Toast.success('Done.')
  tableRef.value.getData()
  syncDictInMyStudyList()
}

const editable = $computed(() => runtimeStore.editDict.custom || runtimeStore.editDict.system)

defineRender(() => {
  return (
    <BasePage>
      {showBookDetail.value ? (
        <div className="card mb-0 dict-detail-card flex flex-col">
          <div class="dict-header flex justify-between items-center relative">
            <BackIcon class="dict-back z-2" />
            <div class="dict-title absolute page-title text-align-center w-full">{getDictDisplayName(runtimeStore.editDict)}</div>
            <div class="dict-actions flex">
              {runtimeStore.editDict.custom ? (
                <BaseButton loading={studyLoading || loading} type="info" onClick={() => (isEdit = true)}>
                  {$t('edit')}
                </BaseButton>
              ) : !isAndroidApp() && (
                <BaseButton loading={studyLoading || loading} type="info" onClick={createCopy}>
                  {$t('create_copy')}
                </BaseButton>
              )}
              {editable && !isAndroidApp() && (
                <BaseButton type="info" onClick={goImportPage}>Import entries</BaseButton>
              )}
              <BaseButton loading={studyLoading || loading} type="info" onClick={startTest}>
                {$t('test')}
              </BaseButton>
              <BaseButton id="study" loading={studyLoading || loading} onClick={addMyStudyList}>
                {$t('learn')}
              </BaseButton>
            </div>
          </div>
          {dict.description && (
            <>
              <div class="text-lg  mt-2">
                {$t('introduction')}：{dict.description}
              </div>
              <div class="line my-3"></div>
            </>
          )}

          {/* 移动端标签页导航 */}
          {isMob && isOperate && (
            <div class="tab-navigation mb-3">
              <div class={`tab-item ${activeTab === 'list' ? 'active' : ''}`} onClick={() => (activeTab = 'list')}>
                {$t('word_list')}
              </div>
              <div class={`tab-item ${activeTab === 'edit' ? 'active' : ''}`} onClick={() => (activeTab = 'edit')}>
                {wordForm.id ? $t('edit') : $t('add')}
                {$t('word')}
              </div>
            </div>
          )}

          <div class="flex flex-1 overflow-hidden content-area">
            <div class={`word-list-section ${isMob && isOperate && activeTab !== 'list' ? 'mobile-hidden' : ''}`}>
              <BaseTable
                ref={tableRef}
                class="h-full"
                request={requestList}
                onDel={batchDel}
                onSort={onSort}
                onAdd={addWord}
                onExportXlsx={exportXlsxData}
                onExportJson={exportJsonData}
                exportXlsxLoading={exportXlsxLoading}
                exportJsonLoading={exportJsonLoading}
                readonly={!editable}
                readonlyTip={$t('create_copy_to_edit')}
              >
                {val => (
                  <WordItem
                    showTransPop={false}
                    onClick={() => editable && editWord(val.item)}
                    index={val.index}
                    showCollectIcon={false}
                    showMarkIcon={false}
                    excludeDictId={runtimeStore.editDict.id}
                    item={val.item}
                  >
                    {{
                      prefix: () => val.checkbox(val.item),
                      suffix: () => (
                        <div class="flex items-start gap-2">
                          {editable && (
                            <button
                              type="button"
                              class="color-link whitespace-nowrap text-sm"
                              disabled={wordSearchLoading || enrichingWord !== null}
                              onClick={event => { event.stopPropagation(); void enrichSavedWord(val.item) }}
                            >
                              {enrichingWord === String(val.item.id) ? 'Looking up…' : 'Complete entry'}
                            </button>
                          )}
                          <div class="flex flex-col">
                            <BaseIcon
                              class="option-icon"
                              disabled={!editable}
                              title={runtimeStore.editDict.custom ? $t('edit') : $t('create_copy_to_edit')}
                              onClick={() => runtimeStore.editDict.custom && editWord(val.item)}
                            >
                              <IconFluentTextEditStyle20Regular />
                            </BaseIcon>
                            {editable ? (
                              <PopConfirm title="Delete this entry?" onConfirm={() => batchDel([val.item.id])}>
                                <BaseIcon class="option-icon" title={$t('delete')}>
                                  <DeleteIcon />
                                </BaseIcon>
                              </PopConfirm>
                            ) : (
                              <BaseIcon class="option-icon" disabled={true} title={$t('create_copy_to_edit')}>
                                <DeleteIcon />
                              </BaseIcon>
                            )}
                          </div>
                        </div>
                      ),
                    }}
                  </WordItem>
                )}
              </BaseTable>
            </div>
            {isOperate ? (
              <div class={`edit-section flex-1 flex flex-col ${isMob && activeTab !== 'edit' ? 'mobile-hidden' : ''}`}>
                <div class="common-title">
                  {wordForm.id ? $t('edit') : $t('add')}
                  {$t('word')}
                </div>
                <Form
                  class="flex-1 overflow-auto pr-2"
                  ref={e => (wordFormRef = e)}
                  rules={wordRules}
                  model={wordForm}
                  label-width="7rem"
                >
                  <FormItem label="Word" prop="word">
                    <BaseInput
                      modelValue={wordForm.word}
                      onUpdate:modelValue={onWordFormWordChange}
                      searchable
                      searchLoading={wordSearchLoading}
                      clearable
                      onSearch={() => searchOfficialWord()}
                      onEnter={() => searchOfficialWord()}
                    />
                  </FormItem>
                  <FormItem label="UK pronunciation">
                    <BaseInput modelValue={wordForm.phonetic0} onUpdate:modelValue={e => (wordForm.phonetic0 = e)} />
                  </FormItem>
                  <FormItem label="US pronunciation">
                    <BaseInput modelValue={wordForm.phonetic1} onUpdate:modelValue={e => (wordForm.phonetic1 = e)} />
                  </FormItem>
                  <FormItem label="Meanings">
                    <Textarea
                      modelValue={wordForm.trans}
                      onUpdate:modelValue={e => (wordForm.trans = e)}
                      placeholder="One meaning per line. Start with the part of speech."
                      autosize={{ minRows: 6, maxRows: 10 }}
                    />
                  </FormItem>
                  <FormItem label="Notes">
                    <Textarea
                      modelValue={wordForm.note}
                      onUpdate:modelValue={e => (wordForm.note = e)}
                      placeholder="Add a note about this word"
                      autosize={{ minRows: 3, maxRows: 8 }}
                    />
                  </FormItem>
                  <FormItem label="Examples">
                    <Textarea
                      modelValue={wordForm.sentences}
                      onUpdate:modelValue={e => (wordForm.sentences = e)}
                      placeholder="Original and translation on separate lines. Leave a blank line between pairs."
                      autosize={{ minRows: 6, maxRows: 10 }}
                    />
                  </FormItem>
                  <FormItem label="Phrases">
                    <Textarea
                      modelValue={wordForm.phrases}
                      onUpdate:modelValue={e => (wordForm.phrases = e)}
                      placeholder="Original and translation on separate lines. Leave a blank line between pairs."
                      autosize={{ minRows: 6, maxRows: 10 }}
                    />
                  </FormItem>
                  <FormItem label="Synonyms">
                    <Textarea
                      modelValue={wordForm.synos}
                      onUpdate:modelValue={e => (wordForm.synos = e)}
                      placeholder="Follow the format of existing entries."
                      autosize={{ minRows: 6, maxRows: 20 }}
                    />
                  </FormItem>
                  <FormItem label="Related words">
                    <Textarea
                      modelValue={wordForm.relWords}
                      onUpdate:modelValue={e => (wordForm.relWords = e)}
                      placeholder="Follow the format of existing entries."
                      autosize={{ minRows: 6, maxRows: 20 }}
                    />
                  </FormItem>
                  <FormItem label="Etymology">
                    <Textarea
                      modelValue={wordForm.etymology}
                      onUpdate:modelValue={e => (wordForm.etymology = e)}
                      placeholder="Follow the format of existing entries."
                      autosize={{ minRows: 6, maxRows: 10 }}
                    />
                  </FormItem>
                </Form>
                <div class="center">
                  <BaseButton type="info" loading={wordSearchLoading} disabled={enrichingWord !== null} onClick={() => searchOfficialWord(true)}>
                    {wordForm.id ? 'Complete and save' : 'Complete and add'}
                  </BaseButton>
                  <BaseButton type="info" onClick={closeWordForm}>
                    {$t('close')}
                  </BaseButton>
                  <BaseButton type="primary" onClick={onSubmitWord}>
                    {$t('save')}
                  </BaseButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div class="card mb-0 dict-detail-card">
          <div class="dict-header flex justify-between items-center relative">
            <BackIcon class="dict-back z-2" onClick={formClose} />
            <div class="dict-title absolute page-title text-align-center w-full">
              {isAdd ? $t('create_dict') : $t('edit_dict')}
            </div>
          </div>
          <div class="center">
            <EditBook
              isAdd={isAdd}
              isBook={false}
              initialData={_copyData}
              onClose={formClose}
              onSubmit={handleSubmit}
            />
          </div>
          {isAdd && !_copyData && (
            <div class="center mt-4">
              <BaseButton type="info" onClick={() => router.push('/import')}>
                Import a spreadsheet or PDF
              </BaseButton>
            </div>
          )}
        </div>
      )}

      <PracticeSettingDialog
        showLeftOption
        modelValue={showPracticeSettingDialog}
        onUpdate:modelValue={val => (showPracticeSettingDialog = val)}
        onConfirm={startPractice}
      />
    </BasePage>
  )
})
</script>

<style scoped lang="scss">
.dict-detail-card {
  height: calc(100vh - 3rem);
}

.dict-header {
  gap: 0.5rem;
}

.dict-actions {
  flex-wrap: wrap;
}

.word-list-section {
  width: 44%;
}

.edit-section {
  margin-left: 1rem;
}

.tab-navigation {
  display: none; // 默认隐藏，移动端显示
}

.mobile-hidden {
  display: none;
}

@media (max-width: 768px) {
  .dict-detail-card {
    height: unset;
    min-height: calc(100vh - 2rem);
    margin-bottom: 0 !important;
  }

  .dict-header {
    width: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.75rem;
  }

  .dict-header .dict-back {
    align-self: flex-start;
  }

  .dict-header .dict-title {
    position: static !important;
    width: 100%;
  }

  .dict-header .dict-actions {
    width: 100%;
    justify-content: center;
    gap: 0.75rem;
  }

  .tab-navigation {
    display: flex;
    border-bottom: 2px solid var(--color-item-border);
    margin-bottom: 1rem;
    gap: 0;

    .tab-item {
      flex: 1;
      padding: 0.75rem 1rem;
      text-align: center;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--color-sub-text);
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.3s ease;
      user-select: none;

      &:active {
        transform: scale(0.98);
      }

      &.active {
        color: var(--color-icon-hightlight);
        border-bottom-color: var(--color-icon-hightlight);
      }
    }
  }

  .content-area {
    flex-direction: column;

    .word-list-section,
    .edit-section {
      width: 100% !important;
      margin-left: 0 !important;
      max-width: 100%;
    }

    .edit-section {
      margin-top: 0;
    }
  }
}

// 超小屏幕适配
@media (max-width: 480px) {
  .dict-detail-card {
    height: unset;
    min-height: calc(100vh - 1rem);
  }

  .tab-navigation {
    .tab-item {
      padding: 0.6rem 0.5rem;
      font-size: 0.9rem;
    }
  }
}
</style>

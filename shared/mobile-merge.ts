export type SyncConflict = { path: string; local: unknown; remote: unknown }

/** 三方合并 base 快照、local 本机与 remote 对端；choices 仅决定明确的冲突项。 */
export function mergeMobileState(base: any, local: any, remote: any, choices: Record<string, 'local' | 'remote'> = {}) {
  const conflicts: SyncConflict[] = []
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  function merge(b: any, l: any, r: any, path: string): any {
    if (equal(l, r) || equal(b, r)) return l
    if (equal(b, l)) return r
    if (Array.isArray(l) && Array.isArray(r)) {
      // 书籍、词条和学习记录按稳定身份合并，两端不同日期的学习不会互相覆盖。
      const field = path.endsWith('/bookList') ? 'id' : path.endsWith('/words') ? 'word' : path.endsWith('/statistics') ? 'startDate' : ''
      if (field && [...l, ...r].every(item => item && item[field] !== undefined)) {
        const identity = (item: any) => String(item[field]).toLowerCase()
        const bm = new Map((Array.isArray(b) ? b : []).map(item => [identity(item), item]))
        const lm = new Map(l.map(item => [identity(item), item]))
        const rm = new Map(r.map(item => [identity(item), item]))
        return [...new Set([...rm.keys(), ...lm.keys()])].map(key => merge(bm.get(key), lm.get(key), rm.get(key), path + '/' + key)).filter(item => item !== undefined)
      }
      if ([...l, ...r].every(item => typeof item === 'string')) return [...new Set([...l, ...r])]
    }
    if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) {
      const result: Record<string, unknown> = {}
      for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
        const value = merge(b?.[key], l[key], r[key], path + '/' + key)
        if (value !== undefined) result[key] = value
      }
      return result
    }
    if (choices[path]) return choices[path] === 'local' ? l : r
    conflicts.push({ path, local: l, remote: r })
    return l
  }
  // 排序后同一个下标可能指向别的书，合并时先使用书籍身份，结束后恢复下标。
  function normalize(state: any) {
    if (!state) return state
    const copy = { ...state }
    for (const kind of ['word', 'article']) {
      if (!state[kind]?.bookList) continue
      const { studyIndex, ...value } = state[kind]
      copy[kind] = { ...value, activeBookId: state[kind].bookList[studyIndex]?.id ?? null }
    }
    return copy
  }
  const state = merge(normalize(base), normalize(local), normalize(remote), '')
  for (const kind of ['word', 'article']) {
    if (!state?.[kind]?.bookList) continue
    state[kind].studyIndex = state[kind].bookList.findIndex((book: any) => book.id === state[kind].activeBookId)
    delete state[kind].activeBookId
  }
  return { state, conflicts }
}

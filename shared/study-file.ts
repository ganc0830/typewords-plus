/** 导入器和本地服务共用格式与 MIME 对照，文件内容由解析器验证。 */
export const studyFileTypes = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
} as const

/** 词书仅从表格行或 PDF 词条提取，文章格式仍由书籍导入处理。 */
export const wordFileTypes = ['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv', 'pdf'] as const

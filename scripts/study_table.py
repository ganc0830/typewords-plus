"""把本地表格转换为逐行配对的 TypeWords 课文。"""

import csv
import io
import re
from itertools import chain, islice
from xml.etree import ElementTree
from zipfile import ZipFile


TABLE_FORMATS = {"xlsx", "xls", "xlsm", "ods", "csv", "tsv"}
EN_HEADERS = {"english", "englishtext", "englishword", "英文", "英语", "英文原文", "英文单词", "英文例句", "英文句子",
              "word", "words", "term", "sentence", "example", "text", "source",
              "单词", "词汇", "原文", "句子", "例句"}
WORD_HEADERS = {"word", "words", "englishword", "term", "headword", "单词", "英文单词", "词汇", "词条", "术语", "英文术语"}
ZH_HEADERS = {"chinese", "chinesetranslation", "中文", "中文释义", "中文翻译", "中文译文", "中文意思", "注解",
              "meaning", "definition", "translation", "translate", "译文", "释义", "翻译", "意思"}
LATIN = re.compile(r"[A-Za-z]")
CJK = re.compile(r"[\u3400-\u9fff]")
ODS_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"


def ods_rows(archive):
    """按 ODS 表格及重复单元格读取，跳过整段空行，限制实际展开范围。"""
    root = ElementTree.fromstring(archive.read("content.xml"))
    spreadsheet = root.find(".//{*}spreadsheet")
    if spreadsheet is None:
        return
    for sheet in spreadsheet.findall(ODS_TABLE + "table"):
        if sheet.get(ODS_TABLE + "display") == "false":
            continue
        rows = []
        for row in sheet.iterfind(".//" + ODS_TABLE + "table-row"):
            values, blanks = [], 0
            for cell in row:
                if cell.tag not in {ODS_TABLE + "table-cell", ODS_TABLE + "covered-table-cell"}:
                    continue
                repeat = int(cell.get(ODS_TABLE + "number-columns-repeated", "1"))
                value = " ".join("".join(part.itertext()) for part in cell.findall("./{*}p")).strip()
                if not value:
                    blanks += repeat
                    continue
                if len(values) + blanks + repeat > 256:
                    yield "", None
                    return
                values.extend([""] * blanks)
                values.extend([value] * repeat)
                blanks = 0
            if values:
                repeat = int(row.get(ODS_TABLE + "number-rows-repeated", "1"))
                if len(rows) + repeat > 50_000:
                    yield "", None
                    return
                rows.extend([values] * repeat)
        if rows:
            yield sheet.get(ODS_TABLE + "name", "工作表"), rows


def delimited_rows(raw, kind):
    """读取 CSV/TSV，识别常见 Unicode 编码及中文 Excel 导出的 GB18030。"""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = raw.decode("utf-16")
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("gb18030")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
        return
    delimiter = "\t" if kind == "tsv" else ","
    if kind == "csv":
        try:
            delimiter = csv.Sniffer().sniff(text[:8192], delimiters=",;").delimiter
        except csv.Error:
            pass
    yield "表格", csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)


def workbook_rows(raw, kind):
    """按工作簿顺序读取可见工作表。宏与公式不执行，只提取已有的单元格值。"""
    from python_calamine import CalamineWorkbook, SheetTypeEnum, SheetVisibleEnum

    if kind == "xls":
        if not raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            return
    else:
        with ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) > 6000 or sum(item.file_size for item in members) > 128 * 1024 * 1024:
                yield "", None
                return
            if kind == "ods":
                if archive.read("mimetype").strip() != b"application/vnd.oasis.opendocument.spreadsheet":
                    return
                yield from ods_rows(archive)
                return
            elif "xl/workbook.xml" not in archive.namelist():
                return
    with CalamineWorkbook.from_filelike(io.BytesIO(raw)) as workbook:
        for item in workbook.sheets_metadata:
            if item.visible != SheetVisibleEnum.Visible or item.typ != SheetTypeEnum.WorkSheet:
                continue
            sheet = workbook.get_sheet_by_name(item.name)
            if sheet.height > 50_000 or sheet.width > 256 or sheet.height * sheet.width > 2_000_000:
                yield "", None
                return
            if sheet.height and sheet.width:
                yield item.name, sheet.to_python()


def cell_text(value):
    """折叠单元格内部空白，确保一行原文始终对应一行译文。"""
    return " ".join(value.split()) if isinstance(value, str) else ""


def columns(rows, words=False):
    """通过表头或语言分布选列，词书模式优先选择词头列。"""
    source = translation = header = None
    for index, row in enumerate(rows[:5]):
        labels = [re.sub(r"[\s_-]", "", cell_text(value).casefold()) for value in row]
        source = next((i for i, label in enumerate(labels) if words and label in WORD_HEADERS), None)
        if source is None:
            source = next((i for i, label in enumerate(labels) if label in EN_HEADERS), None)
        translation = next((i for i, label in enumerate(labels) if label in ZH_HEADERS), None)
        if source is not None or translation is not None:
            header = index
            break
    sample = rows[header + 1:] if header is not None else rows
    width = max((len(row) for row in sample), default=0)
    if source is None:
        counts = [sum(i < len(row) and bool(LATIN.search(cell_text(row[i]))) and not CJK.search(cell_text(row[i]))
                      for row in sample) if i != translation else 0 for i in range(width)]
        if any(counts):
            source = counts.index(max(counts))
    if translation is None:
        counts = [sum(i < len(row) and bool(CJK.search(cell_text(row[i])))
                      for row in sample) if i != source else 0 for i in range(width)]
        if any(counts):
            translation = counts.index(max(counts))
    return source, translation, header


def import_table(raw, kind, words=False):
    """按工作表及行序配对内容，words 决定存在多种表头时的英文选列。"""
    if len(raw) > 16 * 1024 * 1024:
        return {"error": "表格超过 16 MB，请拆成较小的文件。"}
    sheets = delimited_rows(raw, kind) if kind in {"csv", "tsv"} else workbook_rows(raw, kind)
    articles, row_count, characters = [], 0, 0
    for name, rows in sheets:
        if rows is None:
            return {"error": "工作表范围过大，请拆分或删除多余空白行列。"}
        iterator = iter(rows)
        sample = list(islice(iterator, 30))
        source, translation, header = columns(sample, words)
        if source is None:
            continue
        pairs = []
        sheet_part = 0
        part_size = 0

        def finish_part():
            # 译文按段落索引读取，空白译文也占一个位置。
            nonlocal sheet_part
            sheet_part += 1
            articles.append({"id": len(articles) + 1, "title": f"{name[:150]} · {sheet_part}",
                             "text": "\n\n".join(pair[0] for pair in pairs),
                             "textTranslate": "\n\n".join(pair[1] for pair in pairs)})

        for row in chain(sample[header + 1:] if header is not None else sample, iterator):
            row_count += 1
            if row_count > 50_000 or len(row) > 256:
                return {"error": "表格最多导入 50,000 行和 256 列，请拆分后重试。"}
            original = cell_text(row[source]) if source < len(row) else ""
            if not LATIN.search(original):
                continue
            translated = cell_text(row[translation]) if translation is not None and translation < len(row) else ""
            size = len(original) + len(translated) + 4
            characters += size
            if characters > 8_000_000 or size > 5500:
                return {"error": "表格文字过长，请拆分长单元格或工作表后重试。"}
            if pairs and (len(pairs) >= 40 or part_size + size > 5500):
                finish_part()
                pairs.clear()
                part_size = 0
            pairs.append((original, translated))
            part_size += size
        if pairs:
            finish_part()
    if not articles:
        return {"error": "未找到可学习的英文。请检查表格格式，并将英文放在单独一列。"}
    return {"format": kind.upper(), "title": "", "chapterCount": len(articles), "articles": articles}

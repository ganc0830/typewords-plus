"""从标准输入读取一本本地书，输出 TypeWords 可用的纯文本课文。"""

import csv
import io
import json
import os
import posixpath
import re
import subprocess
import sys
import warnings
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from study_table import TABLE_FORMATS, import_table


MAX_FILE = 64 * 1024 * 1024
MAX_TEXT = 16_000_000
LESSON_SIZE = 5_500
CHAPTER = re.compile(r"^[—–-]*\s*CHAPTER\s+([A-Z\d -]+)\s*[—–-]*$", re.I)
MATTER = re.compile(
    r"^(?:contents\s*$|table of contents\s*$|all rights reserved\b|"
    r"titles available in\b|to buy .*(?:e-?books|series)\b)", re.I,
)
EPUB_MATTER = re.compile(r"(?:^|[-_])(?:cover|title|copyright|contents|toc|dedication|experience|advert)(?:[-_\.]|$)", re.I)


def clean_text(text):
    """清理分页控制字符与软连字符，保留正文 Unicode 标点和段落。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "")
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def pdf_paragraphs(pages):
    """合并 PDF 排版换行，保留空行分段及跨页续句。"""
    text = "\n".join(pages)
    text = re.sub(r"(?<=\w)-[ \t]*\n[ \t]*(?=\w)", "-", text)
    text = re.sub(r"(?<!\n)\n(?![ \t]*\n)", " ", text)
    return clean_text(text)


def unique_sections(sections):
    """同标题、同正文开头的预览只保留完整版，并采用完整版的阅读顺序。"""
    unique = {}
    for index, (title, text) in enumerate(sections):
        if text:
            key = (title.casefold(), re.sub(r"\s+", " ", text[:650])[:500])
            previous = unique.get(key)
            if previous is None or len(text) >= len(previous[2]):
                unique[key] = (index, title, text)
    return [(title, text) for _, title, text in sorted(unique.values())]


def pdf_sections(raw):
    """优先识别书内章节标题或书签，文本没有结构时按页组合。"""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted and not reader.decrypt(""):
        return "", [], "PDF 已加密，请选择可直接打开的版本。"
    if len(reader.pages) > 6000:
        return "", [], "PDF 超过 6000 页，请分卷导入。"
    pages = []
    characters = 0
    markers = {}
    for index, page in enumerate(reader.pages):
        content = (page.extract_text() or "").strip()
        characters += len(content)
        if characters > MAX_TEXT:
            return "", [], "书籍正文过长，请分卷导入。"
        pages.append(content)
        lines = content.splitlines()
        for line_index, line in enumerate(lines[:6]):
            match = CHAPTER.fullmatch(line.strip())
            if match:
                heading = next((i for i in range(line_index + 1, min(len(lines), line_index + 5)) if lines[i].strip()), None)
                title = lines[heading].strip() if heading is not None else line.strip(" —–-")
                markers[index] = (title, "\n".join(lines[(heading if heading is not None else line_index) + 1:]))
                break
            if line.strip().casefold() == "nineteen years later" and line_index < 2:
                markers[index] = (line.strip(), "\n".join(lines[line_index + 1:]))
                break

    if not markers:
        # 书签可能有多层目录。只采用有实际页号的标题，每页保留一个边界。
        pending = list(reader.outline)
        while pending:
            item = pending.pop(0)
            if isinstance(item, list):
                pending[0:0] = item
                continue
            page = reader.get_destination_page_number(item)
            title = str(item.title).strip()
            if 0 <= page < len(pages) and title and not MATTER.match(title):
                markers.setdefault(page, (title, pages[page]))

    sections = []
    if markers:
        current = None
        for index, page in enumerate(pages):
            if index in markers:
                title, body = markers[index]
                current = [title, [body]]
                sections.append(current)
            elif page and MATTER.match(page.splitlines()[0].strip()):
                current = None
            elif current is not None and page:
                current[1].append(page)
    else:
        sections = [(f"第 {i + 1}–{min(i + 4, len(pages))} 页", pages[i:i + 4]) for i in range(0, len(pages), 4)]

    metadata_title = reader.metadata.title if reader.metadata else ""
    return str(metadata_title or ""), unique_sections((title, pdf_paragraphs(body)) for title, body in sections), ""


class EpubText(HTMLParser):
    """从 spine 文档提取标题和可读文本，忽略脚本、样式及导航。"""

    blocks = {"p", "div", "br", "section", "article", "li", "blockquote", "h1", "h2", "h3", "h4", "hr", "tr"}
    hidden = {"head", "script", "style", "nav", "svg", "noscript"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.heading = []
        self.title = ""
        self.in_heading = False
        self.ignored = []

    def handle_starttag(self, tag, attrs):
        if tag in self.hidden:
            self.ignored.append(tag)
        if self.ignored:
            return
        if tag in self.blocks:
            self.parts.append("\n\n")
        if (not self.title or CHAPTER.fullmatch(self.title)) and tag in {"h1", "h2", "h3", "h4"}:
            self.heading = []
            self.in_heading = True

    def handle_endtag(self, tag):
        if self.ignored:
            if tag == self.ignored[-1]:
                self.ignored.pop()
            return
        if self.in_heading and tag in {"h1", "h2", "h3", "h4"}:
            self.title = " ".join("".join(self.heading).split())
            self.in_heading = False
        if tag in self.blocks:
            self.parts.append("\n\n")

    def handle_data(self, data):
        if self.ignored:
            return
        if self.in_heading:
            self.heading.append(data)
        else:
            self.parts.append(re.sub(r"\s+", " ", data))


def epub_sections(raw):
    """按 EPUB 的阅读顺序读取正文。所有条目只从内存中的 ZIP 读取。"""
    with ZipFile(io.BytesIO(raw)) as book:
        members = book.infolist()
        if len(members) > 6000 or sum(m.file_size for m in members) > 128 * 1024 * 1024:
            return "", [], "EPUB 解包后的内容过大，请分卷导入。"
        if book.read("mimetype").strip() != b"application/epub+zip":
            return "", [], "这个 ZIP 文件不是 EPUB。"
        container = ElementTree.fromstring(book.read("META-INF/container.xml"))
        package_path = container.find(".//{*}rootfile").attrib["full-path"]
        package = ElementTree.fromstring(book.read(package_path))
        title = package.findtext("./{*}metadata/{*}title", "")
        resources = {item.attrib["id"]: item.attrib for item in package.findall("./{*}manifest/{*}item")}
        sections = []
        for item in package.findall("./{*}spine/{*}itemref"):
            resource = resources.get(item.get("idref"), {})
            if (item.get("linear") == "no" or "nav" in resource.get("properties", "").split()
                    or resource.get("media-type") not in {"application/xhtml+xml", "text/html"}):
                continue
            href = urlsplit(resource.get("href", ""))
            if href.scheme or href.netloc:
                continue
            path = posixpath.normpath(posixpath.join(posixpath.dirname(package_path), unquote(href.path)))
            if path.startswith(("../", "/")) or EPUB_MATTER.search(posixpath.basename(path)):
                continue
            parser = EpubText()
            markup = book.read(path)
            parser.feed(markup.decode("utf-16" if markup.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"))
            parser.close()
            text = clean_text("".join(parser.parts))
            if text and not MATTER.match(parser.title or text.splitlines()[0]):
                sections.append((parser.title or f"第 {len(sections) + 1} 章", text))
        return title, unique_sections(sections), ""


def word_sections(raw, kind):
    """提取 Word 正文与 DOCX 标题，外部链接、图片和宏不参与解析。"""
    if kind == "doc":
        if not raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            return "", [], "请选择 Word 97–2003 的 DOC 文件。"
        if len(raw) > 16 * 1024 * 1024:
            return "", [], "DOC 超过 16 MB，请拆分或另存为 DOCX。"
        node = os.environ.get("TYPEWORDS_BOOK_NODE")
        if not node:
            return "", [], "本地 DOC 解析器尚未配置。"
        result = subprocess.run(
            [node, str(Path(__file__).with_name("legacy-word") / "read.cjs")],
            input=raw, capture_output=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode:
            return "", [], "无法读取 DOC 正文，请检查文件是否完整或另存为 DOCX。"
        paragraphs = [clean_text(part) for part in result.stdout.decode("utf-8").splitlines()]
        return "", [("正文", "\n\n".join(part for part in paragraphs if part))], ""

    with ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        if len(members) > 6000 or sum(item.file_size for item in members) > 128 * 1024 * 1024:
            return "", [], "DOCX 解包后的内容过大，请拆分后导入。"
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    body = root.find("./{*}body")
    if body is None:
        return "", [], "DOCX 缺少正文。"
    sections, paragraphs, title = [], [], "正文"
    for paragraph in body.iterfind(".//{*}p"):
        text = clean_text("".join(
            (element.text or "") if element.tag.endswith("}t") else " "
            for element in paragraph.iter() if element.tag.rsplit("}", 1)[-1] in {"t", "tab", "br"}
        ))
        if not text:
            continue
        style = paragraph.find("./{*}pPr/{*}pStyle")
        style_name = next(iter(style.attrib.values()), "") if style is not None else ""
        heading = paragraph.find("./{*}pPr/{*}outlineLvl") is not None or re.fullmatch(r"heading\d+|title", style_name, re.I)
        if heading:
            if paragraphs:
                sections.append((title, "\n\n".join(paragraphs)))
                paragraphs = []
            title = text
        else:
            paragraphs.append(text)
    if paragraphs:
        sections.append((title, "\n\n".join(paragraphs)))
    return "", sections, ""


def lessons(sections):
    """为长章节生成可练习的短课，优先在段末或句末分割。"""
    articles = []
    for title, text in sections:
        parts = []
        while len(text) > LESSON_SIZE:
            head = text[:LESSON_SIZE]
            end = head.rfind("\n\n")
            if end < LESSON_SIZE // 2:
                sentences = list(re.finditer(r"[.!?][’”\"']?\s+", head))
                end = sentences[-1].end() if sentences else 0
            if end < LESSON_SIZE // 2:
                end = head.rfind(" ")
            end = end if end > 0 else LESSON_SIZE
            parts.append(text[:end].strip())
            text = text[end:].strip()
        if text:
            parts.append(text)
        for i, part in enumerate(parts, 1):
            label = f"{title} ({i}/{len(parts)})" if len(parts) > 1 else title
            articles.append({"id": len(articles) + 1, "title": label[:180], "text": part})
    return articles


def main():
    """固定 stdin/stdout 协议，返回可展示的错误且不输出原书正文到日志。"""
    raw = sys.stdin.buffer.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        print(json.dumps({"error": "文件超过 64 MB，请分卷导入。"}, ensure_ascii=False))
        return
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            requested = os.environ.get("TYPEWORDS_BOOK_FORMAT", "")
            if requested in TABLE_FORMATS:
                print(json.dumps(import_table(raw, requested), ensure_ascii=False))
                return
            if requested in {"doc", "docx"}:
                kind, result = requested.upper(), word_sections(raw, requested)
            elif raw.startswith(b"%PDF-"):
                kind, result = "PDF", pdf_sections(raw)
            elif raw.startswith(b"PK\x03\x04"):
                kind, result = "EPUB", epub_sections(raw)
            else:
                print(json.dumps({"error": "请选择有效的 PDF 或 EPUB 文件。"}, ensure_ascii=False))
                return
        title, sections, error = result
        if not error and not sections:
            error = "没有提取到可学习的正文。"
            if kind == "PDF":
                error += "扫描版 PDF 请先做文字识别。"
        if not error and sum(len(text) for _, text in sections) > MAX_TEXT:
            error = "书籍正文过长，请分卷导入。"
        payload = {"error": error} if error else {
            "format": kind, "title": title.strip()[:180], "chapterCount": len(sections), "articles": lessons(sections),
        }
    except (BadZipFile, ImportError, OSError, RuntimeError, ValueError, KeyError, TypeError, AttributeError,
            csv.Error, subprocess.TimeoutExpired, ElementTree.ParseError) as error:
        print(type(error).__name__, file=sys.stderr)
        payload = {"error": "无法读取这本书，请检查文件是否完整、可读取。"}
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()

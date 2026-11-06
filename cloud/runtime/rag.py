"""Trusted offline RAG adapter executed only inside OpenSandbox."""
import hashlib
import html.parser
import json
import pathlib
import re
import sys

ROOT = pathlib.Path('/workspace')
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_EXTRACTED_BYTES = 6 * 1024 * 1024
MAX_FILES = 32
MAX_CHUNKS = 1000
CHUNK_CHARACTERS = 1400
CHUNK_OVERLAP = 160
SUPPORTED = {
    '.txt', '.md', '.markdown', '.json', '.csv', '.docx', '.xlsx', '.pptx', '.pdf',
    '.html', '.htm', '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
    '.css', '.xml', '.yaml', '.yml', '.toml', '.sql', '.log',
}
SKIPPED_DIRECTORIES = {'.git', 'node_modules', 'dist', '__pycache__'}

def workspace_path(value, require_exists=True):
    candidate = pathlib.Path(value)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    candidate = candidate.resolve(strict=require_exists)
    if not candidate.is_relative_to(ROOT):
        raise ValueError('RAG_PATH_ESCAPE')
    return candidate


def response_path(value):
    candidate = workspace_path(value, require_exists=False)
    if candidate.parent != ROOT or not candidate.name.startswith('.rag-response-'):
        raise ValueError('RAG_RESPONSE_PATH_INVALID')
    return candidate


class TextOnlyHtml(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        elif tag in ('p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_text(path):
    text = path.read_text(encoding='utf-8', errors='replace')
    if path.suffix.lower() in ('.html', '.htm'):
        parser = TextOnlyHtml()
        parser.feed(text)
        text = ''.join(parser.parts)
    return [(None, text)]


def extract_sections(path):
    suffix = path.suffix.lower()
    if suffix == '.docx':
        from docx import Document
        document = Document(path)
        parts = [paragraph.text for paragraph in document.paragraphs]
        parts.extend('\t'.join(cell.text for cell in row.cells)
                     for table in document.tables for row in table.rows)
        return [(None, '\n'.join(parts))]
    if suffix == '.xlsx':
        from openpyxl import load_workbook
        workbook = load_workbook(path, read_only=True, data_only=True)
        sections = []
        try:
            for page, sheet in enumerate(workbook, 1):
                rows = [f'# Sheet: {sheet.title}']
                for index, row in enumerate(sheet.iter_rows(values_only=True)):
                    if index >= 10000:
                        rows.append('[sheet truncated at 10000 rows]')
                        break
                    rows.append('\t'.join('' if value is None else str(value) for value in row[:200]))
                sections.append((page, '\n'.join(rows)))
        finally:
            workbook.close()
        return sections
    if suffix == '.pptx':
        from pptx import Presentation
        deck = Presentation(path)
        return [(index, '\n'.join(shape.text for shape in slide.shapes if shape.has_text_frame))
                for index, slide in enumerate(deck.slides, 1)]
    if suffix == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(path)
        return [(index, page.extract_text() or '') for index, page in enumerate(reader.pages[:300], 1)]
    return plain_text(path)


def chunks_from_sections(sections):
    output = []
    document_line = 1
    for page, raw in sections:
        text = raw.replace('\x00', '').replace('\r\n', '\n').replace('\r', '\n')
        start = 0
        while start < len(text):
            end = min(len(text), start + CHUNK_CHARACTERS)
            if end < len(text):
                boundary = text.rfind('\n', start + CHUNK_CHARACTERS // 2, end)
                if boundary > start:
                    end = boundary
            content = text[start:end].strip()
            if content:
                line_start = document_line + text[:start].count('\n')
                line_end = line_start + content.count('\n')
                output.append({
                    'chunkIndex': len(output), 'text': content,
                    'lineStart': line_start, 'lineEnd': line_end, 'page': page,
                })
            if end >= len(text):
                break
            start = max(start + 1, end - CHUNK_OVERLAP)
        document_line += text.count('\n') + 1
    return output


def list_files(paths):
    found = []
    seen = set()
    for raw in paths:
        target = workspace_path(raw)
        candidates = [target] if target.is_file() else target.rglob('*')
        for candidate in candidates:
            resolved = candidate.resolve(strict=True)
            if not resolved.is_relative_to(ROOT) or not resolved.is_file():
                continue
            if any(part in SKIPPED_DIRECTORIES for part in resolved.parts):
                continue
            if resolved.suffix.lower() not in SUPPORTED or resolved in seen:
                continue
            found.append(resolved)
            seen.add(resolved)
            if len(found) > MAX_FILES:
                raise ValueError('RAG_FILE_BUDGET_EXCEEDED')
    return sorted(found)


def index(paths):
    documents = []
    errors = []
    extracted_bytes = 0
    chunk_count = 0
    for source in list_files(paths):
        try:
            stat = source.stat()
            if stat.st_size > MAX_FILE_BYTES:
                raise ValueError('RAG_FILE_TOO_LARGE')
            document_chunks = chunks_from_sections(extract_sections(source))
            if not document_chunks:
                raise ValueError('RAG_EMPTY_DOCUMENT')
            extracted_bytes += sum(len(chunk['text'].encode('utf-8')) for chunk in document_chunks)
            chunk_count += len(document_chunks)
            if extracted_bytes > MAX_EXTRACTED_BYTES or chunk_count > MAX_CHUNKS:
                raise ValueError('RAG_OPERATION_BUDGET_EXCEEDED')
            documents.append({
                'sourcePath': str(source), 'sourceName': source.name,
                'contentHash': hashlib.sha256(source.read_bytes()).hexdigest(),
                'size': stat.st_size, 'modifiedAt': stat.st_mtime * 1000,
                'chunks': document_chunks,
            })
        except ValueError as error:
            errors.append({'sourcePath': str(source), 'code': str(error)})
        except Exception:
            errors.append({'sourcePath': str(source), 'code': 'RAG_PARSE_FAILED'})
    return {'documents': documents, 'errors': errors}


def execute(request):
    operation = request.get('operation')
    arguments = request.get('arguments') or {}
    if operation == 'index':
        paths = arguments.get('paths')
        if not isinstance(paths, list) or not paths or len(paths) > MAX_FILES or not all(isinstance(item, str) for item in paths):
            raise ValueError('RAG_PATHS_INVALID')
        return index(paths)
    raise ValueError('RAG_OPERATION_INVALID')


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--delete-response':
        response_path(sys.argv[2]).unlink(missing_ok=True)
        return
    request_file = workspace_path(sys.argv[1])
    try:
        request = json.loads(request_file.read_text(encoding='utf-8'))
        target = response_path(request.get('responsePath'))
        encoded = json.dumps(execute(request), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(encoded) > 16 * 1024 * 1024:
            raise ValueError('RAG_RESPONSE_BUDGET_EXCEEDED')
        target.write_bytes(encoded)
        target.chmod(0o600)
        print(json.dumps({'responsePath': str(target)}, separators=(',', ':')))
    finally:
        request_file.unlink(missing_ok=True)


if __name__ == '__main__':
    main()


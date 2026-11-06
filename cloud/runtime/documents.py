"""Sandbox-only document adapter. Never imported or executed by the control plane."""
import csv
import json
import pathlib
import sys
import os
import tempfile

ROOT = pathlib.Path('/workspace')


def path(value, output=False):
    target = pathlib.Path(value).resolve()
    if not target.is_relative_to(ROOT) or (output and not target.is_relative_to(ROOT / 'output')):
        raise ValueError('Path outside permitted workspace')
    if output:
        target.parent.mkdir(parents=True, exist_ok=True)
    return target


def read_document(args):
    source = path(args['path'])
    if source.stat().st_size > 25 * 1024 * 1024:
        raise ValueError('Document exceeds 25 MiB')
    suffix = source.suffix.lower()
    start = max(0, int(args.get('offset', 0)))
    limit = max(1, min(60000, int(args.get('limit', 8000))))
    if suffix == '.docx':
        from docx import Document
        doc = Document(source)
        parts = [p.text for p in doc.paragraphs]
        parts += ['\t'.join(c.text for c in row.cells) for table in doc.tables for row in table.rows]
        text = '\n'.join(parts)
    elif suffix == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(source, read_only=True, data_only=True)
        parts = []
        try:
            for sheet in book:
                parts.append(f'\n# {sheet.title}')
                for index, row in enumerate(sheet.iter_rows(values_only=True)):
                    if index >= 10000:
                        parts.append('[sheet truncated at 10000 rows]')
                        break
                    parts.append('\t'.join('' if v is None else str(v) for v in row[:200]))
        finally:
            book.close()
        text = '\n'.join(parts)
    elif suffix == '.pptx':
        from pptx import Presentation
        deck = Presentation(source)
        text = '\n'.join(f'\n# Slide {i+1}\n' + '\n'.join(s.text for s in slide.shapes if s.has_text_frame)
                         for i, slide in enumerate(deck.slides))
    elif suffix == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(source)
        text = '\n'.join(f'\n# Page {i+1}\n' + (p.extract_text() or '') for i, p in enumerate(reader.pages[:300]))
    elif suffix in ('.txt', '.md', '.csv', '.json', '.html', '.xml', '.yaml', '.yml', '.log'):
        text = source.read_text(encoding='utf-8', errors='replace')
    else:
        raise ValueError('Unsupported format; use LibreOffice conversion in the sandbox')
    return {'path': str(source), 'text': text[start:start+limit], 'offset': start,
            'nextOffset': start+limit if start+limit < len(text) else None, 'totalCharacters': len(text),
            'note': 'PDF scans require OCR; Office extraction is textual, not a visual fidelity check.'}


def write_document_content(operation, args, target):
    name = args['fileName']
    if pathlib.Path(name).name != name or '\\' in name:
        raise ValueError('fileName must be a basename')
    expected = {'write_docx': '.docx', 'write_xlsx': '.xlsx', 'write_pptx': '.pptx'}.get(operation)
    if expected is None or pathlib.Path(name).suffix.lower() != expected:
        raise ValueError('File extension does not match tool')
    if operation == 'write_docx':
        from docx import Document
        doc = Document()
        if args.get('title'):
            doc.add_heading(args['title'], 0)
        for section in args['sections']:
            if section.get('heading'):
                doc.add_heading(section['heading'], 1)
            for paragraph in section.get('paragraphs', []):
                doc.add_paragraph(paragraph)
            for item in section.get('bullets', []):
                doc.add_paragraph(item, style='List Bullet')
        doc.save(target)
    elif operation == 'write_xlsx':
        from openpyxl import Workbook
        book = Workbook()
        book.remove(book.active)
        for sheet in args['sheets']:
            ws = book.create_sheet(sheet['name'])
            if sheet.get('headers'):
                ws.append(sheet['headers'])
            for row in sheet['rows']:
                ws.append(row)
        book.save(target)
    elif operation == 'write_pptx':
        from pptx import Presentation
        deck = Presentation()
        for item in args['slides']:
            slide = deck.slides.add_slide(deck.slide_layouts[1])
            slide.shapes.title.text = item.get('title') or ''
            frame = slide.placeholders[1].text_frame
            texts = ([item['body']] if item.get('body') else []) + item.get('bullets', [])
            for index, text in enumerate(texts):
                paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
                paragraph.text = text
        deck.save(target)
    else:
        raise ValueError('Unsupported document operation')
    return {'path': str(target), 'size': target.stat().st_size, 'note': 'Use present_files to deliver, and LibreOffice/PDF rendering for visual review.'}


def write_document(operation, args):
    name = args['fileName']
    if pathlib.Path(name).name != name or '\\' in name:
        raise ValueError('fileName must be a basename')
    requested = ROOT / 'output' / name
    if requested.is_symlink():
        raise ValueError('Invalid output target')
    target = path(str(requested), output=True)
    if target.is_symlink():
        raise ValueError('Invalid output target')
    fd, temporary = tempfile.mkstemp(prefix='.document-', suffix=target.suffix, dir=target.parent)
    os.close(fd)
    temporary = pathlib.Path(temporary)
    try:
        result = write_document_content(operation, args, temporary)
        if temporary.stat().st_size > 25 * 1024 * 1024:
            raise ValueError('Document exceeds 25 MiB')
        os.replace(temporary, target)
        result['path'] = str(target)
        return result
    finally:
        temporary.unlink(missing_ok=True)


def main():
    request_path = path(sys.argv[1])
    try:
        request = json.loads(request_path.read_text())
        operation, args = request['operation'], request['arguments']
        result = read_document(args) if operation == 'read_doc' else write_document(operation, args)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        request_path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()

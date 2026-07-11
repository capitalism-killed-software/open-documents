"""Docling behind a small protocol: one JSON request per line on stdin, one JSON reply per line
on stdout. Started once by @open-documents/node and kept warm, because loading the models takes
seconds and converting a page takes a fraction of one.

Requests:  {"id": 1, "method": "convert", "params": {"path": "...", "to": ["markdown"], "out": "..."}}
           {"id": 2, "method": "ping"}
Replies:   {"id": 1, "ok": true, "result": {...}}
           {"id": 1, "ok": false, "error": {"code": "CONVERSION_FAILED", "message": "..."}}

Nothing here reaches the network: models are read from a folder (OPENDOCS_DOCLING_MODELS), and
the caller turns off Hugging Face downloads. Docling's own OCR is off; scans are read by
@open-documents/ocr first, and Docling uses the text layer that leaves.
"""

from __future__ import annotations

import json
import os
import re
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any, Callable, TextIO

FORMATS = ("markdown", "html", "json", "text", "xlsx")
NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


class Failure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def make_converter(models: str | None) -> Any:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(
        artifacts_path=models,
        do_ocr=False,
        do_table_structure=True,
        enable_remote_services=False,
        allow_external_plugins=False,
    )
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


def tables_to_xlsx(document: Any, target: Path) -> int:
    """Every table in its own sheet, named after the page it was on. Cells that are plain
    numbers become numbers; everything else stays text."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    book = Workbook()
    book.remove(book.active)
    count = 0
    per_page: dict[int, int] = {}
    for table in document.tables:
        frame = table.export_to_dataframe(doc=document)
        if frame.empty and not len(frame.columns):
            continue
        page = table.prov[0].page_no if table.prov else 0
        per_page[page] = per_page.get(page, 0) + 1
        sheet = book.create_sheet((f"Page {page} table {per_page[page]}" if page else f"Table {count + 1}")[:31])
        # columns numbered 0, 1, 2... mean Docling found no header row: write none
        if [str(c) for c in frame.columns] != [str(i) for i in range(len(frame.columns))]:
            sheet.append([str(c) for c in frame.columns])
            for cell in sheet[1]:
                cell.font = Font(bold=True)
        for row in frame.itertuples(index=False):
            sheet.append([cell_value(v) for v in row])
        count += 1
    if count:
        book.save(target)
    return count


def cell_value(value: Any) -> Any:
    text = "" if value is None else str(value).strip()
    if NUMBER.match(text):
        return float(text) if "." in text else int(text)
    return text


def convert(converter: Any, params: dict[str, Any]) -> dict[str, Any]:
    path = Path(params["path"])
    wanted = params.get("to") or ["markdown"]
    unknown = [f for f in wanted if f not in FORMATS]
    if unknown:
        raise Failure("INVALID_OPTION", f"Unknown format {unknown[0]!r}; known: {', '.join(FORMATS)}.")
    result = converter.convert(path, raises_on_error=False, max_num_pages=int(params.get("maxPages", 2000)))
    if result.status.name not in ("SUCCESS", "PARTIAL_SUCCESS"):
        errors = "; ".join(e.error_message for e in result.errors) or result.status.name
        raise Failure("CONVERSION_FAILED", f"Docling could not read the document: {errors}")
    document = result.document
    reply: dict[str, Any] = {"pages": len(result.pages), "tables": len(document.tables), "partial": result.status.name == "PARTIAL_SUCCESS"}
    if "markdown" in wanted:
        reply["markdown"] = document.export_to_markdown()
    if "html" in wanted:
        reply["html"] = document.export_to_html()
    if "json" in wanted:
        reply["json"] = document.export_to_dict()
    if "text" in wanted:
        reply["text"] = document.export_to_text()
    if "xlsx" in wanted:
        target = Path(params["out"]) / "tables.xlsx"
        reply["tableSheets"] = tables_to_xlsx(document, target)
        reply["xlsx"] = str(target) if reply["tableSheets"] else None
    return reply


def serve(requests: TextIO, replies: TextIO, make: Callable[[], Any]) -> None:
    converter = None
    for line in requests:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            write(replies, {"id": None, "ok": False, "error": {"code": "INVALID_INPUT", "message": "Not a JSON request."}})
            continue
        ident = request.get("id")
        try:
            method = request.get("method")
            if method == "ping":
                result: dict[str, Any] = {"docling": version("docling")}
            elif method == "convert":
                converter = converter or make()
                result = convert(converter, request.get("params") or {})
            else:
                raise Failure("INVALID_OPTION", f"Unknown method {method!r}.")
            write(replies, {"id": ident, "ok": True, "result": result})
        except Failure as failure:
            write(replies, {"id": ident, "ok": False, "error": {"code": failure.code, "message": str(failure)}})
        except Exception as error:  # anything Docling raises is a failed conversion, not a crash
            write(replies, {"id": ident, "ok": False, "error": {"code": "CONVERSION_FAILED", "message": f"{type(error).__name__}: {error}"}})


def write(replies: TextIO, message: dict[str, Any]) -> None:
    replies.write(json.dumps(message, ensure_ascii=False) + "\n")
    replies.flush()


def main() -> None:
    # Replies go out on the real stdout; anything a library prints goes to stderr instead.
    replies = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    models = os.environ.get("OPENDOCS_DOCLING_MODELS") or None
    serve(sys.stdin, replies, lambda: make_converter(models))

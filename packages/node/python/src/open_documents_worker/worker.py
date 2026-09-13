"""Docling behind a small protocol: one JSON request per line on stdin, one JSON reply per line
on stdout. Started once by @open-documents/node and kept warm, because loading the models takes
seconds and converting a page takes a fraction of one.

Requests:  {"id": 1, "method": "convert", "params": {"path": "...", "to": ["markdown"], "out": "..."}}
           {"id": 2, "method": "sign", "params": {"path": "...", "certificate": "...", "out": "..."}}
           {"id": 3, "method": "verify", "params": {"path": "...", "trustRoots": ["..."]}}
           {"id": 4, "method": "ping"}
Replies:   {"id": 1, "ok": true, "result": {...}}
           {"id": 1, "ok": false, "error": {"code": "CONVERSION_FAILED", "message": "..."}}

Nothing here reaches the network: models are read from a folder (OPENDOCS_DOCLING_MODELS), and
the caller turns off Hugging Face downloads. Docling's own OCR is off; scans are read by
@open-documents/ocr first, and Docling uses the text layer that leaves. Signing (pyHanko) only
reaches the network for a timestamp, and only from the authority it is given.
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


SPACES = re.compile(r" {2,}")
KEEP_SPACING = {"code", "formula"}


def tidy(document: Any) -> None:
    """One space between words. Text laid over a scan puts a space between words and leaves a
    gap as well, and Docling counts both. Code and formulas keep their spacing."""
    for item in document.texts:
        if str(getattr(item.label, "value", item.label)) not in KEEP_SPACING and isinstance(item.text, str):
            item.text = SPACES.sub(" ", item.text)
    for table in document.tables:
        for cell in table.data.table_cells:
            cell.text = SPACES.sub(" ", cell.text)


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
    tidy(document)
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


def sign(params: dict[str, Any]) -> dict[str, Any]:
    """PAdES signature with pyHanko: a new field, visible when a box is given, or an existing
    empty one. The signature is added as an incremental update, so what was signed stays."""
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko.sign.fields import SigFieldSpec
    from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata, PdfSigner
    from pyhanko.stamp import TextStampStyle

    password = params.get("password")
    try:
        signer = signers.SimpleSigner.load_pkcs12(pfx_file=params["certificate"], passphrase=password.encode() if password else None)
    except Exception:
        signer = None
    if signer is None:
        raise Failure("INVALID_INPUT", "The certificate could not be opened: the password is wrong, or it is not a PKCS#12 (.p12, .pfx) file.")
    out = Path(params["out"]) / "signed.pdf"
    with open(params["path"], "rb") as source:
        writer = IncrementalPdfFileWriter(source, strict=False)
        if writer.prev.encrypted:
            if not params.get("documentPassword"):
                raise Failure("PASSWORD_REQUIRED", "This file is encrypted: give its password.")
            writer.encrypt(params["documentPassword"])
        existing = {name: value for name, value, _ in fields.enumerate_sig_fields(writer.prev)}
        name = params.get("field") or next(f"Signature{n}" for n in range(1, 10_000) if f"Signature{n}" not in existing)
        if existing.get(name) is not None:
            raise Failure("INVALID_OPTION", f'The field "{name}" is signed already.')
        box = params.get("box")
        spec = None if name in existing else SigFieldSpec(sig_field_name=name, on_page=int(params.get("page", 1)) - 1, box=tuple(box) if box else None)
        meta = PdfSignatureMetadata(
            field_name=name,
            reason=params.get("reason"),
            location=params.get("location"),
            name=params.get("name"),
            subfilter=fields.SigSeedSubFilter.PADES,
            md_algorithm="sha256",
        )
        timestamper = None
        if params.get("timestampUrl"):
            from pyhanko.sign.timestamps import HTTPTimeStamper

            timestamper = HTTPTimeStamper(params["timestampUrl"])
        style = TextStampStyle(stamp_text=params.get("text") or "Signed by %(signer)s\n%(ts)s")
        with open(out, "wb") as target:
            PdfSigner(meta, signer=signer, timestamper=timestamper, stamp_style=style, new_field_spec=spec).sign_pdf(writer, output=target)
    return {"path": str(out), "field": name}


def verify(params: dict[str, Any]) -> dict[str, Any]:
    """Every signature in the file: intact, valid, and trusted when it leads to one of the
    trust roots given. Nothing is fetched: revocation is not checked online."""
    from asn1crypto import pem, x509
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    roots = []
    for path in params.get("trustRoots") or []:
        data = Path(path).read_bytes()
        try:
            if pem.detect(data):
                roots.extend(x509.Certificate.load(der) for _, _, der in pem.unarmor(data, multiple=True))
            else:
                roots.append(x509.Certificate.load(data))
        except Exception:
            raise Failure("INVALID_INPUT", "A trust root is not a certificate (PEM or DER).")
    signatures = []
    with open(params["path"], "rb") as source:
        reader = PdfFileReader(source, strict=False)
        if reader.encrypted:
            if not params.get("documentPassword"):
                raise Failure("PASSWORD_REQUIRED", "This file is encrypted: give its password.")
            reader.decrypt(params["documentPassword"])
        for sig in reader.embedded_signatures:
            status = validate_pdf_signature(sig, ValidationContext(trust_roots=roots, allow_fetching=False))
            cert = status.signing_cert
            diff = status.diff_result
            signatures.append({
                "field": sig.field_name,
                "signer": (cert.subject.native.get("common_name") or cert.subject.human_friendly) if cert is not None else None,
                "signedAt": status.signer_reported_dt.isoformat() if status.signer_reported_dt else None,
                "timestamped": status.timestamp_validity is not None,
                "intact": bool(status.intact),
                "valid": bool(status.valid),
                "trusted": bool(roots) and status.trust_problem_indic is None,
                "coverage": status.coverage.name if status.coverage is not None else None,
                "changesAfter": getattr(getattr(diff, "modification_level", None), "name", None),
                "summary": status.summary(),
            })
    return {"signatures": signatures}


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
            elif method == "sign":
                result = sign(request.get("params") or {})
            elif method == "verify":
                result = verify(request.get("params") or {})
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

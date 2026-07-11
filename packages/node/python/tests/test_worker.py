"""The worker's protocol and the Excel writer, with a stand-in for Docling."""

import io
import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
from openpyxl import load_workbook

from open_documents_worker.worker import cell_value, serve, tables_to_xlsx


class FakeDocument:
    def __init__(self, tables):
        self.tables = tables

    def export_to_markdown(self):
        return "# Title"

    def export_to_html(self):
        return "<h1>Title</h1>"

    def export_to_dict(self):
        return {"texts": [{"text": "Title"}]}

    def export_to_text(self):
        return "Title"


def table(frame, page=1):
    return SimpleNamespace(export_to_dataframe=lambda doc=None: frame, prov=[SimpleNamespace(page_no=page)] if page else [])


class FakeConverter:
    def __init__(self, document, status="SUCCESS"):
        self.document = document
        self.status = status

    def convert(self, path, raises_on_error=True, max_num_pages=0):
        return SimpleNamespace(status=SimpleNamespace(name=self.status), errors=[SimpleNamespace(error_message="broken")], document=self.document, pages=[1, 2])


def talk(lines, converter):
    replies = io.StringIO()
    serve(io.StringIO("".join(line + "\n" for line in lines)), replies, lambda: converter)
    return [json.loads(line) for line in replies.getvalue().splitlines()]


def test_ping_and_convert(tmp_path):
    frame = pd.DataFrame([["North", "1200"]], columns=["Region", "Revenue"])
    converter = FakeConverter(FakeDocument([table(frame)]))
    ping, done = talk([
        json.dumps({"id": 1, "method": "ping"}),
        json.dumps({"id": 2, "method": "convert", "params": {"path": "x.pdf", "to": ["markdown", "html", "json", "text", "xlsx"], "out": str(tmp_path)}}),
    ], converter)
    assert ping["ok"] and ping["result"]["docling"]
    assert done["ok"]
    result = done["result"]
    assert (result["pages"], result["tables"], result["partial"]) == (2, 1, False)
    assert (result["markdown"], result["html"], result["text"]) == ("# Title", "<h1>Title</h1>", "Title")
    assert result["json"] == {"texts": [{"text": "Title"}]}
    assert Path(result["xlsx"]).exists()


def test_errors_are_replies_not_crashes(tmp_path):
    replies = talk([
        "not json",
        "",
        json.dumps({"id": 3, "method": "dance"}),
        json.dumps({"id": 4, "method": "convert", "params": {"path": "x.pdf", "to": ["docx"]}}),
        json.dumps({"id": 5, "method": "convert", "params": {"path": "x.pdf"}}),
    ], FakeConverter(FakeDocument([]), status="FAILURE"))
    assert [r["error"]["code"] for r in replies] == ["INVALID_INPUT", "INVALID_OPTION", "INVALID_OPTION", "CONVERSION_FAILED"]
    assert "broken" in replies[3]["error"]["message"]


def test_a_crash_inside_docling_is_a_failed_conversion():
    class Exploding:
        def convert(self, *args, **kwargs):
            raise RuntimeError("out of memory")

    [reply] = talk([json.dumps({"id": 6, "method": "convert", "params": {"path": "x.pdf"}})], Exploding())
    assert reply["error"] == {"code": "CONVERSION_FAILED", "message": "RuntimeError: out of memory"}


def test_sheets_named_by_page_numbers_as_numbers_and_no_made_up_headers(tmp_path):
    with_header = pd.DataFrame([["North", "1200", "1,5"], ["South", "-3.25", ""]], columns=["Region", "Revenue", "Note"])
    without = pd.DataFrame([["a", "b"], ["c", "7"]])
    empty = pd.DataFrame()
    target = tmp_path / "t.xlsx"
    count = tables_to_xlsx(FakeDocument([table(with_header, 2), table(without, 2), table(empty, 3), table(without, 0)]), target)
    assert count == 3
    book = load_workbook(target)
    assert book.sheetnames == ["Page 2 table 1", "Page 2 table 2", "Table 3"]
    first = [[c.value for c in row] for row in book["Page 2 table 1"].iter_rows()]
    assert first == [["Region", "Revenue", "Note"], ["North", 1200, "1,5"], ["South", -3.25, None]]
    assert book["Page 2 table 1"]["A1"].font.b
    assert [[c.value for c in row] for row in book["Page 2 table 2"].iter_rows()] == [["a", "b"], ["c", 7]]


def test_no_tables_writes_no_workbook(tmp_path):
    target = tmp_path / "none.xlsx"
    assert tables_to_xlsx(FakeDocument([]), target) == 0
    assert not target.exists()


def test_cell_values():
    assert [cell_value(v) for v in ["12", "-4", "3.5", " 7 ", None, "1e5", "12a"]] == [12, -4, 3.5, 7, "", "1e5", "12a"]

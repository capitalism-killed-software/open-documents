#!/usr/bin/env bash
# Start the image the way the README says to, then check it converts and edits documents.
# usage: docker/smoke-test.sh <image>
set -euo pipefail
image="$1"
key="smoke-test-key-0123456789"
work="$(mktemp -d)"
trap 'docker rm -f od-smoke >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

node -e "
  import('@open-documents/fixtures').then(async (f) => {
    const fs = await import('node:fs');
    fs.writeFileSync('$work/report.docx', (await f.docxDocument()).bytes);
    fs.writeFileSync('$work/doc.pdf', (await f.textDocument({ pages: 3 })).bytes);
  });"

docker run -d --name od-smoke -p 3000:3000 -e OPENDOCS_API_KEYS="$key" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges "$image"

for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/health

echo "== without a key"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/v1/pdf/inspect -F file=@"$work/doc.pdf")" = 401

echo "== docx to pdf"
curl -fsS -H "authorization: Bearer $key" -F file=@"$work/report.docx" http://127.0.0.1:3000/v1/convert -o "$work/report.pdf"
head -c 5 "$work/report.pdf" | grep -q '%PDF-'

echo "== html to pdf"
curl -fsS -H "authorization: Bearer $key" -H 'content-type: application/json' \
  -d '{"html":"<h1>Smoke test</h1>"}' http://127.0.0.1:3000/v1/convert/html -o "$work/page.pdf"
head -c 5 "$work/page.pdf" | grep -q '%PDF-'

echo "== rotate"
curl -fsS -H "authorization: Bearer $key" -F file=@"$work/doc.pdf" -F 'options={"angle":90}' \
  http://127.0.0.1:3000/v1/pdf/rotate -o "$work/rotated.pdf"
curl -fsS -H "authorization: Bearer $key" -F file=@"$work/rotated.pdf" http://127.0.0.1:3000/v1/pdf/inspect | grep -q '"rotation":90'

echo "== text from the converted docx"
curl -fsS -H "authorization: Bearer $key" -F file=@"$work/report.pdf" http://127.0.0.1:3000/v1/pdf/text | grep -q 'Quarterly Report'

echo "== packages we never ship"
if docker run --rm --entrypoint dpkg-query "$image" -W -f '${Package}\n' | grep -E '^(ghostscript|libgs[0-9]|mupdf|libmupdf|imagemagick|graphicsmagick|poppler-utils|pandoc)'; then
  echo "found a package that must not be in the image"; exit 1
fi
docker run --rm --entrypoint dpkg-query "$image" -W -f '${Package}\n' | grep -E 'poppler' && echo "(libpoppler is a dependency of LibreOffice itself; see docs/licensing.md)" || true

echo "smoke test passed"

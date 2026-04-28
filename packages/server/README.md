# @open-documents/server

A self-hosted REST API for converting documents to PDF and changing PDFs: merge, split, rotate,
watermark, encrypt, compress and the rest, with API keys, async jobs and signed webhooks.

The easiest way to run it is the Docker image, which includes LibreOffice, Chromium, qpdf and
the fonts Office documents expect:

```sh
docker build -f docker/Dockerfile -t open-documents .   # from the repository
docker run --rm -p 3000:3000 -e OPENDOCS_API_KEYS="$(openssl rand -hex 24)" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges open-documents
```

Or from npm, with those programs installed:

```sh
npm install @open-documents/server
npx opendocs-server
```

Endpoints, settings and webhooks: [docs/server.md](https://github.com/capitalism-killed-software/open-documents/blob/main/docs/server.md).

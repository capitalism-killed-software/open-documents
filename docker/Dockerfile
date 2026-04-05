# Open Documents server: the API, LibreOffice for office files, Chromium for web pages.
#
#   docker build -f docker/Dockerfile -t open-documents .
#   docker run --rm -p 3000:3000 -e OPENDOCS_API_KEYS=<a long random key> \
#     --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges open-documents

FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production

# LibreOffice without a desktop, and fonts that keep Office documents laid out as they were
# written: Carlito and Caladea match Calibri and Cambria, Liberation matches Arial, Times and
# Courier, Noto covers most of the world's scripts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-liberation2 \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
      ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/node/package.json packages/node/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/fixtures/package.json packages/fixtures/
COPY examples/browser/package.json examples/browser/
RUN npm ci --omit=dev --workspace @open-documents/server --include-workspace-root=false \
 && npx --no-install playwright-core install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /root/.npm /var/lib/apt/lists/*

COPY packages/core packages/core
COPY packages/node packages/node
COPY packages/server packages/server

USER node
ENV HOST=0.0.0.0 \
    PORT=3000 \
    OPENDOCS_WORK_DIR=/tmp/open-documents \
    HOME=/tmp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/server/bin/opendocs-server.js"]

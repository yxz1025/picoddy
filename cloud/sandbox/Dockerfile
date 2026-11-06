FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        bash \
        chromium \
        fontconfig \
        fonts-liberation \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-writer \
        pandoc \
        poppler-utils \
        python3 \
        python3-venv \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/picoddy
COPY sandbox/package.json sandbox/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

RUN python3 -m venv /opt/picoddy/venv \
    && /opt/picoddy/venv/bin/pip install --no-cache-dir \
        openpyxl==3.1.5 \
        pandas==2.3.3 \
        pdfplumber==0.11.7 \
        Pillow==12.0.0 \
        PyMuPDF==1.26.5 \
        pypdf==6.1.1 \
        python-docx==1.2.0 \
        python-pptx==1.0.2 \
        reportlab==4.4.4

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/picoddy/python
RUN uv python install 3.13.15 \

COPY --chmod=0555 sandbox/mcp-runner.mjs /opt/picoddy/mcp-runner.mjs
COPY --chmod=0555 sandbox/oauth-runner.mjs /opt/picoddy/oauth-runner.mjs
COPY --chmod=0555 sandbox/builtin-runner.mjs /opt/picoddy/builtin-runner.mjs
COPY --chmod=0555 runtime/ /opt/picoddy/runtime/

RUN groupadd --gid 10001 workload \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash workload \
    && install -d -o workload -g workload -m 0700 /workspace /home/workload/.cache \
    && chmod -R go-w /opt/picoddy

ENV HOME=/home/workload \
    PATH=/opt/picoddy/venv/bin:$PATH \
    CHROMIUM_PATH=/usr/bin/chromium

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]

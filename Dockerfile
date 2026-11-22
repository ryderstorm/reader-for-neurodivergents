# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Read Aloud — self-contained image.
#
# The model weights, all 54 voice packs, the spaCy model and the bundled
# espeak-ng library are all baked in, and HF_HUB_OFFLINE is set at runtime, so
# the container never reaches the network. Start it, open the port, done.
#
#   docker build -t read-aloud .                        # CPU (default, ~2 GB)
#   docker build --build-arg TORCH_VARIANT=cu128 -t read-aloud:gpu .
# ---------------------------------------------------------------------------

ARG PYTHON_VERSION=3.12

# --------------------------------------------------------------- build stage
FROM python:${PYTHON_VERSION}-slim AS builder

# cpu keeps the image ~2 GB. cu128 pulls the CUDA wheels (~8 GB) for an
# NVIDIA host running with `--gpus all`.
ARG TORCH_VARIANT=cpu

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

RUN python -m venv /opt/venv && pip install -U pip wheel

# PyTorch first and on its own index, so the variant is pinned before anything
# else can pull in the default (CUDA) build as a transitive dependency.
RUN if [ "$TORCH_VARIANT" = "cpu" ]; then \
      pip install torch --index-url https://download.pytorch.org/whl/cpu ; \
    else \
      pip install torch --index-url https://download.pytorch.org/whl/${TORCH_VARIANT} ; \
    fi

COPY server/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# misaki's English G2P uses spaCy to disambiguate homographs ("read", "lead").
RUN pip install \
  "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

# ------------------------------------------------------------- model stage
# Fetch the full Kokoro repo — weights plus every voice pack — so no voice the
# UI offers triggers a download at runtime.
FROM builder AS models

ENV HF_HOME=/opt/models
RUN python -c "\
from huggingface_hub import snapshot_download; \
p = snapshot_download('hexgrad/Kokoro-82M', allow_patterns=['*.json','*.pth','voices/*.pt','*.md']); \
print('fetched to', p)"

# ------------------------------------------------------------ runtime stage
FROM python:${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="Read Aloud" \
      org.opencontainers.image.description="Markdown reader with real-time word highlighting, powered by Kokoro-82M" \
      org.opencontainers.image.version="1.1.3" \
      org.opencontainers.image.licenses="MIT AND GPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/n2048-creative-technology/reader-for-neurodivergents"

ENV PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/models \
    HF_HUB_OFFLINE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    T2S_DEVICE=auto

# Optional TLS. Mount a certificate and point these at it to serve https,
# which phones require before they will install the reader as an app:
#   -v ./certs:/certs:ro -e T2S_SSL_CERT=/certs/server.crt -e T2S_SSL_KEY=/certs/server.key
ENV T2S_SSL_CERT="" \
    T2S_SSL_KEY=""

# curl is only here for the HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=models  /opt/models /opt/models

WORKDIR /app
COPY server/ /app/server/
COPY web/ /app/web/
COPY samples/ /app/samples/
COPY scripts-tools/check_timestamps.py /app/scripts-tools/
COPY LICENSE THIRD-PARTY-LICENSES.md README.md CHANGELOG.md /app/

# Run unprivileged. The model cache is read-only to the app.
RUN useradd --system --create-home --uid 10001 reader \
 && chown -R reader:reader /app
USER reader

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD if [ -n "$T2S_SSL_CERT" ] && [ -n "$T2S_SSL_KEY" ]; then \
        curl -fsS --cacert "$T2S_SSL_CERT" https://127.0.0.1:8765/api/health; \
      else \
        curl -fsS http://127.0.0.1:8765/api/health; \
      fi || exit 1

CMD ["python", "server/app.py", "--host", "0.0.0.0", "--port", "8765"]

"""
Local web server for the Markdown read-aloud reader.

Serves the static front-end and exposes a small JSON API in front of
Kokoro-82M. Everything runs on this machine; nothing is sent anywhere.
"""

from __future__ import annotations

import argparse
import base64
import io
import logging
import mimetypes
import os
import threading
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from numpy.typing import NDArray
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field
from pythonjsonlogger.json import JsonFormatter
from tts import (
    LANGUAGES,
    SAMPLE_RATE,
    KokoroEngine,
    available_cpus,
    limit_torch_threads,
)

# limit_torch_threads must run before anything imports torch.
_THREADS = limit_torch_threads()


def configure_logging() -> None:
    """Configure structured JSON logging on the root logger."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


configure_logging()
log = logging.getLogger("t2s.app")

SPEAK_REQUESTS = Counter(
    "read_aloud_speak_requests_total",
    "Total synthesis requests handled by /api/speak",
    ["status"],
)
SPEAK_DURATION_SECONDS = Histogram(
    "read_aloud_speak_duration_seconds",
    "Wall-clock synthesis duration in seconds",
)

__version__ = "1.1.3"

# Some minimal base images do not know these, and a manifest served as
# application/octet-stream is silently ignored by the browser.
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
SAMPLES_DIR = ROOT / "samples"

engine = KokoroEngine(device=os.environ.get("T2S_DEVICE", "auto"))
app = FastAPI(title="Read Aloud", docs_url="/api/docs", redoc_url=None)
# On a private machine any origin is fine and makes development easier. On a
# public deployment it means any website can spend your CPU generating speech
# from a visitor's browser, so set T2S_CORS_ORIGINS to your own origin there.
_origins = [o.strip() for o in os.environ.get("T2S_CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])
# Audio is returned as base64 WAV, which compresses to about 60%. Over a local
# network that hardly matters; over the internet it is roughly 39 KB per second
# of speech instead of 63. Level 5 rather than the default 9: on a small CPU
# the compression time competes with synthesis for the same cores.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    voice: str = "af_heart"
    lang: str = "a"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


def wav_bytes(audio: NDArray[np.float32]) -> bytes:
    """Encode float32 mono audio as a 16-bit PCM WAV.

    Uses the standard library rather than libsndfile: it is one fewer
    dependency, one fewer native library in the container image, and it keeps
    the LGPL out of the distribution. See THIRD-PARTY-LICENSES.md.
    """
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": __version__,
        "model": "hexgrad/Kokoro-82M",
        "device": engine.resolved_device,
        "threads": _THREADS,
        "sample_rate": SAMPLE_RATE,
        "loaded": engine.is_loaded,
    }


@app.get("/api/metrics")
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/voices")
def voices() -> dict[str, Any]:
    return {"languages": LANGUAGES, "voices": engine.list_voices()}


@app.post("/api/speak")
def speak(req: SpeakRequest) -> dict[str, Any]:
    """Synthesise one chunk and return audio plus per-word timings.

    Timings are seconds from the start of *this* chunk's audio, and each word
    carries the character range it occupies in the submitted text, so the
    client can map them straight back onto the spans it already rendered.
    """
    text = req.text.strip()
    if not text:
        SPEAK_REQUESTS.labels(status="empty_text").inc()
        raise HTTPException(400, "empty text")
    t0 = time.perf_counter()
    try:
        seg = engine.synth(text, voice=req.voice, lang_code=req.lang, speed=req.speed)
    except Exception as exc:
        SPEAK_REQUESTS.labels(status="error").inc()
        log.exception("synthesis failed")
        raise HTTPException(500, f"synthesis failed: {exc}") from exc
    if seg.audio.size == 0:
        SPEAK_REQUESTS.labels(status="empty_audio").inc()
        raise HTTPException(422, "model produced no audio for this text")
    SPEAK_DURATION_SECONDS.observe(time.perf_counter() - t0)
    SPEAK_REQUESTS.labels(status="ok").inc()
    return {
        "sample_rate": SAMPLE_RATE,
        "duration": seg.duration,
        "words": seg.words,
        "audio": base64.b64encode(wav_bytes(seg.audio)).decode("ascii"),
    }


@app.api_route("/sw.js", methods=["GET", "HEAD"])
def service_worker() -> FileResponse:
    """Served from the root so the worker's scope can cover the whole origin.

    no-cache matters: browsers check for a new worker on every navigation, and
    a stale cached copy would pin users to an old build.
    """
    return FileResponse(
        WEB_DIR / "sw.js",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.api_route("/manifest.webmanifest", methods=["GET", "HEAD"])
def manifest() -> FileResponse:
    return FileResponse(
        WEB_DIR / "manifest.webmanifest",
        media_type="application/manifest+json",
    )


@app.api_route("/", methods=["GET", "HEAD"])
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


if SAMPLES_DIR.is_dir():
    app.mount("/samples", StaticFiles(directory=SAMPLES_DIR), name="samples")
app.mount("/", StaticFiles(directory=WEB_DIR), name="web")


def main() -> None:
    ap = argparse.ArgumentParser(description="Read Aloud - local Markdown TTS reader")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument(
        "--device", default=os.environ.get("T2S_DEVICE", "auto"), choices=["auto", "cuda", "cpu"]
    )
    ap.add_argument("--no-warm", action="store_true", help="skip loading the model at startup")
    ap.add_argument(
        "--ssl-certfile",
        default=os.environ.get("T2S_SSL_CERT"),
        help="TLS certificate. Serving over https is required to "
        "install the reader as an app on a phone.",
    )
    ap.add_argument("--ssl-keyfile", default=os.environ.get("T2S_SSL_KEY"), help="TLS private key")
    args = ap.parse_args()

    log.info("%d CPU(s) available to this process", available_cpus())
    engine.set_device(args.device)
    if not args.no_warm:
        # Warm in a thread so the browser can open while the model loads.
        threading.Thread(target=_warm, daemon=True).start()

    import uvicorn

    tls = bool(args.ssl_certfile and args.ssl_keyfile)
    if tls:
        # uvicorn's failure here is a bare PermissionError with no path in it.
        # In a container this is almost always the key being mode 600 and owned
        # by a different uid than the one the container runs as.
        for label, path in (("certificate", args.ssl_certfile), ("key", args.ssl_keyfile)):
            try:
                with open(path, "rb"):
                    pass
            except OSError as exc:
                log.error("cannot read the TLS %s at %s: %s", label, path, exc)
                if os.path.exists(path):
                    log.error(
                        "the file exists but is not readable by uid %d. In Docker, "
                        'run with --user "$(id -u):$(id -g)" so the container can '
                        "read a key that stays mode 600 on the host.",
                        os.getuid(),
                    )
                raise SystemExit(1) from exc
    scheme = "https" if tls else "http"
    log.info("%s://%s:%d", scheme, args.host, args.port)
    if not tls and args.host not in ("127.0.0.1", "localhost"):
        log.warning(
            "serving over http on a non-local address: phones will refuse to "
            "install this as an app or use it offline. See ./scripts-tools/make-cert.sh"
        )
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",
        ssl_certfile=args.ssl_certfile if tls else None,
        ssl_keyfile=args.ssl_keyfile if tls else None,
    )


def _warm() -> None:
    try:
        engine.warm()
        log.info("model warm on %s - ready", engine.resolved_device)
    except Exception:
        log.exception("warm-up failed; will retry on first request")


if __name__ == "__main__":
    main()

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
import os
import sys
import wave
import threading
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts import LANGUAGES, SAMPLE_RATE, KokoroEngine  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("t2s.app")

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
SAMPLES_DIR = ROOT / "samples"

engine = KokoroEngine(device=os.environ.get("T2S_DEVICE", "auto"))
app = FastAPI(title="Read Aloud", docs_url="/api/docs", redoc_url=None)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    voice: str = "af_heart"
    lang: str = "a"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


def wav_bytes(audio: np.ndarray) -> bytes:
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
def health():
    return {
        "ok": True,
        "model": "hexgrad/Kokoro-82M",
        "device": engine.resolved_device,
        "sample_rate": SAMPLE_RATE,
        "loaded": engine.is_loaded,
    }


@app.get("/api/voices")
def voices():
    return {"languages": LANGUAGES, "voices": engine.list_voices()}


@app.post("/api/speak")
def speak(req: SpeakRequest):
    """Synthesise one chunk and return audio plus per-word timings.

    Timings are seconds from the start of *this* chunk's audio, and each word
    carries the character range it occupies in the submitted text, so the
    client can map them straight back onto the spans it already rendered.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    try:
        seg = engine.synth(text, voice=req.voice, lang_code=req.lang, speed=req.speed)
    except Exception as exc:
        log.exception("synthesis failed")
        raise HTTPException(500, f"synthesis failed: {exc}") from exc
    if seg.audio.size == 0:
        raise HTTPException(422, "model produced no audio for this text")
    return {
        "sample_rate": SAMPLE_RATE,
        "duration": seg.duration,
        "words": seg.words,
        "audio": base64.b64encode(wav_bytes(seg.audio)).decode("ascii"),
    }


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


if SAMPLES_DIR.is_dir():
    app.mount("/samples", StaticFiles(directory=SAMPLES_DIR), name="samples")
app.mount("/", StaticFiles(directory=WEB_DIR), name="web")


def main() -> None:
    ap = argparse.ArgumentParser(description="Read Aloud - local Markdown TTS reader")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--device", default=os.environ.get("T2S_DEVICE", "auto"),
                    choices=["auto", "cuda", "cpu"])
    ap.add_argument("--no-warm", action="store_true",
                    help="skip loading the model at startup")
    args = ap.parse_args()

    engine.set_device(args.device)
    if not args.no_warm:
        # Warm in a thread so the browser can open while the model loads.
        threading.Thread(target=_warm, daemon=True).start()

    import uvicorn

    log.info("http://%s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def _warm() -> None:
    try:
        engine.warm()
        log.info("model warm on %s - ready", engine.resolved_device)
    except Exception:
        log.exception("warm-up failed; will retry on first request")


if __name__ == "__main__":
    main()

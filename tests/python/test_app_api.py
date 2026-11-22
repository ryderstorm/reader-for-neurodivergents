"""Unit tests for the FastAPI endpoints, WAV encoding, structured logging, and metrics."""

from __future__ import annotations

import base64
import io
import json
import logging
import wave
from typing import Any

import app as server_app
import numpy as np
import pytest
from fastapi.testclient import TestClient
from tts import SAMPLE_RATE, Segment

client = TestClient(server_app.app)


def test_wav_bytes_encodes_valid_mono_16bit_pcm() -> None:
    audio = np.array([-1.5, -0.5, 0.0, 0.5, 1.5], dtype=np.float32)
    raw = server_app.wav_bytes(audio)
    with wave.open(io.BytesIO(raw), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getframerate() == SAMPLE_RATE
        assert wav.getnframes() == 5


def test_health_endpoint_reports_server_metadata() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["model"] == "hexgrad/Kokoro-82M"
    assert body["sample_rate"] == SAMPLE_RATE
    assert body["threads"] >= 1
    assert "loaded" in body


def test_metrics_endpoint_exposes_prometheus_counters() -> None:
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    assert "read_aloud_speak_requests_total" in resp.text
    assert "read_aloud_speak_duration_seconds" in resp.text


def test_voices_endpoint_returns_languages_and_voices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server_app.engine, "list_voices", lambda: {"a": ["af_heart"]})
    resp = client.get("/api/voices")
    assert resp.status_code == 200
    data = resp.json()
    assert "a" in data["languages"]
    assert data["voices"] == {"a": ["af_heart"]}


def test_speak_endpoint_returns_wav_and_word_timings(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_seg = Segment(
        audio=np.zeros(SAMPLE_RATE // 4, dtype=np.float32),
        words=[{"cs": 0, "ce": 5, "s": 0.0, "e": 0.25}],
    )
    monkeypatch.setattr(server_app.engine, "synth", lambda *_a, **_kw: fake_seg)

    resp = client.post(
        "/api/speak",
        json={"text": "Hello", "voice": "af_heart", "lang": "a", "speed": 1.0},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sample_rate"] == SAMPLE_RATE
    assert body["duration"] == pytest.approx(0.25)
    assert body["words"] == [{"cs": 0, "ce": 5, "s": 0.0, "e": 0.25}]
    decoded = base64.b64decode(body["audio"])
    assert decoded[:4] == b"RIFF"


def test_speak_endpoint_rejects_whitespace_only_text() -> None:
    resp = client.post("/api/speak", json={"text": "   \n\t  "})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "empty text"


def test_speak_endpoint_returns_422_when_model_produces_empty_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    empty_seg = Segment(audio=np.zeros(0, dtype=np.float32), words=[])
    monkeypatch.setattr(server_app.engine, "synth", lambda *_a, **_kw: empty_seg)

    resp = client.post("/api/speak", json={"text": "Hello"})
    assert resp.status_code == 422


def test_speak_endpoint_returns_500_when_synthesis_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_args: Any, **_kwargs: Any) -> Segment:
        raise RuntimeError("boom")

    monkeypatch.setattr(server_app.engine, "synth", boom)
    resp = client.post("/api/speak", json={"text": "Hello"})
    assert resp.status_code == 500
    assert "boom" in resp.json()["detail"]


def test_static_and_pwa_routes_serve_expected_headers() -> None:
    idx = client.get("/")
    assert idx.status_code == 200
    assert "no-cache" in idx.headers.get("cache-control", "")

    sw = client.get("/sw.js")
    assert sw.status_code == 200
    assert sw.headers.get("service-worker-allowed") == "/"
    assert "no-cache" in sw.headers.get("cache-control", "")

    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert "application/manifest+json" in manifest.headers["content-type"]


def test_security_headers_are_set_on_app_responses() -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert "camera=()" in resp.headers["permissions-policy"]
    assert resp.headers["cross-origin-embedder-policy"] == "require-corp"
    assert resp.headers["cross-origin-opener-policy"] == "same-origin"
    assert resp.headers["cross-origin-resource-policy"] == "same-origin"
    assert "default-src 'self'" in resp.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in resp.headers["content-security-policy"]


def test_configure_logging_emits_valid_json(capsys: pytest.CaptureFixture[str]) -> None:
    server_app.configure_logging()
    logging.getLogger("t2s.test").info("structured check")
    err = capsys.readouterr().err.strip().splitlines()[-1]
    parsed = json.loads(err)
    assert parsed["message"] == "structured check"
    assert parsed["levelname"] == "INFO"
    assert parsed["name"] == "t2s.test"

"""Unit tests for Kokoro TTS word splitting, alignment, CPU pinning, and caching."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from tts import (
    FALLBACK_VOICES,
    SAMPLE_RATE,
    KokoroEngine,
    Segment,
    _key,
    available_cpus,
    limit_torch_threads,
    split_words,
)


@dataclass
class _FakeToken:
    text: str
    start_ts: float | None
    end_ts: float | None


@dataclass
class _FakeChunk:
    audio: Any
    graphemes: str
    tokens: list[_FakeToken] | None = None


def test_split_words_preserves_contractions_hyphens_and_numbers() -> None:
    text = "Dr. Wilson's well-known price rose to $3.50 in 2024."
    words = [w for _, _, w in split_words(text)]
    assert words == [
        "Dr",
        "Wilson's",
        "well-known",
        "price",
        "rose",
        "to",
        "3.50",
        "in",
        "2024",
    ]
    for cs, ce, word in split_words(text):
        assert text[cs:ce] == word


def test_split_words_handles_accented_latin_and_devanagari_combining_marks() -> None:
    es = "El niño leyó «Cien años»."
    es_words = [w for _, _, w in split_words(es)]
    assert es_words == ["El", "niño", "leyó", "Cien", "años"]

    hi = "मुझे यह पसंद है।"
    hi_words = [w for _, _, w in split_words(hi)]
    assert len(hi_words) == 4
    assert hi_words[0] == "मुझे"


def test_key_strips_punctuation_and_underscores_and_lowercases() -> None:
    assert _key("Well-Known_2024!") == "wellknown2024"
    assert _key("...") == ""


def test_segment_duration_uses_sample_rate() -> None:
    seg = Segment(audio=np.zeros(SAMPLE_RATE * 2, dtype=np.float32), words=[])
    assert seg.duration == pytest.approx(2.0)


def test_align_maps_exact_and_expanded_tokens_and_interpolates_gaps() -> None:
    eng = KokoroEngine(device="cpu")
    text = "In 2024 Dr. Wilson arrived."
    tokens = [
        _FakeToken("In", 0.0, 0.2),
        _FakeToken("twenty", 0.2, 0.4),
        _FakeToken("twenty", 0.4, 0.6),
        _FakeToken("four", 0.6, 0.8),
        _FakeToken(",", None, None),
        _FakeToken("Wilson", 1.1, 1.5),
        _FakeToken("arrived", 1.5, 2.0),
    ]
    aligned = eng._align(text, tokens, duration=2.0, t_offset=0.5, char_offset=10)
    assert len(aligned) == 5
    # Exact offsets shifted by char_offset
    assert aligned[0]["cs"] == 10
    assert aligned[0]["ce"] == 12
    assert aligned[0]["s"] == pytest.approx(0.5)
    assert aligned[0]["e"] == pytest.approx(0.7)
    # Unmatched tokens ("2024", "Dr") are smoothly interpolated and monotonic
    prev_s = 0.0
    for item in aligned:
        assert item["s"] >= prev_s
        assert item["e"] > item["s"]
        assert item["e"] <= 2.51
        prev_s = item["s"]


def test_align_returns_empty_for_punctuation_only_text() -> None:
    eng = KokoroEngine(device="cpu")
    assert eng._align("... !!!", None, duration=1.0, t_offset=0.0, char_offset=0) == []


def test_align_without_tokens_estimates_proportional_timings() -> None:
    eng = KokoroEngine(device="cpu")
    aligned = eng._align("a longerword", None, duration=2.2, t_offset=0.0, char_offset=0)
    assert len(aligned) == 2
    assert aligned[0]["s"] == pytest.approx(0.0)
    assert aligned[1]["e"] == pytest.approx(2.2)
    assert (aligned[1]["e"] - aligned[1]["s"]) > (aligned[0]["e"] - aligned[0]["s"])


def test_engine_resolve_device_and_set_device() -> None:
    eng = KokoroEngine(device="cpu")
    assert eng._resolve_device() == "cpu"
    eng.set_device("cuda")
    assert eng._resolve_device() == "cuda"
    eng.set_device("auto")
    assert eng._resolve_device() in ("cpu", "cuda")


def test_engine_synth_stitches_chunks_and_enforces_lru_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_pipeline(text: str, **_kwargs: Any) -> list[_FakeChunk]:
        calls.append(text)
        half = np.ones(SAMPLE_RATE // 2, dtype=np.float32) * 0.25
        return [
            _FakeChunk(
                audio=half,
                graphemes="Hello world",
                tokens=[
                    _FakeToken("Hello", 0.0, 0.2),
                    _FakeToken("world", 0.2, 0.45),
                ],
            ),
            _FakeChunk(audio=None, graphemes="ignored"),
            _FakeChunk(
                audio=half,
                graphemes="again",
                tokens=[_FakeToken("again", 0.0, 0.4)],
            ),
        ]

    eng = KokoroEngine(device="cpu", cache_size=2)
    monkeypatch.setattr(eng, "pipeline", lambda _lang: fake_pipeline)

    seg1 = eng.synth("Hello world again")
    assert seg1.duration == pytest.approx(1.0)
    assert len(seg1.words) == 3
    assert seg1.words[2]["s"] >= 0.5
    assert calls == ["Hello world again"]

    # Cache hit does not invoke pipeline again
    seg1_cached = eng.synth("Hello world again")
    assert seg1_cached is seg1
    assert len(calls) == 1

    # Exceed cache_size=2 to trigger LRU eviction
    eng.synth("Second sentence")
    eng.synth("Third sentence")
    assert len(eng._cache) == 2
    eng.synth("Hello world again")
    assert len(calls) == 4


def test_engine_warm_delegates_to_synth(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, str, str]] = []

    def fake_synth(
        text: str,
        voice: str = "af_heart",
        lang_code: str = "a",
        speed: float = 1.0,
    ) -> Segment:
        seen.append((text, voice, lang_code))
        return Segment(audio=np.zeros(10, dtype=np.float32), words=[])

    eng = KokoroEngine(device="cpu")
    monkeypatch.setattr(eng, "synth", fake_synth)
    eng.warm()
    assert seen == [("Ready.", "af_heart", "a")]


def test_list_voices_falls_back_when_hub_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    eng = KokoroEngine(device="cpu")
    monkeypatch.setitem(os.environ, "HF_HUB_OFFLINE", "1")
    voices = eng.list_voices()
    assert voices == FALLBACK_VOICES or "a" in voices


def test_available_cpus_reads_cgroup_v2_and_v1_quotas(monkeypatch: pytest.MonkeyPatch) -> None:
    orig_read_text = Path.read_text

    def fake_v2(self: Path, *args: Any, **kwargs: Any) -> str:
        if str(self) == "/sys/fs/cgroup/cpu.max":
            return "200000 100000\n"
        return orig_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fake_v2)
    assert available_cpus() == 2

    def fake_v1(self: Path, *args: Any, **kwargs: Any) -> str:
        if str(self) == "/sys/fs/cgroup/cpu.max":
            raise OSError("missing")
        if str(self) == "/sys/fs/cgroup/cpu/cpu.cfs_quota_us":
            return "300000\n"
        if str(self) == "/sys/fs/cgroup/cpu/cpu.cfs_period_us":
            return "100000\n"
        return orig_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fake_v1)
    assert available_cpus() == 3


def test_limit_torch_threads_sets_blas_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        monkeypatch.delenv(var, raising=False)
    n = limit_torch_threads()
    assert n >= 1
    assert os.environ["OMP_NUM_THREADS"] == str(n)
    assert os.environ["OPENBLAS_NUM_THREADS"] == str(n)

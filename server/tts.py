"""
Kokoro-82M TTS engine wrapper with word-level timestamps.

Kokoro (hexgrad/Kokoro-82M, Apache-2.0) is a StyleTTS2-derived 82M-parameter
model. Because it uses an explicit duration predictor (rather than an
autoregressive audio-token decoder), it can tell us exactly how many frames
each phoneme occupies -- which is what gives us per-word start/end times for
free, with no forced aligner and no extra model. That is the whole reason this
app can highlight words in sync with the audio.
"""

from __future__ import annotations

import logging
import re
import threading
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

log = logging.getLogger("t2s.tts")

SAMPLE_RATE = 24000

# Kokoro language codes -> human labels. 'a'/'b' are the two best-supported.
LANGUAGES = {
    "a": "English (US)",
    "b": "English (UK)",
    "e": "Spanish",
    "f": "French",
    "h": "Hindi",
    "i": "Italian",
    "p": "Portuguese (BR)",
}

# Fallback voice list, used if the Hub file listing is unavailable (offline).
FALLBACK_VOICES = {
    "a": ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah",
          "am_michael", "am_fenrir", "am_puck", "am_adam"],
    "b": ["bf_emma", "bf_isabella", "bf_alice", "bm_george", "bm_fable", "bm_daniel"],
    "e": ["ef_dora", "em_alex"],
    "f": ["ff_siwis"],
    "h": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
    "i": ["if_sara", "im_nicola"],
    "p": ["pf_dora", "pm_alex"],
}

# A word, for highlighting purposes, is a run of letters, digits and combining
# marks, plus the apostrophes and hyphens that live inside one (don't,
# well-known, 3.14). Combining marks have to count: Python's \w excludes them,
# which would chop Devanagari into bare consonants.
_JOINERS = "'’-.,"


def _is_word_char(ch: str) -> bool:
    return ch.isalnum() or unicodedata.category(ch)[0] == "M"


def split_words(text: str) -> list[tuple[int, int, str]]:
    """Split into (start_char, end_char, word).

    This must stay equivalent to WORD_RE in web/js/document.js, because the
    client maps our timings back onto its spans by character range.
    """
    out: list[tuple[int, int, str]] = []
    i, n = 0, len(text)
    while i < n:
        if not _is_word_char(text[i]):
            i += 1
            continue
        start = i
        i += 1
        while i < n:
            if _is_word_char(text[i]):
                i += 1
            elif text[i] in _JOINERS and i + 1 < n and _is_word_char(text[i + 1]):
                i += 2
            else:
                break
        out.append((start, i, text[start:i]))
    return out


def _key(s: str) -> str:
    """Comparison key: letters and digits only, lowercased."""
    return re.sub(r"[^\w]", "", s, flags=re.UNICODE).lower().replace("_", "")


@dataclass
class Segment:
    """One synthesised chunk: audio plus word timings relative to its own start."""
    audio: np.ndarray
    words: list[dict] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return len(self.audio) / SAMPLE_RATE


class KokoroEngine:
    """Thread-safe, lazily-loaded Kokoro pipeline with an LRU result cache."""

    def __init__(self, device: str | None = None, cache_size: int = 256):
        self._device = device
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple, Segment] = OrderedDict()
        self._cache_size = cache_size
        self.resolved_device = "unknown"

    @property
    def is_loaded(self) -> bool:
        return bool(self._pipelines)

    # ---------------------------------------------------------------- loading

    def set_device(self, device: str) -> None:
        """Pin the device. Only meaningful before the model is loaded."""
        self._device = device

    def _resolve_device(self) -> str:
        if self._device and self._device != "auto":
            return self._device
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except Exception:  # pragma: no cover - torch always present in practice
            pass
        return "cpu"

    def pipeline(self, lang_code: str):
        """Get (or build) the KPipeline for a language. One model, N G2P frontends."""
        lang_code = lang_code if lang_code in LANGUAGES else "a"
        with self._lock:
            if lang_code not in self._pipelines:
                from kokoro import KModel, KPipeline

                if not self._pipelines:
                    self.resolved_device = self._resolve_device()
                    log.info("loading Kokoro-82M on %s", self.resolved_device)
                    self._model = KModel().to(self.resolved_device).eval()
                # repo_id is passed explicitly to silence kokoro's default warning
                self._pipelines[lang_code] = KPipeline(
                    lang_code=lang_code,
                    model=self._model,
                    repo_id="hexgrad/Kokoro-82M",
                )
                log.info("G2P front-end ready for lang_code=%r", lang_code)
            return self._pipelines[lang_code]

    def warm(self, lang_code: str = "a", voice: str = "af_heart") -> None:
        """Load model + voice + G2P so the first real request is not slow."""
        self.synth("Ready.", voice=voice, lang_code=lang_code)

    # ------------------------------------------------------------------ voices

    def list_voices(self) -> dict[str, list[str]]:
        try:
            from huggingface_hub import list_repo_files

            files = list_repo_files("hexgrad/Kokoro-82M")
            found: dict[str, list[str]] = {}
            for f in files:
                if f.startswith("voices/") and f.endswith(".pt"):
                    name = f[len("voices/"):-len(".pt")]
                    found.setdefault(name[0], []).append(name)
            if found:
                return {k: sorted(v) for k, v in found.items() if k in LANGUAGES}
        except Exception as exc:
            log.warning("voice listing failed (%s); using fallback list", exc)
        return FALLBACK_VOICES

    # ------------------------------------------------------------------ synth

    def synth(self, text: str, voice: str = "af_heart", lang_code: str = "a",
              speed: float = 1.0) -> Segment:
        """Synthesise one chunk of text and return audio + per-word timings."""
        cache_key = (text, voice, lang_code, round(speed, 3))
        with self._lock:
            hit = self._cache.get(cache_key)
            if hit is not None:
                self._cache.move_to_end(cache_key)
                return hit

        pipeline = self.pipeline(lang_code)
        with self._lock:  # KModel forward is not re-entrant; serialise inference
            chunks = list(pipeline(text, voice=voice, speed=speed,
                                   split_pattern=r"\n{2,}"))

        audio_parts: list[np.ndarray] = []
        words: list[dict] = []
        offset_samples = 0
        # Kokoro may internally split the chunk; stitch the pieces back together
        # and shift each piece's timestamps by everything that came before it.
        cursor = 0
        for res in chunks:
            audio = res.audio
            if audio is None:
                continue
            audio = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
            piece_text = res.graphemes if isinstance(res.graphemes, str) else ""
            # Locate this piece inside the original text so char offsets stay true.
            found = text.find(piece_text, cursor) if piece_text else -1
            base_char = found if found >= 0 else cursor
            if piece_text:
                cursor = base_char + len(piece_text)

            t0 = offset_samples / SAMPLE_RATE
            words.extend(
                self._align(piece_text, getattr(res, "tokens", None),
                            len(audio) / SAMPLE_RATE, t0, base_char)
            )
            audio_parts.append(audio)
            offset_samples += len(audio)

        full = np.concatenate(audio_parts) if audio_parts else np.zeros(0, dtype=np.float32)
        seg = Segment(audio=full.astype(np.float32), words=words)

        with self._lock:
            self._cache[cache_key] = seg
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return seg

    # -------------------------------------------------------------- alignment

    def _align(self, text: str, tokens: Iterable | None, duration: float,
               t_offset: float, char_offset: int) -> list[dict]:
        """
        Map Kokoro's per-token timings onto the *original* words of `text`.

        Kokoro hands back misaki tokens carrying .text / .start_ts / .end_ts.
        Token text is usually the original grapheme run, but the G2P front-end
        normalises some spans (numbers, currency, abbreviations) so the token
        stream is not always 1:1 with source words. We therefore align by
        walking both sequences and matching on alphanumeric-only keys, then
        interpolate over anything that failed to match. Word order is always
        preserved by the front-end, which is what makes this safe.
        """
        src = split_words(text)
        if not src:
            return []

        timed: list[tuple[str, float, float]] = []
        for tk in tokens or []:
            s, e = getattr(tk, "start_ts", None), getattr(tk, "end_ts", None)
            k = _key(getattr(tk, "text", "") or "")
            if s is None or e is None or not k:
                continue
            timed.append((k, float(s), float(e)))

        out: list[dict] = [
            {"cs": char_offset + s, "ce": char_offset + e, "s": None, "e": None}
            for s, e, _ in src
        ]

        if timed:
            ti = 0
            for wi, (_, _, word) in enumerate(src):
                want = _key(word)
                if not want:
                    continue
                # Find the next token that starts this word (look ahead a little
                # so one skipped token does not derail the whole paragraph).
                match = None
                for probe in range(ti, min(ti + 6, len(timed))):
                    tk = timed[probe][0]
                    if tk == want or want.startswith(tk) or tk.startswith(want):
                        match = probe
                        break
                if match is None:
                    continue
                start = timed[match][1]
                end = timed[match][2]
                got = timed[match][0]
                ti = match + 1
                # A source word may have been expanded into several tokens
                # ("2024" -> "twenty" "twenty" "four"); consume until covered.
                while len(got) < len(want) and ti < len(timed):
                    nxt = timed[ti][0]
                    if not want.startswith(got + nxt) and nxt not in want:
                        break
                    got += nxt
                    end = timed[ti][2]
                    ti += 1
                out[wi]["s"] = start + t_offset
                out[wi]["e"] = end + t_offset

        self._fill_gaps(out, t_offset, t_offset + duration, src)
        return out

    @staticmethod
    def _fill_gaps(words: list[dict], t_start: float, t_end: float,
                   src: list[tuple[int, int, str]]) -> None:
        """Interpolate timings for words the aligner could not match.

        Unmatched runs are shared out between their known neighbours in
        proportion to word length, which keeps the highlight moving smoothly
        instead of freezing on a word until the next anchor arrives.
        """
        n = len(words)
        i = 0
        while i < n:
            if words[i]["s"] is not None:
                i += 1
                continue
            j = i
            while j < n and words[j]["s"] is None:
                j += 1
            left = words[i - 1]["e"] if i > 0 and words[i - 1]["e"] is not None else t_start
            right = words[j]["s"] if j < n and words[j]["s"] is not None else t_end
            if right < left:
                right = left
            weights = [max(1, len(src[k][2])) for k in range(i, j)]
            total = sum(weights) or 1
            span = right - left
            pos = left
            for k, w in zip(range(i, j), weights):
                step = span * w / total
                words[k]["s"] = pos
                words[k]["e"] = pos + step
                pos += step
            i = j

        # Guarantee monotonic, non-degenerate spans.
        prev = t_start
        for w in words:
            w["s"] = max(prev, min(w["s"], t_end))
            w["e"] = max(w["s"] + 0.01, min(w["e"], t_end))
            prev = w["s"]

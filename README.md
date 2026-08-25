# Read Aloud

A browser-based Markdown reader that speaks the document out loud and
highlights each word as it is spoken. Built for readers with **dyslexia** or
**ADHD**: bimodal (see + hear) reading, an adjustable pace, a focus mask, and
full control over typography and colour.

Everything runs locally. The text you open never leaves your machine.


---

## What it does

- **Reads any Markdown file** — drag and drop, file picker, or paste.
- **Highlights the word being spoken, in real time**, plus a soft band on the
  sentence around it. The timings come from the model itself, not from a guess.
- **Speed 0.5× – 3×**, adjustable while it is speaking, pitch preserved.
- **Click any word to start reading from there.**
- **Focus mask** dims everything except the current sentence or paragraph.
- **Reading ruler** tracks the line being read.
- **Typography controls**: OpenDyslexic and Atkinson Hyperlegible, text size,
  line spacing, letter spacing, word spacing, line width, bionic bolding.
- **Seven tinted colour themes** including a night mode.
- **Code blocks are skipped by default** — hearing punctuation read aloud is
  rarely useful — but they are still displayed.
- Everything persists between sessions.

---

## Requirements

| | |
|---|---|
| Python | 3.10 – 3.12 (Kokoro does not support 3.13+) |
| Disk | ~5.5 GB, of which 5 GB is PyTorch's CUDA wheels. `T2S_CPU_ONLY=1 ./scripts-tools/setup.sh` installs the CPU build instead — about 500 MB total |
| GPU | Optional. NVIDIA + CUDA is used if present; ~1 GB VRAM |
| CPU fallback | Works fine — Kokoro is 82M parameters |
| Browser | Firefox, Chrome, Safari 16.4+, Opera, Edge |

## Install

```bash
./scripts-tools/setup.sh
```

This creates `.venv`, installs the dependencies, downloads Kokoro‑82M (~330 MB)
and the spaCy model its text front-end needs, then verifies that word timings
come back correctly on your hardware.

Kokoro is small enough that CPU is a perfectly reasonable choice. If you would
rather not spend 5 GB on CUDA wheels:

```bash
T2S_CPU_ONLY=1 ./scripts-tools/setup.sh
```

## Run

```bash
./scripts-tools/run.sh          # opens http://127.0.0.1:8765
```

Useful environment variables:

```bash
PORT=9000 ./scripts-tools/run.sh          # different port
T2S_DEVICE=cpu ./scripts-tools/run.sh     # force CPU
HOST=0.0.0.0 ./scripts-tools/run.sh       # reachable from your LAN
OPEN=0 ./scripts-tools/run.sh             # don't launch a browser
```

## Keyboard

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next sentence |
| <kbd>↑</kbd> <kbd>↓</kbd> | Faster / slower |
| <kbd>R</kbd> | Repeat this sentence |
| <kbd>F</kbd> | Cycle the focus mask |
| <kbd>Esc</kbd> | Stop, or close the settings panel |

---

## The voice model

**[Kokoro‑82M](https://huggingface.co/hexgrad/Kokoro-82M)** (Apache‑2.0,
82M parameters, 54 voices, 7 languages). Chosen over larger and newer models
for one architectural reason that matters here more than raw voice quality:

Kokoro is a StyleTTS2 derivative with an **explicit duration predictor**. It
decides, before generating audio, how many frames each phoneme occupies. That
means it can hand back the exact start and end time of every word — no forced
aligner, no second model, no guessing. Autoregressive models (Qwen3‑TTS,
Higgs, Chatterbox, F5‑TTS) sound better on some material but emit audio tokens
without a text alignment, so word-accurate highlighting would need Whisper or
a forced aligner in the loop, adding latency and a second failure mode.

Kokoro is also small enough to be effectively instant. On the RTX 3050 in this
machine it synthesises at **25–35× real time**; a sentence is ready in about
150 ms, so the next one is always buffered before the current one ends.

See [`docs/model-research.md`](docs/model-research.md) for the full comparison
and the alternatives that were considered.

### Timing accuracy by language

| Language | Word highlight |
|---|---|
| English (US) `a`, English (UK) `b` | **Measured** — exact per-word timings from the model |
| Spanish, French, Italian, Portuguese, Hindi | Estimated — spread across the sentence in proportion to word length |

Kokoro only exposes per-token timings through its English text front-end. The
other languages still read and highlight; the highlight can drift slightly
inside a long sentence. The settings panel says so when you pick one.

---

## Layout

```
├── server/
│   ├── app.py           FastAPI: static files + /api/speak
│   ├── tts.py           Kokoro wrapper, word alignment, LRU cache
│   └── requirements.txt
├── web/
│   ├── index.html
│   ├── css/app.css      themes, typography, highlighting, focus mask
│   ├── js/
│   │   ├── app.js       wiring
│   │   ├── document.js  Markdown -> blocks -> word spans
│   │   ├── player.js    fetch, prefetch, playback, highlight loop
│   │   ├── ui.js        settings panel, keyboard, ruler
│   │   ├── settings.js  preferences + persistence
│   │   └── api.js       server client
│   ├── fonts/           OpenDyslexic, Atkinson Hyperlegible (both OFL)
│   └── vendor/          marked, DOMPurify (both MIT)
├── scripts-tools/
│   ├── setup.sh
│   ├── run.sh
│   ├── check_timestamps.py   verifies alignment on your hardware
│   └── test_frontend.mjs     headless end-to-end test
├── samples/welcome.md
└── docs/
    ├── model-research.md
    └── architecture.md
```

## Tests

```bash
.venv/bin/python scripts-tools/check_timestamps.py     # model + alignment

npm i jsdom@24                                          # once, in the repo root
node scripts-tools/test_frontend.mjs                    # server must be running
```

The second one renders the sample document through the real front-end code,
synthesises a spread of blocks against the running server, and asserts that
every word span receives a monotonic, in-range timing. It is the test that
catches sync drift.

## Licence

Application code: MIT. Bundled dependencies keep their own licences —
Kokoro‑82M (Apache‑2.0), OpenDyslexic and Atkinson Hyperlegible (SIL OFL 1.1),
marked and DOMPurify (MIT).
# reader-for-neurodivergents

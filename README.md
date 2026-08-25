# Reader for Neurodivergents

A Markdown reader that speaks a document out loud and highlights each word
**as it is spoken**. Built for readers with **dyslexia** or **ADHD**: bimodal
(see + hear) reading, an adjustable pace, a focus mask, and full control over
typography and colour.

Mobile-first, and **installable as an app** on a phone, tablet or desktop.

Everything runs locally. The text you open never leaves your machine — the
container image doesn't even have network access enabled.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Option A — run on your host](#option-a--run-on-your-host)
- [Option B — run as a Docker container](#option-b--run-as-a-docker-container)
- [Option C — deploy on a server](#option-c--deploy-on-a-server)
- [Using it on a phone](#using-it-on-a-phone)
- [Using it](#using-it)
- [Configuration](#configuration)
- [The voice model](#the-voice-model)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Licence](#licence)

---

## What it does

- **Reads any Markdown file** — drag and drop, file picker, or paste.
- **Highlights the word being spoken, in real time**, plus a soft band on the
  sentence around it. The timings come from the model itself, not a guess.
- **Speed 0.5× – 3×**, adjustable while it is speaking, pitch preserved.
- **Click any word to start reading from there.**
- **Focus mask** dims everything except the current sentence or paragraph.
- **Reading ruler** tracks the line being read.
- **Typography controls** — OpenDyslexic and Atkinson Hyperlegible, text size,
  line spacing, letter spacing, word spacing, line width, bionic bolding.
- **Seven tinted colour themes**, including a night mode.
- **Code blocks are skipped by default** — hearing punctuation read aloud is
  rarely useful — but they are still displayed.
- Every setting persists between sessions.

On a phone it additionally:

- **Installs to the home screen** as a standalone app (PWA).
- Puts **play / pause / next sentence on the lock screen** and on headset
  buttons.
- **Keeps the screen awake** while reading, so the highlight stays visible.
- Accepts **text shared from other apps**.
- Uses a thumb-reachable bottom sheet for settings and 44 px touch targets
  throughout.

Runs in **Firefox, Chrome, Safari 16.4+, Opera and Edge**, on desktop and
mobile.

---

## Quick start

Docker, nothing else installed:

```bash
git clone git@github.com:n2048-creative-technology/reader-for-neurodivergents.git
cd reader-for-neurodivergents
./scripts-tools/check-docker.sh    # confirms you have Compose v2
docker compose up -d --build       # first build takes ~5 min
```

> **`docker compose`, with a space.** The standalone `docker-compose` (v1) is
> end-of-life and fails against Docker Engine 26+ with
> `KeyError: 'ContainerConfig'`, whatever the compose file says. Ubuntu's
> `docker-compose` package still installs v1.
> `./scripts-tools/check-docker.sh` detects this and prints the one-line,
> no-sudo fix.

Then open **<http://127.0.0.1:8765>** and press *Try the sample document*.

---

## Option A — run on your host

Best if you have an NVIDIA GPU, or you want to edit the code.

### Requirements

| | |
|---|---|
| Python | **3.10 – 3.12** (Kokoro does not support 3.13+) |
| Disk | ~5.5 GB with CUDA, or ~1 GB with the CPU-only build |
| GPU | Optional. NVIDIA + CUDA used automatically if present; needs <1 GB VRAM |
| CPU fallback | Perfectly usable — Kokoro is only 82M parameters |

### Install

```bash
./scripts-tools/setup.sh
```

This creates `.venv`, installs the dependencies, downloads Kokoro-82M (~330 MB)
and the spaCy model its text front-end needs, then **verifies that word timings
come back correctly on your hardware** before finishing.

PyTorch's CUDA wheels are ~5 GB. Kokoro is small enough that CPU is a
reasonable choice, and the CPU build is ~500 MB:

```bash
T2S_CPU_ONLY=1 ./scripts-tools/setup.sh
```

If your default `python3` is 3.13 or newer, point the script at an older one:

```bash
PYTHON=python3.12 ./scripts-tools/setup.sh
```

### Run

```bash
./scripts-tools/run.sh
```

It starts the server and opens <http://127.0.0.1:8765> in your browser.
The first request after startup takes a few seconds while the model loads;
after that a sentence is ready in about 150 ms on a GPU.

---

## Option B — run as a Docker container

The image is **fully self-contained**: model weights, all 54 voice packs, the
spaCy model and the espeak-ng library are baked in, and `HF_HUB_OFFLINE=1` is
set, so the container never reaches the network. It runs as an unprivileged
user on a read-only filesystem.

**Requires Docker Compose v2** (`docker compose`, with a space). See the note
in [Quick start](#quick-start); `./scripts-tools/check-docker.sh` verifies it.

### With Compose (recommended)

```bash
docker compose up -d --build    # first build takes ~5 min
docker compose logs -f          # watch startup
docker compose down             # stop
```

Published on `127.0.0.1:8765` only. To reach it from other machines on your
network, change the port mapping in `compose.yaml` to `"8765:8765"`.

### With plain Docker

```bash
docker build -t read-aloud .
docker run -d --name read-aloud -p 127.0.0.1:8765:8765 read-aloud
```

### GPU build

The default image is CPU-only (~1.9 GB) and portable. For an NVIDIA host with
the [container toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/)
installed:

```bash
docker build --build-arg TORCH_VARIANT=cu128 -t read-aloud:gpu .
docker run -d --gpus all -p 127.0.0.1:8765:8765 read-aloud:gpu
```

The GPU image is ~8 GB and contains NVIDIA's proprietary CUDA wheels — see
[Licence](#licence). For most reading, the CPU image is fast enough: measured
at **7× real time** on this machine, against **25–35×** on an RTX 3050.

### Verifying it is really offline

```bash
docker run --rm --network none --name t read-aloud &
sleep 60 && docker exec t curl -fsS http://127.0.0.1:8765/api/health
```

---

## Option C — deploy on a server

To reach the reader from anywhere — and to install it on a phone without
fiddling with certificates — put it behind a real domain.
[`docs/deploy-droplet.md`](docs/deploy-droplet.md) is a full walkthrough for
Ubuntu + nginx + Let's Encrypt, with ready-made configs in `deploy/`.

Two findings from measuring it on a 2 vCPU / 2 GB droplet are worth knowing
before you pick a size:

- **Pin the CPU count.** PyTorch sizes its thread pools from the *host's* core
  count, not the container's share. On a 2-vCPU cgroup of a 32-core host that
  measured **0.35× real time**; with the pools pinned to the cgroup quota,
  **3.22×**. The server now detects the quota itself, which is why
  `deploy/compose.prod.yaml` sets `cpus: 2.0` — do not remove it. Check
  `"threads"` in `/api/health`: it should match your vCPU count.
- **Memory is the binding constraint**, not CPU. Peak RSS is ~1.5 GB, so a
  2 GB droplet needs a swap file and a container memory cap.

Throughput on 2 vCPU is about **3.2× real time**, which stays ahead of
playback at normal speed and at 2×.

---

## Using it on a phone

The phone is a client; speech is generated on your computer. So the phone has
to reach your machine — and to *install* the app, it has to reach it over
**https**, because browsers only allow service workers and "Add to Home
Screen" in a secure context.

Quickest path on a home network:

```bash
./scripts-tools/make-cert.sh          # detects your LAN addresses
HOST=0.0.0.0 ./scripts-tools/run.sh   # picks up certs/ automatically
```

Then trust the generated CA on the phone once, and open the `https://` address
that `run.sh` prints. An **Install** button appears on Android; on iOS use
Share → *Add to Home Screen*.

Plain `http://` on a LAN address still **reads** perfectly well — it just
cannot be installed and has no offline shell. The app says so on screen rather
than failing silently.

Prefer not to install a certificate? Tailscale and cloudflared both give you a
real https URL with no certificate work.

**Full details, the iOS trust steps, and the platform limits (including the
iOS ringer switch muting web audio) are in
[`docs/mobile.md`](docs/mobile.md).**

---

## Using it

Open a `.md` file by dropping it anywhere on the page, via **Open Markdown…**,
or paste text with **Paste text**.

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next sentence |
| <kbd>↑</kbd> <kbd>↓</kbd> | Faster / slower |
| <kbd>R</kbd> | Repeat this sentence |
| <kbd>F</kbd> | Cycle the focus mask |
| <kbd>Esc</kbd> | Stop, or close the settings panel |

Click any word to start reading from that sentence. Everything else lives in
**Reading settings** (⚙, top right).

---

## Configuration

Both run paths take the same environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8765` | Port to listen on |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes it to your LAN |
| `T2S_DEVICE` | `auto` | `auto`, `cuda` or `cpu` |
| `OPEN` | `1` | `0` stops `run.sh` from launching a browser |
| `T2S_SSL_CERT` | — | TLS certificate. `run.sh` uses `certs/server.crt` automatically if present |
| `T2S_SSL_KEY` | — | TLS private key |
| `T2S_CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the API. Restrict this on a public deployment |

```bash
PORT=9000 T2S_DEVICE=cpu ./scripts-tools/run.sh
docker run -e T2S_DEVICE=cpu -p 9000:8765 read-aloud
```

### HTTP API

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ok, model, device, sample_rate, loaded}` |
| `GET /api/voices` | Languages and the voices available in each |
| `POST /api/speak` | `{text, voice, lang, speed}` → `{audio (base64 WAV), duration, words:[{cs, ce, s, e}]}` |
| `GET /api/docs` | Interactive OpenAPI docs |

`words` gives each word's character range in the submitted text plus its start
and end time in the returned audio. That is the whole synchronisation contract
— see [`docs/architecture.md`](docs/architecture.md).

---

## The voice model

**[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)** — Apache-2.0, 82M
parameters, 54 voices, 7 languages. Chosen over larger and newer models for one
architectural reason that matters here more than raw voice quality:

Kokoro is a StyleTTS2 derivative with an **explicit duration predictor**. It
decides, before generating audio, how many frames each phoneme occupies, so it
can hand back the exact start and end time of every word — no forced aligner,
no second model, no guessing. Autoregressive models (Qwen3-TTS, Higgs,
Chatterbox, F5-TTS) sound better on some material but emit audio tokens with no
text alignment, so word-accurate highlighting would need Whisper or a forced
aligner in the loop, adding latency and a second failure mode.

It is also small enough to be effectively instant — a sentence is ready in
~150 ms on an RTX 3050, so the next one is always buffered before the current
one ends.

Full comparison and the alternatives considered:
[`docs/model-research.md`](docs/model-research.md).

### Timing accuracy by language

| Language | Word highlight |
|---|---|
| English (US) `a`, English (UK) `b` | **Measured** — exact per-word timings from the model |
| Spanish, French, Italian, Portuguese, Hindi | Estimated — spread across the sentence in proportion to word length |

Kokoro only exposes per-token timings through its English front-end. The other
languages still read and highlight; the highlight can drift slightly inside a
long sentence. The settings panel says so when you pick one.

---

## Project layout

```
├── Dockerfile / compose.yaml     self-contained image
├── deploy/                       production compose + nginx site configs
├── server/
│   ├── app.py                    FastAPI: static files + /api/speak
│   ├── tts.py                    Kokoro wrapper, word alignment, LRU cache
│   └── requirements.txt
├── web/
│   ├── index.html
│   ├── css/app.css               themes, typography, highlighting, focus mask
│   ├── js/
│   │   ├── app.js                wiring
│   │   ├── document.js           Markdown → blocks → word spans
│   │   ├── player.js             fetch, prefetch, playback, highlight loop
│   │   ├── ui.js                 settings panel, keyboard, ruler
│   │   ├── settings.js           preferences + persistence
│   │   ├── platform.js           PWA: install, lock screen, wake lock, share
│   │   └── api.js                server client
│   ├── sw.js                     service worker (offline shell)
│   ├── manifest.webmanifest      PWA manifest
│   ├── icons/                    app icons
│   ├── fonts/                    OpenDyslexic, Atkinson Hyperlegible (OFL)
│   └── vendor/                   marked, DOMPurify (MIT / Apache-2.0)
├── scripts-tools/
│   ├── setup.sh, run.sh, make-cert.sh, check-docker.sh
│   ├── check_timestamps.py       verifies alignment on your hardware
│   └── test_frontend.mjs         headless end-to-end test
├── samples/welcome.md
└── docs/
    ├── model-research.md
    ├── architecture.md
    ├── mobile.md
    └── deploy-droplet.md
```

No build step. The front-end is plain ES modules; edit and reload.

---

## Tests

```bash
# 1. Model + alignment on your hardware
.venv/bin/python scripts-tools/check_timestamps.py

# 2. End-to-end: document pipeline + live server
npm i jsdom@24                                    # once, in the repo root
node scripts-tools/test_frontend.mjs              # against ./scripts-tools/run.sh
node scripts-tools/test_frontend.mjs http://127.0.0.1:8765   # or a container
```

The second suite renders the sample document through the real front-end code,
synthesises a spread of blocks against a running server, and asserts that every
word span receives a monotonic, in-range timing. It is the test that catches
sync drift, and it covers sentence splitting, accented Latin, Devanagari, and
over-long paragraphs.

---

## Troubleshooting

**"Server not reachable — is it running?"**
The front-end is served by the same process as the API. If the page loads but
shows this, the model is still loading; wait a few seconds. Check
`curl localhost:8765/api/health`.

**First play does nothing / "your browser blocked autoplay"**
Press play once more. Browsers require a user gesture before audio can start.

**`setup.sh` fails on Python 3.13+**
Kokoro 0.9.4 supports 3.10–3.12. Use `PYTHON=python3.12 ./scripts-tools/setup.sh`.

**Highlight drifts in a non-English language**
Expected — see [timing accuracy](#timing-accuracy-by-language). English is exact.

**`docker-compose up` fails with `KeyError: 'ContainerConfig'`**
You are running the standalone `docker-compose` v1, which is end-of-life and
cannot talk to Docker Engine 26+. Nothing in the compose file can work around
it. Run `./scripts-tools/check-docker.sh` for the fix, then use
`docker compose` with a space.

**`failed to bind host port 127.0.0.1:8765: address already in use`**
Something else already holds the port — often `./scripts-tools/run.sh` from a
host install. Stop it, then `docker compose down && docker compose up -d`.
The `down` matters: a container whose port binding failed can be restarted by
its restart policy and end up running *without* published ports, so it looks
healthy while being unreachable.

**Docker build is slow**
Most of it is the PyTorch download. It is cached after the first build; only
`COPY` layers rebuild when you edit code.

**GPU not used**
`curl localhost:8765/api/health` reports the device. In Docker you need
`--gpus all` *and* an image built with `TORCH_VARIANT=cu128`.

**No Install button on the phone**
You are on `http://`. Installing needs https — see
[Using it on a phone](#using-it-on-a-phone). On iOS there is never a button:
use Share → *Add to Home Screen*.

**The phone plays nothing, but the highlight moves**
iOS mutes web audio when the ringer switch is off. Check the side switch.

---

## Licence

Application code: **MIT** — see [`LICENSE`](LICENSE).

The full dependency audit is in
[`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md). Everything in this
project is OSI-approved or public-domain-equivalent; nothing is
non-commercial or source-available. Two points are worth knowing:

- **espeak-ng is GPL-3.0**, and it reaches this project through
  `kokoro → misaki[en] → phonemizer-fork`. It is only a fallback pronunciation
  engine (about 1.3 % of words on ordinary prose), but it is imported
  unconditionally. Distributing the **source** carries no obligation beyond
  attribution; distributing a **container image** means distributing a combined
  work that contains GPL-3.0 software, so GPL-3.0 terms apply to the image as a
  whole. This is routine — every Debian-based image already contains GPL
  software — and it is fully compatible with open-sourcing this project. It
  would only be a problem if you wanted to ship it closed-source.
- **The GPU image contains NVIDIA's proprietary CUDA wheels.** The default CPU
  image does not; use it if you want a fully OSI-licensed artefact.

`libsndfile` (LGPL-2.1) was deliberately removed — WAV encoding uses Python's
standard-library `wave` module instead.

Bundled dependencies keep their own licences: Kokoro-82M (Apache-2.0),
OpenDyslexic and Atkinson Hyperlegible (SIL OFL 1.1), marked (MIT), DOMPurify
(Apache-2.0 or MPL-2.0).

**Attribution required by the Kokoro model card:** Kokoro-82M was trained
exclusively on permissive/non-copyrighted audio, including
[Koniwa](https://github.com/koniwa/koniwa) (CC BY 3.0) and
[SIWIS](https://datashare.ed.ac.uk/handle/10283/2353) (CC BY 4.0).
Architecture: [StyleTTS 2](https://arxiv.org/abs/2306.07691) and
[ISTFTNet](https://arxiv.org/abs/2203.02395).

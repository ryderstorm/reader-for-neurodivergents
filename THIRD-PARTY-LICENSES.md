# Third-party licences

**Short version: this project is safe to open-source. Nothing in it is
proprietary, non-commercial, or "source-available". Everything is OSI-approved
or public-domain-equivalent.**

The code in this repository is MIT ([`LICENSE`](LICENSE)). What follows is
every third-party component it uses, and the one thing worth understanding
before you publish a **container image**.

---

## The one thing to know: espeak-ng is GPL-3.0

`kokoro` → `misaki[en]` → `phonemizer-fork` → **espeak-ng**.

- `phonemizer-fork` is **GPL-3.0-or-later**.
- `espeakng-loader` ships a prebuilt `libespeak-ng.so`; **espeak-ng is GPL-3.0**.

It is a *fallback* pronunciation engine: misaki uses its own dictionary first
and only calls espeak-ng for words it does not know. Measured on this
project's sample document, that is **1.3 % of words** — things like `Inline`,
`3×`, `Kokoro‑82M`. It is not optional though: `kokoro` imports it at module
load, unconditionally.

### What this means in practice

| You are… | Obligation |
|---|---|
| Publishing this **source repository** | **None beyond attribution.** Your code is MIT. A user running `pip install -r requirements.txt` assembles the GPL parts on their own machine — the standard situation for every Python project with a GPL dependency. |
| Publishing a **container image or bundled binary** | You are distributing a combined work that contains GPL-3.0 software, so **GPL-3.0 terms apply to the image as a whole**. In practice: keep the source available (this repo + the public upstream packages), ship the licence texts, and do not add usage restrictions. The `Dockerfile` in this repo is exactly that disclosure. |
| Wanting to make this **closed-source or proprietary** | Not possible while espeak-ng is in the tree. |

This is completely routine — every Debian- or Ubuntu-based container image
already contains GPL software (bash, coreutils) and is distributed the same
way. It is called out here only because it is the single constraint that a
reader of this repository could not discover at a glance.

Since you intend to open-source the project, **there is no conflict.**

### If you ever need a GPL-free build

Two knobs, both tested:

1. **libsndfile has already been removed.** WAV encoding uses Python's
   standard-library `wave` module instead of `soundfile`, so LGPL-2.1
   `libsndfile` is not in the tree at all.
2. **espeak-ng can be disabled.** If `misaki.espeak.EspeakFallback` fails to
   construct, `kokoro` logs a warning and continues with `fallback=None`.
   Word timings still work. The cost is that unknown words are silently
   skipped — about 1 word in 80 on ordinary prose. For a reading-accessibility
   tool that is a real quality loss, so it is not the default.

---

## Runtime — Python

| Component | Licence | Notes |
|---|---|---|
| **Kokoro-82M** (weights + 54 voices) | **Apache-2.0** | Trained exclusively on permissive / non-copyrighted audio. See attribution below. |
| `kokoro` | Apache-2.0 | |
| `misaki` | Apache-2.0 | |
| `phonemizer-fork` | **GPL-3.0-or-later** | see above |
| `espeakng-loader` (bundles espeak-ng) | **GPL-3.0** | see above |
| `num2words` | LGPL-2.1 | Used as a library, unmodified — no copyleft reach into your code |
| `torch` | BSD-3-Clause | |
| `transformers`, `huggingface_hub`, `tokenizers`, `safetensors`, `regex`, `requests` | Apache-2.0 | |
| `spacy`, `thinc`, `srsly`, `catalogue`, and the spaCy stack | MIT | |
| `en_core_web_sm` 3.8.0 | MIT | Model artefact; upstream sources include WordNet 3.0 (permissive) |
| `numpy` | BSD-3-Clause | |
| `fastapi`, `pydantic`, `python-multipart` | MIT / Apache-2.0 | |
| `uvicorn`, `starlette`, `h11`, `websockets` | BSD-3-Clause / MIT | |
| `certifi` | MPL-2.0 | File-level copyleft; unmodified use is unrestricted |
| NVIDIA CUDA runtime wheels | NVIDIA proprietary EULA | **Only in the GPU build.** Redistributable under NVIDIA's terms, but if you want a fully OSI-licensed artefact, ship the default CPU image. |

## Runtime — browser

| Component | Licence |
|---|---|
| `marked` 15.0.7 | MIT |
| `DOMPurify` 3.2.4 | Apache-2.0 **OR** MPL-2.0 |
| **OpenDyslexic** (`web/fonts/od-*.woff2`) | SIL OFL 1.1 |
| **Atkinson Hyperlegible** (`web/fonts/ah-*.woff2`) | SIL OFL 1.1 |

Both fonts are bundled, which the OFL explicitly permits. The OFL's only real
conditions are that the fonts are not sold on their own and that the licence
travels with them — see [`web/fonts/LICENSES.md`](web/fonts/LICENSES.md).

## Development only — not distributed

| Component | Licence |
|---|---|
| `jsdom` (headless test) | MIT |

---

## Required attribution

**Kokoro-82M** is Apache-2.0. Its model card records that two CC BY datasets
were part of the v1.0 training data, and asks that they be credited:

- [Koniwa](https://github.com/koniwa/koniwa) (`tnc`) — CC BY 3.0
- [SIWIS](https://datashare.ed.ac.uk/handle/10283/2353) — CC BY 4.0

Model architecture: [StyleTTS 2](https://arxiv.org/abs/2306.07691) (Li et al.)
and [ISTFTNet](https://arxiv.org/abs/2203.02395). Kokoro was trained by
`@rzvzn`; the model is published at
[hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

---

## Reproducing this audit

```bash
.venv/bin/python - <<'PY'
import importlib.metadata as md
for d in sorted(md.distributions(), key=lambda d: (d.metadata["Name"] or "").lower()):
    m = d.metadata
    lic = (m["License-Expression"] or m["License"] or "").splitlines()[:1]
    cls = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or [])
           if c.startswith("License ::")]
    print(f"{m['Name']:30} {m['Version']:12} {(lic or ['-'])[0][:40]:42} {'; '.join(cls)}")
PY
```

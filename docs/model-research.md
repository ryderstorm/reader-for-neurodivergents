# Choosing the text-to-speech model

Research done August 2026, against the Hugging Face Hub and current community
reporting. Target hardware: Intel i9‑14900 (32 threads), 62 GB RAM,
NVIDIA RTX 3050 with 6 GB VRAM, Linux.

## The requirement that decided it

The application highlights **the word currently being spoken**. That makes
text-to-audio alignment the primary requirement, ahead of voice quality:

- A model that returns audio and nothing else needs a **forced aligner** or a
  Whisper pass to recover word times. That is a second model, a second
  download, more latency per sentence, and a second thing that can silently
  desync.
- A model with an **explicit duration predictor** already knows how long each
  phoneme lasts, because it decided. Word timings fall out for free.

Secondary requirements: permissive licence, fits in 6 GB VRAM, fast enough
that the next sentence is always buffered, and usable offline.

## Candidates

| Model | Params | Licence | Alignment | Notes |
|---|---|---|---|---|
| **Kokoro‑82M** | 82 M | Apache‑2.0 | **Native, per token** | StyleTTS2 derivative with a duration predictor. 54 voices, 7 languages. 110 M+ downloads. |
| Qwen3‑TTS 0.6B / 1.7B | 0.9 B / 1.7 B | Apache‑2.0 | None | The 2026 quality leader for open weights, 10 languages, voice design. Autoregressive over audio tokens — no text alignment. |
| Higgs TTS 2 / 3 | 3 B / 4 B | Apache‑2.0 | None | Excellent expressive quality. Too large to keep resident alongside a browser on 6 GB. |
| Chatterbox | 0.5 B | MIT | None | Best-in-class zero-shot cloning. Cloning is not needed here. |
| F5‑TTS / E2‑TTS | 0.3 B | CC‑BY‑NC / MIT | None | Flow-matching; needs a reference clip per voice. |
| MOSS‑TTS v1.5 | ~1 B | Apache‑2.0 | None | Strong 2026 entrant, real-time variant exists. |
| Supertonic 3 | small | permissive | None | Reported 2–3× faster than Kokoro, 31 languages. No timing output. |
| Piper | ~20 M | MIT | Partial | Very fast VITS. Voices are noticeably more synthetic than Kokoro's. |
| XTTS‑v2 | 0.5 B | CPML (non‑commercial) | None | Licence rules it out. |

## Decision: Kokoro‑82M

**Why it wins for this application, in order:**

1. **It reports word timings.** Through the `misaki` English front-end, each
   token comes back with `start_ts` and `end_ts` derived from the duration
   predictor. Verified on this machine — see
   `scripts-tools/check_timestamps.py`. This is the entire feature.
2. **Latency.** 25–35× real time on the RTX 3050; a typical sentence is ready
   in ~150 ms. Prefetching three sentences ahead is trivially achievable, so
   playback never stalls between sentences. On CPU alone it still runs several
   times faster than real time on this i9.
3. **Footprint.** 82 M parameters, ~330 MB of weights, well under 1 GB of
   VRAM. The GPU stays free for everything else.
4. **Licence.** Apache‑2.0, weights and code, no usage restriction.
5. **Voice quality is genuinely good** for the size — it holds its own on
   TTS Arena against models 10–40× larger, which is why it accumulated
   110 M+ downloads.

**What was traded away:** Qwen3‑TTS and Higgs sound better on expressive
material, and Chatterbox clones voices. None of that is worth losing exact
highlighting for a reading-assistance tool, where knowing *where you are* is
the point.

### The alignment caveat

Timings are only exposed through Kokoro's **English** G2P front-end. Spanish,
French, Italian, Portuguese and Hindi return audio with no token timings; the
application falls back to distributing the sentence duration across its words
in proportion to word length. Since synthesis is per sentence, the drift stays
small, and the UI states which mode is active.

If exact non-English timing is ever needed, the fix is a forced aligner
(`ctc-forced-aligner`, or MFA) run over the generated audio, at the cost of a
second model and roughly 100–200 ms per sentence.

## If you want to swap the model later

`server/tts.py` is the only file that knows about Kokoro. A replacement needs
to provide `synth(text, voice, lang, speed) -> Segment`, where `Segment.words`
is a list of `{cs, ce, s, e}` — character range in the submitted text, and
start/end seconds in the returned audio. Everything upstream is generic.

## Sources

- [hexgrad/Kokoro‑82M](https://huggingface.co/hexgrad/Kokoro-82M) — model card, Apache‑2.0
- [onnx-community/Kokoro‑82M‑v1.0‑ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) — browser/ONNX build
- [Qwen3‑TTS‑12Hz‑0.6B‑CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)
- [bosonai/higgs‑tts‑3‑4b](https://huggingface.co/bosonai/higgs-tts-3-4b)
- [SWivid/F5‑TTS](https://huggingface.co/SWivid/F5-TTS)
- [Ryan Welch — Kokoro for TTS and word timestamps](https://ryanwelch.co.uk/blog/kokoro-word-timestamps/)
- [Best Local TTS Models 2026](https://localaimaster.com/blog/best-local-tts-models)
- [Best Open Source Self-Hosted Text-to-Speech Models in 2026](https://pinggy.io/blog/best_open_source_self_hosted_text_to_speech_models/)

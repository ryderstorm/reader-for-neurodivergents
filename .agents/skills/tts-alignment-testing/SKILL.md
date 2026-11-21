---
name: tts-alignment-testing
description: Verify word-splitter parity, Kokoro timestamp alignment, and playback highlighting when changing server/tts.py, server/app.py, web/js/document.js, or web/js/player.js.
---

# TTS Alignment Testing

Use this workflow whenever modifying word tokenization, sentence splitting, Kokoro timestamp alignment, or client word highlighting.

## Contract to Preserve

1. `server/tts.py:split_words` and `web/js/document.js:WORD_RE` must agree on word boundaries across ASCII, contractions (`don't`), hyphenated words (`well-known`), decimals (`3.50`), accented Latin (`niño`, `leyó`), and Devanagari combining marks (`मुझे`).
2. `POST /api/speak` returns `{sample_rate, duration, words: [{cs, ce, s, e}], audio}` where `words` are monotonic, inside `[0, duration]`, and `cs..ce` slice the exact submitted text.
3. `web/js/player.js:mapTimings` maps overlapping character ranges onto `.w` spans and falls back to positional zipping only if no character ranges overlap.

## Verification Steps

1. Run fast offline unit tests with coverage for both sides:

```bash
make test
```

2. Run strict typing and linting:

```bash
make lint
make typecheck
```

3. Boot the server and verify live HTTP + DOM pipeline:

```bash
make smoke
make test-e2e
```

4. When Kokoro-82M weights are installed locally, verify real model alignment and live synthesis round-trip:

```bash
.venv/bin/python scripts-tools/check_timestamps.py
node scripts-tools/test_frontend.mjs http://127.0.0.1:8765
```

# How it works

## The sync problem

Highlighting a word as it is spoken requires knowing, to within about 50 ms,
when the audio for that word starts. Three ways to get that:

1. **Guess from character counts.** Cheap, always wrong on pauses, numbers and
   long words. Drifts visibly within a paragraph.
2. **Force-align afterwards.** Run the generated audio and its text through an
   aligner. Accurate, but adds a model and 100–200 ms per sentence.
3. **Ask the model.** Kokoro predicts phoneme durations *before* it generates
   audio, so it can simply tell you. Free, exact.

This application uses (3), with (1) as a fallback where the model does not
report timings. See [`model-research.md`](model-research.md).

## The pipeline

```
Markdown file
     │
     │  marked → HTML, DOMPurify → sanitised
     ▼
web/js/document.js
     │  • walk block elements (p, li, h1-h6, blockquote, td, …)
     │  • flatten each block's text nodes into one string
     │  • split that string into sentences
     │  • rebuild every text node out of <span class="w"> per word
     │  • record each word's character offset within its sentence
     ▼
blocks = [{ el, text, words:[{el, cs, ce}], pauseAfter }]
     │
     │  POST /api/speak { text, voice, lang }
     ▼
server/tts.py
     │  • misaki G2P → phonemes + tokens
     │  • Kokoro duration predictor → frames per phoneme
     │  • align tokens back onto the source words by alphanumeric key
     │  • interpolate any word the aligner could not match
     ▼
{ audio: wav, words: [{ cs, ce, s, e }] }
     │
     ▼
web/js/player.js
     │  • blob URL → <audio>, prefetch the next 3 blocks
     │  • requestAnimationFrame reads audio.currentTime
     │  • the word whose [s,e) contains it gets .is-speaking
     ▼
highlighted text
```

## Why character ranges

The server could return "word 4 started at 1.2 s" and the client could count
to four. It does not, because the text-to-phoneme front-end normalises text
before speaking it: `2024` becomes three spoken words, `$3.50` becomes four,
`Dr.` becomes one. Index-based mapping breaks the moment that happens.

Instead both sides split the *same submitted string* with the *same* rule, and
the server reports **character ranges into that string**. The client matches a
timing to a span by range overlap. If the two splitters ever disagree — a
script one of them handles differently, say — the overlap still finds a
sensible answer instead of silently shifting every subsequent word.

Keeping the two splitters equivalent matters, so it is tested:
`scripts-tools/test_frontend.mjs` asserts `block.text.slice(cs, ce)` equals the
span's own text for every word in the sample document, and checks accented
Latin and Devanagari separately.

## Alignment details (`tts.py::_align`)

Kokoro returns misaki tokens carrying `.text`, `.start_ts`, `.end_ts`. Tokens
are in source order but not 1:1 with source words. The aligner:

1. Drops tokens with no timing (punctuation, silence).
2. Walks source words and tokens together, matching on an
   alphanumeric-only, lowercased key, looking ahead up to six tokens so one
   skipped token does not derail the rest of the sentence.
3. Consumes extra tokens while a source word is not yet covered — this is what
   handles `2024 → twenty twenty four`.
4. Interpolates any unmatched run between its known neighbours, weighted by
   word length, so the highlight keeps moving instead of freezing.
5. Forces the result monotonic and inside the clip.

## Playback

- One sentence per audio clip. Short clips mean seeking is instant, a failed
  synthesis costs one sentence, and the cache is fine-grained.
- Three sentences are prefetched ahead. At 25–35× real time the queue is
  always full, so there is no gap between sentences.
- Speed uses `HTMLAudioElement.playbackRate` with `preservesPitch`, not
  re-synthesis: it applies instantly, mid-sentence, and needs no cache
  invalidation. Timings are in media time, so they stay correct at every rate
  with no rescaling.
- The first `play()` is preceded by 50 ms of silence played synchronously
  inside the click handler. Safari requires a user-gesture-initiated play
  before it will honour a later programmatic one, and ours happens after an
  `await`.

## Caching

`tts.py` keeps an LRU of 256 synthesised segments keyed by
`(text, voice, lang, speed)`. Re-reading a sentence, or scrubbing backwards,
is instant. The client separately holds a window of ~24 blob URLs around the
playhead and revokes the rest.

## Accessibility decisions

Each of these is a documented accommodation, not decoration:

| Feature | Why |
|---|---|
| No pure black on white | High contrast raises visual stress; every theme is tinted |
| Tinted background choices | Colour preference for reduced visual stress is highly individual |
| Left-aligned, no hyphenation | Justified text creates rivers; hyphens split words mid-read |
| Adjustable letter / word spacing | Increased spacing measurably improves dyslexic reading speed |
| Narrow measure (default 62 ch) | Long lines make return sweeps error-prone |
| OpenDyslexic + Atkinson Hyperlegible | The two most commonly requested accessible faces |
| Two-level highlight | The word for precision, the sentence band for context |
| Focus mask | Reduces competing visual input — the main ADHD complaint about pages |
| Reading ruler | Line-tracking aid, the digital form of a physical ruler |
| Bionic bolding | Anchors the eye at the fixation point; helps some readers |
| Voice sets the pace | The reason audio helps ADHD readers at all |
| `prefers-reduced-motion` respected | Smooth scroll and transitions turn off |

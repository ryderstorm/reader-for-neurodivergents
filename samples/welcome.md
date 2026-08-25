# Reading, out loud

This document is here so you can hear what the reader sounds like and see how
the highlighting behaves. Every word you hear is generated on this machine, by
a model called Kokoro‑82M. Nothing is uploaded anywhere.

## Why read along with audio

Reading with your eyes *and* your ears at the same time is called bimodal
reading. For a lot of people — particularly people with dyslexia — it lifts
comprehension noticeably, because the decoding work and the understanding work
stop competing for the same attention.

For ADHD readers the useful part is usually different: the voice sets a pace.
A page of static text has no momentum, so attention wanders off it. A voice
that keeps moving gives the page a pulse to follow, and the highlight tells you
exactly where that pulse currently is.

### Things worth trying

1. Push the speed up. Most people settle somewhere between 1.3× and 1.8× after
   a few minutes; the slider goes to 3×.
2. Turn on the focus mask with the **F** key. Everything except the sentence
   being read fades back.
3. Click on any word in this paragraph. Reading restarts from that sentence.
4. Open the settings panel and try OpenDyslexic, then widen the word spacing.

> Nothing in the settings panel is cosmetic. Tinted backgrounds, wider letter
> spacing and a narrower line all have evidence behind them for reducing
> visual stress. What works varies a lot between readers, which is exactly
> why they are all adjustable.

## A note on numbers and code

The model normalises text before speaking it, so a date like 2024 is read as
"twenty twenty four", and $3.50 becomes "three dollars fifty". The highlight
still lands on the right word, because the timings come back tied to character
positions in the original text.

Code blocks are skipped by default — hearing punctuation read aloud is rarely
useful — but you can turn that off in the settings panel.

```python
def unread_by_default(text: str) -> None:
    print(text)
```

Inline `code` is still read, since it is usually a word.

## Keyboard

| Key | Action |
|---|---|
| Space | Play or pause |
| ← → | Previous or next sentence |
| ↑ ↓ | Faster or slower |
| R | Repeat this sentence |
| F | Cycle the focus mask |
| Esc | Stop, or close the settings panel |

That is the whole thing. Open your own Markdown file whenever you are ready.

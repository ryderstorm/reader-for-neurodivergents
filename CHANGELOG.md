# Changelog

All notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [v1.1.0] — 2026-08-25

Mobile-first, and installable as an app.

### Installable (PWA)
- Web app manifest, icon set (192/512/maskable/apple-touch) and a service
  worker that precaches the interface, so the app opens instantly and works
  with no network. Speech still needs the server; the app says so rather than
  failing silently.
- **Install** button on Android and desktop Chromium; iOS gets the
  Add-to-Home-Screen instruction, since it has no install prompt API.
- Share text from another app straight into the reader (Android share target),
  open `.md` files with the installed app (desktop File Handling API), and a
  "Paste text" launcher shortcut.
- Update flow: a new build offers a **Reload** toast instead of silently
  serving stale assets.

### Phone behaviour
- **Lock-screen and headset controls** via the Media Session API — play,
  pause, next and previous sentence, with the current sentence as the title.
- **Screen wake lock** while reading, so the phone does not dim and hide the
  highlight. Re-acquired when returning to the tab. Hidden where unsupported.
- Audio continues in the background; highlighting resumes on return.

### Mobile-first interface
- Stylesheet rewritten mobile-first; desktop is now the `min-width: 760px`
  layer.
- Settings are a thumb-reachable **bottom sheet** on phones, a side drawer on
  desktop.
- Transport gained a dedicated speed row with − / + buttons, and the progress
  bar is now scrubbable and 14 px tall on touch.
- 44 px minimum touch targets; hover styles confined to `@media (hover: hover)`
  so a tap cannot leave a stuck highlight.
- Safe-area insets for notch and home indicator; `100dvh` so mobile browser
  chrome does not break the layout; 16 px form fields so iOS does not zoom;
  wide tables scroll in their own box; a compact landscape layout.

### Serving over https
- `--ssl-certfile` / `--ssl-keyfile` (or `T2S_SSL_CERT` / `T2S_SSL_KEY`), and
  `run.sh` picks up `certs/` automatically.
- New `scripts-tools/make-cert.sh` creates a local CA and a certificate
  covering your LAN addresses, with the iOS and Android trust steps printed.
- Installing a PWA requires a secure context, so plain http on a LAN address
  can read but cannot install — the app now explains this on screen.
- A TLS key that the container cannot read now produces an actionable error
  naming `--user "$(id -u):$(id -g)"` instead of a bare `PermissionError`.

### Other
- `/api/health` reports the app version.
- `sw.js` and `manifest.webmanifest` are served from dedicated routes with
  correct content types and cache headers, and accept HEAD.
- Test suite grew to **52 checks**, adding manifest validity, precache
  integrity, icon existence, and a DOM-contract check that every element id
  the JavaScript reaches for exists in the HTML.
- New `docs/mobile.md`.

[v1.1.0]: https://github.com/n2048-creative-technology/reader-for-neurodivergents/releases/tag/v1.1.0

## [v1.0.0] — 2026-08-25

First release. A local browser application that reads Markdown out loud and
highlights each word as it is spoken, built for readers with dyslexia or ADHD.

### Reading
- Word-accurate highlighting driven by **Kokoro-82M's own duration
  predictor**, not by estimation — no forced aligner, no second model.
- Two-level highlight: a strong marker on the word, a soft band on the
  sentence.
- Speed 0.5×–3×, adjustable mid-sentence, pitch preserved.
- Click any word to start reading from there.
- Focus mask (sentence or paragraph), reading ruler, auto-scroll.

### Presentation
- OpenDyslexic and Atkinson Hyperlegible bundled (SIL OFL 1.1).
- Seven tinted themes including night mode; no pure black on white.
- Adjustable text size, line spacing, letter spacing, word spacing and line
  width. Bionic bolding. All settings persist.

### Engine
- Kokoro-82M (Apache-2.0), 54 voices, 7 languages, running locally.
- Sentence-level synthesis with three-block prefetch; ~150 ms per sentence.
- **25–35× real time** on an RTX 3050, **7×** on CPU in the container.
- LRU cache keyed by text + voice + speed.
- Native per-word timings for English; length-proportional interpolation for
  other languages, stated in the UI.

### Packaging
- Host install via `scripts-tools/setup.sh` (CUDA or CPU-only).
- Self-contained Docker image, 1.93 GB, with all 54 voice packs baked in and
  `HF_HUB_OFFLINE=1`. Verified working with `--network none`. Runs
  unprivileged on a read-only filesystem.

### Quality
- 29-check end-to-end suite covering sentence splitting, character-offset
  agreement between client and server, accented Latin, Devanagari, over-long
  paragraphs, and live synthesis round-trips.
- `scripts-tools/check_timestamps.py` verifies model alignment on your
  hardware during setup.

### Licensing
- MIT, with a full third-party audit in `THIRD-PARTY-LICENSES.md`.
- `libsndfile` (LGPL-2.1) removed in favour of the standard library's `wave`.
- espeak-ng (GPL-3.0) documented: no obligation for source distribution;
  GPL-3.0 applies to container images as combined works.

[v1.0.0]: https://github.com/n2048-creative-technology/reader-for-neurodivergents/releases/tag/v1.0.0

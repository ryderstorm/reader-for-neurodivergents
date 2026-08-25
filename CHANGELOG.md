# Changelog

All notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[SemVer](https://semver.org/).

## [v1.1.3] — 2026-08-25

### Fixed
- **`nginx: [emerg] zero size shared memory zone "reader"`.** The nginx site
  config referenced a `limit_req` zone defined in a second file that had to be
  copied separately into `conf.d/`. Miss that step and nginx fails with an
  error that names neither the file nor the directive. `limit_req_zone` now
  lives at the top of the site config itself: a file included from
  `sites-enabled` is already in nginx's `http` context, so this is valid, and
  it removes both the extra step and the failure mode.
  `deploy/nginx/reader-ratelimit.conf` is gone.

  Reproduced against a replica of Ubuntu's nginx layout, and the fix verified
  in both layouts — included from `sites-enabled`, and dropped straight into
  `conf.d/`.

### Notes
- Confirmed that a missing htpasswd file fails **closed** (401), not open, and
  that `nginx -t` does not catch it — only requests do. Documented.

[v1.1.3]: https://github.com/n2048-creative-technology/reader-for-neurodivergents/releases/tag/v1.1.3

## [v1.1.2] — 2026-08-25

### Fixed
- **`docker-compose up --build` failed with `KeyError: 'ContainerConfig'`.**
  Not a compose-file problem: the standalone `docker-compose` v1 (EOL since
  July 2023, still what Ubuntu's `docker-compose` package installs) reads a
  `ContainerConfig` field that Docker Engine 26+ no longer returns from image
  inspect. It fails on both the create and the recreate path, so no compose
  file can work around it. Verified working under Compose v2.

### Added
- `scripts-tools/check-docker.sh` — preflight that reports the Docker version,
  daemon reachability and, critically, whether Compose v2 is present. When it
  is not, it names the v1 incompatibility and prints a no-sudo install line.
  Both the pass and fail paths are tested.
- Troubleshooting for a subtler failure seen while testing: when a port
  binding fails, the restart policy can bring the container back up *without*
  its published ports, so it reports healthy while being unreachable.
  `docker compose down` then `up -d` is the fix; a restart is not.

### Changed
- README and the deployment guide now state the Compose v2 requirement up
  front and use `docker compose up -d --build` consistently.

[v1.1.2]: https://github.com/n2048-creative-technology/reader-for-neurodivergents/releases/tag/v1.1.2

## [v1.1.1] — 2026-08-25

Server deployment, and a performance bug that only shows up in a container.

### Fixed
- **PyTorch was sizing its thread pools from the host's core count rather than
  the container's CPU share.** On a 2-vCPU cgroup of a 32-core host that meant
  dozens of threads fighting over two cores: **0.35× real time**, and a 19 s
  warm-up. The server now reads the cgroup v1/v2 quota (falling back to the
  affinity mask) and pins the pools accordingly — **3.22× real time**, 4 s
  warm-up. A 9× difference on the same hardware.
  `/api/health` now reports `threads` so this is verifiable.

### Added
- gzip on API responses: about **39 KB per second of speech** on the wire
  instead of 63. Level 5 rather than 9, because on a small CPU the compression
  competes with synthesis.
- `T2S_CORS_ORIGINS` to restrict which origins may call the API. Still `*` by
  default for local use; the production compose sets it to the real origin.
- `deploy/` with a production compose file and nginx site configs, and
  `docs/deploy-droplet.md` — a measured walkthrough for Ubuntu + nginx +
  Let's Encrypt including droplet sizing.

### Notes
- The nginx rate limit applies only to `/api/speak`. Applied site-wide it
  broke a cold page load, which fetches ~22 assets at once — caught by testing
  the real proxy topology rather than the config in isolation.

[v1.1.1]: https://github.com/n2048-creative-technology/reader-for-neurodivergents/releases/tag/v1.1.1

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

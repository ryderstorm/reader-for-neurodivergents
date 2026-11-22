# AGENTS.md

Operational guidance for agents working on **Reader for Neurodivergents**.

## Non-Discoverable Constraints

- **Python version**: Kokoro 0.9.4 supports Python 3.10–3.12 only; Python 3.13+ fails.
- **CPU thread pinning**: `limit_torch_threads()` in `server/app.py` must run before anything imports `torch`, or PyTorch spawns host-core threads inside cgroups (9× slowdown).
- **Offline & privacy guarantee**: The container sets `HF_HUB_OFFLINE=1` and never sends text or telemetry off-machine. Do not add outbound network calls or phone-home SDKs.
- **Word-splitter parity**: `server/tts.py:split_words` and `web/js/document.js:WORD_RE` must stay equivalent so character-range word highlighting never drifts.
- **Licence boundary**: WAV encoding uses Python's stdlib `wave` module; never reintroduce `libsndfile` (LGPL-2.1).

## Long-Form Documentation

- Architecture & sync contract: [`docs/architecture.md`](docs/architecture.md)
- Development commands & testing: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- Incident runbook & triage: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Production droplet deployment & rollback: [`docs/deploy-droplet.md`](docs/deploy-droplet.md)
- Mobile PWA & TLS setup: [`docs/mobile.md`](docs/mobile.md)
- Voice model trade-offs: [`docs/model-research.md`](docs/model-research.md)

## Skills to Use

- Use the `tts-alignment-testing` skill (`.agents/skills/tts-alignment-testing/SKILL.md`) when modifying word splitting, alignment, playback highlighting, or server synthesis routes.
- Use the `docker-offline-release` skill (`.agents/skills/docker-offline-release/SKILL.md`) when modifying `Dockerfile`, Compose files, nginx configs, or release/rollback procedures.

## Coding, Review, and Workflow Standards

- Follow TDD for behavior changes; run the full verification suite in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) before requesting review.
- Keep `mypy --strict` and `ruff` clean with zero lint or type-check suppressions. Pure formatting is enforced by `ruff format` and `prettier` in pre-commit.
- **Commits & branches**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`), enforced by `commitlint`. Name branches `feat/<slug>`, `fix/<slug>`, or `chore/<slug>`.
- **Planning**: Specs that define what to build live in GitHub issues. Never commit spec files to source control.
- **Human review**: Human approval is required for architecture, sync contracts, and security changes. Automated AI code review (e.g. CodeRabbit) augments human review and never replaces it.
- **PR & CodeRabbit workflow**:
  - Open WIP PRs as draft (`auto_review.drafts: false`) until local checks pass; batch fixes locally before pushing (Essentials plan allows 5 reviews/hour and pauses after 5 reviewed commits).
  - Read the actual scripts, code, or git tags (`scripts-tools/run.sh`, `scripts-tools/make-cert.sh`, `git tag`) before editing docs or runbooks so fixes do not introduce regressions.
  - Cap refinement on any single documentation hunk at 2 review rounds; after that, reply with rationale and resolve instead of chasing defensive shell edge cases.
  - Leave verified-fixed CodeRabbit threads open so CodeRabbit auto-verifies and resolves them on the next review; manually resolve only won't-fix threads with a 1-line rationale.
- **Keep docs current**: Update `README.md`, `docs/architecture.md`, and `docs/DEVELOPMENT.md` in the same PR whenever commands, API routes, environment variables, or behavior change.

## Guardrails & No-Go Zones

- **Destructive actions**: Never run `rm -rf`, `git push --force`, `git reset --hard`, or `git clean -fd` without explicit human confirmation.
- **Credentials**: Never read, print, or commit `.env`, `/certs/`, or `*.key` files; keep host credentials out of agent sandboxes.
- **No-go zones**: Do not hand-edit vendored bundles in `web/vendor/` (replace from upstream releases only) or binary assets in `web/fonts/` and `web/icons/`.

## Glossary

- **Kokoro-82M**: Local 82M-parameter StyleTTS2-derived TTS model with an explicit phoneme duration predictor.
- **misaki G2P**: Grapheme-to-phoneme front-end returning timed tokens that `tts.py::_align` maps to source words.
- **Character-range alignment**: Mapping audio timestamps to `{cs, ce}` offsets in submitted text instead of word indices.
- **Focus mask**: UI mode dimming text outside the active sentence or paragraph to reduce visual competition.
- **Reading ruler**: Horizontal line-tracking aid following the active spoken word.

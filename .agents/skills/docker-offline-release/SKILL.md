---
name: docker-offline-release
description: Build, verify offline isolation, validate cgroup CPU pinning, and roll back Docker/droplet deployments for Reader for Neurodivergents.
---

# Docker Offline Release

Use this workflow when changing `Dockerfile`, `compose.yaml`, `deploy/compose.prod.yaml`, `deploy/nginx/`, or `server/requirements.txt`.

## Invariants

1. **Offline runtime**: The image bakes Kokoro-82M weights, voice packs, spaCy model, and espeak-ng and sets `HF_HUB_OFFLINE=1`. Runtime containers must pass health checks under `--network none`.
2. **CPU vs CUDA separation**: Default builds use `TORCH_VARIANT=cpu` (~1.9 GB, fully OSI-licensed). GPU builds opt in with `--build-arg TORCH_VARIANT=cu128`. Install `torch` from its wheel index before `server/requirements.txt`.
3. **No TLS bypass**: `Dockerfile` `HEALTHCHECK` must never pass `curl -k` / `--insecure`; use `--cacert "$T2S_SSL_CERT"` when TLS is enabled.
4. **Cgroup CPU pinning**: Keep `cpus: 2.0` in `deploy/compose.prod.yaml` and confirm `"threads"` in `/api/health` matches the quota.

## Verification Steps

1. Validate shell scripts and app smoke tests:

```bash
shellcheck scripts-tools/*.sh
make smoke
```

2. Tag the prior image before replacing a deployed container (`docker tag read-aloud:latest read-aloud:previous`).
3. Verify offline container execution after building:

```bash
docker build -t read-aloud .
docker run --rm --network none --name read-aloud-offline-check -d read-aloud
# Wait for /api/health to report loaded: true, then stop:
docker exec read-aloud-offline-check curl -fsS http://127.0.0.1:8765/api/health
docker stop read-aloud-offline-check
```

4. On failure, follow `docs/deploy-droplet.md#rollback` and `docs/RUNBOOK.md`.

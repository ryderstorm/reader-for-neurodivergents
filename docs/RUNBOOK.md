# Incident Runbook

Operational procedures for diagnosing and recovering a running Reader for Neurodivergents instance (host or Docker/droplet).

## Quick Health Triage

1. Check service health and CPU thread pinning:

```bash
curl -fsS http://127.0.0.1:8765/api/health
```

Confirm `"ok": true`, `"loaded": true`, and `"threads"` equals the container's `cpus:` quota (for example `2` on a 2-vCPU droplet).

2. Inspect Prometheus metrics for synthesis errors or latency spikes:

```bash
curl -fsS http://127.0.0.1:8765/api/metrics | grep read_aloud_speak
```

3. Inspect structured JSON container logs:

```bash
docker compose -f deploy/compose.prod.yaml logs --tail=100
```

## Common Failure Modes

### Synthesis Slowdown (`0.35×` real time / 504 timeouts)

- **Symptom**: Long sentences time out with nginx `504 Gateway Time-out` or playback buffers constantly.
- **Check**: Inspect `"threads"` in `/api/health`. If higher than the droplet vCPU count, cgroup CPU pinning is missing.
- **Fix**: Verify `cpus: 2.0` is present in `deploy/compose.prod.yaml` and nginx `proxy_read_timeout 180s;` is loaded, then recreate with `docker compose -f deploy/compose.prod.yaml up -d`.

### Container OOM Kills During Startup or Synthesis

- **Symptom**: Container exits with code `137` (`OOMKilled: true` in `docker inspect read-aloud`).
- **Check**: Run `free -h` and `docker stats --no-stream read-aloud`. Peak RSS is ~1.5 GB.
- **Fix**: Confirm the 2 GB swap file is active (`swapon --show`) and `mem_limit: 1600m` is set in `deploy/compose.prod.yaml`.

### Container Healthy but Unreachable on Port 8765

- **Symptom**: `docker ps` shows `healthy`, but `curl 127.0.0.1:8765/api/health` fails with connection refused.
- **Check**: Run `docker port read-aloud`. A restart after a port-bind collision can leave the container without published ports.
- **Fix**: Stop the conflicting host process, then run `docker compose -f deploy/compose.prod.yaml down && docker compose -f deploy/compose.prod.yaml up -d`.

### HTTP 401 Across All Requests (nginx)

- **Symptom**: Every request returns `401 Unauthorized`.
- **Check**: Verify `/etc/nginx/.htpasswd-reader` exists and is readable by nginx; check `/var/log/nginx/reader.error.log`.
- **Fix**: Regenerate credentials with `htpasswd` and reload nginx (`sudo nginx -t && sudo systemctl reload nginx`).

### PWA Cannot Be Installed on Mobile

- **Symptom**: No Install button on Android, or service worker fails to register.
- **Check**: Verify the site is served over valid HTTPS (`curl -I https://reader.n2048.com/sw.js`) and `certbot renew --dry-run` succeeds.

## Recovery and Rollback

If a recent release introduces synthesis errors, alignment regressions, or startup failures, execute the rollback procedure in [`docs/deploy-droplet.md#rollback`](deploy-droplet.md#rollback) and verify `/api/health` and `/api/metrics` return healthy values.

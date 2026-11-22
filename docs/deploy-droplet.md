# Deploying to a DigitalOcean droplet

Written for the target this was measured on: **Ubuntu, 2 vCPU, 2 GB RAM,
50 GB disk, no GPU, nginx already serving other sites**, published at
`reader.n2048.com`.

---

## Will it actually run on 2 vCPU / 2 GB?

Yes — **~3.2× real time** — but only because of one setting, and memory is
tight. Measured in a CPU- and memory-limited container on a 32-core host:

| Configuration | Throughput | Warm-up |
|---|---|---|
| 2 vCPU, threads left to PyTorch's default | **0.35× real time** | 19 s |
| 2 vCPU, threads pinned to the cgroup's 2 | **3.22× real time** | 4 s |
| 1 vCPU, pinned | 1.66× real time | 4 s |

PyTorch sizes its thread pools from `os.cpu_count()`, which reports the
**host's** cores, not the container's share. On a 2-vCPU cgroup it starts
dozens of threads that fight over two cores, and the result is nine times
slower than doing it right. The server now reads the cgroup quota itself and
pins the pools accordingly, so this is handled — but it is why `cpus: 2.0` in
the compose file matters, and why you should not remove it.

**3.2× real time** means synthesis stays ahead of playback with room to spare
at normal speed, and still keeps up at 2×. Above about 2.5× reading speed a
single reader on this droplet may start to hear gaps.

### Memory is the binding constraint

Peak RSS is **~1.5 GB**. On a 2 GB droplet also running Ubuntu, nginx and
dockerd, that is close. Two things make it safe:

1. **Add swap.** DigitalOcean droplets ship with none.
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   sudo sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
   ```
2. **Cap the container** at `mem_limit: 1600m` (already set in
   `deploy/compose.prod.yaml`). A predictable container OOM beats the kernel
   choosing a victim and killing `nginx` or `sshd`.

If you would rather not run this close to the edge, the 2 vCPU / 4 GB droplet
removes the concern entirely and changes nothing else.

---

## Steps

### 1. Point DNS at the droplet

An `A` record for `reader.n2048.com` → your droplet's IPv4 (and `AAAA` if you
use IPv6). Confirm before running certbot, or issuance fails:

```bash
dig +short reader.n2048.com
```

### 2. Install Docker and Compose v2

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
```

`get.docker.com` includes the Compose **v2** plugin. If Docker was already on
the droplet — installed from Ubuntu's archive, say — you may instead have the
standalone `docker-compose` v1, which is end-of-life and **cannot work** with
Docker Engine 26+: every `docker-compose up` dies with
`KeyError: 'ContainerConfig'` before it reaches your compose file.

```bash
./scripts-tools/check-docker.sh    # after cloning, in step 4
sudo apt-get install -y docker-compose-plugin   # if it reports v2 missing
```

Throughout this guide, `docker compose` is two words. `docker-compose` with a
hyphen is the broken one.

### 3. Add swap

As above. Do this **before** the first build — the PyTorch install is the
most memory-hungry moment of the whole process.

### 4. Get the code and build

```bash
git clone https://github.com/n2048-creative-technology/reader-for-neurodivergents.git
cd reader-for-neurodivergents
./scripts-tools/check-docker.sh
docker compose -f deploy/compose.prod.yaml up -d --build
```

The build downloads PyTorch and the model: **10–20 minutes** on a 2 vCPU
droplet, and about 4 GB of transfer. It only happens once.

Watch it come up — the model loads on first start:

```bash
docker compose -f deploy/compose.prod.yaml logs -f
curl -s localhost:8765/api/health
# {"ok":true,"version":"1.1.1","device":"cpu","threads":2,"loaded":true}
```

`"threads":2` is the number to check. If it says anything larger, the CPU limit
is not being applied and you will get the 0.35× behaviour.

### 5. Protect it

The application has **no login**. On a public hostname, anyone who finds it can
use your droplet's CPU. Basic auth in nginx is the simplest fix that still
works with the installable app:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-reader mauricio
```

Comment the `auth_basic` lines out of the site config if you would rather it be
open — but keep the rate limit if you do.

### 6. Configure nginx

```bash
sudo cp deploy/nginx/reader.n2048.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/reader.n2048.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

One file, nothing else to copy. `limit_req_zone` has to be in nginx's `http`
context, and a file included from `sites-enabled` *is* in the http context, so
it lives at the top of the site config above the `server` block.

### 7. TLS

```bash
sudo certbot --nginx -d reader.n2048.com
```

Certbot edits the site file in place, adding the `listen 443` block, the
certificate paths and an http→https redirect. Renewal is automatic via its
systemd timer; check with `sudo certbot renew --dry-run`.

**This step is what makes the app installable.** Browsers only allow service
workers and Add-to-Home-Screen over https, so until the certificate is issued
the site reads but cannot be installed.

### 8. Check it

```bash
curl -s https://reader.n2048.com/api/health          # open, no credentials
curl -su mauricio https://reader.n2048.com/manifest.webmanifest
```

Then open `https://reader.n2048.com` on your phone and install it.

---

## Running costs

About **39 KB per second of speech** on the wire, gzipped — an hour of reading
is roughly 140 MB. Well inside the 2 TB that DigitalOcean includes, but worth
knowing if you read on a metered mobile plan.

## Updating

Tag the currently running container's immutable image ID before rebuilding so you can roll back immediately if needed:

```bash
docker tag "$(docker inspect --type=container --format '{{.Image}}' read-aloud)" read-aloud:previous
cd reader-for-neurodivergents && git pull
docker compose -f deploy/compose.prod.yaml up -d --build
```

Only the layers after the dependency install rebuild, so this takes a minute or
two rather than twenty. Installed copies of the app pick up the new front-end
through the service worker and offer a **Reload** prompt.

## Rollback

If a release causes synthesis failures, alignment drift, or startup errors:

1. **Fast image rollback** (when `read-aloud:previous` was tagged before updating):

```bash
docker tag read-aloud:previous read-aloud:latest
docker compose -f deploy/compose.prod.yaml up -d --no-build
```

2. **Git tag rollback** (when rebuilding from a known-good release):

```bash
cd reader-for-neurodivergents
git checkout v1.1.2
docker compose -f deploy/compose.prod.yaml up -d --build
```

3. **Verify recovery**:

```bash
curl -fsS http://127.0.0.1:8765/api/health
```

Wait briefly for startup warm-up and re-check `/api/health` until `"ok": true`, `"loaded": true`, and `"threads"` matches the container's effective CPU limit (`2` with `cpus: 2.0` in `deploy/compose.prod.yaml`). If `"loaded"` remains `false` after warm-up, inspect container logs (`docker logs read-aloud`) for `"warm-up failed"` (note that the first synthesis request also triggers lazy model loading). If the target release includes `GET /api/metrics` (added after `v1.1.3`), also check:

```bash
curl -fsS http://127.0.0.1:8765/api/metrics | grep read_aloud_speak
```

## Troubleshooting

**`"threads"` in `/api/health` is larger than 2**
The CPU limit is not reaching the container. Confirm `cpus: 2.0` is still in
the compose file. Without it you will see roughly 0.35× real time.

**504 Gateway Time-out on long sentences**
nginx's default 60 s read timeout is too short for a slow CPU; the supplied
config sets 180 s. Check you copied it rather than editing an existing site.

**`nginx: [emerg] zero size shared memory zone "reader"`**
`limit_req zone=reader` is being read without the `limit_req_zone` that
defines it. Earlier versions of this guide put that directive in a second file
under `conf.d/`; it now lives at the top of the site config. Make sure you
copied the current `deploy/nginx/reader.n2048.com.conf`, and delete any
leftover `/etc/nginx/conf.d/reader-ratelimit.conf`.

**Everything returns 401**
The htpasswd file is missing or unreadable by nginx. It fails closed, which is
the right way round, but `nginx -t` will not catch it — only requests do.
Check `/var/log/nginx/reader.error.log` and re-run `htpasswd`.

**`docker-compose up` fails with `KeyError: 'ContainerConfig'`**
That is `docker-compose` v1 against a modern engine — see step 2. Use
`docker compose` with a space.

**The container is killed during the build or first load**
Out of memory. Add the swap file before building.

**The container is healthy but nothing answers on the port**
A failed port binding can leave a container that the restart policy brings up
without its published ports. `docker compose down` then `up -d` — a plain
restart will not fix it. Check with `docker port read-aloud`.

**Playback stutters**
Check `docker stats` while reading. If CPU is pinned at 200%, the droplet is at
capacity — either read at a lower speed or move to 4 vCPU.

**No Install button on the phone**
Certbot has not run yet, or you are on `http://`. On iOS there is never a
button: use Share → Add to Home Screen.

**Everything is fine but nothing plays on iPhone**
iOS mutes web audio when the ringer switch is off.

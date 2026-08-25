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

### 2. Install Docker (if it is not there)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
```

### 3. Add swap

As above. Do this **before** the first build — the PyTorch install is the
most memory-hungry moment of the whole process.

### 4. Get the code and build

```bash
git clone https://github.com/n2048-creative-technology/reader-for-neurodivergents.git
cd reader-for-neurodivergents
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
sudo cp deploy/nginx/reader-ratelimit.conf /etc/nginx/conf.d/
sudo cp deploy/nginx/reader.n2048.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/reader.n2048.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The rate-limit file is separate because `limit_req_zone` must live in nginx's
`http` context, not inside a `server` block.

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

```bash
cd reader-for-neurodivergents && git pull
docker compose -f deploy/compose.prod.yaml up -d --build
```

Only the layers after the dependency install rebuild, so this takes a minute or
two rather than twenty. Installed copies of the app pick up the new front-end
through the service worker and offer a **Reload** prompt.

## Troubleshooting

**`"threads"` in `/api/health` is larger than 2**
The CPU limit is not reaching the container. Confirm `cpus: 2.0` is still in
the compose file. Without it you will see roughly 0.35× real time.

**504 Gateway Time-out on long sentences**
nginx's default 60 s read timeout is too short for a slow CPU; the supplied
config sets 180 s. Check you copied it rather than editing an existing site.

**The container is killed during the build or first load**
Out of memory. Add the swap file before building.

**Playback stutters**
Check `docker stats` while reading. If CPU is pinned at 200%, the droplet is at
capacity — either read at a lower speed or move to 4 vCPU.

**No Install button on the phone**
Certbot has not run yet, or you are on `http://`. On iOS there is never a
button: use Share → Add to Home Screen.

**Everything is fine but nothing plays on iPhone**
iOS mutes web audio when the ringer switch is off.

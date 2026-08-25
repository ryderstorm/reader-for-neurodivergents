#!/usr/bin/env bash
# Generate a local certificate authority and a server certificate, so the
# reader can be served over https and installed as an app on a phone.
#
# Browsers only allow service workers (offline use) and "Add to Home Screen"
# in a secure context: https, or localhost. A phone reaching this machine at
# http://192.168.x.x is neither, so it needs a certificate — and because no
# public CA will sign a private IP, that means a CA you trust yourself.
#
#   ./scripts-tools/make-cert.sh          # detect LAN addresses automatically
#   ./scripts-tools/make-cert.sh reader.local 192.168.1.50
set -euo pipefail
cd "$(dirname "$0")/.."

CERTS=certs
DAYS=825          # the maximum iOS and Chrome accept for a leaf certificate
mkdir -p "$CERTS"

# Collect the names this certificate must be valid for.
NAMES=("localhost" "$(hostname)" "$(hostname).local")
IPS=("127.0.0.1" "::1")
while read -r ip; do [ -n "$ip" ] && IPS+=("$ip"); done < <(
  ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]}'
)
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then IPS+=("$extra");
  else NAMES+=("$extra"); fi
done

SAN=""
i=1; for n in "${NAMES[@]}"; do [ -n "$n" ] && { SAN+="DNS.$i = $n"$'\n'; i=$((i+1)); }; done
i=1; for a in "${IPS[@]}";  do SAN+="IP.$i = $a"$'\n'; i=$((i+1)); done

echo "==> Certificate will be valid for:"
printf '    %s\n' "${NAMES[@]}" "${IPS[@]}"

# --- the CA (created once, reused afterwards) ------------------------------
if [ ! -f "$CERTS/ca.crt" ]; then
  echo "==> Creating a local certificate authority"
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$CERTS/ca.key" -out "$CERTS/ca.crt" \
    -subj "/CN=Read Aloud local CA/O=Read Aloud" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
else
  echo "==> Reusing the existing CA at $CERTS/ca.crt"
fi

# --- the server certificate -------------------------------------------------
cat > "$CERTS/server.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = Read Aloud
[ext]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
$SAN
CNF

openssl req -newkey rsa:2048 -nodes -sha256 \
  -keyout "$CERTS/server.key" -out "$CERTS/server.csr" \
  -config "$CERTS/server.cnf" 2>/dev/null
openssl x509 -req -in "$CERTS/server.csr" -days "$DAYS" -sha256 \
  -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key" -CAcreateserial \
  -extfile "$CERTS/server.cnf" -extensions ext \
  -out "$CERTS/server.crt" 2>/dev/null
rm -f "$CERTS/server.csr" "$CERTS/ca.srl"
chmod 600 "$CERTS"/*.key

echo
echo "Wrote $CERTS/server.crt and $CERTS/server.key"
echo "run.sh picks them up automatically:  HOST=0.0.0.0 ./scripts-tools/run.sh"
echo
echo "Next, trust $CERTS/ca.crt on the phone — once, and it covers every"
echo "certificate this CA signs later:"
echo
echo "  Serve it:   python3 -m http.server 8000 --directory $CERTS"
echo "              then open http://<this-machine-ip>:8000/ca.crt on the phone"
echo
echo "  iOS      Settings > Profile Downloaded > Install, then"
echo "           Settings > General > About > Certificate Trust Settings"
echo "           and switch on 'Read Aloud local CA'. Both steps are required."
echo "  Android  Settings > Security > Encryption & credentials >"
echo "           Install a certificate > CA certificate"
echo
echo "Prefer not to install a CA? Tailscale and cloudflared both give you a"
echo "real https URL with no certificate work — see the README."

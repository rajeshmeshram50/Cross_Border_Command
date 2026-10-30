# Zebra handheld → new server: DNS, TLS and connection runbook

Everything needed to stand up a new server that Zebra TC27 handhelds can scan
against, in the order you run it. Commands assume **Ubuntu 22.04/24.04 + nginx**
and a shell with `sudo`. Replace every `<PLACEHOLDER>` before running.

| Placeholder | Example | What it is |
|---|---|---|
| `<SCAN_HOST>` | `scan.yourcompany.com` | The hostname baked into every printed QR |
| `<SERVER_IP>` | `203.0.113.40` | Public IP of the new server |
| `<LAN_IP>` | `192.168.10.20` | The server's address on the warehouse LAN |
| `<APP_DIR>` | `/var/www/cbc` | Where the app is deployed |
| `<SERIAL>` | `21267522500123` | The Zebra's serial, as printed on the device |

---

## 0 · How the pieces connect

```
Zebra TC27 (Chrome, client certificate installed)
        │  scans a carton QR: https://<SCAN_HOST>/ps/<key>
        ▼
DNS  <SCAN_HOST> ──► <SERVER_IP>   (public)  or  <LAN_IP>  (inside the warehouse)
        ▼
nginx :443
   · server certificate  → proves the server to the device
   · client certificate  → proves the DEVICE to the server (mTLS)
   · passes CN as        → X-Scan-Cert-CN: zebra-<SERIAL>
        ▼
Laravel
   · ScanDeviceController@check  reads X-Scan-Cert-CN, strips "zebra-",
     looks the serial up in `scan_devices`, answers authorized true/false
   · /api/scan/putaway/*  the put-away calls, throttled 120/min
```

Two things follow from this diagram and they drive the whole setup:

1. **The QR carries the hostname.** `STICKER_URL` is printed into every label.
   Change the host later and cartons already in the racks still point at the old
   one. Pick the name once.
2. **The device is identified by a certificate, not a login.** The floor never
   signs in per carton. CN is `zebra-<SERIAL>` and the serial must match a row
   in `scan_devices`. A token is the fallback path if you skip mTLS.

---

## 1 · DNS

### 1a · Public DNS (device uses mobile data or the office WAN)

At your DNS provider, one A record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `scan` | `<SERVER_IP>` | 300 |

Keep TTL at 300 until the cutover is proven, then raise it to 3600.

Verify from anywhere:

```bash
dig +short <SCAN_HOST>                  # must print <SERVER_IP>
dig +short <SCAN_HOST> @8.8.8.8         # and from a resolver you do not control
```

### 1b · Internal DNS (device is on the warehouse Wi-Fi)

If the handhelds stay on the LAN, resolve the **same name** to the LAN address,
so one QR works inside and outside. This is split-horizon DNS — do not invent a
second hostname for internal use, or you will print two kinds of label.

**dnsmasq** (small sites, a router or a Pi):

```bash
sudo apt update && sudo apt install -y dnsmasq
echo "address=/<SCAN_HOST>/<LAN_IP>" | sudo tee /etc/dnsmasq.d/scan.conf
sudo systemctl restart dnsmasq
sudo systemctl enable dnsmasq
```

**BIND9** (an existing internal zone):

```bash
sudo apt install -y bind9 bind9-utils
sudo nano /etc/bind/db.yourcompany.com
```

Add the record, then bump the zone serial (the `YYYYMMDDNN` number at the top —
BIND ignores the file if you forget):

```
scan    IN  A   <LAN_IP>
```

```bash
sudo named-checkzone yourcompany.com /etc/bind/db.yourcompany.com
sudo rndc reload yourcompany.com
```

**Windows Server DNS** (PowerShell, on the DC):

```powershell
Add-DnsServerResourceRecordA -Name "scan" -ZoneName "yourcompany.com" `
  -IPv4Address "<LAN_IP>" -TimeToLive 00:05:00
Get-DnsServerResourceRecord -ZoneName "yourcompany.com" -Name "scan"
```

Then make sure the warehouse Wi-Fi hands out that resolver in DHCP, and check
from the Zebra itself (Chrome → `https://<SCAN_HOST>/up`) before going further.

---

## 1-ALT · Skip DNS: run on the IP instead

**Use this instead of §1 and §3 if** the handhelds never leave the warehouse LAN
and the server's address is static. It removes the DNS record, the split-horizon
setup and certbot — roughly half the work above.

**Do not use it if** the address can change. The IP is printed into every QR, so
a DHCP lease that moves, an ISP change, a server migration or a failover to a
second box kills every carton already in the racks. A hostname survives all four;
an IP survives none of them. That is the whole of the trade.

### Why HTTPS is still required

Plain `http://<LAN_IP>` would work for scanning — the TC27's DataWedge types the
payload as keystrokes, so there is no camera and no secure-context rule to
satisfy. But two things break:

* The put-away screen installs as a standalone app (`manifest.json`,
  `display: standalone`). Chrome will not install an insecure origin — it opens
  as an ordinary tab with the address bar in the way.
* Device tokens and every put-away call would cross the warehouse Wi-Fi in clear
  text, which defeats the point of enrolling devices at all.

Public CAs will not issue for a bare IP. You do not need one: §4 already builds
a CA for the devices, so sign the server with the same CA.

### 1-ALT-a · Pin the address

```bash
sudo nano /etc/netplan/01-netcfg.yaml      # or your DHCP server's reservation
```

```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [<LAN_IP>/24]
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

```bash
sudo netplan apply && ip -4 addr show eth0
```

A DHCP reservation on the router works equally well — what matters is that the
address is never handed to anything else.

### 1-ALT-b · Server certificate from your own CA

Run this **after** §4a has created `scan-ca.crt` / `scan-ca.key`:

```bash
cd ~/scan-ca

cat > server-ip.cnf <<'EOF'
[req]
distinguished_name = req
[v3]
subjectAltName   = IP:<LAN_IP>
keyUsage         = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl genrsa -out scan-server.key 2048
openssl req -new -key scan-server.key -out scan-server.csr -subj "/CN=<LAN_IP>"
openssl x509 -req -in scan-server.csr -CA scan-ca.crt -CAkey scan-ca.key \
  -CAcreateserial -out scan-server.crt -days 825 -sha256 \
  -extfile server-ip.cnf -extensions v3

openssl x509 -in scan-server.crt -noout -text | grep -A1 "Subject Alternative Name"
# → IP Address:<LAN_IP>      ← a CN alone is ignored; the SAN is what Chrome reads
```

Install it:

```bash
sudo mkdir -p /etc/nginx/scan-ca
sudo cp scan-server.crt scan-server.key /etc/nginx/scan-ca/
sudo chmod 600 /etc/nginx/scan-ca/scan-server.key
```

825 days is fine here. Chrome's 398-day ceiling applies only to certificates
chaining to a publicly trusted root; a private CA is exempt.

### 1-ALT-c · nginx changes

In the §5 server block, replace the two Let's Encrypt lines and the name:

```nginx
server_name _;
ssl_certificate     /etc/nginx/scan-ca/scan-server.crt;
ssl_certificate_key /etc/nginx/scan-ca/scan-server.key;
```

Everything else in §5 — the client-certificate block and the `fastcgi_param`
lines — is unchanged.

### 1-ALT-d · Trust the CA on each Zebra

One extra import per device, alongside the `.p12` in §7:

1. Copy `scan-ca.crt` to the device.
2. **Settings → Security → Encryption & credentials → Install a certificate →
   CA certificate** → accept the "your network may be monitored" warning (it is
   expected for a private CA) → pick `scan-ca.crt`.
3. Then import `zebra-<SERIAL>.p12` as in §7.

Chrome honours user-installed CAs for browsing, so this is enough. (Android 7+
ignores user CAs for *other apps'* traffic — irrelevant here, since the put-away
screen runs in Chrome.) On an MDM-managed fleet, push it as a system CA and the
warning disappears.

### 1-ALT-e · Point the app at the IP

```ini
APP_URL=https://<LAN_IP>
APP_FRONTEND_URL=https://<LAN_IP>
STICKER_URL=https://<LAN_IP>
```

```bash
php artisan config:cache
```

Verify exactly as in §9, substituting `<LAN_IP>` for `<SCAN_HOST>` and adding
`--cacert scan-ca.crt` to the curl calls.

### What you save, and what it costs

| | Hostname (§1 + §3) | IP only (1-ALT) |
|---|---|---|
| DNS record | required | none |
| Split-horizon DNS | required if on LAN | none |
| certbot + renewal | required | none |
| Server cert | Let's Encrypt, auto-renews | your CA, manual at 825 days |
| Extra step per device | — | import the CA root |
| Server address changes | reprint nothing | **reprint every carton** |
| Reachable outside the LAN | yes | no |
---

## 2 · Server preparation

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y nginx git unzip curl \
  php8.2-fpm php8.2-cli php8.2-mbstring php8.2-xml php8.2-curl \
  php8.2-zip php8.2-gd php8.2-bcmath php8.2-intl php8.2-pgsql
php -v        # must be 8.2 or newer — the app requires it
```

Firewall — only 80 and 443 face the world:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

Confirm the name actually arrives at this box before issuing a certificate:

```bash
curl -I http://<SCAN_HOST>        # must reach THIS server, not the old one
```

---

## 3 · Server TLS certificate

The Zebra's Chrome refuses a self-signed server certificate, and the camera/QR
flow needs a secure context. Use Let's Encrypt.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <SCAN_HOST> --agree-tos -m ops@yourcompany.com --redirect
sudo certbot renew --dry-run        # proves auto-renewal works
```

**If `<SCAN_HOST>` is LAN-only** and port 80 is not reachable from the internet,
use a DNS-01 challenge instead so no inbound port is needed:

```bash
sudo certbot certonly --manual --preferred-challenges dns -d <SCAN_HOST>
# add the _acme-challenge TXT record it prints, wait for propagation, press enter
dig +short TXT _acme-challenge.<SCAN_HOST>
```

---

## 4 · Device certificate authority (mTLS)

This is what makes a personal phone useless even if someone photographs a
sticker. Run it **once** on a machine you control; keep `scan-ca.key` offline.

### 4a · Create the CA

```bash
mkdir -p ~/scan-ca && cd ~/scan-ca
openssl genrsa -aes256 -out scan-ca.key 4096
openssl req -x509 -new -nodes -key scan-ca.key -sha256 -days 3650 \
  -out scan-ca.crt \
  -subj "/C=IN/O=YourCompany/OU=Warehouse/CN=YourCompany Scan Device CA"
```

### 4b · Issue a certificate per handheld

The CN **must** be `zebra-<SERIAL>` — that is the string the app parses.

```bash
SERIAL=<SERIAL>
openssl genrsa -out zebra-$SERIAL.key 2048
openssl req -new -key zebra-$SERIAL.key -out zebra-$SERIAL.csr \
  -subj "/C=IN/O=YourCompany/OU=Handheld/CN=zebra-$SERIAL"
openssl x509 -req -in zebra-$SERIAL.csr -CA scan-ca.crt -CAkey scan-ca.key \
  -CAcreateserial -out zebra-$SERIAL.crt -days 825 -sha256
```

Bundle it for Android (it imports PKCS#12, not PEM). Use a real passphrase —
you type it once on the device:

```bash
openssl pkcs12 -export -legacy \
  -inkey zebra-$SERIAL.key -in zebra-$SERIAL.crt -certfile scan-ca.crt \
  -out zebra-$SERIAL.p12 -name "Scan $SERIAL"
```

> `-legacy` matters: without it OpenSSL 3 writes AES-256 PKCS#12 that older
> Android keystores silently refuse to import.

Verify the CN before you ship it:

```bash
openssl x509 -in zebra-$SERIAL.crt -noout -subject
# subject=C = IN, O = YourCompany, OU = Handheld, CN = zebra-<SERIAL>
```

### 4c · Install the CA on the server

```bash
sudo mkdir -p /etc/nginx/scan-ca
sudo cp scan-ca.crt /etc/nginx/scan-ca/scan-ca.crt
sudo chmod 644 /etc/nginx/scan-ca/scan-ca.crt
```

### 4d · Revocation list (needed to kill a lost device at the proxy)

```bash
cd ~/scan-ca
touch index.txt && echo 1000 > crlnumber
openssl ca -config /etc/ssl/openssl.cnf -gencrl -keyfile scan-ca.key \
  -cert scan-ca.crt -out scan-ca.crl
sudo cp scan-ca.crl /etc/nginx/scan-ca/scan-ca.crl
```

In practice you will usually suspend the device in the app instead (§8), which
is instant and needs no nginx reload.

---

## 5 · nginx

`sudo nano /etc/nginx/sites-available/scan` :

```nginx
server {
    listen 443 ssl http2;
    server_name <SCAN_HOST>;

    root <APP_DIR>/public;
    index index.php;

    ssl_certificate     /etc/letsencrypt/live/<SCAN_HOST>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<SCAN_HOST>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Device certificates. "optional" (not "on") so the browser is still
    # served the landing page and the APP decides — a hard refusal here
    # gives the floor a blank TLS error with nothing to report.
    ssl_client_certificate /etc/nginx/scan-ca/scan-ca.crt;
    ssl_verify_client      optional;
    ssl_verify_depth       2;
    # ssl_crl              /etc/nginx/scan-ca/scan-ca.crl;

    client_max_body_size 25M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;

        # THE line that matters. Set unconditionally, so a header a client
        # sends itself is overwritten, never passed through. $ssl_client_s_dn_cn
        # is empty unless nginx verified the certificate against our CA.
        fastcgi_param HTTP_X_SCAN_CERT_CN $ssl_client_s_dn_cn;
        fastcgi_param HTTP_X_SCAN_CERT_VERIFY $ssl_client_verify;
    }

    location ~ /\.(?!well-known).* { deny all; }
}

server {
    listen 80;
    server_name <SCAN_HOST>;
    return 301 https://$host$request_uri;
}
```

> On nginx older than 1.11.6, `$ssl_client_s_dn_cn` does not exist. Use
> `$ssl_client_s_dn` and strip the CN in the app, or upgrade nginx.

```bash
sudo ln -sf /etc/nginx/sites-available/scan /etc/nginx/sites-enabled/scan
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6 · Application configuration

In `<APP_DIR>/.env`:

```ini
APP_URL=https://<SCAN_HOST>
APP_FRONTEND_URL=https://<SCAN_HOST>

# The host printed into every QR from now on. Must be what the WAREHOUSE
# reaches, not the Blade host.
STICKER_URL=https://<SCAN_HOST>

# Signs the sticker payload. Leave unset to derive it from APP_KEY (random
# per environment). If you set it, it must match across every server that
# prints or reads labels, or genuine stickers read as tampered.
STICKER_SECRET=

# Turn off once every carton on the floor has been reprinted by the new server.
STICKER_ACCEPT_LEGACY=true

# How long a half-finished scan stays valid.
SCAN_STALE_MINUTES=5
```

Because nginx now sits in front of Laravel, trust it — otherwise generated URLs
come out `http://` and signed links break:

```bash
grep -n "TrustProxies\|trustProxies" <APP_DIR>/bootstrap/app.php
# ensure the proxy middleware trusts '*' (single reverse proxy) or <SERVER_IP>
```

Deploy and cache:

```bash
cd <APP_DIR>
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate --force
php artisan config:cache route:cache view:cache
sudo chown -R www-data:www-data storage bootstrap/cache
```

Queue worker (announcements, mail, label jobs):

```bash
sudo apt install -y supervisor
sudo tee /etc/supervisor/conf.d/cbc-worker.conf >/dev/null <<'EOF'
[program:cbc-worker]
command=php /var/www/cbc/artisan queue:work --sleep=3 --tries=3 --max-time=3600
autostart=true
autorestart=true
user=www-data
numprocs=2
redirect_stderr=true
stdout_logfile=/var/log/cbc-worker.log
stopwaitsecs=3600
EOF
sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl status
```

---

## 7 · Install the certificate on the Zebra

On the device:

1. Copy `zebra-<SERIAL>.p12` across (USB, or an internal download link).
2. **Settings → Security → Encryption & credentials → Install a certificate →
   VPN & app user certificate** → pick the `.p12` → enter the passphrase →
   name it `Scan <SERIAL>`.
3. Open Chrome → `https://<SCAN_HOST>/ps/test` → when Chrome asks which
   certificate to use, pick it and tick **remember**.
4. Add to the home screen so it launches full-screen.

Scoped to a managed fleet instead? Push the same `.p12` through StageNow or your
MDM as a user certificate, and pre-grant Chrome's certificate selection so the
operator is never prompted.

---

## 8 · Enrol the device in the app

The certificate proves *which* device; the `scan_devices` row decides whether it
may scan, and which tenant it belongs to.

1. Sign in as an admin of the right client.
2. **Inventory → Scan Devices → Add device.**
3. Serial = exactly the `<SERIAL>` in the CN. Label = where it lives
   ("Pack bench 2"). Model defaults to `TC27`.
4. Save. The plaintext token is shown **once** — keep it only as the fallback
   for a device you have not issued a certificate to.

Whoever is signed in at enrollment authors every put-away that device later
confirms, so enrol as the floor supervisor, not as a shared admin.

To stop a lost handheld: set its status to **suspended** on that same screen.
That takes effect on its next call, with no nginx reload and no CRL.

---

## 9 · Verify, in order

```bash
# 1 · name resolves to this server
dig +short <SCAN_HOST>

# 2 · TLS is valid and the chain is complete
openssl s_client -connect <SCAN_HOST>:443 -servername <SCAN_HOST> </dev/null \
  | openssl x509 -noout -dates -subject

# 3 · nginx asks for a client certificate
openssl s_client -connect <SCAN_HOST>:443 -servername <SCAN_HOST> </dev/null 2>&1 \
  | grep -i "Acceptable client certificate CA names" -A3

# 4 · WITHOUT a certificate the app must refuse
curl -s https://<SCAN_HOST>/api/scan-devices/check -H 'Accept: application/json' -d '{}' \
  -H 'Content-Type: application/json'
# → {"authorized":false,"code":"rejected_unauthorized_device","device":null}

# 5 · WITH the certificate it must pass
curl -s https://<SCAN_HOST>/api/scan-devices/check \
  --cert zebra-<SERIAL>.crt --key zebra-<SERIAL>.key \
  -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{}'
# → {"authorized":true,"code":"device_ok","device":{...}}

# 6 · a forged header is ignored (nginx overwrites it)
curl -s https://<SCAN_HOST>/api/scan-devices/check \
  -H 'X-Scan-Cert-CN: zebra-<SERIAL>' \
  -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{}'
# → authorized:false   ← if this returns TRUE, step 5's fastcgi_param is wrong
```

Step 6 is the one worth re-running after every nginx change. If a client can set
that header, the certificate gate is decorative.

Then, on the device: print one sticker, scan it, and confirm a put-away end to
end before you reprint the floor.

---

## 10 · Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| QR opens the **old** server | Label printed before `STICKER_URL` changed | Reprint; old cartons keep the old host until they do |
| `authorized:false` with a valid cert | CN is not `zebra-<SERIAL>`, or the serial has no row | `openssl x509 -noout -subject`; compare with Inventory → Scan Devices |
| Chrome never asks for a certificate | `ssl_client_certificate` missing, or the CA does not match the one that signed it | `nginx -t`, then verify step 3 above |
| Android refuses the `.p12` | PKCS#12 written with AES-256 | Re-export with `-legacy` |
| Everything 404s under `/ps/...` | `try_files` missing, so the SPA route never reaches `index.php` | Check the `location /` block |
| Signed PDF links come out `http://` | Proxy not trusted | Trust the proxy in `bootstrap/app.php`, then `php artisan config:cache` |
| "Sticker tampered" on genuine labels | `STICKER_SECRET` differs between the printing server and this one | Make them equal, or unset on both so APP_KEY derives it |
| Scans accepted but attributed to the wrong person | Wrong user signed in at enrollment | Re-enrol the device as the right supervisor |

---

## 11 · Routine operations

```bash
# add a second handheld — repeat §4b with its serial, then enrol it in the app
# rotate a device credential (token fallback)
#   Inventory → Scan Devices → the row → Rotate. The old token dies immediately.

# renew TLS (automatic, but to force it)
sudo certbot renew --force-renewal && sudo systemctl reload nginx

# watch what the floor is actually sending
sudo tail -f /var/log/nginx/access.log | grep -E "/ps/|/api/scan/putaway"
tail -f <APP_DIR>/storage/logs/laravel.log
```

Device certificates issued in §4b expire after **825 days**. Put that date in a
calendar now — a fleet that expires on the same morning stops the warehouse.

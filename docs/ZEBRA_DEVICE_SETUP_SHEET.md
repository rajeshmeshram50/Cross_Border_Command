# Zebra Handheld — End-to-End Setup & Security Sheet

> **Written for:** whoever buys the handhelds and sets up the server (owner / devops).
> **Goal:** do it once, properly — buy the right device, wire DNS + certificates,
> lock it down, enrol it, and verify. Every step has a check.
>
> Source of truth for deeper detail: `storage/certs/README.md` (mTLS) and
> `docs/p2p/PUTAWAY_APP_INSTALL.md` (PWA install). Open bugs: `docs/ZEBRA_SCAN_BUG_SHEET.md`.

---

## 0. Quick summary

| Item | Production | Dev |
|---|---|---|
| Staff ERP login | `https://kryptone.ai/login` | `https://dev.kryptone.ai/login` |
| **Zebra scanner host** | `https://scan.kryptone.ai` ✅ live | `https://scan-dev.kryptone.ai` (to set up) |
| Server IP | `20.55.246.20` | dev server IP |
| Server TLS cert | Let's Encrypt | Let's Encrypt |
| Device CA (signs Zebra certs) | `CBC Device CA Prod` → `device-ca-prod.pem` | `CBC Device CA` → `device-ca.pem` |
| `STICKER_URL` (.env) | `https://scan.kryptone.ai` | `https://scan-dev.kryptone.ai` |
| App path | `/var/www/html/Cross_Border_Command` | same on dev server |

**Key rule:** the Zebra never uses the staff host (`kryptone.ai` / `dev.kryptone.ai`).
It always uses the **scan-** host, because that host demands a device certificate
for the whole connection (TLS 1.3 cannot ask for one on only some paths).

---

## 1. How the connection works

```
 ┌────────────────────────┐
 │ Zebra handheld         │  holds: device cert  CN = zebra-<serial>
 │ Chrome / installed PWA │         (signed by our Device CA)
 └───────────┬────────────┘
             │ ① DNS: scan.kryptone.ai → 20.55.246.20
             │ ② TLS handshake on :443
             │    server → device : Let's Encrypt cert   ("I am scan.kryptone.ai")
             │    device → server : Zebra client cert    ("I am an approved handheld")
             ▼
 ┌──────────────────────────────────────────┐
 │ Apache  (vhost scan.kryptone.ai, mod_ssl) │
 │  SSLVerifyClient require                  │  no cert / wrong CA → refused,
 │  SSLCACertificateFile device-ca-prod.pem  │  PHP never runs
 │  strips client X-Scan-Cert-CN, then sets  │
 │  X-Scan-Cert-CN = verified CN             │
 └───────────┬──────────────────────────────┘
             │ ③ only via 127.0.0.1 / socket (PHP-FPM)
             ▼
 ┌──────────────────────────────────────────┐
 │ Laravel                                   │
 │  CN "zebra-<serial>" → scan_devices row   │  status must be 'active'
 │  acts as enrolled_by user + its client    │  → tenant + branch scope
 └───────────┬──────────────────────────────┘
             ▼
        Put-away saved in that environment's DB
```

Two layers must both pass:

1. **Cryptography (Apache):** is this a certificate our Device CA signed?
2. **Database (Laravel):** is this serial an *active* device, and who does it act as?

---

## 2. Before you buy — device checklist

| Requirement | Why |
|---|---|
| **Android 10+** (Zebra TC2x / TC5x / TC7x / MC series, or any Android handheld) | needs modern Chrome + Android user-certificate store |
| **Google Chrome** installed and updatable | scanner app is a PWA running in Chrome |
| **Built-in barcode/QR scan engine** with keyboard-wedge output (Zebra **DataWedge**) | labels are QR codes holding a URL; DataWedge types the scan into the page |
| **Wi-Fi** (or 4G) with outbound **HTTPS 443** allowed | scanner host is on 443 only |
| A **screen lock** (PIN / pattern) set on the device | Android refuses to install a user certificate without one |
| Note the **serial number** at purchase | it becomes the certificate name (`zebra-<serial>`) and the DB key |

One handheld = one serial = one certificate = one `scan_devices` row (per environment).

---

## 3. One-time server setup (per environment)

Do this once for prod (already done) and once for dev. Commands below show **dev**;
for prod replace `scan-dev` → `scan` and `device-ca` → `device-ca-prod`.

### 3.1 DNS

At the DNS provider for `kryptone.ai`:

```
scan-dev.kryptone.ai.    A    <dev server IP>
```

Check: `nslookup scan-dev.kryptone.ai` returns that IP.

### 3.2 Server TLS certificate (Let's Encrypt)

```bash
sudo a2enmod ssl headers rewrite
sudo certbot certonly --apache --cert-name scan-dev.kryptone.ai -d scan-dev.kryptone.ai
```

Auto-renews via certbot timer. Check: `sudo certbot certificates`.

### 3.3 Device CA (our own — signs every handheld)

```bash
cd /var/www/html/Cross_Border_Command/storage/certs
openssl genrsa -out device-ca-key.pem 2048
chmod 600 device-ca-key.pem
openssl req -x509 -new -nodes -key device-ca-key.pem -sha256 -days 3650 \
  -out device-ca.pem -subj "/CN=CBC Device CA/O=CrossBorderCommand/C=IN"
```

- `device-ca.pem` = public, Apache uses it to verify.
- `device-ca-key.pem` = **secret**, needed only to sign a new device. See §7.
- Never reuse the prod CA for dev — that keeps test devices off production.

### 3.4 Scanner vhost

`/etc/apache2/sites-available/scan-dev.kryptone.ai.conf`:

```apache
<VirtualHost *:443>
    ServerName scan-dev.kryptone.ai
    DocumentRoot /var/www/html/Cross_Border_Command/public

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/scan-dev.kryptone.ai/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/scan-dev.kryptone.ai/privkey.pem

    # Mutual TLS: require a device cert signed by our Device CA
    SSLCACertificateFile  /var/www/html/Cross_Border_Command/storage/certs/device-ca.pem
    SSLVerifyClient       require
    SSLVerifyDepth        1

    # Never trust a client-sent copy; set it only from the verified cert
    RequestHeader unset X-Scan-Cert-CN
    RequestHeader set   X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"

    # Scanner-only host: everything else goes to the scan page
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/(putaway-scan|ps/|api/scan/|api/scan-devices/enroll|login|api/login|build/|images/|fonts/|storage/|manifest\.json|sw\.js|favicon)
    RewriteRule ^ /putaway-scan [R=302,L]

    <Directory /var/www/html/Cross_Border_Command/public>
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/scan-dev-error.log
    CustomLog ${APACHE_LOG_DIR}/scan-dev-access.log combined
</VirtualHost>
```

```bash
sudo a2ensite scan-dev.kryptone.ai
sudo apache2ctl configtest && sudo systemctl reload apache2
```

### 3.5 Close the side door on the staff host

Inside the `dev.kryptone.ai` vhosts (**both** `:443` and `:80`):

```apache
<LocationMatch "^/(index\.php/)?(ps/|putaway-scan|api/scan/)">
    Require all denied
</LocationMatch>
```

Without this, the scan API answers on the staff host with no certificate.
The `(index\.php/)?` part closes bypass **SEC-03** — apply the same line on prod
(`kryptone.ai`), whose current rule lacks it. `api/scan/` keeps the trailing slash
so admin `/api/scan-devices` stays reachable.

### 3.6 PHP reachable only through Apache

```bash
sudo ss -lntp | grep -Ei "php|fpm"     # expect 127.0.0.1:<port> or a unix socket
```

If PHP listens on `0.0.0.0` or a public port, anyone can send `X-Scan-Cert-CN`
by hand and skip the certificate (bug **SEC-01**). Never run
`php artisan serve --host=0.0.0.0` on a server.

### 3.7 Label host in `.env`

```env
STICKER_URL=https://scan-dev.kryptone.ai
```

```bash
php artisan config:clear
php artisan tinker --execute="echo config('inventory.sticker_url').PHP_EOL;"
```

The host is printed inside every QR label. Labels printed earlier keep their old host.

---

## 4. Per-device setup (repeat for each Zebra bought)

### 4.1 Issue the device certificate

On the server holding the CA key:

```bash
cd /var/www/html/Cross_Border_Command/storage/certs
SERIAL=<zebra serial>          # e.g. 26013524701106
CA=device-ca                   # prod: device-ca-prod

openssl genrsa -out z-$SERIAL-key.pem 2048
openssl req -new -key z-$SERIAL-key.pem -out z-$SERIAL.csr \
  -subj "/CN=zebra-$SERIAL/O=CrossBorderCommand/C=IN"
openssl x509 -req -in z-$SERIAL.csr -CA $CA.pem -CAkey $CA-key.pem \
  -CAcreateserial -out z-$SERIAL-cert.pem -days 1825 -sha256
openssl pkcs12 -export -in z-$SERIAL-cert.pem -inkey z-$SERIAL-key.pem \
  -out z-$SERIAL.p12 -name "Kryptone Zebra DEV" -passout pass:<PASSWORD>
rm -f z-$SERIAL.csr

openssl x509 -in z-$SERIAL-cert.pem -noout -subject -issuer -dates   # verify
```

- CN **must** be exactly `zebra-<serial>` — that is the only link to the DB row.
- Valid 5 years (`-days 1825`).
- Use a new password per batch; send it over a **different channel** than the file.
- Name it `Kryptone Zebra` (prod) / `Kryptone Zebra DEV` (dev) so they are distinguishable.

### 4.2 Register the device in the app

1. Log in at the staff host (`https://dev.kryptone.ai/login`) **as the person who
   will own the device's scans**.
2. **Inventory → Scan Devices → Add**: serial = `<serial>`, label, location.
3. Status **Active**.
4. Confirm the row's `client_id` is the company that owns the boxes and
   `enrolled_by` / `created_by` is a user inside that company.

Never create two rows with the same serial in one database (bug **SEC-04**).

### 4.3 Install the certificate on the Zebra

1. Copy `z-<serial>.p12` to the device (USB → `Download` is safest).
2. **Settings → Security → Encryption & credentials → Install a certificate →
   VPN & app user certificate** (NOT "CA certificate").
3. Pick the file, enter the password, name it.
4. **Delete the `.p12`** from the device, the server, and any chat/email.

```bash
shred -u z-$SERIAL-key.pem z-$SERIAL.p12     # on the server, after install
```

### 4.4 Install the scanner app (PWA)

1. Chrome → `https://scan-dev.kryptone.ai/putaway-scan`
2. Chrome asks which certificate → pick **Kryptone Zebra DEV**.
3. Chrome **⋮ → Install app** (fullscreen icon on the home screen).
4. Turn **off battery optimisation for Chrome**; tell operators not to swipe Chrome
   from Recents (otherwise the certificate prompt returns more often).

### 4.5 DataWedge

Configure a DataWedge profile for Chrome: Barcode input ON (QR enabled), Keystroke
output ON, send **Enter** suffix. Scanning a label should navigate / fill the scan field.

---

## 5. Verification (do all of these)

From a Linux/OpenSSL machine (Windows `curl` cannot send PEM client certs):

```bash
# DNS
nslookup scan-dev.kryptone.ai

# Server presents Let's Encrypt and asks for our Device CA
echo | openssl s_client -connect scan-dev.kryptone.ai:443 -servername scan-dev.kryptone.ai 2>&1 \
  | grep -iE "subject=|Acceptable client certificate CA names" -A2
#   expect: CN=CBC Device CA

# Without a device cert → refused at handshake
curl https://scan-dev.kryptone.ai/putaway-scan -o /dev/null -w "no cert: %{http_code}\n"

# With a device cert → 200
curl --cert z-<serial>-cert.pem --key z-<serial>-key.pem \
     https://scan-dev.kryptone.ai/putaway-scan -o /dev/null -w "with cert: %{http_code}\n"

# Staff host unaffected, scanner paths blocked there
curl https://dev.kryptone.ai/login                      -o /dev/null -w "login: %{http_code}\n"    # 200
curl https://dev.kryptone.ai/putaway-scan               -o /dev/null -w "scan path: %{http_code}\n" # 403
curl https://dev.kryptone.ai/index.php/api/scan/x       -o /dev/null -w "bypass: %{http_code}\n"    # 403

# Cross-environment isolation: prod cert on dev host → TLSV1_ALERT_UNKNOWN_CA
```

On the Zebra: scan one real box + location → task completes → row appears in **this**
environment's database and nowhere else.

---

## 6. Switching a Zebra from Prod to Dev (remove one, add the other)

**Remove prod:**

1. Zebra → Settings → Security → **User credentials** → remove **Kryptone Zebra**.
2. Uninstall the prod scanner app; Chrome → Site settings → clear `scan.kryptone.ai`.
3. On `kryptone.ai` → Inventory → Scan Devices → set the device **Suspended**
   (do not delete — keeps history and blocks any leftover cert).
4. *Only if no other device uses prod scanning:* `sudo a2dissite scan.kryptone.ai`
   and remove its DNS record. Labels already on cartons will stop opening.

**Add dev:** §3 (once) + §4 (per device) + §5.

A device may also keep **both** certificates; Chrome remembers the choice per host.

---

## 7. Security checklist

| # | Control | How to check |
|---|---|---|
| 1 | Scanner host requires a client cert (`SSLVerifyClient require`) | §5 no-cert curl fails |
| 2 | Separate Device CA per environment | `openssl s_client` shows different CA names |
| 3 | Apache strips + resets `X-Scan-Cert-CN` | vhost has `RequestHeader unset` before `set` |
| 4 | Scanner paths denied on staff host, incl. `/index.php/...` | §5 `403` checks |
| 5 | PHP-FPM bound to 127.0.0.1 / socket only | `ss -lntp` |
| 6 | **CA private key off the server** after issuing devices | `ls storage/certs/*-key.pem` → none on server; stored encrypted offline |
| 7 | `.p12` files and loose `*-key.pem` deleted after install | `ls storage/certs`, device `Download` folder |
| 8 | `.p12` password not written in the repo/docs | the pilot password is in `storage/certs/README.md` — **remove it** (SEC-10) |
| 9 | Device row Active only while in use | Scan Devices list |
| 10 | Device screen lock set; Chrome battery optimisation off | on device |
| 11 | `APP_DEBUG=false` on servers | `.env` |

### Lost or stolen handheld

1. Inventory → Scan Devices → **Suspended** (immediate; this is the revocation —
   there is no CRL/OCSP, so Apache still accepts the cert but Laravel refuses it).
2. Issue the replacement a new certificate (§4).
3. If the CA key may have leaked: make a new CA, reissue **every** device, swap
   `SSLCACertificateFile`, reload Apache.

### Known open bugs to fix before scaling up (from `ZEBRA_SCAN_BUG_SHEET.md`)

| ID | Issue | Mitigation |
|---|---|---|
| SEC-01 | Laravel trusts `X-Scan-Cert-CN` without proving it came via Apache | §3.6 (PHP not reachable around Apache) |
| SEC-03 | `/index.php/api/scan/...` bypasses the staff-host deny rule | §3.5 regex with `(index\.php/)?` |
| SEC-04 | Serial lookup not scoped by client | one serial = one row; never register another company's serial |
| SEC-06/07 | Sticker signature weak; unsigned short codes accepted | code fix needed |
| SEC-10 | Pilot `.p12` password + serial committed in README | remove; rotate the pilot cert |
| SEC-13 | All handhelds behind one NAT share one per-IP throttle | watch for 429s on busy floors |

---

## 8. Renewals & maintenance

| What | Lifetime | Action |
|---|---|---|
| Let's Encrypt server cert | 90 days, auto-renew | `sudo certbot renew --dry-run` once after setup |
| Zebra device cert | 5 years | reissue (§4.1) before expiry; same serial, same DB row |
| Device CA | 10 years | plan a CA rollover ~1 year before expiry |
| New handheld | — | §2 → §4 → §5 |

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Chrome never asks for a certificate | cert installed as "CA certificate" instead of "VPN & app user certificate"; reinstall |
| `ERR_BAD_SSL_CLIENT_AUTH_CERT` | cert signed by the other environment's CA, or expired |
| Page opens but "device not enrolled / unknown" | no `scan_devices` row with that serial, or status not Active |
| Scans succeed but box "not found" | device row's `client_id` / user belongs to a different company or branch |
| Wrong person recorded on put-aways | `enrolled_by` empty → falls back to `created_by`; re-enrol while logged in as the operator |
| "Install" not offered, only "Create shortcut" | HTTPS/manifest/service worker problem — DevTools → Application → Manifest |
| White screen | `public/hot` exists on server; delete it, `npm run build` |
| Labels open the wrong server | `STICKER_URL` was different when they were printed; reprint |
| Cert prompt every few scans | Chrome being killed — disable battery optimisation, don't swipe from Recents |
| 429 Too Many Requests | shared per-IP throttle (SEC-13) |

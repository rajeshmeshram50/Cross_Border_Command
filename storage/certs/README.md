# Scanner Device Certificate — Setup & Operations

> **Written for:** whoever sets up and runs the server (you / devops).
> This locks the put-away scanner to approved handheld devices using a client
> certificate (mutual TLS). A phone that does not hold a certificate cannot open
> the scanner or call the scan API — the sticker URL alone is useless.

---

## 1. How it works (one paragraph)

Every allowed handheld carries a **client certificate** that was signed by our own
**Device CA**. The server (the Node proxy locally, Apache in production) is told to
**require and verify** that certificate on the scanner paths only. When a device
presents a valid certificate, the front door reads the device **serial** out of the
certificate name (`CN = zebra-<serial>`) and passes it to Laravel as the trusted
header `X-Scan-Cert-CN`. Laravel looks the device up by that serial and acts as it.
No token, no enrollment link. A request without a valid certificate on a scanner
path is refused with **403**.

```
Zebra (holds cert)  --TLS + client cert-->  Front door (proxy/Apache)
                                              │  verifies cert against Device CA
                                              │  reads CN  →  X-Scan-Cert-CN: zebra-<serial>
                                              ▼
                                            Laravel  →  ScanDevice where serial = <serial>
```

This is standard **computer networking**: TLS / **mutual TLS (mTLS)** over a **PKI**
(a CA signing certificates) — the same mechanism behind every `https://` padlock and
client-certificate VPN. We just use the *client-certificate* half of TLS, which most
sites skip.

---

## 1b. How the check works, layer by layer (the network detail)

**Two certificates, opposite jobs** — do not confuse them:

| Certificate | Proves | Direction |
|---|---|---|
| **Server cert** (Let's Encrypt / `cbc.pem`) | "I am really scan.kryptone.ai" | server → device (normal HTTPS) |
| **Device cert** (`zebra.p12`) | "I am really an approved device" | device → server (**the mTLS part**) |

**The certificate check is NOT Laravel middleware.** It happens at the web-server
(Apache / `mod_ssl`) TLS layer, *before* Laravel runs. Laravel only reads the result.
A scan request passes through four layers:

**Layer 1 — Apache `mod_ssl` (the gatekeeper, at TLS handshake time).**
`SSLVerifyClient require` + `SSLCACertificateFile device-ca.pem` make Apache demand a
client cert and **cryptographically verify** it against the CA (signed by us? not
expired? within `SSLVerifyDepth`?). Pure math — unforgeable without the CA's private
key. Results land in env vars: `SSL_CLIENT_VERIFY` (`SUCCESS`/`NONE`/`FAILED`),
`SSL_CLIENT_S_DN_CN` (= `zebra-<serial>`), `SSL_CLIENT_I_DN_CN` (= `CBC Device CA`).
No valid cert + `require` → **Apache refuses the connection; Laravel never runs.**

**Layer 2 — Apache `mod_headers` (pass the name inward, safely).**
```apache
RequestHeader unset X-Scan-Cert-CN
RequestHeader set   X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"
```
`unset` first deletes any client-injected copy (anti-spoof); `set … expr=SUCCESS`
writes the CN **only** when the cert actually verified. So the header is either a
verified device name or absent — it cannot be faked from outside.

**Layer 3 — Laravel routing + middleware (what actually runs here).**
The scan routes (`routes/api.php`) use **only `throttle`** middleware
(`throttle:120,1` for scans, `throttle:60,1` for `device-check`). There is **no
`auth:sanctum`** (these are public — the *device* is the credential) and **no custom
cert middleware**. The device is identified inside the controller, not by middleware.

**Layer 4 — `SpiPutawayScanController::device()` (CN → device + identity).**
Each endpoint calls `$this->device($request)` first:
1. `deviceFromCert()` reads `X-Scan-Cert-CN`, strips `zebra-` → serial → `ScanDevice::where('serial', …)`.
2. Not found → 401; suspended/retired → 403.
3. Resolve actor = `enrolled_by ?: created_by` → a real `User`.
4. `Auth::setUser($actor)` (this request only; no session) so `auth()->user()` works downstream.
5. `TenantContext::fromUser($actor)` sets `client_id` → every query is scoped to that device's tenant.

**The whole chain:**
```
mod_ssl verifies cert → mod_headers sets trusted X-Scan-Cert-CN →
throttle → controller device() → CN→serial→ScanDevice → Auth::setUser + TenantContext → scan runs
```
The expensive, security-critical check is done once by the web server at connection
time; Laravel never trusts the network, only a header Apache guarantees.

---

## 2. The files in this folder — what each one is

| File | What it is | Secret? | Goes where |
|---|---|---|---|
| `device-ca.pem` | **Device CA certificate** (public). The authority that signs device certs. The server trusts any device cert signed by this. CN `CBC Device CA`, valid ~10 years. | No (public) | Server (front door verifies against it) |
| `device-ca-key.pem` | **Device CA private key.** The secret that *signs* new device certs. Whoever holds this can mint a valid device. | **YES — keep safe, never ship to a device** | Server only, offline ideally |
| `device-ca.srl` | Serial-number counter openssl writes while signing. Just bookkeeping. | No | Stays next to the CA |
| `zebra-cert.pem` | **A device's certificate** (public). CN `zebra-26013524701106` — the serial is in the name. Signed by the Device CA, valid ~5 years. | No (public) | Bundled into the `.p12` for the device |
| `zebra-key.pem` | That device's **private key.** | **YES** | Bundled into the `.p12`, then delete the loose copy |
| `zebra.p12` | **The install bundle** = `zebra-cert.pem` + `zebra-key.pem` + password, in the PKCS#12 format Android needs. **This is the file you install on the handheld.** | **YES (has the key + password)** | Copied to the device, installed, then deleted |
| `cbc.pem` / `cbc-key.pem` | The **server's own TLS certificate** (the `https://` identity). Locally this is an `mkcert` dev cert for `192.168.1.84`/localhost. **In production you do NOT use these — you use your real TLS cert (Let's Encrypt for `dev.kryptone.ai`).** | key is secret | Server (TLS termination) |
| `tls-proxy.cjs` | The **local dev front door.** A tiny Node server that terminates TLS, enforces the client cert on scanner paths, and forwards to `php artisan serve`. Local only — in production **Apache** does this job instead. | No | Local dev machine |
| `README.md` | This file. | No | — |

> **The one file to install on the device is `zebra.p12`.** Everything else stays on the server.

---

## 3. Install the certificate on the handheld (Zebra / Android)

1. Copy **`zebra.p12`** to the device (Slack, USB, or a download link).
2. On the device: **Settings → Security → Encryption & credentials → Install a
   certificate → VPN & app user certificate**.
   - Not "CA certificate" — it is a **user/app identity**, so pick **VPN & app user certificate**.
3. Choose `zebra.p12` from **Downloads**.
4. Enter the **.p12 password** (the one set when it was exported).
5. Name it (e.g. **Kryptone Zebra**) and save.
6. **Delete the `zebra.p12` file from the device afterwards** — it is no longer needed and holds the key.

The certificate now lives in Android's credential store (survives cache clears;
removed only by uninstalling it or factory reset).

> **Remove the manual "pick a certificate" prompt** (recommended for the floor):
> push Chrome's `AutoSelectCertificateForUrls` policy via StageNow / MDM so Chrome
> uses the cert silently. Value (one entry per host):
> ```json
> ["{\"pattern\":\"https://dev.kryptone.ai\",\"filter\":{\"ISSUER\":{\"CN\":\"CBC Device CA\"}}}"]
> ```

---

## 4. Server setup

### 4a. Local dev (the Node proxy) — already wired

Run Laravel on an internal port and the proxy on the public port:

```bash
php artisan serve --host=127.0.0.1 --port=8001      # backend (internal only)
node storage/certs/tls-proxy.cjs                     # front door on :8000 (TLS + mTLS)
```

The proxy already: requires the client cert on scanner paths, verifies it against
`device-ca.pem`, strips any client-sent `X-Scan-Cert-CN`, and sets it from the
verified certificate. Scanner paths: `/ps/`, `/putaway-scan`, `/api/scan/putaway`,
`/api/scan/device-check`. Everything else is reachable without a cert.

### 4b. Production (Apache on Ubuntu) — step by step

Apache does what the proxy does locally. **Recommended: a dedicated scanner host**
(e.g. `scan.kryptone.ai`) so client-cert is required at the vhost level — this
avoids TLS-renegotiation issues of requiring a cert on only some paths. Point the
printed stickers at that host. Run these in order on the server:

```bash
# 1. DEPLOY CODE (so the cert-reading controllers + built frontend exist on the box)
cd /var/www/Cross_Border_Command
git pull
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan config:cache && php artisan route:cache

# 2. PLACE THE DEVICE CA — copy ONLY the public cert (not the -key) to:
#    /var/www/Cross_Border_Command/storage/certs/device-ca.pem
#    (must be the SAME CA that signed the devices, or they are rejected)

# 3. ENABLE APACHE MODULES
sudo a2enmod ssl headers

# 4. TLS SERVER CERT for the scanner host (Let's Encrypt)
sudo certbot --apache -d scan.kryptone.ai
```

**5. CREATE the vhost** `/etc/apache2/sites-available/scan.kryptone.ai.conf`:

```apache
<VirtualHost *:443>
    ServerName scan.kryptone.ai
    DocumentRoot /var/www/Cross_Border_Command/public

    SSLEngine on
    # Your REAL server cert (Let's Encrypt), not cbc.pem:
    SSLCertificateFile      /etc/letsencrypt/live/scan.kryptone.ai/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/scan.kryptone.ai/privkey.pem

    # ---- Mutual TLS: require a device cert signed by our Device CA ----
    SSLCACertificateFile    /var/www/Cross_Border_Command/storage/certs/device-ca.pem
    SSLVerifyClient         require
    SSLVerifyDepth          1

    # Never trust a client-supplied copy; set it ONLY from the verified cert.
    RequestHeader unset X-Scan-Cert-CN
    RequestHeader set   X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"

    <Directory /var/www/Cross_Border_Command/public>
        AllowOverride All
        Require all granted
    </Directory>
    # ... your normal PHP-FPM handler / rewrite config ...
</VirtualHost>
```

```bash
# 6. ENABLE + TEST + RELOAD
sudo a2ensite scan.kryptone.ai
sudo apache2ctl configtest
sudo systemctl reload apache2

# 7. LOCK PHP behind Apache — PHP-FPM on 127.0.0.1 only, firewall its port.

# 8. POINT STICKERS at this host (.env), then re-cache config
#    INVENTORY_STICKER_URL=https://scan.kryptone.ai
php artisan config:cache
```

**9. TEST:**
```bash
curl --cert zebra-cert.pem --key zebra-key.pem https://scan.kryptone.ai/putaway-scan -o /dev/null -w "with cert: %{http_code}\n"
curl https://scan.kryptone.ai/putaway-scan -o /dev/null -w "no cert: %{http_code}\n"   # refused / 403
```

If instead you keep **one host** for both the ERP and the scanner, set
`SSLVerifyClient optional` at the vhost and `SSLVerifyClient require` inside a
`<LocationMatch "^/(ps/|putaway-scan|api/scan/putaway|api/scan/device-check)">`
block (needs TLS 1.2 client renegotiation; the dedicated-host option above is
simpler and TLS-1.3-friendly).

> **Critical (step 7):** PHP must only ever be reachable *through* Apache, never
> directly on its internal port, or the `X-Scan-Cert-CN` header could be spoofed —
> someone could send it by hand and skip the certificate entirely. Apache verifying
> the cert is worthless if the app can be reached around Apache. Bind PHP-FPM to
> localhost and firewall the internal port.

---

## 5. Create the Device CA (once, ever)

Only done one time, on the server. On Windows Git Bash use `//CN=...\...` (the
leading `//` stops the path being mangled); on Linux use `/CN=.../O=.../C=IN`.

```bash
# CA private key (KEEP SECRET)
openssl genrsa -out device-ca-key.pem 2048

# CA certificate, self-signed, 10 years
openssl req -x509 -new -nodes -key device-ca-key.pem -sha256 -days 3650 \
  -out device-ca.pem -subj "//CN=CBC Device CA\O=CrossBorderCommand\C=IN"
```

---

## 6. Issue a certificate for a new device (per handheld)

Replace `26013524701106` with the real device serial. **The serial in the CN must
match the `serial` on the `scan_devices` row you register in the app** — that is
how Laravel links the cert to the device.

```bash
SERIAL=26013524701106

# device key + signing request
openssl genrsa -out zebra-key.pem 2048
openssl req -new -key zebra-key.pem -out zebra.csr \
  -subj "//CN=zebra-$SERIAL\O=CrossBorderCommand\C=IN"

# CA signs it — 5 years
openssl x509 -req -in zebra.csr -CA device-ca.pem -CAkey device-ca-key.pem \
  -CAcreateserial -out zebra-cert.pem -days 1825 -sha256

# bundle for Android (set a password you will type on the device)
openssl pkcs12 -export -in zebra-cert.pem -inkey zebra-key.pem \
  -out zebra.p12 -name "Kryptone Zebra" -passout pass:CHANGEME

# clean up the loose request
rm -f zebra.csr
```

Then in the app: **Inventory → Scan Devices → Add device**, with **Serial =** the
same serial. That is all — no token needed, the certificate is the credential.

---

## 7. How the app identifies the device (no code change needed per device)

- Front door verifies the cert → sets `X-Scan-Cert-CN: zebra-<serial>`.
- `SpiPutawayScanController::deviceFromCert()` strips `zebra-` → finds `ScanDevice`
  by `serial`.
- `ScanDeviceController::check()` does the same for the on-load device check.
- The scan author falls back to `created_by` (the admin who registered the device).

---

## 8. Turn a device off / replace a cert

- **Lost or stolen device:** in **Scan Devices**, set it to **Suspended** or
  **Retired** → it stops scanning immediately (the app refuses a suspended device
  even with a valid cert).
- **Replace the cert** (e.g. expiring): re-issue with section 6 using the same
  serial, install the new `.p12`, done. The old one keeps working until it expires
  unless you also run a CRL (not set up — suspend the device row instead).
- **Certificate validity:** Device CA ~10 years, device certs ~5 years. Re-issue
  before expiry.

---

## 9. Security notes / git

- **Never commit** the private keys or the `.p12`: `*-key.pem`, `*.p12`, `*.srl`.
  Keep them local / on the server only. Only `device-ca.pem` (public) and this
  README are safe to share.
- The front door **must strip** any incoming `X-Scan-Cert-CN` and set it only from
  a verified cert (the proxy and the Apache config above both do this).
- PHP must be reachable only behind the front door, never on its raw port.
- The `.p12` is a file — if it leaks *with its password*, it could be installed on
  another device. It still kills the "copy the URL / any phone" problem (the secret
  is not in any link). For hardware-bound, non-copyable keys, the alternative is
  WebAuthn (not implemented here).

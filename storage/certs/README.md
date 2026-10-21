# Scanner Device Certificates — What, Why, and How

> **Written for:** whoever sets up and runs the servers (you / devops).
> This locks the put-away scanner to approved handhelds using a client certificate
> (mutual TLS). A phone without a certificate cannot open the scanner or call the
> scan API — the printed sticker URL alone is useless.
>
> Status: **live on production** (`scan.kryptone.ai`) since 20 Oct 2026.

---

## 1. What this is, in one paragraph

Every approved handheld carries a **client certificate** signed by our own **Device
CA**. The web server is told to **require and verify** that certificate on the
scanner host. When a device presents a valid one, the front door reads the device
**serial** out of the certificate name (`CN = zebra-<serial>`) and passes it to
Laravel as the trusted header `X-Scan-Cert-CN`. Laravel looks the device up by that
serial in `scan_devices` and acts as it. No token, no login, no enrolment link. A
request without a valid certificate is refused during the TLS handshake — Laravel
never runs.

```
Zebra (holds cert)  --TLS + client cert-->  Apache (scan.kryptone.ai)
                                              │  verifies cert against the Device CA
                                              │  reads CN  →  X-Scan-Cert-CN: zebra-<serial>
                                              ▼
                                            Laravel  →  ScanDevice where serial = <serial>
                                                     →  Auth::setUser(actor) + TenantContext
```

This is standard **mutual TLS (mTLS)** over a **PKI** — the same mechanism behind
every `https://` padlock, except we also use the *client-certificate* half, which
most sites skip.

---

## 2. Two certificates, opposite jobs

Do not confuse them. They are issued by different authorities and live in
different places.

| Certificate | Proves | Issued by | Direction | Lives on |
|---|---|---|---|---|
| **Server cert** (`/etc/letsencrypt/live/scan.kryptone.ai/`) | "I am really scan.kryptone.ai" | Let's Encrypt | server → device (normal HTTPS) | the server |
| **Device cert** (`zebra-<serial>.p12`) | "I am really an approved handheld" | **our own Device CA** | device → server (**the mTLS part**) | the handheld's Android keystore |

Let's Encrypt **cannot** issue device certificates — it only signs public server
names. That is why the Device CA exists.

---

## 3. How the check works, layer by layer

**The certificate check is NOT Laravel middleware.** It happens at the Apache
`mod_ssl` TLS layer, *before* PHP runs. Laravel only reads the result.

**Layer 1 — Apache `mod_ssl` (the gatekeeper, at handshake time).**
`SSLVerifyClient require` + `SSLCACertificateFile device-ca-prod.pem` make Apache
demand a client certificate and **cryptographically verify** it against the CA
(signed by us? not expired? within `SSLVerifyDepth`?). Results land in env vars:
`SSL_CLIENT_VERIFY` (`SUCCESS`/`NONE`/`FAILED`), `SSL_CLIENT_S_DN_CN`
(= `zebra-<serial>`). No valid certificate → Apache refuses the connection with a
TLS alert; **Laravel never runs**.

**Layer 2 — Apache `mod_headers` (pass the name inward, safely).**
```apache
RequestHeader unset X-Scan-Cert-CN
RequestHeader set   X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"
```
`unset` deletes any client-injected copy (anti-spoof); `set … expr=SUCCESS` writes
the CN **only** when the certificate actually verified. The header is therefore
either a verified device name or absent — it cannot be faked from outside.

**Layer 3 — Laravel routing (`routes/api.php`).**
The scan routes use **only `throttle`** (`throttle:120,1` for scans,
`throttle:60,1` for `device-check`). There is **no `auth:sanctum`** — these are
public, because the *device* is the credential — and no custom certificate
middleware.

**Layer 4 — `SpiPutawayScanController::device()` (CN → device → tenant).**
1. `deviceFromCert()` reads `X-Scan-Cert-CN`, strips `zebra-` → serial → `ScanDevice::where('serial', …)`.
2. Not found → 401; suspended/retired → 403.
3. Resolve actor = `enrolled_by ?: created_by` → a real `User` **inside the device's client**. No valid actor → 403 `device_unclaimed`.
4. `Auth::setUser($actor)` (this request only; no session, no token).
5. `TenantContext::fromUser($actor)` sets `client_id` — and `branch_id` unless the actor is a `client_admin`/`client_user`, who see the whole client.

**The whole chain:**
```
mod_ssl verifies cert → mod_headers sets trusted X-Scan-Cert-CN →
throttle → controller device() → CN→serial→ScanDevice → Auth::setUser + TenantContext → scan runs
```

The expensive, security-critical check is done once by Apache at connection time;
Laravel never trusts the network, only a header Apache guarantees.

---

## 4. Environments

Each environment has its **own scanner hostname and its own Device CA**, so a test
handheld cannot scan production.

| | Dev | Production |
|---|---|---|
| ERP host | `dev.kryptone.ai` | `kryptone.ai` |
| **Scanner host** | `scan-dev.kryptone.ai` | **`scan.kryptone.ai`** ✅ live |
| Device CA it trusts | `CBC Device CA` | **`CBC Device CA Prod`** |
| App path | — | `/var/www/html/Cross_Border_Command` |
| `STICKER_URL` | `https://scan-dev.kryptone.ai` | `https://scan.kryptone.ai` |

Local development uses `tls-proxy.cjs` (a small Node front door) instead of Apache;
see §10.

### Why a separate hostname and not a path

`SSLVerifyClient require` is decided **during the TLS handshake**, before Apache
knows the URL path. Requiring it on only `/ps/`, `/putaway-scan`, `/api/scan/*` of
the main host needs the handshake re-done mid-connection — **TLS renegotiation,
removed in TLS 1.3**, which is what Chrome on Android speaks. So the requirement
must apply to a whole listening endpoint. Options considered:

| option | verdict |
|---|---|
| path-scoped `require` on the existing host | **rejected** — breaks under TLS 1.3 |
| existing host, `SSLVerifyClient optional` + per-path check | works, but every visitor's handshake asks for a certificate, staff included |
| existing host on port 8443 | works, but non-443 ports get blocked by guest Wi-Fi / carrier proxies, and the port is baked into every printed label |
| **separate hostname on 443** | **chosen** — no impact on staff, always reachable, shortest stable label URL |

---

## 5. The files in this folder

| File | What it is | Secret? | Goes where |
|---|---|---|---|
| `device-ca.pem` | **Dev Device CA certificate** (public). CN `CBC Device CA`, ~10 years. | No | dev server / local proxy |
| `device-ca-key.pem` | Dev CA **private key** — signs dev device certs. | **YES** | never on a server you can avoid |
| `device-ca-prod.pem` | **Production Device CA certificate** (public). CN `CBC Device CA Prod`, valid to 2036. | No | production server (`SSLCACertificateFile`) |
| `device-ca-prod-key.pem` | Production CA **private key**. Whoever holds this can mint a valid device. | **YES — `chmod 600`** | ideally offline; see §9 |
| `*-cert.pem` | A device's certificate (public). CN `zebra-<serial>`, ~5 years. | No | bundled into its `.p12` |
| `*-key.pem` | That device's **private key**. | **YES** | bundled into the `.p12`, then delete the loose copy |
| `zebra-<serial>.p12` | **The install bundle** = cert + key + password, in the PKCS#12 format Android needs. | **YES** | copied to the device, installed, then deleted everywhere |
| `*.srl` | Serial counter openssl writes while signing. Bookkeeping. | No | stays next to the CA |
| `tls-proxy.cjs` | **Local dev** front door (Node, TLS + mTLS → `php artisan serve`). Never runs on a server. | No | local only |
| `cbc.pem` / `cbc-key.pem` | Local **mkcert** dev server cert for `192.168.1.84`/localhost. **Not used in production.** | key is secret | local only |

> **`.gitignore` excludes `/storage/certs/*.pem` and `*.p12`.** A `git pull` can
> never carry a key onto a server — which is why a fresh deploy shows only
> `README.md` and `tls-proxy.cjs` there. Everything else is copied by hand.

---

## 6. Production setup — what was actually done

In order. Paths are production's (`/var/www/html/Cross_Border_Command`).

### 6.1 DNS

```
scan.kryptone.ai.    A    20.55.246.20      # same server as kryptone.ai
```

No new server, no second deployment — just another vhost over the same
`DocumentRoot`.

### 6.2 TLS certificate for the scanner name

```bash
sudo a2enmod ssl headers rewrite
sudo certbot certonly --apache --cert-name scan.kryptone.ai -d scan.kryptone.ai
```

### 6.3 Production Device CA + the first device certificate

Generated **on the server** (see §9 for the trade-off):

```bash
cd /var/www/html/Cross_Border_Command/storage/certs

openssl genrsa -out device-ca-prod-key.pem 2048
chmod 600 device-ca-prod-key.pem
openssl req -x509 -new -nodes -key device-ca-prod-key.pem -sha256 -days 3650 \
  -out device-ca-prod.pem -subj "/CN=CBC Device CA Prod/O=CrossBorderCommand/C=IN"
```

### 6.4 The scanner vhost

`/etc/apache2/sites-available/scan.kryptone.ai.conf`:

```apache
<VirtualHost *:443>
    ServerName scan.kryptone.ai
    DocumentRoot /var/www/html/Cross_Border_Command/public

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/scan.kryptone.ai/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/scan.kryptone.ai/privkey.pem

    # ---- Mutual TLS: require a device cert signed by our production Device CA ----
    SSLCACertificateFile  /var/www/html/Cross_Border_Command/storage/certs/device-ca-prod.pem
    SSLVerifyClient       require
    SSLVerifyDepth        1

    # Never trust a client-supplied copy; set it ONLY from the verified cert.
    RequestHeader unset X-Scan-Cert-CN
    RequestHeader set   X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"

    # This host exists for the handheld only — anything else goes to the scan page
    # rather than exposing the ERP login on a scanner host.
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/(putaway-scan|ps/|api/scan/|api/scan-devices/enroll|login|api/login|build/|images/|fonts/|storage/|manifest\.json|sw\.js|favicon)
    RewriteRule ^ /putaway-scan [R=302,L]

    <Directory /var/www/html/Cross_Border_Command/public>
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/scan-error.log
    CustomLog ${APACHE_LOG_DIR}/scan-access.log combined
</VirtualHost>
```

```bash
sudo a2ensite scan.kryptone.ai && sudo apache2ctl configtest && sudo systemctl reload apache2
```

### 6.5 Close the side door on the ERP host

Without this, the same routes answer on `kryptone.ai` with **no certificate at
all**, and the whole mTLS setup is bypassable. In `kryptone-le-ssl.conf` (and the
`:80` vhost), inside `<VirtualHost>`:

```apache
    # Scanner surface lives on scan.kryptone.ai, which requires a device certificate
    <LocationMatch "^/(ps/|putaway-scan|api/scan/)">
        Require all denied
    </LocationMatch>
```

Note the trailing slash in `api/scan/` — it deliberately does **not** match
`/api/scan-devices`, so admin device management stays reachable on the ERP.

### 6.6 PHP behind Apache only

PHP-FPM must listen on `127.0.0.1` (or a unix socket), with its port firewalled.
If the app can be reached *around* Apache, anyone can send `X-Scan-Cert-CN` by hand
and skip the certificate entirely. **Apache verifying the certificate is worthless
if the app is reachable around Apache.**

```bash
sudo ss -lntp | grep -Ei "php|fpm"      # expect 127.0.0.1 or a socket
```

### 6.7 Point the printed labels at the scanner host

```env
STICKER_URL=https://scan.kryptone.ai
```

```bash
php artisan config:cache
php artisan tinker --execute="echo config('inventory.sticker_url').PHP_EOL;"
```

**Do NOT set `STICKER_SECRET`.** The frontend signs labels with a hardcoded
default (`putAwayStore.ts`); any other value makes every genuine label fail its
signature check.

Labels already printed with a different host keep pointing there forever — reprint
after changing this.

---

## 7. Issuing a certificate for a handheld

### When you need one

- a new handheld joins the floor
- a device's certificate is nearing expiry (~5 years)
- a device was lost/stolen **and** you want the replacement to be a different identity
- the environment's CA changed (e.g. dev CA → prod CA)

### The rule that matters

**The serial inside the CN must equal the `serial` on the device's `scan_devices`
row.** That is the only link between the certificate and the database. `CN =
zebra-26013524701106` ⟷ `scan_devices.serial = '26013524701106'`.

### Commands (run where the CA private key is)

```bash
cd /var/www/html/Cross_Border_Command/storage/certs
SERIAL=26013524701106

openssl genrsa -out z-$SERIAL-key.pem 2048
openssl req -new -key z-$SERIAL-key.pem -out z-$SERIAL.csr \
  -subj "/CN=zebra-$SERIAL/O=CrossBorderCommand/C=IN"
openssl x509 -req -in z-$SERIAL.csr -CA device-ca-prod.pem -CAkey device-ca-prod-key.pem \
  -CAcreateserial -out z-$SERIAL-cert.pem -days 1825 -sha256
openssl pkcs12 -export -in z-$SERIAL-cert.pem -inkey z-$SERIAL-key.pem \
  -out z-$SERIAL.p12 -name "Kryptone Zebra" -passout pass:<THE PASSWORD>
rm -f z-$SERIAL.csr

openssl x509 -in z-$SERIAL-cert.pem -noout -subject -issuer -dates   # verify
```

On Windows Git Bash use `//CN=...\O=...` (the leading `//` stops path mangling);
on Linux use `/CN=.../O=.../C=IN` as above.

### The `.p12` password — what it is and how to choose it

- It encrypts the **private key inside the `.p12` file**, nothing else. It is typed
  **once**, on the handheld, at install time. It is never used again — not by the
  app, not by Apache, not at scan time.
- Its only job is to protect the file **in transit**: Slack, email, a download link,
  a USB stick. Once Android has imported the key into its credential store, the
  file and its password are dead weight.
- Choose something you can type on a handheld keyboard and share over a *different*
  channel than the file itself. Avoid characters that are awkward on Android.
  A per-batch password is fine; a per-device password is better if devices are
  handed out by different people.
- Current pilot device uses `Kryptone@2026`.
- **Delete the `.p12` from the device and from any chat/email after install.** If
  the file leaks *with* its password, it can be installed on another device.

### What is inside the `.p12`

```
zebra-<serial>-cert.pem   the device certificate (public)   CN=zebra-<serial>
zebra-<serial>-key.pem    its private key (secret)
```
plus the password, in the PKCS#12 container format Android requires. A `.pem` pair
cannot be installed as an Android user credential — that is the only reason the
`.p12` exists.

---

## 8. Installing on the handheld (Zebra / Android)

### Getting the file onto the device

The `.p12` must reach the handheld somehow. Any of these work:

- **USB** — connect, set USB mode to *File Transfer*, drop it in `Download`.
- **Via the server** (what we used) — publish it briefly under a random name on the
  **ERP** host (the scanner host can't serve it: it demands the very certificate you
  are installing), then delete it immediately:
  ```bash
  NAME=d-$(openssl rand -hex 10).p12
  cp z-26013524701106.p12 /var/www/html/Cross_Border_Command/public/$NAME
  chmod 644 /var/www/html/Cross_Border_Command/public/$NAME
  echo "https://kryptone.ai/$NAME"
  # ... after the device installs it ...
  rm -f /var/www/html/Cross_Border_Command/public/$NAME
  ```
  The random name and the instant delete matter: for those minutes a private key is
  publicly downloadable.
- **Email / Slack** to an account openable on the device, then delete the message.

### Installing it

1. **Settings → Security → Encryption & credentials → Install a certificate**
2. **VPN & app user certificate** — **not** "CA certificate". It is a device
   *identity*; choosing CA puts it in the wrong store and Chrome will never offer it.
3. Pick the `.p12` from **Downloads**, enter the password.
4. Name it **Kryptone Zebra**.
5. **Delete the `.p12` from Downloads.**
6. Remove any older entry under **User credentials** that was signed by a retired CA,
   or the picker shows two identical-looking choices.

### The certificate prompt on Android

Chrome asks which certificate to present **once per origin per browser session** —
roughly one tap per shift, not per scan. It reappears after a reboot, after Chrome
is force-stopped (including swiping it from Recents), after clearing Chrome data, and
separately for each hostname (dev vs prod).

**It cannot be auto-selected on Android.** Chrome's `AutoSelectCertificateForUrls`
policy only works with certificates Chrome itself provisioned; it cannot read the
Android OS keystore where a `.p12` lives. To remove the prompt entirely there are
only two routes:

- a thin **WebView wrapper app** that answers `onReceivedClientCertRequest()` from
  `KeyChain` — no prompt ever, and it can be locked as the device's home app; or
- drop browser mTLS in favour of the **device token** the scan page still supports
  (`X-Scan-Device`), trading a non-exportable key for a copyable string.

To make the prompt rarer: turn **off battery optimisation for Chrome**, and tell
operators not to swipe Chrome out of Recents.

---

## 9. Where the CA private key should live

The production CA key was generated on the server for convenience. That is a
trade-off: anyone who obtains `device-ca-prod-key.pem` can mint a certificate that
production will accept.

Mitigations, in order of preference:

1. **Move it off the box once devices are issued.** Verification needs only
   `device-ca-prod.pem`; the key is needed solely to sign a *new* device. Copy it to
   secure storage (encrypted), then `shred -u device-ca-prod-key.pem` on the server.
2. If it stays, keep `chmod 600`, root-only, and never back it up to anywhere
   world-readable.
3. Never commit it (`.gitignore` already prevents this).

---

## 10. Local development

Apache's job is done by `tls-proxy.cjs`, a small Node front door:

```bash
php artisan serve --host=127.0.0.1 --port=8001      # backend, internal only
node storage/certs/tls-proxy.cjs                     # front door on :8000 (TLS + mTLS)
```

It requires the client certificate on the scanner paths (`/ps/`, `/putaway-scan`,
`/api/scan/putaway`, `/api/scan/device-check`), verifies it against `device-ca.pem`,
strips any client-sent `X-Scan-Cert-CN`, and sets it from the verified certificate.
Everything else is reachable without a certificate.

The local server certificate is an **mkcert** dev cert (`cbc.pem`) covering
`192.168.1.84` and `localhost`. A handheld testing locally must trust the mkcert
root CA, or Chrome will warn on every load. Production needs none of this — Let's
Encrypt is already trusted by Android.

`public/hot` must not exist when testing: it is written while `npm run dev` runs and
makes every page load assets from the Vite dev server. Blank pages are usually this.

---

## 11. The `scan_devices` row — the half that is not cryptography

The certificate proves *which device*. The database row decides *what that device
can see and who it acts as*. Both must be right or scans fail with confusing
messages.

| Column | Must be | Why |
|---|---|---|
| `serial` | exactly the CN minus `zebra-` | the only link from certificate to row |
| `client_id` | the client that owns the boxes | box lookup is `SpiBox::where('client_id', $device->client_id)` |
| `enrolled_by` *or* `created_by` | a **user inside that client** | the device acts as this person: put-away author **and** branch scope |
| `status` | `active` | `suspended`/`retired` are refused even with a valid certificate |

**Branch scope** comes from that user via `TenantContext::fromUser()`:
`client_admin`/`client_user` → the whole client; anyone else → their own branch
(plus rows with `branch_id` null). So a device bound to a branch-4 user cannot see
a task in branch 6.

Setting it without the enrolment flow is a single statement — the certificate
remains the only credential:

```bash
php artisan tinker --execute="DB::update('update scan_devices set client_id=2, created_by=10, enrolled_by=10, enrolled_at=now() where id=1');"
```

Never create a second row with the same serial: the lookup is
`where('serial', …)->first()`, so which device answers becomes arbitrary.

---

## 12. Verifying a setup

From any machine with an OpenSSL-backed curl (Windows curl is Schannel and rejects
PEM client certs):

```bash
# Which server cert is served, and which client CA is demanded
echo | openssl s_client -connect scan.kryptone.ai:443 -servername scan.kryptone.ai 2>&1 \
  | grep -iE "subject=|Acceptable client certificate CA names" -A2

# Without a certificate → refused at the handshake
curl https://scan.kryptone.ai/putaway-scan -o /dev/null -w "no cert: %{http_code}\n"

# With one → 200
curl --cert z-26013524701106-cert.pem --key z-26013524701106-key.pem \
     https://scan.kryptone.ai/putaway-scan -o /dev/null -w "with cert: %{http_code}\n"

# The ERP must be unaffected, and must refuse the scanner paths
curl https://kryptone.ai/ -o /dev/null -w "erp: %{http_code}\n"                    # 200
curl https://kryptone.ai/putaway-scan -o /dev/null -w "erp scan path: %{http_code}\n"  # 403
```

Expected on production: acceptable CA `CN=CBC Device CA Prod`; no-cert →
`TLSV13_ALERT_CERTIFICATE_REQUIRED`; a certificate from a *different* CA →
`TLSV1_ALERT_UNKNOWN_CA`.

---

## 13. Troubleshooting — message → cause

| What the handheld shows | Cause |
|---|---|
| Connection error / "certificate required" | no certificate installed, or installed as *CA certificate* instead of *VPN & app user certificate* |
| `TLSV1_ALERT_UNKNOWN_CA` | the certificate is signed by a CA this environment does not trust (dev cert against production, or the CA was rotated) |
| *"This device is not authorised to scan."* (401) | no `scan_devices` row whose `serial` matches the CN |
| *"This device has been suspended."* (403) | row exists, `status` is `suspended`/`retired` |
| *"This device has no enrolled user."* (403) | `enrolled_by`/`created_by` points at no user, or at a user outside the device's `client_id` |
| *"That is not a Cross Border label."* | the scanned string is not one of our payloads |
| *"That label did not pass its signature check."* | `STICKER_SECRET` is set on the server; it must be absent |
| **"No box on this account matches that label."** | the label is valid, but that box belongs to a **different `client_id`** than the device row |
| *"No put-away initiated for B-00x."* | right client, but no put-away row — or the task is in a **branch the device's actor cannot see** |
| *"That is a rack label. Scan the shelf label — …"* | the deepest assigned level is a shelf; a rack label does not prove the operator stood at it |
| Nothing happens when the trigger is pressed | DataWedge: profile disabled, Barcode input off, Hardware trigger off, or QR decoder unticked |
| The string types in but nothing submits | DataWedge → Keystroke output → **Action key character** must be **Carriage return** |

---

## 14. Turning a device off, replacing a certificate, expiry

- **Lost or stolen device:** in **Inventory → Scan Devices**, set it to **Suspended**
  or **Retired** → it stops scanning immediately, even with a valid certificate.
  This is the revocation mechanism; there is no CRL.
- **Replacing a certificate** (expiry, or a CA rotation): re-issue with §7 using the
  **same serial**, install the new `.p12`, remove the old entry from the device's
  User credentials. The old certificate keeps working until it expires unless the
  device row is suspended — so suspend if the old one leaked.
- **Rotating the CA:** generate the new CA, re-issue every device certificate from
  it, point `SSLCACertificateFile` at the new CA, reload Apache, then install the new
  `.p12` on each handheld **in the same sitting** — the moment Apache reloads, every
  old certificate is rejected.
- **Validity:** Device CA ~10 years, device certificates ~5 years. Let's Encrypt
  server certificates renew automatically every 90 days via certbot.

---

## 15. Known gaps

- **The label signature is not an HMAC.** `StickerKey::sign()` reproduces an FNV-1a
  fold from `putAwayStore.ts` so PHP-printed labels validate in the frontend
  simulation. Anyone who reads that function can mint a label that passes. The
  certificate is what actually protects the endpoint; the signature only catches
  damaged or foreign labels. Replace both sides together when the real signing lands.
- **No CRL / OCSP.** Revocation is the `status` column on `scan_devices`, which is
  checked after the TLS handshake. A stolen `.p12` is refused by the app, not by Apache.
- **The `.p12` is a file.** If it leaks with its password it can be installed on
  another device. It still removes the "any phone can use the printed URL" problem,
  because no secret is in the label. For hardware-bound, non-copyable keys the
  alternative is WebAuthn (not implemented).
- **Labels are environment-bound.** The hostname is inside every QR, so a carton
  labelled on dev will never scan on production. Print from the environment you will
  scan in.
- **Stage 04 does not raise tasks from the UI.** The "Submit for Zebra Verification"
  button builds a `ZT-…` code in React and never calls the server; put-away
  allocation, manual confirmation and scan tasks must be created through the API
  (`/putaway/assign` → `/putaway/{row}/scan-task`) until that is wired.

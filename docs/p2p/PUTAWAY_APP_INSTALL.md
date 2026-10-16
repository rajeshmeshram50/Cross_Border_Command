# Put-Away Scanner — installing it on a handheld

How to get `/putaway-scan` onto a warehouse device as an installed app, on a
server and for local testing.

Audience: whoever deploys this. Assumes shell access to the server and the
ability to edit `.env`.

---

## 1. What this is

A device-authenticated page at **`/putaway-scan`** where a warehouse operator
scans a box label and a location label to confirm a put-away. It is not part
of the logged-in SPA shell — the floor does not log in for every carton.

It runs in any browser. Installing it is optional and only buys you fullscreen
(no address bar), an icon, and an orientation lock.

---

## 2. Chrome will not offer "Install" unless all three are true

| | why |
|---|---|
| **HTTPS with a trusted certificate** | `localhost` is exempt. A LAN IP like `192.168.1.84` is **not**. A self-signed cert is not enough — it must chain to a CA the device trusts. |
| **`/manifest.json`** reachable, with `display: standalone` and icons | already in `public/manifest.json` |
| **A service worker** with a `fetch` handler | already in `public/sw.js` |

Miss any one and Chrome offers *"Create shortcut"* instead — a bookmark that
opens in a normal tab, address bar and all. It still works; it just isn't an
app.

The last two ship with the repo. **HTTPS is the one you have to provide.**

---

## 3. Server deployment (the normal case)

### 3.1 Serve over HTTPS

Any real certificate works — Let's Encrypt, a commercial cert, or one issued
by your own internal CA if the devices already trust it.

```bash
sudo certbot --nginx -d warehouse.example.com
```

### 3.2 Tell Laravel it is behind a terminator

Required whenever TLS is terminated by nginx/Apache/a load balancer rather
than by PHP. Already present in `bootstrap/app.php`:

```php
$middleware->trustProxies(
    at: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    headers: Request::HEADER_X_FORWARDED_FOR
        | Request::HEADER_X_FORWARDED_HOST
        | Request::HEADER_X_FORWARDED_PORT
        | Request::HEADER_X_FORWARDED_PROTO,
);
```

Add your proxy's address to `at:` if it is outside those ranges.

**This is not cosmetic.** Without it Laravel reads the scheme off the
connection it can see — plain HTTP from the proxy — and builds every absolute
URL as `http://`. Assets 404, and **anything signed is signed against the
wrong URL and fails validation on the way back in** (quotation and proforma
PDF links, onboarding links).

Make sure the proxy actually sends the headers:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
```

### 3.3 Set the label host

```dotenv
STICKER_URL=https://warehouse.example.com
```

Then:

```bash
php artisan config:clear
```

**Read this before printing anything.** The QR on a box or rack label encodes
a full URL, so this hostname is physically on the carton. Change it later and
every label already stuck to a rack points at the old address. Labels printed
before a change keep working only as long as the old host resolves.

If `STICKER_URL` is unset it falls back to `APP_URL`, which on most
installations points at the Blade host and not at wherever the SPA is served.
Set it explicitly.

### 3.4 Build and deploy

```bash
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate
php artisan config:cache && php artisan route:cache
```

**`public/hot` must not exist in production.** Vite writes it while
`npm run dev` is running, and it makes Laravel point every asset at the Vite
dev server on port 5173. If it is present, the page loads and renders nothing.

```bash
rm -f public/hot
```

### 3.5 Check before handing it to the floor

```bash
curl -sI https://warehouse.example.com/manifest.json   # 200
curl -sI https://warehouse.example.com/sw.js           # 200
curl -s  https://warehouse.example.com/putaway-scan | grep -o 'rel="manifest"'
curl -s  https://warehouse.example.com/putaway-scan | grep -o 'https://[^"]*build[^"]*'
```

Every asset URL must read `https://`. If any says `http://`, step 3.2 is not
working.

---

## 4. Local / LAN testing (no public domain)

Chrome will not install from `http://192.168.x.x`. To test the real installed
experience on a LAN you need a certificate the handheld trusts.

**Do not use a tunnel** (cloudflared/ngrok) for this unless you accept that
your development server, database and every API become reachable from the
public internet.

### 4.1 Issue a locally-trusted certificate

```powershell
winget install --id FiloSottile.mkcert
mkcert -install
cd C:\xampp\htdocs\Cross_Border_Command\storage\certs
mkcert -cert-file cbc.pem -key-file cbc-key.pem 192.168.1.84 localhost 127.0.0.1
```

Use **your** machine's LAN IP, not the example.

### 4.2 Run PHP behind the TLS proxy

`php artisan serve` cannot do TLS, so `storage/certs/tls-proxy.cjs` terminates
it and forwards. PHP moves to a second port so a plain-HTTP listener remains
for step 4.4.

```powershell
php artisan serve --host=0.0.0.0 --port=8001

$env:TLS_PORT="8000"; $env:TARGET_PORT="8001"
node storage\certs\tls-proxy.cjs
```

Port 8000 answers **both** protocols: it peeks the first byte, sends TLS
handshakes (`0x16`) to the certificate and everything else a `301` to the
`https://` URL. Chrome defaults to `http://` when you type a bare IP, so
without that redirect you get `ERR_EMPTY_RESPONSE` with nothing explaining it.

### 4.3 Open the firewall

```powershell
New-NetFirewallRule -DisplayName "CBC 8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "CBC 8001" -Direction Inbound -LocalPort 8001 -Protocol TCP -Action Allow
```

A missing rule shows as a **white screen** on the phone — the HTML loads from
an allowed port, then every asset times out on a blocked one.

### 4.4 Trust the CA on the handheld

```
http://<server-ip>:8001/cbc-ca.crt
```

Download, then **Settings → Security → Encryption & credentials → Install a
certificate → CA certificate**. Android warns it is not from a known
authority; that is expected.

This step must be plain HTTP. You cannot fetch the CA over a certificate the
device does not trust yet.

### 4.5 Point labels at the HTTPS origin

```dotenv
STICKER_URL=https://192.168.1.84:8000
```

```bash
php artisan config:clear
```

---

## 5. Install on the device

1. Open `https://<host>/putaway-scan`
2. Chrome **⋮** → **Install app**

If it says *"Create shortcut"* instead, one of the three requirements in §2 is
missing. Check `chrome://inspect` → DevTools → **Application → Manifest**,
which lists exactly what failed.

---

## 6. Enrol the handheld

The device authenticates with a credential, not a user session.

1. **Sign in first** at `https://<host>/login`.
   Whoever is signed in becomes the author of every put-away this device later
   confirms (`scan_devices.enrolled_by`). Skip this and it falls back to
   `created_by` — the admin who added the device row, not the person moving
   boxes.
2. Add the device under **Inventory → Scan Devices** and open its enrolment
   QR.
3. Scan it on the handheld, or open the link directly:
   `https://<host>/putaway-scan/enroll#<credential>`
4. The screen confirms *"This handheld is now signed to you."*

### Origin matters

The credential lives in `localStorage`, which is **per origin**. Moving
between `http://host:8000` and `https://host:8000`, or changing host or port,
means re-enrolling. The credential does not travel.

### Rotation

Rotating a credential in Scan Devices invalidates the installed one
immediately, and the plaintext is never stored — only its hash. If a device
stops working after a rotation, issue a new enrolment link; the old one cannot
be recovered.

---

## 7. Daily use

```
/putaway-scan     list of pending tasks, newest last
  tap a task  →  scan the box  →  scan the location  →  Complete
```

Either half may be scanned first, and the location accepts **zone, rack or
shelf**. Scanning the shelf satisfies its rack and zone automatically — a
shelf cannot be anywhere but its own rack. Only the deepest assigned level
finishes the location.

Three refused scans in a row resets the task to the box, on the assumption
the operator is at the wrong rack.

---

## 8. When it stops working

| symptom | cause |
|---|---|
| **White screen** | `public/hot` exists — Vite is running. Stop it, delete the file, `npm run build`. |
| **`ERR_EMPTY_RESPONSE`** | plain HTTP hitting a TLS port, and the dual-protocol proxy is not running. |
| **"Install" not offered** | not HTTPS, certificate untrusted, or manifest/service worker not reachable. DevTools → Application → Manifest. |
| **"This device is not enrolled"** | credential rotated, or the origin changed. Re-enrol. |
| **Scans work but the wrong person is recorded** | nobody was signed in at enrolment; it fell back to `created_by`. |
| **Assets 404 with `http://` URLs on an HTTPS site** | `trustProxies` not configured, or the proxy is not sending `X-Forwarded-Proto`. |

---

## 9. Files involved

| path | |
|---|---|
| `public/manifest.json` | name, icons, `display: standalone`, `start_url` |
| `public/sw.js` | service worker — **caches nothing**, deliberately |
| `resources/views/welcome.blade.php` | manifest link, theme-color, worker registration |
| `bootstrap/app.php` | `trustProxies` |
| `config/inventory.php` | `sticker_url`, `sticker_secret` |
| `storage/certs/tls-proxy.cjs` | local-only TLS front door |

### Why the service worker caches nothing

A cached task list would show work already done. A cached scan response would
tell an operator a box was accepted when the server never saw it. It exists
only because Chrome requires a `fetch` handler before offering Install, so it
is the smallest honest one: every request goes to the network.

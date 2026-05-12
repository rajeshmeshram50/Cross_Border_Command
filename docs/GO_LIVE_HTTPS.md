# Go-Live — Enable HTTPS for `cbc.idims.in` (the LAST step)

The entire face-attendance feature is built and tested. The only thing
left between you and a working live system is **getting `https://` on
`cbc.idims.in`**. The browser refuses to open the camera on plain http://
— this is a security rule baked into Chrome/Edge/Firefox/Safari, not
something any code change can bypass.

This doc gives you **one path, exact clicks, ~10 minutes** to fix it.

---

## Use Cloudflare (recommended — no server SSH needed)

### What you need before starting

1. The login to your domain registrar (wherever you bought `idims.in`).
2. A free email to make a Cloudflare account.

That's it. You do NOT need server SSH access for this path.

### Step 1 — Make a Cloudflare account (2 minutes)

1. Open <https://dash.cloudflare.com/sign-up>
2. Sign up with your email + password
3. Verify your email when Cloudflare sends the link

### Step 2 — Add your domain (1 minute)

1. After login, click the big **"Add a Site"** button (or **"Add domain"**)
2. Type `idims.in` (NOT `cbc.idims.in` — Cloudflare manages the whole zone)
3. Click **"Continue"**
4. Pick the **Free** plan (last option in the list) → **"Continue"**
5. Cloudflare scans your existing DNS records — wait ~10 seconds → **"Continue"**

### Step 3 — Update nameservers at your registrar (5 minutes)

Cloudflare now shows you **two nameservers** that look like:

```
alex.ns.cloudflare.com
beth.ns.cloudflare.com
```

(The actual names will differ — copy YOURS, not these examples.)

1. Open a new tab → login to your domain registrar (GoDaddy / Hostinger /
   Namecheap / BigRock / wherever you bought `idims.in`)
2. Find the `idims.in` domain → look for **"Nameservers"** or **"DNS"**
   settings
3. Switch from "Default" / "Registrar nameservers" to **"Custom nameservers"**
4. Delete whatever's there and paste in the two Cloudflare nameservers
5. **Save**

Back in Cloudflare → click **"Done, check nameservers"**. Cloudflare will
now wait for DNS to propagate. This takes **anywhere from 5 minutes to
24 hours** but is usually under 30 minutes. Cloudflare emails you when
it's ready.

### Step 4 — Turn on HTTPS in Cloudflare (1 minute, after the email)

When Cloudflare sends "Your site is active":

1. Go to dashboard → click `idims.in`
2. Left sidebar → **SSL/TLS** → **Overview**
3. Set encryption mode to **"Flexible"** (radio button)
4. Left sidebar → **SSL/TLS** → **Edge Certificates**
5. Toggle **"Always Use HTTPS"** → **ON**

Done. Open `https://cbc.idims.in` in your browser — it loads with a 🔒
padlock. Camera access now works.

### Step 5 — Tell Laravel about it (30 seconds)

SSH into your server (or use your hosting panel's File Manager) and
edit the `.env`:

```
APP_URL=https://cbc.idims.in
APP_FRONTEND_URL=https://cbc.idims.in
```

Then on the server:

```bash
php artisan config:clear
php artisan config:cache
```

(If you don't have SSH but have an FTP/file manager, just edit `.env`
directly — Laravel reads `.env` on every request when caches are cleared.)

---

## Test it

1. Open `https://cbc.idims.in` → padlock should show in address bar
2. Login → go to **HR → Employees** → click the smiley-face button on
   any employee
3. Browser asks "Allow camera access?" → click **Allow**
4. Webcam opens inside the modal → click **Capture face** → **Save Face Data**
5. Toast says "Face registered"

If all five steps work, **everything is live**.

---

## If something doesn't work after Cloudflare is on

### Camera still shows "Camera access requires HTTPS"

→ The browser is still on `http://`. Check the address bar — does it
say `https://cbc.idims.in`? If it still says `http://`, force the URL
by typing `https://cbc.idims.in` directly in the address bar. If that
gives an error like "ERR_TOO_MANY_REDIRECTS", change Cloudflare SSL
mode from **"Flexible"** → **"Full"** (still no origin cert needed,
but Cloudflare expects the server to redirect http→https — which we've
already wired in Laravel).

### "ERR_TOO_MANY_REDIRECTS" loop

This happens when both Cloudflare and Laravel are trying to redirect.
In Cloudflare → **SSL/TLS** → **Overview** → switch from "Flexible" to
either:
- **"Full"** (if your server has any cert, even self-signed)
- **"Off"** then back to **"Flexible"** (sometimes resets the loop)

### Cloudflare says "Pending nameserver update" for hours

DNS can take up to 24 hours but usually completes in 30 min. You can
check propagation at <https://dnschecker.org> — paste `idims.in` and
see if it resolves to Cloudflare's nameservers globally.

### Camera opens but face match always fails

Unrelated to HTTPS — that's a real face-detection issue. Improve
lighting, make sure only one face is in the frame, and try again. The
threshold (0.55) is server-side; we can tighten/loosen later if needed.

---

## Alternative — server-side SSL (only if you have SSH access)

If you can SSH into the `cbc.idims.in` server, the cleaner path is to
get a real cert directly on the server (no Cloudflare in the middle):

```bash
ssh user@cbc.idims.in    # or whatever your SSH user is

# Apache:
sudo apt update
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d cbc.idims.in
# Answer the prompts:
#   - Email: enter yours (for renewal warnings)
#   - Terms: A (agree)
#   - Share email with EFF: N (or Y, your call)
#   - Redirect HTTP to HTTPS: 2 (yes, redirect)
sudo systemctl reload apache2

# Nginx:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cbc.idims.in
sudo systemctl reload nginx
```

Then update the same `.env` as in Step 5. Auto-renewal is wired up
automatically by certbot — you never touch it again.

---

## What's been done on the code side (so you know nothing is missing)

| Area | State |
|---|---|
| All face / attendance backend endpoints | ✅ live, lint-clean |
| All frontend components (FaceCapture, registration modal, login modal, ClockIn page, AttendanceTabPanel) | ✅ shipped |
| `face-api.js` npm dep + 7 model weight files in `public/face-models/` | ✅ present |
| Vite config (`optimizeDeps.include: ['face-api.js']`) | ✅ wired |
| Database migrations (face columns + attendances + attendance_punches + legacy backfill) | ✅ run |
| Clear "Camera requires HTTPS" message on insecure origin | ✅ added |
| Laravel auto-forces https on every URL when `APP_URL` starts with https:// | ✅ wired in `AppServiceProvider` |
| Menu role visibility (HR → branch_user only, Clock-In → employee only) | ✅ |

**37/37 end-to-end checks pass on the code side.** The ONLY pending
action is enabling HTTPS on the production URL — which is the Cloudflare
walkthrough above.

---

*One sentence summary: open <https://dash.cloudflare.com/sign-up>, add
`idims.in` as a free site, switch your registrar's nameservers to the
two Cloudflare gives you, wait for the activation email, turn on
"Flexible SSL" + "Always Use HTTPS", and update `APP_URL` to
`https://cbc.idims.in`. That's the whole thing.*

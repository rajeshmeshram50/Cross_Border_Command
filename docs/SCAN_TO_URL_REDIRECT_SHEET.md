# Scan → Open Website (Direct Redirect) — Feasibility Sheet

**Question:** When any scanner scans a sticker/QR, can it open this project's website directly? Can this be set in the device settings?

**Short answer:** **Yes, it can.** Most of it is **already built** in this project. How it works depends on the *type* of scanner. A phone camera opens the link by itself. A Zebra / laser / USB scanner does **not** open links by itself; it only "types" the text. For those you need either one device setting or the scan page kept open.

---

## 1. What the project already does (verified in code)

| Item | Where | Status |
|---|---|---|
| QR on the label is a **full URL**, not plain text: `https://<host>/ps/CBC1.<tenant>.<TYPE>.<id>.<nonce>.<sig>` | [StickerKey.php](../app/Services/Inventory/StickerKey.php) | Built |
| Box sticker QR uses that URL | [SpiBoxController.php:422](../app/Http/Controllers/Api/P2p/SpiBoxController.php#L422) | Built |
| Rack / Shelf / Zone / Warehouse label QR turns into the URL (from `RC:7`, `SH:41`…) | [BaseInventoryController.php:399](../app/Http/Controllers/Api/Inventory/BaseInventoryController.php#L399) | Built |
| Opening `/ps/<key>` loads the **Put-away Scan** page | [App.tsx:810-817](../resources/js/components/App.tsx#L810-L817), [PutawayScan.tsx](../resources/js/pages/p2p/putaway/PutawayScan.tsx) | Built |
| Old `/s/<key>` labels also still open (Inventory demo page) | [App.tsx:800](../resources/js/components/App.tsx#L800) | Built (demo data) |
| Unknown phone scans the label → opens our site → **"Device blocked"** (no device credential) | `POST /api/scan/device-check`, `scan_devices` table | Built |
| Device enrolment: scan the enrol QR → `/putaway-scan/enroll#<token>` saves the credential on that device | [PutawayScan.tsx:127](../resources/js/pages/p2p/putaway/PutawayScan.tsx#L127) | Built |
| Zebra **DataWedge keyboard input** (scan types text + ENTER into the focused box) | [PutawayScan.tsx:17](../resources/js/pages/p2p/putaway/PutawayScan.tsx#L17), L290-330 | Built |
| Host printed on the QR comes from `STICKER_URL` (falls back to `APP_URL`) | [config/inventory.php:14](../config/inventory.php#L14) | Built, **not set in .env** |

So the "scan → open website" flow is in place. What remains is mostly **configuration**, plus the gaps in section 4.

---

## 2. Does it open directly? By scanner type

| Scanner type | What happens on scan | Opens website by itself? | What you need |
|---|---|---|---|
| **Android / iPhone camera app, Google Lens** | Reads the QR and shows the link → tap → browser opens | **Yes** (one tap; some phones open it straight away) | Nothing. The QR already holds a URL. |
| **Zebra TC2x / TC5x handheld (DataWedge)** | DataWedge **types** the scanned text as keystrokes into whatever field has focus | **No**, not by default | **Option A (recommended):** keep the `/putaway-scan` page open in Chrome. The page reads the typed text, no redirect needed. **Option B:** use a device setting (section 3). |
| **USB / Bluetooth gun scanner on a PC (HID keyboard)** | Types the text + ENTER | **No** | Keep the scan page open with the cursor in the box. Or use the address-bar prefix trick (section 3-C). |
| **Fixed / fingerprint device (eSSL)** | Different thing (attendance push to `/iclock/cdata`) | N/A | Not related to QR redirect. |

**Key point:** A scanner is just a camera or a keyboard. *Only camera apps* open URLs themselves. Hardware scanners type text. Opening a link with them is a **device setting** job, not a website job.

---

## 3. Device-setting options (for Zebra / hardware scanners)

### A. Kiosk mode: page always open *(recommended, zero code)*
1. On the Zebra, open Chrome → `https://<your-host>/putaway-scan`.
2. Enrol the device once (scan the enrol QR from **Inventory → Scan Devices**).
3. Add it to the home screen, or lock it with Zebra **Enterprise Home Screen / Android kiosk (screen pinning)**.
4. DataWedge profile for Chrome: **Keystroke output = ON**, **Send ENTER key = ON**.
5. Every scan now goes straight into the page. The full URL or the short code both work, because `normalizeScan()` / `StickerKey::parse()` accept both.

### B. DataWedge "Intent output" → opens the URL *(device setting, true redirect)*
In **DataWedge → Profile → Intent Output**:
- Intent action: `android.intent.action.VIEW`
- Intent delivery: **Start Activity**
- Turn **Keystroke output OFF** for this profile.

Each scan then opens the scanned URL in the browser, like a phone camera. *Test on the actual TC27 first.* Plain VIEW-intent behaviour varies by DataWedge version. If it doesn't work, use **Zebra Enterprise Browser** (it has a built-in "navigate on scan" option) or option A.

### C. Hardware-scanner address-bar trick *(PC gun scanners)*
Most Zebra/Honeywell guns can be programmed (by scanning their config barcodes from the manual) to add a **prefix** of `Ctrl+L` (or `F6`) and a **suffix** of `Enter`. The scan then types the URL into the browser's address bar and opens it. The browser window must have focus. This works, but it is fragile.

### D. Not possible
- Making a **random stranger's scanner** open our site without a URL in the code: impossible. The QR must contain the URL (ours already does).
- Forcing an iPhone/Android camera to open with **no tap**: controlled by the phone OS, not by us.

---

## 4. Gaps / things to fix before this works in production

| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | `STICKER_URL` **not set**; `APP_URL=http://localhost/Cross_Border_Command/public` | QR printed locally points to **localhost**. A phone scanning it opens *itself*, not the server. | Set `STICKER_URL=https://<prod-host>` in `.env`, run `php artisan config:clear`, reprint the labels |
| 2 | Box sticker in the invoice step prints **plain text** `BOX\|<id>\|<codes>\|<qty>` | Camera scan **does not open the site**. It only shows the text. Zebra keyboard mode still works. | Use `StickerKey::url()` output (as `SpiBoxController` does) |
| 3 | `PutawayStickerModal` QR = **raw box id** (`String(box.apiId)`) | Same as #2. No redirect. | Same as #2 |
| 4 | `kryptone.ai` and `www.kryptone.ai` are **separate origins** (no redirect between them) | A device enrolled on one shows "Device blocked" on the other | Add a 301 www → non-www redirect, or print/enrol on only one |
| 5 | Needs **HTTPS** | Phones warn about or block `http://` links. Chrome on Zebra may refuse | Use the prod HTTPS host in `STICKER_URL` |
| 6 | `/s/<key>` landing still runs on **demo data** (tenant `12` hardcoded in `putAwayStore.ts`) | Old `/s/` labels open the simulation, not real data | Print new labels with `/ps/` (already the default in `StickerKey::PATH`) |

Files for gaps #2 and #3: [BoxStickerModal.tsx:21](../resources/js/pages/p2p/purchase-management/invoice/steps/BoxStickerModal.tsx#L21), [PutawayStickerModal.tsx:122](../resources/js/pages/p2p/purchase-management/invoice/PutawayStickerModal.tsx#L122).

---

## 5. QA test cases

| ID | Steps | Expected |
|---|---|---|
| SR-01 | Set `STICKER_URL` to the prod host, print a rack label, scan it with a phone camera | Link shows the prod host → opens the Put-away Scan page |
| SR-02 | Same label, scanned by a **non-enrolled** phone | Page opens → **"Device blocked"** |
| SR-03 | Enrol the Zebra via the enrol QR, then scan the rack label in kiosk mode (3-A) | Code accepted in the page, no new tab |
| SR-04 | Zebra with DataWedge Intent VIEW (3-B), scan the box sticker | Browser opens `/ps/...` directly |
| SR-05 | Scan the **invoice-step box sticker** with a phone camera | **Currently FAILS**: shows plain text `BOX\|...` (gap #2) |
| SR-06 | Scan the `PutawayStickerModal` QR with a phone camera | **Currently FAILS**: shows a bare number (gap #3) |
| SR-07 | Enrol on `www.kryptone.ai`, scan a label printed for `kryptone.ai` | **Currently FAILS**: "Device blocked" (gap #4) |
| SR-08 | Label printed locally without `STICKER_URL`, scanned by a phone | Opens `localhost` → fails (gap #1, expected until configured) |
| SR-09 | Scan an old `/s/...` label | Opens the demo landing page (gap #6) |

---

## 6. Recommendation

1. **Phones:** nothing to change on the device. Fix gaps #1–#3 so every printed QR is a real HTTPS URL.
2. **Zebra handhelds:** use **kiosk mode (3-A)**. It is already supported, needs no redirect and is the most reliable. Use DataWedge Intent (3-B) only if you really need "scan anywhere → website opens".
3. **PC gun scanners:** keep the scan page open with the cursor in the box. Avoid the address-bar trick except for demos.

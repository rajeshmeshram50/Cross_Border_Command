# Zebra Devices (Printing & Scanning) — Functional Documentation

> What the Zebra flow does, the rules it enforces, and what each screen shows —
> without reading code.
> Audience: QA, BA, support, warehouse supervisors.
> Companion documents: API · Technical · Code Walkthrough (same folder).
> Device and server setup: [ZEBRA_DEVICE_SETUP_SHEET.md](../../ZEBRA_DEVICE_SETUP_SHEET.md),
> [ZEBRA_SERVER_SETUP.md](../../ZEBRA_SERVER_SETUP.md). Open bugs:
> [ZEBRA_SCAN_BUG_SHEET.md](../../ZEBRA_SCAN_BUG_SHEET.md).
>
> _Last updated: 2026-11-12._

---

## 1. The feature in one paragraph

Every carton received against a Supplier Invoice, and every warehouse location
it can go to, gets a **printed QR label**. When the back office wants proof
that a carton really reached its assigned shelf, it raises a **Zebra scan
task**. A warehouse operator carrying an enrolled **Zebra handheld** scans the
carton's label and the shelf's label; when both match the task, the system
records the box as **placed**. The handheld never logs in per carton — it
proves *which device it is* with a certificate installed on it, and acts as the
person who enrolled it. A personal phone that photographs a label is sent to
the same server and is refused.

---

## 2. Two halves: printing and scanning

| | Printing | Scanning |
|---|---|---|
| Who | Back-office / packing desk, logged in | Warehouse operator, on a Zebra |
| Where | SPI Stage 03 (box stickers), Inventory masters (location labels) | The scanner app, `https://scan.<domain>/putaway-scan` |
| Output | A PDF opened in the browser and printed | A put-away marked placed, plus a full scan log |
| Device | Any printer the desk prints to | Zebra TC2x / TC5x / TC7x with DataWedge (TC27 is the default model) |

**Not true:** the app does not drive a Zebra label printer directly. There is no
ZPL and no printer pairing. Labels are PDFs printed through the browser's
normal print dialog.

---

## 3. Where it lives

| Screen | Menu / URL | Who uses it |
|---|---|---|
| Box sticker | SPI → Stage 03 Packing → a box row → **Sticker** button; also Stage 04 review box | Packing desk |
| Location labels | Inventory Management → Warehouse / Zone / Rack / Shelf master → row → **QR** | Warehouse admin |
| Scan Devices | Inventory → **Scan Devices** (`/inventory/devices`) | Client admin |
| Handheld Screens | Inventory → **Handheld Screens** (`/inventory/handheld-guide`) | Anyone — a static picture of each handheld screen |
| Stage 04 put-away | SPI → Stage 04 → Step 03 → **Option 01 · Zebra verification** | Back office |
| Scanner app | `https://scan.<domain>/putaway-scan` (installed as **Put-Away** on the device) | Operator |
| Label landing | `https://scan.<domain>/ps/<key>` — what every QR opens | Anyone who scans a label |

> **Two scan pages exist. Only one is real.** `/inventory` (Put-Away Scan tab),
> `/inventory/stickers` (Sticker Sheet), `/inventory/scan-log` and `/s/<key>`
> are the older **simulation**: they work on sample data in the browser. The
> real flow is `/putaway-scan` and `/ps/<key>`. Do not raise simulation
> behaviour as a production bug.

---

## 4. Roles and access

| Action | Who can do it |
|---|---|
| Add / suspend / retire / rotate a device | Any logged-in user of the client (no module permission is checked — bug sheet DEV-01) |
| Print a box sticker or location label | Any logged-in user who can open the SPI / the master |
| Raise or cancel a Zebra task | Any logged-in user who can open the SPI (bug sheet S4-B-01) |
| Scan | An **active** enrolled device. No user login on the device |
| Who is recorded as doing the scan | The person who **enrolled** the handheld; if nobody has, the admin who **added** it |

A super-admin (no client) cannot manage devices — the API answers
*"Scan devices belong to a client; log in as a client user."*

---

## 5. Printing — the box sticker

### 5.1 When

At SPI Stage 03 (Packing), each packed box row has a **Sticker** button. It
opens a preview; printing downloads the PDF.

### 5.2 What is on it

Top to bottom, as [spi-box-sticker.blade.php](../../../resources/views/pdf/spi-box-sticker.blade.php)
lays it out:

| Block | Content |
|---|---|
| Head | **TEMPORARY PUTAWAY BOX** and a black condition chip (PERFECT CONDITION / MINOR / MAJOR / SEVERE DAMAGE) |
| Business reference | Shipment, Opportunity, Procurement · Proforma Invoice, Purchase Order, Supplier Invoice — each with its date · Customer, Consignee, Supplier codes |
| Box condition & product flags | Putaway box id (`PUT-B-003`), packing scenario (1→1, 1→many, many→1), box qty · dimensions L×W×H (cm), net / gross weight, condition · Cold chain (Yes + band / No), Hazardous (Yes/No + class), Stacking |
| Pictograms | Snowflake, hazard, fragile, no-stack — **only those that apply**; the QR shrinks to make room |
| Box location details | Warehouse (id / name), putaway location path, allocated date · WH type, zone, rack |
| QR | The signed sticker URL, large and centred, captioned with `PUT-B-003` |

Any reference that does not exist prints as **—**, never blank.

**Not on the label, by design:** the product name and the QR's URL as text.
A damaged QR is re-keyed from the `PUT-…` caption. (The controller still
computes a logo, a print number, a receiving panel and "box n of N" — the
current face does not print them.)

### 5.3 Rules

1. **Printing stamps the box as printed** (`sticker_printed_at`) and logs a
   `sticker_printed` activity on the SPI. The Print button calls the "mark
   printed" endpoint on every print; a plain download stamps only the first
   time.
2. A reprint carries **exactly the same QR** as the original. The code is
   derived from the box, not from a counter.
3. The QR identifies the box by its internal id, not by `B-003` — every
   invoice starts again at B-001.
4. Paper is **A4 portrait**, one page, framed. It is designed for a thermal
   head: no grey behind the QR.

---

## 6. Printing — location labels

Every warehouse, zone, rack and shelf has a **QR** action in its master. It
shows a preview (QR, title, details, the address path, handling flags) and
offers the PDF.

| Part of the label | What it shows |
|---|---|
| Header | WHAT this is (Warehouse / Zone / Rack / Shelf) + flags: COLD CHAIN, HAZARDOUS, INACTIVE, or NORMAL when none |
| QR | Large and centred — the signed URL |
| Code | The location's own code, under the QR, so a torn QR can still be read out |
| Path | Each level of the address in its own cell (Warehouse / Zone / Rack) |

Rules:

1. The preview and the PDF come from the same data — they cannot disagree.
2. Codes repeat across branches (three branches can each have `WH-001`), so the
   QR carries the row id; the printed code is for people.
3. Paper is **A4 portrait**, one page per label.
4. **Warehouse labels cannot be used for put-away.** Scanning one on the
   handheld answers *"That is not a Cross Border label."* Use zone, rack or
   shelf labels.

---

## 7. Labels and the server address

The QR holds a **web address** (`https://scan.<domain>/ps/…`), not plain text.

- A stranger's phone opens it, reaches our server, and is shown **Device
  blocked**. Nothing about the box, the product or the price is revealed.
- The address is taken from the `STICKER_URL` setting **at print time**.
  Change it and labels printed from then on point somewhere new; **labels
  already on cartons keep the old address** and must be reprinted.
- Labels carry a signature. An edited or forged label is refused with
  *"That label did not pass its signature check. Use the printed label."*
- Older labels (the earlier signature format, the `/s/` path, `SH:41` short
  codes and bare box numbers) are still accepted while the floor is reprinted.

---

## 8. Device management (Inventory → Scan Devices)

### 8.1 The form — Add device

| Field | Required | Notes |
|---|---|---|
| Serial | Yes | Exactly as printed on the device. Must match the certificate name `zebra-<serial>`. Unique within the company — *"This serial is already enrolled."* |
| Label | Yes | A name operators recognise — "Pack bench 2". *"Give the device a name operators will recognise."* |
| Model | No | Defaults to **TC27** |
| Branch | No | Free text, where the device lives. It is **not** a branch dropdown and does not scope anything |

On save the screen shows the **credential once**, as an enrollment QR and as
text. Scanning that QR with the handheld installs the credential in the
handheld's browser. It is never shown again — Rotate issues a new one.

### 8.2 The list

Columns: Device, Serial, Model, Branch, Status, Last seen, Actions. Header line:
*"N enrolled · N active · N blocked."* Active devices sort first.

### 8.3 Actions

| Action | Effect |
|---|---|
| **Suspend** | Device is refused on its next call — *"This device has been suspended. Contact your administrator."* This is how a lost handheld is stopped. Immediate; no server change needed |
| **Reactivate** | Back to active |
| **Retire** | Permanently out of use — *"This device can no longer scan."* History is kept |
| **Rotate** | New credential; the old one dies at once. Does not affect a device that signs in with its certificate |

There is no Delete button on the screen (the API has one).

### 8.4 Who the device acts as

The first time someone **logs in on the handheld** while it holds its
credential, the scanner page quietly binds the device to that person and shows
*"This handheld is now signed to you."* From then on every put-away it confirms
is recorded under their name. Until that happens, the admin who added the
device is recorded instead.

> Enrol the device while logged in as the **floor supervisor**, not a shared
> admin account — whoever is bound is the author of every scan.

---

## 9. The Zebra task — raising it (back office)

At SPI Stage 04, after a box has been **assigned** a location, Step 03 offers
two ways to confirm it:

| Option | What happens |
|---|---|
| 01 · Zebra verification | A **scan task** is created. The box stays *awaiting scan* until a handheld scans it |
| 02 · Manual confirmation | The operator states the box is there; placed immediately |

Rules for Option 01:

1. The operator must tick the acknowledgement — the shelf is **locked** for
   this box and cannot be changed while the task is open.
2. A location must already be assigned — *"Assign a location before sending it for verification."*
3. Only **one open task per box** — *"A task is already open for this box."*
4. A placed box cannot get a task — *"That box is already placed."*
5. The task gets a code **ZT-YYYYMMDD-NNN**, numbered per branch per day — the
   number people quote over a radio.
6. The task stays open for **8 hours** by default (1–72 allowed); the shelf
   lock lasts as long as the task.
7. **Cancel** closes the task only. The shelf **stays reserved and locked**,
   the box goes back to *draft*, and the screen offers manual confirmation on
   the same shelf.

---

## 10. The handheld — scanning rules

### 10.1 Screens (see Inventory → Handheld Screens)

| # | Screen | When |
|---|---|---|
| 1 | Pending tasks | Nothing in hand — every open task, where it goes, started or not |
| 2 | Scan the box | A task is open, the box is owed |
| 3 | Box verified | The box matched — its card opens: products, weights, flags |
| 4 | What's inside | Products expanded, with batch / lot / expiry |
| 5 | Walking the levels | Zone → rack → shelf progress |
| 6 | Ready to complete | Both halves matched |
| 7 | Queue mid-task | From the pending badge |
| 8 | Box cleared | Scans given back |
| 9 | Already put away | A placed box scanned again — full details, marked done |

Other states: **Device blocked** (not enrolled / suspended / retired),
**Could not start** (with Try again), **Checking this device…**.

### 10.2 How a put-away is proved

1. **Two halves: the box and the location.** Either order works:
   - box at the bench, then walk to the rack, or
   - scan the rack, then feed boxes from a trolley into it.
2. **Any level of the address counts** — zone, rack or shelf — but it must be
   *this task's* zone / rack / shelf. Scanning a shelf also ticks its rack and
   zone.
3. A **rackless (floor) zone** is finished by scanning the zone itself.
4. **The scan that completes the pair places the box.** No extra button press
   is needed; the screen shows the Done card with **Next box**.
5. Shelf 1, rack 1 and zone 1 are different places — the *kind* of label is
   checked before the number.

### 10.3 Scanning a location first

| Situation | What the handheld shows |
|---|---|
| Nothing is due there | What is in that location: boxes stored and on their way, weight used / free, its details, and the shelves or racks below with work owed |
| One box is due | *"Scan the box for RC-007-SH-02"* |
| Several are due | *"3 boxes due at RC-007 — scan one"* and the list of which boxes; tapping one scans it |

### 10.4 Refusals

Every refusal names the problem in a few words, with what to scan instead on
the line below (for example **Wrong location** — *Scan the shelf RC-007-SH-02*).

| Short text | Meaning |
|---|---|
| Wrong box | This task wants a different carton — the message names it |
| Wrong location | You are at a different place — the message names both |
| Wrong label | e.g. a rack label for a task with no rack |
| Box not found / Location not found | No such box / location on this account |
| Not this organisation | The box belongs to another company |
| Wrong branch for this device | The box belongs to another branch |
| Box not packed to an invoice | The label is genuine but the box is not packed under any SPI |
| No put-away for this box | No open task — the message says if it is allocated (raise a task or confirm by hand) |
| Already scanned | That location is already proved on this run |
| Location unavailable | Inactive, deleted, or in another warehouse |
| Not a Cross Border label | Not one of ours (includes warehouse labels) |
| Label failed its check | Signature did not verify — use the printed label |
| No answer from the server | Request took over 15 s (see §12) |

**Three refusals in a row** on a task wipe its scans: *"Three failed scans —
start again from the box."* A re-scan of an already-placed box does not count
against the attempts.

### 10.5 Timeouts and Clear box

- A half-finished run with **no scan for 5 minutes** (`SCAN_STALE_MINUTES`) is
  given up. The handheld counts down and returns to the queue with *"No
  scanning for 5 minutes, so that put-away was left. Tap it below to start it
  again."* Reading the product list does **not** reset the clock.
- A run that is untouched, or already complete, never times out.
- **Clear box** gives back every scan on the run; the task stays open for any
  device to pick up.

---

## 11. What the system records

| Record | Where it is seen |
|---|---|
| Every scan, pass and fail, with reason, device and person | Stage 04 → task → activity; box → Scan Logs popover |
| Each label's attempts folded together ("tried 3, refused 2") | Task activity → stickers |
| Idle resets, kept apart from operator mistakes | Task activity (`stale_reset`) |
| The placement — method `scan`, who, when | The put-away row and the SPI activity log (`putaway_confirmed`, *"Scanned on <serial>"*) |
| Sticker prints | SPI activity (`sticker_printed`), one row per logged print |

---

## 12. Business rules QA should never see broken

1. A handheld with no certificate and no credential can **never** reach a box —
   it sees **Device blocked**.
2. A **suspended** device is refused on its very next call.
3. A device of company A can **never** place, or read the contents of, company
   B's box — *Not this organisation*.
4. A box is placed **only** when both the box and a matching location of the
   same task are scanned.
5. The kind of a location label is checked before its number: a rack label is
   never accepted as the shelf with the same id.
6. A location in a different warehouse, or inactive, is refused even if its
   id is right.
7. Three refusals in a row reset the run back to the box.
8. A run idle for 5 minutes is dropped, and the screen **says so**.
9. An abandoned or cleared run leaves **no** half-placed box — nothing moves
   until the pair completes.
10. Only one open task per box, ever.
11. Cancelling a task does **not** release the shelf.
12. Reprinting a sticker produces the same QR, and the print is logged.
13. An edited label is refused with *"That label did not pass its signature check."*
14. The person recorded on a scanned put-away is the device's enrolled user.
15. The credential is shown once on Add / Rotate, then never again.

---

## 13. Statuses

### Device

| Status | On screen | Can scan |
|---|---|---|
| `active` | green **Active** | yes |
| `suspended` | amber **Suspended** | no — can be reactivated |
| `retired` | dark **Retired** | no |

### Zebra task

| Status | Meaning |
|---|---|
| `pending` | Open — on the floor queue |
| `scanned` | Done — the box is placed |
| `cancelled` | Closed from the back office; shelf still held |
| `expired` | Defined, but **nothing currently sets it** (see §14) |
| `failed` | Defined in the schema; not set by the current code |

### Put-away row (as it relates to the task)

`draft` (assigned, not confirmed) → `awaiting_scan` (task open) → `placed`.

---

## 14. Known gaps (do not raise as new bugs — they are logged)

| Gap | Effect |
|---|---|
| No task reaper | `expires_at` is set (8 h default) but no job marks tasks `expired`; an old task stays `pending` on the queue |
| No permission check on device admin or task routes | Any client user can manage devices and tasks (DEV-01, S4-B-01) |
| Device serial lookup is not company-scoped | Two companies registering the same serial collide; first match wins (SEC-04) |
| Unsigned short codes (`SH:41`, bare box ids) still accepted | Forgery-resistant only for signed labels; the device and company checks still apply (SEC-07) |
| Refusals before a task is known are not logged | e.g. an unknown box scanned from the queue leaves no activity row |
| Per-IP throttle | Many handhelds behind one Wi-Fi NAT share one limit — watch for 429 (SEC-13) |
| `Last enrolled` in the device list | Shows when the row was **added**, not when a person bound to it |

---

## 15. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **Device blocked** on a real Zebra | Cert not installed as *VPN & app user certificate*, wrong CA, or serial not on the list | [ZEBRA_DEVICE_SETUP_SHEET.md §4](../../ZEBRA_DEVICE_SETUP_SHEET.md) |
| **No answer from the server** after a break | Chrome dropped the TLS session and cannot show the certificate picker for a background call | The page navigates back to the queue once on its own; if it repeats, close the tab and reopen |
| Box scans fine, *Not this organisation* | Device row belongs to another client | Re-add the device under the right company |
| *No put-away for this box* | No task raised, or it was cancelled | Raise Option 01 again, or confirm by hand |
| Labels open the wrong server | Printed before `STICKER_URL` changed | Reprint |
| Wrong person on put-aways | Device bound to the wrong user | Log in on the handheld as the right person (it re-binds only when unclaimed — otherwise re-add the device) |
| Scan typed into the box but nothing happens | DataWedge not sending ENTER — the page auto-submits only a full signed key | Add the ENTER suffix in the DataWedge profile |
| 429 Too Many Requests | Shared per-IP throttle | Spread devices or raise the limit |

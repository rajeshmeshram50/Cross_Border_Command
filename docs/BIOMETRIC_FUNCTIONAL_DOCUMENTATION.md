# HRMS Biometric — Functional Documentation

> What the biometric features do, who can use them, what the screens are, and which business rules must never break.
> No code here — see the [Technical](BIOMETRIC_TECHNICAL_DOCUMENTATION.md) and [Code Walkthrough](BIOMETRIC_CODE_WALKTHROUGH.md) docs for internals, and the [API doc](BIOMETRIC_API_DOCUMENTATION.md) for endpoints.
> Audience: QA, HR super-users, product.
>
> _Last updated: 2026-09-04._

---

## 1. The feature in one paragraph

Cross_Border_Command records employee attendance from **two biometric sources**: a **browser face scan** (the employee opens the Clock-In page on any device with a camera and their face is matched server-side) and an **eSSL / ZKTeco fingerprint terminal** at the office door (the device matches the finger itself and sends only a User ID and a timestamp). Both write into the same daily attendance ledger, both display as a **BIOMETRIC** source on the HR Attendance sheet, and both feed payroll. The same face can additionally be used to **sign in** to the application instead of typing a password.

---

## 2. The two channels compared

| | **Face (webcam)** | **eSSL device (fingerprint)** |
|---|---|---|
| Where the employee stands | Anywhere with a browser + camera | At the fixed terminal |
| Who matches the biometric | Our server | The device |
| What identifies the person | The account they are logged into | Device **User ID** = the employee's **Attendance Number** |
| Enrolment | "Register Face" in the app, with a consent screen | Fingerprint enrolled on the terminal by an admin |
| Works offline | No — needs the app | Yes — the device buffers and forwards later |
| Also usable for login | ✅ Yes | ❌ No |
| Hardware needed | None | The terminal |
| Marked on the employee by | Face registered flag | `Time Tracking = Biometric` |

Both can be live at once. A branch typically runs the device as primary and keeps face as the fallback for field staff.

---

## 3. Roles and access

| Role | Register own face | Register someone else's face | Clock in by face | See HR Attendance | Import device punches | Manage terminals |
|---|---|---|---|---|---|---|
| Employee | ✅ | ❌ | ✅ | own record only | ❌ | ❌ |
| Branch user | ✅ | only with **edit** rights on Employees | ✅ | own branch only | ❌ | ❌ |
| Client user | ✅ | only with **edit** rights on Employees | ✅ | per permission | ❌ | ❌ |
| Client admin | ✅ | ✅ | ✅ | whole client | ✅ | ✅ |
| Super admin | — (usually no employee record) | ✅ | — | all clients | ✅ | ✅ |

Two rules worth remembering:

1. **Enrolling another person's face is an employee edit.** It hands someone a login credential, so it needs edit rights on the Employees module — a view-only user cannot do it.
2. **Importing punches is admin-only.** An import can create attendance for anybody in the company, so an ordinary employee can never reach it. The office connector runs as a dedicated admin service account.

The **Biometric Devices** screen and its route ride on the same permission as the **Attendance** screen (`hr.attendance`) — if a user can open Attendance, they can see the devices list.

---

## 4. Screens

| Screen | Path | Who | What it does |
|---|---|---|---|
| **Clock In** | `/clock-in` | Employees | Opens the camera, shows the correct single button (Check In *or* Check Out), a live "worked today" timer, and the day's punch timeline |
| **Register Face** modal | Profile → Security, and HR → Employees row action | Self / admins | Two steps: consent disclosure, then capture. A green dot on the employee row means already enrolled |
| **Sign in with Face** | Login page | Anyone enrolled | Email + face capture instead of a password |
| **HR Attendance** | HR → Attendance | HR / admins | The daily sheet: per-employee status, in/out times, punch timeline, source badge, month KPIs and calendar |
| **Biometric Devices** | HR → Time & Pay → Biometric Devices (`/hr/devices`) | Client admins | Register / edit / remove terminals, see `Last seen`, and run **Import Punches** |
| **Employee Profile → Attendance** | Employee profile | Self / HR | That employee's month: present days, late marks, missing biometric, leaves, plus history |

---

## 5. Face enrolment — the functional rules

1. **Consent is mandatory.** The modal explains, in plain language, that we store a mathematical signature rather than a photograph, that it can be revoked at any time, and that it is not shared. The Save button does nothing until the box is ticked, and the server refuses the request without it.
2. **The capture must contain exactly one face.** No face → "No face detected". Two faces → "Multiple faces detected". A too-dark or too-distant capture is rejected before it is ever sent.
3. **One face, one employee.** If the captured face already belongs to another employee in the company, enrolment is refused and the message names that employee. This includes disabled employees, so deactivating someone does not free their face for re-use.
4. **Re-enrolment is allowed and expected** (new glasses, beard, better lighting). It replaces the signature but **keeps the original consent date**.
5. **A disabled or terminated employee cannot be enrolled** — reactivate them first.
6. **Revoking deletes more than the signature.** Revoke wipes the signature *and* clears every historical match score on that employee's attendance. The attendance itself — who was present when — is retained; only the biometric measurement disappears. The consent-given and consent-revoked dates are both kept as the audit trail.

---

## 6. Face clock-in — the functional rules

The Clock-In page shows **one** button, because the system already knows what should happen next.

1. **First punch of the day is always a Check In**, then it strictly alternates: in → out → in → out.
2. **You cannot clock in twice.** Trying gives "You need to clock OUT next, not IN — you are already clocked in." The reverse case has its own message.
3. **A failed face match does not record anything.** The message asks for better lighting and a fully visible face.
4. **Not enrolled?** The page says so and points at face registration.
5. **Before joining date?** Refused, naming the joining date.
6. **Inactive employee?** Refused with "Please contact HR."
7. **An unclosed day is auto-closed** for the worked-hours calculation — at the shift end + 1 hour, or 21:00 if no shift is configured. The on-screen timer stops at exactly the same moment the server stops counting, so the two never disagree. For overtime-eligible employees there is no auto-logout; leaving the day open forfeits the overtime instead.
8. **Location is recorded but not enforced.** Latitude/longitude are stored with each punch; there is no geo-fence yet, so a punch from home is not blocked.

---

## 7. Face login — the functional rules

1. The employee types their **email** and captures their face. The email is still required — the face is not a lone credential.
2. The match is **stricter than for attendance**, because a false match here would hand over a whole session.
3. If the email belongs to **more than one organisation** and the face matches in several, the app asks **which organisation** to sign in to rather than guessing.
4. **Active accounts are preferred.** A disabled look-alike account can never shadow the real one the employee is trying to reach.
5. All the ordinary login gates still apply: account active, organisation active, branch active, plan valid.
6. **Failed face attempts count towards the same lockout as failed passwords** — five failures locks the email for fifteen minutes, whichever method was used. (The lockout is controlled by the Security setting; it is not on by default.)
7. If no account for that email has a face on file, the message is deliberately generic — it does not reveal whether the email exists.

---

## 8. Device attendance — the functional rules

### 8.1 The setup rule everything depends on

> The **User ID enrolled on the terminal** must equal the employee's **Attendance Number** in the app.

If Ravi is `101` in the app, he must be User `101` on the device. Get this wrong and his punches appear as "unmatched" — reported, never guessed at.

Also required before go-live:

- Attendance Numbers are **unique within the company** (two people sharing one would put punches on the wrong person).
- The employee's **joining date** is correct — earlier punches are refused.
- The employee's `Time Tracking` is set to **Biometric**, so HR knows who to expect punches from.
- The device clock is correct **IST with DST off**, and at least one person is a device Super Admin so the menu can be opened.

### 8.2 How punches reach the app — three modes

| Mode | How | Delay | Used when |
|---|---|---|---|
| **A — File import** | HR exports the log to a pen-drive or via eTimeTrackLite, then uploads it on the Biometric Devices screen | Batch — whenever HR uploads | Proving the setup; a site with no network |
| **B — Office connector** | A small program on an office PC polls the device and sends punches to the app | About a minute | **Recommended for production** — nothing is exposed to the internet |
| **C — Device push** | The device itself sends punches to the app over the internet | Live | Real-time needed across many sites |

Whichever mode is used, the punches are processed by exactly the same rules, so the resulting attendance is identical.

### 8.3 What the import guarantees

- **The In/Out keys on the device do not matter.** Operators forget to press them, so the app ignores the device's own In/Out flag entirely and re-derives the sequence from the times. The raw code is still stored, for audit only.
- **Uploading the same file twice changes nothing.** Duplicates are counted and skipped.
- **Nothing is ever silently dropped.** Every row is reported as imported, duplicate, unmatched, or errored with a reason.
- **Times are converted from the device's local time**, so a 09:03 punch shows as 09:03.
- **Punches land under the employee's own branch**, taken from the employee record — not from which terminal they used.
- **Leading zeros are forgiven.** Device `001` still finds employee `1`.

### 8.4 What the import refuses, and why

| Refused row | Reason shown | What to do |
|---|---|---|
| Unknown User ID | listed in `unmatched` | Set that Attendance Number on the right employee, then re-import |
| Employee terminated / resigned, or attendance tracking off | "employee not attendance-eligible" | Expected — a reused device number must not land on someone who left |
| Punch before joining | "before date_of_joining" | Expected |
| Corrupt time (e.g. `25:00:00`) | "unparseable timestamp" | Bad export — the row is refused rather than silently landing on the wrong day |
| Month's payroll already **locked and paid** | "payroll for this month is locked (paid) — post an adjustment in the next cycle" | Expected — a paid payslip cannot be rewritten; correct it as an adjustment next cycle |

### 8.5 The consequence nobody should forget

**Attendance is money.** A device import changes what people are paid, so the app recalculates affected payslips automatically — but only for runs that are still **draft or generated**. Approved, paid or locked runs are left alone, and a punch that would land in a locked month is refused outright. Practical rule for HR: **import before finalising payroll**.

---

## 9. Terminal registry (Biometric Devices screen)

Each physical terminal is registered once, with:

| Field | Meaning |
|---|---|
| **Serial** | The number printed on the device. This is what identifies it when it pushes punches — and the **only** thing that does |
| **Name** | A human label, e.g. "Front door — Andheri" |
| **Branch** | Which branch the terminal sits in (must belong to the same company) |
| **Timezone** | Used to convert the device's clock to ours; defaults to Asia/Kolkata |
| **Allowed IPs** | A comma-separated list of source addresses allowed to push. **Leave it blank and any address is accepted** |
| **Active** | Turn a terminal off without deleting its history |
| **Last seen** | When the device last contacted us — the fastest way to prove it is reaching the server |

Two behaviours QA should expect:

- An **unregistered or inactive serial** is answered politely but **nothing is stored**. There is no error on the device screen. Always confirm in the app, never on the terminal.
- A terminal **never changes company**. Its branch, name, timezone and IP list can be edited; its owning company cannot.

---

## 10. Statuses shown on the HR sheet

| Status | When |
|---|---|
| **Present** | The day has attendance |
| **Late** | First check-in is more than **10 minutes** after the shift start (measured in IST) |
| **Weekly Off** | The employee's configured off day, with no attendance |
| **Holiday** | A company holiday for that employee's holiday group, with no attendance |
| **Absent** | A working day with no attendance at all |
| **Missing Out** | The day ends on an unpaired check-in |

Working on a rest day beats the rest-day label: if there are punches on a holiday or weekly off, the day reads Present (or Late) rather than Holiday.

---

## 11. Business rules QA should never see broken

1. **Punch direction alternates strictly** — in → out → in → out. This holds even if punches arrive out of order (an import landing before existing punches); the whole day is re-derived by time.
2. **A day's check-out only appears once the day is closed.** While the last punch is an open check-in, the employee is still clocked in and Out stays empty.
3. **Face match thresholds:** attendance **0.55**, login **0.50**, duplicate-face detection **0.50**. Login is the strictest because it grants a session.
4. **One face belongs to exactly one employee**, including disabled ones.
5. **Consent is required to enrol, and revoking erases the biometric measurements**, not the attendance.
6. **Attendance Numbers are unique per company.**
7. **A punch never crosses tenants.** It is attributed via the employee record (import) or the registered serial (device push) — never from the uploaded file or the pushed payload.
8. **A branch user sees only their own branch**, even if they pass another branch's id by hand.
9. **Imports are idempotent.**
10. **A locked (paid) payroll month rejects new punches.**
11. **Nothing is silently dropped** — every rejected row comes back with a reason.
12. **The device is always answered "OK"**, even when its data is refused. Verification happens in the app, not on the terminal.

---

## 12. Known gaps (do not raise as bugs)

| Gap | Note |
|---|---|
| **No liveness check** | A printed photo or a phone screen could satisfy the face match. A blink / head-turn challenge is on the backlog |
| **No geo-fence** | Location is captured on every punch but not enforced |
| **Signature not encrypted at rest** | Stored as plain numbers in the database; encryption is on the backlog |
| **No retention policy** | Signatures are not auto-wiped after a period of inactivity |
| **The device's serial is its only credential (Mode C)** | Anyone who knows the serial and can reach the endpoint could push punches; the IP allow-list is the practical control today. This is why Mode B is recommended for production |
| **Night shifts** | A shift crossing midnight is not modelled in day resolution |
| **No automatic device clock sync** | The device clock is set manually |
| **The uniqueness index on Attendance Number is not yet applied everywhere** | Enforced in the form; the database index is pending resolution of one duplicate |

---

## 13. Quick troubleshooting for HR

| Symptom | Most likely cause | Fix |
|---|---|---|
| "Loading face-recognition models…" never finishes | The model files are missing on the server | Deployment issue — raise it with the developer |
| "Camera permission was denied" but no prompt appeared | The site is not on HTTPS, or the browser has camera blocked for the site | Use the HTTPS address; reset the browser's camera permission |
| Employee's device punches never appear | Attendance Number does not match the device User ID | Check the import summary's unmatched list, fix the number, re-import |
| Times are out by five and a half hours | The device clock or the terminal's timezone is wrong | Fix the device clock / terminal timezone, then re-import |
| Everyone at one branch is missing | The terminal is unregistered, inactive, or its allowed-IP list blocks the office | Check Biometric Devices → Last seen |
| An import reported success but payroll is unchanged | The payroll run was already approved or paid | Post an adjustment in the next cycle |
| Face login says "not available for this account" | No face enrolled for any account with that email | Enrol from Profile → Security, or ask an admin |

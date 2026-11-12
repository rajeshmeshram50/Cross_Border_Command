# CredVault Import / Export — Functional Documentation

Jira GT-77. Screen name: **Import & Recovery**.

## 1. The feature in one paragraph

Import & Recovery is how credentials enter and leave CredVault in bulk. A user
picks one of the 25 credential categories (Login, Credit Card, Bank Account …),
fills that category's Excel or CSV sheet, and uploads it. Every row is checked
exactly as the Add credential form would check it; the user then reviews the
**Accepted** and **Discarded** rows and saves the accepted ones into **My
Vault**. The same screen downloads a **backup** of My Vault, Team Vault or both,
as Excel or CSV, optionally with passwords and optionally locked with an Excel
password. A backup's Excel tabs are laid out like the import sheets, which is
what makes it a *recovery* file. Separately, the **Team Vault** screen has an
**Export Credentials** popup that downloads what its table lists as a CSV.
Every import, backup and export is recorded in a history table with its own
code (IM-, BK-, EX-) and in the Audit Logs. The file itself is never stored.

---

## 2. Where it lives

| | |
|---|---|
| Menu | CredVault → Vault Administration & Security → **Import & Recovery** |
| URL | `/credentials-vault/import-recovery` (`?tab=import` / `?tab=backup`) |
| Header quick actions | **Import Bulk Credentials** → `?tab=import` · **Download Backup** → `?tab=backup` |
| Dashboard | the "backup" / "import-recovery" links open the same screen |
| Export popup | CredVault → Team Vault → Export (button on the Team Vault page) |

### 2.1 The screen

```
Import & Recovery
"Bring credentials into My Vault in bulk, and download password-locked
 backups whenever you need them."
┌──────────────────────────────────────────────────────────────────────┐
│ [Import Bulk Credentials  n] [Download Credentials Backup  n]        │
│                                    [search…]   [Import data] /       │
│                                                [Download backup]     │
├──────────────────────────────────────────────────────────────────────┤
│ Imported Credentials History           |  Downloaded Backup History  │
│ (the table of the active tab, with a pager and "Rows per page")      │
└──────────────────────────────────────────────────────────────────────┘
```

The tab badge is the history's total. The button right of the search
changes with the tab: **Import data** or **Download backup**.

### 2.2 The popups

| Popup | Opens from | Title |
|---|---|---|
| Import data | **Import data** | "Import data" |
| Import by category | the drop zone in Import data | "Import by category" |
| Review | a successful check of the sheet | "Review {Category} import" |
| Download backup | **Download backup** | "Download backup" |
| Export Credentials | Team Vault | "Export Credentials" |

---

## 3. Import — step by step

```
Import data ──drop / click──▶ Import by category ──upload──▶ Review ──Save──▶ history
   │ (guide, samples)            │ category *                 │ Accepted / Discarded
   │                             │ sample for the category    │ Back → category popup
   │                             │ check the sheet (veil)     │ 410 → category popup
```

### 3.1 Import data (the guide)

Three numbered steps and an upload card:

| Step | Text on screen | Notes |
|---|---|---|
| 1 | **Download the sample file** — Excel / CSV buttons | Excel = one workbook with all 25 tabs + "How to fill". CSV = a **.zip** of 25 CSVs + `how-to-fill.csv` |
| 2 | **Fill in your credentials** — shows `name url username password category notes` | **Stale.** Those are the old any-type columns; the samples from step 1 have the category layouts |
| 3 | **Upload & review** — "Imports go to **My Vault** · Personal" | True |

Upload card: "Excel or CSV — up to 2,000 rows". Clicking the drop zone opens
**Import by category** empty; dropping a file opens it with that file
waiting.

> **Not true on screen:** "Moving from a browser or password manager? Upload
> its CSV export as it is — Chrome, Edge, Firefox, LastPass, 1Password,
> Bitwarden and KeePass are recognised automatically." That recognition
> belongs to the old generic import, which the screen no longer calls. A
> Chrome CSV uploaded under *Login* is refused because its headers
> (`name, url, username, password`) do not include **Credential Name**.
> (By reading `ImportTemplate::mapHeaders()`; not run.)

### 3.2 Import by category

While the categories load the popup shows a **shimmer** in its own shape
(label, select, hint, drop zone). If they fail: "Could not load the
categories" with **Retry**.

| Field | Required | Source | Behaviour |
|---|---|---|---|
| Category | Yes | `GET /imports/types` | Options read "{Label} — {Group}". Hint: "The same 25 categories as the Add credential form. Every row in the file is checked as that category's form checks it." |
| Sample for the category | — | `GET /imports/sample?type=` | Appears once a category is picked: "Need the {Label} sheet? Download its sample — the “{Sheet}” layout with two example rows" |
| File | Yes | — | Disabled until a category is picked ("Select a category first"). Excel `.xlsx` or CSV `.csv`, up to 2,000 rows |

Picking a category while a file is already waiting starts the check at once.
Picking another file restarts it.

**While the sheet is checked** a blurred veil covers the whole popup with
"Checking your {Label} sheet…"; nothing (category, samples, Cancel, ×) can be
changed until it ends.

Errors appear under the drop zone:

| Case | Message |
|---|---|
| Wrong extension (checked in the browser) | "“{file}” is not a supported file. Use Excel (.xlsx) or CSV (.csv)." |
| Still-locked Excel backup, or old `.xls` | "This Excel file is password-protected or in the old .xls format. Open it in Excel (with the backup password if it is a locked backup), remove the password under File > Info > Protect Workbook > Encrypt with Password, and Save As .xlsx — then upload again." |
| Wrong category's sheet | "The sheet is not a {Label} sheet — missing column(s): … Download the sample for this category and keep its header row." |
| Workbook without this category's tab | "This workbook has no “{Sheet}” tab. Pick the category of the tab you filled, or upload that tab's sheet." |
| Empty sheet | "The sheet has no rows to import. Add one credential per row under the header." |
| Too many rows | "The sheet has {n} rows. Import up to 2000 at a time." |

The full list is in the API document §3.1.

### 3.3 How the sheet is laid out

One row per credential under a header row. Columns, in order:

1. **Credential Name \*** — 2 to 150 characters, unique for this type in your vault
2. the category form's own fields (files excepted) — a header ending in ` *` is required
3. **2FA** (Yes / No) — categories with a 2FA switch
4. **Registered Email**, **Registered Phone**, **Recovery Key** — where the form has them
5. **Risk** (Low / Medium / High; empty = the category default, Critical defaults become High)
6. **Rotation (days)** (30 / 60 / 90 / 180; empty = the policy default) — password categories only
7. **Notes** — up to 5,000 characters

Headers are matched by label or by field key, ignoring case, spaces and
underscores, so a hand-typed header works. Columns not in the layout are
ignored and named in the Review popup. Dates may be typed `31/03/2028` or be
Excel date numbers. Yes-values for 2FA: yes, y, true, 1, on, enabled.

### 3.4 Review

Title "Review {Category} import"; sub-line "{file} · “{tab}” tab · N rows
checked · accepted rows are saved to My Vault".

| Tab | Holds |
|---|---|
| **Accepted Records** | valid rows that are not duplicates — exactly what Save sends |
| **Discarded Records** | rows that failed a check (every reason), and valid rows that are duplicates |

Accepted columns: Sr. No · Sheet Row · Credential Name · Strength · Check.

| Strength column | When |
|---|---|
| Strength meter (Fair / Good / Strong) | the category's main secret is a password |
| "No password" | it is not (card number, passport number, seed …) |

| Check flag | Meaning |
|---|---|
| **Weak password** | below the policy minimum — still imported, then listed in Password Health |
| "Attach the {Label} in the form after the import." | a required file the sheet cannot carry |
| **Ready** | neither of the above |

Discarded reasons for duplicates are written by the screen:

- "Already in your vault — {CRD-…} · {name}." (`dup`)
- "Repeated in this file — the first row with this name is imported." (`dupfile`)

Footer: "{n} will be saved · {m} discarded · {w} with weak passwords".
**Save {n} Records** is off when nothing is accepted. While saving, the veil
reads "Saving {n} records…".

| Result | Screen |
|---|---|
| Saved | All popups close, the Import tab is selected, a toast shows the server's message, history reloads |
| Review older than 30 minutes, or already used | Toast "This review has expired" / "Upload the file again to import it." — back to Import by category |
| Anything else | Toast "Could not import" + the server message; the Review stays open |

### 3.5 What saving does

Each accepted row is saved as if it had been typed into the category's Add
form: a new **CRD-** code, encryption, strength, risk, rotation, the duplicate
check. A row the form still refuses is recorded as failed. The import writes
**one** "Credentials imported" audit entry, not one per row (CS-1479).

---

## 4. Imported Credentials History

"Every import into My Vault — who ran it, which file and what was checked".

| Column | Value |
|---|---|
| Sr. No | position across pages |
| Import ID | `IM-0001` … |
| Imported On | date and time |
| Imported By | initials, "You" or the name, the role line |
| File | file name; under it "{source} · into {vault}" (source = "{Category} sheet") |
| Format | Excel / CSV / TSV |
| Imported | rows saved |
| Skipped | every row of the file that was not saved (failed + duplicates + unpicked) |
| Weak | saved rows with a weak password |
| Duplicates | every `dup` / `dupfile` row in the file |

Not shown on screen although stored: the **failed** count, the failed list
(row, name, reasons), the category and the status. An import that saved
nothing is recorded as status *failed* but looks like an ordinary row with
Imported = 0. The success toast's "see the failed list" points at a list the
screen cannot open (`GET /imports/{id}` is API-only).

---

## 5. Downloaded Backup History

"Every backup download — format, scope and whether it was password-locked".

| Column | Value |
|---|---|
| Backup ID | `BK-0001` … |
| Downloaded On / By | as above |
| Format | Excel / CSV / JSON |
| Scope | My Vault / Team Vault / All vaults |
| Items | count; "—" for a failed attempt |
| Size | e.g. "21 KB"; "—" for a failed attempt |
| Protection | **Password locked** / **Not locked** |
| Status | **Downloaded** / **Failed** (hover shows the reason) |

Failed attempts listed here: only "Passwords did not match" and "Account
password incorrect". Other refusals are not recorded.

### 5.1 Search and paging (both tabs)

The search box filters **only the rows of the page on screen** — the API has
no search. Import search covers Import ID, file, source, format, who, vault.
Backup search covers Backup ID, format, scope, who, file name, and the words
"failed" / "downloaded" / "password locked" / "not locked". Paging and "Rows
per page" are server-side (10 by default, up to 100).

The search box sits in its own form with autofill turned off, so a browser
filling a saved login elsewhere on the page never types an email into it.

---

## 6. Download backup

### 6.1 The form

| # | Section | Choices | Default |
|---|---|---|---|
| 1 | Choose a format | **Excel** .xlsx "Opens in Excel & Google Sheets" · **CSV** .csv "For other password managers" | Excel |
| 2 | Choose what to include | **My Vault** · **Team Vault** · **All vaults**, each with "{n} credentials" | My Vault |
| 2 | Include passwords | switch | On |
| 3 | Lock the file with a password | switch — off and disabled for CSV: "A CSV file can’t hold a password — choose Excel to lock the backup" | On |
| 3 | Backup password \* · Confirm password \* | shown only when locked; eye buttons; strength meter; "Passwords match" / "Passwords don’t match" | — |

Warnings under section 3:

- Locked: "Keep this password safe — CredVault does not store it, so a lost password cannot be recovered."
- Not locked, with passwords: "Without a lock, the passwords in this file can be read by anyone who gets it."
- Not locked, no passwords: "This file has no passwords, but it still lists your accounts and usernames."

Button: "Download {Excel|CSV} Backup[ · Locked]". It is disabled until the
vault counts have loaded; if they fail, "Could not load the backup options —
… Retry" appears. While working, the veil reads "Preparing your {Format}
backup…".

### 6.2 What goes in each vault

| Choice | Holds |
|---|---|
| My Vault | credentials you own |
| Team Vault | Team-scope credentials you have rights over |
| All vaults | both |

**Never** included: credentials that are only *shared with you*, and
**Critical Vault** credentials — *"A backup is the My Vault / Team Vault
file: Critical Vault credentials never leave in one."*

### 6.3 The rules

| Rule | What the user sees |
|---|---|
| Only Excel can be locked | CSV turns the lock off on screen; the API refuses CSV + lock |
| Backup password: 8+ characters with letters, numbers and a symbol (Good or stronger) | Browser: under 8 → "Choose a password of at least 8 characters." Server: "Use 8+ characters with letters, numbers & symbols for the backup password." |
| Confirmation must match | "The two passwords don’t match. This attempt was recorded." — a Failed row appears |
| Empty vault | inline "0 credentials found in {vault} — there is nothing to download. Choose another vault." and, on Download, toast "Can't download an empty backup" |
| **Passwords on, lock off** | the server asks for the account password — **the popup has no field for it** — so the download is refused with "A backup with readable passwords needs your account password. Or lock the file with a password." |

The last row is a known front/back mismatch: *Include passwords* + CSV, or
*Include passwords* + lock off, cannot be downloaded from the screen today.
The backend still validates `account_password` (and records "Account
password incorrect" when it is wrong); the frontend stopped sending it.

The strength meter is a browser estimate and **not** the server's rule. It
counts upper + lower case as a point and any non-alphanumeric (a space
included) as a symbol, so "Abcdefgh!" shows **Good** and "password 1" shows
**Good**, while the server rates both Fair and refuses them (no digit; a
space is not a symbol).

### 6.4 The file

| Format | Content |
|---|---|
| Excel | "Credentials" sheet · **one tab per category in the import layout** · "About" (Backup ID, Created, Created by, Vault, Credentials, Passwords included, Recovery hint) |
| CSV | the Credentials rows only |
| JSON (API only) | `{ format, id, created, by, scope, count, credentials[] }` |

Credentials columns: Name, Type, Category, Website, Username, [Password],
Owner, Vault, Risk, 2FA, Rotation, Notes, Updated.

Secrets are written only where the user may copy them. A protected
credential's secret is "[Protected — unlock in CredVault]"; one the user may
only use or view is "[No copy permission]". The success toast says "{n}
protected secret(s) was/were left out — they open through an unlock, not a
file." when any were withheld.

A locked backup is still a `.xlsx`; Excel (or LibreOffice) asks for the
password when it opens. There is no zip.

### 6.5 Recovery

1. Open the locked backup in Excel with its password, remove the password
   (File > Info > Protect Workbook > Encrypt with Password, clear it), save.
2. Import data → Import by category → pick the category (e.g. Bank Account).
3. Upload that `.xlsx`; the tab for that category is read.
4. Review and Save. Repeat per category.

Uploading the still-locked file gives the "password-protected" message of §3.2.

---

## 7. Export Credentials (Team Vault)

| | |
|---|---|
| What | Exactly what the Team Vault table's tab lists (My Credentials or Team Credentials, and the open department) — the table's search does **not** narrow it |
| What to export | category boxes with counts (`GET /exports/preview`), Select all / Clear all, "{n} of {m} credentials selected" |
| Format | CSV only on screen ("Opens in Excel or Sheets"); notes always included |
| Include passwords | "Exported as plain, readable text" — needs the risk tick **and** "Account password \*" |
| Result | toast "{n} credential(s) exported as CSV"; if secrets were withheld, "Protected secrets withheld" |

Unlike the backup, the export **does** have the account-password field.
Export rows go to `credvault_transfers` (EX-) but **no screen lists them**.

---

## 8. Roles and access

| Who | Can |
|---|---|
| Client admin (Vault Admin) | open the screen; history shows **everyone's** imports and backups |
| User with `can_view` on **Credentials Vault** | open the screen; history shows only their own rows |
| Anyone else | 403 "You do not have access to Credentials Vault. Ask your admin to grant it in Permissions." |

There is no separate import, backup or export permission. What a backup can
contain depends on what the user can see in My Vault and Team Vault.

---

## 9. Statuses

| Record | Status | On screen |
|---|---|---|
| Import | `done` | Imported (not displayed as a column) |
| Import | `failed` | Nothing saved — reason "No row could be imported" (not displayed) |
| Backup | `done` | **Downloaded** |
| Backup | `failed` | **Failed**, reason on hover |
| Export | `done` | (no screen) |

---

## 10. Business rules QA should never see broken

1. Nothing is saved by uploading a sheet; only **Save** in the Review writes credentials.
2. Every imported row passes the same checks as the category's Add form; a row that fails is listed with **every** reason and the sheet row number (header = row 1).
3. A row whose name you already own in that category is discarded as a duplicate; a name repeated in the file is imported once (the first row).
4. A weak password is imported, counted in Weak, and shows up in Password Health — it is not refused.
5. Imports from the screen always land in **My Vault · Personal**.
6. A review older than 30 minutes cannot be saved; the user is sent back to upload again.
7. Two clicks on Save cannot import the same review twice (409 / 410 on the second).
8. One import produces exactly one history row (IM-) and one audit entry.
9. A backup never contains Critical Vault credentials or credentials only shared with the user.
10. A backup never contains the secret of a protected credential, nor one the user cannot copy.
11. Only an Excel backup can be locked; a CSV is always unlocked.
12. A locked backup opens in Excel only with its password; CredVault does not keep the password.
13. A mismatched confirmation and a wrong account password are recorded as **Failed** in the backup history.
14. An empty vault cannot be backed up, and the screen says why.
15. A locked backup uploaded for import is refused with the remove-the-password message.
16. Each category tab of an Excel backup can be imported back under that category.
17. Codes IM- / BK- / EX- are sequential per client and never repeat.
18. The busy veil blocks every control of the popup until the request ends.

---

## 11. Known gaps (as of this document)

| Gap | Effect |
|---|---|
| No account-password field in Download backup | Passwords + no lock cannot be downloaded from the screen |
| Browser strength meter ≠ server rule | A password shown as Good can be refused |
| Import guide step 2 and the "recognised automatically" line describe the old import | Users may upload browser CSVs that are refused |
| Failed list not viewable | "see the failed list" leads nowhere on screen |
| A typed import that saves nothing spends the review | Retry needs a new upload (API §3.2) |
| Export history has no screen | EX- rows are visible only through the API and Audit Logs |

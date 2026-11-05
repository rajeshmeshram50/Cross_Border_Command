# CredVault — Full Test Report

| | |
|---|---|
| Date | 05/11/2026 |
| Branch | `saas` (with the team's latest commits merged) |
| Scope | Every CredVault backend API: My Vault (Normal Vault) and Critical Vault for all 25 types, sharing, Team Vault, Export, Recycle Bin, Import & Recovery, Audit Logs, Password Health, Policies, Dashboard, Generate Password |
| Method | Every request runs in-process against the real database, **inside a transaction that is rolled back**, so no data is changed. **Every Postman test script is evaluated** (not only the status code). Requests are paced at about 4 a second, as in a Postman run with a 300 ms delay. |
| People used | employee (Credentials Vault → View) · that employee's reporting manager · the Vault Admin (client admin) · the Branch Admin |

## 1. Result

**Everything passes.** 0 failed requests, 0 failed checks, 0 server errors.

### Postman collections (`docs/`)

| Collection (name in Postman) | File | Requests passed | Postman tests | Skipped* |
|---|---|---|---|---|
| CredVault — Normal Vault & Critical Vault API | `CredVault_Vaults.postman_collection.json` | **315 / 315** | 849 | 1 |
| CredVault — Password Manager API (Dashboard, Health, Policies, Audit, …) | `CredVault.postman_collection.json` | **141 / 141** | 142 | 3 |
| CredVault — Team Vault API | `CredVault_TeamVault.postman_collection.json` | **25 / 25** | 36 | 1 |
| CredVault — Export Credentials API | `CredVault_Export.postman_collection.json` | **14 / 14** | 18 | 1 |
| Recycle Bin | `CredVault_RecycleBin.postman_collection.json` | **42 / 42** | 65 | 0 |
| Import & Recovery | `CredVault_ImportRecovery.postman_collection.json` | **35 / 35** | 72 | 1 |
| Audit Logs | `CredVault_AuditLogs.postman_collection.json` | **35 / 35** | 56 | 0 |
| **Total** | | **607 / 607** | **1,238** | 7 |

\* **Skipped** requests need a person's real account password (e.g. an export or backup with readable passwords) or a second account. Run them in Postman with your own login. The login requests themselves are not counted: the runner signs in directly.

### End-to-end suites

| Suite | What it proves | Passed |
|---|---|---|
| Endpoint sweep | every CredVault GET endpoint (33) answers without a server error for the Vault Admin, the Branch Admin and an employee | **99 / 99** |
| Audit Logs | 10 events from 1 hour to 40 days old:<br>• ranges 24h 4 · 7 days 8 · 30 days 9 · All 10, plus custom dates;<br>• tabs, and who sees what (Vault Admin 10 · employee 8 · manager 9 · intern 2 · Branch Admin 9);<br>• search, day groups, row fields, timezone, paging;<br>• CSV and Excel export | **42 / 42** |
| Import & Recovery | • the 25-tab sample: all 25 tabs import cleanly (50 credentials);<br>• one failure per form rule, duplicates, the failed list;<br>• backup lock rules, the locked zip opening only with its password;<br>• restore from a backup tab;<br>• TOTP key: kept as typed in My Vault, base32 still required in the Critical Vault | **62 / 62** |
| Recycle Bin rules | • counts for both vaults × 4 tabs, search;<br>• each person's view;<br>• restore and delete per person (Critical: Branch Admin only);<br>• retention (Normal changeable, Critical fixed);<br>• Empty Bin | **42 / 42** |
| Team access rights | Branch Admin, managers down the reporting line, no rights over people above or at the same level; edit, share and delete on the real APIs | **56 / 56** |
| Generate Password (R&D spec) | • D34 strength examples;<br>• 10,000 passwords all correct;<br>• no bias over 10 million picks (largest deviation about 0.3%);<br>• EFF passphrases;<br>• the spec's messages | **49 / 49** |
| Vault collection samples | every sample password still saves; the generator folder answers as its tests expect | **45 / 45** |
| My Vault tab counts | the counts follow the search on every tab | **72 / 72** |

### Code checks

| Check | Result |
|---|---|
| PHP lint: every CredVault controller, model, service and migration (25 files) | 0 errors |
| Routes | 67 CredVault routes registered |
| Migrations | none pending |
| TypeScript (CredVault pages) | 0 errors (the 180 in the project are in other modules) |
| Frontend build (Vite) | builds |

## 2. How to run the collections in Postman

1. **Import:** Import → File → pick the collection from `docs/`.
2. **Variables:** fill the collection's variables (Variables tab):
   - `baseUrl` (e.g. `http://127.0.0.1:8000/api`);
   - `email` / `password`: an employee with Credentials Vault → View;
   - `adminEmail` / `adminPassword`: a client admin;
   - `managerEmail` / `managerPassword`: that employee's reporting manager;
   - `branchEmail` / `branchPassword`: the Branch Admin (Recycle Bin only).
3. **Order:** run **00 · Setup** first, then the folders in order. Later requests read ids saved by earlier ones.
4. **Runner delay:** set the Postman runner's **Delay to 300 ms**. CredVault allows 240 requests a minute per person (10 a minute for 2-step codes), so a full run without a delay gets 429.
5. **Files to upload** are in `docs/postman-samples/`:
   - `credvault-sample.pdf` and `credvault-sample.png` (attachments);
   - `credvault-import-sample.xlsx` (the 25-tab sample);
   - `credvault-import-login.csv` and `credvault-import-card-with-errors.csv`;
   - `credvault-import-simple.csv`.

   If your project is not at `C:\xampp\htdocs\Cross_Border_Command`, re-select them in Body → form-data.
6. **Saving a file response** (sample, backup, export): Send ▾ → **Download response**, or ⋯ next to Save Response → **Save response to file**. Name it with its extension (`.xlsx`, `.csv`, `.zip`).
7. **Email codes** (Critical Vault email 2-step) are sent to the inbox in `otpInbox`. Paste the code into `emailOtpCode` before the verify request.

## 3. Fixed while testing

| What | Where |
|---|---|
| Some test scripts read the response as `b` without defining it, so those tests failed in Postman | the shared request builder: every collection |
| Team Credentials exports ran as the employee, who (rightly) does not see the manager's team credentials, so the export was empty | they now run as the reporting manager |
| The older collection's 3 upload rows had an empty file path, which gives the Postman **EISDIR** error | now point at real files in `docs/postman-samples/` |
| Reading an `.xlsx` that CredVault itself wrote returned only its last column, so a CredVault Excel backup could not be imported back | `VaultFile`: falls back to each cell's position |
| The space separator in passphrases never worked over HTTP (Laravel trims `" "`) | the separator is now sent by name: `space` |

## 4. Notes for the team

- **TOTP setup key:** base32 is checked in the Critical Vault only (`b0da752a`). My Vault, Team Vault and imports keep the key as typed. The tests follow this rule.
- **Team Credentials** (Normal Vault) are the team credentials of the people **below** you in the reporting line. A colleague at the same level, or someone above, sees nothing of yours unless you share it.
- **Teams Critical Credentials** (Critical Vault) list every employee's Critical Vault team credential in your branch. Colleagues outside your downline get View only (`via: branch_team`) and open the credential through Request Access. Tested by `cv_critical_branch.php`, 41/41.
- **Critical Vault items in the Recycle Bin** can be restored or deleted by the **Branch Admin** only.

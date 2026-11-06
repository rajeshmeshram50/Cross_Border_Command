# CredVault — Import & Recovery: Backend API Sheet

CredVault › Import & Recovery, as the screens show it:
- **Download sample file:** 25 tabs, Excel and CSV.
- **Import by category:** the form's validation and a failed list.
- **Imported Credentials History.**
- **Download backup:** Excel / CSV, My Vault / Team Vault, passwords yes / no, password lock.
- **Downloaded Backup History.**

| | |
|---|---|
| Base URL | `{{baseUrl}}/credvault` (Bearer token, Credentials Vault → View) |
| Postman collection | **"Import & Recovery"**: [CredVault_ImportRecovery.postman_collection.json](CredVault_ImportRecovery.postman_collection.json), 6 folders and 38 requests |
| Sample files for the uploads | [postman-samples/credvault-import-sample.xlsx](postman-samples/credvault-import-sample.xlsx) (the 25-tab sample) · [credvault-import-login.csv](postman-samples/credvault-import-login.csv) · [credvault-import-card-with-errors.csv](postman-samples/credvault-import-card-with-errors.csv) |
| Code | `ImportTemplate` (the 25 sheet layouts and samples) · `VaultFile` (reading and writing xlsx / csv / zip) · `ExcelLock` (the backup lock: Excel's own password encryption) · `CredVaultController` (Import & Recovery section) |
| Database | `credvault_transfers`: one row per import / backup. Migration `2026_11_05_000001` adds `credential_type`, `failed` and `failed_rows` |

---

## 1. Endpoints

| # | Request | What it does |
|---|---|---|
| 1 | `GET /imports/types` | The 25 categories of the import screen. Each has its tab name, its columns (required, hint, allowed values) and the files attached after the import. |
| 2 | `GET /imports/sample?format=xlsx` | **Download sample file (Excel):** one workbook with 25 tabs (Login … Outdoor License) plus "How to fill" |
| 3 | `GET /imports/sample?format=xlsx&type=login` | One category's tab plus "How to fill" |
| 4 | `GET /imports/sample?format=csv&type=card` | One category's sheet as a CSV |
| 5 | `GET /imports/sample?format=csv` | **Download sample file (CSV):** a `.zip` with the 25 CSVs (a CSV has no tabs) plus `how-to-fill.csv` |
| 6 | `GET /imports/sample?format=csv&layout=simple` | The older any-type sample (name, url, username, password, category, notes) |
| 7 | `POST /imports/preview` (form-data: `type`, `file`) | **Import, step 1.** Choose the category and upload its sheet. Every row is checked against that category's form; nothing is saved. Returns a token, the rows and the **failed list**. |
| 8 | `POST /imports` `{ token, rows: [index…], duplicates: skip\|copy, scope?: personal\|team, department_id? }` | **Import, step 2.** The picked valid rows are saved through the Add form. Returns the history row, `failed_rows` and `imported_codes`. |
| 9 | `GET /imports?page=&per_page=&mine=` | **Imported Credentials History** |
| 10 | `GET /imports/{id}` | One import, with its failed list |
| 11 | `GET /backups?page=&per_page=&mine=` | **Backup settings** (the count of each vault) and **Downloaded Backup History** |
| 12 | `POST /backups` `{ format, scope, include_passwords, lock, password, password_confirmation, account_password? }` | **Download backup:** the file |

---

## 2. Download sample file: 25 tabs

- **Layout:** each tab is laid out as that category's **Add form**:
  - `Credential Name`;
  - the form's fields (files excepted);
  - `2FA` (types with a 2FA switch);
  - `Registered Email` · `Registered Phone` · `Recovery Key` (types whose form has them);
  - `Risk` · `Rotation (days)` (password types) · `Notes`.
- **Headers:** a header ending in ` *` is required. Headers are matched by label or field key, ignoring case and spacing, so a sheet typed by hand reads too.
- **Example rows:** each tab has **two example rows that pass every check**. Tested: all 25 tabs import cleanly, 50 credentials.
- **"How to fill":** lists every column of every tab, with Required and "What to enter".
- **Files:** Certificate, Document, Passport, Driver License, SSN / Aadhaar / PAN and Medical Record have a file field. A sheet can't carry a file, so those rows are imported and the file is attached in the form afterwards (`notes` on the row says so).

### The 25 sheets

#### 1. Login — `type: login` · tab “Login” · Logins & Access

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Website / URL | Yes | A web address, e.g. https://app.example.com |
| Username | Yes | Text |
| Password | Yes | Encrypted as soon as it is imported |
| 2FA | No | Yes or No |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: Medium) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Zoho Books Admin · Website / URL = https://books.zoho.in · Username = admin@inhpl.com · 2FA = Yes · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 2. Password — `type: password` · tab “Password” · Logins & Access

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Website / URL | No | A web address, e.g. https://app.example.com |
| Username | Yes | Text |
| Password | Yes | Encrypted as soon as it is imported |
| 2FA | No | Yes or No |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: Medium) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Tally Prime Login · Website / URL = https://books.zoho.in · Username = admin@inhpl.com · 2FA = Yes · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 3. Email — `type: email` · tab “Email” · Logins & Access

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Email Address | Yes | An email address |
| Provider | Yes | One of: Google Workspace, Microsoft 365, Zoho Mail, Other |
| Password | Yes | Encrypted as soon as it is imported |
| Recovery Email / Phone | No | Text |
| 2FA | No | Yes or No |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: High) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Accounts Mailbox · Email Address = accounts@inhpl.com · Provider = Google Workspace · Recovery Email / Phone = it.desk@inhpl.com · 2FA = Yes · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 4. Passkey — `type: passkey` · tab “Passkey” · Logins & Access

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Website / App | Yes | A web address, e.g. https://app.example.com |
| Username | Yes | Text |
| Stored On | Yes | One of: Security key (YubiKey), Windows Hello, iCloud Keychain, Google Password Manager, Android device, Other |
| Created On | No | YYYY-MM-DD (or DD/MM/YYYY) |
| 2FA | No | Yes or No |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: Medium) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = GitHub Passkey · Website / App = https://books.zoho.in · Username = admin@inhpl.com · Stored On = Security key (YubiKey) · Created On = 1984-06-15 · 2FA = Yes · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 5. TOTP / 2FA Seed — `type: totp` · tab “TOTP - 2FA Seed” · Logins & Access

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Service | Yes | Text |
| Account | Yes | Text |
| Secret Key | Yes | The authenticator setup key |
| Code Length | No | One of: 6 digits, 8 digits |
| Refresh Period | No | One of: 30 seconds, 60 seconds |
| Backup Codes | No | Text |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = AWS Root 2FA Seed · Service = AWS · Account = root@inhpl.com · Code Length = 6 digits · Refresh Period = 30 seconds · Backup Codes = 8F2K-1Q9X 7Z3M-5T8R · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 6. Credit Card — `type: card` · tab “Credit Card” · Finance & Banking

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Cardholder Name | Yes | Text |
| Card Number | Yes | 12 to 19 digits (a real card number check is made) |
| Issuing Bank | No | Text |
| Expiry (MM/YY) | Yes | MM/YY, not in the past |
| CVV | Yes | 3 or 4 digits |
| Card PIN | No | 4 to 6 digits |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = HDFC Corporate Card · Cardholder Name = Inorbvict Healthcare India Pvt Ltd · Issuing Bank = HDFC Bank · Expiry (MM/YY) = 12/29 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 7. Bank Account — `type: bank` · tab “Bank Account” · Finance & Banking

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Bank Name | Yes | Text |
| Account Holder | Yes | Text |
| Account Number | Yes | Encrypted as soon as it is imported |
| IFSC Code | Yes | e.g. HDFC0000123 |
| Net-Banking User ID | No | Text |
| Net-Banking Password | No | Encrypted as soon as it is imported |
| 2FA | No | Yes or No |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: High) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = HDFC Current Account · Bank Name = HDFC Bank · Account Holder = Inorbvict Healthcare India Pvt Ltd · IFSC Code = HDFC0000123 · Net-Banking User ID = inhpl_corp · 2FA = Yes · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 8. Crypto Wallet — `type: crypto` · tab “Crypto Wallet” · Finance & Banking

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Wallet / Exchange | Yes | Text |
| Wallet Address | Yes | Text |
| Recovery Phrase | Yes | 12 to 24 words |
| Wallet Password | No | Encrypted as soon as it is imported |
| 2FA | No | Yes or No |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Treasury Cold Wallet · Wallet / Exchange = Ledger Nano X · Wallet Address = 0x71C7656EC7ab88b098defB751B7401B5f6d89… · 2FA = Yes · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 9. Rewards — `type: rewards` · tab “Rewards” · Finance & Banking

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Program Name | Yes | Text |
| Member ID | Yes | Text |
| Password | No | Encrypted as soon as it is imported |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: Low) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Air India Flying Returns · Program Name = Flying Returns · Member ID = AI1234567 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 10. API Credentials — `type: api` · tab “API Credentials” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Service / Platform | Yes | Text |
| Endpoint URL | No | A web address, e.g. https://app.example.com |
| API Key / Client ID | Yes | Encrypted as soon as it is imported |
| API Secret | Yes | Encrypted as soon as it is imported |
| Expires On | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Razorpay Live Keys · Service / Platform = AWS · Endpoint URL = https://api.razorpay.com · Expires On = 2028-03-31 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 11. SSH Key — `type: ssh` · tab “SSH Key” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Host | Yes | Text |
| Username | Yes | Text |
| Passphrase | No | Encrypted as soon as it is imported |
| Private Key | Yes | Text |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Prod Bastion Key · Host = db.prod.inhpl.com · Username = admin@inhpl.com (secrets left out here).

#### 12. Database — `type: database` · tab “Database” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Database Type | Yes | One of: MySQL, PostgreSQL, SQL Server, MongoDB, Oracle, Other |
| Host | Yes | Text |
| Port | Yes | 1 to 65535 |
| Database Name | Yes | Text |
| Username | Yes | Text |
| Password | Yes | Encrypted as soon as it is imported |
| Risk | No | Low, Medium or High (empty: High) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Production Postgres · Database Type = MySQL · Host = db.prod.inhpl.com · Port = 5432 · Database Name = erp_prod · Username = admin@inhpl.com (secrets left out here).

#### 13. Server — `type: server` · tab “Server” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Hostname / IP | Yes | Text |
| Operating System | No | One of: Linux, Windows Server, macOS, Other |
| Port | No | 1 to 65535 |
| Username | Yes | Text |
| Password | Yes | Encrypted as soon as it is imported |
| Risk | No | Low, Medium or High (empty: High) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = App Server 01 · Hostname / IP = db.prod.inhpl.com · Operating System = Linux · Port = 22 · Username = admin@inhpl.com (secrets left out here).

#### 14. Certificate — `type: cert` · tab “Certificate” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Domain / Common Name | Yes | Text |
| Issued By | No | Text |
| Valid Till | Yes | YYYY-MM-DD (or DD/MM/YYYY) |
| Private Key Password | No | Encrypted as soon as it is imported |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |
| Certificate File | After import | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = inhpl.com Wildcard SSL · Domain / Common Name = *.inhpl.com · Issued By = DigiCert · Valid Till = 2028-03-31 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 15. Software License — `type: license` · tab “Software License” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Software | Yes | Text |
| License Key | Yes | Encrypted as soon as it is imported |
| Licensed To | No | Text |
| Seats | No | A whole number |
| Renewal Date | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: Medium) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Microsoft 365 Business · Software = Microsoft 365 Business · Licensed To = Inorbvict Healthcare · Seats = 25 · Renewal Date = 2028-03-31 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 16. Wireless Router — `type: wifi` · tab “Wireless Router” · Development & IT

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Network Name (SSID) | Yes | Text |
| Security | Yes | One of: WPA3, WPA2, WPA2/WPA3, WEP, Open |
| Wi-Fi Password | Yes | Encrypted as soon as it is imported |
| Router Admin URL | No | A web address, e.g. https://app.example.com |
| Router Admin Password | No | Encrypted as soon as it is imported |
| Risk | No | Low, Medium or High (empty: Medium) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Office Wi-Fi 5G · Network Name (SSID) = INHPL-Office-5G · Security = WPA3 · Router Admin URL = http://192.168.1.1 (secrets left out here).

#### 17. Identity — `type: identity` · tab “Identity” · Identity & Documents

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Full Name | Yes | Text |
| Date of Birth | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Phone | No | 10 to 16 digits |
| Email | No | An email address |
| Address | No | Text |
| Risk | No | Low, Medium or High (empty: Medium) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Director Identity · Full Name = Rajesh Meshram · Date of Birth = 1984-06-15 · Phone = +91 98200 11223 · Email = accounts@inhpl.com · Address = Inorbvict House, Pune 411001 (secrets left out here).

#### 18. Passport — `type: passport` · tab “Passport” · Identity & Documents

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Name on Passport | Yes | Text |
| Passport Number | Yes | Encrypted as soon as it is imported |
| Nationality | No | Text |
| Date of Issue | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Date of Expiry | Yes | YYYY-MM-DD (or DD/MM/YYYY) |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |
| Passport Scan | No | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = Director Passport · Name on Passport = Rajesh Meshram · Nationality = Indian · Date of Issue = 1984-06-15 · Date of Expiry = 2028-03-31 (secrets left out here).

#### 19. Driver License — `type: driver` · tab “Driver License” · Identity & Documents

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Name on License | Yes | Text |
| License Number | Yes | Encrypted as soon as it is imported |
| Issuing State | No | Text |
| Valid Till | Yes | YYYY-MM-DD (or DD/MM/YYYY) |
| Risk | No | Low, Medium or High (empty: Medium) |
| Notes | No | Up to 5,000 characters |
| License Scan | No | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = Company Driver License · Name on License = Rajesh Meshram · Issuing State = Maharashtra · Valid Till = 2028-03-31 (secrets left out here).

#### 20. SSN / Aadhaar / PAN — `type: govid` · tab “SSN - Aadhaar - PAN” · Identity & Documents

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| ID Type | Yes | One of: Aadhaar, PAN, SSN, Voter ID |
| ID Number | Yes | Encrypted as soon as it is imported |
| Name on ID | Yes | Text |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |
| ID Scan | No | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = Company PAN · ID Type = PAN · Name on ID = Inorbvict Healthcare India Pvt Ltd · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 21. Document — `type: document` · tab “Document” · Identity & Documents

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Document Number | No | Text |
| Issued By | No | Text |
| Valid Till | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Risk | No | Low, Medium or High (empty: Medium) |
| Notes | No | Up to 5,000 characters |
| Attachment | After import | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = GST Registration Certificate · Document Number = 27AAACI1234F1Z5 · Issued By = GST Department · Valid Till = 2028-03-31 (secrets left out here).

#### 22. Secure Note — `type: note` · tab “Secure Note” · Personal & Lifestyle

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Secure Note | Yes | Text |
| Risk | No | Low, Medium or High (empty: Low) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Server Room Door Code · Secure Note = Door code 4729#, change every quarter (secrets left out here).

#### 23. Membership — `type: membership` · tab “Membership” · Personal & Lifestyle

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Organisation | Yes | Text |
| Member ID | Yes | Text |
| Valid Till | No | YYYY-MM-DD (or DD/MM/YYYY) |
| Portal Password | No | Encrypted as soon as it is imported |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Recovery Key | No | 4 to 500 characters |
| Risk | No | Low, Medium or High (empty: Low) |
| Rotation (days) | No | 30, 60, 90 or 180 (empty: the policy default) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = ICAI Membership · Organisation = ICAI · Member ID = AI1234567 · Valid Till = 2028-03-31 · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 · Recovery Key = RECOVERY-7Q2K-9XZM (secrets left out here).

#### 24. Medical Record — `type: medical` · tab “Medical Record” · Personal & Lifestyle

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| Patient Name | Yes | Text |
| Hospital / Insurer | No | Text |
| Record / Policy No. | Yes | Encrypted as soon as it is imported |
| Registered Email | No | The recovery email of the account |
| Registered Phone | No | 10 to 16 digits, e.g. +91 98200 11223 |
| Risk | No | Low, Medium or High (empty: High) |
| Notes | No | Up to 5,000 characters |
| Report / Policy File | No | Not in the sheet — attach it in the credential form after the import |

Sample row 1: Credential Name = Group Health Policy · Patient Name = Rajesh Meshram · Hospital / Insurer = Star Health · Registered Email = it.desk@inhpl.com · Registered Phone = +91 98200 11223 (secrets left out here).

#### 25. Outdoor License — `type: outdoor` · tab “Outdoor License” · Personal & Lifestyle

| Column | Required | What to enter |
|---|---|---|
| Credential Name | Yes | 2 to 150 characters, unique for this type in your vault |
| License Type | Yes | Text |
| License Number | Yes | Text |
| Issued By | No | Text |
| Valid Till | Yes | YYYY-MM-DD (or DD/MM/YYYY) |
| Risk | No | Low, Medium or High (empty: Low) |
| Notes | No | Up to 5,000 characters |

Sample row 1: Credential Name = Fishing Permit · License Type = Fishing · License Number = FP-2026-0042 · Issued By = GST Department · Valid Till = 2028-03-31 (secrets left out here).


---

## 3. Import by category

### Step 1: `POST /imports/preview` (form-data)

| Field | Rule | Message on refusal (422) |
|---|---|---|
| `type` | required, one of the 25 keys (§2) | Choose one of the 25 credential types. |
| `file` | required; `.xlsx`, `.csv`, `.tsv` or `.txt`; at most 5 MB; at most 2,000 rows | Choose a file to import. · Upload the Excel (.xlsx) or CSV sheet of this category — download the sample to see the layout. |
| The sheet's header row | must hold every required column of the category | The sheet is not a Credit Card sheet — missing columns: Card Number *, … Download the sample for this category and keep its header row. |
| An Excel workbook | read at the tab named for the category (the 25-tab sample or an Excel backup can be uploaded as it is); with no such tab, the first tab | This workbook has no "…" tab. Pick the category of the tab you filled, or upload that tab's sheet. |
| Rows | at least one | The sheet has no rows to import. |

**Every row is checked exactly as the category's Add form checks it**, using the same code (`checkField`). A failed row comes back with each reason:

| Check | Message (as the form shows it) |
|---|---|
| Credential Name: required, 2 to 150 characters | Enter the Credential Name. · The Credential Name needs at least 2 characters. |
| A required field is empty | Enter the &lt;label&gt;. · Select the &lt;label&gt;. |
| Web address (url fields) | Enter a valid web address for &lt;label&gt;. |
| Email | Enter a valid email for &lt;label&gt;. |
| Phone: 10 to 16 digits | Enter a phone number of 10 to 16 digits. |
| Date: YYYY-MM-DD; DD/MM/YYYY and Excel date cells are read too | &lt;label&gt; must be a date (YYYY-MM-DD). |
| Select list (Provider, Database Type, Security, ID Type …) | Pick a &lt;label&gt; from the list. |
| Whole number (Port, Seats) | &lt;label&gt; must be a whole number. · Port must be between 1 and 65535. |
| Card number: 12 to 19 digits plus the Luhn check | Enter a valid card number. |
| Expiry MM/YY, not past | Enter the expiry as MM/YY. · This card has expired. |
| CVV: 3 or 4 digits · PIN: 4 to 6 digits | CVV is 3 or 4 digits. · PIN is 4 to 6 digits. |
| IFSC | Enter a valid IFSC (e.g. ICIC0001234). |
| Recovery phrase: 12 to 24 words | A seed phrase has 12 to 24 words. |
| Length (max per field) | &lt;label&gt; can be at most N characters. |
| Risk: Low, Medium or High (Critical belongs in the Critical Vault) | Risk is Low, Medium or High. |
| Rotation: 30, 60, 90 or 180 | Rotation is 30, 60, 90 or 180 days. |
| Registered Email / Phone | Enter a valid Registered Email. · Enter a phone number of 10 to 16 digits. |

**Flags on a valid row:**
- `dup`: a credential of this category and name is already yours (`dup_of` names it);
- `dupfile`: the name repeats in the file;
- `weak`: a password below the policy minimum. The row can still be imported; it is counted as Weak and shows in Password Health.

`selected` means valid and not a duplicate.

**Response:**

```
{ "token": "…40…", "expires_in": 900, "type": "card", "type_label": "Credit Card", "file_name": "cards.csv", "sheet": null,
  "format": "csv", "format_label": "CSV", "columns": { "matched": { "credential_name": "Credential Name *", … }, "ignored": [] },
  "stats": { "rows": 5, "valid": 1, "failed": 4, "duplicates": 0, "weak": 0, "selected": 1 },
  "rows":   [ { "index": 0, "row": 2, "name": "Postman Good Card", "status": "valid", "errors": [], "flags": [], "notes": [], "strength": null, "dup_of": null, "selected": true }, … ],
  "failed": [ { "row": 3, "name": "Postman Bad Number", "errors": [ { "field": "cardno", "label": "Card Number", "message": "Enter a valid card number." } ] }, … ] }
```

- `row` is the sheet row: the header is row 1, so the first credential is row 2.
- **No secret value is ever returned.**

### Step 2: `POST /imports`

| Field | Rule |
|---|---|
| `token` | required, from the preview. It works once (a second use → 410 "This preview has expired or was already imported"); two runs at once → 409. |
| `rows` | required, the `index` values to import (1 to 2,000) |
| `duplicates` | `skip` leaves duplicate rows out; `copy` imports them as "… (imported)" |
| `scope` | `personal` (My Vault, default) or `team` (Team Vault: your department, or `department_id` for a Vault Admin / Branch Admin) |

**How rows are saved:**
- Each picked valid row is saved **through the category's Add form** (`persistCredential`). It gets a CRD- code, encryption, strength, risk (critical types start at High in My Vault), the policy rotation and a "Credential added" audit entry, exactly as if typed in.
- A row the form still refuses (e.g. a name that became a duplicate) joins the failed list.

**Response:**
- **201** with the history row, `failed_rows` and `imported_codes`.
- **422** when nothing could be imported.

The history keeps the failed list: `GET /imports/{id}` → `failed_rows`.

---

## 4. Imported Credentials History: `GET /imports`

| Screen column | Field |
|---|---|
| Sr. No | `sr_no` |
| Import ID | `code` (IM-…) |
| Imported On | `at` (ISO date) |
| Imported By | `by_display` ("You" or the name) · `by_initials` · `by_role` (Admin / Vault Administrator / designation) |
| File | `file_name` · `source_line` (e.g. "Credit Card sheet · into My Vault") |
| Format | `format_label` (Excel / CSV) |
| Imported · Skipped · Weak · Duplicates | `items` · `skipped` · `weak` · `duplicates` |
| (also) | `failed` · `type` / `type_label` (the category) · `status` / `status_label` (Imported / Failed) |
| "3 records" badge | `records` |

A Vault Admin sees everyone's imports; others see their own. `mine=1` shows only yours.

---

## 5. Download backup: `POST /backups`

| Screen | Field | Rule / message |
|---|---|---|
| 1 · Choose a format | `format` | `xlsx` (Excel) or `csv` (`json` is accepted too) |
| 2 · Choose what to include | `scope` | `mine` (My Vault) or `team` (Team Vault); `all` = both. The counts come from `GET /backups` → `scopes[]` |
| Include passwords | `include_passwords` | true / false. Without it, every secret field is left blank. |
| 3 · Lock the file with a password | `lock` | true (**Excel only**): the `.xlsx` itself is encrypted with **Excel's own password** (MS-OFFCRYPTO Agile: AES-256, SHA-512, 100,000 spins). Excel (and LibreOffice) asks for the password when the file opens. **No zip** — Windows' built-in extractor cannot open an AES zip ("The destination file could not be created"). A CSV or JSON file cannot hold a password: `lock: true` with CSV → 422 on `lock` "A CSV file cannot hold a password. Choose Excel to lock the backup, or turn the lock off." The screen turns the lock off for CSV. CredVault does not store the password. |
| Backup password | `password` | required when locked; **8+ characters with letters, numbers & symbols** → else 422 "Use 8+ characters with letters, numbers & symbols for the backup password." |
| Confirm password | `password_confirmation` | must match → else 422 "Passwords did not match." (**recorded as Failed** in the history) |
| Passwords included and the lock off | `account_password` | your account password is asked again: missing → 422; wrong → 422 "Account password incorrect." (recorded as Failed) |

**What the file holds:**
- **Excel:**
  - "Credentials" (one row per credential: Name, Type, Category, Website, Username, [Password], Owner, Vault, Risk, 2FA, Rotation, Notes, Updated);
  - **one tab per type in the import layout**, so a tab can be imported back (this is the *recovery*; tested end to end);
  - "About" (Backup ID, date, by, vault, count, passwords yes / no).
- **CSV:** the Credentials rows.
- **Never written:** the secrets of a protected (locked critical) credential.
- **Response headers:** `X-CredVault-Code` (BK-…), `X-CredVault-Items`, `X-CredVault-Withheld` (secrets left out).
- **Empty vault:** 422 "There are no credentials in this vault to back up."

**Recovery, step by step:**
1. Open the locked backup in Excel with its password, remove the password (File > Info > Protect Workbook > Encrypt with Password, clear it) and save.
2. On Import & Recovery, choose a category (e.g. Bank Account).
3. Upload that `.xlsx`. The tab for that category is read. Uploading the still-locked file → 422 "This Excel file is password-protected … remove the password … then upload again."
4. Import.

## 6. Downloaded Backup History: `GET /backups`

| Screen column | Field |
|---|---|
| Sr. No | `sr_no` |
| Backup ID | `code` (BK-…) |
| Downloaded On | `at` |
| Downloaded By | `by_display` · `by_initials` · `by_role` |
| Format | `format_label` (Excel / CSV / JSON) |
| Scope | `scope_label` (My Vault / Team Vault / All vaults) |
| Items | `items` (— for a failed attempt) |
| Size | `size_label` (e.g. "21 KB"; null for a failed attempt) |
| Protection | `protection`: **Password locked** / **Not locked** |
| Status | `status_label`: **Downloaded** / **Failed** (+ `failure_reason`) |
| "5 records" badge | `records` |

The same response carries the Backup settings data:
- `scopes[]`: My Vault · N credentials, Team Vault · N credentials, All vaults;
- `columns`;
- `lock_note`.

---

## 7. Testing (05/11/2026)

Everything ran in-process inside a database transaction that was **rolled back**, so no data was changed.

**End to end, 61/61:**
- **Sample:** the Excel sample has 25 tabs plus How to fill, and every tab is named for a type. Also checked: the one-type Excel, the one-type CSV, the 25-CSV zip, the older layout, an unknown type → 422, and the 25 categories.
- **All 25 tabs of the sample imported**, 2 rows each: **50 credentials**. A card got a CRD- code, an encrypted number and risk High; Password's 2FA column became its 2FA.
- **Duplicates:** the same file again flags both rows as `dup` (not ticked); `copy` imports "… (imported)".
- **Validation:**
  - a card sheet with 7 rows gave 1 valid and 6 failed: card number (Luhn), expired, CVV, an empty row (5 required fields), risk Critical, PIN plus phone;
  - each error carries field and label, and no secret appears in the response;
  - the import gave 1 imported plus a failed list of 6, and `GET /imports/{id}` returns it again.
- **One case per rule:** web address, email, select list, IFSC, port, seed words, base32 key, date, phone, name length.
- **Weak, files and wrong uploads:**
  - a weak password is valid, flagged and imported as weak;
  - Document imports with "attach the file";
  - a wrong sheet → 422 naming the missing columns;
  - the 25-tab workbook with category Card reads the "Credit Card" tab;
  - .pdf → 422, no file → 422, a used token → refused.
- **History:** every screen column of both history tables is present.
- **Backup:**
  - a weak lock password → 422 with the screen's rule;
  - a mismatch → 422 and a Failed row;
  - lock with no password → 422; passwords, no lock, no account password → 422;
  - CSV with the lock on → 422 on `lock`;
  - a locked Excel backup is an `.xlsx` (not a zip, `Content-Type` spreadsheetml), checked **in Microsoft Excel**: a wrong password is refused, the backup password opens it, and it holds Credentials, one tab per type and About;
  - the still-locked file uploaded to import → 422 "password-protected";
  - CSV without passwords has no Password column; Excel without passwords has blank secrets;
  - the Team Vault backup works.
- **Recovery:** after the bank credentials were deleted, the backup's "Bank Account" tab imported back, every row valid; account number and net-banking password intact.

**Postman collection, 35/35 requests:** every Postman test script was evaluated. One request was skipped because it needs your real account password: "Backup — CSV with passwords, not locked".

**Earlier suites still pass:** access rights 56, Recycle Bin 42 + 42, generator 49, collection check 45, search counts 72.

**Bug found and fixed while testing:** CredVault's own `.xlsx` files leave out cell references, which Excel allows. The reader assumed they were always there, so **re-importing a CredVault Excel file read only the last column**. It now falls back to each cell's position. Files saved by Excel were never affected.

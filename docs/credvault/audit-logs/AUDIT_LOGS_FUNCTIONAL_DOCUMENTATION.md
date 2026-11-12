# CredVault Audit Logs — Functional Documentation

| | |
|---|---|
| **Jira** | GT-115 (parent GT-85 — CredVault Audit Logs Documentation) |
| **Module** | CredVault → Vault Administration & Security → Audit Logs |
| **Audience** | Product, QA, support, auditors, business users, developers new to the module |
| **Companion documents** | Technical Documentation · API Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains what the Audit Logs page does, screen by screen and scenario by scenario, using the exact words the user sees. It covers what is recorded and when, who sees which entries, the timeline, the tabs, the time ranges, the search, the credential filter and the export. Read it to understand the page, to test it, or to answer a user's or an auditor's question.

### 1.2 The feature in one paragraph

Audit Logs answers **"who did what, to which credential, and when"**. Every important action in CredVault — opening a credential, revealing or copying a password, sharing, each step of an access request, an unlock, an export, a move to the Recycle Bin — writes one entry at the moment it happens. The page shows those entries as a **timeline grouped by day**, newest first, with the person, their role, the action, the credential, a detail line, the severity, the module, the IP address and an event ID. A person can narrow the timeline by tab, time range, search and credential, and download exactly what they see as a CSV file. The log is **append-only**: entries are never edited or deleted, by anyone, from any screen.

### 1.3 Key ideas to understand first

| Idea | What it means |
|---|---|
| Entry (event) | One recorded action, numbered **EVT-1042** and so on |
| Actor | The person who did it — or **System** for automatic permanent deletes |
| Action | What was done, for example *Password copied*, *Access approved* (section 9) |
| Severity | **Info**, **Warning** or **Critical** — how sensitive the action is |
| Module | The CredVault area the action happened in, for example *Critical Vault*, *Access Requests* |
| Vault Admin | The **Branch User** of a branch. Sees the activity of their branch's people |
| Append-only | Entries are written once and never changed or removed |

---

## 2. Where It Lives

### 2.1 Navigation

| | |
|---|---|
| **Menu** | Top bar → **CredVault** → **Vault Administration & Security** → **Audit Logs** (*Every view, copy, share & change, time-stamped.*) |
| **URL** | `/credentials-vault/audit-logs` — `?credential_id=…&credential=…` opens it already filtered to one credential (for direct links — no CredVault screen links this way today; without `credential=` the chip reads *Credential #‹id›*). `?action=…` also filters, with no chip and no way to clear it on screen, and applies to the export too |
| **Who sees the menu** | Anyone with **view** permission on the module *Credentials Vault* in Permissions |

> **Explanation.** Without that permission, every CredVault call is refused with *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."*

### 2.2 Screens

| Screen | Opens from |
|---|---|
| Audit Logs page (tabs, range, search, timeline) | The menu |
| Custom date range popup | **Custom** in the range bar |
| A credential's own history | The **Activity** tab of the View drawer in any vault — **every** entry on that one credential, for anyone who can open it (which may be more than their Audit Logs page shows); 50 per page; times always in India time |

---

## 3. How an Entry Is Written

### 3.1 The normal case

| Step | What happens |
|---|---|
| 1 | A person does something in CredVault — for example reveals a password in the View drawer |
| 2 | The server checks they may do it. **Only an action that succeeds is recorded** (exceptions in 3.2) |
| 3 | One entry is saved: who, the action, the credential (its ID and name are **copied into the entry**), the module, a detail line, the severity, the time, the IP address and the browser |
| 4 | The entry appears on the Audit Logs page of everyone allowed to see it, and in the credential's **Activity** tab |

> **Explanation: why the credential name is copied.** The entry keeps the credential's ID and name as they were, so it still reads correctly after the credential is renamed, moved to the bin or deleted for good.

### 3.2 Entries for a refusal or an automatic action

| Case | What is recorded |
|---|---|
| A backup is refused (the backup passwords do not match, or the account password is wrong) | *Backup attempt failed* (Critical), with the reason |
| The third wrong 2-step code on an access request | *Wrong 2-step code* (Warning) — once, when the request is locked and its approvals reset |
| An unlock window runs out | *Locked again*, under the requester, detail *Unlock window ended — locked again* |
| A binned credential passes its retention period | *Deleted permanently*, detail *Deleted automatically after ‹n› days in the bin* — by **System**, or by the Vault Admin whose shorter retention period caused it |

> **Explanation: when these automatic entries appear.** *Locked again* (window ended) and the automatic *Deleted permanently* carry the time they are **written**, which can be later than the real expiry. The first is written when someone next opens a vault list, a credential, the dashboard or Access Requests; the second only when someone opens the Recycle Bin or the dashboard. Opening Audit Logs creates neither.

### 3.3 One entry for a bulk import

An import run writes **one** *Credentials imported* entry for the whole run — for example *IM-0007 · 42 login credentials imported* — not one *Credential added* per row. Credentials added one by one through the Add form still write *Credential added* each.

> **Common misunderstanding.** "Opening a credential's drawer writes a reveal for every secret." It writes **one** *Viewed* entry (*Opened credential details*). Revealing or copying a secret through its reveal button writes its own *Password revealed* / *Password copied* entry.

---

## 4. Page Header

| Element | Text / behaviour |
|---|---|
| Title | **Audit Logs** |
| Subtitle | *Every view, copy, share, approval and policy change across CredVault — for you and your team, time-stamped.* |
| Button | **Export Logs** — reads **Exporting…** while the file is prepared; greyed out while exporting or loading |

---

## 5. Tabs, Range and Search

### 5.1 Tabs

| Tab | Shows |
|---|---|
| **All Activity** | Every entry you may see |
| **My Activity** | Entries **you** made |
| **Team Activity** | Entries made by anyone else you may see |

Each tab shows a count. The counts follow the range, the search and the credential filter; switching the tab changes only the list.

### 5.2 Time range

| Choice | Covers |
|---|---|
| **24h** | The last 24 hours, back from this moment |
| **7 days** | The last 7 × 24 hours |
| **30 days** | The last 30 × 24 hours — **the default** |
| **All** | Everything |
| **Custom** | A From and To date you pick (5.3) |

The **Custom** button reads *Custom*, or the chosen dates (*03 Nov – 12 Nov*), or one date when From and To are the same; an open end reads *Start* or *Today*.

### 5.3 The Custom date range popup

| Element | Text / rule |
|---|---|
| Title | **Custom date range** |
| Fields | **From**, **To** — date pickers; no date after today can be picked |
| Default | Both open on **today**, so picking one date and pressing **Apply** shows that day only |
| Error | *"From" must be on or before "To".* |
| Buttons | **Cancel**, **Apply** |
| Closing | Esc, or a click outside the popup |

Custom dates are whole calendar days **in your own time zone**.

### 5.4 Search

Placeholder *Search user, credential, action or event ID...* — up to 100 characters, with a clear (**x**) button while typing.

| You can search by | Example |
|---|---|
| A person's name | *Priya* |
| A credential name or ID | *Kotak*, *CCRD-0003* |
| An action name | *copied*, *unlocked*, *rejected* |
| The detail line | *Rohan Mehta*, *payment* |
| The module | *Critical Vault* |
| An event ID | *EVT-1042* or *1042* |

Search is not case-sensitive and starts about 0.35 s after you stop typing.

### 5.5 The credential filter

Click a credential's name in any entry (tooltip *‹name› — show only this credential's events*) to see only that credential's entries. A chip appears under the tabs — *‹credential name› · ‹ID›* with a lock icon and an **x** to clear it.

---

## 6. The Timeline

### 6.1 Day headings

A calendar icon, **Today** / **Yesterday** / the weekday name (*Tuesday*), the date (*dd/mm/yyyy*) and *‹n› events*. The count is the day's total over **every** page, so a day that runs onto page 2 still shows its full total.

### 6.2 Each entry

| Part | Content |
|---|---|
| Time | Hours and minutes (*HH:mm*), with the seconds underneath (*07s*) |
| Icon | The action's icon, coloured by the action's usual severity |
| Avatar | The person's initials — highlighted when it is you |
| Sentence | ***‹Name›*** *‹what they did›* ***‹credential›*** — for example *Priya Sharma revealed the password of Kotak Vendor Payments A/c*. Your own entries read **You**; hover the name for the full name |
| Role | The person's role line — *Executive · Accounts*, or *Team member* when none is known. System entries read *System* · *CredVault* |
| Severity pill | **Info**, **Warning** or **Critical** |
| Action tag | The action name, for example *Password copied* |
| Detail | The detail line, for example *Shared with Rohan Mehta · View until 30/11/2026*. A long line is cut with "…" and opens or closes on click |
| Footer | The credential ID and risk (*CCRD-0003 · Critical*) — or *Vault settings* for an entry with no credential — then the module, the IP address and the event ID (*EVT-1042*). The risk is the credential's **current** risk; it is empty after a permanent delete |

### 6.3 States

| State | What shows |
|---|---|
| Loading | Six placeholder rows |
| Nothing found (search or credential filter on) | *No events match your search* — *Try a user, credential, action or event ID.* |
| Nothing in the range | *No activity in this period* — *Choose a longer period to see older events.* |
| Error | *Could not load the audit log*, the reason, and **Try again** |

The pager sits at the foot: 10 entries per page by default (10 / 25 / 50). A new filter or page size goes back to page 1.

---

## 7. Export Logs

| Case | Message |
|---|---|
| Nothing on screen | Warning *No events to export for this view* |
| Success | ***‹n› events exported as CSV*** with the file name |
| The server finds nothing to export | Warning *There are no events in this view to export.* |
| Any other failure | ***Export failed*** with the reason |

| Rule | Detail |
|---|---|
| What is exported | Exactly the current view — tab, range, search, credential — newest first, **at most 10,000** entries |
| File name | `credvault-audit-log-all-activity-20261112.csv` (the tab name and today's date) |
| Columns | **Event ID, Date, Time, User, Role, Action, Credential ID, Credential, Risk, Details, Module, Severity, IP** |
| Times | In your time zone |
| Recorded | The export itself is recorded: *Exported* · Info · module *Audit Logs* · *Audit log exported · ‹n› events* |

> **Worth testing.** Export with a credential filter and a search on: the file must hold only those entries, and a new *Exported* entry must appear at the top of the timeline after the download.

---

## 8. Who Sees What

| Role | Entries they see |
|---|---|
| **Vault Admin** (Branch User) | Their own entries; entries by **every non-admin person of their branch**; entries by their reporting line; and every entry on a credential they own |
| **Manager** (anyone with people reporting to them) | Their own entries; entries by **everyone below them** in the reporting line, at any depth; and every entry on a credential they own |
| **Employee** | Their own entries; and every entry on a credential they own — whoever made it |

| Rule | Detail |
|---|---|
| Everyone | Can use every tab, the range, the search and **Export Logs**. An export never contains more than the person can see on screen |
| Company boundary | Nobody ever sees another company's entries |
| Reporting line | Read from the HR employee records |

> **Common misunderstanding.** "The Vault Admin sees the other Vault Admins of the branch." A Vault Admin sees the **non-admin** people of their branch; another admin login's entries appear only when they touch a credential this Vault Admin owns, or sit in their reporting line.

---

## 9. The Event Catalogue

### 9.1 Severity

| Severity | Label | Meaning |
|---|---|---|
| `info` | **Info** | Routine activity |
| `warn` | **Warning** | Touches a secret or widens access |
| `critical` | **Critical** | High-risk: a critical credential's secret, an unlock, a rejection, a permanent delete, a credentials export, a failed backup (an audit-log export is saved as Info) |

A **reveal**, **copy** or **share** on a Critical Vault credential is always saved as **Critical**, whatever its usual severity. The timeline icon and the action tag keep the usual severity's colour; the card and the severity pill show the severity the entry was saved with. So an audit-log *Exported* entry shows a Critical-coloured icon and tag next to an **Info** pill.

### 9.2 Actions

| Label on screen | Usual severity | Module shown | Recorded when |
|---|---|---|---|
| *Viewed* | Info | The credential's vault | The View drawer opens (*Opened credential details*); a non-secret field is copied (*Username copied*); an attachment is opened |
| *Password revealed* | Warning | Critical Vault for a Critical Vault credential; **My Vault** for every other credential, team ones included | A secret field is revealed (*Password revealed*, *PIN revealed* …) |
| *Password copied* | Warning | As above | A secret field is copied |
| *Website launched* | Info | The credential's vault | The credential's website is opened |
| *Credential added* | Info | The credential's vault | A credential is saved through the Add form |
| *Credential updated* | Info | The credential's vault | A credential is saved after editing (*Updated: name, risk, secret*) |
| *Shared* | Warning | The credential's vault | A share is created or renewed — and a **second** *Shared* entry for the share email (*Share email to ‹name›: ‹n› sent[, ‹n› failed]*), unless no recipient has an email or mail is off |
| *Access revoked* | Info | The credential's vault | A share is revoked; a recipient removes it from their vault; a re-share ends because its giver lost Full Access |
| *Access requested* | Warning | Critical Vault | An access request is raised (with the window and the reason) |
| *Forwarded to manager* | Info | Access Requests | The requester forwards the request to their manager |
| *Access approved* | Info | Access Requests | The Vault Admin or the manager approves |
| *Access rejected* | Critical | Access Requests | The Vault Admin or the manager rejects (with the note) |
| *Request cancelled* | Info | Critical Vault | The requester cancels |
| *Critical unlocked* | Critical | Critical Vault | The last step passes and the window opens — recorded under whoever completed it: the requester after the code, or the approver when approval is the last step |
| *Locked again* | Info | Critical Vault | **Lock now**, or the window runs out |
| *Wrong 2-step code* | Warning | Critical Vault | The third wrong code locks the request |
| *Email code sent* | Info | Critical Vault | An unlock code is emailed (the address masked) |
| *Exported* | Critical | Team Vault / Audit Logs | Credentials are exported (module **Team Vault**, even for a My Credentials export); the audit log is exported (module **Audit Logs**, saved as Info) |
| *Moved to bin* | Warning | The credential's vault | A credential is moved to the Recycle Bin |
| *Restored* | Info | The credential's vault | A credential is restored from the bin |
| *Deleted permanently* | Critical | Recycle Bin | Deleted from the bin (*Deleted permanently*), by **Empty Bin** (*Deleted permanently (Empty Bin)*), or automatically after the retention period |
| *Policy changed* | Warning | Recycle Bin | A branch's Recycle Bin retention period is changed (*Retention period for ‹Branch›: 30 days → 7 days*) |
| *Credentials imported* | Warning | Import & Recovery | An import run finishes |
| *Backup created* | Warning | Import & Recovery | A backup file is downloaded |
| *Backup attempt failed* | Critical | Import & Recovery | A backup is refused — the backup passwords do not match, or the account password is wrong |
| *Health issue resolved* | Info | Password Health | A save makes a Password Health issue go away |
| *2-step linked* | Info | The credential's vault | An authenticator app or email 2-step is linked on save |
| *Password generated* | Info | Generate Password | The password generator is used — including every ↻ in a password field (the settings only, never the password) |

"The credential's vault" is **Critical Vault** for a Critical Vault credential, **Team Vault** for a team credential, otherwise **My Vault**.

---

## 10. Scenarios and Edge Cases

| # | Situation | What happens |
|---|---|---|
| 1 | A credential is deleted for good | Its entries stay, with the name and ID they had |
| 2 | A credential is renamed | Old entries keep the old name; new entries use the new one |
| 3 | A window runs out while nobody is using CredVault | The *Locked again* entry is written — and time-stamped — the next time someone in the company opens a vault list, a credential, the dashboard or the Access Requests page |
| 3a | **Lock now** is pressed | *Locked again* with the detail *Credential locked again* |
| 3b | A rejection without a note | *Access rejected* with the note *Not approved at this time* |
| 3c | A typed import where every row fails | Still recorded: *IM-0008 · 0 login credentials imported · 5 failed* |
| 3d | Someone moves to another branch | The new branch's Vault Admin sees all their entries, including those from before they joined |
| 3e | Searching *System* | Finds nothing — the name search looks only at people |
| 4 | A Custom From date after the To date | *"From" must be on or before "To".* — Apply does nothing |
| 5 | A search with no match | *No events match your search* |
| 6 | Opened with `?credential_id=` (a direct link) | The timeline opens already filtered, with the credential chip |
| 7 | The credential filter, then clear the chip | The timeline shows every credential again |
| 8 | Copying a non-secret field (username, website) | Shows as *Viewed*, with the detail *‹Field› copied* |
| 9 | Only one or two wrong 2-step codes | Nothing is recorded; only the third is |
| 10 | An import of 42 credentials | One *Credentials imported* entry, not 42 |
| 11 | Exporting more than 10,000 entries | Only the newest 10,000 are in the file |
| 12 | A day's entries span two pages | Both pages show the same day heading with the full day total |

---

## 11. Business Rules

| ID | Rule |
|---|---|
| BR-01 | Entries are **append-only**; no screen or API edits or deletes them |
| BR-02 | Every entry belongs to one company; nobody sees another company's entries |
| BR-03 | The Vault Admin sees their own entries, their branch's non-admin people, their reporting line, and every entry on credentials they own; everyone else sees their own, their reporting line's, and every entry on credentials they own |
| BR-04 | A reveal, copy or share on a Critical Vault credential is always saved as **Critical** |
| BR-05 | A secret value is **never** written to the log — only that it was revealed or copied, and which field. The password generator records the settings used, never the password |
| BR-06 | The credential's ID and name are copied into the entry |
| BR-07 | The default view is **All Activity**, **30 days**, 10 entries per page |
| BR-08 | 24h, 7 days and 30 days are rolling periods back from now; Custom uses whole days in the viewer's time zone |
| BR-09 | A Custom date may not be in the future, and From must be on or before To |
| BR-10 | The tab counts follow the range, the search and the credential filter |
| BR-11 | An export holds exactly the current view, newest first, at most 10,000 entries |
| BR-12 | Exporting the log is itself recorded (*Exported*, Info, module *Audit Logs*) |
| BR-13 | A bulk import writes one *Credentials imported* entry |
| BR-14 | Times on screen and in the export are in the viewer's time zone |
| BR-15 | Search is not case-sensitive and matches the detail, the credential name and ID, the module, a person's name, an action name, and an event ID (*EVT-123* or *123*) |

---

## 12. Known Problems and Limitations

| # | Item |
|---|---|
| 1 | There is no on-screen filter by severity, person or action; use the search (it matches names and action names) |
| 2 | **Export Logs** downloads CSV only, and at most the newest 10,000 entries of the view |
| 3 | There is no retention setting for the log; entries are kept and cannot be removed |
| 4 | A *Locked again* entry for an ended window is written on the next page load in the company, not to the second |
| 5 | Once a credential is deleted for good, its owner no longer sees entries on it made by people outside their own team |
| 6 | Only the **third** wrong 2-step code is recorded, not the first two |
| 7 | The page has no *Security Alerts* tab; to review high-risk activity, look for the **Critical** pill or search for *unlocked* |
| 8a | **System** entries (automatic *Deleted permanently*) reach nobody's timeline: once the credential is gone, no viewer's scope matches them. They are in the table and in a full export only for viewers whose scope still covers them |
| 8b | A *Wrong 2-step code*, *Shared* and the expiry *Locked again* time-stamps are when the entry was written, which can be later than the event (3.2) |
| 8 | Revealing or copying a secret in the unlocked Critical Vault popup or drawer is **not** recorded (see the Critical Vault Known problems) — only the drawer opening (*Viewed*) is |

---

## 13. Roles and Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The **Branch User** of a branch |
| Entry / event | One recorded action, numbered EVT- |
| Actor | Who did it — a person, or **System** |
| Severity | Info, Warning or Critical |
| Module | The CredVault area the action happened in |
| Reporting line | The people below someone in HR, at any depth |
| Append-only | Written once, never changed or removed |

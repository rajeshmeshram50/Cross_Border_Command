# CredVault My Vault — Functional Documentation

Jira **GT-73**.

## 1. The feature in one paragraph

My Vault is the company password manager's everyday screen. Each person keeps
their own logins, cards, bank accounts, API keys, ID numbers and other secrets
here, encrypted, and sees in one list everything else they are allowed to
reach — credentials colleagues have shared with them, and team credentials of
the people below them. From the list they can add, view, reveal, copy, launch,
edit and share a credential, revoke a share they made, or move a credential to
the Recycle Bin. Every reveal, copy, share and change is written to an audit
trail. Credentials marked **Critical** do not live here: they go to the
Critical Vault, which adds approvals and a 2-step code before anything is
shown.

---

## 2. Where it lives

| | |
|---|---|
| Menu | Top bar → **CredVault** → Vault Management → **My Vault** |
| URL | `/credentials-vault/my-vault` |
| Quick actions (same menu) | **Add Credential** → `?action=add` · **Generate Password** → `?action=generate` |
| Deep links | `?tab=sharedby` (from the Dashboard's sharing widget) · `?tab=sharedby&credential_id=<id>` (Password Health → *Fix* on an over-shared credential) |
| Who sees the menu | The client admin, and anyone with **view** on the module *Credentials Vault* in Permissions |

### 2.1 Screens

| Screen | Opens from |
|---|---|
| **My Vault** list | the menu |
| **What would you like to add?** — type picker | *Add Credential* |
| **Add / Edit `<Type>` Credentials** — the form | a picked type, or *Edit* |
| **View drawer** (slides in from the right) | *View* on a row |
| **Share Credential** popup | *Share* on a row or in the drawer |
| **Generate Password** popup | the header button |
| **Move to Recycle Bin** / **Remove from your vault?** confirm | the bin icon |
| **Revoke access?** confirm | *Revoke* on a Shared By Me row |

Hand-offs, documented elsewhere: Critical Vault (unlock and approvals), Team
Vault, Recycle Bin (restore / delete), Password Health, Import & Recovery.

---

## 3. The list

Header: **My Vault** — *"Store and manage your personal logins, secure notes,
and secrets — encrypted and visible only to you."* Buttons **Generate
Password** and **Add Credential**. Below it a collapsible brief with four
steps (Add Credential · Organise · Keep Passwords Strong · Share Securely).

### 3.1 Tabs

Each tab shows its count.

| Tab | Shows |
|---|---|
| **All Credentials** | Everything you can see (§8) |
| **My Credentials** | Credentials you own |
| **Team Credentials** | Team-scope credentials you reach, and credentials of the people you oversee — not yours, not shared with you |
| **Shared With Me** | Credentials someone shared with you or your team |
| **Shared By Me** | Your shares — a different table (§7) |

**Not true:** "My Vault shows only my credentials." *All Credentials* includes
team and shared ones, and a manager sees their downline's credentials listed
here too.

### 3.2 Search

One box, placeholder *"Search by credential ID, name, category, username or
owner..."*. It also matches the type label, the risk word (*High*) and the
strength word (*Weak*, *Strong*). It waits 350 ms after typing and returns to
page 1. Tab counts follow the search.

On Shared By Me the placeholder is *"Search by credential ID, name, person,
team or reason..."*.

### 3.3 Columns

Sr. No · Credential ID (CRD-0001 + date added) · Credential Name (+ URL, or
"shared with you" icon) · Category (type + group) · Username (first 12
characters) · Owner (*You* or the name, badge **Personal** / **Team** /
**Shared with you**) · Risk · Strength (*N/A* when the type has no password) ·
2FA (*Enabled* / *Disabled* / *N/A*) · Last Updated · Action.

The list is newest-updated first. There is no column sort.

### 3.4 Row actions

| Button | Enabled when | Does |
|---|---|---|
| Edit | you have Full Access | opens the form |
| Share | Full Access | opens Share |
| View | always | opens the drawer |
| Copy `<secret label>` (e.g. *Copy API Key*) | Copy access or higher | copies the main secret; clipboard clears in 30 s |
| Bin | Full Access (owner side) or the credential reached you by a share | *Move to Bin* / *Remove from your vault* |

The Copy tooltip naming the type's secret is **My Vault only**; Team and
Critical Vault say *Copy Password*.

### 3.5 Paging

10, 25 or 50 a page. If a page empties (after a delete) the list steps back to
the last page.

### 3.6 Empty states

| Case | Title | Sub |
|---|---|---|
| Load failed | *Could not load credentials* | the error |
| Search, no hits | *No credentials match your search* | *Try a different credential ID, name, category, username, or owner.* |
| Shared With Me, empty | *No credentials yet* | *Credentials that colleagues share with you will appear here.* |
| Otherwise | *No credentials yet* | *Credentials you add to My Vault will appear here.* |

---

## 4. Adding a credential

### 4.1 Step 1 — pick the type

**What would you like to add?** shows the 25 types in five groups, with a
search (*"Search type — e.g. card, server, Aadhaar, Wi-Fi…"*; `/` focuses it).
Tiles carry a **2FA** chip when the type has a 2FA switch and **New** for
Passkey, TOTP and Certificate.

| Group | Types |
|---|---|
| Logins & Access | Login · Password · Email · Passkey · TOTP / 2FA Seed |
| Finance & Banking | Credit Card · Bank Account · Crypto Wallet · Rewards |
| Development & IT | API Credentials · SSH Key · Database · Server · Certificate · Software License · Wireless Router |
| Identity & Documents | Identity · Passport · Driver License · SSN / Aadhaar / PAN · Document |
| Personal & Lifestyle | Secure Note · Membership · Medical Record · Outdoor License |

### 4.2 Step 2 — the form

Title **Add `<Type>` Credentials**. Four sections.

**Credential Details**

| Field | Behaviour |
|---|---|
| Credential ID | Read-only, *Auto*. A preview (CRD-0042); the real number is given on save |
| Credential Name * | 2–150 characters, at least one letter or digit |
| Credential Category | Read-only — the type |
| Owner | Read-only — you |

**`<Type>` Details** — the type's own fields (§4.3).

**Recovery & Proof** — shown only for types that offer it:

| Field | For | Rule |
|---|---|---|
| Registered Email | types marked E in §4.3 | valid email, no spaces |
| Registered Phone | E or P | 10–15 digits, `+ ( ) -` and single spaces |
| Secret / Recovery Key | K | at least 4 characters; encrypted like the password; every reveal logged |
| Attachments | A (types without a file field of their own) | up to 5 files, 10 MB each: PDF, PNG, JPG, JPEG, WEBP, DOC, DOCX, XLS, XLSX, CSV, TXT |

**Security Details**

| Field | Behaviour |
|---|---|
| Risk Level * | **Low · Medium · High**. *Critical* is not offered in My Vault |
| Password Rotation | Only for types whose secret is a password. No rotation / every 30 · 60 · 90 · 180 days. Pre-set from the policy (default 90) |
| 2FA | Only for Login, Email, Passkey, Bank Account, Crypto Wallet. *Enabled / Disabled* |
| Remark | Free text, up to 5,000 characters. Not on Secure Note |

**In My Vault, 2FA is only recorded.** Turning it on links nothing and nobody
is asked for a code when the credential is opened. (In the Critical Vault the
same switch is the authenticator lock.)

### 4.3 The 25 types

Starting risk is the type's default; the four types whose default is
*critical* start at **High** here (marked †). Extras: E registered email,
P registered phone, K recovery key, A attachments.

| Type | Starting risk | 2FA | Shown as Username | Main secret | Rotation | Required fields | Extras |
|---|---|---|---|---|---|---|---|
| Login | Medium | switch | Username | Password | yes | Website / URL, Username, Password | EPKA |
| Password | Medium | toggle in the type's fields | Username | Password | yes | Username, Password | EPKA |
| Email | High | switch | Email Address | Password | yes | Email Address, Provider, Password | PKA |
| Passkey | Medium | switch | Username | — | no | Website / App, Username, Stored On | EPKA |
| TOTP / 2FA Seed | High | — | Account | Secret Key | no | Service, Account, Secret Key | EPA |
| Credit Card | High † | — | Cardholder Name | Card Number | no | Cardholder Name, Card Number, Expiry, CVV | EPA |
| Bank Account | High † | switch | Account Number (last 4) | Net-Banking Password | yes | Bank Name, Account Holder, Account Number, IFSC | EPKA |
| Crypto Wallet | High † | switch | Wallet / Exchange | Recovery Phrase | no | Wallet / Exchange, Wallet Address, Recovery Phrase | EPA |
| Rewards | Low | — | Member ID | Password | yes | Program Name, Member ID | EPKA |
| API Credentials | High | — | Service / Platform | API Key / Client ID | no | Service / Platform, API Key, API Secret | EPA |
| SSH Key | High | — | Host | Private Key | no | Host, Username, Private Key | A |
| Database | High | — | Username | Password | yes | Database Type, Host, Port, Database Name, Username, Password | A |
| Server | High | — | Username | Password | yes | Hostname / IP, Username, Password | A |
| Certificate | High | — | Domain | Private Key Password | yes | Domain, Valid Till, Certificate File | EP |
| Software License | Medium | — | Software | License Key | no | Software, License Key | EPA |
| Wireless Router | Medium | — | SSID | Wi-Fi Password | yes | SSID, Security, Wi-Fi Password | A |
| Identity | Medium | — | Full Name | — | no | Full Name | A |
| Passport | High | — | Passport Number (last 4) | Passport Number | no | Name, Passport Number, Date of Expiry | — |
| Driver License | Medium | — | License Number (last 4) | License Number | no | Name, License Number, Valid Till | — |
| SSN / Aadhaar / PAN | High † | — | Name on ID | ID Number | no | ID Type, ID Number, Name on ID | EP |
| Document | Medium | — | Document Number | — | no | Attachment | — |
| Secure Note | Low | — | — | Secure Note | no | Secure Note | A |
| Membership | Low | — | Member ID | Portal Password | yes | Organisation, Member ID | EPKA |
| Medical Record | High | — | Patient Name | Record / Policy No. | no | Patient Name, Record / Policy No. | EP |
| Outdoor License | Low | — | License Number (last 4) | License Number | no | License Type, License Number, Valid Till | A |

The risk can be changed before saving; the starting value is only a default.

### 4.4 Field rules the form checks as you type or save

These run in the browser; the server repeats the core of them (see the API
document §3.4). Messages are the form's own.

| Field | Rule | Message |
|---|---|---|
| Any password | below the policy minimum | *Policy requires a Good or stronger password — use the generate button* |
| Login → Username | at least 3 characters | *Username must be at least 3 characters* |
| Any plain text field | not symbols only | *`<Label>` must include at least one letter or number* |
| Rewards → Program Name | must contain letters | *Program name must include letters, not only numbers* |
| URL fields | domain / IP / localhost, scheme optional | *Enter a valid URL* |
| Card Number | 12–19 digits and the card checksum | *Card number must be 12–19 digits* / *This doesn’t look like a real card number — the N digits don’t pass the card checksum. Re-check for a typo.* |
| Card Expiry | MM/YY (month-year picker) | *Use MM/YY, e.g. 08/28* |
| CVV | 3–4 digits | *CVV must be 3 or 4 digits* |
| Cardholder / Account Holder | letters only, no digits | *`<Label>` cannot contain numbers* |
| Account Number | 9–18 digits | *Account number must be 9–18 digits* |
| IFSC | `ABCD0XXXXXX` | *IFSC must look like ICIC0001234* |
| Host | hostname, IPv4 or IPv6 | *Enter a valid hostname, domain or IP address, e.g. prod.example.com or 10.0.1.25* |
| Port | 1–65535 | *Port must be between 1 and 65535* |
| API Key / Secret | no spaces, keyboard characters, ≤ 128 | *`<Label>` cannot contain spaces or line breaks* |
| SSH Private Key | ≤ **64** characters | *`<Label>` can be at most 64 characters* |
| Certificate Domain | domain, optional leading `*.` | *Enter a valid domain, e.g. inorbvict.com or *.inorbvict.com* |
| Driver License No. | 15–16 letters and digits, both present | *License number must be 15–16 characters, e.g. MH12 20110012345* |
| Aadhaar | exactly 12 digits | *Aadhaar number must be exactly 12 digits* |
| PAN | 5 letters, 4 digits, 1 letter | *PAN must be 5 letters, 4 digits and 1 letter, e.g. ABCDE1234F* |
| Date of Birth | not today or later, 18+ | *Date of birth cannot be today or a future date* / *You must be at least 18 years old* |
| Passport Date of Expiry | after Date of Issue | *Date of Expiry must be later than the Date of Issue* |
| Any file | 10 MB | *File must be 10 MB or smaller* |

**Rules that apply only in My Vault, not when the same form is opened from
the Critical Vault** (the form checks `!inCritical`): the Date of Birth
18-years limit, the Issue → Expiry pairing on the date pickers, the card
expiry month picker, copy toasts that name the field, and the full-page save
lock (§4.6).

**The SSH key limit is a known problem.** The code says: *"a real key is
~400–3,300 characters, so full keys no longer fit … Raise PRIVKEY_MAX to accept
real keys again."* The server itself accepts up to 10,000.

### 4.5 Saving

The footer reads *Adding a `<Type>` to My Vault · fields marked * are
required*, with **Change type**, **Close** and **Save Credential**.

On an error the form scrolls to the first bad field and toasts *Can’t save yet*
(one error, naming it) or *Please complete the highlighted fields*.

On success: *"`<CRD-0042>` · `<name>` added"* with the server's *"“…” saved to
My Vault as CRD-0042."*

### 4.6 The save lock

While saving, My Vault covers the form with a blurred sheet and a ring saying
*Saving…* / *Updating…*; every input is disabled and a second click does
nothing. The Critical Vault shows a smaller card instead.

### 4.7 From the generator

*Generate Password → Use in New Credential* opens the type picker and fills
the first password field of the chosen type, shown and badged **Generated**.
A type with no password field warns *"`<Type>` has no password field —
generated password not used"*.

---

## 5. Editing

Edit opens the same form, titled **Edit `<Type>` Credentials**, every field
pre-filled — secrets included. The type cannot change.

- Changed fields are highlighted; the footer counts them (*3 fields changed*).
- **Update Credential** stays dim until something changes; pressing it then
  says *No changes to update*.
- Only changed fields are sent. A secret left blank keeps its saved value.
- Risk and 2FA are locked for anyone who is not the owner or a Vault Admin,
  with the hint *Only the owner or a Vault Admin can change this.*
- Changing the vault (personal ↔ team) or team is for the owner, a Vault Admin
  or the Branch Admin only.
- A save that clears a Password Health issue toasts *N health issues resolved*.

Anyone without Full Access who reaches Edit sees *"Only the owner, a Vault
Admin or someone with Full Access can edit this credential."*

---

## 6. The View drawer

### 6.1 Header and actions

Type icon, name, the URL (a link) or type · group, badges for type, risk and
vault (*Personal vault* / *Team vault* / *Shared with you*). Buttons:

| Button | Rule |
|---|---|
| **Launch** | Always shown in My Vault. Opens the website, else the first saved link (Endpoint URL, Router Admin URL…). Disabled, with *No website or link is saved for this `<Type>`*, when there is none. **High risk asks first**: *Open this High risk credential?* |
| Reveal / Copy `<secret>` | See §6.3 |
| Share | Full Access |
| Bin | as on the row |
| Edit Credential (footer) | Full Access |

Launch showing for every risk level, and asking first on High, is **My Vault
and Password Health only**; Team Vault shows Launch only for a plain URL.

### 6.2 Tabs

| Tab | Content |
|---|---|
| **Overview** | Credential ID, Type, Category, URL / username, Vault, Owner, *Your access* (e.g. *Shared access · View*), Risk, Password strength (bar, x/100), 2FA, rotation and next due date (overdue in red, within 15 days amber), Last updated by, Notes |
| **`<Type>` Details** | Every filled field; a **Recovery & Proof** block; attachments with an *Open* button |
| **Access** | You, then each live share: person or team, permission, end date. Share button for Full Access |
| **Activity** | The credential's audit trail, newest first, *Load more* |

### 6.3 Seeing a secret

| Your access | What you get |
|---|---|
| Use Only | Secrets masked; Reveal disabled (*Your access is Use Only*); no notes, no files |
| View | Secrets readable |
| Copy | + copy buttons |
| Full | + edit, share, delete |

A value revealed through the Reveal button hides itself after 30 seconds; a
copied one clears from the clipboard after 30 seconds.

> **Worth testing.** From the code, the drawer receives secrets already in
> plain text for View and above, so in My Vault the Details tab may print
> them unmasked and the Overview secret card may not appear. Copying a
> secret from the Details tab may also leave no audit entry. See the
> Technical document §9.

---

## 7. Shared By Me

A table of your shares: **Sr. No · Credential ID · Credential Name · Shared
With · Permission · Shared On · Expires · Reason · Status · Action**.

| Status | Meaning |
|---|---|
| Active | live, more than 3 days left or no end |
| Expiring soon | live, under 3 days left |
| Expired | past its end date |
| Revoked | ended by hand |

Expired and revoked rows are dimmed. *Expires* shows the date and *N days
left*, *Nh left*, *Expired N days ago*, or *No expiry · Until revoked*.

Actions: **View credential**, and **Revoke access** (live rows only). Revoke
asks *Revoke access?* — *"They lose access immediately. You can share it
again later."* — and toasts *Access revoked.*

The table lists shares on credentials you own **and** shares you made on
someone else's, in every state and **both vaults**. The tab badge counts only
the **live** shares on credentials **you own**, so the badge and the row count
can differ.

---

## 8. Who sees what

| Person | Sees in My Vault | Rank |
|---|---|---|
| Owner | their own credentials, any scope | Full |
| A share recipient (person, or member of the team shared with) | the shared credential | the share's permission |
| Client admin ("Vault Admin") | every **team** credential of the company, and every credential of every user (listed) | Full on team credentials |
| Branch Admin | team credentials owned by employees of their branch | Full |
| HOD (heads the department in HR) | team credentials of the department | Full over people below them; Copy over peers and seniors |
| Reporting manager, any depth | team credentials of their downline | Full |
| Anyone else | nothing of another person's | — |

A **personal** credential gives nobody but the owner any access unless it is
shared. The client admin, Branch Admin, HOD and managers **see other people's
personal credentials listed** (Team Credentials / All), but those rows have no
actions and opening them says *Credential not found.* — see Technical §6.4.

---

## 9. Sharing

### 9.1 The popup

**Share Credential** — *"Control who can access this credential, how, and for
how long."*

| Section | Field | Rule |
|---|---|---|
| Recipient | Individual / Team | |
| | Share With * | Individuals: active colleagues **in your branch** (client admin: the whole company), never you, the owner, or whoever shared it with you. Teams: departments with members |
| Permission & Duration | Permission | Use Only · View (default) · Copy · Full Access |
| | Access Duration | the policy's options (default 1, 7, 30 days), or a date from tomorrow |
| | What the recipient can do | six ticks: Sign in / autofill · See · Copy · Edit · Re-share · Delete |
| Reason for Sharing | Reason | required (5+ characters) when the policy says so — on by default |

A note says *External sharing is off by policy — use Secure Send or Vendor
access for outsiders.*

### 9.2 Rules

1. **Only Full Access can share.**
2. Never with the owner, never with yourself.
3. **Never back** to the person who shared it with you — the popup hides them
   and says *"`<name>` shared this with you, so they are not in the list —
   it can't be shared back."*
4. **Individual shares stay inside your branch**; the client admin shares
   company-wide. Team shares are not branch-limited.
5. A share must end within the policy maximum (30 days by default). With the
   policy at *No limit*, *No expiry* is offered.
6. If you hold Full Access through a share, anything you share ends when your
   own access ends; the toast says *"It ends on dd/mm/yyyy, when your own
   access does."*
7. Sharing again with the same person or team **updates** that share.
8. The recipient gets a bell notification and an email (no secret in it).
9. If your own Full Access ends, every share you made on that credential ends
   too.
10. Critical-credential rules (no Full Access, must end, can be switched off by
    policy) apply only to Critical Vault credentials.

---

## 10. Removing

| Your relation | Button | Dialog | Result |
|---|---|---|---|
| Full Access, not via a share | Move to Bin | **Move to Recycle Bin** — *Removed from My Vault* (or *Team Vault*), *Access for N shared people is paused*, *Restorable for N days*, *Permanently deleted on `<date>`*; tick *Yes, move `<name>` to the recycle bin* | *"“…” moved to the Recycle Bin. It can be restored for 30 days."* |
| Reached by a share | Remove from your vault | **Remove from your vault?** — *The original stays with its owner.*; tick *I understand and want to remove it.* | Your share ends; the owner's copy is unchanged |

A credential that reaches you only through a **team** share cannot be removed
that way: *"This credential is shared with your whole team. Ask the owner to
remove the team share."*

The retention (default 30 days) is the branch's period — see the Recycle Bin
documents.

---

## 11. Generate Password

**Generate Password** — *"Cryptographically random, generated on your device —
never sent anywhere."*

| Setting | Options |
|---|---|
| Mode | **Characters** (default) · **Passphrase** (words from a 7,776-word list) |
| Length | 12–64, default 20 · Words 4–10, default 6 |
| Characters | Uppercase · Lowercase · Numbers · Symbols · Avoid ambiguous (`I l O o 0 1`) — all on |
| Passphrase | Capitalise words · Add a number · Separator (Hyphen / Dot / Underscore / Space) |

A strength meter shows Fair / Good / Strong and the bits. Turning off a set
that the policy minimum needs is refused: *Needed for the policy minimum
(Good)*; turning off the last set: *Keep at least one character set on*. At a
minimum of Good, *Add a number* is always on.

Buttons: Regenerate · Copy (*Password copied to clipboard*, clears in 30 s) ·
**Use in New Credential** (disabled below the policy minimum).

The small ↻ button inside any password field of the form makes a 20-character
password the same way.

---

## 12. Business rules QA should never see broken

1. A user with no company (super admin) gets 403 on every CredVault call.
2. A user without *Credentials Vault* view permission gets 403, except the
   client admin.
3. My Vault never saves a credential at risk **Critical**; the API answers
   *"Critical credentials are added in the Critical Vault…"*.
4. Card, Bank, Crypto and SSN / Aadhaar / PAN start at **High**, not Critical.
5. Two credentials of the same type and name for one owner are refused.
6. A password below the policy minimum cannot be saved. The **API** checks it
   only when the secret changes, so an old weak password does not block an
   edit of other fields through the API. **The form checks the current value
   on every save**, so in the UI an old weak password must be replaced before
   anything else can be updated. That is a front/back drift — decide which is
   wanted before writing the test.
7. A credential's type never changes on edit.
8. The Credential ID shown in the form is a preview; two simultaneous saves
   still get different CRD numbers.
9. A personal credential of someone else never opens (404), even for the
   client admin, unless it was shared.
10. Use Only never reveals, copies, sees notes or opens attachments.
11. View reveals but cannot copy (403 on copy).
12. Only Full Access edits, shares or bins.
13. A HOD or Full-share holder cannot move a credential between personal and
    team, or to another team.
14. No share to the owner, to yourself, or back to whoever shared it with you.
15. An individual share outside your branch is refused unless you are the
    client admin.
16. A share longer than the policy maximum is refused; *No expiry* only when
    the policy has no limit.
17. A re-share never outlives the re-sharer's own access.
18. Sharing twice to the same recipient leaves **one** live share.
19. Revoking twice: the second is 409 *This share was already revoked.*
20. Revoking a Full share ends every share its holder made on that credential.
21. "Remove from your vault" ends only your share; the owner still has it.
22. Moving to the bin keeps the shares but nobody can open the credential
    until it is restored.
23. A reveal hides after 30 s; a copy clears the clipboard after 30 s.
24. Every reveal and copy through the Reveal / Copy buttons is in Activity.
25. The generator never offers *Use in New Credential* below the policy
    minimum.

---

## 13. Roles and terms

| Term in the UI | Who it is in the code |
|---|---|
| Vault Admin | the client admin (`user_type = client_admin`) — nobody else |
| Branch Admin | a branch user (`user_type = branch_user`) |
| HOD | the employee named as `head` of a department in HR, matched by name to exactly one active employee |
| Manager | anyone above the owner in the HR reporting line |
| Team | a department |

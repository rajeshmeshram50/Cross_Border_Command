# CredVault Critical Vault — Functional Documentation

| | |
|---|---|
| **Jira** | GT-107 (parent GT-79 — CredVault Critical Vault Documentation) |
| **Module** | CredVault → Vault Management → Critical Vault |
| **Audience** | Product, QA, support, business users, developers new to the module |
| **Companion documents** | Technical Documentation · API Documentation · Code Walkthrough · Access Request Management |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains what the Critical Vault does, screen by screen and scenario by scenario, using the exact words the user sees. It covers adding a critical credential, choosing its protection, linking the 2-step method, and every path a request can take from **Request access** to **Locked again**. Read it to understand the feature, to test it, or to answer a user's question. For how it is built, read the Technical Documentation and the Code Walkthrough.

### 1.2 The feature in one paragraph

The Critical Vault holds the company's **most sensitive credentials** — bank and net-banking logins, tax and government IDs, root and server passwords, crypto wallets, treasury and payment accounts. A critical credential is **never simply opened**. To see or copy its secret, a person raises an **access request** that passes up to three steps — **Vault Admin approval**, **Reporting Manager approval** and a **2-step code** — and the credential then opens for a **short time window** only (5, 15, 30 or 60 minutes). When the window ends it **locks again by itself**. The **Vault Admin** of a branch is the only person who opens the branch's critical credentials directly. Every request, decision, reveal and copy is recorded.

### 1.3 Key ideas to understand first

| Idea | What it means |
|---|---|
| Critical credential | A credential in the Critical Vault, at risk **Low**, **Medium**, **High** or **Critical**, numbered **CCRD-0001, CCRD-0002 …** (a separate series from My Vault's CRD-). Every one of them is locked behind the protection steps |
| Vault Admin | The **Branch User** of a branch. They approve the Vault Admin step for requests raised in their branch, and open their branch's critical credentials **directly**, with no request |
| Protection steps | Up to three steps chosen per credential: **1 · Vault Admin**, **2 · Manager**, **3 · 2-step code**. They always run in this order; a step switched off is skipped |
| Access request | One person's request to open one credential. Numbered **REQ-…**. Its steps are fixed the moment it is raised |
| Forward | After the Vault Admin approves, the **requester** sends the request on to their manager with **Send to ‹manager›**. It does not move by itself |
| Unlock window | The minutes the credential stays open for the requester after every step has passed |
| 2-step method | **Authenticator app** (a code from Google / Microsoft Authenticator, Authy …) or **Gmail** (a code emailed to an inbox). Chosen and verified in the form |

---

## 2. Where It Lives

### 2.1 Navigation

| | |
|---|---|
| **Menu** | Top bar → **CredVault** → **Vault Management** → **Critical Vault** (*High-risk credentials behind extra approval.*) |
| **URL** | `/credentials-vault/critical-vault` (adding `?action=add` opens the Add form straight away) |
| **Who sees the menu** | Anyone with **view** permission on the module *Credentials Vault* in Permissions |

> **Explanation.** Without that permission, every CredVault call is refused with *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."*

### 2.2 Screens

| Screen | Opens from |
|---|---|
| Critical Vault page (tabs and the credential list) | The menu |
| Add Critical Credential form | **Add Critical Credential** in the header |
| Edit form | **Edit** on a row, or **Edit** in the View drawer |
| Unlock popup — *Unlock critical credential* | The **Unlock credential** button (lock icon) on a row, or the clock icon while a request is waiting |
| View drawer | The eye button (Vault Admin), or **Full details** in the unlock popup |
| Share popup | **Share** in the View drawer |
| Move to Recycle Bin confirmation | The bin button on a row |
| Access Request Management | Where the Vault Admin and the manager approve or reject — see that module's documentation |

---

## 3. Page Header and Brief Panel

### 3.1 Header strip

| Element | Text |
|---|---|
| Title | **Critical Vault** |
| Subtitle | *High-risk credentials such as bank, tax, root and treasury accounts — unlocked only after approval, for a limited time.* |
| Button | **Add Critical Credential** |

### 3.2 Brief panel

Label **Critical Vault** — *Protecting the company's most sensitive credentials with approval-based, time-limited access and a full record of every use.* Four steps:

| # | Step | Text |
|---|---|---|
| 1 | **Request Access** | *Ask for access to a critical credential with a reason and how long you need it.* |
| 2 | **Get Approval** | *The credential owner or an admin reviews the request and approves or rejects it.* |
| 3 | **Unlock for a Limited Time** | *Approved access opens a short unlock window; every reveal and copy is recorded.* |
| 4 | **Auto-Lock & Review** | *Access locks again automatically when the window ends, and all activity is kept for review.* |

> **Known problem.** Step 2 says *"The credential owner or an admin reviews the request"*. The owner never approves a request. The approvers are the **Vault Admin** (the Branch User) and the requester's **reporting manager** (section 8).

---

## 4. The Credential List

### 4.1 Tabs

| Tab | Shows |
|---|---|
| **All Critical Credentials** | Every critical credential the user can see |
| **My Critical Credentials** | Critical credentials the user owns |
| **Teams Critical Credentials** | Critical credentials owned by **someone else** |

Each tab shows a count. Switching tabs or changing the search goes back to page 1.

### 4.2 Search

Placeholder: *Search by credential ID, name, category, username or owner...* It also matches the website, the risk word and the strength word. The tab counts follow the search.

### 4.3 Columns

Columns, in order: **Sr. No** · **Credential ID** (CCRD-) · **Credential Name** · **Category** · **Username** · **Owner** · **Risk** · **Strength** · **2FA** · **Last Updated** · **Access Status** · **Action**. The Access Status column:

| Access Status | Shown when | Second line |
|---|---|---|
| **Vault Admin** (eye icon) | The viewer is the Vault Admin of this credential's branch | *Full access · no approval* |
| **Locked** | No open request | *Approval needed* |
| **Locked** | The viewer's window has just run out | *Window ended · request again* |
| **Pending** (spinner) | Waiting for the Vault Admin, the forward, or the manager | The role and name, e.g. *Vault Admin · Ravi Kumar* or *Manager · Kavya Rao*. Before the forward it already reads *Manager · ‹name›* |
| **In progress** (clock) | Approvals done; the 2-step code is still to be entered | *Step n of m · Authenticator* |
| **Unlocked** | Inside the viewer's window | ***mm:ss* left**, with a progress bar; it turns to a warning colour in the last minute |

> **Known problem.** *In progress* always reads *· Authenticator*, even when the credential's 2-step method is **Gmail**. And while a request waits for the **requester** to forward it, the row already reads *Pending · Manager · ‹name›* — it looks as if the manager has it. Only the unlock popup shows **Send to ‹manager›**.

### 4.4 Row actions

| Button | Behaviour |
|---|---|
| **Edit** | Opens the Edit form. Greyed out without Full Access |
| **Unlock / View** | The icon and its tooltip follow the state: lock icon (*Unlock credential*), clock icon (*Waiting for approval — view request* / *Continue unlocking*), open-lock icon (*Unlocked — view credential*), eye icon (*View credential*) for the Vault Admin. Opens the unlock popup, or the View drawer for the eye |
| **Move to Bin** | Opens the bin confirmation. Greyed out unless the user may delete it (section 16) |

There is no Share button on the row; sharing is done from the View drawer.

### 4.5 Live behaviour

| Situation | What the list does |
|---|---|
| A row is **Pending** or **In progress** | Refreshes quietly every **15 seconds** (paused while a popup is open). The unlock popup itself checks every 15 seconds only while the request is **Pending**, not on the code stage |
| A row is **Unlocked** | The countdown ticks every second |
| A window reaches 0 | The row shows *Locked · Window ended* at once, and the list reloads |

### 4.6 Empty states

| Case | Title | Sub-text |
|---|---|---|
| Nothing yet (All) | *No critical credentials yet* | *Critical credentials you add, or that your team owns, will appear here.* |
| Nothing yet (Mine) | *No critical credentials yet* | *Critical credentials you add will appear here.* |
| Nothing yet (Teams) | *No critical credentials yet* | *Critical credentials owned by your team will appear here.* |
| Search with no match | *No credentials match your search* | *Try a different credential ID, name, category, username or owner.* |
| Load failed | *Could not load critical credentials* | The server's message |

The page size can be changed in the pager (10 rows by default).

---

## 5. Adding a Critical Credential

### 5.1 The form

**Add Critical Credential** first opens the type picker, then the same credential form as My Vault, for the same **25 types** (Login, Bank Account, Credit Card, SSH Key, Database, Server, API Credentials, SSN / Aadhaar / PAN, Crypto Wallet …).

| Item | Add | Edit |
|---|---|---|
| Title | **Add ‹Type› Credentials** | **Edit ‹Type› Credentials** |
| Footer | *Adding a ‹Type› to Critical Vault* · **Change type** | — |
| Buttons | **Save Credential** · **Close** | **Update Credential** · **Close** |
| Success toast | *‹CCRD-nnnn› · ‹name› added* | *‹CCRD-nnnn› · ‹name› updated* (nothing changed: *No changes to update*) |

The differences from My Vault:

| Item | In the Critical Vault |
|---|---|
| Risk Level | **Low**, **Medium**, **High** or **Critical** — **Critical** is chosen by default (see the table below) |
| Code | The next **CCRD-** number, shown as a preview; it is taken only when the credential is saved |
| Protection | The **Critical Access Protection** section (5.2) — for **every** risk level |

**Risk Level** dropdown (required):

| Option | In Add | In Edit | Where it is saved |
|---|---|---|---|
| **Low** | Can be picked | Can be picked | The **Critical Vault**, with a **CCRD-** number |
| **Medium** | Can be picked | Can be picked | The **Critical Vault**, with a **CCRD-** number |
| **High** | Can be picked | Can be picked | The **Critical Vault**, with a **CCRD-** number |
| **Critical — needs approval to view** | Default | Can be picked | The **Critical Vault**, with a **CCRD-** number |

> **Explanation: the risk level does not move a credential.** Everything added from this page is saved through the **Critical Vault API** and stays in the Critical Vault, whatever its risk level. The risk level is a label for how sensitive the credential is; the protection steps lock it in every case.

| Case | What the user sees |
|---|---|
| Add, any risk level | The Protection section shows; on save the credential appears in the Critical Vault list with its **CCRD-** number |
| Edit, the risk level changed | Saved; the credential stays in the Critical Vault with the same **CCRD-** number and the same protection |
| Edit by someone who may not change protection | The Risk Level dropdown is greyed out (section 6); if a change still reaches the server it answers *"Only the owner or a Vault Admin can change the risk level."* |

> **Worth testing.** Add a credential from the Critical Vault at **High**. It must appear in the Critical Vault list (CCRD-), and opening it must go through the unlock steps. Then change it to **Low** on Edit: it must stay in the Critical Vault, locked.

### 5.2 Critical Access Protection

Each step has a **Required / Off** switch. On **Add** all three start at **Required**.

| # | Step | Description shown |
|---|---|---|
| 1 | **Request access to Vault Admin** | *The Vault Admin for this credential's branch (the Branch Admin) must approve, with a reason and a time window. Resolved when access is requested.* |
| 2 | **Request approval from Manager** | *After the Vault Admin approves, the requester's own reporting manager must also approve. Resolved per requester when access is requested.* |
| 3 | **2FA — Authenticator app or Gmail** | *A 6-digit code — from an authenticator app or sent to Gmail — is needed before the credential opens. Choose one below.* |

Footer: *Steps run in this order every time someone tries to reveal or copy this credential. Access locks again when the approved window ends.*

| How many steps | Allowed? |
|---|---|
| **0** — every switch Off | **No.** Save is refused: toast *Turn on at least two protection steps for a critical credential*, and the form scrolls to this section. The server refuses it too |
| **1** — only one step | **No.** Refused with the same message |
| **2** — any two steps | Yes |
| **3** — all steps | Yes |

> **Common misunderstanding.** "One step is enough." No — a critical credential always needs **at least two** of the three steps, and may have all three. Any two can be chosen (Vault Admin + Manager, Vault Admin + 2-step code, or Manager + 2-step code). What is fixed is the **order**: whatever is on always runs Vault Admin → Manager → 2-step code.

| Rule | Detail |
|---|---|
| Types with their own 2FA field (Login, Email, Passkey, Bank Account, Crypto Wallet, Password) | Step 3 has no switch of its own: *Uses the "2FA" field in this form — switch it on and choose an authenticator app or Gmail. A 6-digit code is then needed before this credential opens.* Its chip reads *2FA field is off* while that field is off |
| Who approves | **No approver is picked here.** When a request is raised, the Vault Admin is the Branch User of the **requester's** branch, and the manager is the **requester's own** reporting manager |

> **Common misunderstanding.** "I added the credential, so my manager approves everyone's requests." No — the manager step always goes to **the requester's** reporting manager. Two people requesting the same credential can have two different managers.

### 5.3 Choosing the 2-step method

Card **Two-factor authentication on Kryptone** — *Each time someone opens this credential or copies its password, Kryptone asks for a 6-digit code — from an authenticator app or sent to Gmail.* Then: *How should Kryptone ask for the code? Choose one*

| Option | Sub-text |
|---|---|
| **Authenticator app** | *Scan a QR code once — Google / Microsoft Authenticator, Authy …* |
| **Gmail** | *A 6-digit code is emailed to a Gmail address each time* |

### 5.4 Linking an Authenticator app

| Step | What the user sees and does |
|---|---|
| 1 | *Preparing a setup key for your authenticator app…*, then a QR code (*Scan with your app*) and the title **Link your authenticator app** — *Works with any authenticator app*, with the chips Google Authenticator, Microsoft Authenticator, Authy, Zoho OneAuth, 1Password |
| 2 | **1 · Open your authenticator app** — *Tap + or Add account* |
| 3 | **2 · Scan this QR code** — *Or choose "Enter a setup key" and type the key below*. The **Setup key** bar has a **Copy** button |
| 4 | **3 · Enter the 6-digit code** — *The app shows a new code for Kryptone every 30 seconds — then press Verify & link* |
| 5 | In **Verify your app** the user types the code and presses **Verify & link** (*Codes refresh every 30 seconds*) |
| 6 | Success: **Authenticator app linked** — *Code verified — the app is linked to this credential when you save…*, with **Re-link app** |

The chip next to the step reads *Scan to link* until then, and *App linked* after. Other messages: **Copy** on the setup key → *Setup key copied*; a correct code → *Authenticator app verified — It is linked to this credential when you save.*; a wrong code → *That code is incorrect or expired. Check your app and try again.*

> **Worth testing.** *Shared with a team? Scan this QR code on the phone of everyone who should be able to open this credential.* The code is tied to the **credential**, not to a person: whoever will enter the code needs the same app entry.

### 5.5 Linking Gmail

| Step | What the user sees and does |
|---|---|
| 1 | Types the **Gmail address** (placeholder *name@company.com*) and presses **Send code**. Any email address works, not only Gmail; an invalid one shows *Enter a valid email address, e.g. name@company.com* and **Send code** stays greyed out |
| 2 | A 6-digit code is emailed. The button turns to *Resend in 30s*, then **Resend code** |
| 3 | In **Verify Gmail** — *Code sent to ‹masked address›* — the user types the code and presses **Verify** |
| 4 | Success: **Gmail verified** — *‹address› is linked when you save.* |

Below it, the steps: *Someone opens or copies this credential — Kryptone sends a 6-digit code to this Gmail inbox* · *They enter the code — It works once and expires after 5 minutes* · *The credential opens for 5 minutes — Every code sent and used is logged.*

| Rule | Detail |
|---|---|
| Wrong setup code | *Incorrect code. n attempts left.* — 5 tries, then *Too many wrong codes. Send a new code.* |
| Code too old | *This code has expired. Send a new one.* (a setup code lasts 10 minutes) |
| Sending again too soon | *A code was just sent. Wait 30 seconds before asking for another.* |
| More than 10 codes in an hour | *Too many codes sent in the last hour. Try again later.* |
| Email turned off on the platform | *Email is turned off by the platform admin, so an email code cannot be sent. Use the authenticator app instead.* |
| The mail could not be sent | *The code could not be emailed. Please try again.* |

The step-3 chip reads *Gmail needed* → *Enter the code* → *Gmail verified*. Note under the box: *Shared with a team? Use a Gmail inbox everyone who opens this credential can read.*

> **Worth testing.** Verify the authenticator code, wait more than 25 seconds, then press **Save Credential**: the save must ask for a fresh code. The codes change every 30 seconds, so the server checks the code again at save time.

> **Known problem.** The steps say the code *"expires after 5 minutes"* and the credential *"opens for 5 minutes"*. An emailed code lasts **10 minutes**, and the window is **5 minutes only when the Vault Admin step is off** — with it on, the requester chooses the window (section 7.3).

### 5.6 Saving

| Case | Result |
|---|---|
| Authenticator not linked | Toast *Link your authenticator app to save* |
| Authenticator verified more than 25 seconds before **Save** | Refused: *Enter a fresh authenticator code to save* — *That code has expired. Enter the current 6-digit code from your app, then save again.* |
| Gmail not verified | Toast *Verify the Gmail address to save* (server: *Send a code to … and verify it to link email 2-step, or turn 2-step off.*) |
| The Gmail code was used up meanwhile | *The email code has expired. Send a new code and verify it again.* |
| Saved | The credential gets its **CCRD-** number; secret fields are stored encrypted |

---

## 6. Editing a Critical Credential

| Who | May change |
|---|---|
| The **owner** | Everything, including the protection |
| The **Vault Admin** (Branch User) | Everything, including the protection — on **team** credentials of their branch. On a branch member's **personal** credential the Vault Admin has View only, so Edit is greyed out |
| Anyone else with Full Access (a manager above the owner, an HOD, a Full share) | The **details only** |

For anyone else the form **hides the Critical Access Protection section**, greys out the **Risk Level** dropdown and the type's 2FA switch (tooltip *Only the owner or a Vault Admin can change this.*). If a change still reaches the server, it answers *"Only the owner or a Vault Admin can change the ‹what›."*:

| ‹what› in the message | The change |
|---|---|
| *2-step verification* | Linking a new app or a new Gmail code |
| *2-step method* | Authenticator ↔ Gmail |
| *2-step email* | The Gmail address |
| *risk level* | The risk |
| *two-factor setting* | The type's 2FA field |
| *vault* / *team* | The scope or the department |
| *protection steps* | Any of the three Required / Off switches |
| *approvers* | A pinned approver |

On Edit, a linked method is shown **read-only** — *Authenticator app · selected* or *Gmail · selected*, with *Code from the linked authenticator app* / *Code emailed to a Gmail address*. It **cannot be re-linked from the Edit form**; **Re-link app** appears only in Add, after verifying.

| Case | What the form shows |
|---|---|
| The credential is still locked for you (the owner is not exempt) | *This credential is locked, so its details are not shown. Anything you leave untouched keeps its saved value — fill in only what you want to change.* |
| You have no Full Access | *Could not open the form* — *Only the owner, a Vault Admin or someone with Full Access can edit this credential.* |

> **Known problem.** On Edit of a Gmail-linked credential, the step-3 chip reads *Gmail needed* although the method is linked; only the 2FA card reads *Gmail · selected*.

> **Explanation.** Letting anyone with Full Access switch a step off, or move the 2-step code to their own phone or inbox, would let them open the credential without the approvals. That is why the protection stays with the owner and the Vault Admin.

> **Worth testing.** Edit a request-protected credential while someone's request is in flight. The request keeps the steps it was **raised** with; only new requests use the new protection.

---

## 7. The Unlock Popup

### 7.1 Layout

Title **Unlock critical credential** — *Complete every stage below to reveal this credential.* (once open: **Credential unlocked** — *Access is time-limited and every view is recorded.*). Under it, the credential card: name, **CCRD-** code · type, and the **Critical** flag.

The **stepper** shows one node per step in force, then **Final · Reveal**:

| Node | Label | State text |
|---|---|---|
| Step · Vault Admin | **Vault Admin** | *Request access* (current) · *Awaiting approval* · *Approved · ‹time›* · *Rejected* · *Locked* (not reached) |
| Step · Manager | **Manager** | *Request approval* · *Awaiting approval* · *Approved · ‹time›* · *Rejected* · *Locked* |
| Step · 2-step | **Authenticator** or **Gmail** | *Enter OTP* / *Enter code* · *Verified* · *Locked* |
| Final | **Reveal** | *Locked* · *Unlocked* |

A finished node can be clicked to look back at it (*Go to this stage*); **Previous** / **Next** do the same. Looking back shows *‹role› stage complete — This stage is already done. Use Next to return to where you left off.*

The footer shows dots, **Stage n of m** with the step name (*Vault Admin access*, *Manager approval*, *Authenticator OTP* or *Gmail code*), and the main button.

### 7.2 Stage 1 — Request access from the Vault Admin

| Element | Text |
|---|---|
| Eyebrow / heading | *Stage 1 · Vault Admin* — **Request access from the Vault Admin** |
| Sub-text | *Tell the Vault Admin why you need this credential and for how long. Every request is logged.* |
| Approver card | The Vault Admin's name — *Vault Admin* — *Notified instantly* |
| **Reason for access \*** | Up to 300 characters with a counter (*n / 300*). Placeholder *e.g. Need the bank portal login to complete the month-end tax payment* |
| **How long do you need access?** | Chips **5 min**, **15 min**, **30 min**, **1 hour** — **15 min** is chosen by default |
| Button | **Send request to ‹Vault Admin›** |

| Error | Message |
|---|---|
| Reason under 10 characters | *Please give a reason (at least 10 characters).* |
| No window chosen | *Choose how long you need access.* |

On success: toast *Request sent to ‹name›*, and the row turns **Pending** at once. A refusal (no Vault Admin, no manager, 2-step not linked, the 6-a-day limit) shows as **red text inside this card**, not as a toast. If you already have an open request, an info toast says so and the popup loads that request.

### 7.3 Waiting for an approver

| Element | Text |
|---|---|
| Heading | **Waiting for ‹name›** — *Your request is with the vault admin / manager. You can close this window — progress is saved.* |
| Approver card | ‹name› — *Reviewing…* |
| Status line | ***Request REQ-… sent at ‹time›*** — *‹role› has been notified* |
| Link | **Cancel request** → toast *Request cancelled* |
| Button | ***Waiting for ‹name›…*** (disabled) |

The popup checks again every **15 seconds**, so an approval made elsewhere shows up without closing it. Approved steps are listed above: *✓ Vault Admin ‹name› approved at ‹time› · ‹n› min window*.

### 7.4 Stage 2 — Request approval from your Manager

| Case | Heading and sub-text | Button |
|---|---|---|
| After the Vault Admin approved | **Request approval from your Manager** — *The Vault Admin has approved. Your manager must also approve before the authenticator step.* A summary shows *Your reason*, *Access window* and *Vault Admin ‹name› · Approved* | **Send to ‹manager›** → toast *Forwarded to ‹manager›* |
| No Vault Admin step | *Your manager must approve before the authenticator step / this credential opens. Every request is logged.* | **Send request to ‹manager›** |

> **Common misunderstanding.** "The Vault Admin approved, so it must be with my manager now." It is not. After the Vault Admin step the request waits for **the requester** to press **Send to ‹manager›**; only then is the manager notified. Until then the list already reads *Pending · Manager · ‹name›* (4.3), which is easy to misread. When there is **no** Vault Admin step, the request goes to the manager straight away.

### 7.5 Stage 3 — the 2-step code

**Authenticator app**

| Element | Text |
|---|---|
| Heading | *Stage n · Authenticator* — **Verify with your authenticator app** — *Open the authenticator app linked to this credential and enter the current code.* |
| Code card | **Enter your OTP** — *6-digit code from your authenticator app*; six boxes; *Codes refresh every 30 seconds* |
| Button | **Verify & reveal** (*Verifying…*) |

**Gmail**

| Element | Text |
|---|---|
| Heading | *Stage n · Gmail* — **Verify with your Gmail** — *Kryptone emails a 6-digit code to ‹masked address›. Open the email from Kryptone and enter the code here.* |
| Sending | The **first code is sent automatically** when the request reaches this stage; toast *Code sent to ‹address›* |
| Code card | **Enter the code** — *Press Send code to get one* until a code is sent, then *Sent to ‹address›*; six boxes; **Resend code** (*Resend in ‹n›s* for 30 seconds); after a send: *The code works once and expires in 10 min* |
| Reopening the popup | Sends a **new** code automatically and replaces the earlier one; within 30 seconds of the last send it shows *A code was just sent…* under the boxes |
| Button | **Verify & reveal** |

After a wrong code the footer adds *· n attempts left*. Success: toast *‹name› unlocked for ‹n› min*.

| Error | Message |
|---|---|
| Fewer than 6 digits | *Enter the 6-digit code from your authenticator app.* / *Enter the 6-digit code from the email.* |
| Wrong code (1st or 2nd) | *Incorrect or expired code. n attempts left.* |
| Wrong code (3rd) | Toast *Too many wrong codes — request access again*; the approvals are reset (section 10) |
| Authenticator code used twice | *That code was just used. Wait for the next code in your authenticator app.* (costs no try) |
| Gmail: no live code | *No live email code for this request. Press "Send code" to get one.* (costs no try) |

### 7.6 Final — Reveal

| Element | Text |
|---|---|
| Banner | **Access granted** — who passed it: *Vault Admin ‹name› · Manager ‹name› · 2FA verified* |
| Timer ring | ***mm:ss* until auto-lock** |
| Fields | Each stored field, with **Copy** beside it. Secret fields arrive **already readable** once the credential is unlocked (see the Known problem below) |
| Footer | **All stages complete** — *Auto-locks when the timer ends · every view is logged*; **Full details**, **Lock now** (*Locking…*) |

| Action | Result |
|---|---|
| **Copy** | Copied; toast *Copied to clipboard* |
| **Full details** | Opens the View drawer for the same credential |
| **Lock now** | Locks at once; toast *‹name› is locked again*; the popup closes |
| Errors | *Could not copy*, *Could not lock* as toasts; a load failure shows a red note with **Try again**; a credential with nothing stored shows *No fields stored on this credential.* |
| The timer reaches 0 | Values are dropped; toast *‹name› is locked again — The unlock window ended — send a new request to view it again.* (shown only if this popup saw the credential open). The popup returns to stage 1 with the note below |

> **Known problem — security.** Once a credential is unlocked, the server sends every secret in plain text with the details (`GET /credentials/{id}`). So in this pane secrets are **shown unmasked**, and **Copy** copies them straight from the screen: the clipboard is **not** cleared after 30 seconds, the copy is **not** recorded as a *copy* in Activity, and the owner is **not** notified. A colleague who has only View access can copy too. The 30-second hide / clipboard clear and the owner alert work only through the reveal call (`/reveal`), which this pane does not use. This needs a code fix.

### 7.7 Notes about the last request

When nothing is open, the first stage shows why the last request ended:

| Last request | Note |
|---|---|
| Rejected | ***‹approver›* rejected the previous request — ‹note›. You can send a new one.** |
| 3 wrong codes | *Too many wrong authenticator codes on REQ-… — the approvals were reset. You can send a new request.* |
| Window ended | *Your last unlock window (REQ-…) ended and the credential locked again. You can send a new request.* |

> **Known problem.** The 3-wrong-codes note and the finished 2-step stage (*Authenticator · Code verified · Time-based one-time code (6 digits)*) always say *authenticator*, even when the method is **Gmail**.

---

## 8. The Unlock Flow and Every Combination of Steps

### 8.1 The unlock flow

Follow it from the top: each question has one answer that applies to you. The table under it lists every way a request can end.

```
A Critical Vault credential in the list
│
├── Are you the Vault Admin of this credential's branch?
│   └── YES → eye icon "View credential" · opens directly      ■ OPEN
│
└── NO → click "Unlock credential" (lock icon) → the unlock popup opens
    │
    ├── STEP 1 · Vault Admin step on?
    │   ├── YES → type a reason (10+ chars) · pick 5 / 15 / 30 / 60 min
    │   │         → press "Send request to ‹Vault Admin›"
    │   └── NO  → no reason · window = 5 min
    │             → press "Send request to ‹manager›"
    │
    ├── The server checks the request
    │   ├── Use Only access ................................ ■ REFUSED
    │   ├── Reason under 10 characters / no window ......... error under the field
    │   ├── 6 wrong codes on this credential in 24 h ....... ■ REFUSED
    │   ├── 2-step method not linked ....................... ■ REFUSED
    │   ├── Vault Admin step on, your branch has none ...... ■ REFUSED
    │   ├── Manager step on, you have no manager ........... ■ REFUSED
    │   ├── Already an open request → that request is shown
    │   └── All fine → request REQ-… is raised · the approver is notified
    │
    ├── Waiting for the Vault Admin (when STEP 1 is on)
    │   ├── You press Cancel request ....................... ■ CANCELLED
    │   ├── Vault Admin rejects ............................ ■ REJECTED
    │   └── Vault Admin approves → go to STEP 2
    │
    ├── STEP 2 · Manager step on?
    │   ├── NO  → go to STEP 3
    │   └── YES
    │       ├── After a Vault Admin approval:
    │       │   └── YOU press "Send to ‹manager›"  (it does not move by itself)
    │       ├── No Vault Admin step: it went to the manager when raised
    │       │
    │       ├── You press Cancel request ................... ■ CANCELLED
    │       ├── Manager rejects ............................ ■ REJECTED
    │       └── Manager approves → go to STEP 3
    │
    ├── STEP 3 · 2-step code step on?
    │   ├── NO  → go to UNLOCKED
    │   └── YES → waiting for the code
    │       ├── Authenticator → open the app, type the 6 digits
    │       ├── Gmail         → a code is emailed (lasts 10 min, resend every 30 s)
    │       │
    │       ├── Wrong code, 1st or 2nd → "n attempts left" → try again
    │       ├── Wrong code, 3rd → approvals reset ......... ■ LOCKED (otp_failed)
    │       └── Right code → go to UNLOCKED
    │
    └── UNLOCKED for the chosen window
        ├── Reveal a value → hides again after 30 s
        ├── Copy a value   → clipboard cleared after 30 s  (needs Copy or Full access)
        ├── You press Lock now ............................. ■ LOCKED (manual)
        ├── The credential is moved to the Recycle Bin ..... ■ CANCELLED
        └── The window ends ................................ ■ LOCKED (expired)
            └── To open it again → raise a NEW request (back to the top)
```

| End | Status | What the requester does next |
|---|---|---|
| ■ OPEN | — | Nothing — the Vault Admin opens it directly |
| ■ REFUSED | No request | Fix the cause shown in the message (link the 2-step method, set a manager, wait 24 h …) |
| ■ CANCELLED | `cancelled` | Raise a new request |
| ■ REJECTED | `rejected` | Read the approver's note; raise a new request |
| ■ LOCKED | `locked` (`otp_failed` / `manual` / `expired`) | Raise a new request |

> **Explanation.** A credential always has **at least two** of the three steps on, so a real request passes through at least two of STEP 1, STEP 2 and STEP 3. The order never changes.

### 8.2 Every combination of steps

**A** = Vault Admin, **M** = Manager, **O** = 2-step code. A credential needs **at least 2** steps and can have **all 3**, so there are **4** possible combinations. "Reason + window" means the requester types a reason and picks the window; without the A step there is no reason and the window is **5 minutes**.

| # | Steps on | Flow | Window |
|---|---|---|---|
| 1 | A + M + O | Reason + window → **Vault Admin approves** → requester presses **Send to ‹manager›** → **manager approves** → code → **Unlocked** | Chosen |
| 2 | A + M | Reason + window → Vault Admin approves → **Send to ‹manager›** → manager approves → **Unlocked at once** | Chosen |
| 3 | A + O | Reason + window → Vault Admin approves → code → **Unlocked** | Chosen |
| 4 | M + O | **Send request to ‹manager›** (no reason) → goes **straight** to the manager → manager approves → code → **Unlocked** | 5 min |

---

## 9. Scenarios — People and Edge Cases

### 9.1 Who is asking

| # | Situation | What happens |
|---|---|---|
| 1 | The requester is the **Vault Admin** of the credential's branch | No request. Access Status **Vault Admin · Full access · no approval**; the button is the eye. A request attempt is refused: *"You are the Vault Admin for this branch — open this credential directly."* |
| 2 | The requester is the **owner** (not the Vault Admin) | The owner **is not exempt** and raises a request like anyone else |
| 3 | The requester's reporting manager is also the Vault Admin | The same person gives **both** approvals, as two separate, recorded actions |
| 4 | The requester has only **Use Only** access | Refused: *"Your access is Use Only — there is nothing for you to unlock on this credential."* |
| 5 | A branch colleague who only sees the credential because it is in their branch | Has **View**: may request it, and after unlock may **reveal** but not **copy** (*"Your access lets you view this credential but not copy it."*) |

### 9.2 What can block a request

| # | Situation | Message |
|---|---|---|
| 1 | The A step is on and the requester's branch has **no Vault Admin** | *"Your branch has no Branch Admin (Vault Admin) to approve this. Ask your administrator to assign one."* |
| 2 | The M step is on and the requester has **no reporting manager** in HR | *"You have no reporting manager to approve this. Ask HR to set one, or the owner to change the protection steps."* |
| 3 | The O step is on and the 2-step method was **never linked** | *"2-step verification for this credential has not been linked yet. Ask the owner to link it first."* |
| 4 | The requester already has an **open** request for this credential | *"You already have an open request (REQ-…) for this credential."* — the popup loads that request instead |
| 5 | **6 wrong codes** on this credential in 24 hours | *"Too many wrong 2-step codes on this credential today. Try again tomorrow, or ask the owner to unlock it with you."* |

### 9.3 During and after a request

| # | Situation | What happens |
|---|---|---|
| 1 | An approver **rejects** | The request ends. The requester is notified with the note, or *Not approved at this time* when no note was given. The popup shows the rejection note (7.7) |
| 2 | The requester **cancels** while waiting | Status **cancelled**; it cannot be reopened. A new request can be raised |
| 3 | The credential is **moved to the Recycle Bin** | Every open request on it is cancelled; nothing can be revealed |
| 4 | The **protection is changed** mid-request | The request keeps its original steps |
| 5 | Someone tries to reveal or copy while **locked** | Refused with *"This credential is locked. Request access and complete every unlock step first."* — the popup reloads |
| 6 | The requester closes the popup while waiting | Nothing is lost: *You can close this window — progress is saved.* The row shows where the request stands |
| 7 | The window ends | The credential locks itself. A **new** request is needed; a window cannot be extended |

---

## 10. Wrong Codes and Limits

| Limit | Value | What happens |
|---|---|---|
| Wrong codes per request | **3** | On the 3rd, the request is **locked** and **every approval on it is reset** — the requester starts again from stage 1. The owner is notified (*Wrong 2-step codes*) unless the requester is the owner |
| Wrong codes per person per credential | **6 in 24 hours** | New requests for that credential are refused until older requests leave the 24-hour window |
| Authenticator code | Once | The same code cannot be used twice |
| Emailed unlock code | **10 minutes**, once | A new send replaces the old code |
| Email resend | Once every **30 seconds** | *A code was just sent. Wait 30 seconds before asking for another.* |
| Emails per person | **10 per hour** | *Too many codes sent in the last hour. Try again later.* |

> **Worth testing.** Enter 2 wrong codes, then the right one: it must unlock. Enter 3 wrong codes: the approvals must be gone, and the Vault Admin must approve again.

---

## 11. Approvals and Notifications

The Vault Admin and the manager approve or reject in **Access Request Management** (see that document), each with an optional note.

| Event | Who is notified | Message |
|---|---|---|
| Request raised (A step on) | The Vault Admin named on the request | *Access request to approve — ‹requester› asks to unlock "‹name›" for ‹n› min (REQ-…).* |
| Request raised (no A step, M step on) | The manager | *Access request to approve — ‹requester›'s request to unlock "‹name›" passed the Vault Admin and needs your approval (REQ-…).* |
| Vault Admin approves, M step next | The **requester** | *Vault Admin approved — The Vault Admin approved your request to unlock "‹name›". Forward it to your reporting manager to continue.* |
| Requester forwards | The manager | The same message as above |
| Last approval, code step next | The requester | *Access approved — Your request to unlock "‹name›" is approved. Enter your authenticator code to open it.* |
| Last approval, no code step | The requester | *Access approved — "‹name›" is unlocked for ‹n› min.* |
| Any rejection | The requester | *Access request rejected — ‹role› ‹name› rejected your request to unlock "‹name›": ‹note›* |
| Someone else reveals or copies it | The **owner** | *Critical credential revealed / copied — ‹person› revealed / copied the ‹field› of "‹name›".* |
| 3 wrong codes | The owner | *Wrong 2-step codes — ‹person› entered 3 wrong codes for ‹name›.* |

| Rule | Detail |
|---|---|
| Nobody decides their own request | *"You cannot decide your own request."* |
| Only the person it waits on | *"This request is waiting for ‹name›."* |
| Several Vault Admins in one branch | The request is **named to one of them** — the first active Branch User of the requester's branch (not the requester). Only that person can approve the Vault Admin step |
| The manager cannot act before the forward | *"This request has not been forwarded to the reporting manager yet."* |

> **Common misunderstanding.** "The Vault Admin is the Vault Admin of the credential's branch." For **approving**, it is the Vault Admin of the **requester's** branch. For **opening directly**, it is the Vault Admin of the **credential's** branch.

---

## 12. Locking

| How | Who | Result |
|---|---|---|
| The window ends | Automatic | Status **locked**, reason *expired*; recorded as *Unlock window ended — locked again* |
| **Lock now** | The requester, or the Vault Admin | Status **locked**, reason *manual* |
| 3 wrong codes | Automatic | Status **locked**, reason *otp_failed*; approvals reset |

> **Explanation.** The list shows *Locked* the second the countdown reaches zero; the server marks the request locked on the next page load. From the moment the window ends the secret is refused either way.

---

## 13. The View Drawer for a Critical Credential

| Case | What opens |
|---|---|
| The viewer is the Vault Admin of its branch, or the viewer's window is open | The View drawer with the credential's details |
| The credential is still **locked** for the viewer | The **unlock popup** opens instead of the drawer |
| The window ends while the drawer is open, and a reveal or copy is tried | The drawer reloads and returns to the unlock popup |

What is different from a My Vault credential:

| Item | In the Critical Vault |
|---|---|
| Warning note | *Critical credential — handle with care. Reveals and copies are recorded in Activity.* |
| Secret fields | Shown hidden (••••) even after unlock; the eye (*Show ‹field›* / *Hide ‹field›*) shows them. The value is already in the page, so showing it is not recorded and it does not hide again by itself |
| Copy | Copies the value directly; the clipboard is not cleared afterwards (see the security Known problem in 7.6) |
| Access line | For a branch colleague: *Branch · View after approval* |
| **Launch** | Shown only when a website is saved. Opens the site in a new tab **straight away** (no confirmation) and is recorded in Activity as *Launched ‹url›* |
| Attachments | Open only while unlocked; with Use Only: *Your access is Use Only — attachments are not included.* |

---

## 14. Sharing a Critical Credential

Sharing is done from **Share** in the View drawer, by someone with Full Access. A critical credential has stricter rules than a My Vault one:

| Rule | Message |
|---|---|
| **Full Access** cannot be given | The option is greyed out (*Not allowed for Critical credentials*); *"A critical credential cannot be shared with Full Access."* |
| An **end date** is required — *No expiry* is not allowed | *"A critical credential must be shared with an end date."* |
| Default permission | **Use Only** (a My Vault credential defaults to View) |
| Section sub-text | *Critical credential — Full Access and No expiry are disabled* |

> **Common misunderstanding.** "It was shared with me, so I can open it." A share decides **how much** you may do (Use Only, View, Copy); it does **not** skip the steps. The person it is shared with still raises an access request and passes every step, like anyone else.

---

## 15. What Is Recorded, and What Never Leaves

Every step is written to the credential's **Activity** and the **Audit Log**:

| Action | Recorded as |
|---|---|
| Request raised | *Access requested for ‹n› min — ‹reason›* |
| Vault Admin / manager decision | *‹role› ‹name› approved / rejected REQ-…* |
| Forward | *Request REQ-… forwarded to the reporting manager* |
| Cancel | *Request REQ-… cancelled by requester* |
| Email code sent | *Email code sent for request REQ-… · ‹address›* |
| 3 wrong codes | *3 wrong 2-step codes — approvals reset* |
| Unlock | *Unlocked for ‹n› min after all checks passed* |
| Reveal / copy | *‹field› revealed / copied* |
| Lock now / window ended | *Credential locked again* / *Unlock window ended — locked again* |
| Moved to the bin | *Moved to Recycle Bin* |

| Rule | Detail |
|---|---|
| Backups | A CredVault **backup never contains Critical Vault credentials** — a backup is the My Vault / Team Vault file only |
| Export | The Critical Vault page has no Export button |

---

## 16. Moving to the Recycle Bin

| Who may | Message on refusal |
|---|---|
| The **owner**, and the **Vault Admin** (Branch User) for **team** credentials of their branch | Anyone else: *"A critical credential can only be moved to the bin by its owner, a Vault Admin or the Branch Admin."* |

The confirmation is **Move to Recycle Bin** — *You can restore it any time within ‹n› days*, with three points: *Removed from Critical Vault*, *Restorable for ‹n› days — by the Branch Admin only*, *Permanently deleted on ‹date›*. Tick *Yes, move ‹name› to the recycle bin*, then **Move to Bin** (*Moving to Bin…*; the popup is locked while it runs).

On success: *"‹name› moved to the Recycle Bin. It can be restored for ‹n› days — by the Branch Admin."* The number of days is the Recycle Bin's retention period for that branch. Its shares pause, and every open request on it is cancelled.

---

## 17. Status Model

### 17.1 Request status

| Status | Meaning | Moves to |
|---|---|---|
| `pending` | Waiting for the Vault Admin, the forward, or the manager | `approved`, `unlocked`, `rejected`, `cancelled` |
| `approved` | Every approval in; waiting for the 2-step code | `unlocked`, `locked`, `cancelled` |
| `unlocked` | Inside the window | `locked`, `cancelled` (moved to the bin) |
| `locked` | The window ended, **Lock now**, or 3 wrong codes | — final |
| `rejected` | An approver said no | — final |
| `cancelled` | The requester withdrew it, or the credential went to the bin | — final |

`pending`, `approved` and `unlocked` count as **open**; one person may have only one open request per credential.

### 17.2 Why a request was locked

| Reason | Meaning |
|---|---|
| `expired` | The window ran out |
| `manual` | **Lock now** was pressed |
| `otp_failed` | 3 wrong codes — approvals reset |

### 17.3 One request, step by step (A + M + O)

| # | What happens | Status after | Other outcome |
|---|---|---|---|
| 1 | The requester sends the reason and window | `pending` (Vault Admin) | **Cancel** → `cancelled` |
| 2 | The Vault Admin approves | `pending` (awaiting forward) | **Reject** → `rejected` |
| 3 | The requester presses **Send to ‹manager›** | `pending` (manager) | **Cancel** → `cancelled` |
| 4 | The manager approves | `approved` | **Reject** → `rejected` |
| 5 | The requester enters the right code | `unlocked` | 3 wrong codes → `locked` (`otp_failed`) |
| 6 | The window ends, or **Lock now** | `locked` (`expired` / `manual`) | — |

---

## 18. Who Sees What

| Role | Sees in the list | Opens a secret | Approves | Edits protection | Moves to Bin |
|---|---|---|---|---|---|
| **Vault Admin** (Branch User) | Every critical credential of their branch | **Directly** — no request (copy still needs Copy or Full access) | The **Vault Admin** step for requests raised in their branch | Team credentials of their branch | Team credentials of their branch |
| **Owner** | Their own critical credentials | Through a request — **not exempt** | — | Yes | Yes |
| **Reporting manager** | Their branch's critical credentials, plus their team's | Through a request | The **Manager** step for their own direct reports, after the forward | No — details only, with Full Access | No |
| **Employee** | Every critical credential of their branch, their own, those shared with them | Through a request | — | No | Only their own |
| Someone with **Use Only** | The row | Never — nothing to reveal | — | No | No |

> **Explanation.** Everyone in a branch can **see that** a critical credential exists — its name, type and owner — so they know what to ask for. The secret opens only through the steps.

---

## 19. Business Rules

| ID | Rule |
|---|---|
| BR-01 | Every credential added from the Critical Vault is saved in the Critical Vault and numbered **CCRD-nnnn**, per company, at any risk level (Low, Medium, High, Critical; Critical by default). Changing the risk level on Edit never moves it out of the Critical Vault |
| BR-02 | A secret is returned only to someone with an **open window** for it, or to the **Vault Admin** of its branch |
| BR-03 | The owner is **not** exempt from the steps |
| BR-04 | A step is in force only when it is switched on for the credential |
| BR-05 | The steps always run **Vault Admin → Manager → 2-step code** |
| BR-05a | A critical credential needs **at least two** protection steps and may have all three; it cannot be saved with fewer than two |
| BR-06 | With the Vault Admin step on, a reason of at least **10 characters** and a window are required; without it there is no reason and the window is **5 minutes** |
| BR-07 | The window is **5, 15, 30 or 60 minutes**, chosen by the requester when the Vault Admin step is on |
| BR-08 | One person may have only **one open request** per credential |
| BR-09 | Nobody decides their own request |
| BR-10 | The Vault Admin step is decided by the Vault Admin (Branch User) of the **requester's** branch named on the request — the first active one, never the requester |
| BR-11 | The Manager step is decided only by the **requester's own** reporting manager, and only after the requester **forwards** it (when there is a Vault Admin step) |
| BR-12 | Any rejection ends the request |
| BR-13 | **3 wrong codes** lock the request and reset its approvals; **6 wrong codes per credential in 24 hours** block new requests |
| BR-14 | A request cannot be raised while the 2-step method is not linked, the branch has no Vault Admin (A step), or the requester has no manager (M step) |
| BR-15 | The window ends by itself; **Lock now** is for the requester and the Vault Admin |
| BR-16 | A window cannot be extended; a new request is needed |
| BR-17 | A request keeps the steps it was raised with |
| BR-18 | Only the owner, or the Vault Admin on a **team** credential of their branch, may change a credential's protection |
| BR-19 | Only the owner, or the Vault Admin on a **team** credential of their branch, may move a critical credential to the Recycle Bin; doing so cancels its open requests |
| BR-20 | Through the reveal call, a revealed value hides after **30 seconds** and a copied value is cleared after **30 seconds** (the unlocked popup and drawer do not use it yet — Known problem 8) |
| BR-21 | The 2-step method must be verified before the credential can be saved |
| BR-22 | The owner is notified when someone else reveals or copies the credential through the reveal call, and when someone enters 3 wrong codes |
| BR-23 | A critical credential is never shared with Full Access, and always with an end date |
| BR-24 | A share does not skip the steps: the recipient still raises an access request |
| BR-25 | A locked critical credential opens the unlock popup, never the View drawer (except for the Vault Admin of its branch) |
| BR-26 | Critical Vault credentials are never included in a CredVault backup |

---

## 20. Known Problems and Limitations

| # | Item |
|---|---|
| 1 | The brief panel says the **owner** or an admin approves (3.2); the approvers are the Vault Admin and the requester's manager |
| 2 | The Gmail steps in the form say the code expires after **5 minutes** and the credential opens for **5 minutes** (5.5); the code lasts 10 minutes and the window is chosen when the Vault Admin step is on |
| 3 | *In progress* in the list, the finished 2-step stage, the 3-wrong-codes note and the *Access approved* notification say **Authenticator** even for Gmail (4.3, 7.7, 11). The manager's notification says *passed the Vault Admin* even when there is no Vault Admin step |
| 4 | After the Vault Admin approves, the request does **not** move to the manager by itself; the requester must press **Send to ‹manager›** |
| 5 | **Cancel request** is shown only while waiting for an approver, not on the code stage, although the server allows cancelling there too |
| 6 | A window cannot be extended |
| 7 | With no reporting manager in HR, or no Vault Admin in the branch, a credential that needs that step cannot be unlocked until the gap is filled |
| 8 | **Security:** once unlocked, secrets reach the screen in plain text; showing and copying them in the popup and the drawer is not recorded, the clipboard is not cleared and the owner is not alerted (7.6) |
| 9 | Before the forward, the list already reads *Pending · Manager · ‹name›*, as if the manager had it (4.3) |
| 10 | On Edit of a Gmail-linked credential the step-3 chip reads *Gmail needed* (6) |
| 11 | In a branch with several Vault Admins, only the one named on the request (the first active Branch User) can approve it |

---

## 21. Roles and Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The **Branch User** of a branch; approves the Vault Admin step for their branch's requesters and opens their branch's critical credentials directly |
| Requester | The person who raised the request |
| Reporting manager | The requester's manager in HR; decides the Manager step |
| Owner | The person who added the credential |
| CCRD- | The Critical Vault's credential numbers |
| REQ- | Access request numbers |
| Unlock window | The minutes the credential stays open for the requester |
| Forward | The requester's **Send to ‹manager›** after the Vault Admin approved |
| 2-step code | The 6-digit code from the authenticator app or the Gmail inbox |
| Use Only / View / Copy / Full | Access levels: sign in only · see the secret · also copy it · also edit, share and bin |

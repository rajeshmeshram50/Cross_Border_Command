# CredVault Access Request Management — Functional Documentation

| | |
|---|---|
| **Jira** | To be added (parent — CredVault Access Request Management Documentation) |
| **Module** | CredVault → Access Request Management |
| **Audience** | Product, QA, support, business users, developers new to the module |
| **Companion documents** | Technical Documentation · API Documentation · Code Walkthrough · Critical Vault Functional Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains what the Access Request Management page does, screen by screen and scenario by scenario, using the exact words the user sees. It covers who sees which requests, who may approve or reject them, every status a request can show, the buttons and dialogs, and what happens in every combination of steps. Read it to understand the page, to test it, or to answer a user's question. The request itself is raised in the Critical Vault — see the Critical Vault Functional Documentation for that side.

### 1.2 The feature in one paragraph

Access Request Management is the **approval desk** for the Critical Vault. When someone asks to open a Critical Vault credential, their request (**REQ-0001, REQ-0002 …**) lands here. The **Vault Admin** (the Branch User of the requester's branch) approves or rejects it first; the requester then forwards it, and their **Reporting Manager** gives the second approval. Each row shows the credential, the requester, the reason, the access window, both approvers with their decision and time, and the current status — with a live countdown while the credential is unlocked. The requester uses the same page to follow their own requests, cancel one that is still open, and lock a live window early.

### 1.3 Key ideas to understand first

| Idea | What it means |
|---|---|
| Access request | One person's request to open one Critical Vault credential, numbered **REQ-nnnn** per company |
| Vault Admin | The **Branch User** of a branch. Decides the **Vault Admin** step for requests raised by people of their branch |
| Reporting Manager | The requester's own manager in HR. Decides the **Reporting Manager** step |
| Steps | Up to three, always in the order **Vault Admin → Reporting Manager → 2-step code**. A request has at least two of them. Only the two approvals are decided on this page; the code is entered by the requester in the Critical Vault |
| Forward | After the Vault Admin approves, the **requester** presses **Send to ‹manager›** in the Critical Vault. Only then can the manager act |
| Access window | How long the credential stays open once every step has passed: 5 min, 15 min, 30 min or 1 hour |
| Status | What the row shows: **Pending**, **Approved**, **Unlocked**, **Rejected**, **Cancelled** or **Reset** |

---

## 2. Where It Lives

### 2.1 Navigation

| | |
|---|---|
| **Menu** | Top bar → **CredVault** → **Vault Administration & Security** → **Access Request Management** (*Approve or reject requests for critical credentials.*) |
| **URL** | `/credentials-vault/access-requests` |
| **Bell notification** | *Access request to approve* — clicking it opens this page |
| **Who sees the menu** | Anyone with **view** permission on the module *Credentials Vault* in Permissions |

> **Explanation.** Without that permission, every CredVault call is refused with *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."*

### 2.2 Screens

| Screen | Opens from |
|---|---|
| Access Request Management page (tabs and the request list) | The menu, or the bell notification |
| Reject access request? dialog | **Reject** on a row |
| Cancel this request? dialog | **Cancel** on a row |
| Lock this credential now? dialog | **Lock now** on a row |
| Critical Vault page | **Critical Vault** in the header |

---

## 3. Page Header and Brief Panel

### 3.1 Header strip

| Element | Text |
|---|---|
| Title | **Access Request Management** |
| Subtitle | *Review requests to unlock critical credentials — each request needs approval from the Vault Admin and the Reporting Manager.* |
| Button | **Critical Vault** — opens the Critical Vault page |

### 3.2 Brief panel

Label **Access Request Management** — *Controlling who can unlock critical credentials with two-person approval and time-limited access.* Four steps:

| # | Step | Text |
|---|---|---|
| 1 | **Receive Request** | *A request is raised from the Critical Vault with a reason and the access window needed.* |
| 2 | **Vault Admin Review** | *The Vault Admin checks the reason and approves or rejects the request first.* |
| 3 | **Reporting Manager Approval** | *After the Vault Admin, the requester's reporting manager gives the second approval.* |
| 4 | **Time-limited Access** | *Once both approve, the credential unlocks for the requested window and then locks again.* |

> **Common misunderstanding.** "Every request needs both approvals." The brief panel describes the full flow. A credential may have only one of the two approval steps (plus the 2-step code), so some requests have only a Vault Admin or only a Reporting Manager (section 8).

---

## 4. The Request List

### 4.1 Tabs

| Tab | Shows | Empty text |
|---|---|---|
| **All Requests** | Every request the user can see, in any status | *No access requests yet* |
| **Pending Requests** | Waiting for the Vault Admin or the Reporting Manager | *No pending requests* |
| **Approved Requests** | Passed their approvals: waiting for the code, unlocked, or locked again after the window. Requests reset by wrong codes are **not** here | *No approved requests* |
| **Rejected Requests** | Refused at either step | *No rejected requests* |

Each tab shows a count. Under the empty text: *Requests raised from the Critical Vault will appear here.*

> **Explanation.** The counts **ignore the search box** — they always show the full totals — while the list follows the search.

### 4.2 Search

Placeholder: *Search by request ID, credential, requester, reason or window...*

| You can search by | Example |
|---|---|
| Request ID | *REQ-0042* |
| Credential name, CCRD- number, category or type | *Treasury*, *CCRD-0007*, *Finance*, *Bank* |
| Requester's name or department | *Arjun*, *Accounts* |
| Reason | *payment* |
| Either approver's name | *Rohan* |
| Access window | *15*, *15 min*, *1 hour* |

No match: *No requests match your search* — *Try a request ID, credential, person, reason or access window.* Changing the search goes back to page 1.

### 4.3 Columns

| Column | Content |
|---|---|
| **Sr. No** | Running number across pages |
| **Request ID** | **REQ-nnnn**, with the date and time it was raised |
| **Credential** | The name with its type icon; below it the CCRD- number, the type, and *In Recycle Bin* when the credential is in the bin. *Deleted credential* when it no longer exists |
| **Requested By** | Initials and name — **You** for your own — with the role line (designation · department, or *Team member* when neither is known) |
| **Reason** | The reason given (full text on hover), or *—* |
| **Access Window** | *5 min*, *15 min*, *30 min* or *1 hour* |
| **Vault Admin** | The Vault Admin approver cell (4.4) |
| **Reporting Manager** | The Reporting Manager approver cell (4.4) |
| **Status** | The status badge and its second line (4.5) |
| **Action** | Approve, Reject, and when allowed Lock now and Cancel (4.6) |

Newest request first; 10 rows per page by default (10 / 25 / 50). The Request ID line reads *DD/MM/YYYY · HH:MM*; a 1-hour countdown starts at *60:00*. Search runs about 0.35 s after you stop typing; the tab counts are blank until the first load.

> **Common misunderstanding.** "Searching *REQ-0015* finds one request." Any number in the search is also matched against the access window, so *REQ-0015* also shows every 15-minute request. Write hours with a space (*1 hour*, *1 hr*) or as *60* — *1h* is read as 1 minute.

### 4.4 Approver cells

| Situation | Cell shows |
|---|---|
| Waiting on this approver | The approver's name — *Pending* |
| Approved | The name of the person who decided — *Approved · HH:MM* |
| Rejected | The name of the person who decided — *Rejected · HH:MM*; hovering shows *Reason: ‹note›* |
| No Vault Admin step on this request | **Vault Admin** — *Not required* |
| No Manager step on this request | **Manager** — *Not required* |
| Manager step, the Vault Admin is still deciding | **Manager** — *After Vault Admin* |
| Manager step, the Vault Admin approved, not forwarded yet | **Manager** — *Awaiting forward* |
| Manager step, the Vault Admin rejected | **Manager** — *Not required* |

### 4.5 Status column

| Badge | Second line | When |
|---|---|---|
| **Pending** | *Step n of m · Vault Admin* / *Step n of m · Reporting Manager* | Waiting for that approver |
| **Pending** | *Vault Admin approved · awaiting forward* | The Vault Admin approved; the requester has not pressed **Send to ‹manager›** yet |
| **Approved** | *Approved · enter the authenticator code* / *Approved · enter the email code* | Approvals done; the requester still has to enter the 2-step code |
| **Unlocked** | ⏱ ***mm:ss* left** (tooltip *Locks again at HH:MM*) | Inside the access window — the countdown ticks every second |
| **Approved** | *Both approvals done* | The window has ended, or was locked early (shown even when the request had only one approval step) |
| **Rejected** | *by Vault Admin* / *by Reporting Manager* | An approver said no |
| **Cancelled** | *Cancelled by requester* | The requester withdrew it, or the credential was moved to the Recycle Bin (that also reads *Cancelled by requester*) |
| **Reset** | *Too many wrong codes — request again* | 3 wrong 2-step codes |

> **Explanation: "Step n of m" counts approvals only.** The 2-step code is not counted here. A request with Vault Admin + Manager + code reads *Step 1 of 2 · Vault Admin*, then *Step 2 of 2 · Reporting Manager*.

### 4.6 Action buttons

| Button | Shown / enabled when | What happens |
|---|---|---|
| **Approve** | Enabled only when the request is waiting **on you** — as its Vault Admin, or as its Reporting Manager after the forward. Tooltip *Approve as Vault Admin* / *Approve as Reporting Manager* | Shows *Approving…*; then a toast (4.7) and the list refreshes |
| **Reject** | Same as Approve. Tooltip *Reject as …* | Opens the reject dialog (section 5) |
| **Lock now** | Shown only while the credential is **unlocked** and you are the requester or the Vault Admin. Tooltip *Lock the credential again before the window ends* | Opens the lock dialog |
| **Cancel** | Shown only to the **requester**, while the request is pending or approved. Tooltip *Withdraw this request* | Opens the cancel dialog |

| Case | What the buttons do |
|---|---|
| Not forwarded yet (manager step) | Approve and Reject are greyed out, tooltip *The requester has not forwarded this to the manager yet* |
| Your own request | Approve and Reject are greyed out — nobody decides their own request |
| A decision was just accepted | That row's Approve and Reject switch off at once and stay off until the refreshed list arrives |
| Working on several rows | Each row is busy on its own; approving one row does not block another |

### 4.7 Messages after an action

| Action | Toast |
|---|---|
| Approve, a Manager step follows | ***REQ-0042* approved · the requester forwards it to the Manager** |
| Approve, nothing else to approve | ***REQ-0042* fully approved** |
| Reject | ***REQ-0042* rejected** |
| Cancel | ***REQ-0042* cancelled** |
| Lock now | ***‹credential name›* locked** |
| The server refused (for example someone else decided first) | **Could not approve** / **Action failed** with the server's message, and the list refreshes |

### 4.8 Live behaviour

| Situation | What the page does |
|---|---|
| Every 30 seconds, while the browser tab is visible | Refreshes the list quietly |
| You come back to the browser tab | Refreshes at once |
| A row is unlocked | The countdown ticks every second |
| The list cannot load | *Could not load requests* with the error and **Try again** — only on a full load (opening the page, changing tab / search / page, Try again). A failed 30-second background refresh shows nothing and keeps the old rows |

---

## 5. The Confirmation Dialogs

All three share one centred dialog. A card shows the credential (name, CCRD- number, type, **REQ-** number) and the requester (name, role line, access window).

| Dialog | Title | Text | Confirm button |
|---|---|---|---|
| **Reject** | **Reject access request?** | *The requester will not be able to unlock this credential. They can raise a new request later.* — plus *Rejecting as **Vault Admin** / **Reporting Manager*** | **Reject Request** (*Rejecting…*) |
| **Lock** | **Lock this credential now?** | *The access window ends now. A new request is needed to unlock it again.* | **Lock Now** (*Locking…*) |
| **Cancel** | **Cancel this request?** | *The approvers will no longer see it. You can raise a new request later.* | **Cancel Request** (*Cancelling…*) |

The dialog closes with its **Cancel** button or a click outside it (not with Esc). While the action runs, it cannot be closed and its buttons are disabled.

> **Worth testing.** In the cancel dialog the two buttons are **Cancel** (close the dialog) and **Cancel Request** (withdraw the request) — easy to confuse.

> **Common misunderstanding.** "I can type why I rejected it." The reject dialog has **no reason box**. The requester always sees *Not approved at this time*.

> **Known problem.** The cancel dialog says *The approvers will no longer see it*, but a cancelled request stays in **All Requests** for everyone who could see it before, approvers included (it shows **Cancelled**).

---

## 6. Who Sees What

| Role | Sees in the list | Approve / Reject | Cancel | Lock now |
|---|---|---|---|---|
| **Vault Admin** (Branch User) | Every request raised by a person of their branch, plus their own | The **Vault Admin** step of the requests that **name them** (BR-05); other branch requests are view-only | Their own requests | Any unlocked request they can see |
| **Reporting Manager** | Their own requests, and the requests that name them as the manager | The **Reporting Manager** step of those requests, after the forward | Their own requests | Their own requests |
| **Employee (requester)** | Requests they raised | — | Their own, while pending or approved | Their own, while unlocked |

| Rule | Detail |
|---|---|
| Nobody decides their own request | A Vault Admin never requests their own branch's Critical Vault credentials — they open them directly (*You are the Vault Admin for this branch — open this credential directly.*). For a credential from another branch, the request goes to another Vault Admin of their own branch; with none, it is refused (*Your branch has no Branch Admin (Vault Admin) to approve this. Ask your administrator to assign one.*) |
| Manager who is also the Vault Admin | The same person approves twice — once as Vault Admin, once as Reporting Manager after the forward — as two separate, recorded actions |
| Company boundary | Requests are shown only within the user's own company |

---

## 7. The Flow on This Page

### 7.1 The flow as a tree

```
A request is raised in the Critical Vault  (REQ-… · status Pending)
│
├── Does it have a Vault Admin step?
│   ├── YES → it waits for the Vault Admin of the requester's branch
│   │   │      Vault Admin column: Pending · Status: Step 1 of n · Vault Admin
│   │   │
│   │   ├── The requester presses Cancel ............... ■ CANCELLED
│   │   ├── Vault Admin presses Reject ................. ■ REJECTED (by Vault Admin)
│   │   └── Vault Admin presses Approve
│   │       ├── a Manager step follows → Status: Vault Admin approved · awaiting forward
│   │       │      Manager column: Awaiting forward · manager's buttons greyed out
│   │       │      └── the requester presses "Send to ‹manager›" in the Critical Vault
│   │       │             → go to the MANAGER STEP
│   │       └── no Manager step → go to AFTER THE APPROVALS
│   │
│   └── NO → it goes straight to the requester's manager → MANAGER STEP
│
├── MANAGER STEP — Manager column: Pending · Status: Step n of n · Reporting Manager
│   ├── The requester presses Cancel ................... ■ CANCELLED
│   ├── Manager presses Reject ......................... ■ REJECTED (by Reporting Manager)
│   └── Manager presses Approve → AFTER THE APPROVALS
│
└── AFTER THE APPROVALS
    ├── A 2-step code step? → Status: Approved · enter the … code
    │   ├── the requester enters the right code in the Critical Vault → UNLOCKED
    │   ├── 3 wrong codes .................................. ■ RESET
    │   └── the requester presses Cancel ................... ■ CANCELLED
    ├── No code step → UNLOCKED at once
    │
    └── UNLOCKED — Status: Unlocked · mm:ss left
        ├── Lock now (requester or Vault Admin) ............ ■ APPROVED · Both approvals done
        ├── The window ends ................................ ■ APPROVED · Both approvals done
        └── The credential is moved to the Recycle Bin ..... ■ CANCELLED
```

| End | Status shown | Tab |
|---|---|---|
| ■ CANCELLED | **Cancelled** · *Cancelled by requester* | All Requests only |
| ■ REJECTED | **Rejected** · *by Vault Admin* / *by Reporting Manager* | Rejected Requests |
| ■ RESET | **Reset** · *Too many wrong codes — request again* | All Requests only |
| ■ APPROVED | **Approved** · *Both approvals done* | Approved Requests |

### 7.2 Every combination of steps

A request always has **at least two** of the three steps.

| # | Steps | What the approvers see on this page | Forward needed? |
|---|---|---|---|
| 1 | Vault Admin + Manager + code | *Step 1 of 2 · Vault Admin* → *awaiting forward* → *Step 2 of 2 · Reporting Manager* → *Approved · enter the … code* → *Unlocked* | Yes |
| 2 | Vault Admin + Manager | *Step 1 of 2 · Vault Admin* → *awaiting forward* → *Step 2 of 2 · Reporting Manager* → *Unlocked* at once | Yes |
| 3 | Vault Admin + code | *Step 1 of 1 · Vault Admin* → *Approved · enter the … code* → *Unlocked*. Manager column *Not required* | No |
| 4 | Manager + code | *Step 1 of 1 · Reporting Manager* from the start → *Approved · enter the … code* → *Unlocked*. Vault Admin column *Not required* | No |

> **Explanation: the access window.** With a Vault Admin step the requester chose the window (5, 15, 30 or 60 minutes) and gave a reason. Without one (combination 4) there is no reason (*—*) and the window is always **5 min**.

---

## 8. Scenarios and Edge Cases

| # | Situation | What happens |
|---|---|---|
| 1 | The manager tries to act before the forward | Buttons greyed out, tooltip *The requester has not forwarded this to the manager yet*. If called anyway the server answers *This request has not been forwarded to the reporting manager yet.* |
| 2 | An approver acts on a row that changed in the meantime (already rejected, cancelled, or at the code step) | **Could not approve** — *This request is no longer waiting for approval.* — and the list refreshes. If the earlier approval sent it on to a Manager step, the message is *This request has not been forwarded to the reporting manager yet.* |
| 3 | The branch has several Vault Admins; one who is not named on the request tries to decide it | Their buttons stay greyed out; if called anyway: *This request is waiting for ‹name›.* |
| 4 | Someone who is not the request's manager tries the manager step | Refused — *This request is waiting for ‹name›.* |
| 5 | The requester's manager is also the Vault Admin | They approve step 1, the requester forwards, and they approve step 2 — two actions |
| 6 | The credential is moved to the Recycle Bin while a request is open | The request becomes **Cancelled**; the Credential column shows *In Recycle Bin* |
| 7 | The credential is deleted for good | The Credential column shows *Deleted credential*; the request stays in the list |
| 8 | The window ends while the page is open | The countdown reaches 0; until the next refresh (within 30 s) the row reads **Approved** · *Unlocked* and **Lock now** is still shown; then **Approved** · *Both approvals done* |
| 8a | A request is cancelled while waiting for an approver | The approver cells are not updated: the Vault Admin cell still reads *Pending* (or the Manager cell *After Vault Admin* / *Pending*) beside the **Cancelled** status |
| 8b | The credential is restored from the Recycle Bin | Its cancelled requests stay cancelled; a new request is needed |
| 9 | The requester locks early in the Critical Vault | The row reads **Approved** · *Both approvals done* on the next refresh |
| 10 | The requester enters 3 wrong codes | **Reset** · *Too many wrong codes — request again*; it leaves the Approved tab |
| 11 | The requester cancels while waiting for the code | **Cancelled**; Cancel is allowed while **pending** or **approved** |
| 12 | The requester raises a new request after a rejection | A new **REQ-** row; the rejected one stays in **Rejected Requests** |
| 13 | A decision is made by someone else | It appears within 30 seconds, or at once when you come back to the browser tab |
| 14 | A row that is not waiting on you | **Approve** and **Reject** are still shown on every row, greyed out — with no tooltip unless the reason is *awaiting forward* |

> **Worth testing.** A request with Vault Admin + Manager steps where the manager is also the Vault Admin: after the first approval the row must show *awaiting forward*, the buttons must stay greyed out until the requester forwards, and then the same person must be able to approve again.

---

## 9. Notifications

| Event | Who gets a bell notification | Message |
|---|---|---|
| Request raised, Vault Admin step | The Vault Admin named on the request | ***Access request to approve*** — *‹requester› asks to unlock "‹credential›" for ‹n› min (REQ-…).* |
| Request raised without a Vault Admin step, or forwarded | The requester's manager | ***Access request to approve*** — *‹requester›'s request to unlock "‹credential›" passed the Vault Admin and needs your approval (REQ-…).* |
| Vault Admin approves, a Manager step follows | The requester | ***Vault Admin approved*** — *… Forward it to your reporting manager to continue.* |
| Last approval, code step follows | The requester | ***Access approved*** — *… Enter your authenticator code to open it.* |
| Last approval, no code step | The requester | ***Access approved*** — *"‹credential›" is unlocked for ‹n› min.* |
| Rejected | The requester | ***Access request rejected*** — *‹role› ‹name› rejected your request to unlock "‹credential›": Not approved at this time* |

The approver's *Access request to approve* opens **this page**; the requester's *Vault Admin approved*, *Access approved* and *Access request rejected* open the **Critical Vault**. In *Access request rejected*, ‹role› reads **Vault Admin** or **Manager**. Cancel, Lock now and the end of a window send no notification; 3 wrong codes notify the credential's **owner** (*Wrong 2-step codes*), not the approvers. Notifications are in the bell inbox only; approvals and rejections are not emailed.

---

## 10. Status Model

### 10.1 Stored status and what the page shows

| Stored status | Meaning | Shown as | Tab |
|---|---|---|---|
| `pending` | Waiting for the Vault Admin, the forward, or the manager | **Pending** | Pending Requests |
| `approved` | Approvals done; waiting for the 2-step code | **Approved** · *enter the … code* | Approved Requests |
| `unlocked` | Inside the window | **Unlocked** · countdown | Approved Requests |
| `locked` (`expired` / `manual`) | The window ended, or Lock now | **Approved** · *Both approvals done* | Approved Requests |
| `locked` (`otp_failed`) | 3 wrong codes | **Reset** | All Requests only |
| `rejected` | An approver said no | **Rejected** | Rejected Requests |
| `cancelled` | Withdrawn, or the credential went to the bin | **Cancelled** | All Requests only |

`pending`, `approved` and `unlocked` count as **open**; one person may have only one open request per credential.

### 10.2 Approval step status

| Step status | Meaning |
|---|---|
| `pending` | Waiting on this approver |
| `approved` | Approved — who and when |
| `rejected` | Rejected — who, when and the note |
| `after_admin` | Manager step only: not open yet — waiting for the Vault Admin or the forward |
| `not_required` | Manager step only: the Vault Admin rejected, so this step never ran |

---

## 11. Business Rules

| ID | Rule |
|---|---|
| BR-01 | Requests are numbered **REQ-nnnn** per company and listed newest first |
| BR-02 | A request's steps are **fixed when it is raised**; later changes to the credential do not affect it |
| BR-03 | The steps run **Vault Admin → Reporting Manager → 2-step code**; a request has at least two of them |
| BR-04 | Nobody approves or rejects their own request |
| BR-05 | The Vault Admin step is decided by the Vault Admin **named on the request** — the first active Vault Admin of the requester's branch, never the requester. In a branch with several Vault Admins, only that one can decide it |
| BR-06 | The Reporting Manager step is decided only by the manager named on the request, and only after the requester forwards it (when there is a Vault Admin step) |
| BR-07 | Only **pending** requests can be approved or rejected |
| BR-08 | Any rejection ends the request; the requester sees *Not approved at this time* |
| BR-09 | When the last approval is given and no code step follows, the credential unlocks at once |
| BR-10 | Only the requester may forward or cancel; cancel is allowed while **pending** or **approved** |
| BR-11 | **Lock now** is allowed only on an unlocked request, by the requester or the Vault Admin |
| BR-12 | 3 wrong codes **reset** a request; it is shown as **Reset** and is not counted in the Approved tab |
| BR-13 | The Vault Admin sees every request raised in their branch; everyone else sees requests they raised or that name them as an approver |
| BR-14 | Tab counts ignore the search box |
| BR-15 | Every approval, rejection, forward, cancel, unlock and lock is recorded in the Audit Log (a cancel caused by moving the credential to the bin is recorded only as *Moved to Recycle Bin*) |
| BR-16 | The list refreshes every 30 seconds and when the browser tab comes back into view |

---

## 12. Known Problems and Limitations

| # | Item |
|---|---|
| 1 | The reject dialog has no reason box; the requester always sees *Not approved at this time* |
| 2 | After the Vault Admin approves, the request waits for the **requester** to forward it from the Critical Vault; the manager cannot act before that |
| 3 | The forward and the 2-step code are done in the Critical Vault, not on this page |
| 4 | The cancel dialog says *The approvers will no longer see it*, but cancelled requests stay visible in **All Requests** |
| 5 | **Approved Requests** also holds requests whose window has ended (*Both approvals done*) |
| 6 | A decision made by someone else can take up to 30 seconds to appear |
| 7 | An access window cannot be extended; a new request is needed |
| 8 | Notifications are in the bell inbox only, not by email |
| 9 | *Access approved* says *Enter your authenticator code* even for the email method; the manager's notification says *passed the Vault Admin* even when there is no Vault Admin step |
| 10 | *Both approvals done* is shown even when the request had only one approval step |
| 11 | Cancelling (or binning) does not update the approver cells — a cancelled request can still show *Pending* there |

---

## 13. Roles and Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The **Branch User** of a branch; decides the Vault Admin step for requests raised in their branch |
| Reporting Manager | The requester's manager in HR; decides the second approval |
| Requester | The person who raised the request |
| REQ- | Access request numbers |
| CCRD- | Critical Vault credential numbers |
| Forward | The requester's **Send to ‹manager›** after the Vault Admin approved |
| Access window | How long the credential stays open after every step has passed |
| Reset | A request ended by 3 wrong 2-step codes |

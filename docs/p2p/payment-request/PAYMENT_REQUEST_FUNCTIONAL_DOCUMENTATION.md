# P2P Payment Request Management — Functional Documentation

## 1. The feature in one paragraph

Money never leaves on the Purchase Order screen. Somebody raises a **Payment
Request** against a PO — a type, an amount, a reason and a named approver.
Only that approver can decide it, and only up to what the PO still has open.
An approved request is a *permission to pay*, not a payment: the actual release
is recorded separately with a bank, a UTR or cheque number, a date and a proof
file. The PO's paid and balance figures are rebuilt from those payment rows
every time one changes. Each payment can then be pushed to Zoho Books as a
vendor payment against the PO's bill.

---

## 2. Where it lives

| | |
|---|---|
| Menu | **Procure to Pay (P2P) → Purchase Management → Payment Request Management** |
| URL | `/p2p/payment-request` |
| Menu permission key | `p2p.payment_request` |
| Screens | The queue (4 tabs) · the request detail (5 tabs) · **Manage Payment Requests**, inside a single PO |

Two screens, one module:

| Screen | Scope | Who uses it |
|---|---|---|
| **Manage Payment Requests** | One PO | The person raising requests and recording payments |
| **Payment Request Management** | Every PO | The approver, working a queue |

---

## 3. Step 0 — TDS must be settled first

On a **domestic** PO, TDS has to be saved before any request can be raised —
even if it is zero.

> *"Deduct the TDS on this PO first — save it (even as 0) before raising a payment request."*

Why: TDS decides the **net payable**, and net payable is the ceiling every
request draws against. Settling it afterwards would move the ceiling under
requests already approved.

| Rule | |
|---|---|
| Maximum | **40%** |
| Entry | Either a percentage **or** an amount — the other is derived |
| Cannot exceed | The PO's base amount |
| International PO | TDS does not apply |

---

## 4. Raising a request

| Field | Notes |
|---|---|
| Payment type | Advance · Partial · Final · Balance |
| Percentage | Optional, 0–100 — a convenience for typing the amount |
| Amount | At least 1 |
| Reason | Required, up to 300 characters |
| Request to | **A named person**, not a role |

Each request gets a code: **`PRQ-001`**, `PRQ-002`, … A plain running serial,
not a financial-year code — a payment request is referred to by number in
conversation, and the year added length without saying anything the request date
does not. The sequence runs on and never restarts, or April would hand out a
`PRQ-001` that already exists.

**Who can be the approver**

- An active user of your company
- **Not** a client admin — *"A request stops at the branch head"*
- In **this PO's branch**

---

## 5. Deciding

Only **the person the request was sent to** can decide it. Not their manager,
not an admin — the named addressee.

| Decision | Needs | Result |
|---|---|---|
| **Approve** | An approved amount | Payments may be recorded against it |
| **Decline** | A reason (≤ 300 chars) | Nothing can be paid |

**Two ceilings on approval**

1. Never more than **requested**
   > *"You can approve at most the requested 50,000."*
2. Never more than the PO's **remaining headroom**
   > *"Only 20,000 is still open to approve on this PO."*

Headroom is the PO's net payable, less what its other approved requests already
hold or have paid. So two approvers working different requests on the same PO
cannot between them approve more than the order is worth.

A decided request cannot be decided again, and a cancelled PO cannot be decided
on at all.

---

## 6. Recording the payment

Separate from approval, and deliberately so. Approving is permission; this is
the money leaving.

| Field | Notes |
|---|---|
| Amount | |
| Bank name | |
| UTR / cheque number | 6 to 22 letters and digits — cheque at the short end, RTGS UTR at the long end |
| UTR / cheque date | |
| Proof of payment | PDF, Word, Excel or image, up to 10 MB |

More than one payment can sit under one approved request — a part release today
and the rest next week.

Editing or deleting a payment is allowed, and each time the PO's **paid** and
**balance** figures and the request's **paid** figure are rebuilt from the rows
that remain.

---

## 7. The Payment Request Management queue

The approver's screen: every request they are allowed to see, across every PO.

### The four tabs

| Tab, as labelled | Shows |
|---|---|
| **All Requests** | Everything in scope |
| **Awaiting for Approval Requests** | `pending` |
| **Approved Requests** | `approved` |
| **Rejected / Declined Requests** | `rejected` |

Tab counts come back with the page in one query, so the badges need no extra
call. Tabs, search and paging all run **on the server**; a newer response wins
over a slower older one, so typing fast cannot leave the list showing the
answer to a query you have moved on from.

### Who sees which rows — this is not the same for everyone

Scope is decided server-side, before the tab is applied:

| Who | Sees |
|---|---|
| **Client admin** | Every request of the company |
| **Branch user** (branch head) | Every request of **their branch**, plus any sent to them personally |
| **Everyone else** | **Only the requests sent to them** |

So two people on the same tab legitimately see different row counts, and an
ordinary user's "All Requests" means "all of mine". Worth knowing before
treating a missing row as a bug.

Seeing a request is not deciding it: a branch head sees their whole branch's
requests but can still only decide the ones addressed to them (§5).

### The columns

Fourteen, in four groups:

| # | Column | |
|:-:|---|---|
| 1 | Sr. No | Row number |
| 2 | **Payment Request ID** | `PRQ-001` — click to open the detail |
| 3 | **Request Raised Against** | The PO (or SPI) this is drawn on |
| 4 | Shipment ID | `N/A` when the PO was raised standalone |
| 5 | Opportunity ID | `N/A` likewise |
| 6 | Procurement ID | `N/A` likewise |
| 7 | **Supplier** | Code and name |
| 8 | Total PO / SPI Amount | The order it is drawn on |
| 9 | **Requested Payment Amount** | What was asked for |
| 10 | **Approved Amount** | What was granted — see below |
| 11 | Requested Payment Type | Advance · Partial · Final · Balance |
| 12 | Requested By | Who raised it |
| 13 | **Requested To** | The named approver — the only person who can decide it |
| 14 | Action | Open · decide |

> **The Awaiting tab has thirteen columns, not fourteen.** `Approved Amount` is
> filtered out there, because nothing on that tab has been approved yet and the
> column would be empty down its whole length. A tester comparing the header
> between tabs will find them different; that is deliberate.

`N/A`, not a dash, on the three upstream ids — a dash read as "the value failed
to load" (CS-427). It matches the PO list for the same reason.

### Search

Server-side, debounced, up to 100 characters. It covers the **request code**,
the **PO code**, and the supplier's **code, company name and legal name**.

It does not cover amounts, the payment type, or the requester / approver names.

### Paging

10 per row page by default, up to 50.

### Empty states

| | |
|---|---|
| Nothing matched a search | *"No payment requests match your search."* |
| Nothing in the tab at all | *"No payment requests in this category."* |

Two different sentences on purpose: the first says to change the search, the
second says the tab is genuinely empty.

### Bulk decisions

Several requests can be decided in one action (up to 50). Each one is put
through **the same rules as a single decision, on its own**, so one refusal
never holds up the rest — the answer names what was decided, what was not, and
why (CS-429 / CS-436).

One limit: **approving a batch approves each request in full.** A part-approval
is an amount of its own, so it stays a single-request decision.

---

## 7A. The request detail screen

Opened from a row. Everything on it is a reading surface except the decision —
the approver is looking at someone else's work, not editing it.

### The header

| | |
|---|---|
| Left | `PRQ-003`, its status chip, and *"Request raised against `PO/2026-27/016` · Requested 28/09/2026"* |
| Chips | PO Number · Supplier · Shipment ID · Opportunity ID · Procurement ID, each with its date |
| Buttons | **Evidence Vault** · **Approve Request** · **Reject / Decline Request** · back |

**Evidence Vault** here is the transaction's, not the supplier's: *"every
document behind this transaction — the purchase order, its trade documents and
agreements, and the supplier invoices mapped to it."*

### Current Transaction vs All Previous Transaction History

A two-way switch above the tabs. **Current Transaction** is the request you
opened; **All Previous Transaction History** is what came before it on the same
document, with its own count. The tabs below redraw for whichever is selected.

### The five tabs

| Tab | Holds | Editable? |
|---|---|---|
| **Supplier Details** | The Create PO supplier stage — address, country, state, state code, city, contact person, designation, number, email — plus **Supplier Legal Status** with its readiness percentage and a link to the supplier's Evidence Vault | **No.** Every field is `readOnly` and skipped by the tab key |
| **Linked Payment Requests** | Every request on the same document, the open one pinned first | **The only tab that can decide anything** |
| **Payment Summary** | The running totals, then every release made against the document | No |
| **Physical Inspection** | Flagged **REQUIRED** when the PO was raised needing it | No |
| **Current Transaction Status** | The timeline of this request | No |

The point of the read-only tabs is that an approver can satisfy themselves
about the supplier, the money already released and the goods — without leaving
the request or being able to change any of it.

### Two places to decide, and they are not the same

This catches people out, so it is worth stating plainly.

| | **Header** buttons | **Linked Payment Requests** row buttons |
|---|---|---|
| Decides | The request you opened | Any request on the document |
| Enabled when | Not already decided **and** you hold the approve permission | The same, **plus the request is addressed to you** |
| Tooltip when blocked | *"This request was already approved — no further decision can be taken on it"* | *"This request was sent to someone else"* |

```js
// header
disabled={decided || !canApprove}

// per row, in Linked Payment Requests
const canDecide = r.status === 'awaiting' && canApprove && r.canDecide;
```

So on a document carrying several requests you see them all, and the buttons
are live only on the ones that are yours. An earlier request shown over the
table is explicitly marked *"read-only"* (CS-436).

**The browser's permission check is `p2p.payment_request.can_approve`** (super
admins bypass it). The server does not read that flag at all — it checks the
addressee:

> *"Only the person this request was sent to can decide it."* — `403`

Both have to pass. The permission decides whether the buttons are live; the
addressee check decides whether the decision is accepted.

---

## 8. Zoho Books

Per payment, on demand. The payment becomes a **vendor payment** in Zoho Books
applied against the PO's **bill**, and the uploaded proof is attached to that
bill — Zoho Books has no attachment endpoint for a vendor payment, so the bill
is where the evidence can live and still be found from the transaction.

The bill must exist first. If the PO has not been synced, sync the PO before the
payment.

---

## 9. What happens when the PO is cancelled

Raising an **Advance Receipt Refund Adjustment** on the PO force-rejects every
still-pending request on it, with the note:

> *Closed — PO cancelled (ADR/2026-27/002).*

They can never be paid, so leaving them open would be a lie on the queue.

---

## 10. Business rules QA should never see broken

1. A domestic PO with no TDS saved **cannot** have a request raised.
2. TDS can never exceed **40%**, however it is entered.
3. The approver must be an active, non-client-admin user **of the PO's branch**.
4. **Only the addressee** can decide the request.
5. Approval can never exceed the requested amount.
6. Approval can never exceed the PO's remaining headroom.
7. A request can only be decided once.
8. A request on a cancelled PO cannot be decided.
9. `po.paid_amount` and `po.balance_amount` always equal the sum of the surviving payment rows.
10. Cancelling a paid PO closes its pending requests automatically.
11. A user sees only the requests their role allows — the company (client admin), their branch plus their own (branch head), or only their own (everyone else). Enforced server-side.
12. Seeing a request is not deciding it: a branch head sees their branch's requests and can still only decide the ones addressed to them.
13. The **Awaiting** tab deliberately drops the `Approved Amount` column — nothing on it has been approved yet.
14. Every tab of the request detail is **read-only** except the decision; only **Linked Payment Requests** carries per-row Approve / Reject.
15. A bulk decision runs each request through the single-request rules on its own, so one refusal never holds up the rest — and approving in bulk approves each **in full**.

---

## 11. Statuses

| Status | Meaning |
|---|---|
| `pending` | Awaiting the named approver |
| `approved` | May be paid, up to `approved_amount` |
| `rejected` | Terminal — by decision, or closed with the PO |

---

## 12. Roles and access

> **Corrected.** An earlier version of this section said *"Users with the PO
> permission"* for saving TDS, raising, recording and syncing. There is no such
> check. What follows was read off `PoPaymentRequestController` and
> `PaymentRequestDetail.tsx`.

### What guards the API

Every method calls `tenantUser()`, which requires a `client_id` and otherwise
returns `403 — No tenant context`. Beyond that there is **no role test and no
module-permission test** on raising a request, saving TDS, recording a payment,
editing or deleting one, or syncing to Zoho.

Three rules do check who you are, and all three are about the **approver**, not
about a permission:

| Rule | Where | Message |
|---|---|---|
| The approver must be active, **not a client admin**, and in this PO's branch | Raising | *A request stops at the branch head — choose someone from this branch.* |
| **Only the addressee** may decide | Deciding | *Only the person this request was sent to can decide it.* (`403`) |
| One decision per request | Deciding | *This request is already approved / declined.* |

### What guards the screens

Two different things, easy to conflate:

| | |
|---|---|
| **Row visibility** | Server-side, by role — client admin sees the company, a branch head sees their branch plus their own, everyone else sees only requests sent to them (§7) |
| **The decision buttons** | Browser-side, `p2p.payment_request.can_approve`; super admins bypass it |

The server never reads `can_approve`. It enforces the addressee rule instead.
So the permission controls whether the buttons are *offered*, and the addressee
rule controls whether a decision is *accepted* — a user with the permission but
not named on the request gets a live button and a `403`.

### The practical consequence

| | |
|---|---|
| Withholding `can_approve` | Hides the buttons |
| Withholding `can_approve` | Does **not** stop the endpoint answering, if that user is the addressee |
| Row scoping | **Is** enforced server-side, so it cannot be worked around |

Worth raising as a finding rather than testing as intended behaviour — it is
the same gap recorded in the Purchase Order document's §14.

### Summary

| Action | Who |
|---|---|
| Save TDS · raise a request | Any authenticated user of the client, in practice whoever can reach the PO |
| Be chosen as approver | An active, non-client-admin user of the PO's branch |
| **Decide** | **Only** the user named in `requested_to` — enforced server-side |
| See a request on the queue | By role: company / branch / own (§7) |
| Record · edit · delete a payment | Any authenticated user of the client; a payment already in Zoho can no longer be changed |
| Zoho sync | Same, where Zoho is configured |

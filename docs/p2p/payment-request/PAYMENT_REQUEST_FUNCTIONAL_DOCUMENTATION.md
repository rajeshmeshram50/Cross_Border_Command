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
| Menu | **Procure to Pay (P2P) → Payment Request** |
| URL | `/p2p/payment-request` |
| The other face | **Manage Payment Requests**, inside a single PO |

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

| Tab | Shows |
|---|---|
| **All** | Every request |
| **Awaiting** | `pending` |
| **Approved** | `approved` |
| **Declined** | `rejected` |

With search and paging. From a row the approver opens the detail, sees the PO,
the supplier, the amounts and the history, and decides. Bulk decisions are
supported.

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

---

## 11. Statuses

| Status | Meaning |
|---|---|
| `pending` | Awaiting the named approver |
| `approved` | May be paid, up to `approved_amount` |
| `rejected` | Terminal — by decision, or closed with the PO |

---

## 12. Roles and access

| Action | Who |
|---|---|
| Save TDS | Users with the PO permission in that branch |
| Raise a request | Same |
| Decide | **Only** the user named in `requested_to` |
| Record / edit / delete a payment | Users with the PO permission |
| Zoho sync | Users with the PO permission, where Zoho is configured |

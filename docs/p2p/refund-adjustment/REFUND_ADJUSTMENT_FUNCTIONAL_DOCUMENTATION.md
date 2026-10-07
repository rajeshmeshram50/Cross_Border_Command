# P2P Advance Receipt Refund Adjustment — Functional Documentation

## 1. The feature in one paragraph

When a Purchase Order has to be cancelled **after money has already gone to the
supplier**, it cannot simply be cancelled — the cash is still out there. An
Advance Receipt Refund Adjustment is raised instead. It cancels the PO, records
how much the supplier must send back and how much we are keeping (with a stated
reason), and then stays open as a receivable. Each repayment is logged as a
**recovery** with its date, reference and bank proof. Only when the recoveries
add up to the refund does the PO's cancellation move from *Initiated* to
*Closed*. The adjustment produces its own document, and can be mirrored into
Zoho Books as a vendor credit with a refund per recovery.

---

## 2. Where it lives

| | |
|---|---|
| Menu | **Procure to Pay (P2P) → Advance Refund Adjustment** |
| URL | `/p2p/advance-refund-adjustment` |
| Code | `ADR/<FY>/<SEQ>` — e.g. `ADR/2026-27/002` |

---

## 3. When you need one

| PO situation | What to do |
|---|---|
| No money paid | Cancel the PO directly from the PO screen |
| **Money paid** | **Raise a refund adjustment** — the PO screen will refuse to cancel |

The PO screen says so plainly:

> *"Payments are recorded on this PO — raise the advance refund adjustment instead."*

**A PO can have only one adjustment.** Eligible POs are those that are not
cancelled, have money against them, and do not already have one.

---

## 4. Raising it

| Field | Notes |
|---|---|
| Purchase Order | Picked from the eligible list |
| Refund type | **Full Refund** or **Partial Refund** |
| Amount to be refunded | Cannot exceed what was paid |
| Reason | Why the order is being cancelled |
| Supplier reference no. | Optional — the supplier's own reference |
| Retained reason + remark | Required whenever money is kept back |
| Attachment | Supporting letter or email, up to **2 MB** |

### The arithmetic

```
paid amount        (snapshot of what the PO had paid)
  − refund amount  (what the supplier must return)
  = retained       (what we keep)
```

### Full vs Partial — they must agree with the figures

| | Full Refund | Partial Refund |
|---|---|---|
| Retained must be | **zero** | **more than zero** |
| Reason + remark | n/a | **mandatory** |

Choosing *Full Refund* and keeping money is refused, and so is choosing
*Partial Refund* and returning everything. The document cannot say one thing
while the numbers say another.

### Retained reasons

```
Cancellation Charges        Restocking Fee
Freight / Logistics Already Incurred        Bank & Remittance Charges
Non-Recoverable GST         Customs / Duty Already Paid
Work Already Completed      Contractual Retention        Other
```

Retained money is never silent. Both a reason from this list **and** a free-text
remark are required — that is the line a supplier will dispute.

---

## 5. What raising it does to the PO

All in one step:

1. The PO is **cancelled**
2. Its cancellation stage becomes **Initiated** — not closed, because money is owed
3. Every **still-pending payment request** on the PO is **declined** with
   *"Closed — PO cancelled (ADR/…)"*
4. Any proforma-invoice lines the PO was holding are **released** for other orders

Point 3 matters: those requests can never be paid, so leaving them sitting in the
approver's queue would be misleading.

---

## 6. Recoveries — getting the money back

Each repayment from the supplier is logged as a recovery:

| Field | Rules |
|---|---|
| Amount | At least ₹1 |
| Refunded date | **Not in the future**, and **not before the adjustment date** |
| Cheque / UTR number | Optional, but **must be unique across the company** |
| Proof of payment | One file — PDF or image, up to 10 MB |

**A duplicate reference is refused, and the system tells you where it is:**

> *Cheque / UTR number 1789632456987 is already recorded on ADR/2026-27/001 · PO/2026-27/004 for ₹25,000.00 on 06-Oct-2026. Enter the reference from this payment instead.*

That wording exists because *"already used on another recovered payment"* left
people hunting for which one.

A recovery carries **one** proof; attaching a new one replaces the old.

---

## 7. How the status moves

| Recovered so far | Status | PO cancellation |
|---|---|---|
| Nothing | **Pending** | Initiated |
| Some, not all | **Partial** | Initiated |
| All of it | **Recovered** | **Closed** |

The PO is only truly finished when the money is back. Until then it reads as
*Cancellation Initiated* — an open receivable, visible as one.

---

## 8. Editing and deleting

| Action | Allowed? |
|---|---|
| Edit the adjustment | Yes — **until** the vendor credit is in Zoho |
| Edit a recovery | Yes — **until** that recovery is in Zoho |
| Delete a recovery | Same rule |

> *"This refund is already posted to Zoho Books — it can no longer be changed or deleted."*

Once it is in the accounts, it is the accounts' record, not ours to rewrite.

Two further limits on editing the adjustment: the refund can never exceed what
was paid, and it can never be reduced below what has already been recovered.

---

## 9. The document

A proper **Advance Receipt Refund Adjustment** PDF, rendered from our own data —
the PO, the supplier, the paid / refund / retained split with its reason, and
the recoveries to date.

---

## 10. Zoho Books

| Ours | Theirs |
|---|---|
| The adjustment | **Vendor Credit** |
| Each recovery | **Vendor Credit Refund** |

Pushed from the **Zoho Sync** column on the list, never by saving. The vendor
credit must exist before any recovery can be pushed.

---

## 11. Tabs

| Tab | Shows |
|---|---|
| **All** | Everything |
| **Pending** | Anything not fully recovered (`pending` + `partial`) |
| **Recovered** | Settled |

---

## 12. Business rules QA should never see broken

1. A PO with money paid **cannot** be cancelled from the PO screen.
2. **One adjustment per PO** — ever.
3. An adjustment cannot be raised on a PO with no money against it.
4. The refund can never exceed the amount paid.
5. The refund can never be reduced below what has already been recovered.
6. Full Refund ⇒ retained is zero. Partial Refund ⇒ retained is more than zero.
7. Any retained amount carries a reason **and** a remark.
8. Raising one declines every pending payment request on that PO.
9. A recovery date cannot be in the future, nor before the adjustment date.
10. A cheque / UTR reference cannot be reused anywhere in the company.
11. Anything already in Zoho cannot be edited or deleted.
12. The PO's cancellation closes **only** when the balance reaches zero.

---

## 13. Roles and access

| Action | Who |
|---|---|
| Raise an adjustment | Users with the P2P payment permission in that branch |
| Log / edit / delete recoveries | Same, subject to the Zoho lock |
| Zoho sync | Same, where Zoho is configured |
| Download the document | Any user who can see the adjustment |

All reads and writes are scoped to the user's client and branch.

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
| Menu | **Procure to Pay (P2P) → Purchase Management → Advance Receipt Refund Adjustment** |
| URL | `/p2p/advance-refund-adjustment` |
| Menu permission key | `p2p.advance_refund` |
| Code | `ADR/<FY>/<SEQ>` — e.g. `ADR/2026-27/002` |
| Screens | The list (3 tabs) · the adjustment form · Manage Recovery · Evidence Vault · PO Timeline |

The header states the scope it is for: **Advance Receipt Refund Adjustment
(Supplier Tax Invoice Not Generated)** — *"recover advances already released on
a purchase order that is being cancelled — raising the adjustment cancels the
order."*

---

## 3. When you need one — and when you do not

| PO situation | What to do |
|---|---|
| No money paid, still a draft | **Delete** the PO from the PO screen |
| No money paid, submitted | **Cancel** the PO directly from the PO screen |
| **Money paid** | **Raise a refund adjustment** — the PO screen will refuse to cancel |

The PO screen says so plainly:

> *"Payments are recorded on this PO — raise the advance refund adjustment instead."*

### Which POs appear in the picker

Three conditions, all of them:

```php
paid_amount > 0                  // there is money to get back
AND status <> 'cancelled'        // not already dead
AND no existing refundAdjustment // one per PO, ever
```

The picker shows the 50 most recent matches, searchable by PO code or supplier
name, and each row carries **the amount paid in the order's own currency** —
an international PO's paid figure is not rupees, and the picker says which.

So a PO missing from the picker is missing for one of exactly three reasons.
That is the first thing to check before reporting it.

---

## 3A. There is no approval step

Worth stating because it is a reasonable thing to assume, and it is not true.

| Action | Approved by |
|---|---|
| Raising a refund adjustment | **Nobody.** It takes effect immediately |
| Logging a recovery | **Nobody** |
| Editing either | **Nobody** |

The P2P chain has two approvals, and **neither is here**: the senior GST
approval on the PO, and the named approver on a Payment Request. A refund
adjustment is a record of a decision already taken, not a request for one.

The consequence is worth testing deliberately: **the moment it is saved, the PO
is cancelled and every pending payment request on it is declined.** There is no
draft state, no pending stage, and no undo — the only correction is to edit the
adjustment, and even that closes once Zoho has it (§8).

---
## 4. The form, panel by panel

**One step — `STEP 01 OF 01 · Purchase Order, Supplier & Refund Details`.** There
is no wizard and no draft: Cancel, or **Create / Update Refund Adjustment**.

Four panels, and **only the fourth is typed into**. Everything above it is
carried from the PO and the supplier so the figures the refund is measured
against cannot be edited into disagreement with the order.

### Panel 1 · The purchase order — read-only

PO number · PO type · document type · expected delivery · payment type · mode of
transport · physical inspection, then the money the refund is judged against:

| | |
|---|---|
| Total PO Amount (Grand Total) | |
| TDS Deducted | |
| Net Payable Amount | |
| **Total Paid Amount** | **The figure that caps the refund** |
| Balance Amount | |

### Panel 2 · Supplier Details — badged **READ-ONLY**

*"Party the refund is due from."* Supplier code and name, company legal name,
supplier type, category, segment, **risk level**, GSTIN / TIN, GST status,
registered office address, country, state, state code, city, contact person,
designation, contact number, email.

None of it is editable here — it is the vendor master's record, shown so the
person raising the refund can see who they are claiming from.

### Panel 3 · Advance Receipt Refund Adjustment Details — badged **AUTO**

| Field | Entry | Notes |
|---|---|---|
| Advance Refund No. | **AUTO** | `ADR/<FY>/<SEQ>`, allocated on save |
| Advance Refund Date | **AUTO** | Today. It is the floor for every recovery date (§6) |
| Supplier Advance Refund Reference No. | Optional | ≤ 64 chars — the supplier's own reference |
| Refund Reference Attachment | Optional | **≤ 2 MB**, pdf / jpg / png / webp. View · download · **Camera** · Browse — a letter can be photographed rather than scanned |
| **Advance Refund Type** \* | Full Refund · Partial Refund | Must agree with the arithmetic — see below |
| **Advance Refund Adjustment Reason** \* | 3–500 chars | Why the order is being cancelled |
| Total PO Amount · TDS Deducted · Net Payable · Total Paid | **AUTO** | Carried from the PO |
| **Refund Amount (Amount To Be Refunded)** \* | **The one money field you type** | ≥ 0.01, never more than Total Paid |

### Panel 4 · Amount not being refunded — appears when you keep anything back

The moment the refund is less than what was paid, an amber panel opens and
states the position in words before it asks anything:

> **Amount not being refunded** — *Of A$1,000 paid, A$500 is being refunded.*
> **RETAINED BY SUPPLIER A$500 · 50% of what was paid**

| Field | Rule |
|---|---|
| **Reason for not refunded** \* | One of the nine listed below |
| **Remark** \* | Free text, ≤ 300 chars |

Both are **mandatory whenever anything is retained** — that is the line a
supplier will dispute, and a percentage of what they paid is exactly the number
they will ask about.

### The arithmetic

```
paid amount        (snapshot of what the PO had paid)
  − refund amount  (what the supplier must return)
  = retained       (what we keep)
```

The percentage shown beside the retained figure is `retained ÷ paid`, so it
says how much of their money is being kept, not how much of the order.

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

### Currency — how every figure on this screen is printed

Every amount here is money **on the purchase order**, so it is shown in that
order's currency, never converted and never assumed to be rupees.

> *"A PO carries its own currency, so an AUD order must never print ₹."*

The currency comes off the PO as `currency_code`, falling back to `INR` when it
is not set. A screen binds one formatter from it — `moneyIn(row.currency)` —
and every figure on the row then uses it.

**Two things change with the currency, not one:**

| | |
|---|---|
| The **symbol** in front | From a fixed map |
| The **digit grouping** | `en-IN` for INR, `en-US` for everything else |

That second one is the part people miss. The same number reads differently:

```
INR    ₹1,20,000      lakh grouping
AUD    A$120,000      thousands grouping
```

So a refund on an Australian order prints `A$1,437,829`, and the identical
figure on a rupee order prints `₹14,37,829`. Neither is wrong.

**The symbols:**

| | | | | |
|---|---|---|---|---|
| INR `₹` | USD `$` | EUR `€` | GBP `£` | AUD `A$` |
| CAD `C$` | SGD `S$` | AED `AED ` | JPY `¥` | CNY `¥` |

A currency outside that list **prints its own code** followed by a space —
`SEK 120,000` — rather than falling back to a wrong symbol. Note `JPY` and `CNY`
deliberately share `¥`.

**Rounded or exact.** The list and the refund panels use the rounded form
(`moneyIn`); the Create PO totals use `money2In`, which keeps two decimals. So
the same amount can read `A$1,000` in one place and `A$1,000.00` in another —
that is the formatter, not a discrepancy.

Where this bites: the refund amount is capped at the **Total Paid Amount of
that PO in that PO's currency**. There is no cross-currency comparison anywhere
in this module, so an AUD order is only ever measured against AUD figures.

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

## 8. Editing, viewing, and the three locks

> **Corrected.** An earlier version of this section said the adjustment stays
> editable *"until the vendor credit is in Zoho"*. It does not. It closes at the
> **first recovery**, which usually comes long before anyone syncs.

### Edit or view — what decides the icon

The first action on a row is a **pencil** or an **eye**, never both:

| Icon | When | Tooltip |
|---|---|---|
| ✏️ **Pencil** — Edit | No recovery has been logged yet | *"Edit Advance Receipt Refund Adjustment"* |
| 👁 **Eye** — View | **Any** recovery exists | *"Recovery has started — opens to be read"* |

```ts
isSettled = status === 'recovered' || recovered > 0 || recoveriesCount > 0;
```

Note what is **not** in that rule: the Zoho sync state. A refund that is fully
synced but has no recoveries logged still shows the pencil; one with a single
recovery and nothing in Zoho shows the eye. On a list where some rows are
synced and some are not, the icons will not line up with the Zoho column —
that is correct.

### The three server locks, in the order they fire

| # | Condition | Refusal |
|:-:|---|---|
| 1 | `status = recovered` | *Every rupee of this refund has been recovered — it can no longer be changed.* |
| 2 | **Any recovery exists** | *A recovery has already been recorded against this refund — its figures can no longer be changed.* |
| 3 | Vendor credit in Zoho **and the amount or retained reason changed** | *The vendor credit is already in Zoho Books — the refund amount can no longer be changed.* |

Lock 2 is the one that matters day to day: *"recoveries are booked against these
figures, so the adjustment is closed to edits from the first one onwards"*
(CS-588). The frontend's eye icon is this same rule, shown early.

Lock 3 is **narrower than the other two** — it only blocks a change to the
refund amount or the retained reason. Everything else on a synced adjustment
with no recoveries is still editable, which is why it is a separate check and
not simply "synced means frozen".

### Recoveries

| Action | Allowed? |
|---|---|
| Add a recovery | Yes, until the refund is fully recovered |
| Edit a recovery | Until **that** recovery is in Zoho |
| Delete a recovery | Same rule |

> *"This payment is already posted to Zoho Books — it can no longer be changed or deleted."*

Once it is in the accounts, it is the accounts' record, not ours to rewrite.

Two further limits whenever the figures are still open: the refund can never
exceed what was paid, and it can never be reduced below what has already been
recovered.

---

## 8A. The other row actions

| Button | Opens | Disabled when |
|---|---|---|
| **Evidence Vault** | *"refund, PO and payment proofs"* — everything filed behind this adjustment | Never |
| **PO Timeline** | *"how far this PO and its refund have gone across to Zoho Books"* | The refund has no PO — *"No purchase order on this refund yet"* |
| **Manage Recovery** | The recovery log, with a count badge | Never — see below |
| **Zoho Sync** | §10 | |

**PO Timeline is the PO list's timeline, not a separate one.** A refund is the
tail of that chain — vendor credit, then each recovery — so it is read from the
same screen rather than a second one that could disagree with it.

**Manage Recovery never disables.** Once everything is back it relabels to
**Recovery Complete** and the refund-number chip turns from amber to green
(CS-584/586) — the log stays readable after settlement rather than the button
disappearing with the history behind it.

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
| Each recovery | **Vendor Credit Refund** against that credit |

Pushed from the **Zoho Sync** column, never by saving. Nothing reaches Zoho
because a form was submitted.

### Both buttons run the whole chain

This is the part that surprises people. There are two Zoho Sync actions — one
on the adjustment, one per recovery — and **they do the same thing**: each
calls `syncAll()` on the parent PO, which walks the entire chain in order:

```
1. Purchase Order   →  Zoho Purchase Order
2.                  →  Zoho Bill
3. Payments         →  Vendor Payments applied to that bill
4. The adjustment   →  Vendor Credit
5. Each recovery    →  Vendor Credit Refund
```

> *"Same chain as every other Zoho Sync button, so this refund can never land
> before the PO, its bill, its payments and the vendor credit are there."*

So you do **not** have to sync the credit first and the recoveries after. Either
button gets everything into the right order by itself. Anything already carrying
a Zoho id is skipped, so pressing either one twice is safe.

### What that means in practice

| You press | What actually happens |
|---|---|
| Sync on the adjustment | The PO, its bill, its payments, the credit **and every recovery** go |
| Sync on one recovery | Exactly the same — the whole chain, including the other recoveries |

A recovery's sync has one extra check afterwards. If the chain ran but that
particular refund still has no Zoho id, it says so rather than reporting
success:

> *"This refund was not posted to Zoho Books — try again."*

### When it refuses

The chain's `preflight()` runs first and throws a readable message rather than
letting Zoho reject things halfway — a missing vendor contact, a missing GSTIN,
a tax that does not exist in Zoho, a currency mismatch. Those come back as a
`422` with Zoho's own wording where Zoho produced it.

Because the whole chain runs, **a failure anywhere stops the step you wanted**.
A refund will not post if the PO's bill cannot be created, and the message will
be about the bill, not about the refund.

### The lock it creates

Once a record is in Zoho it can no longer be edited or deleted here (§8). That
is the trade: syncing is what makes the accounts right, and also what closes the
door on changing your mind.

---

## 10A. The list view

| Tab, as labelled | Shows |
|---|---|
| **All Refund Adjustments** | Everything |
| **Recovery Pending Refunds** | `status <> 'recovered'` — i.e. `pending` **and** `partial` |
| **Fully Recovered Refunds** | `status = 'recovered'` |

Note the middle tab is defined by what it is **not**, so a new status would fall
into it by default rather than disappearing from the screen.

### The columns

| Column | |
|---|---|
| Sr. No | |
| **Refund No.** | `ADR/<FY>/<SEQ>` |
| **Purchase Order** | The cancelled order |
| Shipment ID · Opportunity ID · Procurement ID | The PO's upstream links |
| **Credit Note Type** | Full Refund / Partial Refund |
| Total PO Amount (Grand Total) | |
| TDS Deducted | |
| Net Payable Amount | |
| **Total PO Paid Amount** | The snapshot the refund is measured against |
| **Amount Not Refunded** | What we are keeping |
| **Amount To Be Refunded** | What the supplier owes back |
| **Zoho Sync** | The action, and its state |
| **Payment Recovery Status** | Pending · Partial · Recovered |
| **PO Cancellation Status** | Initiated · Closed |
| Action | Open · edit · recoveries · document |

The two status columns move together but are not the same field: recovery
status is the adjustment's, cancellation status is the **PO's**, and the second
only reaches *Closed* when the first reaches *Recovered* (§7).

---
## 11. Business rules QA should never see broken

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
13. **There is no approval step** — raising one cancels the PO immediately, with no draft, no pending stage and no undo.
14. Only a PO that is **paid, not cancelled, and has no adjustment already** appears in the picker.
15. The adjustment stops being editable at the **first recovery**, not at the Zoho sync — the row's icon turns from a pencil to an eye.
16. The Zoho lock is narrower than the recovery lock: it blocks only the refund amount and the retained reason.
17. **Either** Zoho Sync button runs the whole chain — PO, bill, payments, vendor credit, every recovery — so the order can never come out wrong.

---

## 12. Roles and access

> **Corrected.** An earlier version said *"Users with the P2P payment
> permission in that branch"*. There is no such check — every method calls
> `tenantUser()` and nothing else.

| Action | Who |
|---|---|
| Raise an adjustment | **Any authenticated user with a `client_id`** |
| Log / edit / delete recoveries | Same, subject to the locks in §8 |
| Zoho sync | Same, where Zoho is configured |
| Download the document | Same |

There is **no role test and no module-permission test** anywhere in
`PoRefundAdjustmentController`. A caller without a `client_id` — a super admin —
gets `403 — No tenant context`; everyone else inside the tenant can do all of
it. The menu leaf `p2p.advance_refund` is permission-gated in the UI, so
visibility and capability diverge exactly as they do on the PO screen.

Worth raising as a finding rather than testing as intended behaviour,
especially here: this is the one module that cancels an order and writes off
money in a single click, with nobody asked to approve it.

All reads and writes are scoped to the user's client through the tenant scope.

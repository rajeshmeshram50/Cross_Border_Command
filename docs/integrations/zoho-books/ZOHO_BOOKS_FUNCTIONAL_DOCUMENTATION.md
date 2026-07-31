# Zoho Books Integration — Complete Functional Documentation

> A comprehensive, beginner-friendly guide to how Purchase Orders, Supplier Invoices,
> Payments and Debit Notes flow from our app into Zoho Books. Written for operations,
> finance, support and new team members — no code required.
> **Every fact here is verified against the actual application behaviour.**

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial functional documentation |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |
| 3.0 | 2026-07-30 | System | Complete, sectioned, code-verified edition |

---

## Table of Contents

1. Introduction
2. The Big Picture
3. What Gets Synced
4. The Sync Lifecycle
5. Before You Sync (prerequisites)
6. TDS Explained
7. Domestic vs International
8. Attachments & Paperwork
9. Debit Notes
10. Payment Workflows
11. Idempotency & Safety
12. Common Messages
13. Glossary
14. Quick Reference

---

## 1. Introduction

### 1.1 What this document covers
How the **Procure-to-Pay (P2P)** module integrates with **Zoho Books**: what gets synced
and when, why it works the way it does, how to use it, and how to read the messages.

### 1.2 Who should read this

| Role | What they'll learn |
|---|---|
| Operations users | When and how to sync documents |
| Finance users | What appears in Zoho and why |
| Support staff | How to troubleshoot |
| New team members | The whole integration end-to-end |

### 1.3 The 2-minute summary
Two filing cabinets: **our app** (where operations create POs, receive invoices, record
payments) and **Zoho Books** (where finance keeps the official accounts). Filled by hand
separately, they drift apart. This integration keeps them in sync: you finish a document,
click **"Zoho Sync"**, and a matching accounting record appears in Zoho — no re-typing.

It's a **two-step** process:
1. **Sync bill** → creates the Zoho PO + Bill.
2. **Sync payment** → posts payments against that bill.

---

## 2. The Big Picture

```
 ┌──────────────────────── OUR APP (Cross_Border_Command) ────────────────────────┐
 │  Purchase Orders   Supplier Invoices   Payments   Debit Notes                   │
 │        └──────────────────┴───────── "Zoho Sync" ───────┘                       │
 │                              │                                                  │
 │                     Zoho Books Integration (the sync engine)                    │
 └──────────────────────────────┼─────────────────────────────────────────────────┘
                                 │  API calls over HTTPS
                                 ▼
 ┌──────────────────────────── ZOHO BOOKS (accounting) ───────────────────────────┐
 │  Purchase Orders   Bills   Vendor Payments   Vendor Credits                     │
 │  Vendors           Items   Attachments (PO PDF, invoice documents)              │
 └────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 What the integration does
- Creates accounting records in Zoho Books from our operational documents.
- Keeps operations and finance consistent.
- Transfers paperwork (PO PDF, invoice documents).
- Handles taxes (GST, TDS) correctly.
- Prevents duplicates (idempotent sync).

### 2.2 What it does NOT do

| Doesn't do | Why |
|---|---|
| Sync automatically | The user clicks sync to control timing |
| Delete Zoho records in normal use | It only creates (it *does* delete to roll back a failed sync) |
| Re-push edits after the first sync | Ongoing changes flow through payment sync, not a full re-sync |
| Manage Zoho users/orgs | It uses the configured Zoho organization |

---

## 3. What Gets Synced

### 3.1 Translation table

| In our app | Becomes in Zoho Books | When |
|---|---|---|
| Purchase Order (PO) | Purchase Order **+** Bill | on "Zoho Sync" |
| Supplier Purchase Invoice (with PO) | Bill on the linked PO | on "Zoho Sync" |
| Supplier Purchase Invoice (direct) | standalone Bill | on "Zoho Sync" |
| PO / SPI Payment | Vendor Payment applied to the bill | on "Sync Payment" |
| Debit Note | Vendor Credit | on "Sync" |
| Product | Item | on first sync |
| Supplier | Vendor / Contact | on first sync |

### 3.2 Why "PO becomes a PO *and* a Bill"?
A **Purchase Order** is a promise to buy — it isn't a liability. A **Bill** is the actual
"we owe money" record. We create both so finance sees the intent (PO) and the payable
(Bill), linked together.

### 3.3 What data travels

**Purchase Order → Zoho PO + Bill:** PO number, supplier, PO date, product line items
(name, quantity, unit price), GST, TDS, totals, and the PO PDF.

**Payment → Zoho Vendor Payment:** amount, payment date, bank/account, UTR/cheque number,
the proof file, and which bill it applies to.

---

## 4. The Sync Lifecycle

### 4.1 Two steps (the most important concept)

```
 STEP 1: BILL SYNC ("Zoho Sync")        STEP 2: PAYMENT SYNC ("Sync Payment")
 ──────────────────────────────         ─────────────────────────────────────
 Creates the Zoho PO + Bill.            Posts vendor payment(s) against the bill
 Does NOT force payments.               that already exists in Zoho. One at a time,
                                        or all together ("Sync All Payments").
```

### 4.2 Why two steps?
A bill exists **before** it's paid. You receive an invoice today and pay next week. Forcing
"create the bill AND pay it" in one click would be wrong. So we create the bill first, then
post payments as they actually happen.

### 4.3 A complete timeline

```
 Day 1 — Create PO           supplier ABC, 100 × ₹500 = ₹50,000, GST ₹9,000, TDS 2% = ₹1,000
 Day 2 — Record payment 1    ₹30,000, cleared
 Day 2 — "Zoho Sync"         → creates PO + Bill in Zoho, posts ₹30,000
                             "Synced to Zoho Books — PO + bill BILL-000123, posted ₹30,000.00 payment(s)."
 Day 5 — Record payment 2    ₹28,000, cleared
 Day 5 — "Sync Payment"      → "Posted ₹28,000.00 for this entry to bill BILL-000123."
 Day 5 — Verify in Zoho      Bill ₹58,000, two payments, balance ₹0
```

### 4.4 What "Sync All Payments" does
Omitting a specific payment posts **all** cleared payments at once. For each, it posts only
the **un-posted remainder** — so it never double-posts.

---

## 5. Before You Sync (prerequisites)

### 5.1 Bill-sync prerequisites

| # | Prerequisite | Why | Message if missing |
|---|---|---|---|
| 1 | Supplier attached | Zoho needs to know whom to bill | "Attach a supplier to this PO before syncing to Zoho Books." |
| 2 | ≥ 1 product line | The bill needs line items | "Add at least one product line before syncing to Zoho Books." |
| 3 | TDS decided (domestic) | The bill amount depends on it | "Deduct the TDS before syncing to Zoho Books…" |
| 4 | ≥ 1 payment recorded | The first payment posts with the bill | "Record at least one payment before syncing to Zoho Books…" |

### 5.2 Payment-sync prerequisites

| # | Prerequisite | Why | Message if missing |
|---|---|---|---|
| 1 | Bill already synced | You can't pay a bill Zoho doesn't have | "Sync this PO to Zoho Books first — its bill must exist before you can post payments against it." |
| 2 | Bank/Cash account in Zoho | A payment must come *from* an account | "Add a Bank / Cash account in Zoho Books before syncing payments…" |

### 5.3 Self-check before you click sync

```
 ☐ Supplier is attached
 ☐ At least one product line exists
 ☐ TDS is decided (domestic suppliers)
 ☐ At least one payment is recorded and cleared
 ☐ GST rates exist in Zoho Books
 ☐ Bank/cash account exists in Zoho Books (for payment sync)
```

---

## 6. TDS Explained

### 6.1 What is TDS?
**Tax Deducted at Source.** When you pay a supplier, Indian tax law sometimes requires you
to keep back a small percentage and deposit it with the government on the supplier's behalf.

```
 Invoice total  ₹1,00,000
 TDS @ 2%       ₹   2,000   (kept back, deposited to government)
 You pay        ₹  98,000
```

### 6.2 TDS in our app
- Open the **Payment Summary** screen, enter the **TDS %**, click **Deduct**.
- You type whatever percentage applies to that supplier/payment. **The app does not pick a
  TDS section for you** — it simply applies the % you enter to the base amount.
- The % is applied to the **base (goods) amount only** — not GST and not extra charges;
  those are added back after the deduction.
- TDS **locks** after the first payment **or** after the bill sync, because the Zoho bill
  then carries that figure. Changing it afterwards would make our numbers disagree with
  Zoho's.

### 6.3 Worked example (domestic)

```
 Goods (BASE)          ₹1,00,000
 GST @ 18%             ₹  18,000
 Shipping charge       ₹   2,000
 ───────────────────────────────
 Total PO amount       ₹1,20,000

 TDS @ 2% on the BASE  ₹   2,000    (2% of 1,00,000 — NOT of 1,20,000)
 Net payable           ₹1,18,000    (1,20,000 − 2,000)
```

### 6.4 Why TDS locks

| Event | TDS status | Reason |
|---|---|---|
| Before any sync | Editable | Nothing depends on it yet |
| After first payment | Locked | The paid balance was computed from it |
| After bill sync | Locked | The Zoho bill already records it |

If TDS genuinely needs to change after locking, finance adjusts it in Zoho Books directly.

---

## 7. Domestic vs International

### 7.1 The difference

| Type | Definition | GST | TDS |
|---|---|---|---|
| Domestic | Supplier in India | ✅ applies | ✅ applies |
| International | Supplier outside India | ❌ none | ❌ none |

### 7.2 How the app decides
Automatically from the **supplier's country** — India → Domestic, anything else →
International. You don't choose it.

### 7.3 What changes in the UI

| UI element | Domestic | International |
|---|---|---|
| GST breakdown | shows CGST/SGST/IGST | hidden (N/A) |
| TDS field | editable | frozen ("N/A") |
| Tax sent to Zoho | the GST rate | 0% |
| Bill-sync pre-condition | must cut TDS first | TDS check skipped (only "record a payment" remains) |

### 7.4 Examples

```
 Domestic — ABC India Pvt Ltd          International — Global Supplies Ltd (UK)
 Goods ₹50,000, GST 18% ₹9,000,        Goods $5,000, no GST, no TDS
 TDS 2% ₹1,000 → net ₹58,000           → net $5,000
 Zoho bill carries GST + TDS.          Zoho bill carries 0% tax, no deduction.
```

---

## 8. Attachments & Paperwork

### 8.1 What gets attached

| Document | Source | Where it goes in Zoho |
|---|---|---|
| PO PDF | system-generated | the PO **and** the Bill |
| Supplier invoice document | uploaded on the SPI | the linked PO + Bill (With-PO), or the Bill (Direct) |

### 8.2 File naming
The invoice document is named `<SPI number>-<invoice number>.<ext>` with unsafe characters
removed (only `A–Z a–z 0–9 _ -` kept — spaces or characters like a backtick make Zoho
reject the upload). Example: **`SPI-2026-27-024-778894.pdf`**.

### 8.3 When it happens

| Event | What attaches | How |
|---|---|---|
| PO sync | PO PDF | queued (background) |
| PO sync / payment sync | invoice documents | best-effort, inline |
| "Sync Attachment" button | invoice document | immediately, inline |

### 8.4 Rules

| Rule | Detail |
|---|---|
| Files are **added**, not replaced | The PO PDF and the invoice document sit side by side |
| Upload cap in our app | **2 MB**, types `pdf/jpg/jpeg/png/webp` (the SPI upload validation) |
| Idempotent | Once attached (`zoho_doc_attached_at` set), it's never re-attached |
| Filename sanitized | Only `A–Z a–z 0–9 _ -` |
| Storage-agnostic | Works with local disk (dev) and Azure Blob (prod) |

### 8.5 Attachment status
`GET /api/p2p/purchase-orders/{id}/attachment-status` → `queued | done | failed`.

---

## 9. Debit Notes

### 9.1 What is a debit note?
Money the **supplier owes us back** — returned/damaged goods, short delivery, an
overcharge, etc. In Zoho Books it becomes a **Vendor Credit**.

### 9.2 How it syncs

```
 Our Debit Note (we're owed) ──"Sync"──► Zoho Vendor Credit
 Finance can apply the vendor credit against the supplier's open bills to reduce what we owe.

 Example: bill ₹1,00,000  −  vendor credit ₹5,900  =  balance ₹94,100
```

### 9.3 Prerequisites
A vendor is attached, at least one line item exists, and it isn't already synced.

---

## 10. Payment Workflows

### 10.1 Recording a payment
On the PO/SPI Payment Summary, click **+ Update Payment** and enter the amount, date, bank
name, UTR/cheque number, and upload a proof file. Saving records the payment (status
`Cleared` or `Pending`).

### 10.2 Sync one vs sync all
- **One entry** — the per-row **Sync** button posts that specific cleared payment.
- **All** — **Sync All Payments** posts every cleared, un-posted payment at once.

### 10.3 The posting logic (why it never double-posts)

```
 For each payment:
   total amount            ₹50,000
   already posted to Zoho  ₹30,000   (from zoho_applied_amount)
   post only the remainder ₹20,000
```

### 10.4 Multiple payments example

```
 Invoice ₹1,00,000
 Pay 1 ₹40,000 → sync posts ₹40,000 (balance ₹60,000)
 Pay 2 ₹35,000 → sync posts ₹35,000 (balance ₹25,000)
 Pay 3 ₹25,000 → sync posts ₹25,000 (balance ₹0)
 "Sync All" later: 1 & 2 already posted → skipped; posts only Pay 3.
```

---

## 11. Idempotency & Safety

### 11.1 What is idempotency?
**Safe to repeat.** Re-clicking "Zoho Sync" won't create duplicates.

### 11.2 How it's guaranteed

| Mechanism | What it does |
|---|---|
| Stored Zoho ids | Once synced, the Zoho PO/Bill ids are saved; a re-sync sees them and stops |
| Payment ledger | `zoho_applied_amount` tracks what's posted; only the remainder is pushed |
| Advisory locks | `zoho:sync:po:{id}`, `zoho:syncpay:po:{id}` stop two people syncing the same doc at once (the second gets "already in progress") |

### 11.3 All-or-nothing rollback
If a sync fails midway, the system deletes what it created in Zoho (payments → bill → PO),
stores the error, and sets the status back to "Not Sync". Zoho is left exactly as before.

---

## 12. Common Messages

### 12.1 Errors (and what to do)

| Message | Meaning | What to do |
|---|---|---|
| "Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again." | Zoho keys missing | Contact the administrator |
| "Sync this PO to Zoho Books first — its bill must exist before you can post payments against it." | Bill not synced yet | Bill sync first |
| "Record at least one payment before syncing to Zoho Books — the first payment is posted against the bill on sync." | No payment yet | Add a payment |
| "18% tax not found in Zoho Books — add it and try again." | Tax rate missing in Zoho | Add it in Zoho; retry (self-heals) |
| "Add a Bank / Cash account in Zoho Books before syncing payments — they cannot be posted without one." | No bank account | Create one in Zoho |
| "Attach a supplier to this PO before syncing to Zoho Books." | Supplier missing | Add a supplier |
| "Add at least one product line before syncing to Zoho Books." | No products | Add a line |
| "A Zoho sync for this purchase order is already in progress — try again in a moment." | Concurrent sync | Wait, retry |

### 12.2 Success / "nothing to do"

| Message | Meaning |
|---|---|
| "Synced to Zoho Books — PO + bill BILL-000123, posted ₹1,00,000.00 payment(s)." | Bill sync succeeded (with payments posted) |
| "This PO is already synced with Zoho Books (bill BILL-000123). Use “Sync Payment” to post its payments." | Already synced (idempotent) |
| "Posted ₹50,000.00 for this entry to bill BILL-000123." | Single payment posted |
| "All recorded payments are already posted to Zoho Books." | Nothing left to post |
| "Invoice document attached to the Zoho purchase order and bill." | Attachment succeeded |

---

## 13. Glossary

### 13.1 Business terms

| Term | Plain English |
|---|---|
| Sync | Copy a record from our app to Zoho Books |
| PO | Purchase Order — our promise to buy |
| SPI | Supplier Purchase Invoice — the bill from the supplier |
| Bill | Zoho's "money we owe a supplier" |
| Vendor / Contact | A supplier in Zoho |
| Vendor Payment | Money we paid a supplier (in Zoho) |
| Vendor Credit | Money the supplier owes us (our Debit Note, in Zoho) |
| Item | A product, in Zoho |
| GST | Goods & Services Tax — CGST+SGST within a state, IGST across states |
| TDS | Tax Deducted at Source — withheld for the government |
| Domestic / International | Supplier in India vs outside India |
| Cleared | A payment that's confirmed |
| UTR | Unique Transaction Reference (a bank payment identifier) |

### 13.2 Technical terms

| Term | Plain English |
|---|---|
| Idempotent | Safe to repeat — no duplicates |
| Rollback | Undo everything if a step fails |
| Queue | Background job processing |
| Inline | Happens immediately, not in the background |
| Advisory lock | Stops two people doing the same action at once |
| OAuth | A secure way for our server to log in to Zoho |

---

## 14. Quick Reference

### 14.1 Sync actions

| To sync | Button | When |
|---|---|---|
| PO + Bill | "Zoho Sync" | when the PO is ready for finance |
| One payment | per-row "Sync" | after a payment clears |
| All payments | "Sync All Payments" | to post everything at once |
| Debit note | "Sync" | when it's ready |
| Invoice document | "Sync Attachment" | after the invoice's bill exists in Zoho |

### 14.2 Where the buttons live

| Screen | Buttons |
|---|---|
| Purchase Order list | "Zoho Sync" (row) |
| Supplier Invoice list | "Zoho Sync", "Sync Payment", "Sync Attachment" (row) |
| Payment Summary popup | TDS "Deduct", per-row "Sync", "Sync All Payments" |
| Debit Note list | "Sync" (row) |
| Dev Tools · Zoho Books | read-only inspector (admin) |

### 14.3 The golden rule
**Always sync the bill before syncing payments.** A bill must exist in Zoho before you can
pay it.

### 14.4 Where to go next
- **Technical** tab — how it's built (service, config, security, failure handling).
- **API** tab — exact endpoints and example requests/responses.
- **Code Walkthrough** tab — a line-by-line story of each sync path.

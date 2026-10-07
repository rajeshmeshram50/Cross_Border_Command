# P2P Purchase Order — Functional Documentation

## 1. The feature in one paragraph

A Purchase Order is the company's written commitment to buy from a supplier. It
is built across five steps: the supplier and the order's shape, the product
lines, the terms — and at that point it is **submitted**, which is where three
compliance blockers run. After submission the order gathers its trade documents,
which are generated, signed through Zoho Sign and emailed; **sending them for
signature is what unlocks the money side**. Payments are then released only
through approved Payment Requests, never from the order screen itself. A PO
raised with inspection required also gets its own screen, opened on submit,
where each line is given a verdict and signed off. A PO with money against it
can no longer be cancelled here at all — it has to go through an Advance
Receipt Refund Adjustment. The whole order can be mirrored into Zoho
Books as a Purchase Order and a Bill.

---

## 2. Where it lives

| | |
|---|---|
| Menu | **Procure to Pay (P2P) → Purchase Management → Order** |
| URL | `/p2p/order` |
| Menu permission key | `p2p.order` |
| Screens | List (5 tabs) · Create PO wizard (5 steps) · Trade Documents · Manage Payment Requests · Physical Inspection · PO Evidence Vault · Zoho Tracker |

> ### Read this before testing anything
>
> **There are two Purchase Order screens in this app, and they sit next to each
> other in the same menu group.** This document describes the one labelled
> **Order**.
>
> | Menu label | URL | Backend | This document |
> |---|---|---|---|
> | **Order** | `/p2p/order` | `/api/p2p/orders` | **Yes** |
> | Purchase Order (PO) | `/p2p/purchase-order` | `/api/p2p/purchase-orders` | No — different behaviour |
>
> The older screen's API carries endpoints this one does not — `previewPdf`,
> `attachment-status`, `reattach`, `send-for-signature`, `zoho-pdf` — so finding
> them in `routes/api.php` is not evidence that this screen has them.
>
> The menu label is the trap: a tester told to open "Purchase Order" will open
> the wrong screen. **Open "Order".**

### How to reach every screen

Everything in this module is opened from **one row on the list**. There is no
other entry point — no deep menu, no separate pages.

```
P2P → Purchase Management → Order             the LIST  (§3A)
      │
      ├─ + Create PO ──────────────► the link chooser, then the wizard   §12C·2
      │
      └─ a row ──┬─ Step 01  Link Supplier Details        §3B
                 │     └─ + Add Supplier ─► the Supplier master's own wizard
                 ├─ Step 02  Product Details              §3B
                 │     └─ edit the supplier in place, to map a product to it
                 ├─ Step 03  Terms & Conditions           §3B
                 │     └─ Submit ──► six gates                   §12A·03
                 │           └─ GST blocked? ─► raise a senior approval
                 │                 └─ decided in the senior's INBOX  §7
                 ├─ Step 04  Trade Documents              §8
                 │     ├─ Generate · Upload · Add a document of your own
                 │     ├─ Send for signature ─► Zoho Sign    ← unlocks Step 05
                 │     ├─ Signing Tracker · Certificate · Email
                 │     └─ Supplier Evidence Vault  (the SUPPLIER's KYC / DD / TL)
                 ├─ Step 05  Payment Management           §12A·05
                 │     ├─ Deduct TDS
                 │     ├─ Raise Payment Request ─► the approver's queue
                 │     │        (P2P → Payment Request — its own documents)
                 │     └─ Add Payment
                 ├─ Physical Inspection    only if raised with it required   §8A
                 │     └─ per-line verdicts → Sign off / Withdraw
                 ├─ PO Evidence Vault      six sections of files            §8B
                 ├─ Zoho Sync / Zoho Tracker                                §11
                 ├─ Quantity history       every line change, with who and when
                 ├─ Delete                 DRAFTS ONLY                      §10
                 └─ Cancel ──► if money is paid, you are sent to
                               P2P → Advance Refund Adjustment  (its own documents)
```

Two screens in that tree are **not** reached from the PO at all:

| Screen | Where it actually lives |
|---|---|
| Deciding a GST approval | The senior's **Inbox** |
| Deciding a payment request | **P2P → Payment Request** |

Both are deliberate: the person who raises a thing is never the person who
approves it, so the approval does not live on the raiser's screen.

**Delete and Cancel are different actions**, not two words for one — see §10.

---

## 3. The five steps

| Step | Name | What the user does |
|---|---|---|
| **01** | Link Supplier Details | Supplier, order type, domestic/international, linkage to a shipment or standalone, currency, incoterm, ports, delivery date, and the **Physical Inspection Required** toggle |
| **02** | Product Details | Add lines: product, description, quantity, rate, GST %. Totals are computed by the server |
| **03** | Terms & Conditions | Payment terms text, shipping / packaging / other charges — then **Submit** |
| **04** | Post-PO Trade Document Management | Generate, upload, mark necessary, send for e-signature via Zoho Sign, email |
| **05** | Payment Management | TDS, payment requests, and the payments released against them (see the Payment Request documents) |

Steps 01–03 are editable while the PO is a **draft**. Submitting moves it to
**submitted** and brings Stage 04 into existence.

---

## 3A. The list view

The screen you land on. Five tabs (§12B), a search box, and one row per PO.

### Columns

| Column | What it shows |
|---|---|
| Sr. No | Row number |
| **PO Number** | `PO/<FY>/<SEQ>` — click to open |
| PO Type | Material / Goods · Services · FFD / Transporter |
| Document Type | Domestics · International |
| Shipment ID · Opportunity ID · Procurement ID | The upstream links, blank on a standalone PO |
| Supplier | Name and code |
| **Risk Alert** | Star Supplier · Regular Supplier · **High Risk Supplier** · **Blacklisted Supplier** |
| Expected Delivery Date | |
| **PO Status** | Saved not yet submitted · Submitted · Cancelled |
| **Physical Inspection Status** | Only when the PO required it |
| **Payment Progress Status** | Payment Not Initiated · Partially Paid · **Fully Paid** |
| **Payment Recovery Status** | To Be Refunded · Not Refunded — only on a cancelled-with-money PO |
| **Zohobook Status** | Synced · failed · not sent |
| Total PO Amount · Net Payable Amount · Total Paid Amount · Balance Amount | The four stored money columns |
| Action | The buttons below |

**Search** covers PO number, supplier, shipment / opportunity / PI id, PO type,
document type **and status** — anything visible on the row.

### The step buttons on each row

Each row carries the five steps as direct entry points, so a PO can be resumed
at the step it stopped at rather than walked through from the start:

| Button | Opens | Disabled when |
|---|---|---|
| **Step 01** Link Supplier Details | The wizard at Step 01 | PO cancelled |
| **Step 02** Product Details | The line table | PO cancelled |
| **Step 03** Terms & Conditions | Terms + Submit | PO cancelled |
| **Step 04** *(trade documents)* | The document set | *"Submit the PO first"* |
| **Step 05** Payment Management | TDS / requests / payments | *"PO not sent for signature"* |

Those last two tooltips are the two gates in plain sight: **Step 04 needs a
submitted PO, Step 05 needs the documents to have gone out for signature.**

### The action buttons

| Button | What it does | Shown / enabled when |
|---|---|---|
| **+ Create PO** | *"Raise a new Purchase Order — with a Shipment ID or standalone"* | Always |
| **Open** | *"Open this Purchase Order"* | Always — read-only once cancelled |
| **Zoho Sync** | Pushes the whole chain: PO → Bill → payments → vendor credit → refunds | Zoho configured. Tooltip carries the failure reason when it failed |
| **Zoho Tracker** | Per-step state: what synced, what is pending, what failed and why | After a sync attempt |
| **Cancel** | *"Cancel this Purchase Order"* — asks for a reason | Not already cancelled. **Refused if any money is paid** |
| **Evidence Vault** | The **PO's** six sections of filed documents and proofs (§8B) — not the supplier's vault | Always |
| **Physical Inspection** | Per-line verdicts, proof and sign-off (§8A) | The PO was raised with inspection required **and** is submitted |
| **Quantity history** | Every line quantity change, with its previous value, who and when | Always |
| **Delete** | Removes the PO outright. **Drafts only** — *"Only a draft PO can be deleted — cancel a submitted PO instead."* | `status = draft` |
| **GRN · QA · SPI** | Goods receipt, quality, supplier purchase invoice | *"Feature coming soon"* |

### Status messages you will meet on the row

| Message | Meaning |
|---|---|
| *Saved, not yet submitted* | Draft |
| *Submitted — the PO is issued* | Live |
| *This PO has been cancelled* | Hover shows the cancellation reason |
| *Cancellation initiated — `<amount>` still to recover* | Money is owed back; see the Refund Adjustment module |
| *This PO was cancelled before any payment — nothing to send to Zoho Books* | Why the Zoho button is inert |
| *Zoho Books sync failed* | Hover carries Zoho's own message |
| *Submit the PO first* | Step 04 not yet reachable |
| *PO not sent for signature* | Step 05 not yet reachable |

### From the list to a signed document

```
List row
  └─ Step 04  Post-PO Trade Document Management
        ├─ Generate            render the PO PDF from the template
        ├─ Upload              attach a signed copy received outside the system
        ├─ Mark Necessary      decides what gates this supplier's LATER orders
        ├─ Send for signature  → Zoho Sign                ← unlocks Step 05
        ├─ Signing Tracker     per-signer progress
        ├─ Download Certificate the completion certificate
        ├─ Email               send to the supplier
        └─ Download / Delete
                 │
                 ▼
        Evidence Vault — the finished set, plus every payment proof
```

---

## 3B. The Create PO form, step by step

What the operator actually sees and fills in. Required fields are marked **\***.

---

### STEP 01 · Link Supplier Details

#### Order header

| Field | Type | Notes |
|---|---|---|
| PO Date | read-only | Today |
| PO Number | read-only | `PO/<FY>/<SEQ>`, e.g. **`PO/2026-27/018`** — financial year `YYYY-YY`, 3-digit sequence per client. Previewed here, allocated under a lock on save |
| **PO Type** \* | dropdown | Material / Goods · Services · FFD / Transporter. **Only Material / Goods can be raised at present** |
| **Document Type** \* | dropdown | Domestics · International |
| **Mode of Transport** \* | dropdown | By Road · By Sea · By Air |
| **Expected Delivery Date** \* | date | **Cannot be earlier than today** |
| **Delivery Location** \* | dropdown | From the warehouse master |
| **Payment Type** \* | dropdown | Advanced Payment · Full Payment · Letter of Credit |
| **Physical Inspection Required** \* | toggle | **Required — every PO answers it.** Yes opens the inspection screen once the PO is submitted (§8A). It cannot be changed into existence later |

#### International only — appears when Document Type = International

| Field | Notes |
|---|---|
| **Currency** \* | From the currency master. **Cannot be INR** on an international PO |
| **Exchange Rate** \* | Greater than 0 and **at most 10,000** — *"Check for a misplaced decimal"* |
| **INCO Term** \* | FOB · CIF · EXW · C&F |
| **Port of Loading** \* | ≤ 255 characters |
| **Port of Discharge** \* | ≤ 255 characters |
| **Final Destination** \* | |
| **Country of Origin** \* | From the country master |

#### Supplier — picked, then displayed read-only

Choosing a supplier pulls their record in and shows it. **None of this is typed
on the PO** — it comes from the vendor master:

> Company Legal Name · Registered Office Address · City · Country · **State Code** ·
> **GST Number** · Contact Person Name · Designation · Contact Number · Email ID ·
> **Risk Level** · Previous Invoice / Remarks

#### + Add Supplier — onboarding one without leaving the PO

If the supplier does not exist yet, **+ Add Supplier** opens the Supplier
master's own flow in place: first the Domestic / International scope gate, then
its full onboarding wizard.

> *Both screens are the Supplier module's components, reused as-is, so a
> supplier added here is the same record the master creates.*

There is no lightweight "quick add" — a supplier created from the PO is a
complete supplier record, with the same required fields and the same KYC
obligations. That matters because the submit blockers will read it.

#### Supplier compliance panel — three things that can stop you

| Panel | Shows | Blocks? |
|---|---|---|
| **GST Status** | `clear` / `approval_required` / `blocked`, with **Scrutiny Date** and **Last Filing Date** | See §7 |
| **Legal status** | KYC, Due Diligence, Trade Licences from the Evidence Vault | Expired ones block submit |
| **Risk Level** | From the vendor master | **Blacklisted is a hard block** — *"This supplier is blacklisted"* |

Three notice modals exist for exactly these: a GST notice, a supplier-documents
notice, and a currency notice when the supplier is already locked to a different
trading currency.

---

### STEP 02 · Product Details

#### The line table

| Column | With Shipment | Standalone |
|---|---|---|
| Sr. No | — | — |
| **Product (PI)** | The PI line's product, replaceable within its segment | Chosen from the product master |
| HSN | From the product master | same |
| Description | Editable | Editable |
| **Qty (PI)** | What is still open on the PI line | — |
| **Purchase Order Entry** (qty) | How much of it this PO takes | Typed freely |
| **Missing Qty** · **Extra Qty** | Under / over against the PI | — |
| Product Cost | From the product master | same |
| **Product Rate** | Editable | Editable |
| CGST (%) · SGST (%) | The product's GST %, split by tax mode | same |
| CGST / SGST Amount · Total GST Amount | **Server-computed** | same |
| Amounts | Line total | same |

#### Every step opens with a recap

The wizard shell holds what has been filled in so far, so each step begins with
a read-only summary of the ones before it — *"the form shell owns it so a later
step can read earlier answers."* On Step 02 that is Step 01's answers; on
Step 03, Steps 01 and 02.

It is a recap, not a second form: nothing in it is editable, and the one
exception is the supplier, below.

#### Step 02 has its own Save

Two buttons can save on this step and they are not the same:

| Button | Where | Does |
|---|---|---|
| **Save** | Beside the Grand Total, in the charges summary | Banks the lines and charges **without leaving Step 02** |
| **Next** | The wizard footer | Saves and moves on |

Only the one you pressed shows a spinner (CS-409) — *"spins for its own save,
not for the footer's."* So a spinner on Next while Save sits idle is correct
behaviour, not a missed state.

#### The header strip — where the supplier is changed

Above the table sit **Supplier Code · Supplier Name · State Code · PI Number**.
The supplier is **not** retyped here — it is changed through the edit control
beside the name, which takes you back to Step 01. That matters because changing
the supplier re-opens three things at once:

| Changing the supplier re-evaluates | Where it bites |
|---|---|
| **Segments** | Every existing line is re-checked against the new supplier's segments |
| **GST gate** | Re-read live; a clear supplier can become `approval_required` |
| **Tax mode** | Their state vs ours decides CGST+SGST or IGST — all line amounts re-split |
| **Currency lock** | The supplier may already be locked to a different trading currency |

This is why gate 3 exists on submit: *"the supplier may have changed after the
lines were saved."*

#### Rule 0 — a line at zero is not an error

```
if (qty <= 0) → no errors at all on this line
```

> *A line left at 0 is simply not on this PO — it goes on the next one, so it
> carries no errors at all. Everything below is checked once it is ordered.*

The one exception: a **standalone** line with a product chosen but no quantity
gets *"Enter a quantity, or remove the line."* On a PI line, zero just means
"not taking any of this one".

And across the whole table: **at least one line must be ordered** —
*"Enter a quantity on at least one line."*

#### Rules on an ordered line, in order

| # | Condition | Message | Cell |
|---|---|---|---|
| 1 | No product chosen | with PI: *Pick the product for this PI line.* · standalone: *Pick a product, or remove the line.* | Product |
| 2 | **PI line fully ordered** | *This PI line is fully ordered — nothing is left to order against it.* | Qty |
| 3 | Rate is zero | *Enter a rate.* | Rate |
| 4 | Rate too high | *Rate looks wrong — the most for one unit is `<fmt>`.* | Rate |
| 5 | Quantity too high | *Quantity looks wrong — the most on one line is 10,000,000.* | Qty |
| 6 | Line value too high | *This line comes to X — the whole PO cannot exceed Y.* | Rate |
| 7 | **No GST % on the product** (domestic only) | *No GST % on the product master…* | Product |
| 8 | Product inactive | *This product is `<status>` in the product master — activate it there to order it.* | Product |
| 9 | Segment not the supplier's | *Segment mismatch — `<Segment>` is not mapped to this supplier. Add `<Segment>` to the supplier's segments.* | Product |
| 9a | Product has no segment at all | *Segment mismatch — this product has no segment set in the product master.* | Product |
| 10 | **PI segment mismatch** (with shipment) | *The PI line is in `<Segment>` — pick a product from the same segment.* | Product |

Rules 8, 9 and 10 are evaluated in that order and **only the first one shows** —
one message per cell, not a stack.

Rule 9 has an escape: a product **mapped directly to this supplier** passes even
if its segment does not match. The direct mapping is the stronger statement.

Rule 7 is skipped on an international PO — there is no Indian GST to set.

#### The ceilings, and why they are rupee ones

> **The browser and the server disagree about two of these.** The server was
> tightened and the browser copy was not, so the figures below differ depending
> on which one you hit. Both are stated — do not treat either as *the* limit.

| Ceiling | Server (`PurchaseOrderController`) | Browser (`validation.ts`) | Agree? |
|---|---|---|---|
| One unit's rate | **₹1,000,000,000** (₹100 cr) | ₹10,000,000,000 (₹1,000 cr) | **No — 10×** |
| Whole PO | **₹1,000,000,000** (₹100 cr) | ₹1,000,000,000,000 (₹1 lakh cr) | **No — 1,000×** |
| One line's quantity | 10,000,000 | 10,000,000 | Yes |
| Shipping / packaging / other charges, each | **₹1,000,000,000** | not checked | — |

The server is the authority. `MAX_UNIT_RATE_BASE = MAX_ZOHO_BASE`, deliberately:

> *Tied to the order ceiling rather than carrying a second hand-picked number —
> one unit cannot be worth more than the whole order may be… It was 10 billion
> while the order was 1 trillion; left there it would now be ten times the
> order it belongs to.*

`validation.ts` still carries the old pair under a comment reading *"Mirrors
PurchaseOrderController"*, which it no longer does.

**What QA sees because of this:** a line between ₹100 crore and ₹1,000 crore
passes every check in the browser, shows no error in any cell, and is then
refused on Save by the server with a *different* number in the message. Raised
as a defect; the document records both until it is fixed.

> *Both ceilings are RUPEE ones, because the rupee figure is the only one Zoho
> judges — it converts at the PO's own rate and posts that to the ledger.*

On a domestic PO the rate is 1. On an international one the limit is divided by
the exchange rate, so the same rule fits every currency. The message always
shows the converted figure, in the PO's currency.

Why they exist at all:

> *An order of magnitude typed into the rate used to pass every check here and
> fail hours later inside Zoho Books… A PO of 1,987 cars at 13,000,000,000 each
> reached 25,831,000,000,000 that way.*

And why ₹100 crore specifically:

> *Measured against this org's own 17 orders before choosing it: the largest
> GENUINE order is ₹1.73 crore, so a 100-crore ceiling still leaves ~58x
> headroom. The three above it are the known bad rows (₹20.88 tn, ₹11.06 tn,
> ₹123.6 bn) — exactly what this is for.*

#### One more lock on Step 02

Once **any payment is recorded**, the lines and charges freeze — before the PO
is cancelled, and regardless of status:

> *"Payments are already recorded on this PO — its product lines and charges can
> no longer change."*

The stored balance and TDS rest on the line total, so letting it move after cash
has gone out would silently change what is owed.

#### Missing Qty and Extra Qty — with shipment only

Both columns are derived from the PI line's **pending** quantity — what is still
open after earlier POs, not the original PI quantity:

```
Missing Qty = max(0, pending_qty − qty on this PO)      "you have under-ordered"
Extra Qty   = max(0, qty on this PO − pending_qty)      "you have over-ordered"
```

| State | Column | Styling | Meaning |
|---|---|---|---|
| Ordering **less** than remains | **Missing Qty** highlighted | `cpd-miss` | The rest can go on a later PO — **allowed** |
| Ordering **more** than remains | **Extra Qty** highlighted | hover explains: *"N over the M still open on the PI"* | **Allowed** — an open PI line may be over-ordered |
| `pending_qty` already 0 | Rule 2 fires | error | **Refused** — nothing is left |

So under-ordering and over-ordering are both permitted and merely flagged. What
is refused is ordering against a line that is **already exhausted** — *"over-drawing
closes it, so a line already at zero takes nothing more."*

The `Qty (PI)` cell's tooltip shows the original PI quantity and how much earlier
POs already took, so `Qty (PI) − Qty (PO) = Missing Qty` is readable from the row.

#### With shipment vs standalone — what changes in Step 02

| | With Shipment | Standalone |
|---|---|---|
| Missing / Extra columns | **Shown** | Hidden |
| Rule 2 (line exhausted) | Applies | — |
| Rule 10 (PI segment) | Applies | — |
| Rule 1 message | *Pick the product for this PI line.* | *Pick a product, or remove the line.* |
| Zero quantity | Simply not taken | Error if a product is chosen |
| Product source | The PI line, replaceable within its segment | Free choice from the product master |
| Rules 3–9 | Identical | Identical |

The server re-checks every one of these. The client copy exists so the operator
sees the problem in the cell that caused it, rather than as a list after saving.

---

### STEP 03 · Terms & Conditions

| Field | Notes |
|---|---|
| Terms | Free text, up to 20,000 characters |
| Shipping charges · Packaging charges · Other charges | Added to the order total. **Each is capped at ₹100 cr** on the server, divided by the exchange rate on an international PO — *"Shipping charges look wrong — the most this PO takes is `<CCY> X`."* The browser does not check them |
| **Charges summary** | Taxable total, CGST, SGST, IGST, grand total — all server-computed |

Then **Submit**. That is where the six gates run (§12A · Stage 03) — four of them re-read
live data, so a PO that passed yesterday can be refused today.

---

### STEP 04 · Post-PO Trade Document Management

Appears only once the PO is submitted — until then the step is disabled with
*"Submit the PO first"*.

#### The documents table

| Column | What it shows |
|---|---|
| Sr. No | |
| **Document Code** | `DOC/<FY>/<SEQ>` — one sequence per client |
| **Document Name** | From the library row, or *Purchase Order* for the order itself |
| **Necessary** | Yes / No — **the decision this screen exists to make** |
| **Generated On** | The date the row was materialised onto the PO |
| **Valid Up To** | Expiry, where the document carries one |
| **Document Attachment** | The file — generated, uploaded, or the signed copy |
| **Current Status** | `pending` → `sent` → `signed` |
| Action | Generate · Upload · Send for signature · Tracker · Certificate · Email · Download · Delete |

Alongside it sits the **Supplier Evidence Vault** panel — the supplier's own KYC,
Due Diligence and Trade Licences. Those are *not* rows in this table; they belong
to the supplier, not the order, and they are what **Blocker 2** checks at submit.

#### The three statuses

| Status | Meaning | What it locks |
|---|---|---|
| `pending` | On the PO, nothing sent | Everything still editable |
| `sent` | Out for signature via Zoho Sign | **Necessary can no longer be changed.** This is also what unlocks Step 05 |
| `signed` | Returned signed | The file can no longer be replaced |

#### What is on the list, and where each row comes from

| Row | Source | Arrives as |
|---|---|---|
| **Purchase Order** | Always, generated from our own template | **Necessary** — and cannot be changed |
| Trade documents | `clm_trade_doc_library`, for the segments of **this PO's products** | Not necessary |
| Agreements | `clm_agreement_library`, same segments | Not necessary |

The sourcing chain — which segments, which library rows, and why a document you
expected is missing — is in **§8**. The one-line version: **the products on the
PO decide the paperwork**, not everything the supplier is approved for.

#### Actions

| Action | Requires |
|---|---|
| **Add a document** | Nothing — the PO need only not be cancelled. **The seeded set is not the whole set:** you can file a document of your own with a name (≤ 150), kind, Necessary, Valid Up To and a file. It gets its own `DOC/<FY>/<SEQ>` code and starts at `pending`, Not necessary unless you say otherwise |
| Select all documents / Clear selection | Bulk handling |
| **Mark Necessary / Not necessary** | Not the PO document, and not already sent for signature. **This is what gates the supplier's *later* orders** (Case to Case) |
| Generate | Only the Purchase Order document can be generated |
| Upload | Not already signed — *"A signed document cannot be replaced."* |
| **Send for signature** | A file is attached, not already signed. **This is what unlocks Step 05** |
| **Signing Tracker** | Per-signer progress from Zoho Sign |
| Download Certificate | The completion certificate |
| Email | Send the set to the supplier |
| Download / Delete | The file exists |

#### File limits on this step

| | |
|---|---|
| Size | **10 MB** per file |
| Types | `pdf` · `doc` · `docx` · `jpg` · `jpeg` · `png` |

Not the same as physical-inspection proof, which allows 20 MB and video (§8A).
A video of the goods therefore belongs on the inspection screen, not here.

---

### STEP 05 · Payment Management

Covered in §12A · Stage 05. In form terms: **Deduct TDS** → **Raise Payment Request** →
(the approver decides) → **Add Payment** with bank, UTR and proof.

---

## 4. Order types and what they change

| `po_type` | Meaning | Available? |
|---|---|---|
| `material_goods` | Physical goods | **Yes — the only one enabled** |
| `services` | Service procurement | Listed but locked |
| `ffd_transporter` | Freight forwarder / transporter | Listed but locked |

`OPEN_PO_TYPES` holds the types currently **open for use**, and at present that
is `material_goods` alone. The other two appear in the dropdown so the intent is
visible, but choosing one is refused:
*"Only Material / Goods purchase orders can be raised for now."*

| `document_type` | Effect |
|---|---|
| `domestic` | Settled in INR. Tax is CGST+SGST or IGST depending on state |
| `international` | Export/import. Tax mode is `export`; currency and exchange rate apply |

---

## 5. Linkage — with shipment or standalone

**With shipment** — the PO is raised against a Shipment Order and its Proforma
Invoice. Step 02 draws its lines from the PI.

The PI is **not** a set of lines that get claimed whole. It is a **quantity
ledger**: each PI line shows how much is still open after earlier POs, and this
PO takes some of it. Two POs can split one line. What is refused is ordering
against a line that is **already exhausted**.

What holds quantity:

| | Holds? |
|---|---|
| A **submitted** PO | Yes |
| A **draft with a GST approval in flight** | Yes — it is not abandoned |
| A plain draft | **No** |
| A soft-deleted PO | No |

Plain drafts were deliberately removed from the rule: abandoned ones had taken
whole PIs between them with nothing ever releasing the quantity, and the only
message anyone saw was *"nothing left to order"*.

Cancelling a PO — by either route — returns its quantity to the PI.

**Standalone** — no upstream document. The line table opens empty, lines are
entered freely from the product master, and nothing is reserved anywhere.

A standalone PO **cannot** be attached to a procurement request:
`link_procurement` is `prohibited_if:link_type,standalone`, so the procurement
link belongs to the shipment branch only. The list's Procurement ID column is
therefore blank on a standalone PO — and, as it happens, on every PO raised
through the UI. The full picture is in §12C · Flow 2.

The choice is made in the **Create Purchase Order** modal before any field is
filled, and it is not a label on the form — it sets `link_type`, which decides
what Step 02 looks like for the life of the order.

Two things lock the link afterwards:

| Change | Refusal |
|---|---|
| The shipment, once lines exist | *"Remove the product lines before changing the shipment — they are matched to its PI."* |
| The supplier or document type, once the PO has gone to a senior | *"This PO has gone to the senior for approval — the supplier and document type can no longer change."* — and on the field: *"The supplier is fixed once the PO is sent for senior approval."* |

The second is why the supplier is otherwise left editable from Step 02: it stays
open right up to the point a senior is asked to accept a risk on it, and a
pending request fixes it just as an approved one does.

---

## 6. Tax

The tax mode is decided by **where the supplier is** against **where we are**:

| Supplier state vs our state | Tax |
|---|---|
| Same | CGST + SGST |
| Different | IGST |
| International document type | Export — no GST |

The user does not choose this. It follows from the supplier's registered state
and the branch's home state code, and it determines which Zoho tax is used on
the bill.

---

## 7. The GST gate

The supplier's GST position is read from their latest scrutiny record and judged
against a **3-month cutoff**. Two dates matter, and they mean different things:

| Gate | Condition | Meaning |
|---|---|---|
| `clear` | Scrutiny **and** last filing both within 3 months | Proceed |
| `approval_required` | Scrutiny fresh, **the return is overdue** | A senior may accept the risk |
| `blocked` | **No scrutiny, or scrutiny older than 3 months** | Nobody can approve past it |

**The distinction is the point:**

- **Scrutiny stale → blocked.** We have not *looked* at this supplier recently. That is not a risk anyone can accept on our behalf — go and re-run the scrutiny.
- **Filing overdue → approval_required.** We have looked, and the supplier has not filed. That is a commercial risk a senior may choose to take.

An **international PO is always `clear`** — an import has no Indian GST, so
neither date is checked.

### The senior approval

Raised from the PO, decided from the senior's **Inbox**. A reason is required on
**both** outcomes, and the requester is notified either way.

| Rule | |
|---|---|
| Who may decide | **Only** the senior it was addressed to |
| Who may be chosen | Any active user of the client. A branch head may pick themselves; nobody else may send a GST approval to themselves |
| After a rejection | The re-request goes back to **the same senior** — the approver cannot be changed unless that person is no longer active |
| Re-deciding | Not possible; one decision per request |

The decision, who made it and when are stored on the PO. See §12A · Stage 03 for
the four messages submit produces depending on the approval's state.

---

## 8. Stage 04 — trade documents

### Where the list comes from

The set is **not** a fixed checklist. It is assembled per PO from the CLM
libraries, and the chain has four links:

```
1.  WHICH SEGMENTS?
    the segments of the PRODUCTS ON THIS PO
        │   (what is being bought decides the paperwork,
        │    not everything the supplier could supply)
        │
        └── no product segments?  fall back to the supplier's segments
                └── none of those either?  the supplier's own segment
                        └── still none?  no documents at all

2.  WHICH LIBRARY ROWS?
    for each segment, read clm_trade_doc_library and clm_agreement_library where
        · same client
        · regulatory status MATCHES THE SEGMENT'S
        · status is Active
        · the row's `segment` list contains this segment's name or code
          (a comma-separated list, matched whole — not a substring)

3.  WHICH OF THOSE APPLY?
    only rows that name the SUPPLIER as a party
        (a document addressed to the customer is not this PO's business)

4.  WHAT LANDS ON THE PO?
    the Purchase Order document itself          → always, and always Necessary
    + every surviving trade document             → Not necessary
    + every surviving agreement                  → Not necessary
```

### The two things most likely to surprise

**Segments come from the products, not the supplier.** A supplier approved for
five segments who is sold one segment's goods on this PO brings only that
segment's paperwork. The supplier's own segments are a *fallback*, used only
when the PO's lines carry no segment at all.

**Regulatory status must match.** A library row is only picked up when its
`regulatory` value equals the **segment's** regulatory status. A "highly
regulated" document sitting under a less-regulated segment is not collected.
Within what is collected, `regulatory = highly` is what the library calls
mandatory — though see below, because that is no longer what decides the PO.

### Necessary vs the library's "mandatory"

| | |
|---|---|
| The **Purchase Order** document | Always present, always Necessary, cannot be marked otherwise |
| Everything else | Arrives **Not necessary**, whatever the library says |

> *Only the Purchase Order is required outright. Whether a trade document or an
> agreement has to be signed for THIS order is decided on Stage 04 (Necessary /
> Not necessary) — the library's regulated flag no longer settles it in advance.*

And the reason they arrive answered rather than blank (CS-414):

> *A document starts Not necessary and is promoted once someone has read it —
> the list opens answered, not with a column of questions.*

So the library proposes; **Stage 04 decides**. That decision then feeds **Case to
Case** — a document marked Necessary on this PO and left unsigned will block the
supplier's *next* order.

### Re-reading is additive, never destructive

The list is rebuilt on submit **and on every Stage 04 visit**, matched by
`source_type:source_id`:

| Situation | Result |
|---|---|
| A document is already on the PO | **Untouched** — keeps its file, its signature, its Necessary flag |
| A library row was added after the PO was raised | **Appears**, as Not necessary |
| A library row was removed or deactivated | The PO keeps what it already has |

That last row is deliberate: an order already papered is not retrospectively
changed by a library edit. And new arrivals being *Not necessary* means they
cannot retroactively gate a PO — or the supplier's other orders — that were
already complete.

Each document gets a code `DOC/<FY>/<SEQ>`, one sequence per client.

### Actions, and what each requires

| Action | Requires |
|---|---|
| Generate | Only the Purchase Order document can be generated from a template |
| Upload | The document is not already **signed** |
| Mark Necessary / Not necessary | Not mandatory, and not already sent for signature |
| **Send for signature** | A file is attached, and it is not already signed |
| Signing Tracker · Download Certificate | A signature request exists |
| Email | — |
| Download | The file exists on disk |
| Delete | — |

Sending any document for signature is what sets `signing_started` on the PO,
which is the gate that **unlocks Step 05, Payment Management**.

---

## 8A. Physical inspection

A separate screen, reached from the PO row, where the goods that arrived are
checked line by line and the result is signed off. It exists only if the PO was
raised with **Physical Inspection Required = Yes** on Step 01 — and that field
is **required** there, not an optional extra: every PO answers it one way or the
other.

### Who can open it

| Condition | Refusal |
|---|---|
| The PO was raised with inspection required | *"This PO does not require physical inspection."* |
| The PO is **submitted** | *"Only a submitted PO can be inspected."* |

**Note what is *not* here.** Inspection does **not** wait for the documents to go
out for signature. That gate guards Step 05 only — inspection opens as soon as
the PO is submitted. A PO can therefore be fully inspected and signed off before
a rupee is payable.

Nor is it blocked by cancellation in its own right; the two checks above are the
only ones, so a cancelled PO that was submitted and required inspection still
opens. Worth testing rather than assuming.

### The screen

A header of references — PO code and date, shipment, PI, opportunity,
procurement code, supplier, grand total — then one row per PO line:

| Column | Notes |
|---|---|
| Line no · Product code · Product name | From the live product record, not frozen on the PO |
| HSN · UOM · GST % | same |
| Description | The PO line's own, falling back to the product master's |
| Quantity | What this PO ordered |
| **Verdict** | `correct` · `damaged` · `mismatched` |
| **Remark** | Free text, ≤ 1000 characters |
| **Proof files** | Photos, video or PDF |
| Inspected by · Inspected at | Stamped per line, per save |

A progress pair sits on the header: **`lines_marked` of `lines_total`**, which is
what the sign-off button is really waiting for.

### The three verdicts

| Verdict | Means |
|---|---|
| `correct` | What arrived matches the line |
| `damaged` | The right goods, in bad condition |
| `mismatched` | Not what the line says |

There is no fourth value and no free-text verdict. `PoPhysicalInspection::VERDICTS`
is the whole list.

### Proof files

| | |
|---|---|
| Per line | **Up to 10 files**, counted on the total the line already holds |
| Per file | **20 MB** |
| Types | `image/*` · `video/*` · `application/pdf` — *"what a phone camera or scanner produces"* |
| On upload | **Added, never replaced** — *"New proof is added to what the line already holds"* |

The cap is checked **before anything is written to storage**, and the message
tells you how much room is left:

| Situation | Message |
|---|---|
| Already at 10 | *"This product already has 10 proof files — remove one to add another."* |
| Room for fewer than you picked | *"Only `<N>` more proof file(s) can be added to this product (up to 10 in total)."* |

A **camera capture** modal is built in, so proof can be taken on the spot from a
phone rather than uploaded from a file picker.

Removing a file splices it out of the row first and deletes the stored file
afterwards — *"the stored file is deleted only after the row no longer points at
it."* A stale index gives *"That file is no longer on this line."*

### Proof before verdict — deliberately allowed

```
'verdict' => ['nullable', 'required_without:files', …]
```

You may attach proof to a line without yet saying what it shows, and you may
record a verdict with no proof. What you cannot do is save **neither**. Each
line saves as it is made:

> *Each verdict and upload is saved as it is made, so an inspection can be
> paused and resumed.*

So there is no "save all" step and no draft to lose — closing the screen
mid-inspection keeps everything already entered.

### Sign-off

| | |
|---|---|
| Requires | **Every line carries a verdict** |
| Refusal | *"`<N>` line(s) have no verdict yet — mark every line before signing off."* |
| Optional | A note (≤ 1000) and up to 10 note files, same types and size as line proof |
| Sets | `inspection_status = completed`, plus the note, who signed off and when |

A remark on a line is never required — only the verdict is. So a `damaged`
verdict with no remark and no photo will sign off, which is worth raising as a
process question even though the system allows it.

### After sign-off — the lock

| Attempt | Refusal |
|---|---|
| Change a line's verdict, remark or files | *"Inspection is signed off — withdraw the sign-off to change a line."* |
| Remove a proof file | same |

### Withdraw

Reopens a signed-off inspection: `inspection_status` returns to `pending` and
the sign-off's **who** and **when** are cleared. Refused when there is nothing
to withdraw — *"There is no sign-off to withdraw."*

> **The note survives a withdrawal.** `withdraw()` resets the status, the
> inspector and the timestamp, but **not** `inspection_note` or
> `inspection_note_files`. Sign off with a note, withdraw, then sign off again
> with no note and the original note files are replaced; withdraw and leave it
> there and the old note still reads as current. Verified in the controller —
> raise it rather than documenting it as intended.

### Downloading proof

Note files and line files each have their own download route and **stream as an
attachment** rather than linking at the stored file:

> *A link straight at the stored file cannot be downloaded once the disk is
> remote (Azure): the browser drops the `download` hint across origins and only
> opens the image.*

### Statuses

| `inspection_status` | Meaning |
|---|---|
| *(empty)* | Never opened |
| `pending` | In progress, or reopened by a withdrawal |
| `completed` | Signed off |

The list view's **Physical Inspection Status** column shows this, and only on a
PO that required inspection.

---

## 8B. The two Evidence Vaults

**There are two different things called an Evidence Vault in this module, and
they hold different records.** Confusing them is the easiest mistake to make on
this screen, because both are reachable from a PO.

| | **Supplier** Evidence Vault | **PO** Evidence Vault |
|---|---|---|
| Opened from | The Step 04 panel, and Step 01's legal check | The **Evidence Vault** button on the list row |
| Belongs to | The **supplier** | The **order** |
| Holds | KYC · Due Diligence · Trade Licences | Every file filed against this PO |
| Used by | **Blocker 2** on submit — an expired document refuses the PO | Nothing. It is a reading screen |
| Renewing something there | Unblocks submit | Changes no rule |

When a submit is refused for an expired document, it is the **supplier's** vault
that must be fixed. The PO's vault will not contain that document at all.

### The PO Evidence Vault — six sections

> *Everything filed against one order, grouped the way it is looked for — the
> order, its invoices, the signed paperwork, money paid out and money recovered.*

| # | Section | Shown | When empty it says |
|:-:|---|---|---|
| 1 | **Purchase Order** — *the order everything here is filed against* | Always | *"The PO document is created when the order is submitted."* |
| 2 | **Supplier Purchase Invoices** — *invoices raised by the supplier under this order* | **Only once an SPI exists** | — |
| 3 | **Trade Documents & Agreements** — *signed paperwork and shipping documents for this order* | Always | *"No trade document has been generated yet."* |
| 4 | **Advance Receipt Refund Adjustment** — *the document filed with the refund raised on this order* | **Cancelled POs only** | *"No reference document was attached when the refund adjustment was raised."* |
| 5 | **All Payment Paid Proofs** — *money released to the supplier against this order* | Always | *"No payment has been released on this order yet."* |
| 6 | **All Recovery Payment Proofs** — *money recovered back through refunds and debit notes* | **Cancelled POs only** | *"Nothing has been recovered against this order yet."* |

Two behaviours follow from that table and are worth testing directly:

- **A section that cannot yet apply is hidden, not shown empty.** The two refund sections and the invoice section appear only when they can hold something — *"a section only appears once it can hold something."*
- **Only real files are listed.** There are no placeholder rows for documents that have not been produced; an applicable section with nothing in it prints its own sentence instead.

### Inside a section

| | |
|---|---|
| Rows visible | **Four**, then it scrolls — and the height is measured, so a wrapped file name never cuts the fourth row in half |
| Each row | Document name · a PDF / JPG chip · meta · View · Download |
| Tags | `signed` · `out` · `in` |
| A signed document | Appears as **two rows** — the original, and a `Signed_<name>` row |
| Not yet generated | View and Download are disabled rather than hidden |

### Where the payment rows come from

The payments and recoveries are read straight from the money tables, not from
the documents:

| Row | Source | Reference shown |
|---|---|---|
| A payment | `p2p_po_payments` | The payment request's code, falling back to the UTR / cheque number |
| A recovery | `p2p_po_refund_recoveries` | The adjustment's code, falling back to the reference number |
| The adjustment itself | `p2p_po_refund_adjustments` | Its own code, with the attachment filed when it was raised |

So a payment with no proof file uploaded still has a row in the money tables but
nothing to show here — the section lists files, not payments.

---

## 9. Money on the PO (read-only here)

| Shown | Meaning |
|---|---|
| Total PO amount | Σ lines + charges |
| TDS | Withheld at source, max **40%** |
| Net payable | Total − TDS |
| Total paid | Σ payments across all payment requests |
| Balance | Net payable − paid |

These are **stored** on the PO and rebuilt from the payment rows whenever
anything changes. The PO screen shows them; the Payment Request module changes
them.

---

## 10. Cancellation — the rule that matters most

| Situation | What happens |
|---|---|
| No money paid | Cancel directly with a reason. PO becomes `cancelled`, cancellation **closed** |
| **Money paid** | **Direct cancel is refused.** An Advance Receipt Refund Adjustment must be raised instead |

> *"Payments are recorded on this PO — raise the advance refund adjustment instead."*

A cancelled PO also releases any PI lines it was holding, so those lines become
available to another order.

When cancelled through a refund adjustment the PO sits at **Cancellation
Initiated** until the supplier's money is fully recovered, then moves to
**Cancellation Closed**.

### Delete is not Cancel

A third action exists, and it is the one most easily missed:

| | **Delete** | **Cancel** |
|---|---|---|
| Allowed on | **A draft only** | A submitted PO |
| Refusal | *"Only a draft PO can be deleted — cancel a submitted PO instead."* | *"This PO is already cancelled."* |
| The PO afterwards | Gone from every tab (soft-deleted) | Still listed, read-only, with its reason |
| A reason | Not asked for | **Required**, ≤ 1000 characters |
| PI quantity | Released, logged as `deleted` | Released, logged as cancelled |
| The supplier currency lock | **Forgotten** — the supplier is free to trade in another currency again | Kept |
| Money | Cannot exist on a draft | Blocks the cancel; use a refund adjustment |

That currency-lock row is the one with a side effect worth testing: deleting the
only draft that locked a supplier to a currency releases the lock, so the next PO
for that supplier may be raised in a different one.

---

## 11. Zoho Books

**Nothing creates a Zoho record implicitly**, with one exception worth knowing:
a **payment posts itself** to the bill as soon as it is recorded — but only if
the bill is already there. If the PO was never synced, the payment stays local
until somebody syncs. A failure on that automatic post is logged, not shown, so
the payment saves either way.

Everything else is pushed by the **Zoho Sync** action, which runs the chain:

1. Purchase Order → Zoho Purchase Order
2. → Zoho **Bill**
3. Payments → Vendor Payments applied to that bill
4. Refund adjustment → Vendor Credit
5. Recoveries → Vendor Credit Refunds

Re-running is safe; anything already carrying a Zoho id is skipped.

### The Zoho Tracker

Built from our own columns, not by asking Zoho. Three states per step —
**done** · **pending** · **failed** — where failed simply means an error was
recorded against that step.

| # | Step | Reads as done when | Reference shown |
|:-:|---|---|---|
| 1 | **Purchase Order Created** — *the PO itself, raised in Zoho Books* | `zoho_purchaseorder_id` is set | That id |
| 2 | **Bill Created** — *the purchase order converted to a bill* | `zoho_bill_id` is set | The bill number, falling back to the id |
| 3 | **PO Payment Completed** — *every payment released, posted against the bill* | **Every** payment is posted, not just one | — |
| 4 | **Vendor Credit Created** — *the amount the supplier owes back, as a credit note* | The adjustment has a vendor-credit id | Its number or id |
| 5 | **Refund Received** — *each recovery, refunded against the vendor credit* | **Every** recovery is refunded | — |

Steps 4 and 5 **appear only on a cancelled PO** that has a refund adjustment —
*"a cancelled PO carries two more steps: what is owed back, and what came back."*

#### The payments step breaks itself down

Step 3 is the one that is usually partly done, so it lists **every payment as
its own line** — *"so a part-posted step says which one is missing."* Each line
carries its own state, amount, Zoho id and error, and is labelled:

```
UTR <number>            if the payment has one
<bank name>             if it does not
Payment #<id>           if neither
```

The step's own note reads **"3 of 5 posted"**, or *"No payment released yet"*
when there are none. So a `pending` step 3 with four green lines and one red is
the normal shape of a partial failure — read the lines, not the step.

---

## 12. Statuses

| Field | Values |
|---|---|
| `status` | `draft` · `submitted` · `cancelled` |
| `cancel_stage` | `initiated` · `closed` |
| `gst_gate` | `clear` · `approval_required` · `blocked` |
| `gst_approval_status` | `pending` · `approved` · `rejected` |
| `inspection_status` | *(empty)* · `pending` · `completed` — see §8A. Only meaningful when the PO was raised with inspection required |
| `zoho_status` | synced / failed / not synced |

---

## 12A. Conditions by stage — the single reference

Every rule in the wizard, grouped by the stage it fires in. **F** = checked in
the browser for immediate feedback, **B** = enforced by the server. Where both
appear the browser is a mirror; if they ever disagree, the server wins.
**~** marks a rule where they are known to disagree today.

---

### STAGE 01 · Link Supplier Details

| Condition | F | B | Message |
|---|:-:|:-:|---|
| PO Type required | ✓ | ✓ | *PO Type is required.* |
| **Only Material / Goods may be raised** | ✓ | ✓ | *Only Material / Goods purchase orders can be raised for now.* |
| Document Type required | ✓ | ✓ | |
| Mode of Transport required | ✓ | ✓ | |
| Expected Delivery Date required | ✓ | ✓ | |
| **Delivery date not before today** | ✓ | | *Expected delivery date cannot be earlier than today.* |
| Delivery Location required | ✓ | ✓ | |
| Payment Type required, one of the three | ✓ | ✓ | *Select Advanced Payment, Full Payment or Letter of Credit.* |
| A supplier is chosen | ✓ | ✓ | *Select the supplier this PO is issued to.* |
| **Blacklisted supplier — hard block** (CS-403) | ✓ | ✓ | *This supplier is blacklisted.* |
| Supplier currency lock | ✓ | ✓ | The supplier may already trade in another currency |

**International only**

| Condition | F | B | Message |
|---|:-:|:-:|---|
| Currency required, **not INR** | ✓ | ✓ | *An international PO cannot be in INR.* |
| Exchange rate > 0 | ✓ | ✓ | *Exchange rate must be greater than 0.* |
| **Exchange rate ≤ 10,000** | ✓ | ✓ | *Exchange rate looks wrong — the highest allowed is 10,000. Check for a misplaced decimal.* |
| INCO Term required | ✓ | ✓ | |
| Port of Loading / Discharge required, ≤ 255 chars | ✓ | ✓ | *…may not exceed 255 characters.* |
| Final Destination required | ✓ | ✓ | |
| Country of Origin required | ✓ | ✓ | |

---

### STAGE 02 · Product Details

**Rule 0** — a line at `qty = 0` carries **no errors at all**; it is simply not
on this PO. Exception: a standalone line with a product but no quantity gets
*"Enter a quantity, or remove the line."*

**Across the table** — at least one line must be ordered:
*"Enter a quantity on at least one line."*

| # | Condition | F | B | Message | Cell |
|:-:|---|:-:|:-:|---|---|
| 1 | Product chosen | ✓ | ✓ | with PI: *Pick the product for this PI line.* · standalone: *Pick a product, or remove the line.* | Product |
| 2 | **PI line not already exhausted** | ✓ | ✓ | *This PI line is fully ordered — nothing is left to order against it.* | Qty |
| 3 | Rate > 0 | ✓ | ✓ | *Enter a rate.* | Rate |
| 4 | Rate ≤ **₹100 cr** (÷ fx) | ~ | ✓ | *Rate looks wrong — the most this PO takes for one unit is `<CCY> X`.* The browser still allows 10× this | Rate |
| 5 | Quantity ≤ 10,000,000 | ✓ | ✓ | *Quantity looks wrong — the most on one line is 10,000,000.* | Qty |
| 6 | Line value ≤ **₹100 cr** (÷ fx) | ~ | ✓ | *This line comes to X — the whole PO cannot exceed Y.* The browser still allows 1,000× this | Rate |
| 7 | **Product has a GST %** (domestic only) | ✓ | ✓ | *No GST % on the product master…* | Product |
| 8 | Product is `active` | ✓ | ✓ | *This product is `<status>` in the product master — activate it there to order it.* | Product |
| 9 | Segment is one of the supplier's | ✓ | ✓ | *Segment mismatch — `<Seg>` is not mapped to this supplier. Add `<Seg>` to the supplier's segments.* | Product |
| 9a | Product has a segment at all | ✓ | ✓ | *Segment mismatch — this product has no segment set in the product master.* | Product |
| 10 | **PI segment match** (with shipment) | ✓ | | *The PI line is in `<Seg>` — pick a product from the same segment.* | Product |

**Only the first of 8 / 9 / 10 shows** — one message per cell.
**Rule 9 escape:** a product mapped *directly* to this supplier passes regardless of segment.
**Rule 7 skipped** on an international PO.

**Not refused, only flagged:** under-ordering (**Missing Qty**) and
over-ordering (**Extra Qty**) against a PI line are both allowed.

---

### STAGE 03 · Terms & Conditions

| Condition | F | B | Message |
|---|:-:|:-:|---|
| Terms ≤ 20,000 characters | ✓ | ✓ | |
| `submit` is `'yes'` / `'no'` | | ✓ | An enum, not a boolean |

**On submit — the six gates, server only.** Four re-read live data, which is why
the browser cannot pre-empt them.

| # | Gate | Refusal |
|:-:|---|---|
| 1 | A supplier is selected | *Select a supplier before submitting.* |
| 2 | At least one product line | *Add at least one product line before submitting.* |
| 3 | **Every line still belongs to this supplier** | *`PRD-001` — neither the product nor its segment is mapped to this supplier.* |
| 4 | **GST gate — `blocked`** | *GST scrutiny is older than 3 months…* |
| 4 | — `approval_required`, none raised | *The supplier's last GST return is overdue — send it for senior approval before submitting.* |
| 4 | — `approval_required`, pending | *Senior approval is still pending — the PO can be submitted once it is approved.* |
| 4 | — `approval_required`, rejected | *The senior rejected this PO: `<reason>`* |
| 5 | **Supplier KYC / DD / trade licences in date** | Names each expired document (CS-407) |
| 6 | **Case to Case** — earlier POs' necessary documents signed | Lists what is outstanding |

**On success:** `status = submitted` · Stage 04 rows materialised · the PO PDF
is **queued** (`GeneratePoDocumentPdf`), so Step 04 polls for it.

---

### STAGE 04 · Post-PO Trade Document Management

| Action | Condition | Message |
|---|---|---|
| **Anything** | PO not cancelled | *This PO is cancelled.* |
| Reach the stage at all | PO submitted | *Submit the PO first* |
| Mark **not** necessary | The document is not mandatory | *`<name>` always goes with the order and cannot be marked not necessary.* |
| Mark **not** necessary | Not already sent for signature | *`<name>` has already been sent for signature — it stays Necessary.* |
| Upload / replace a file | The document is not already signed | *A signed document cannot be replaced.* |
| Send for signature | Not already signed | *This document is already signed.* |
| Send for signature | A file is attached | *Attach the document file before sending it.* |
| Bulk send | Every selected document has a file | *Attach a file first: `<names>`* |
| Bulk action | All ids belong to this PO | *Some documents were not found on this PO.* |
| Generate | Only the PO document is generated | *Only the Purchase Order document is generated.* |
| Download | The file exists on disk | `404` |

Two rules worth noting together: **a mandatory document can never be marked
unnecessary**, and **anything already sent for signature locks into Necessary**.
Both exist so Case to Case cannot be dodged after the fact.

---

### STAGE 05 · Payment Management

| Condition | Applies to | Message |
|---|---|---|
| PO not cancelled | **everything** | *This PO is cancelled — no payment requests or payments can be made.* |
| PO submitted | **everything** | *Submit the PO before managing its payments.* |
| **Documents sent for signature** | **everything** | *Send this PO for signature first — payments are managed only once the documents are out.* |
| Not an international PO | Save TDS | *TDS does not apply to an international PO.* |
| TDS ≤ 40% | Save TDS | *TDS cannot be more than 40%.* |
| TDS ≤ the PO base | Save TDS | *TDS cannot be more than the PO base amount of X.* |
| **TDS saved** (domestic) | Raise a request · record a payment | *Deduct the TDS on this PO first — save it (even as 0)…* |
| Approver active, not a client admin, in this branch | Raise a request | *A request stops at the branch head — choose someone from this branch.* |
| **You are the addressee** | Decide | *Only the person this request was sent to can decide it.* |
| Not already decided | Decide | *This request is already approved / rejected.* |
| ≤ requested amount | Approve | *You can approve at most the requested X.* |
| ≤ PO headroom | Approve | *Only X is still open to approve on this PO.* |
| Request is `approved` | Record a payment | *This request is still awaiting approval* / *was declined — nothing can be paid against it.* |
| ≤ what is still approved | Record a payment | *Only X is still approved on this request.* |
| ≤ the PO balance | Record a payment | *Amount exceeds the PO balance of X.* |
| UTR unique across the company | Record a payment | *UTR / cheque number X is already recorded on `<PO>` · `<PRQ>`…* |
| UTR date not in the future | Record a payment | *UTR / cheque date cannot be in the future.* |
| **Not already in Zoho** | Edit / delete a payment | *This payment is already posted to Zoho Books — it can no longer be changed or deleted.* |

Both payment ceilings are computed **inside a `lockForUpdate()` on the PO**, so
two people paying at once cannot both pass the balance check.

---

### PHYSICAL INSPECTION · after submit, outside the five steps

Server-only — there is no browser mirror of these.

| Condition | Applies to | Message |
|---|---|---|
| The PO requires inspection | **everything** | *This PO does not require physical inspection.* |
| The PO is **submitted** | **everything** | *Only a submitted PO can be inspected.* |
| Not signed off | Save a line · remove a file | *Inspection is signed off — withdraw the sign-off to change a line.* |
| A verdict **or** a file | Save a line | `required_without` — one of the two must be present |
| Verdict is one of the three | Save a line | `correct` · `damaged` · `mismatched` |
| Remark ≤ 1000 | Save a line | |
| ≤ 10 files per line, counted on the total | Save a line | *This product already has 10 proof files — remove one to add another.* / *Only `<N>` more proof file(s) can be added to this product (up to 10 in total).* |
| ≤ 20 MB, image / video / PDF | Save a line · sign off | |
| The file index still exists | Remove a file | *That file is no longer on this line.* (404) |
| **Every line has a verdict** | Sign off | *`<N>` line(s) have no verdict yet — mark every line before signing off.* |
| Note ≤ 1000, ≤ 10 note files | Sign off | |
| There is a sign-off | Withdraw | *There is no sign-off to withdraw.* |

Three things are **not** checked, and each is worth a test:

| Not checked | Consequence |
|---|---|
| Documents sent for signature | Inspection opens on submit, well before Step 05 |
| The PO is not cancelled | Only the two gates above are tested |
| A remark or proof on a `damaged` / `mismatched` line | A bad verdict signs off with no evidence attached |

---

### DELETE · drafts only

| Condition | Message |
|---|---|
| `status = draft` | *Only a draft PO can be deleted — cancel a submitted PO instead.* |

---

### CANCELLATION · at any stage

| Condition | Message |
|---|---|
| Not already cancelled | *This PO is already cancelled.* |
| **No money paid** | *Payments are recorded on this PO — raise the advance refund adjustment instead.* |
| A reason is given (≤ 1000) | required |

---

## 12B. Conditions, tab by tab — the list view

The frontend conditions are for immediate feedback; the backend conditions are
the authority and are checked again on every call. Where both appear, the
frontend is a mirror — if they ever disagree, the backend wins.

### TAB · All PO's — creating one

| Step | Frontend (`create-po/validation.ts`) | Backend (`PurchaseOrderController`) |
|---|---|---|
| 01 | PO Type, Document Type, Mode of Transport, Expected Delivery Date, Delivery Location, Payment Type all required | `stage1Rules()` re-validates every one |
| 01 | **Only `Material / Goods`** can be raised — *"Only Material / Goods purchase orders can be raised for now."* | `OPEN_PO_TYPES = ['material_goods']` |
| 01 | Payment type must be Advanced Payment, Full Payment or Letter of Credit | enum |
| 01 | Delivery date **cannot be earlier than today** | — |
| 01 | A supplier must be chosen | `vendor_id` required |
| 01 | **Blacklisted supplier is a hard block** — *"This supplier is blacklisted"* (CS-403) | Supplier category check |
| 01 · international only | Currency required, **cannot be INR** | enum + derivation |
| 01 · international only | Exchange rate > 0 and **≤ 10,000** — *"Check for a misplaced decimal"* | `FxRate::MAX` |
| 01 · international only | INCO term, port of loading, port of discharge (≤ 255 chars each), final destination, country of origin all required | same |
| 02 | Quantity ≤ 10,000,000 · unit rate ≤ ₹1,000 cr · whole PO ≤ ₹1 lakh cr | **Tighter: both money ceilings are ₹100 cr.** The browser was not updated with the server — see §3B |
| 02 | **Product segment must match the supplier's** | Re-checked at submit (gate 3) |
| 02 | Inactive products are **listed but locked** | Server refuses the line |
| 02 | Product with **no GST % set** is refused | *the server refuses the line* |
| 02 · with shipment | Product segment must match the **PI line's** segment | — |
| 03 | Terms ≤ 20,000 characters | `max:20000` |
| 03 · submit | — | **The six gates** — see §12A · Stage 03 |

The three rupee ceilings exist for a specific reason: *"An order of magnitude
typed into the rate used to pass every check here and fail hours later inside
Zoho Books… A PO of 1,987 cars at 13,000,000,000 each reached
25,831,000,000,000 that way."* They catch a slipped decimal, not a big deal.

### TAB · With Shipment ID PO's

| Frontend | Backend |
|---|---|
| Shipment dropdown from `shipment_orders` | — |
| PI lines shown with ordered / available quantity | `orderedByPiItem()` — **quantity ledger**, counts submitted POs and drafts with a GST approval in flight |
| Cannot order more than remains | Re-checked inside the write transaction |
| PI segment must match the product's | — |

### TAB · All Other PO's (standalone)

| Frontend | Backend |
|---|---|
| Products typed freely from the product master | Same line rules, no reservation |
| No quantity ceiling from a PI | Only the rupee ceilings apply |

### TAB · PO Cancellation Initiated

| Frontend | Backend |
|---|---|
| Cancel button hidden / disabled once cancelled | `isCancelled()` → refuse |
| Payment actions hidden | `payable()` → *"This PO is cancelled — no payment requests or payments can be made."* |
| Recoveries opened from the Refund module | `PoRefundAdjustmentController` |

### TAB · PO Cancellation Closed

Read-only on both sides. Nothing on a cancelled PO is editable.

---

## 12C. Every flow, end to end

### Flow 1 · Raising a PO with a shipment

```
Sales raises an Opportunity → Shipment Order → Proforma Invoice
                                                     │
Step 01  pick the supplier + the shipment            │
         (PI number, PI lines come with it) ◄────────┘
Step 02  for each PI line, say how much THIS PO takes
         · PI quantity shown · Missing / Extra flagged
Step 03  terms → Submit → six gates
Step 04  documents → send for signature
Step 05  TDS → request → approval → payment
```

### Flow 2 · Raising a PO without a Shipment ID (standalone)

The **+ Create PO** button always opens the link chooser first. That choice is
the fork — it is made before any field is filled, and it decides what Step 02
looks like for the rest of the order's life.

```
+ Create PO
      │
   "Choose how to link this PO to your procurement workflow."
      │
 ┌────┴─────────────────────────────┬──────────────────────────────────────┐
 │  With Shipment ID   RECOMMENDED  │  All Other PO's      STANDALONE      │
 │  "3-way match & complete         │  "(Without Shipment ID)"             │
 │   audit trail."                  │  "Create a PO not linked to any      │
 │                                  │   shipment."                         │
 │  ⚠ needs a shipment that HAS a   │                                      │
 │    PI — otherwise the dropdown   │  ⚠ amber warning:                    │
 │    reads "No shipment with a     │    "Standalone purchase order —      │
 │    PI yet"                       │     won't be linked to any           │
 │                                  │     shipment. Proceed directly to    │
 │  Confirm is DISABLED until a     │     the PO form."                    │
 │  shipment is picked              │                                      │
 │                                  │  Confirm & Continue is enabled at    │
 │                                  │  once — nothing else to choose       │
 └──────────────────────────────────┴──────────────┬───────────────────────┘
                                                   │
                                        link_type = 'standalone'
                                                   │
Step 01  everything in §3B, and NO shipment field at all
         · supplier, PO type, dates, delivery, payment type
         · international block if Document Type = International
         · the same three compliance panels: GST · legal · risk
                                                   │
Step 02  THE EMPTY TABLE  —  this is the whole difference
         · the table opens with no rows
         · "+ Add Product Line" is present   ◄── only on a standalone PO
         · pick any product from the product master, type qty and rate
         · Missing Qty / Extra Qty columns are HIDDEN
         · the "part of this PI is already on other POs" banner is HIDDEN
         · the "Missing Product Details" section never appears
         · nothing is reserved anywhere
                                                   │
Step 03  terms and charges → Submit → the SAME six gates, unchanged
                                                   │
Step 04  documents → send for signature   ← identical
Step 05  TDS → request → approval → payment ← identical
```

**From Step 03 onward a standalone PO is indistinguishable from a shipment
one.** Submit runs the same six gates, Stage 04 is assembled the same way from
the products' segments, and the money rules are the same. The fork closes at the
end of Step 02.

#### The five things that are absent, and what each means

| On a shipment PO | On a standalone PO | Consequence |
|---|---|---|
| Lines arrive from the PI | **The table opens empty** | You choose what to order |
| No way to add a line | **+ Add Product Line** | The only screen where a line can be created by hand |
| Missing Qty · Extra Qty | Hidden | There is no PI figure to compare against |
| *"Part of this PI is already on other POs"* | Hidden | No shared quantity to warn about |
| Missing Product Details panel | Never appears | It only renders when a saved line carries a PI |

And the PI NUMBER pill is dropped from the Step 02 header strip, leaving
**Supplier Code · Supplier Name · State Code**.

The on-screen legend changes with it:

| | |
|---|---|
| With shipment | *"Tinted cells are editable — PO product, quantity and rate. Everything else is carried from the PI or calculated."* |
| Standalone | *"Tinted cells are editable — product, quantity and rate. Everything else is calculated."* |

#### What is NOT different

| | |
|---|---|
| Line rules 1 and 3–9a | **All apply, identically** |
| The rupee ceilings | Apply — but see the front/back drift in §3B |
| Segment must be the supplier's | Applies. The usual failure on a standalone PO, because the product is free-chosen rather than arriving pre-matched from a PI |
| GST % must be set (domestic) | Applies |
| Inactive products | Refused |
| At least one ordered line | *"Enter a quantity on at least one line."* |
| Rules 2 and 10 | **Cannot fire** — both are about a PI line |
| A zero-quantity line | **Is an error here**, not silently skipped: *"Enter a quantity, or remove the line."* |

That last row is the one reversal. On a PI line, `qty = 0` means "not taking any
of this one" and is fine. On a standalone line there is no PI to decline — a row
with a product and no quantity is simply unfinished, so it is refused.

#### Fixing a segment mismatch without leaving the step

Because the product is free-chosen, *"Segment mismatch — `<Segment>` is not
mapped to this supplier"* is the error a standalone PO hits most. The Step 02
header strip carries an edit control beside the supplier name for exactly this:

> *"Edit this supplier — map a product to it without leaving this step"*

Mapping the product directly to the supplier satisfies rule 9's escape, so the
line passes without the segment having to match. On return the supplier, the
product list and the PO's supplier panel all reload, and a toast confirms it.

#### Where a standalone PO ends up

It lands in **All Other PO's (Without Shipment ID)**, and that tab is defined as
everything that is *not* a shipment PO:

```sql
COALESCE(link_type, 'standalone') <> 'with_shipment'
```

The `COALESCE` matters: a PO with **no** `link_type` stored at all also appears
here. The tab is a catch-all, not a `link_type = 'standalone'` filter — so this
is where an older or part-migrated row surfaces.

Its Shipment ID, Opportunity ID and PI columns stay blank, and
**Procurement ID is blank too** — see below.

#### When to raise one — the app says so itself

A standalone PO is not only for unlinked buying. The shipment flow points at it
by name. When a PI has nothing left to order, Step 02 says:

> **Nothing left to order on this PI.** Its products are on: `PO/2026-27/007`
> *submitted*, `PO/2026-27/011` *awaiting senior approval*. That quantity is
> released back to this PI only if the senior rejects that PO or it is
> cancelled. **Raise a standalone PO for anything extra.**

And a shipment PO has no **+ Add Product Line** button — by design:

> *"A shipment PO orders only its PI lines; extra products go on a standalone PO."*

So the two flows are complements, not alternatives: **the PI defines what was
promised, and a standalone PO carries anything beyond it.**

#### The procurement request link — API only

The API accepts `link_procurement` / `procurement_request_id` and the list has a
**Procurement ID** column, which reads as though a standalone PO can be raised
against a procurement request. It cannot, on two counts:

| | |
|---|---|
| The validation rule | `link_procurement` is `prohibited_if:link_type,standalone` — a procurement request can only be attached to a **shipment** PO |
| The screen | `po-draft.ts` sends `link_procurement: 'no'` on a shipment PO and `null` on a standalone one. **No screen ever sends `'yes'`**, and there is no procurement-request picker anywhere in the wizard |

**So the Procurement ID column is blank on every PO raised through the UI**, and
`procurement_request_code` — though searchable, and shown as a header pill when
present — can at present only be set by an API client. Worth confirming with the
product owner rather than testing as a UI feature.

> Verified against `stage1Rules()` and `po-draft.ts` on 6 Oct 2026. If a
> procurement picker is added later it belongs on the *shipment* branch, not
> this one.

### Flow 3 · The GST gate and senior approval

```
Supplier chosen on Step 01
        │
   GST Status panel reads vendor_gst_scrutiny, 3-month cutoff
        │
 ┌──────┴──────┬──────────────────────┬─────────────────────┐
 │  clear      │  approval_required   │  blocked            │
 │             │  (return overdue)    │  (scrutiny stale /  │
 │             │                      │   never done)       │
 ▼             ▼                      ▼
proceed    send to a senior      NOBODY can approve
           with a note           → re-run the scrutiny first
                │
         senior's Inbox
                │
     ┌──────────┴──────────┐
  APPROVED              REJECTED  (reason required either way)
     │                       │
  may submit          cannot submit:
                      "The senior rejected this PO: <reason>"
                              │
                      re-request → goes back to the SAME senior
                      (no shopping for a softer approver)
```

### Flow 4 · The document blocker

```
Submit
   │
   ├─ which documents do THIS supplier's segment rules require?
   │     (Domestic or International side, by their address)
   ├─ are any of those expired?
   │
   ├─ no  → continue
   └─ yes → refused, each expired document named
              │
              ▼
         renew it in the Supplier Evidence Vault
              │
              ▼
         submit again — read live, so the renewal counts at once
```

Only documents the supplier's own rules ask for are checked. Anything else they
happen to have uploaded is ignored — otherwise the block would point at a
document the Evidence Vault never lists, leaving nothing to renew.

### Flow 5 · Case to Case

```
Submit
   │
   ├─ this supplier's OTHER POs
   ├─ their Stage 04 documents marked Necessary
   ├─ any unsigned?
   │
   ├─ no  → submit proceeds
   └─ yes → refused, listing them
              → go and get the earlier PO signed
```

### Flow 6 · Payment release

```
PO submitted  AND  documents sent for signature          ← both required
        │
   Deduct TDS (domestic only, even if 0)
        │
   Raise Payment Request  →  PRQ-001, addressed to one named person
        │
   That person decides   approve (≤ requested, ≤ PO headroom)
        │                decline (reason)
        │
   Add Payment  →  amount · bank · UTR · date · proof
        │           (several payments may sit under one request)
        │
   PO's Paid and Balance rebuild from the payment rows
        │
   Zoho: a payment attaches itself to the bill IF the bill already exists
```

### Flow 7 · Cancelling

```
                     Cancel pressed
                           │
            ┌──────────────┴──────────────┐
      nothing paid                   money paid
            │                             │
    cancel with a reason          REFUSED — raise an
    PI lines released             Advance Receipt Refund
    Cancellation CLOSED           Adjustment instead
                                          │
                              ADR raised, in one step:
                                · PO cancelled
                                · pending requests declined
                                · PI lines released
                                · Cancellation INITIATED
                                          │
                              log each supplier repayment
                                          │
                              balance reaches zero
                                          │
                              Cancellation CLOSED
```

### Flow 8 · Physical inspection

```
Step 01   Physical Inspection Required = YES     ← decided here, and only here
              │
Step 03   Submit                                 ← the inspection opens NOW
              │                                    (NOT after signature —
              │                                     that gate is Step 05 only)
              ▼
     Physical Inspection screen
              │
    for each PO line:  verdict  +  remark  +  proof
              │        correct / damaged / mismatched
              │        up to 10 files, 20 MB each, photo · video · PDF
              │        (phone camera capture built in)
              │
              │   each line SAVES AS IT IS MADE
              │   → the screen can be closed and resumed
              │
        header counter:  "7 of 12 marked"
              │
              ▼
          Sign off ──┬── any line without a verdict?
                     │        └─ REFUSED, counted:
                     │           "3 line(s) have no verdict yet"
                     │
                     └── all marked → inspection_status = COMPLETED
                              + optional note and note files
                              + who signed off, and when
                                      │
                                 lines LOCK
                                 "withdraw the sign-off to change a line"
                                      │
                                   Withdraw
                                      │
                         status back to PENDING, who/when cleared
                         ⚠ the NOTE and note files are NOT cleared
```

Inspection sits outside the five steps and outside the money flow: nothing in
it blocks a payment, and no payment blocks it. It is a record of what arrived,
not a gate.

### Flow 9 · Zoho Books

```
PO ──Zoho Sync──► Purchase Order ──► Bill
                                      │
            payments attach to the bill (automatically, if the bill exists;
            otherwise they wait for a sync)
                                      │
            proof files attach to the BILL, not the payment
                                      │
ADR ─────────────────────────────────► Vendor Credit
recoveries ──────────────────────────► Vendor Credit Refunds
```

Re-running is safe — anything already carrying a Zoho id is skipped.

---

## 13. Business rules QA should never see broken

1. A PO with `paid_amount > 0` **cannot** be cancelled from the PO screen.
2. PO codes are **sequential per client**, never reused, allocated under a lock.
3. Line amounts are **always** computed server-side — a client-sent total is ignored.
4. Every quantity change is logged with its previous value, who and when.
5. Submitting creates Stage 04 rows; re-reading Stage 04 never destroys existing files or signatures.
6. A PI line that is **fully ordered** cannot be ordered against again. Partial ordering across several POs is allowed and expected.
7. Cancelling — by either route — returns the PO's quantity to the PI.
8. **Nothing creates a Zoho record implicitly.** A payment is the one exception to "nothing happens on save": it posts itself to the bill *if the bill already exists*, and a failure is logged rather than surfaced. Everything else — the PO, the bill, vendor credits, refunds — is pushed only by an explicit Zoho Sync.
9. A super admin cannot create a PO — there is no tenant to create it under.
10. TDS cannot exceed **40%**, however it is entered.
11. **Money cannot be managed until the documents have gone out for signature** — submitted is not enough.
12. A mandatory document can never be marked unnecessary, and anything already sent for signature stays Necessary.
13. Only **Material / Goods** purchase orders can be raised at present.
14. A **blacklisted supplier** is refused on Step 01, before anything else is checked.
15. Once **any payment is recorded**, the product lines and charges can no longer change — *"Payments are already recorded on this PO — its product lines and charges can no longer change."*
16. A PO's **shipment cannot be changed while it has lines**, and its **supplier and document type cannot change once a senior has been asked** — a pending request fixes them, not just an approved one.
17. A **standalone PO cannot carry a procurement request** — the link is prohibited on `link_type = standalone`.
18. On a standalone PO the line table **opens empty and *+ Add Product Line* exists**; on a shipment PO there is **no way to add a line** — extra products belong on a standalone PO.
19. **Physical inspection opens on submit**, not on signature — it is not gated behind the documents going out.
20. An inspection **cannot be signed off with any line unmarked**, and once signed off **no line can change** until the sign-off is withdrawn.
21. Inspection proof is **added, never replaced**, and a line holds **at most 10 files** — the cap is checked before anything reaches storage.
22. **Delete is drafts only**; a submitted PO is cancelled. Deleting a draft releases its PI quantity *and* its supplier currency lock.
23. The **PO Evidence Vault and the Supplier Evidence Vault are different screens** — a submit blocked for an expired document is fixed in the *supplier's*.
24. A section of the PO Evidence Vault that cannot yet apply is **hidden, not shown empty**; one that applies with nothing in it prints its own sentence.
25. The **Zoho Tracker is built from our own columns**, never by querying Zoho — and its payments step is only `done` when **every** payment is posted.
26. The **API carries no permission check** — only a tenant check. Hiding the menu item does not stop the endpoints answering (§14).

---

## 14. Roles and access

> **Corrected.** An earlier version of this section said *"Users with the PO
> permission"* for Cancel and Zoho Sync. **There is no such check.** The
> endpoints in this module carry no per-action permission test at all. What
> follows was read off the controllers and the sidebar.

### What actually guards the API

One check, in every method:

| Guard | Failure |
|---|---|
| The caller has a `client_id` | `403` — *"No tenant context"* |

That is the whole of it. There is **no** role test, no module-permission test
and no branch-role test on raising, editing, submitting, cancelling, deleting,
inspecting or syncing a PO. Any authenticated user belonging to a client can
call any of these endpoints for that client's data.

### What actually guards the menu

The menu leaf `p2p.order` falls through to the general rule in
`Sidebar.canView` — `perms[id]?.can_view` — so **the menu is permission-gated
per leaf**, and a missing or expired plan hides it. Sales and CLM have temporary
"show it to everyone" bypasses during rollout; **P2P does not**, so the
permission row is genuinely what decides visibility.

Super admins see every leaf, but cannot use this one: they have no `client_id`,
so every call returns the 403 above (QA rule 9).

### The practical consequence

| | |
|---|---|
| Hiding the menu item | Stops the user finding the screen |
| Hiding the menu item | Does **not** stop the endpoints answering |

So "can this user raise a PO?" has two different answers depending on whether
you ask the UI or the API. Worth raising as a finding rather than testing as
intended behaviour.

### The only real actor restrictions in the module

Two decisions do check *who you are* — and both live outside the PO screen:

| Decision | Rule | Message |
|---|---|---|
| A **GST approval** | Only the senior it was addressed to may decide it | *"Only the person this request was sent to can decide it."* |
| A **payment request** | Only the addressee, who must be an active non-client-admin in the branch | *"A request stops at the branch head — choose someone from this branch."* |

### Tenant isolation

Isolation is the `BelongsToTenant` global scope, not a controller filter:

```
rows with NULL client_id          (shared / global rows)
  OR  client_id = the context client
        AND ( NULL branch_id  OR  branch_id = the context branch )
```

The branch half applies only when a branch is in context — which, for GETs, the
Axios interceptor supplies from the branch switcher. On create, `client_id` and
`branch_id` are filled from the context unless the controller set them
explicitly, so **a `client_id` in a request body is never trusted**.

One deliberate lift: GST approvals read across branches
(`PurchaseOrder::withoutGlobalScope('tenant')` narrowed to the client's PO ids),
because an approval is addressed to a senior who may sit in another branch.

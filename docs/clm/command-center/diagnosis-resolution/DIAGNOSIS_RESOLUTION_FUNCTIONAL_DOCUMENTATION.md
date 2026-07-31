# DIAGNOSIS & RESOLUTION CENTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Diagnosis & Resolution Center**
> Route `/clm/diagnosis-resolution` · Endpoints `GET /api/clm/diagnosis-resolution` · `POST /api/clm/diagnosis-resolution/escalate`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Diagnosis & Resolution Center** is CLM's triage desk. Where the profile screens report *what is complete*, this screen surfaces *what is blocked* — and gives the user a way to escalate it to whoever can unblock it.

It combines three views that would otherwise require three separate screens into **one payload**:

| Sub-tab | Source | What it diagnoses |
|---|---|---|
| **Buyer** | Customer Profile aggregation | Customers and consignees with incomplete document sets |
| **Supplier** | Supplier Profile aggregation | Vendors with incomplete document sets |
| **Case-to-Case** | CTC contracts | Contracts stuck in review, rejected, or awaiting clarification |

### 1.2 Business value
| Benefit | Description |
|---|---|
| One round-trip | Three diagnosis views load from a single API call |
| No duplicated logic | The heavy aggregation is reused verbatim from the two profile controllers |
| Tenant isolation inherited | Because it calls those controllers directly, scoping cannot drift |
| Escalation in place | Raise a blocked item to a named target without leaving the screen |
| CTC visibility | Contracts awaiting clarification get their own bucket, unlike elsewhere in CLM |

### 1.3 Key features
- Three diagnosis sub-tabs from one payload.
- Buyer and supplier compliance gaps at party and transaction level.
- Case-to-Case contract status with the **primary counterparty** and its role badge.
- **Escalation form** — reference, target, issue type, priority, message, notify-via channels.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All data, all tenants |
| Client Admin / Client User | The client's data; Branch Switcher narrows |
| Branch User | Own branch |
| Employee | The branch's book |

Menu slug: `clm.diagnosis_resolution`. Everything except the escalation form is **read-only**.

---

## 3. BUSINESS PROCESS FLOW

```
   GET /clm/diagnosis-resolution
        │
        ├── buyer     ← ClmBuyerProfileController::index()      (called in-process)
        │                buyers · consignees · ws_eq · ws_neq · wos_eq · wos_neq
        │
        ├── supplier  ← ClmSupplierProfileController::index()   (called in-process)
        │                ws_mat · ws_logi · wos_svc · wos_mat · wos_logi
        │                + the five transaction-wise collections
        │
        └── ctc       ← CtcContract rows for this tenant
                         code · title · primary counterparty + role · list status
        │
        ▼
   USER SPOTS A BLOCKED ITEM
        │
        ▼
   POST /clm/diagnosis-resolution/escalate
        { reference, escalate_to, issue_type, priority, message, notify_via[] }
        │
        ▼
   Logged as an audit line + a success acknowledgement returned
```

### 3.1 The CTC status buckets — one bucket more than elsewhere
This screen maps a contract's lifecycle to **four** buckets, not the usual three:

| Condition | Bucket |
|---|---|
| `approval_status = rejected` | `rejected` |
| **`approval_status = clarification`** | **`clarify`** |
| `stage >= 4` or `status = signed` | `signed` |
| otherwise | `inprogress` |

Everywhere else in CLM, a clarification is folded into `inprogress` (the Case-to-Case list) or `pending` (the sender's view). Here it gets its own bucket — because "waiting on a question" is precisely the kind of thing a triage screen must surface.

### 3.2 The counterparty role badge
Each CTC row shows the **first** counterparty's name plus a normalised role:

| Stored badge / source_type contains | Displayed role |
|---|---|
| `buy…` or exactly `customer` | **Buyer** |
| `supp…` or exactly `vendor` | **Supplier** |
| anything else | **Partner** |

Note this is a *simpler* mapping than the Case-to-Case screen's, which distinguishes Customer / Consignee / Supplier.

---

## 4. SCREEN SPECIFICATION (`ClmDiagnosisResolutionPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Sub-tabs | **Buyer** · **Supplier** · **Case to Case** |
| Buyer / Supplier tabs | The same rows the profile screens show, with the five `{d, t}` progress ratios |
| CTC tab | CTC CODE · TITLE · COUNTERPARTY · ROLE · STATUS |
| Escalate action | Opens the escalation form on the selected row |
| Escalation form | Reference · Escalate To · Issue Type · Priority (critical/high/medium/low) · Message · Notify Via (multi-select) |
| Read-only elsewhere | No create / edit / delete on the diagnosis data itself |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The endpoint returns three blocks — `buyer`, `supplier`, `ctc` — in one payload |
| 2 | The buyer and supplier blocks are produced by calling the two profile controllers **in-process**, so scoping and maths cannot drift |
| 3 | CTC rows are listed newest first, tenant-scoped |
| 4 | A CTC row's status uses the **four-bucket** mapping including `clarify` |
| 5 | The counterparty shown is the **first** entry in the contract's counterparty list |
| 6 | The role badge normalises to Buyer · Supplier · Partner |
| 7 | Escalation requires reference, target, issue type, priority and message |
| 8 | Priority must be one of `critical` · `high` · `medium` · `low` |
| 9 | **Escalation persists only an audit log line** — there is no escalation store yet |

---

## 6. STATUS MODEL

Nothing is stored by this module. It reads:
- **Buyer / Supplier** — derived `{d, t}` ratios across the five document families.
- **CTC** — the four-bucket list status derived from `approval_status`, `stage` and `status`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| **Escalation is not persisted** | `escalate()` writes an audit log line and returns a success acknowledgement; there is no escalations table, no notification, no inbox entry |
| Message says "notified" | The response reads *"Escalation recorded and the target has been notified"* even though `notify_via` channels are only logged |
| No filters | The endpoint takes no query parameters; the whole tenant is aggregated on every load |
| Heaviest read in CLM | Both profile aggregations run on every request |
| First counterparty only | A contract with several counterparties shows only the first |
| Simplified role badge | Consignees are labelled **Partner**, not Consignee, on this screen |
| No blocked-item ranking | Rows are not sorted or filtered by severity of the gap |

---

*Related documents: DIAGNOSIS_RESOLUTION_TECHNICAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_CODE_WALKTHROUGH.md · DIAGNOSIS_RESOLUTION_API_DOCUMENTATION.md*

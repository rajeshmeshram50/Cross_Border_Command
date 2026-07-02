# LEAD ACKNOWLEDGEMENT MASTER — COMBINED DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Core Masters → Lead Acknowledgement Master
> **Single-file KT** — Functional · Technical · API · Code-Walkthrough in one document.
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-02 | System | Initial combined documentation |

**Scope:** the master that defines the reusable **acknowledgement reasons** consumed by **Stage 2 (Lead Acknowledgement)** of the opportunity pipeline. This is a *list-level master* — it lives outside the stages; the stages only *consume* the reasons it defines. See `../My WorkPlace/lead-worksheet/` (worksheet) and `../My WorkPlace/matrix-stages/` (the 6 stages).

---

# PART A — FUNCTIONAL

## A1. What the master is
The **Lead Acknowledgement Master** is where a tenant curates the **standardized reasons** a salesperson can pick when acknowledging a lead in **Stage 2**. Reasons are organized into **three buckets**:

| Bucket (`opportunity_type`) | Tab label | Meaning |
|---|---|---|
| `qualified` | **Qualified Opportunity** | Reasons the lead is a good fit and moves forward |
| `disqualified` | **Disqualified Opportunity** | Reasons the lead is dropped |
| `clarity_pending` | **Clarity Pending Opportunity** | Reasons more info is needed before deciding |

For **disqualified** reasons only, a second field **DQ Status** captures intent:
- **Positive** — a soft no; re-engagement is still possible (e.g. *"Budget available next quarter"*).
- **Negative** — a hard no (e.g. *"Wrong industry"*).

In Stage 2, when a salesperson opens a bucket's reason picker, it lists the **active** reasons from this master; the disqualified picker splits them into **Negative / Positive** columns using `dq_status`.

## A2. Business value
| Benefit | Description |
|---|---|
| Consistent qualification | Everyone picks from the same vetted reason set — no free-text drift |
| Analytics-ready | Standard reasons make win/loss reporting meaningful |
| Re-engagement signal | `dq_status` (positive/negative) marks which lost leads are worth chasing later |
| Tenant-owned | Each client curates its own list; branches share it (org-level master) |
| Safe retirement | Reasons are **deactivated** (not deleted) so historical acknowledgements stay intact |

## A3. Screen — `SalesLeadAckMaster.tsx`
```
┌──────────────────────────────────────────────────────────────────────┐
│  Lead Acknowledgement Master               [ + Add New Reason ]        │
│  [ Qualified Opportunity ][ Disqualified Opportunity ][ Clarity … ]    │
│  [ Search reasons… ]                                                   │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ Sr │ Reason For <Bucket> Opportunity │ DQ Status* │ Status │ ⋯ │   │
│  └────────────────────────────────────────────────────────────────┘   │
│  Showing N–M of T Results                              ‹ Page ›        │
└──────────────────────────────────────────────────────────────────────┘
    * DQ Status column appears only on the Disqualified tab.
```
- **Three tabs** — Qualified / Disqualified / Clarity Pending. All buckets are **fetched once** on load, so switching tabs is instant.
- **Table columns** — Sr No · **Reason** (truncated at 60 chars, full text on hover) · **DQ Status** (Disqualified tab only — Positive = blue up-arrow / Negative = red down-arrow pill) · **Status** (Active green / Inactive red pill) · **Action** (Edit ✎ + Mark-Inactive 🗑).
- **Search** — client-side, case-insensitive match on the reason text; resets to page 1.
- **Pagination** — rows auto-fit to the viewport (default 10; a ResizeObserver adjusts); "Showing N–M of T Results".
- **Skeleton** shimmer rows while loading; **empty state** ("No reasons found") when a bucket/search is empty.

### Add / Edit flow
1. **Add New Reason** → an **opportunity-type chooser** (three cards: Qualified / Disqualified / Clarity Pending with helper text).
2. Picking a type opens the **form modal**:
   - **Reason** — textarea, **500-char** limit with a live counter. Required; must contain at least one letter/digit (pure punctuation rejected).
   - **Status** — Active / Inactive (defaults Active).
   - **DQ Status** — Positive / Negative — **shown only for Disqualified**.
3. Save → create (`POST`) or edit (`PUT`); on success the list updates and jumps to the matching tab.

### Mark-Inactive (the "trash" button)
The 🗑 button does **not** hard-delete — it opens a **"Mark inactive"** confirm (reusing `DeleteConfirmModal` with a non-destructive verb) and sends `PUT { status:'inactive' }`. Already-inactive rows show a disabled button. A retired reason can be re-activated later via the edit form.

## A4. Permissions
Gated on the **`sales.lead_ack_master`** permission (super-admin bypasses):

| Capability | Flag |
|---|---|
| See the master | `can_view` (no-access screen otherwise) |
| Add a reason | `can_add` |
| Edit a reason / mark inactive | `can_edit` |
| (Hard) delete | `can_delete` |

## A5. Business rules
| # | Rule | Behaviour |
|---|---|---|
| 1 | Org-level scope | Reasons are scoped by `client_id` only (no `branch_id`) — all branches share the list |
| 2 | Bucket is immutable | `opportunity_type` is fixed at creation; a reason can't move tabs (protects historical references) |
| 3 | DQ coupling | `dq_status` is **required** for Disqualified and **forced null** for the other two buckets |
| 4 | Soft retirement | The 🗑 action flips `status` to `inactive`; the row is not removed |
| 5 | No text-uniqueness | Duplicate reason text within a bucket is allowed (no unique index) |
| 6 | Referenced, not snapshotted here | The master row is referenced by id; editing its text changes what future pickers show (Stage-2 acknowledgements snapshot the text into `reason_snapshot` at the moment of use — see the matrix-stages docs) |
| 7 | Audit | `created_by` / `updated_by` auto-stamped (not shown in the form) |

---

# PART B — TECHNICAL

## B1. Architecture
```
React  SalesLeadAckMaster.tsx  ──►  GET/POST/PUT/DELETE /sales/lead-ack-reasons
                                     LeadAckReasonController (auth:sanctum · user.active)
                                        └─ LeadAckReason (Eloquent, client_id scope)
                                             └─ lead_ack_reasons  (PostgreSQL)
Consumed by Stage 2:  /sales/leads/{id}/acknowledgements  (picks these reasons)
```

## B2. Database — `lead_ack_reasons`
*Migration:* `2026_05_18_000001_create_lead_ack_reasons_table.php`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint (PK) | No | — | |
| `client_id` | bigint FK→clients | No | — | Tenant scope (cascade delete); **no `branch_id`** |
| `opportunity_type` | string(24) | No | — | `qualified` \| `disqualified` \| `clarity_pending` |
| `reason` | string(500) | No | — | Free text |
| `status` | string(16) | No | `active` | `active` \| `inactive` (soft-flag) |
| `dq_status` | string(16) | Yes | NULL | `positive` \| `negative` — only for disqualified |
| `created_by` | bigint FK→users | Yes | NULL | Audit (nullOnDelete) |
| `updated_by` | bigint FK→users | Yes | NULL | Audit (nullOnDelete) |
| `created_at`/`updated_at` | timestamp | No | — | |

**Index:** composite `(client_id, opportunity_type, status)` — the list hot-path. **No unique constraint.** **No soft-delete column** (retirement is via `status`).

## B3. Model — `app/Models/LeadAckReason.php`
- **Constants:** `TYPE_QUALIFIED`/`TYPE_DISQUALIFIED`/`TYPE_CLARITY_PENDING` (+ `TYPES`), `STATUS_ACTIVE`/`STATUS_INACTIVE` (+ `STATUSES`), `DQ_POSITIVE`/`DQ_NEGATIVE` (+ `DQ_VALUES`).
- **Fillable:** `client_id`, `opportunity_type`, `reason`, `status`, `dq_status`, `created_by`, `updated_by`.
- **Relationships:** `client()`, `creator()`, `updater()` (all BelongsTo User).
- **No casts, no SoftDeletes.**

## B4. Controller — `LeadAckReasonController`
| Method | Line | Responsibility |
|---|---|---|
| `index` | 20 | Return active+inactive reasons **pre-grouped** into the three buckets, ordered by id |
| `store` | 46 | Validate + create (default status `active`; `dq_status` required for disqualified, else nulled); stamp `created_by`/`updated_by` |
| `update` | 89 | Selective update of `reason`/`status`/`dq_status` (only truthy fields); `dq_status` applied only when the row is disqualified; `opportunity_type` immutable |
| `destroy` | 133 | Hard-delete (admin cleanup; **not** the UI path — the UI marks inactive) |

All four methods are **tenant-scoped** by `request()->user()->client_id`; a user with no `client_id` gets empty buckets (index) or 403 (store).

---

# PART C — API

**Routes** (`routes/api.php` ~378–381, under `auth:sanctum` + `user.active`):
```
GET    /sales/lead-ack-reasons          index
POST   /sales/lead-ack-reasons          store
PUT    /sales/lead-ack-reasons/{id}     update
DELETE /sales/lead-ack-reasons/{id}     destroy
```

### C1. `GET /sales/lead-ack-reasons`
Returns all reasons for the tenant, grouped:
```json
{
  "qualified": [
    { "id": 1, "opportunity_type": "qualified", "reason": "Profile matches ICP", "status": "active", "dq_status": null }
  ],
  "disqualified": [
    { "id": 5, "opportunity_type": "disqualified", "reason": "Budget unavailable", "status": "active", "dq_status": "negative" }
  ],
  "clarity_pending": [
    { "id": 9, "opportunity_type": "clarity_pending", "reason": "Awaiting spec sheet", "status": "active", "dq_status": null }
  ]
}
```

### C2. `POST /sales/lead-ack-reasons`
```
opportunity_type*   required · in (qualified|disqualified|clarity_pending)
reason*             required · string · max:500
status              nullable · in (active|inactive)   (default active)
dq_status           nullable · in (positive|negative) — REQUIRED when opportunity_type=disqualified, forced null otherwise
```
**201** → the created row. **422** if `dq_status` missing for a disqualified reason.

### C3. `PUT /sales/lead-ack-reasons/{id}`
```
reason      nullable · string · max:500     (updated only if present)
status      nullable · in (active|inactive) (updated only if present)
dq_status   nullable · in (positive|negative) (applied only if the row is disqualified)
```
`opportunity_type` cannot be changed. **200** → the updated row (unchanged row returned if nothing to update). **404** if out of tenant scope. Common uses: edit text `{reason}`; retire `{status:"inactive"}`.

### C4. `DELETE /sales/lead-ack-reasons/{id}`
Hard-delete. **200** → `{ "message": "Deleted" }`. **404** if out of scope. *(Not the UI flow — the UI uses `PUT {status:'inactive'}`.)*

### C5. Consumers (Stage 2)
```
GET  /sales/leads/{id}/acknowledgements     # history for a lead
POST /sales/leads/{id}/acknowledgements     # { reason_ids[] } → one row per reason (same bucket); snapshots reason text
```

---

# PART D — CODE WALKTHROUGH

> Legend: `→` a call · `⇒` a return. Line numbers reference live source and may drift.

## D1. List load
`SalesLeadAckMaster.tsx` mounts → if `canView`, `api.get('/sales/lead-ack-reasons')` (≈174) ⇒ sets `data.{qualified,disqualified,clarity_pending}`. All buckets cached; tab switch is state-only.
Backend `index()` (20): `LeadAckReason::where('client_id',$cid)->orderBy('id')->get()` → grouped by `opportunity_type` into three arrays ⇒ JSON.

## D2. Create
User → **Add New Reason** → type chooser (560) → form modal (652). Client validation (265): trim + `/[\p{L}\p{N}]/` (must contain a letter/digit). Save (264) → `POST` with `{opportunity_type, reason, status, dq_status?}`.
Backend `store()` (46): validate (54); if `opportunity_type==='disqualified'` require `dq_status` (63) else null it (73); default `status='active'` (72); stamp `created_by`/`updated_by` (74) ⇒ **201** row. UI prepends the row and switches to that tab (293).

## D3. Edit
Edit ✎ opens the modal pre-filled → `PUT /{id}` with the changed fields.
Backend `update()` (89): tenant lookup (404 if missing); apply only truthy `reason`/`status`; apply `dq_status` **only if** the row is disqualified (109); stamp `updated_by` (119) ⇒ **200** row.

## D4. Mark inactive
🗑 → `requestInactivate(row)` (310) → confirm modal (722, "Mark inactive") → `PUT {status:'inactive'}` (316) ⇒ list updates. Already-inactive rows disable the button.

## D5. How Stage 2 consumes it
In `Stage2LeadAcknowledgement.tsx`, clicking a status pill opens the reason picker sourced from this master's active rows (disqualified split by `dq_status` into Negative/Positive columns). Submitting posts `reason_ids[]` to `/sales/leads/{id}/acknowledgements`, which creates one acknowledgement row per reason (snapshotting the text) and flips the lead's `qualified`/`disqualified` flags — **without** moving the stage (the SPA's `PUT lead_stage_id` does that).

## D6. Cross-cutting patterns
| Pattern | Where | Why |
|---|---|---|
| Pre-grouped fetch | `index()` | One request powers all three tabs |
| Immutable bucket | `update()` (no `opportunity_type`) | Preserve historical grouping |
| Conditional field | `dq_status` gated on disqualified | Intent only meaningful for lost leads |
| Soft retire vs hard delete | UI `PUT status` vs API `DELETE` | Keep audit trail; delete is admin-only |
| Tenant scope everywhere | `client_id` filter | Isolation |
| Snapshot at point of use | Stage-2 `reason_snapshot` | Editing a master reason won't rewrite history |

## D7. Notes & caveats
- **DB is PostgreSQL.** No unique index on reason text — the UI is the only guard against duplicates.
- **`branch_id` absent** — this master is deliberately org-wide.
- **`destroy` is not wired to the UI** — the app retires via `status`. Use `DELETE` only for admin cleanup.
- **DQ Status** is display-and-intent only; it drives the Negative/Positive split in the Stage-2 disqualified picker.

---

*Related: `../My WorkPlace/lead-worksheet/` (worksheet + toolbar) · `../My WorkPlace/matrix-stages/` (the 6 stages that consume these reasons) · sibling combined docs `QUOTATION.md`, `PROFORMA_INVOICE.md`.*

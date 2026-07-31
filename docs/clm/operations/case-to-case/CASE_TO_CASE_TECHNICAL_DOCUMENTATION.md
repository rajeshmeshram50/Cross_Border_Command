# CASE TO CASE CONTRACTS (CTC) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Case to Case Contracts**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
One table (`ctc_contracts`) and one controller (`CtcContractController`, ~1,450 lines) driving **three screens**:

```
index()          → Case to Case Contracts   (the full list)
sentIndex()      → Agreements We Sent       (created_by = me)
toApproveIndex() → Agreements To Approve    (my email is in approver_emails)
```

Counterparties, the page header/footer, approvers, the clarification thread, version history and signing recipients all round-trip as **JSON columns**, so the front-end prototype's rich shape survives without a web of child tables.

E-signature for CTC lives in `ClmSignatureController` (`ctcPreview`, `ctcSend`, `ctcSignatureStatus`, `ctcRemindSigning`), not here.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/operations/                                                │
│    ClmCaseToCasePage.tsx        list · tabs · stage cards             │
│    ClmCtcForm.tsx               the full-screen 4-stage form          │
│    CtcRichEditor.tsx            body editor (clauses, tables, DOCX)   │
│    clmCtcModals.tsx             VersionHistory · AgreementTimeline    │
│    ClmCtcSignPositionModal.tsx  drag the signature box                │
│    clmOpsData.ts · useOpsTheme.ts                                     │
│    ClmAgreementsSentPage.tsx · ClmAgreementsToApprovePage.tsx         │
└──────────────────────────────┬───────────────────────────────────────┘
                                │ /api/clm/ctc-contracts…
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — CtcContractController                                  │
│   LISTS      index · sentIndex · toApproveIndex                       │
│   LOOKUPS    approverCandidates · contactPersons · placeholderValues  │
│   CRUD       store · show · update · destroy                          │
│   APPROVAL   approve · reject · clarify · respond                     │
│   LIFECYCLE  resubmit · sendForSigning · recordSignature ·            │
│              moveToRepository                                         │
│   AUDIT      versions · downloadVersion                               │
│   Support: CtcAuditTime (UTC→IST) · HandlesDocxHtmlRoundtrip ·        │
│            CtcApprovalUpdated broadcast (Reverb)                      │
│                                                                       │
│  E-SIGN (in ClmSignatureController):                                  │
│   ctcPreview · ctcSend · ctcSignatureStatus · ctcRemindSigning        │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA — ctc_contracts (soft-deleted, 9 JSON columns)                  │
│  Reads live: customers · consignees · vendors (counterparty refresh)  │
│  Read by:    ClmClauseController (clause "in use" search) ·           │
│              ClmDiagnosisResolutionController · ClmRegulatoryDefense  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/CtcContractController.php
app/Http/Controllers/Api/ClmSignatureController.php   (ctc* methods)
app/Http/Controllers/Concerns/HandlesDocxHtmlRoundtrip.php
app/Models/CtcContract.php
app/Support/CtcAuditTime.php
app/Events/CtcApprovalUpdated.php
resources/views/pdf/clm-signature-document.blade.php
database/migrations/2026_06_03_000200_create_ctc_contracts_table.php
                    2026_06_04_000100_add_lifecycle_to_ctc_contracts.php
                    2026_06_04_000300_add_zoho_request_to_ctc_contracts.php
                    2026_06_04_000400_add_signature_declined_to_ctc_contracts.php
                    2026_06_24_000100_drop_termination_notice_from_ctc_contracts_table.php
                    2026_07_23_000010_widen_ctc_agreement_type_to_255.php
resources/js/pages/clm/operations/…
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (JSON columns) · Sanctum |
| Realtime | **Laravel Reverb** — `CtcApprovalUpdated` broadcast on every approval action |
| PDF | `barryvdh/laravel-dompdf` → `pdf.clm-signature-document` |
| DOCX | `phpoffice/phpword` via `HandlesDocxHtmlRoundtrip` |
| E-sign | Zoho Sign, through `ClmSignatureController` |
| Frontend | React 19 · TS · violet operations theme · contentEditable editor |

---

## 3. DATABASE SCHEMA — `ctc_contracts`

Soft-deleted. `UNIQUE` is not declared on `code`; the index is `(client_id, status)`.

| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` (FK cascade) · `branch_id` (indexed) | | |
| `code` | varchar(16) | `CTC-NNN`, **per branch** |
| `title` | varchar(255) | |
| `agreement_type` | varchar(255) | widened from 64 (2026-07-23) |
| `org_name` · `org_short_code` · `org_state` · `org_country` | varchar | "Our Organisation" from the Company Details master |
| `counterparties` | **json** | `[{name, code, country, phone, email, badge, referred, source_type, source_id}]` |
| `eff_date` · `end_date` | date | |
| `auto_renewal` | bool | |
| `renewal_type` | varchar(16) | `manual` \| `auto` |
| `content` | longText | draft agreement HTML |
| `header_config` · `footer_config` | **json** | page shell |
| `approvers` | **json** | `[{name, email, role, mandatory, status, acted_at}]` |
| `approver_emails` | **json** | `["ceo@…"]` — **queryable**, powers "To Approve" |
| `clarifications` | **json** | `[{query, by, date, response, response_date, resolved}]` |
| `versions` | **json** | append-only `[{v, label, status, date, by, content, …}]` |
| `signing_recipients` | **json** | `[{name, email, role, contact, signed, signed_at}]` |
| `days_to_sign` · `days_to_approve` · `reminder_days` | int | stored, **not enforced by a scheduler** |
| `zoho_request_id` · `signature_request_id` · `signature_declined_at` | | the e-sign link |
| `stage` | tinyint | 1 Drafting · 2 Review · 3 Signing · 4 Repository |
| `approval_status` | varchar(24) | `pending` \| `approved` \| `rejected` \| `clarification` |
| `status` | varchar(24) | `inprogress` \| `signed` \| `rejected` (list bucket) |
| `rejection_reason` | text | |
| `cp_signed_date` | date | |
| `primary_approver_name` · `primary_approver_email` | varchar | legacy single-approver slot |
| `created_by` · `created_by_name` · `submitted_at` | | |
| timestamps + `deleted_at` | | |

---

## 4. MODEL — `App\Models\CtcContract`

```php
use SoftDeletes;

fillable: client_id, branch_id, code, title, agreement_type,
          org_name, org_short_code, org_state, org_country,
          counterparties, eff_date, end_date, auto_renewal, renewal_type,
          content, header_config, footer_config,
          approvers, approver_emails, clarifications,
          versions, signing_recipients, days_to_sign,
          zoho_request_id, signature_request_id, signature_declined_at,
          stage, approval_status, status, rejection_reason,
          days_to_approve, reminder_days, cp_signed_date,
          primary_approver_name, primary_approver_email,
          created_by, created_by_name, submitted_at

casts:    counterparties·header_config·footer_config·approvers·approver_emails·
          clarifications·versions·signing_recipients => array
          auto_renewal => boolean
          eff_date·end_date·cp_signed_date => date
          submitted_at·signature_declined_at => datetime
          stage·days_to_approve·reminder_days·days_to_sign·signature_request_id => integer
```

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/ctc-contracts',                    [CtcContractController::class,'index']);
    Route::post  ('/clm/ctc-contracts',                    [… 'store']);
    Route::get   ('/clm/ctc-contracts/sent',               [… 'sentIndex']);
    Route::get   ('/clm/ctc-contracts/to-approve',         [… 'toApproveIndex']);
    Route::get   ('/clm/ctc-contracts/approver-candidates',[… 'approverCandidates']);
    Route::get   ('/clm/ctc-contracts/contact-persons',    [… 'contactPersons']);
    Route::get   ('/clm/ctc-contracts/placeholder-values', [… 'placeholderValues']);
    Route::get   ('/clm/ctc-contracts/{id}',               [… 'show'])->whereNumber('id');
    Route::put   ('/clm/ctc-contracts/{id}',               [… 'update'])->whereNumber('id');
    Route::delete('/clm/ctc-contracts/{id}',               [… 'destroy'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/approve',       [… 'approve']);
    Route::post  ('/clm/ctc-contracts/{id}/reject',        [… 'reject']);
    Route::post  ('/clm/ctc-contracts/{id}/clarify',       [… 'clarify']);
    Route::post  ('/clm/ctc-contracts/{id}/respond',       [… 'respond']);
    Route::post  ('/clm/ctc-contracts/{id}/resubmit',      [… 'resubmit']);
    Route::post  ('/clm/ctc-contracts/{id}/send-for-signing',   [… 'sendForSigning']);
    Route::post  ('/clm/ctc-contracts/{id}/record-signature',   [… 'recordSignature']);
    Route::post  ('/clm/ctc-contracts/{id}/move-to-repository', [… 'moveToRepository']);
    Route::get   ('/clm/ctc-contracts/{id}/versions',           [… 'versions']);
    Route::get   ('/clm/ctc-contracts/{id}/versions/{v}/download', [… 'downloadVersion']);

    // E-signature (ClmSignatureController)
    Route::post  ('/clm/signature-requests/ctc-preview',   [ClmSignatureController::class,'ctcPreview']);
    Route::post  ('/clm/signature-requests/ctc-send',      [… 'ctcSend']);
    Route::get   ('/clm/ctc-contracts/{id}/sync-signature',[… 'ctcSignatureStatus']);
    Route::post  ('/clm/ctc-contracts/{id}/remind-signing',[… 'ctcRemindSigning']);
});
```
The literal routes (`/sent`, `/to-approve`, `/approver-candidates`, `/contact-persons`, `/placeholder-values`) are declared **before** `/{id}`, and `/{id}` carries `whereNumber('id')`. Full detail in **CASE_TO_CASE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### Shared helpers
| Helper | Purpose |
|---|---|
| `fmt($d)` | Date → `d M Y` in `Asia/Kolkata`, `—` on failure |
| `istStr()` / `istEntries()` | Delegate to **`CtcAuditTime`** so `show()` and `ClmSignatureController::ctcSignatureStatus()` produce identical timelines (CBC-574) |
| `pushVersion()` | Append `{v, label, status, date, by, content}` — never rewrites |
| `broadcastApproval()` | Deferred to `app()->terminating()`, then `broadcast(new CtcApprovalUpdated($c))` |
| `myApproverStatus()` / `approverList()` / `approvalRoundsShaped()` / `approvalProgress()` | The approval read model |
| `listStatus()` | Derives the list bucket |
| `cpNames()` / `cpNamesLabeled()` / `cpRoleLabel()` / `cpIsDomestic()` | Counterparty display |
| `assertCounterpartyCategories()` | The Domestic/International rule |
| `resolveCounterparties()` / `resolvePartyRow()` / `liveParty()` / `livePartyModel()` | Live master refresh |
| `resolvePartyTokens()` / `resolveOrgTokens()` / `previewContent()` | Placeholder merge |
| `shapeList()` / `shapeSent()` / `shapeApprove()` | The three response shapes |

### Timezone contract
Audit stamps are written with `now()->format('d M Y H:i')` — i.e. **UTC** — and converted on read by `CtcAuditTime`. The comment on `istStr()` records why it is centralised:

> *"ClmSignatureController::ctcSignatureStatus() feeds the SAME Review Timeline as show(), and when each controller kept its own copy of this logic only one got fixed, so the timeline's times shifted by 5:30 as the SPA's poll switched endpoints (CBC-574)."*

### Code allocation
```php
DB::table('clients')->lockForUpdate();
$seq = CtcContract::withTrashed()->where('client_id',$cid)
         ->when($branchId, fn($q)=>$q->where('branch_id',$branchId),
                           fn($q)=>$q->whereNull('branch_id'))->count() + 1;
$code = sprintf('CTC-%03d', $seq);
```
Unusually for CLM this uses `count() + 1` rather than MAX+1 — `withTrashed()` keeps the count gap-free across soft deletes.

---

## 7. FRONTEND

| Component | Role |
|---|---|
| `ClmCaseToCasePage.tsx` | List, tab bar, stage-card box, row actions |
| `ClmCtcForm.tsx` | The full-screen four-stage create/edit form |
| `CtcRichEditor.tsx` | Body editor — clause insertion, tables, DOCX upload |
| `clmCtcModals.tsx` | `VersionHistoryModal`, `AgreementTimelineModal` |
| `ClmCtcSignPositionModal.tsx` | Drag the signature box before sending |
| `clmOpsData.ts` | Shared `CtcContract` type + `PER_PAGE` |
| `useOpsTheme.ts` | The violet operations theme |

The SPA's `CtcContract`, `AwsContract` and `AtaContract` types map 1:1 onto `shapeList()`, `shapeSent()` and `shapeApprove()`.

---

## 8. INTEGRATIONS

| Integration | How |
|---|---|
| **Zoho Sign** | `ctcSend()` renders the contract PDF (with the org signature) and creates the request; `ctcSignatureStatus()` polls; `ctcRemindSigning()` nudges |
| **Reverb** | `CtcApprovalUpdated` fires after approve/reject/clarify/respond so the other approvers' screens update live |
| **Clause Library** | Clauses are copied into `content`; `ClmClauseController` searches `content` + `versions[].content` for `<h3>Name</h3>` to compute clause usage |
| **Customers / Consignees / Vendors** | Counterparties are refreshed from these masters on every read |
| **Diagnosis & Resolution** | `ctcRows()` surfaces code, title, primary counterparty and list status |
| **Regulatory Defense File** | `caseToCase()` builds the third RDF tab |

---

## 9. SECURITY & CAVEATS

1. Every lookup is `CtcContract::where('client_id', $user->client_id)->findOrFail()` — tenant-scoped, but **not** branch-scoped or `MasterVisibility`-gated; any user in the tenant can open any contract by id.
2. Approval authorisation is by **email match** against the `approvers` array (with the `primary_approver_email` legacy fallback) — a non-approver gets 403.
3. `approver_emails` exists purely so "To Approve" can be queried with a JSON containment check.
4. `assertCounterpartyCategories()` is enforced server-side on `store()` and `update()`; the client-side filter is a convenience.
5. Version history is **append-only** — nothing is ever rewritten, which is what makes the audit trail trustworthy, and also what makes `versions` grow without bound.
6. `days_to_approve` / `reminder_days` / `days_to_sign` are stored but **no scheduler enforces them**.
7. `downloadVersion()` raises `memory_limit` to 1024M and `set_time_limit(300)` — large agreements (200–300 pages) otherwise 500 during dompdf layout.
8. `broadcastApproval()` is deferred to `app()->terminating()` and wrapped in `try/report`, so a Reverb outage never fails the request.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`CtcContractController`, ~1,450 lines) + 4 CTC methods in `ClmSignatureController` |
| Table | 1 (9 JSON columns, soft-deleted) |
| Endpoints | 21 (17 here + 4 e-signature) |
| Screens served | 3 (Case to Case · Agreements We Sent · Agreements To Approve) |
| Lifecycle stages | 4 |
| Code prefix | `CTC-NNN` (branch-scoped, `count()+1` with `withTrashed()`) |
| Permission slugs | `clm.case_to_case`, `clm.agreements_sent`, `clm.agreements_to_approve` |
| Broadcast event | `CtcApprovalUpdated` |
| Test coverage | none automated |

---

*Related documents: CASE_TO_CASE_FUNCTIONAL_DOCUMENTATION.md · CASE_TO_CASE_CODE_WALKTHROUGH.md · CASE_TO_CASE_API_DOCUMENTATION.md*

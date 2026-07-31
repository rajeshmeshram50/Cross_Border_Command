# DOCUMENT CONTROL PANEL (DCP) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Document Control Panel**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
`clm_segment_rules` plus `ClmSegmentRuleController`. The controller carries five endpoints, two of which are read-only aggregators that exist purely so consumers never have to assemble the rule themselves:

- **`bootstrap()`** — one call returns every master the Add/Edit modal needs (segments, authorities, kyc, dd, tl, qc), branch-scoped and with authorities pre-resolved.
- **`forSegment()`** — given a segment, returns the rule *plus the fully hydrated document rows* it references, each stamped `M`/`O`.

The rule's payload is a single JSON blob rather than six join tables, which keeps the schema flexible as document categories change and avoids a multi-join just to compute requirement counts.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/compliance/ClmDcpPage.tsx                                  │
│    tabs(all|highly|less) · search · ClmDcpFilterModal ·               │
│    AuthorityBadges · 2-stage Add/Edit modal                           │
│    embeds KycModal · DdModal · QcModal · TlModal (inline doc create)  │
│    bustAllMasterBundles() after every write                           │
└──────────────────────────────┬───────────────────────────────────────┘
        GET /clm/segment-rules/bootstrap   (one fetch → whole modal)
        GET /clm/segment-rules             (the list)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmSegmentRuleController                               │
│    index()      scoped list + counts{all,highly,less}                 │
│    bootstrap()  6 branch-scoped master loads + authority resolution   │
│    store()      validate → 409 dupe(segment,document_type) →          │
│                 lock + SR-NNN → countSelections → create → cache bump │
│    update()     denial → 409 clash → recount → update → cache bump    │
│    destroy()    denial → delete → cache bump                          │
│    forSegment() rule + resolved doc rows + requirement stamp          │
│  Support: MasterVisibility · MasterBundleCache                        │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA — clm_segment_rules                                             │
│    doc_selections JSON → codes from clm_kyc/dd/trade_licenses/qc      │
│    auths_json JSON     → authority CODES                              │
│    segment_id FK + segment_code snapshot → clm_segments               │
│  CONSUMED BY: AddCustomer / AddConsignee / AddVendor ·                │
│    SegmentDocUploadController · ClmBuyerProfile · ClmSupplierProfile ·│
│    ClmRegulatoryDefenseFile · masterBundle (segment picker)           │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmSegmentRuleController.php
app/Models/ClmSegmentRule.php
app/Support/MasterVisibility.php · MasterBundleCache.php
database/migrations/2026_05_22_000150_create_clm_segment_rules_table.php
                    2026_06_09_000010_strip_trade_documents_from_clm_segment_rules.php
                    2026_07_04_000002_add_branch_id_to_clm_segment_rules_table.php
                    2026_07_21_000010_add_document_type_to_clm_segment_rules.php
                    2026_07_21_000020_default_clm_segment_rules_document_type_international.php
resources/js/pages/clm/compliance/ClmDcpPage.tsx
resources/js/pages/clm/compliance/ClmDcpFilterModal.tsx
resources/js/pages/clm/compliance/AuthorityBadges.tsx
resources/js/hooks/useRuledSegments.ts
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (JSON columns) · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · `MasterSelect` / `MasterMultiSelect` |
| Caching | `MasterBundleCache` (server, 5-min per-user TTL) + `bustAllMasterBundles()` (client) |

---

## 3. DATABASE SCHEMA — `clm_segment_rules`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | branch-owned; NULL ⇒ client-level (shared) |
| `segment_id` | FK → clm_segments, **nullOnDelete** | |
| `segment_code` | varchar(16) | **snapshot** so the row survives a segment reference change |
| `rule_code` | varchar(16) | `SR-NNN` |
| `regulatory_status` | varchar(16) | `highly` \| `less` |
| **`document_type`** | varchar | `domestic` \| `international`, **NOT NULL DEFAULT 'international'** (added 2026-07-21; legacy rows backfilled) |
| `auths_json` | json | authority **codes**, e.g. `["AUTH-001","AUTH-004"]` |
| `doc_selections` | json | the requirement payload (see below) |
| `mandatory_count` | unsigned int | denormalised at write time |
| `optional_count` | unsigned int | denormalised at write time |
| `status` | varchar(16) | default `active` (not surfaced in the UI) |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, rule_code)`, `INDEX(client_id, segment_id)`, `INDEX(client_id, regulatory_status)`.

### 3.1 `doc_selections` shape
```json
{
  "kyc": { "KYC-001": "M", "KYC-003": "M", "KYC-007": "O" },
  "dd":  { "DD-002": "M" },
  "tl":  { "TL-001": "M", "TL-004": "O" },
  "qc":  { "QC-003": "O" }
}
```
Documents are referenced by **code**, never by id — which is why every document master's `code` is immutable and why renaming a document is always safe.

The original migration documented a fifth key, `"td"`. It was removed by `2026_06_09_000010_strip_trade_documents_from_clm_segment_rules`, and `validatePayload()` still `unset()`s it defensively for older clients.

---

## 4. MODEL — `App\Models\ClmSegmentRule`

```php
const REG_HIGHLY='highly'; REG_LESS='less'; REG_VALUES=[…]

// Domestic vs International trade — a segment can hold one rule of each type,
// each with its own required-document set. NOT NULL DEFAULT 'international';
// legacy rows were backfilled.
const DOC_DOMESTIC='domestic'; DOC_INTERNATIONAL='international'; DOC_TYPE_VALUES=[…]

fillable: client_id, branch_id, segment_id, segment_code, rule_code,
          regulatory_status, document_type, auths_json, doc_selections,
          mandatory_count, optional_count, status, created_by, updated_by

casts:    auths_json => array, doc_selections => array,
          mandatory_count => integer, optional_count => integer

relations: client() · segment()
```

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/segment-rules/bootstrap',                [ClmSegmentRuleController::class, 'bootstrap']);
    Route::get   ('/clm/segment-rules/for-segment/{segmentId}',  [ClmSegmentRuleController::class, 'forSegment'])
                                                                 ->whereNumber('segmentId');
    Route::get   ('/clm/segment-rules',      [ClmSegmentRuleController::class, 'index']);
    Route::post  ('/clm/segment-rules',      [ClmSegmentRuleController::class, 'store']);
    Route::put   ('/clm/segment-rules/{id}', [ClmSegmentRuleController::class, 'update']);
    Route::delete('/clm/segment-rules/{id}', [ClmSegmentRuleController::class, 'destroy']);
});
```
Route order matters: `/bootstrap` and `/for-segment/{id}` are declared **before** the generic `/{id}` routes. Full detail in **DOCUMENT_CONTROL_PANEL_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
Returns an empty payload for a user with no `client_id`. Otherwise scoped read ordered **`id DESC`** (newest rule at the top of the panel) plus `counts.{all, highly, less}` computed off the loaded collection.

### `bootstrap()`
Six branch-scoped master loads through one closure, then a single `ClmAuthority::idNameMap()` used to resolve every document row. The order of the two assignments matters:
```php
$r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);  // ARRAY, from the IDS
$r->authority      = ClmAuthority::displayNames($r->authority, $authMap);      // then overwrite
```
QC uses `issued_by` as its source column but still exposes `authority_list`, so `AuthorityBadges` works uniformly.

Branch-scoping this loader is what stopped sibling branches' segments leaking into another branch's SELECT SEGMENT dropdown.

### `store()`
1. `validatePayload()` — `segment_code`, `regulatory_status`, **`document_type` (required)**, `auths[]`, `doc_selections{kyc,dd,tl,qc}`; then `unset($data['doc_selections']['td'])`.
2. Duplicate check on `(segment_code, document_type)` **within the caller's scope** → **409** with the existing rule attached.
3. `DB::transaction`: lock the `clients` row → `nextRuleCode()` → resolve `segment_id` from the code → `countSelections()` → `create()` stamping `branch_id`.
4. `MasterBundleCache::bump()` — a rule going from 0 → ≥1 documents makes its segment appear in the party pickers, and those bundles are cached server-side per user.

### `update()`
Scoped `firstOrFail` → `hierarchicalDenial('edit')` → validate → clash check excluding self (409) → recount → update → cache bump. Editing can move a rule from ≥1 → 0 documents, which *removes* its segment from the pickers — hence the bump on this path too.

### `destroy()`
Scoped `firstOrFail` → `hierarchicalDenial('delete')` → delete → cache bump. No usage guard: a rule is a configuration, not a referenced entity.

### `forSegment($segmentId, ?document_type)`
Always returns **HTTP 200**, even with no rule, so the consumer forms render an empty Stage 2 instead of swallowing a 404. For each category it resolves the codes back into full model rows and stamps `requirement`. The `$base` array carries the intersection of fields plus any of `authority`, `expiry`, `validity`, `title`, `doc_type`, `purpose`, `party` that actually exist on that model — which is how TL rows surface `validity` while KYC/DD rows surface `expiry`.

### `nextRuleCode($clientId)`
```php
$codes = ClmSegmentRule::where('client_id', $clientId)->pluck('rule_code');   // NO branch predicate
$maxN  = max over /^SR-(\d+)$/;
do { $n++; $code = sprintf('SR-%03d', $n); } while (isset($taken[$code]));
```
**This is the only CLM code allocator that is not branch-scoped** — two branches of one client share the `SR-NNN` sequence. The caller must already hold the client row lock.

---

## 7. FRONTEND — `ClmDcpPage.tsx`

- One `GET /clm/segment-rules/bootstrap` hydrates the whole two-stage modal; no further fetches while configuring.
- Stage 1: `MasterSelect` for the segment, radio for `document_type`, `MasterMultiSelect` for authorities.
- Stage 2: four category panels, each row a checkbox plus an M/O toggle.
- **Imports `KycModal`, `DdModal`, `QcModal`, `TlModal`** from the compliance pages so a missing document can be created inline; the panel re-fetches bootstrap afterwards.
- `ClmDcpFilterModal` + `countDcpFilters()` drive the filter badge.
- `bustAllMasterBundles()` runs after every write to drop the client-side picker caches.
- `useRuledSegments.ts` is the shared hook other screens use to ask "which segments actually have a rule with documents?".

---

## 8. INTEGRATIONS

| Consumer | How it reads the rule |
|---|---|
| AddCustomer / AddConsignee / AddVendor | `forSegment()` → Stage 2 required-document checklist |
| `SegmentDocUploadController` | Resolves required docs per party, computes X-of-Y, and exposes `missingMandatoryDocs()` as the gate other modules call |
| `ClmBuyerProfileController` | Keys rules `[segment_id][document_type]`, with a fallback to the other type when the match is absent |
| `ClmSupplierProfileController` | Same, single-type keyed |
| `ClmRegulatoryDefenseFileController` | Inherits both profile aggregations |
| Segment picker (`masterBundle`) | Only offers segments whose rule holds ≥ 1 document — the reason every write bumps the cache |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; `branch_id` stamped from the creator.
2. The duplicate and clash checks run **inside the caller's read scope**, so two branches may each hold their own `(segment, international)` rule.
3. **`SR-NNN` is client-wide** — the single exception to CLM's branch-scoped code convention.
4. `segment_code` is snapshotted but `segment_id` is `nullOnDelete`; a rule can therefore outlive its segment with a dangling code. (In practice the segment master refuses the delete while a rule references it.)
5. `doc_selections` is validated only for shape (`array` per category) — the individual codes are not existence-checked at write time, so a rule can reference a document that was later deleted. `forSegment()` simply returns fewer rows in that case.
6. `td` is stripped on every write.
7. Deletes are hard and unguarded.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmSegmentRuleController`, ~390 lines) |
| Table | 1 |
| Endpoints | 6 (4 CRUD + bootstrap + for-segment) |
| Document categories | 4 (`kyc`, `dd`, `tl`, `qc`) — `td` removed |
| Consumers | 6+ (party forms, vault, both profiles, RDF, segment picker) |
| Permission slug | `clm.document_panel` |
| Code prefix | `SR-NNN` (**client-wide**) |
| Test coverage | none automated |

---

*Related documents: DOCUMENT_CONTROL_PANEL_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_CODE_WALKTHROUGH.md · DOCUMENT_CONTROL_PANEL_API_DOCUMENTATION.md*

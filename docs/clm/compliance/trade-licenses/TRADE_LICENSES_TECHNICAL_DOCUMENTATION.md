# TRADE LICENSES — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Trade Licenses**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A one-table statutory-permission catalogue (`clm_trade_licenses`). `ClmTradeLicenseController` follows the same CLM master pattern as KYC and DD, with two deliberate differences: the date column is **`validity`** rather than `expiry`, and duplicate-name failures are returned as a **hand-built 422 envelope** (`{status, message, errors.name}`) instead of a thrown `ValidationException`, so the modal renders the message inline under the LICENCE NAME field.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                             │
│  pages/clm/compliance/ClmTradeLicensesPage.tsx                      │
│    list · search · AuthorityBadges chips · TlModal                  │
│    ── TlModal is ALSO imported by ClmDcpPage ──                     │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ /api/clm/trade-licenses (+ ?branch_id)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmTradeLicenseController                            │
│    index()   scoped list → idNameMap → authority_names → in_use     │
│    store()   dupe(scope) → normalizeIds → nextCode(TL-) → create    │
│    update()  denial → validate → normalizeIds → clash → update      │
│    destroy() usageCheck() → 409 used_in | delete                    │
└──────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA — clm_trade_licenses                                          │
│  Referenced BY CODE from:                                           │
│    clm_segment_rules.doc_selections["tl"]["TL-001"] = "M"|"O"       │
│    segment_doc_uploads (category='tl', doc_code='TL-001')           │
│  References BY ID:  clm_authorities.id (comma-joined)               │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmTradeLicenseController.php
app/Models/ClmTradeLicense.php
app/Models/ClmAuthority.php                 ← normalizeIds / idNameMap / displayNames
app/Support/MasterVisibility.php
database/migrations/2026_05_22_000050_create_clm_trade_licenses_table.php
                    2026_06_17_000000_convert_clm_doc_authority_to_ids.php
                    2026_07_06_000001_add_branch_id_to_clm_compliance_masters.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmTradeLicensesPage.tsx   (exports TlModal)
resources/js/pages/clm/compliance/AuthorityBadges.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · `MasterMultiSelect` for authorities |

---

## 3. DATABASE SCHEMA — `clm_trade_licenses`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `TL-NNN`, per branch — the key downstream tables store |
| `name` | varchar(255) | IEC, FSSAI Licence, BIS Registration … |
| `authority` | **varchar(255)** | comma-joined **authority ids** — note: **not** widened to 2000 like KYC/DD |
| `validity` | varchar(32) | default `N/A`; also `Varies`, `1 Year`, `MM/YYYY` … |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)`, `INDEX(client_id, status)`.

> The 2026-06-06 widening migrations covered `clm_kyc_documents.authority` and `clm_dd_documents.authority` only. `clm_trade_licenses.authority` remains 255 characters, and the controller validates it as `max:255` to match — so a licence can reference materially fewer authorities before hitting the cap.

---

## 4. MODEL — `App\Models\ClmTradeLicense`

```php
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive'; STATUSES=[…]
fillable: client_id, branch_id, code, name, authority, validity, status, created_by, updated_by
relations: client()
```
No casts, no soft deletes. All authority intelligence lives in `ClmAuthority`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'index']);
    Route::post  ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'store']);
    Route::put   ('/clm/trade-licenses/{id}', [ClmTradeLicenseController::class, 'update']);
    Route::delete('/clm/trade-licenses/{id}', [ClmTradeLicenseController::class, 'destroy']);
});
```
Trade licences are also served (pre-resolved) by `/clm/segment-rules/bootstrap` and `/clm/segment-rules/for-segment/{id}` under the `tl` key. Full detail in **TRADE_LICENSES_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
Scoped list ordered `id ASC` → `ClmAuthority::idNameMap()` once → `authority_names` per row → `usageCheck($r->code)` per row for `in_use` / `used_in`. Returns `{ data, count }`.

### `store()`
Validates `name` (≤255), `authority` (**≤255**), `validity` (≤32), `status`.
Duplicate check runs **inside the caller's read scope** and returns the hand-built envelope:
```php
return response()->json([
    'status'  => false,
    'message' => "A trade licence named \"{$name}\" already exists. Pick a different name.",
    'errors'  => ['name' => [$msg]],     // same shape Laravel's `unique` rule returns
], 422);
```
Then `ClmAuthority::normalizeIds()`; an empty result throws a `ValidationException` on `authority`. Insert wrapped in `DB::transaction`, stamping `branch_id` and the allocated `code`, defaulting `validity` to `'N/A'`.

### `update()`
Scoped `firstOrFail` → `hierarchicalDenial('edit')` → validate (`sometimes`) → re-normalise authority when present → clash check excluding self → update. **No in-use edit lock** — downstream stores the code, so renames are safe.

### `destroy()`
Scoped `firstOrFail` → `hierarchicalDenial('delete')` → `usageCheck` → 409 with `used_in` or hard delete.

### `usageCheck(?string $code)`
```php
clm_segment_rules.doc_selections  LIKE '%"TL-001"%'  → 'Segment Rules'
segment_doc_uploads.doc_code      = 'TL-001'        → 'Segment Doc Uploads'
```
Both guarded by `Schema::hasTable()` / `hasColumn()`. **Not** scoped by `client_id` — see §9.

### `nextCode($clientId, $branchId)`
Client row lock → `MAX(/^TL-(\d+)$/) + 1` → skip taken → `TL-%03d`, branch-scoped (`whereNull('branch_id')` for client-level creators).

---

## 7. FRONTEND — `ClmTradeLicensesPage.tsx`

- Standard CLM shell (`CLM_CSS`, `ClmPageHeader`, `ClmBrefBox`, `ShimmerClmMaster`, `WorklistPager`).
- Authority column renders `AuthorityBadges` from `authority_list`.
- `in_use` disables Delete and shows `used_in` in a themed tooltip.
- **Exports `TlModal`**, imported by `ClmDcpPage.tsx` so a missing licence can be added mid-rule-configuration; the DCP re-fetches its bootstrap payload afterwards.
- Because the server returns `errors.name`, the modal binds the message to the LICENCE NAME input rather than raising a toast.

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| Document Control Panel | `bootstrap()` ships the branch-scoped licence list with `authority` + `authority_list`; the rule stores the **code** with an `M`/`O` value under `doc_selections.tl` |
| Customer / Consignee / Vendor forms | `forSegment()` resolves `doc_selections['tl']` codes back into full rows stamped with `requirement`. Note `forSegment()` surfaces `validity` (not `expiry`) for these rows |
| Evidence Vault | `segment_doc_uploads` rows with `category = 'tl'`; `doc_name` + `requirement` snapshotted at upload; the real expiry lands on `expiry_date` |
| Buyer / Supplier Profile | The `tl` progress ratio in every compliance scorecard |
| Regulatory Defense File | Trade licences are one of the five tracked document families (`kyc`, `dd`, `tl`, `td`, `agr`) |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; authority helpers are tenant-scoped.
2. Employees read the whole branch (the `clm_` prefix rule in `MasterVisibility`) but mutate only their own rows.
3. **`usageCheck()` is not client-scoped.** `TL-NNN` codes restart per tenant, so a foreign tenant's reference can block a delete. The fix mirrors `ClmQcController`: add `->where('client_id', $clientId)` to both lookups.
4. **`authority` is 255 characters**, unlike KYC/DD's 2,000 — a licence with many issuing bodies can silently hit the validation ceiling.
5. `doc_selections` matching is a raw JSON substring test — portable, not structural.
6. Deletes are hard; `client_id` cascades from `clients`.
7. `store()`/`update()` mix two error styles (hand-built 422 for name clashes, thrown `ValidationException` for authority) — both land as 422 with an `errors` map, so clients can treat them uniformly.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmTradeLicenseController`, ~210 lines) |
| Table | 1 |
| Endpoints | 4 (+2 read-through via segment-rules) |
| Referencing tables | 2 |
| Permission slug | `clm.trade_licenses` |
| Code prefix | `TL-NNN` (branch-scoped) |
| Vault category | `tl` |
| Test coverage | none automated |

---

*Related documents: TRADE_LICENSES_FUNCTIONAL_DOCUMENTATION.md · TRADE_LICENSES_CODE_WALKTHROUGH.md · TRADE_LICENSES_API_DOCUMENTATION.md*

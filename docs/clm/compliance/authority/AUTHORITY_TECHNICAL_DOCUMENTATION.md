# AUTHORITY — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Authority**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A one-table master (`clm_authorities`) plus **the id↔name bridge for the whole CLM**. The `ClmAuthority` model carries five static helpers that every document-master controller calls; they are the single source of truth for converting between the stored id list and the human-readable names.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│  CLIENT                                                            │
│  pages/clm/compliance/ClmAuthorityPage.tsx  (list + modal)         │
│  pages/clm/compliance/AuthorityBadges.tsx   (chips + "+N" popover) │
└──────────────────────────────┬────────────────────────────────────┘
                                │ /api/clm/authorities
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmAuthorityController                              │
│    index()   scoped list + in_use (id ∪ name ∪ code sets)          │
│    store()   dupe → nextCode(AUTH-) → create                       │
│    update()  denial → dupe → update → cascadeRename() (txn)        │
│    destroy() authorityUsage() → 409 | delete                       │
└──────────────────────────────┬────────────────────────────────────┘
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  MODEL BRIDGE — App\Models\ClmAuthority (static helpers)           │
│    idNameMap($clientId)        "12" => "FSSAI"                     │
│    displayNames($stored,$map)  "12, 4" → "FSSAI, DGFT"             │
│    displayNamesList(...)       → ["FSSAI","DGFT"]   (comma-safe)   │
│    normalizeIds($input,$cid)   names|ids → canonical "4, 12"       │
│    storedContainsId($stored,$id)                                   │
└──────────────────────────────┬────────────────────────────────────┘
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  DATA — clm_authorities                                            │
│  Read by (id):   clm_kyc_documents · clm_dd_documents ·            │
│                  clm_trade_licenses · clm_qc_documents             │
│  Read by (name): vendor_documents · customer_documents ·           │
│                  vendor_owners                                     │
│  Read by (code): clm_segment_rules.auths_json                      │
└───────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmAuthorityController.php
app/Models/ClmAuthority.php                     ← the shared helpers live here
database/migrations/2026_05_22_000020_create_clm_authorities_table.php
                    2026_06_17_000000_convert_clm_doc_authority_to_ids.php
                    2026_07_06_000001_add_branch_id_to_clm_compliance_masters.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmAuthorityPage.tsx
resources/js/pages/clm/compliance/AuthorityBadges.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell |

---

## 3. DATABASE SCHEMA — `clm_authorities`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | **This is what documents store** |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `AUTH-NNN`, per branch |
| `name` | varchar(255) | |
| `description` | varchar(500) | required at the controller |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)`, `INDEX(client_id, status)`.

### 3.1 How consumers store the reference
```
clm_kyc_documents.authority   varchar(2000)   "4, 12, 19"      ← comma-joined IDS
clm_qc_documents.issued_by    varchar(255)    "7"
clm_segment_rules.auths_json  json            ["AUTH-001","AUTH-004"]   ← CODES
vendor_documents.issuing_authority  varchar   "FSSAI"          ← legacy NAME
```
`clm_dd_documents.authority` and `clm_kyc_documents.authority` were widened to 2000 chars (2026-06-06) precisely because a document may name many authorities.

---

## 4. MODEL — `App\Models\ClmAuthority`

```php
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive'; STATUSES=[…]
fillable: client_id, branch_id, code, name, description, status, created_by, updated_by

static idNameMap(?int $clientId): array
    // ["12" => "FSSAI", "4" => "DGFT"] for one tenant

static displayNames(?string $stored, array $idToName): string
    // "12, 4" → "FSSAI, DGFT";  UNKNOWN tokens pass through unchanged

static displayNamesList(?string $stored, array $idToName): array
    // same, but ARRAY — REQUIRED wherever the consumer counts or iterates,
    // because an authority NAME may itself contain commas and re-splitting
    // the joined string would over-count

static normalizeIds(?string $input, ?int $clientId): string
    // accepts ids AND names (case-insensitive), de-duplicates, drops unknowns,
    // returns the canonical comma-joined ID list; '' when nothing resolved

static storedContainsId(?string $stored, int $id): bool
    // exact TOKEN match — "1" must not match "12"
```

`displayNamesList()` exists as a distinct method for exactly one reason: authority names legitimately contain commas (e.g. `"Aadhaar, Passport, Voter ID, Driving License"`). Any consumer that splits the joined display string will over-count that single authority as four.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/authorities',      [ClmAuthorityController::class, 'index']);
    Route::post  ('/clm/authorities',      [ClmAuthorityController::class, 'store']);
    Route::put   ('/clm/authorities/{id}', [ClmAuthorityController::class, 'update']);
    Route::delete('/clm/authorities/{id}', [ClmAuthorityController::class, 'destroy']);
});
```
Full detail in **AUTHORITY_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
Scoped list ordered `id ASC`, then three **set** lookups computed once for the whole page:

| Helper | Builds |
|---|---|
| `usedIdSet($clientId)` | every id token appearing in the four CLM id-columns |
| `usedNameSet($clientId)` | every lower-cased name in the three legacy name-columns |
| `usedCodeSet($clientId)` | every code inside `clm_segment_rules.auths_json` |

A row is `in_use` if its id, its lower-cased name, **or** its code hits any set. Note this drives the *delete* lock only — editing is intentionally unrestricted.

### `store()` / `update()`
Standard scoped dupe check + `hierarchicalDenial`. `update()` runs inside a transaction so the row update and the legacy-table rewrite either both land or neither does:
```php
DB::transaction(function () use ($row,$data,$oldName) {
    $row->update($data);
    if (name changed) $this->cascadeRename((int)$row->client_id, $oldName, $data['name']);
});
```

### `cascadeRename($clientId, $old, $new)`
Loops `nameUsageTables()` and issues one `UPDATE … SET issuing_authority = :new WHERE issuing_authority = :old` per table, adding `client_id` to the predicate when the column exists. CLM masters need no update — they store the id.

### `destroy()`
Calls `authorityUsage()`, which is a *per-row* version of the three set builders:
- id tables: `WHERE col LIKE '%{$id}%'` as a cheap pre-filter, then `storedContainsId()` in PHP for an exact token match (so `1` never matches `12`).
- name tables: exact equality, scoped by `client_id` when present.
- `auths_json`: `LIKE '%"AUTH-004"%'` — a substring match that stays portable across MySQL / Postgres / SQLite.

Returns **409 + `used_in[]`** or hard-deletes.

### `nextCode($clientId, $branchId)`
Client row lock → `MAX(/^AUTH-(\d+)$/) + 1` → skip any taken code. Branch-scoped.

---

## 7. FRONTEND

- **`ClmAuthorityPage.tsx`** — list + search + Add/Edit modal; delete disabled with a tooltip when `in_use`.
- **`AuthorityBadges.tsx`** — the shared chip renderer used by the KYC / DD / QC / Trade Licence lists and the Document Control Panel. It consumes `authority_list` (array) and renders the first name plus a `+N` popover, which is why every list endpoint ships both the array and the joined string.

---

## 8. INTEGRATIONS

| Consumer | Reads |
|---|---|
| KYC / DD / Trade Licence controllers | `normalizeIds()` on write, `idNameMap()` + `displayNames()` on read |
| QC controller | same, on the `issued_by` column |
| DCP `bootstrap()` / `forSegment()` | resolves `authority` → `authority` (string) **and** `authority_list` (array) for every document row |
| Legacy party documents | store the name; kept in sync by `cascadeRename()` |

---

## 9. SECURITY & CAVEATS

1. `client_id` is derived from the authenticated user; `idNameMap()` and `normalizeIds()` are always tenant-scoped.
2. `storedContainsId()` guards against substring false-positives on numeric ids.
3. The `LIKE '%{$id}%'` pre-filter in `authorityUsage()` is a **performance** filter only — correctness comes from the PHP token check that follows.
4. `auths_json` matching is a raw substring test; an authority code appearing inside another string would be a false positive (codes are `AUTH-NNN`, so this is not reachable in practice).
5. `nameUsageTables()` is a hard-coded list — a new name-storing table must be registered there or renames will drift.
6. Deletes are hard; `client_id` cascades from `clients`.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmAuthorityController`, ~335 lines) |
| Table | 1 |
| Endpoints | 4 |
| Consumer tables | 8 (4 by id, 3 by name, 1 by code) |
| Model helpers | 5 static |
| Permission slug | `clm.authority` |
| Code prefix | `AUTH-NNN` (branch-scoped) |
| Test coverage | none automated |

---

*Related documents: AUTHORITY_FUNCTIONAL_DOCUMENTATION.md · AUTHORITY_CODE_WALKTHROUGH.md · AUTHORITY_API_DOCUMENTATION.md*

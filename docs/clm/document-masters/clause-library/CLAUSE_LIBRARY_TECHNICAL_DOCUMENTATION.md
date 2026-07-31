# CLAUSE LIBRARY — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Clause Library**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Two tables (`clm_clause_types`, `clm_clause_library`) behind `ClmClauseController`. The interesting part is not the CRUD but the **two different usage-detection strategies**:

- **Clause type → clause**: a grouped `COUNT(*)` over `LOWER(clause_type)`, because the library stores the type by name.
- **Clause → document**: a **text search** across every `ctc_contracts.content` and every entry in its `versions` JSON, looking for the `<h3>Name</h3>` heading the insert panel writes. There is no referential link, because clauses are copied into documents rather than referenced.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/document-masters/                                          │
│    ClmClauseLibraryPage.tsx    (Types + Library tabs)                 │
│    ClmClauseInsertPanel.tsx    ← mounted INSIDE the agreement,        │
│                                  trade-document and CTC editors       │
│                                  writes <h3>Name</h3> + content       │
└──────────────────────────────┬───────────────────────────────────────┘
                                │ /api/clm/clause-types · clause-library
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmClauseController                                    │
│   TYPES    typesIndex (+in_use COUNT) · typesStore (409 dupe) ·       │
│            typesUpdate (409 while in use) · typesDestroy (no guard)   │
│   LIBRARY  libraryIndex (+in_use via CTC text search) · libraryStore ·│
│            libraryUpdate · libraryDestroy (409 when found in a CTC)   │
│   HELPERS  ctcHaystacks() · clauseNeedle()                            │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA                                                                 │
│   clm_clause_types    ← linked BY NAME from the library               │
│   clm_clause_library  ← COPIED (not linked) into document bodies      │
│   ctc_contracts       ← searched for <h3>Name</h3> in `content`       │
│                          and every `versions[].content`               │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmClauseController.php
app/Models/ClmClauseType.php · ClmClauseLibrary.php
app/Models/CtcContract.php                     ← the haystack for usage detection
database/migrations/2026_05_22_000130_create_clm_clause_types_table.php
                    2026_05_22_000140_create_clm_clause_library_table.php
                    2026_05_23_000010_make_clm_clause_columns_nullable.php
                    2026_07_04_000030_add_branch_id_to_clm_clause_tables.php
                    2026_07_09_000020_branch_scope_clm_master_code_unique_rest.php
resources/js/pages/clm/document-masters/ClmClauseLibraryPage.tsx
resources/js/pages/clm/document-masters/ClmClauseInsertPanel.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · contentEditable rich text · shared CLM page shell |

---

## 3. DATABASE SCHEMA

### 3.1 `clm_clause_types`
`id · client_id (FK cascade) · branch_id (nullable) · code (CLT-NNN) · name · description · status · created_by · updated_by · timestamps`, `UNIQUE(client_id, branch_id, code)`.

### 3.2 `clm_clause_library`
| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` · `branch_id` | | |
| `code` | varchar(16) | `CL-NNN` |
| `clause_type` | varchar(255) | **the type name** — links to `clm_clause_types.name`, no FK |
| `name` | varchar(255) | the clause title; also the search needle |
| `party` | varchar(255) | optional (nullable since 2026-05-23) |
| `clause_status` | varchar(32) | `Active` by default |
| `content` | text | the clause paragraph |
| `status` · `created_by` · `updated_by` · timestamps | | |

`UNIQUE(client_id, branch_id, code)`. `2026_05_23_000010_make_clm_clause_columns_nullable` relaxed the originally-required columns after the modals were redesigned.

---

## 4. MODELS

```php
// ClmClauseType
fillable: client_id, branch_id, code, name, description, status, created_by, updated_by

// ClmClauseLibrary  (protected $table = 'clm_clause_library')
fillable: client_id, branch_id, code, clause_type, name, party,
          clause_status, content, status, created_by, updated_by
```
No casts. `in_use` is derived at read time on both tabs.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/clause-types',      [ClmClauseController::class,'typesIndex']);
    Route::post  ('/clm/clause-types',      [… 'typesStore']);
    Route::put   ('/clm/clause-types/{id}', [… 'typesUpdate']);
    Route::delete('/clm/clause-types/{id}', [… 'typesDestroy']);

    Route::get   ('/clm/clause-library',      [… 'libraryIndex']);
    Route::post  ('/clm/clause-library',      [… 'libraryStore']);
    Route::put   ('/clm/clause-library/{id}', [… 'libraryUpdate']);
    Route::delete('/clm/clause-library/{id}', [… 'libraryDestroy']);
});
```
Full detail in **CLAUSE_LIBRARY_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### Types tab
- **`typesIndex()`** — scoped list plus a usage map:
  ```php
  $usage = ClmClauseLibrary::query()                    // scoped the SAME way, so a branch
      ->selectRaw('LOWER(clause_type) as t, COUNT(*) as c')   // only counts rows it can see
      ->groupBy(DB::raw('LOWER(clause_type)'))->pluck('c','t');
  $row->in_use = (int) ($usage[mb_strtolower($row->name)] ?? 0);
  ```
- **`typesStore()`** — `description` is no longer required (the redesigned modal collects only the name); a scope-relative duplicate returns **409**.
- **`typesUpdate()`** — `hierarchicalDenial` → **409 while `in_use > 0`** ("used by N clauses… Remove or reassign those clauses first") → validate → rename-clash check → update.
- **`typesDestroy()`** — `hierarchicalDenial` then delete. **No in-use guard** — an asymmetry with `typesUpdate()`.

### Library tab
- **`libraryIndex()`** — scoped list plus the **best-effort CTC usage flag**:
  ```php
  $haystacks = $this->ctcHaystacks($clientId);      // one query, all contracts
  $needle    = $this->clauseNeedle($row->name);     // '<h3>escaped name</h3>', lower-cased
  $row->in_use = any haystack contains the needle ? 1 : 0;
  ```
- **`libraryStore()`** — `party` is optional now; a scope-relative duplicate name returns **409**; `CL-NNN` allocated under the client row lock.
- **`libraryUpdate()`** — `hierarchicalDenial` → validate → rename-clash check → update. **No in-use edit lock** (only delete is guarded).
- **`libraryDestroy()`** — `hierarchicalDenial` → re-runs the needle search → **409** if found → delete.

### The two helpers
```php
/** Lower-cased content of every CTC contract (current draft + each version), used to
 *  detect whether a library clause has been inserted into any CTC. */
private function ctcHaystacks(int $clientId): array
{
    return CtcContract::where('client_id',$clientId)->get(['content','versions'])
        ->map(function ($c) {
            $parts = [(string)$c->content];
            foreach ((array)($c->versions ?? []) as $v) $parts[] = (string)($v['content'] ?? '');
            return mb_strtolower(implode("\n", $parts));
        })->all();
}

/** The heading a clause is inserted with — `<h3>Name</h3>`, lower-cased. */
private function clauseNeedle(string $name): string
{
    $name = trim($name);
    return $name === '' ? '' : mb_strtolower('<h3>' . e($name) . '</h3>');
}
```
`e()` matters: the insert panel HTML-escapes the name, so a clause called `Force Majeure & Acts of God` is written as `<h3>Force Majeure &amp; Acts of God</h3>` and the needle must match that.

### `nextCode()`
Branch-scoped MAX+1 with skip-taken under the client row lock; prefix `CLT` or `CL` (note the prefix is passed **without** the trailing hyphen here — the format string adds `-%03d`).

---

## 7. FRONTEND

| Component | Role |
|---|---|
| `ClmClauseLibraryPage.tsx` | Two-tab list; `in_use` disables Edit on types and Delete on clauses |
| `ClmClauseInsertPanel.tsx` | The insert widget mounted inside the agreement, trade-document and CTC editors. It writes `<h3>Name</h3>` followed by the clause content into the document body — the exact shape the usage detection looks for |

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| **Agreements** (`clm_agreement_library.content`) | Clauses inserted as copies |
| **Trade Documents** (`clm_trade_doc_library.content`) | Clauses inserted as copies |
| **Case-to-Case** (`ctc_contracts.content` + `versions[]`) | Clauses inserted as copies — and the **only** place searched for usage |
| Clause types | Referenced by name from `clm_clause_library.clause_type` |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; every list and dupe check is `MasterVisibility`-scoped.
2. **Usage detection is a text search, not referential integrity** — it covers CTC contracts only, and a renamed clause stops matching its earlier insertions.
3. `ctcHaystacks()` loads **every** CTC contract's content and all versions into memory on each `libraryIndex()` and `libraryDestroy()` call. On a tenant with many long contracts this is the heaviest operation in the module.
4. `typesUpdate()`'s in-use count and `typesUpdate()`'s rename-clash check use a **client-wide** `where('client_id', …)` rather than `applyReadScope`, so they are stricter than the scope-relative checks used at create time.
5. `typesDestroy()` has **no** in-use guard, unlike `typesUpdate()`.
6. `libraryUpdate()`'s rename-clash check is likewise client-wide.
7. Deletes are hard on both tabs.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmClauseController`, ~336 lines) |
| Tables | 2 (+ `ctc_contracts` read for usage) |
| Endpoints | 8 |
| Code prefixes | `CLT-NNN` · `CL-NNN` (both branch-scoped) |
| Permission slug | `clm.clause_library` |
| Usage detection | text search over CTC `content` + `versions[]` |
| Test coverage | none automated |

---

*Related documents: CLAUSE_LIBRARY_FUNCTIONAL_DOCUMENTATION.md · CLAUSE_LIBRARY_CODE_WALKTHROUGH.md · CLAUSE_LIBRARY_API_DOCUMENTATION.md*

# TERMS & CONDITIONS — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Terms & Conditions**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Two tables (`clm_tnc_categories`, `clm_tnc_library`) behind `ClmTncController`. It is the smallest of the four document-master controllers, and its only real logic is the **set-overlap uniqueness rule** and the **note-category blanking** — both of which exist because of how the frontend and Laravel's middleware interact.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                             │
│  pages/clm/document-masters/                                        │
│    ClmTncPage.tsx           (Categories + Library tabs)             │
│    ClmTncWizardModal.tsx    (category → segments → content)         │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ /api/clm/tnc-categories · tnc-library
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmTncController                                     │
│   CATEGORIES  categoriesIndex/Store/Update/Destroy   (DC-NNN)       │
│   LIBRARY     libraryIndex/Store/Update/Destroy      (TNC-NNN)      │
│   GUARDS      isNoteCategory() · findDuplicate() · segmentTokens()  │
└──────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA                                                               │
│   clm_tnc_categories   ← client_id NULLABLE (the 4 standard         │
│                          categories are GLOBAL, seeded by migration)│
│   clm_tnc_library      ← linked to a category BY NAME               │
│                          segment stored as a CSV of segment NAMES   │
│   CONSUMED BY: Quotation / PI / PO / Debit-Credit Note PDFs         │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmTncController.php
app/Models/ClmTncCategory.php · ClmTncLibrary.php
database/migrations/2026_05_22_000090_create_clm_tnc_categories_table.php
                    2026_05_22_000100_create_clm_tnc_library_table.php
                    2026_06_02_000200_add_regulatory_and_widen_segment_on_clm_tnc_library.php
                    2026_06_10_000001_make_clm_tnc_categories_client_id_nullable.php
                    2026_07_04_000020_add_branch_id_to_clm_tnc_tables.php
                    2026_07_07_000001_seed_clm_tnc_purchase_order_categories.php
                    2026_07_13_000001_seed_clm_tnc_debit_credit_note_categories.php
                    2026_07_09_000020_branch_scope_clm_master_code_unique_rest.php
resources/js/pages/clm/document-masters/ClmTncPage.tsx · ClmTncWizardModal.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · rich-text content editor |

---

## 3. DATABASE SCHEMA

### 3.1 `clm_tnc_categories`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | **nullable** FK | **NULL ⇒ a GLOBAL category visible to every tenant** (made nullable 2026-06-10) |
| `branch_id` | bigint nullable | |
| `code` | varchar(16) | `DC-NNN`, per branch |
| `short_code` | varchar(12) | upper-cased on save |
| `name` | varchar(255) | Quotation, Proforma Invoice, Purchase Order, Debit Note, Credit Note |
| `status` · `created_by` · `updated_by` · timestamps | | |

Seeded globals arrive via `2026_07_07_000001_seed_clm_tnc_purchase_order_categories` and `2026_07_13_000001_seed_clm_tnc_debit_credit_note_categories`.

### 3.2 `clm_tnc_library`
| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` · `branch_id` | | |
| `code` | varchar(16) | `TNC-NNN` |
| `segment` | varchar(1024) | **CSV of segment names** (widened 2026-06-02); `''` for note categories |
| `regulatory` | varchar(16) | `highly` \| `less`; `''` for note categories (added 2026-06-02) |
| `category` | varchar(255) | **the category name** — links to `clm_tnc_categories.name` |
| `party` | varchar(255) | `''` for note categories |
| `content` | text | the terms block |
| `status` · `created_by` · `updated_by` · timestamps | | |

`UNIQUE(client_id, branch_id, code)`. The (segment, category) uniqueness rule is **application-level only** — there is no DB constraint for it, because segment is a set.

---

## 4. MODELS

```php
// ClmTncCategory
fillable: client_id, branch_id, code, short_code, name, status, created_by, updated_by
// client_id may be NULL → a global category

// ClmTncLibrary  (protected $table = 'clm_tnc_library')
fillable: client_id, branch_id, code, segment, regulatory, category, party,
          content, status, created_by, updated_by
```
No casts; `segment` is handled as a raw CSV string and tokenised in the controller.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/tnc-categories',      [ClmTncController::class,'categoriesIndex']);
    Route::post  ('/clm/tnc-categories',      [… 'categoriesStore']);
    Route::put   ('/clm/tnc-categories/{id}', [… 'categoriesUpdate']);
    Route::delete('/clm/tnc-categories/{id}', [… 'categoriesDestroy']);

    Route::get   ('/clm/tnc-library',      [… 'libraryIndex']);
    Route::post  ('/clm/tnc-library',      [… 'libraryStore']);
    Route::put   ('/clm/tnc-library/{id}', [… 'libraryUpdate']);
    Route::delete('/clm/tnc-library/{id}', [… 'libraryDestroy']);
});
```
Full detail in **TERMS_CONDITIONS_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### Categories
- **`categoriesIndex()`** — `MasterVisibility::applyReadScope` naturally merges the globals: its client-tier branch is `whereNull('client_id') OR client_id = X`, so the seeded `client_id NULL` rows always appear alongside the tenant's own.
- **`categoriesStore()`** — locks the `clients` row, allocates `DC-NNN`, upper-cases `short_code`.
- **`categoriesUpdate()` / `categoriesDestroy()`** — scoped `firstOrFail` + `hierarchicalDenial`. **No in-use guard** — a category can be deleted while library rows reference its name.

### Library
- **`libraryIndex()`** — scoped list ordered `id ASC`; empty payload for a user with no `client_id`.
- **`libraryStore()`**
  1. Validates `segment` (≤1024), `regulatory` (≤16), `category` (required), `party`, `content` — all nullable except `category`, because note documents carry none of them.
  2. `isNoteCategory()` → forces `segment`, `regulatory`, `party` to `''`.
  3. `findDuplicate()` → **422** on segment-set overlap.
  4. Locks the `clients` row, allocates `TNC-NNN`, applies the `?? 'General'` / `?? 'highly'` fallbacks (which `''` deliberately survives, since `??` only catches `null`).
- **`libraryUpdate()`** — same guards, re-running the uniqueness check against the row's **own** branch and excluding itself, falling back to the stored `category` / `segment` for whichever the partial update omits.
- **`libraryDestroy()`** — scoped + `hierarchicalDenial`, then delete.

### The three helpers
```php
isNoteCategory(?string $name): bool
    in_array(mb_strtolower(trim($name)), ['debit note','credit note'], true);

segmentTokens(?string $csv): array
    unique, non-empty, lower-cased, trimmed CSV parts;

findDuplicate($clientId, $branchId, $category, $segmentCsv, $ignoreId = null): ?ClmTncLibrary
    // skip when the category is blank or a note category
    // compare LOWER(TRIM(category)) within the SAME branch
    // → any array_intersect() of the two token sets is a duplicate
```

### `nextCode()`
Branch-scoped MAX+1 with skip-taken; prefix `DC-` or `TNC-`.

---

## 7. FRONTEND

| Component | Role |
|---|---|
| `ClmTncPage.tsx` | Two-tab list; renders "—" where note-category rows have blank segment / regulatory / party |
| `ClmTncWizardModal.tsx` | Category → segment multi-select → rich-text content; hides the segment/regulatory/party step entirely for note categories |

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| Quotation PDF | Terms block resolved by (segment, `Quotation`) |
| Proforma Invoice PDF | Terms block resolved by (segment, `Proforma Invoice`) |
| Purchase Order PDF | Terms block resolved by (segment, `Purchase Order`) |
| Debit / Credit Note PDFs | Single unscoped entry per note type |
| Segment master | `clm_tnc_library.segment` is one of the **name-based** reference tables the segment master checks before allowing a rename or delete |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; globals (`client_id` NULL) are readable by everyone by design.
2. **Note-category detection is by literal name** (`'debit note'`, `'credit note'`) — renaming those categories silently disables the special handling.
3. Blanking uses **empty strings, not nulls**, specifically to survive `ConvertEmptyStringsToNull` + the `??` fallbacks. Changing either half breaks the other.
4. The uniqueness rule is enforced **in PHP**, not by a DB constraint — concurrent saves could theoretically both pass (the client row lock is taken only for code allocation, after the check).
5. There is **no in-use guard on categories**, unlike agreement types and trade-document names.
6. `segment` is a CSV of names, not ids — string-matched and not cascaded on rename.
7. Deletes are hard on both tabs.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmTncController`, ~300 lines) |
| Tables | 2 |
| Endpoints | 8 |
| Code prefixes | `DC-NNN` · `TNC-NNN` (both branch-scoped) |
| Global rows | 5 seeded categories (`client_id` NULL) |
| Permission slug | `clm.terms_conditions` |
| Uniqueness | application-level set overlap, per branch |
| Test coverage | none automated |

---

*Related documents: TERMS_CONDITIONS_FUNCTIONAL_DOCUMENTATION.md · TERMS_CONDITIONS_CODE_WALKTHROUGH.md · TERMS_CONDITIONS_API_DOCUMENTATION.md*

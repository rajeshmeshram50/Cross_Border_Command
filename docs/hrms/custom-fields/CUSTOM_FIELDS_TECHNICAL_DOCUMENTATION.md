# CUSTOM FIELDS MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Custom Fields (tenant-defined document variables)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Custom Fields defines **tenant-specific `{{FieldName}}` variables** that HR Document Templates can reference — values that are *not* in the employee data set (so the operator fills them at document-generation time). It is a **definition-only** module: there is **no value/assignment table**; custom-field values are entered per employee when generating a document and merged into the DOCX; they are never persisted here. "Used in" is derived on read by scanning template HTML.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrCustomFields.tsx (define fields) ── used by ──▶ TemplateEditor,     │
│    GenerateDocument, DocGenerateModal (as {{placeholders}})           │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  HrCustomFieldController: index/show/stats/knownTokens/validateTokens/ │
│    store/update/destroy  (permission hr.custom_fields)               │
│  usage derived by scanning hr_document_templates.content_html         │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  hr_custom_fields (definitions only; no values, no soft deletes,       │
│    no DB FKs; unique (client_id, branch_id, name))                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/HrCustomFieldController.php
app/Models/HrCustomField.php
database/migrations/
  2026_05_14_120000_create_hr_custom_fields_table.php
  2026_05_14_130000_add_used_in_hint_to_hr_custom_fields.php
  2026_05_14_120001_seed_hr_custom_fields_module.php
resources/js/pages/hrms/HrCustomFields.tsx
  (+ doc-templates/CustomFieldModal.tsx, TemplateEditor.tsx, GenerateDocument.tsx)
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) |

---

## 3. DATABASE SCHEMA

### 3.1 `hr_custom_fields` (no SoftDeletes; no DB FKs)
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| client_id / branch_id | bigint nullable, indexed | tenant (NULL = global) |
| name | varchar(100) | becomes `{{name}}` (PascalCase identifier) |
| type | **enum(text, date, number, textarea)** default text | |
| description | varchar(500) nullable | |
| used_in_hint | varchar(500) nullable | free-text intent |
| created_by | bigint nullable | |

**Unique** `(client_id, branch_id, name)`. No `options` column (no select type). No value table.

---

## 4. MODEL (`app/Models/HrCustomField.php`)
```php
class HrCustomField extends Model {   // no SoftDeletes, no casts, no $hidden
    protected $table = 'hr_custom_fields';
    protected $fillable = ['client_id','branch_id','name','type','description','used_in_hint','created_by'];
    public function client(); public function branch(); public function creator();  // belongsTo
}
```
No value/assignment model exists anywhere.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/hr-custom-fields/stats',           [HrCustomFieldController::class, 'stats']);
    Route::get ('/hr-custom-fields/known-tokens',    [HrCustomFieldController::class, 'knownTokens']);
    Route::post('/hr-custom-fields/validate-tokens', [HrCustomFieldController::class, 'validateTokens']);
    Route::apiResource('hr-custom-fields', HrCustomFieldController::class)->parameters(['hr-custom-fields' => 'id']);
});
```
The three custom routes precede `apiResource` to avoid `{id}` shadowing. Full detail in **CUSTOM_FIELDS_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

**Permission slug `hr.custom_fields`** (view/add/edit/delete). Super-admin bypass; unseeded-module fallback allows client_admin/branch_user. Types: `text, date, number, textarea` (validated `Rule::in`).

| Method | Purpose |
|---|---|
| `index` | List (search name/description, type filter) with derived `used_in` / `used_count` |
| `show` | Single field + usage |
| `stats` | KPI counts by type (`{total,text,date,number,textarea,other}`) |
| `knownTokens` | Full token catalogue for the editor: `{employee:[built-ins], custom_fields:[{name,token,type}]}` |
| `validateTokens` | Split `{{Token}}` in HTML into known vs unknown |
| `store` | Create (transaction; unique-name check; PascalCase regex) |
| `update` | Update (hierarchy guard) |
| `destroy` | Delete — **blocked (422) if the field is referenced by any template** |

**Usage derivation** (`computeUsage`): scans in-scope `hr_document_templates.content_html` (strip tags + entity decode) for `{{name}}` (tolerant of whitespace/markup). Never stored. **Name validation:** `^[A-Za-z_][A-Za-z0-9_]*$` (no spaces).

---

## 7. FRONTEND

- **`HrCustomFields.tsx`** — KPI strip (Total/Text/Date/Number/Textarea), searchable table (Field Name, `{{name}}` chip, Type, Description, **Used In** (real scan or hint), Actions). `CustomFieldModal` form: Field Name (PascalCase, unique), Input Type (Text/Date/Number/Textarea — no options/entity), Description, Used-in hint. Deep-link `?new=Name` opens the Add modal prefilled (from the template editor's unknown-token CTA).
- **Integration** — `TemplateEditor` loads `known-tokens` for the placeholder sidebar and offers "Add as custom field" for unknown tokens; `GenerateDocument`/`DocGenerateModal` scan the template for custom-field tokens and render a per-employee input for each, sent transiently at generation time.

---

## 8. SECURITY & CAVEATS
1. **Definition-only** — no values are persisted; `used_in`/`used_count` are computed on every read.
2. **No `select`/dropdown type, no `options`** — only text/date/number/textarea end-to-end.
3. **No DB FKs, no soft deletes**; deletion hard but guarded (422) if a template references the field.
4. **Unique `(client_id, branch_id, name)`** — same field can exist per branch; names are case-insensitive-unique per scope.
5. Custom fields resolve from **manual input** at generation; built-in employee tokens resolve from the record.

---

## 9. METRICS
| Metric | Value |
|---|---|
| Controller methods | 7 |
| Field types | 4 |
| Tables | 1 (definitions) |
| DB FKs / soft deletes / value table | none |
| Test coverage | none automated |

---

*Related documents: CUSTOM_FIELDS_FUNCTIONAL_DOCUMENTATION.md · CUSTOM_FIELDS_CODE_WALKTHROUGH.md · CUSTOM_FIELDS_API_DOCUMENTATION.md*

# TERMS & CONDITIONS — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Terms & Conditions**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.terms_conditions` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on GETs.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message, errors? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · **422** (validation, duplicate segment+category).

---

## 2. ENDPOINT INDEX

### Document categories
| Method | Path |
|---|---|
| GET · POST | `/clm/tnc-categories` |
| PUT · DELETE | `/clm/tnc-categories/{id}` |

### T&C library
| Method | Path |
|---|---|
| GET · POST | `/clm/tnc-library` |
| PUT · DELETE | `/clm/tnc-library/{id}` |

---

## 3. GET `/clm/tnc-categories`

Returns the **globals merged with your own rows** — the standard categories ship with `client_id: null` and are visible to every tenant.

**200**
```json
{
  "status": true,
  "data": [
    { "id": 1, "client_id": null, "branch_id": null,
      "code": "DC-001", "short_code": "QTN", "name": "Quotation", "status": "active" },
    { "id": 2, "client_id": null, "branch_id": null,
      "code": "DC-002", "short_code": "PI",  "name": "Proforma Invoice", "status": "active" },
    { "id": 3, "client_id": null, "branch_id": null,
      "code": "DC-003", "short_code": "PO",  "name": "Purchase Order", "status": "active" },
    { "id": 4, "client_id": null, "branch_id": null,
      "code": "DC-004", "short_code": "DN",  "name": "Debit Note", "status": "active" },
    { "id": 5, "client_id": null, "branch_id": null,
      "code": "DC-005", "short_code": "CN",  "name": "Credit Note", "status": "active" },
    { "id": 18, "client_id": 3, "branch_id": 2,
      "code": "DC-001", "short_code": "SLA", "name": "Service Agreement", "status": "active" }
  ],
  "count": 6
}
```

> Note the duplicate `DC-001`: codes are sequenced **per branch**, so a tenant's first custom category is `DC-001` even though a global `DC-001` exists. They are distinguished by `client_id` / `branch_id`.

---

## 4. POST `/clm/tnc-categories`

```json
{ "short_code": "SLA", "name": "Service Agreement" }
```

| Field | Rule |
|---|---|
| `short_code` | required · string · max 12 · **upper-cased on save** |
| `name` | required · string · max 255 |

**201** → `{ status:true, data: { …row…, "code": "DC-002", "short_code": "SLA" } }`
**403** → `{ "status": false, "message": "No tenant context" }`

### PUT `/clm/tnc-categories/{id}`
Same fields, `sometimes|required`. **403** on `hierarchicalDenial` (and on any attempt to mutate a global row — a client user's tier does not exceed a super-admin-owned row).

### DELETE `/clm/tnc-categories/{id}`
**200** → `{ status:true, message:"Deleted" }`

> **No in-use guard.** Unlike agreement types and trade-document names, a category can be deleted while library entries still reference its name.

---

## 5. GET `/clm/tnc-library`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 44, "client_id": 3, "branch_id": 2,
      "code": "TNC-006",
      "segment": "Rice, Wheat",
      "regulatory": "less",
      "category": "Quotation",
      "party": "Buyer",
      "content": "<p>1. Prices are valid for 30 days…</p>",
      "status": "active" },

    { "id": 47, "client_id": 3, "branch_id": 2,
      "code": "TNC-009",
      "segment": "",
      "regulatory": "",
      "category": "Debit Note",
      "party": "",
      "content": "<p>This debit note is raised under…</p>",
      "status": "active" }
  ],
  "count": 9
}
```

The second row shows the **note-category shape**: `segment`, `regulatory` and `party` are empty strings (rendered as "—" in the UI). They are empty strings, not nulls, because the columns are NOT NULL and because `null` would be backfilled by the server's defaults.

Ordering is `id ASC`. A user with no `client_id` gets `{ data: [], count: 0 }`.

---

## 6. POST `/clm/tnc-library`

```json
{ "category": "Quotation",
  "segment": "Rice, Wheat",
  "regulatory": "less",
  "party": "Buyer",
  "content": "<p>1. Prices are valid for 30 days…</p>" }
```

| Field | Rule | Default |
|---|---|---|
| `category` | **required** · string · max 255 · the category **name** | — |
| `segment` | optional · string · max 1024 · **CSV of segment names** | `General` |
| `regulatory` | optional · string · max 16 (`highly` \| `less`) | `highly` |
| `party` | optional · string · max 255 | `''` |
| `content` | optional · the terms HTML | null |

**201** → `{ status:true, data: { …row…, "code": "TNC-010" } }`

### Debit Note / Credit Note
When `category` is (case-insensitively) `"Debit Note"` or `"Credit Note"`, the server **forces `segment`, `regulatory` and `party` to empty strings**, whatever was sent:
```json
POST { "category": "Credit Note", "segment": "Rice", "party": "Buyer", "content": "…" }
→ 201  { "segment": "", "regulatory": "", "party": "", "category": "Credit Note", … }
```
These entries are also **exempt from the uniqueness rule**.

### 422 — duplicate (segment, category)
```json
{ "status": false,
  "message": "A Terms & Conditions entry already exists for this segment and document category (TNC-006).",
  "errors": { "category": ["This segment already has a \"Quotation\" entry."] } }
```

**The rule:** one entry per (segment, category) **within a branch**. Because `segment` is a CSV, the check compares **sets** — any overlap is a duplicate.

| Existing | Incoming | Result |
|---|---|---|
| `Quotation` / `"Rice, Wheat"` | `Quotation` / `"Wheat, Barley"` | **422** — `Wheat` overlaps |
| `Quotation` / `"Rice"` | `Quotation` / `"Barley"` | 201 — disjoint |
| `Quotation` / `"Rice"` | `Proforma Invoice` / `"Rice"` | 201 — different category |
| `Debit Note` / `""` | `Debit Note` / `""` | 201 — notes are exempt |

Sibling branches are checked independently, so each branch may hold its own entry for the same combination.

---

## 7. PUT `/clm/tnc-library/{id}`

Same fields, all optional.

**200** → `{ status:true, data: { …fresh row… } }`

Partial updates are handled carefully:
- The note-blanking check falls back to the row's **current** `category` when `category` is omitted.
- The uniqueness check runs against the **row's own** `client_id` / `branch_id` (not the caller's), excludes the row itself, and falls back to the stored `category` / `segment` for whichever field the request omits.

**422 — duplicate** — same envelope as POST.
**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — employees can only manage rows they created themselves." }
```

---

## 8. DELETE `/clm/tnc-library/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete, no usage guard)
**403** — `hierarchicalDenial`.

---

## 9. QUICK REFERENCE

```
GET    /clm/tnc-categories        # globals (Quotation/PI/PO/Debit Note/Credit Note) + your own
POST   /clm/tnc-categories        # { short_code, name }   → DC-NNN

GET    /clm/tnc-library           # the terms entries
POST   /clm/tnc-library           # { category, segment?, regulatory?, party?, content? }
                                  #   → TNC-NNN
                                  #   422 if the segment set overlaps an existing
                                  #       entry of the same category in this branch
PUT    /clm/tnc-library/{id}      # partial update; the uniqueness rule re-runs
DELETE /clm/tnc-library/{id}
```

---

## 10. NOTES (caveats)

1. The four (now five) standard categories are **global rows** with `client_id: null` — they appear for every tenant and cannot be edited by a client user.
2. `DC-NNN` / `TNC-NNN` restart at 001 **per branch**, so codes repeat across branches and against the globals.
3. **Debit Note / Credit Note** entries carry no segment, regulatory tier or party — the server blanks them by matching the literal category name, and they are exempt from the uniqueness rule.
4. Blanking uses **empty strings, not nulls**, so the NOT NULL columns stay valid and the `?? 'General'` / `?? 'highly'` defaults don't backfill.
5. The uniqueness rule compares **segment sets**, not strings — any overlap counts.
6. Uniqueness is enforced in application code, not by a database constraint.
7. Categories have **no in-use guard**; the library links to them by name.
8. `segment` stores segment **names**; the segment master treats this column as a name-based reference when blocking renames and deletes.
9. Deletes are hard on both tabs; there is no version history of previously printed terms.

---

*Related documents: TERMS_CONDITIONS_FUNCTIONAL_DOCUMENTATION.md · TERMS_CONDITIONS_TECHNICAL_DOCUMENTATION.md · TERMS_CONDITIONS_CODE_WALKTHROUGH.md*

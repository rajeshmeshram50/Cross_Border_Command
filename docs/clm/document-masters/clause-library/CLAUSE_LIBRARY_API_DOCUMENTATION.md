# CLAUSE LIBRARY — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Clause Library**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.clause_library` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on GETs.
- Success: `{ status: true, data, count }` · Failure: `{ status: false, message }`.
- Codes: 200 · 201 · 401 · 403 · 404 · **409** (duplicate name, in-use type, clause used in a CTC).

---

## 2. ENDPOINT INDEX

### Clause types
| Method | Path |
|---|---|
| GET · POST | `/clm/clause-types` |
| PUT · DELETE | `/clm/clause-types/{id}` |

### Clause library
| Method | Path |
|---|---|
| GET · POST | `/clm/clause-library` |
| PUT · DELETE | `/clm/clause-library/{id}` |

---

## 3. GET `/clm/clause-types`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 9, "client_id": 3, "branch_id": 2,
      "code": "CLT-004", "name": "Force Majeure",
      "description": "Events beyond the parties' reasonable control.",
      "status": "active",
      "in_use": 3 }
  ],
  "count": 6
}
```

`in_use` is a **count** — the number of clauses (visible to you) whose `clause_type` matches this name, case-insensitively. Any non-zero value blocks **edit**.

---

## 4. POST `/clm/clause-types`

```json
{ "name": "Force Majeure", "description": "Events beyond the parties' reasonable control." }
```

| Field | Rule |
|---|---|
| `name` | required · string · **max 100** · unique (case-insensitive) **within your scope** |
| `description` | **optional** · string · max 500 |

> `description` used to be required. The redesigned modal collects only the name; older payloads that still send a description continue to work.

**201** → `{ status:true, data: { …row…, "code": "CLT-007" } }`
**409** → `{ "status": false, "message": "A clause type with this name already exists." }`
**403** → `{ "status": false, "message": "No tenant context" }`

---

## 5. PUT `/clm/clause-types/{id}`

```json
{ "name": "Force Majeure & Acts of God" }
```

**409 — the type is in use**
```json
{ "status": false,
  "message": "This clause type is used by 3 clauses in the Clause Library, so it can't be edited. Remove or reassign those clauses first." }
```
The library links to a type by its **name string**, so a rename would orphan every clause pointing at it.

**409 — rename collides**
```json
{ "status": false, "message": "A clause type with this name already exists." }
```
> This collision check is **client-wide**, whereas the create-time check is scope-relative — so a rename can be rejected by a sibling branch's type even though creating that same name would have been allowed.

**403 — creator hierarchy** (branch users may view shared client-level types but not manage them).

---

## 6. DELETE `/clm/clause-types/{id}`

**200** → `{ status: true, message: "Deleted" }`

> **No in-use guard.** Unlike `PUT`, deletion is not blocked — a type can be removed while clauses still reference its name. Those clauses keep the orphaned string.

**403** — `hierarchicalDenial`.

---

## 7. GET `/clm/clause-library`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 22, "client_id": 3, "branch_id": 2,
      "code": "CL-011",
      "clause_type": "Force Majeure",
      "name": "Force Majeure — Standard",
      "party": "",
      "clause_status": "Active",
      "content": "<p>Neither party shall be liable for any failure…</p>",
      "status": "active",
      "in_use": 1 }
  ],
  "count": 14
}
```

`in_use` is `0` or `1`, derived from a **text search**: every Case-to-Case contract's current `content` **and** each entry in its `versions` JSON is scanned for the literal heading `<h3>Clause Name</h3>` that the insert panel writes. A hit blocks **delete**.

> This is deliberately best-effort. It covers **CTC contracts only** — agreements and trade documents that contain the clause are not searched. Renaming a clause changes the search needle, so earlier insertions stop registering.

---

## 8. POST `/clm/clause-library`

```json
{ "clause_type": "Force Majeure",
  "name": "Force Majeure — Standard",
  "content": "<p>Neither party shall be liable for any failure…</p>" }
```

| Field | Rule | Default |
|---|---|---|
| `clause_type` | required · string · max 255 · the type **name** | — |
| `name` | required · string · max 255 · unique (case-insensitive) **within your scope** | — |
| `party` | **optional** · string · max 255 | `''` |
| `clause_status` | optional · string · max 32 | `Active` |
| `content` | optional · the clause HTML | null |

> `party` used to be required. The redesigned modal collects only `clause_type` + `name` + `content`; older payloads still work.

**201** → `{ status:true, data: { …row…, "code": "CL-015" } }`
**409** → `{ "status": false, "message": "A clause with this name already exists." }`

---

## 9. PUT `/clm/clause-library/{id}`

Same fields, all `sometimes`.

**200** → `{ status:true, data: { …fresh row… } }`

There is **no in-use edit lock**. Because clauses are *copied* into documents rather than referenced, editing one never changes a draft that already contains it — a signed contract keeps the wording it was signed with.

**409 — rename collides**
```json
{ "status": false, "message": "A clause with this name already exists." }
```
(Also client-wide, like the type rename check.)

**403 — creator hierarchy** (branch users may view shared client-level clauses but not edit them).

> **Side effect of renaming:** the usage needle changes, so a clause already inserted under its old name will report `in_use: 0` afterwards — and can then be deleted despite still appearing in contracts.

---

## 10. DELETE `/clm/clause-library/{id}`

**200** → `{ status: true, message: "Deleted" }` (hard delete)

**409 — used in a CTC agreement**
```json
{ "status": false,
  "message": "This clause is used in one or more CTC agreements and cannot be deleted." }
```

**403** — `hierarchicalDenial`.

---

## 11. HOW CLAUSES REACH A DOCUMENT

There is no API for insertion — it happens client-side. `ClmClauseInsertPanel` writes the clause into the editor body as:

```html
<h3>Force Majeure — Standard</h3>
<p>Neither party shall be liable for any failure…</p>
```

The document is then saved through its own endpoint:

| Target | Endpoint | Column |
|---|---|---|
| Agreement | `PUT /clm/agreement-library/{id}` | `content` |
| Trade Document | `PUT /clm/trade-doc-library/{id}` | `content` |
| Case-to-Case | `PUT /clm/ctc-contracts/{id}` | `content` (+ `versions[]` snapshots) |

The `<h3>…</h3>` heading is **the** artefact usage detection relies on — the clause name is HTML-escaped in it, so a clause named `Force Majeure & Acts of God` is written (and searched for) as `<h3>Force Majeure &amp; Acts of God</h3>`.

---

## 12. QUICK REFERENCE

```
POST   /clm/clause-types            # 1. { name, description? }         → CLT-NNN
POST   /clm/clause-library          # 2. { clause_type, name, content } → CL-NNN
#      (insert client-side via ClmClauseInsertPanel → <h3>Name</h3> + content)
PUT    /clm/ctc-contracts/{id}      # 3. the document is saved with the clause copied in
GET    /clm/clause-library          # 4. in_use = 1 once the heading is found in any CTC
DELETE /clm/clause-library/{id}     #    409 while in use
PUT    /clm/clause-types/{id}       #    409 while any clause references the type
```

---

## 13. NOTES (caveats)

1. Clauses are **copied**, not linked — editing the library never changes an existing document.
2. `in_use` on a clause is a **text search over Case-to-Case contracts only** (current draft + all saved versions); agreements and trade documents are not searched.
3. Renaming a clause changes the search needle and silently clears its `in_use` flag.
4. **Clause types are locked against edit while in use, but not against delete** — an asymmetry.
5. Duplicate-name checks are **scope-relative on create** but **client-wide on rename**, so the update path is stricter.
6. `CLT-NNN` / `CL-NNN` restart at 001 per branch.
7. `description` (types) and `party` (clauses) are optional since the modal redesign; older payloads including them still validate.
8. Deletes are hard on both tabs; there is no version history for clauses.

---

*Related documents: CLAUSE_LIBRARY_FUNCTIONAL_DOCUMENTATION.md · CLAUSE_LIBRARY_TECHNICAL_DOCUMENTATION.md · CLAUSE_LIBRARY_CODE_WALKTHROUGH.md*

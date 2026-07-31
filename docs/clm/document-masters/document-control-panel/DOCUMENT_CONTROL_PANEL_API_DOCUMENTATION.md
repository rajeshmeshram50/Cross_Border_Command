# DOCUMENT CONTROL PANEL (DCP) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Document Control Panel**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.document_panel` gates the UI; the API enforces tenant + branch scope and the creator-hierarchy rule.
- Axios auto-appends `?branch_id=<active>` on GETs.
- Success: `{ status: true, data, counts? }` · Failure: `{ status: false, message, existing? }`.
- Codes: 200 · 201 · 401 · 403 · 404 · **409** (duplicate rule) · 422.
- Route order matters: `/bootstrap` and `/for-segment/{id}` are declared before the generic `/{id}` routes.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/segment-rules` | Rule list + tier counts |
| GET | `/clm/segment-rules/bootstrap` | **Every master the Add/Edit modal needs, in one call** |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | The rule + fully resolved document rows (what party forms read) |
| POST | `/clm/segment-rules` | Create a rule (`SR-NNN` auto-allocated) |
| PUT | `/clm/segment-rules/{id}` | Update a rule |
| DELETE | `/clm/segment-rules/{id}` | Hard delete |

---

## 3. GET `/clm/segment-rules`

**200**
```json
{
  "status": true,
  "data": [
    { "id": 21, "client_id": 3, "branch_id": 2,
      "segment_id": 14, "segment_code": "SG-004",
      "rule_code": "SR-007",
      "regulatory_status": "highly",
      "document_type": "international",
      "auths_json": ["AUTH-001", "AUTH-004"],
      "doc_selections": {
        "kyc": { "KYC-001": "M", "KYC-003": "M", "KYC-007": "O" },
        "dd":  { "DD-002": "M" },
        "tl":  { "TL-001": "M", "TL-004": "O" },
        "qc":  { "QC-003": "O" }
      },
      "mandatory_count": 5,
      "optional_count": 3,
      "status": "active",
      "created_by": 55, "updated_by": 55,
      "created_at": "2026-07-21T06:40:12.000000Z",
      "updated_at": "2026-07-22T09:15:33.000000Z" }
  ],
  "counts": { "all": 9, "highly": 4, "less": 5 }
}
```

Ordering is **`id DESC`** — the newest rule appears at the top of the panel. A user with no `client_id` receives an empty payload with zeroed counts rather than a 403.

| Field | Meaning |
|---|---|
| `document_type` | `domestic` \| `international` — a segment may hold one rule of each |
| `doc_selections` | Document **codes** → `"M"` (mandatory) or `"O"` (optional) |
| `auths_json` | Authority **codes** auto-mapped at save time |
| `mandatory_count` / `optional_count` | Denormalised at write time so the list renders badges without re-parsing JSON |

---

## 4. GET `/clm/segment-rules/bootstrap`

Returns every master the two-stage modal needs, branch-scoped, with authorities already resolved to current names — so the modal renders Stage 1 and Stage 2 without a single further fetch.

**200**
```json
{
  "status": true,
  "data": {
    "segments":    [ { "id": 14, "code": "SG-004", "name": "Food Grade Ethanol",
                       "regulatory_status": "highly", "buyer_consignee": "not_allowed",
                       "status": "active" } ],
    "authorities": [ { "id": 6, "code": "AUTH-001", "name": "DGFT",
                       "description": "…", "status": "active" } ],
    "kyc": [ { "id": 7, "code": "KYC-003", "name": "GST Certificate",
               "authority": "GST Department, State VAT Office",
               "authority_list": ["GST Department", "State VAT Office"],
               "expiry": "N/A", "status": "active" } ],
    "dd":  [ { "id": 4, "code": "DD-002", "name": "Bank Reference Letter",
               "authority": "Scheduled Commercial Bank",
               "authority_list": ["Scheduled Commercial Bank"],
               "expiry": "Varies", "status": "active" } ],
    "tl":  [ { "id": 2, "code": "TL-001", "name": "Importer Exporter Code (IEC)",
               "authority": "DGFT", "authority_list": ["DGFT"],
               "validity": "Lifetime", "status": "active" } ],
    "qc":  [ { "id": 9, "code": "QC-003", "name": "HACCP Certification",
               "issued_by": "FSSAI", "authority_list": ["FSSAI"],
               "purpose": "…", "doc_type": "cert", "status": "active" } ]
  }
}
```

Notes:
- **No `td` key.** Trade Documents were removed as a configurable category.
- QC exposes its resolved names on **`issued_by`** (its own column) but still ships `authority_list`, so the shared `AuthorityBadges` component works uniformly.
- Always consume **`authority_list`** when counting or iterating — authority names may themselves contain commas.

---

## 5. GET `/clm/segment-rules/for-segment/{segmentId}`

**Query:** `document_type` (optional — `domestic` \| `international`; an invalid value is ignored and the first rule for the segment is returned).

This is what the Customer / Consignee / Vendor forms call to render their Stage 2 checklist. It **always returns 200**, even when no rule exists, so the caller renders an empty Stage 2 rather than swallowing a 404.

**200 — rule found**
```json
{
  "status": true,
  "data": {
    "rule": { "id": 21, "rule_code": "SR-007", "segment_code": "SG-004",
              "regulatory_status": "highly", "document_type": "international",
              "mandatory_count": 5, "optional_count": 3, "doc_selections": { … } },
    "kyc": [
      { "id": 7, "code": "KYC-003", "name": "GST Certificate", "status": "active",
        "authority": "GST Department", "authority_list": ["GST Department"],
        "expiry": "N/A", "requirement": "M" }
    ],
    "dd": [
      { "id": 4, "code": "DD-002", "name": "Bank Reference Letter", "status": "active",
        "authority": "Scheduled Commercial Bank", "authority_list": ["Scheduled Commercial Bank"],
        "expiry": "Varies", "requirement": "M" }
    ],
    "tl": [
      { "id": 2, "code": "TL-001", "name": "Importer Exporter Code (IEC)", "status": "active",
        "authority": "DGFT", "authority_list": ["DGFT"],
        "validity": "Lifetime", "requirement": "M" }
    ],
    "qc": [
      { "id": 9, "code": "QC-003", "name": "HACCP Certification", "status": "active",
        "purpose": "…", "doc_type": "cert", "requirement": "O" }
    ]
  }
}
```

**200 — no rule for this segment**
```json
{ "status": true, "data": { "rule": null, "kyc": [], "dd": [], "tl": [], "qc": [] } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context" }`

### Field shape per category
Each row carries `id`, `code`, `name`, `status`, `requirement` (`"M"` \| `"O"`), plus whichever of `authority`, `authority_list`, `expiry`, `validity`, `title`, `doc_type`, `purpose`, `party` actually exist on that model. That is why **TL rows carry `validity`** while **KYC/DD rows carry `expiry`**, and **QC rows carry `purpose` + `doc_type`**.

> Codes referenced by the rule but no longer present in the master are simply absent from the response — `doc_selections` is not existence-checked at write time.

---

## 6. POST `/clm/segment-rules`

```json
{ "segment_code": "SG-004",
  "regulatory_status": "highly",
  "document_type": "international",
  "auths": ["AUTH-001", "AUTH-004"],
  "doc_selections": {
    "kyc": { "KYC-001": "M", "KYC-003": "M", "KYC-007": "O" },
    "dd":  { "DD-002": "M" },
    "tl":  { "TL-001": "M", "TL-004": "O" },
    "qc":  { "QC-003": "O" }
  } }
```

| Field | Rule |
|---|---|
| `segment_code` | required · string · max 16 |
| `regulatory_status` | required · `highly` \| `less` |
| **`document_type`** | **required** · `domestic` \| `international` |
| `auths` | optional · array of authority code strings |
| `doc_selections` | required · object; keys `kyc` \| `dd` \| `tl` \| `qc`, each an object of `CODE → "M"\|"O"` |

A `td` key is accepted by the parser but **silently stripped** and never persisted.

**201** → `{ status:true, data: { …row…, "rule_code": "SR-008", "mandatory_count": 5, "optional_count": 3 } }`

**409 — a rule of this type already exists for the segment**
```json
{ "status": false,
  "message": "A International rule already exists for segment SG-004 (SR-007). Edit the existing rule instead.",
  "existing": { "id": 21, "rule_code": "SR-007", … } }
```

**403 — no tenant** → `{ "status": false, "message": "No tenant context" }`

### Side effects
- `rule_code` is allocated under a `clients` row lock. **`SR-NNN` is client-wide** — unlike every other CLM code, it does not restart per branch.
- `segment_id` is resolved from `segment_code`; `segment_code` is also stored as a snapshot.
- `mandatory_count` / `optional_count` are recomputed from `doc_selections`.
- The cached master bundle is invalidated, because a rule going from 0 → ≥ 1 documents makes its segment appear in the Customer / Consignee / Vendor segment pickers.

---

## 7. PUT `/clm/segment-rules/{id}`

Same body as POST — the full payload is re-validated, so send every field.

**200** → `{ status:true, data: { …fresh row… } }`

**409 — clash with another rule** (same message shape as POST, excluding this row).

**403 — creator hierarchy**
```json
{ "status": false, "message": "You cannot edit this record — it was created by another Branch." }
```

Counts are recomputed and the master-bundle cache is bumped again — an edit can move a rule from ≥ 1 → 0 documents, which **removes** its segment from the party pickers.

---

## 8. DELETE `/clm/segment-rules/{id}`

**200** → `{ status: true, message: "Deleted" }`

Hard delete, **no usage guard** — a rule is a configuration, not a referenced entity. The cache is bumped because removing a rule can drop its segment from the pickers.

**403** — `hierarchicalDenial` (employees may only delete their own rules).

> Parties already onboarded under the rule keep their uploaded evidence in `segment_doc_uploads`, but their compliance checklist becomes empty.

---

## 9. QUICK REFERENCE

```
# setup order
POST /clm/authorities                          # issuing bodies
POST /clm/kyc-documents | dd-documents | trade-licenses | qc-documents
POST /clm/segments                             # the trade line
GET  /clm/segment-rules/bootstrap              # open the DCP modal (ONE call)
POST /clm/segment-rules                        # { segment_code, regulatory_status,
                                               #   document_type, auths[], doc_selections{} }

# consumption
GET  /clm/segment-rules/for-segment/{id}?document_type=international
POST /segment-uploads/{type}/{id}              # party uploads evidence
GET  /segment-uploads/{type}/{id}/summary      # X of Y
GET  /clm/buyer-profile | supplier-profile     # scorecards
```

---

## 10. NOTES (caveats)

1. **One rule per `(segment, document_type)`** — a second returns 409 with the existing rule attached.
2. `document_type` is mandatory; legacy rows were backfilled to `international`.
3. **`SR-NNN` is client-wide**, the only CLM code not scoped per branch.
4. Document codes inside `doc_selections` are **not** existence-checked on write.
5. The `td` (Trade Documents) category was removed and is stripped from every payload.
6. `for-segment` falls back to the segment's *other* `document_type` rule when the requested one is absent — convenient, but it can mask a missing configuration.
7. Deletes are hard and unguarded.
8. A segment only appears in the party segment pickers while its rule holds ≥ 1 document; every write bumps the 5-minute per-user bundle cache.

---

*Related documents: DOCUMENT_CONTROL_PANEL_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_TECHNICAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_CODE_WALKTHROUGH.md*

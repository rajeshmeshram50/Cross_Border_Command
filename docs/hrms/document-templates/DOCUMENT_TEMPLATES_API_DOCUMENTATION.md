# DOCUMENT TEMPLATES MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Document Templates
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Templates + generated docs gated by **`hr.doc_templates`** (view/add/edit/delete). **Signature endpoints are not permission-gated** — tenant scope + per-signer identity.
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / template not Active) · 503 (phpword/DomPDF missing).

---

## 2. ENDPOINT INDEX

### Templates
| Method | Path |
|---|---|
| GET | `/hr-document-templates` · `/stats` · `/next-code` · `/match` |
| POST | `/hr-document-templates` · `/upload-header-logo` · `/{id}/upload-docx` |
| GET | `/hr-document-templates/{id}` · `/{id}/download` · `/{id}/generate` · `/{id}/preview` |
| PUT/DELETE | `/hr-document-templates/{id}` |

### Generated documents
| Method | Path |
|---|---|
| GET/POST | `/hr-generated-documents` · `/preview` |
| GET | `/hr-generated-documents/{id}` · `/{id}/download` |

### Signatures
| Method | Path |
|---|---|
| GET | `/hr-document-signatures` · `/inbox` · `/{id}` · `/{id}/download` · `/{id}/download-pdf` |
| POST | `/hr-document-signatures` · `/{id}/action` · `/reject` · `/cancel` · `/remind` · `/email-employee` |
| GET | `/employees/{slug}/signed-documents` |

---

## 3. TEMPLATES

### POST `/hr-document-templates` (multipart)
**Body (subset):** `name`*, `employee_category`* (IT/Non-IT/Legal), `role_type`* (designation level), `doc_type`, `trigger_point_id`, `signing_mode` (Sequential/Parallel), `signers[]`, `requires_signature`, `content_html` (or `docx` file), `header_config`/`footer_config`, `status`.
**Response 201:** template row (`code`, `version` v1, status Draft).

### GET `/hr-document-templates/match?employee_id=N&trigger_keyword=onboarding`
Active templates matching the employee's category + designation level and the trigger keyword → `{ templates: [ { id, code, name, trigger_point:{id,module_name} } ] }`.

### GET `/hr-document-templates/{id}/preview?employee_id=N`
`{ content_html, header, footer, tokens_used, tokens_missing }`.

### GET `/hr-document-templates/{id}/generate?employee_id=N`
Streams a filled DOCX (`{DisplayName} - {name}.docx`).

### POST `/hr-document-templates/{id}/upload-docx` · `/upload-header-logo`
Upload a Word doc (parsed back into the web editor + header/footer) / a header logo (returns `{path,url}`).

---

## 4. GENERATED DOCUMENTS

### POST `/hr-generated-documents/preview`
`{ template_id, employee_id, custom_values }` → `{ rendered_html, tokens, template, employee }` (no write).

### POST `/hr-generated-documents`
Bulk generate (one row per recipient). **422** if the template isn't Active. → `{ count, documents }`.

### GET `/hr-generated-documents/{id}/download`
Streams the merged DOCX (via `HrTemplateDocxRenderer`).

---

## 5. SIGNATURES

### POST `/hr-document-signatures`
`{ template_id, employee_id, custom_values? }` → creates a run (freezes content, resolves signers). Idempotent — returns the existing Pending/In Progress run for the same template+employee.

### GET `/hr-document-signatures/inbox?history=`
Runs where the current user is the next signer (or, with `history=1`, runs they've acted on).

### POST `/hr-document-signatures/{id}/action`
`{ action: "Sign"|"Approve"|"Acknowledge", signed_name, signature_image? (base64), note? }`. Sign requires a typed name; a drawn signature replaces `{{Signer{N}Sign}}`. Advances the run.

### POST `/hr-document-signatures/{id}/reject` · `/cancel` · `/remind` · `/email-employee`
Reject (`reason`) / cancel (creator/admin) / remind (in-app, throttled 6h) / email the signed doc to the employee (Completed only).

### GET `/hr-document-signatures/{id}/download` · `/download-pdf`
Signed DOCX / signed PDF (DomPDF, signatures inlined). `GET /employees/{slug}/signed-documents` lists an employee's signed docs.

---

## 6. ERROR EXAMPLES
**422 — generate from inactive template**
```json
{ "message": "This template is not Active and can't be generated." }
```

---

## 7. QUICK REFERENCE
```
POST /hr-document-templates                 # author (Draft → Active)
GET  /hr-document-templates/match?trigger_keyword=onboarding   # surface at a stage
POST /hr-generated-documents                # merge per employee
POST /hr-document-signatures                # send for signature
POST /hr-document-signatures/{id}/action    # sign
GET  /hr-document-signatures/{id}/download-pdf   # signed PDF
```

---

## 8. NOTES (caveats)
1. Signature endpoints are not permission-gated (tenant + signer identity).
2. No DB FKs; templates hard-delete; only generated docs soft-delete.
3. `remind` is in-app only; e-signature is internal (no Zoho Sign).
4. Generation requires an Active template; DOCX/PDF need phpword/DomPDF (503 if missing).

---

*Related documents: DOCUMENT_TEMPLATES_TECHNICAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_CODE_WALKTHROUGH.md*

# DOCUMENT TEMPLATES MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Document Templates (role-based templates, generation, e-signature)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A role-based **DOCX/HTML template** system with per-employee **placeholder-merge generation** and an internal **e-signature** workflow (typed/drawn signatures, sequential/parallel signers, in-app reminders, PDF/DOCX output). Templates bind to a lifecycle **trigger point** so onboarding/exit screens auto-surface the right documents. Placeholders resolve from the employee record, built-in tokens, per-signer tokens, and manually-entered **Custom Fields**.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrDocumentTemplates.tsx (list) · TemplateForm/TemplateEditor (author) │
│  GenerateDocument/DocGenerateModal (merge) · SignaturePad (sign)       │
│  Inbox / MyTeam / Onboarding / Exit (send · track · sign · download)   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for DOCX/logo)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  HrDocumentTemplateController (templates + match + generate/preview)   │
│  HrGeneratedDocumentController (persisted merges)                      │
│  HrDocumentSignatureController (e-signature runs; NOT permission-gated)│
│  HrTemplateDocxRenderer (phpword DOCX build) · DomPDF (signed PDF)     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  hr_document_templates · hr_generated_documents (soft deletes) ·       │
│  hr_document_signatures (signers JSON, audit_log)  (no DB FKs)         │
│  trigger_point_id → master_trigger_points                             │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/HrDocumentTemplateController.php · HrGeneratedDocumentController.php · HrDocumentSignatureController.php
app/Services/HrTemplateDocxRenderer.php
app/Models/HrDocumentTemplate.php · HrGeneratedDocument.php · HrDocumentSignature.php
database/migrations/ (create_hr_document_templates / _generated_documents / _document_signatures + header/footer + role_type relax)
resources/js/pages/hrms/HrDocumentTemplates.tsx + doc-templates/{TemplateForm,TemplateEditor,HeaderFooterPanel,GenerateDocument,DocGenerateModal,CustomFieldModal}.tsx
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Docs | phpword (DOCX build/parse) · DomPDF (signed PDF) · GD/Imagick (logo convert) |
| Frontend | React 19 · TS · **TipTap** editor · reactstrap/Bootstrap/Tailwind (Velzon) · SignaturePad |

---

## 3. DATABASE SCHEMA (all no DB FKs)

### 3.1 `hr_document_templates` (no SoftDeletes — hard delete)
Tenancy, `code`, `name`, `description`, `employee_category` (IT/Non-IT/Legal), `role_type` (6 designation levels), `doc_type`, **`trigger_point_id`**, `version` (v1), `is_mandatory`/`requires_signature`/`requires_manager_approval`/`include_in_audit`, `signing_mode` (Sequential/Parallel), `signers` (json), `editor_mode` (web/word), `content_html`, `header_config`/`footer_config` (json), `docx_path`/`docx_original_name`, `status` (Draft/Active/Deprecated).

### 3.2 `hr_generated_documents` (**SoftDeletes**)
`template_id`, `employee_id`, `rendered_html`, `custom_values`/`resolved_vars` (json), `status` (Generated/…), `generated_by`, `generated_at`, `sent_at`.

### 3.3 `hr_document_signatures` (no SoftDeletes)
`template_id`, `employee_id`, `code`, frozen `content_html` + `header_config`/`footer_config`, **`signers`** (json array of `{index, role_name, action, user_id, name, status, acted_at, signed_name, signature_url, note}`), `current_index`, `status` (Pending/In Progress/Completed/Rejected/Cancelled), `audit_log` (json).

---

## 4. MODELS
| Model | Table | Notes |
|---|---|---|
| `HrDocumentTemplate` | hr_document_templates | no SoftDeletes; casts booleans + signers/header/footer arrays; `triggerPoint` belongsTo |
| `HrGeneratedDocument` | hr_generated_documents | **SoftDeletes**; custom_values/resolved_vars arrays; template/employee/generator |
| `HrDocumentSignature` | hr_document_signatures | signers/audit_log arrays; no dedicated signer model (JSON) |

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // Templates
    Route::get ('/hr-document-templates/stats' | '/next-code' | '/match');
    Route::post('/hr-document-templates/upload-header-logo');
    Route::get ('/hr-document-templates/{id}/download' | '/generate' | '/preview');
    Route::post('/hr-document-templates/{id}/upload-docx');
    Route::apiResource('hr-document-templates', HrDocumentTemplateController::class);
    // Generated
    Route::post('/hr-generated-documents/preview'); Route::apiResource('hr-generated-documents', ...);
    Route::get ('/hr-generated-documents/{id}/download');
    // Signatures
    Route::get ('/hr-document-signatures' | '/inbox'); Route::post('/hr-document-signatures');
    Route::post('/hr-document-signatures/{id}/action' | '/reject' | '/cancel' | '/remind' | '/email-employee');
    Route::get ('/hr-document-signatures/{id}' | '/download' | '/download-pdf');
    Route::get ('/employees/{slug}/signed-documents');
});
```
Full detail in **DOCUMENT_TEMPLATES_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

**Permission slug `hr.doc_templates`** on the template + generated controllers (view/add/edit/delete; super-admin bypass; unseeded-module fallback). **`HrDocumentSignatureController` has NO permission gate** — tenant scope + per-signer identity only.

### HrDocumentTemplateController
CRUD (code under lock; hard delete; `guardHierarchicalAction`), `downloadDocx`/`uploadDocx` (round-trips Word ↔ HTML; lifts header logo/title/footer), `matchForEmployee` (category + designation level + trigger keyword), `generateForEmployee`/`previewForEmployee` (token merge). Token catalogue: Basic/Contact/Job/Salary/Org + `Signer{N}Name/Date/Designation/Sign`.

### HrGeneratedDocumentController
`preview` (no write), `store` (bulk — one row per recipient; 422 if template not Active), `index`/`show`, `downloadDocx` (via `HrTemplateDocxRenderer`).

### HrDocumentSignatureController
`store` (freeze content; resolve signers to users; idempotency lock), `action` (Sign/Approve/Acknowledge — typed name + optional drawn image; advances sequential/parallel), `reject`/`cancel`, `remind` (**in-app notification only**, throttled 6h), `download`/`download-pdf` (DomPDF inlines signatures), `email-employee` (Completed only), `forEmployee`, `inbox`.

---

## 7. FRONTEND
- **List** (`HrDocumentTemplates.tsx`) — KPIs, category tabs + designation chips, Generate button, edit/deprecate/delete.
- **Author** (`TemplateForm.tsx` → `TemplateEditor.tsx` (TipTap) + `HeaderFooterPanel.tsx`) — 3 steps (Setup / Lifecycle & Signing / Design); web editor or MS Word upload; placeholder sidebar (built-in + custom fields + signer tokens); validates every "Sign" signer has a `{{Signer{N}Sign}}` slot.
- **Generate** (`GenerateDocument.tsx` / `DocGenerateModal.tsx`) — select employees → fill custom fields → preview → generate and/or send for signature.
- **Sign/track** — `Inbox.tsx` (signer inbox), `MyTeam.tsx` (approvers), onboarding/exit screens (send/track/remind), profile Vault (download signed PDF); shared `SignaturePad`.

---

## 8. SECURITY & CAVEATS
1. **`HrDocumentSignatureController` is not permission-gated** (unlike the other two) — tenant scope + signer identity only.
2. **No DB FKs** on any of the 3 tables; **only generated documents soft-delete** (templates hard-delete).
3. **`remind` sends an in-app notification, not email** (despite its docblock).
4. **DOCX renderer duplicated** (service `HrTemplateDocxRenderer` vs controller `buildDocxFile`); only generated-doc download uses the service.
5. **Signature workflow is fully internal** (no Zoho Sign — that's the CLM module).
6. **Migration enum drift:** `role_type` CHECK was dropped; 6 designation levels are validated in the controller.
7. `HrDocumentSignatureController::store` freezes content by reflecting into the template controller's private token methods.

---

## 9. METRICS
| Metric | Value |
|---|---|
| Controllers | 3 (+ renderer service) |
| Permission slug | hr.doc_templates (signatures ungated) |
| Tables | 3 |
| Signature statuses | Pending/In Progress/Completed/Rejected/Cancelled |
| Test coverage | none automated |

---

*Related documents: DOCUMENT_TEMPLATES_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_CODE_WALKTHROUGH.md · DOCUMENT_TEMPLATES_API_DOCUMENTATION.md*

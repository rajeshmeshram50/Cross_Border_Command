# DOCUMENT TEMPLATES MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Document Templates
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: author → match → generate → sign → download. Files: `HrDocumentTemplateController.php`, `HrGeneratedDocumentController.php`, `HrDocumentSignatureController.php`, `HrTemplateDocxRenderer.php`, `TemplateEditor.tsx`, `GenerateDocument.tsx`, `Inbox.tsx`.

---

## 1. AUTHOR A TEMPLATE

### `HrDocumentTemplateController::store()`
```php
$this->authorize($request, 'can_add');                      // hr.doc_templates
DB::transaction(function () {
    $code = $this->allocateCode(category, role);            // lockForUpdate
    HrDocumentTemplate::create($data + ['code'=>$code, 'version'=>'v1', 'status'=>'Draft', ...]);
    if ($request->hasFile('docx')) { storeDocx(); editor_mode='word'; }
});   // 201
```
`uploadDocx()` parses a Word file (`docxToHtml`) and lifts header logo/title/footer back into `header_config`/`footer_config`. `buildTokenContext()` supplies Basic/Contact/Job/Salary/Org + `Signer{N}*` tokens; `resolveTokens()` replaces `{{Token}}` (keeps `{{Signer{N}Sign}}` literal when `preserveSignerSlots`).

---

## 2. MATCH FOR A LIFECYCLE STAGE

### `matchForEmployee()`
```php
// GET /hr-document-templates/match?employee_id=N&trigger_keyword=onboarding|exit
$category = mapDepartmentToCategory($emp->department);
$role     = $emp->designation->level;
$ids = master_trigger_points whereRaw LOWER(TRIM(module_name)) LIKE %keyword% → pluck(id);
return Active templates where category+role and (ids ? whereIn(trigger_point_id, ids) : keep);
```

---

## 3. GENERATE (merge)

### `HrGeneratedDocumentController::store()`
```php
$this->authorize($request, 'can_add');
if ($template->status !== 'Active') abort(422);
DB::transaction(function () {
    foreach ($employees as $emp)                            // bulk
        HrGeneratedDocument::create(['template_id'=>$tpl->id, 'employee_id'=>$emp->id,
            'rendered_html'=>resolveTokens(tpl, emp, custom_values), 'custom_values'=>..., 'status'=>'Generated']);
});   // 201
// downloadDocx(): clone template, content_html=rendered_html → HrTemplateDocxRenderer::render()
```
`resolveTokens` precedence: employee-derived → signer tokens → operator `custom_values` (override). `previewForEmployee`/`preview` render without persisting.

---

## 4. E-SIGNATURE

### `HrDocumentSignatureController::store()` (no permission gate)
```php
// idempotency: lockForUpdate on an existing Pending/In Progress run for the same tpl+emp → return it
// freeze content_html (reflect into template controller's buildTokenContext + resolveTokens preserveSignerSlots)
// resolve signers to real users (resolveSignerUser: reporting/employee/ceo|client roles)
// current_index=0, status='Pending', seed audit_log
```

### `action()` (Sign / Approve / Acknowledge)
```php
// Parallel: act on the user's own pending slot; Sequential: only current_index
// Sign: typed signed_name required; optional drawn base64 → <img> replaces {{Signer{N}Sign}}, {{Signer{N}Date}}=today
// advance: Parallel → Completed when all acted; Sequential → next index / Completed; append audit event
```
`reject`/`cancel` close the run; `remind` inserts an **in-app notification** (throttled 6h); `download-pdf` (DomPDF, inlines signatures as data URIs); `email-employee` (Completed only).

---

## 5. DOCX RENDERING (`HrTemplateDocxRenderer`)
```php
buildPath($row): A4 twips; writeHeader()+writeFooter(); body via PhpWord Html::addHtml (self-close br/hr/img)
resolveDocxLogo(): WEBP→PNG (GD) / SVG→PNG (Imagick) since PhpWord embeds PNG/JPG only
render($row, $filename): stream download
// NOTE: near-duplicate of HrDocumentTemplateController::buildDocxFile; only generated-doc download uses the service
```

---

## 6. FRONTEND
```tsx
// TemplateEditor.tsx (TipTap): GET /hr-custom-fields/known-tokens → placeholder sidebar;
//   unknown token → "Add as custom field" → POST /hr-custom-fields
// GenerateDocument.tsx: POST /hr-generated-documents/preview → /hr-generated-documents → /hr-document-signatures
// Inbox.tsx: GET /hr-document-signatures/inbox → POST /{id}/action | /reject → /{id}/download-pdf
```

---

## 7. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Trigger match | matchForEmployee | Surface docs at the right stage |
| Token merge precedence | resolveTokens | Employee → signer → custom values |
| Freeze at send | signature store | Content immutable during signing |
| Signer identity gate | signature action | Act only on your own slot |
| DOCX + PDF render | renderer + DomPDF | Word-parity output + signed PDF |

---

## 8. NOTES & CAVEATS
- Signature controller not permission-gated (tenant + signer identity).
- No DB FKs; templates hard-delete; only generated docs soft-delete.
- `remind` = in-app notification (not email).
- Renderer duplicated (service vs controller copy).
- Internal e-signature only (no Zoho Sign here).
- DB is PostgreSQL.

---

*Related documents: DOCUMENT_TEMPLATES_TECHNICAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_API_DOCUMENTATION.md*

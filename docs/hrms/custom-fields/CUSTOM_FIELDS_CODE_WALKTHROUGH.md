# CUSTOM FIELDS MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Custom Fields
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: define → editor token catalogue → usage scan → delete guard → generation merge. Files: `HrCustomFieldController.php`, `HrCustomField.php`, `HrCustomFields.tsx`, `TemplateEditor.tsx`, `GenerateDocument.tsx`.

---

## 1. DEFINE A FIELD

### `HrCustomFieldController::store()`
```php
$this->authorize($request, 'can_add');                 // hr.custom_fields
$data = $request->validate([
  'name' => 'required|string|max:100|regex:/^[A-Za-z_][A-Za-z0-9_]*$/',   // PascalCase, no spaces
  'type' => ['required', Rule::in(['text','date','number','textarea'])],
  'description' => 'nullable|string|max:500',
  'used_in_hint' => 'nullable|string|max:500',
]);
DB::transaction(function () {
    $this->ensureUniqueName(...);                       // (client,branch,name) unique
    HrCustomField::create($data + resolveOwnership() + ['created_by'=>$user->id]);
});   // 201
```

---

## 2. TOKEN CATALOGUE (for the editor)

### `knownTokens()`
```php
return response()->json([
  'employee' => self::EMPLOYEE_TOKENS,                  // FirstName, FullName, Email, JobTitle, CTC, CompanyName, …
  'custom_fields' => $scopedFields->map(fn($f) => ['id'=>$f->id, 'name'=>$f->name,
     'token' => '{{'.$f->name.'}}', 'type'=>$f->type, 'description'=>$f->description]),
]);
```

### `validateTokens()`
```php
// parse {{Token}} occurrences in content_html → { found[], known[], unknown[] }
```

---

## 3. USAGE DERIVATION (never stored)

### `computeUsage()`
```php
$templates = in-scope hr_document_templates (content_html);
foreach ($templates as $t) {
    $text = html_entity_decode(strip_tags($t->content_html));
    if (preg_match('/\{\{\s*'.$name.'\s*\}\}/u', $text)) $usage[$name]['templates'][] = {id,code,name};
}
// index()/show() attach used_in[] + used_count (computed every read)
```

---

## 4. DELETE GUARD

### `destroy()`
```php
if ($usedCount > 0) abort(422, "Cannot delete — {{$name}} is used in N template(s): …");
$row->delete();   // hard delete (no soft deletes)
```

---

## 5. GENERATION MERGE (transient values)

### `GenerateDocument.tsx` / `DocGenerateModal.tsx`
```tsx
GET /hr-custom-fields/known-tokens                  // catalogue
// scan the template content_html for {{name}}; render a per-employee input for each custom field
// customByEmp[employeeId][fieldName] = typed value  → sent at generation time
// HrTemplateDocxRenderer merges the value into the DOCX; nothing is written back to hr_custom_fields
```

### `TemplateEditor.tsx`
```tsx
// combine employee + signer + custom-field tokens into the "known" set; flag unknownTokens
// "Add as custom field" → POST /hr-custom-fields → reload known-tokens
```

---

## 6. AUTH & SCOPE
```php
authorize(): super_admin bypass; else permissions row on hr.custom_fields; unseeded → allow client_admin/branch_user
applyScope(): super_admin all; client_admin/user → globals + own client (+ switcher); branch_user/employee → globals + client-level + own branch
guardHierarchicalAction(): can't edit/delete a field created by a higher tier
```

---

## 7. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Definition-only | whole module | Values live at generation time |
| Live usage scan | computeUsage | No stale "used in" data |
| Delete guard | destroy | Protect referenced fields |
| Inline add | editor → store | Author unknown tokens without leaving |
| PascalCase names | validation | Clean `{{Token}}` merge |

---

## 8. NOTES & CAVEATS
- No value table; no soft deletes; no DB FKs.
- Only text/date/number/textarea (no options/select).
- Unique `(client_id, branch_id, name)`; names case-insensitive-unique per scope.
- DB is PostgreSQL.

---

*Related documents: CUSTOM_FIELDS_TECHNICAL_DOCUMENTATION.md · CUSTOM_FIELDS_FUNCTIONAL_DOCUMENTATION.md · CUSTOM_FIELDS_API_DOCUMENTATION.md*

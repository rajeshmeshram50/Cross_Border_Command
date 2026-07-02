# CUSTOM FIELDS MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Custom Fields

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Custom Fields lets a tenant define its own document variables (e.g. `{{LastWorkingDate}}`, `{{BondAmount}}`) that aren't part of the standard employee record. HR Document Templates reference them as `{{placeholders}}`; the values are typed in per employee when a document is generated.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Flexible templates | Capture data the system doesn't store, without schema changes |
| Consistent merge | Named placeholders reused across templates |
| Guided authoring | The template editor lists known tokens and flags unknown ones |
| Safe deletion | A field in use can't be deleted |

### 1.3 Key features
- **Define fields** (name, type: Text/Date/Number/Textarea, description).
- **Token catalogue** for the template editor (built-in + custom).
- **Usage tracking** (which templates use each field) computed live.
- **Inline add** of an unknown token straight from the editor.

---

## 2. ROLES & ACCESS
Gated by **`hr.custom_fields`** (view/add/edit/delete). Super-admin bypasses; branch users are branch-scoped.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                    CUSTOM FIELD LIFECYCLE                          │
└───────────────────────────────────────────────────────────────────┘
   HR defines a field  →  {{FieldName}} (Text/Date/Number/Textarea)
        │
        ▼
   Template author inserts {{FieldName}} into a document template
        │   (editor lists it under Custom Fields; unknown tokens can be
        │    "added as custom field" inline)
        ▼
   At GENERATION: operator types the value per employee
        │   (transient — merged into the DOCX, never stored here)
        ▼
   Field can't be deleted while any template references it
```

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Custom Fields (`HrCustomFields.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Custom Fields                                     [+ Add Field]   │
│  [Total][Text][Date][Number][Textarea]                            │
│  [Search] [Type ▼]                                                │
│  Sr│Field Name│Variable ({{name}})│Type│Description│Used In│Actions│
└───────────────────────────────────────────────────────────────────┘
```
Add/Edit modal: Field Name (PascalCase, unique, no spaces), Input Type (Text/Date/Number/Textarea), Description, Used-in hint. "Used In" shows real template usage (or the hint).

### 4.2 Integration points
- **Template editor** — placeholder sidebar (Basic/Contact/Job/Salary/Org + Custom Fields); insert `{{Token}}`; "register as custom field" for unknown tokens.
- **Generate document** — a typed input per referenced custom field, per employee.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Field name is a PascalCase identifier (no spaces), unique per scope |
| 2 | Types: Text, Date, Number, Textarea (no dropdown/options) |
| 3 | Values are entered at generation time; never stored in this module |
| 4 | "Used In" is computed by scanning template content |
| 5 | A field can't be deleted while a template uses it |
| 6 | Custom fields resolve from manual input; built-in tokens from the employee record |

---

## 6. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Types | No select/dropdown or options list |
| Values | Not persisted — re-entered each generation |
| Integrity | No DB foreign keys / soft deletes |
| Scope | Belongs to the document-template system (Back returns to Doc Templates) |

---

*Related documents: CUSTOM_FIELDS_TECHNICAL_DOCUMENTATION.md · CUSTOM_FIELDS_CODE_WALKTHROUGH.md · CUSTOM_FIELDS_API_DOCUMENTATION.md*

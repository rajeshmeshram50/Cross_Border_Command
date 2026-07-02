# DOCUMENT TEMPLATES MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Document Templates

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Document Templates lets HR author reusable, role-based documents (offer letters, agreements, relieving letters), merge them per employee via `{{placeholders}}`, and route them through an internal e-signature workflow. Templates bind to a lifecycle trigger so the right documents surface at onboarding/exit.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Consistent documents | One template → many personalised documents |
| Right doc at the right stage | Trigger binding auto-surfaces templates during onboarding/exit |
| E-signature built-in | Typed/drawn signatures, sequential or parallel signers |
| Flexible authoring | Rich web editor or MS-Word upload |
| Auditable | Signature runs carry an audit log and produce signed PDFs |

### 1.3 Key features
- **Templates** by category (IT/Non-IT/Legal) and designation level, with version/status.
- **Placeholders** — employee tokens, per-signer tokens, and Custom Fields.
- **Generation** — per-employee merge (preview / persist / DOCX download).
- **E-signature** — sign/approve/acknowledge, reminders, signed PDF/DOCX, email to employee.

---

## 2. ROLES & ACCESS
Template + generation gated by **`hr.doc_templates`** (view/add/edit/delete). The signature workflow is not permission-gated — it's governed by tenant scope and per-signer identity (you can only act on your own signer slot).

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                    DOCUMENT LIFECYCLE                              │
└───────────────────────────────────────────────────────────────────┘
   AUTHOR (HR)
     • create template: category + designation level + name + trigger
     • design: web editor (TipTap) or upload a Word .docx
     • insert {{placeholders}} (employee / signer / custom fields)
     • configure signers (Sequential / Parallel; Sign / Approve / Acknowledge)
        │  (status Draft → Active)
        ▼
   SURFACE
     • onboarding/exit screens match templates by trigger keyword
        │
        ▼
   GENERATE (per employee)
     • select employees → fill custom-field values → preview → generate
        │
        ▼
   SIGN (optional)
     • send for signature → signers act (typed name + optional drawn signature)
     • reminders (in-app), reject/cancel
        │
        ▼
   COMPLETE
     • signed PDF / DOCX; email to employee; stored in the Evidence Vault
```

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Templates list (`HrDocumentTemplates.tsx`)
KPIs (Total/Active/Draft/Deprecated); category tabs + designation chips; table (Code, Name, Version, Auto-Trigger, Status, **Generate**, Actions).

### 4.2 Template editor (`TemplateForm` + `TemplateEditor`)
3 steps: **Setup** (category, designation level, name/code, toggles), **Lifecycle & Signing** (trigger, signing mode, signer rows with role/action/days), **Design** (TipTap web editor with a placeholder sidebar, or MS-Word upload). Header/footer config (logo, title/subtitle, footer text).

### 4.3 Generate (`GenerateDocument`)
Select employees → enter custom-field values per employee → preview → generate (persist) and/or send for signature.

### 4.4 Sign & track
Signer inbox, approver actions, HR send/track/remind, and download of signed PDFs from the profile Vault.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Templates are scoped by category + designation level |
| 2 | Codes/version auto-managed; status Draft/Active/Deprecated |
| 3 | Every "Sign" signer needs a `{{Signer{N}Sign}}` slot before publish |
| 4 | Generation requires an Active template |
| 5 | Placeholders resolve from employee / signer / custom-field inputs |
| 6 | Signers act in Sequential order or in Parallel; run completes when all act |
| 7 | Reject/cancel closes the run; reminders are in-app |
| 8 | Trigger binding drives onboarding/exit auto-surfacing |

---

## 6. STATUS MODELS
- **Template:** Draft · Active · Deprecated.
- **Generated document:** Generated · … (Sent/Viewed/Acknowledged/Signed).
- **Signature run:** Pending · In Progress · Completed · Rejected · Cancelled.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Signature auth | The signature controller isn't permission-gated (tenant + signer identity only) |
| Reminders | In-app only (not email) |
| Integrity | No DB foreign keys; templates hard-delete (only generated docs soft-delete) |
| E-sign scope | Internal signatures only (Zoho Sign is the separate CLM module) |

---

*Related documents: DOCUMENT_TEMPLATES_TECHNICAL_DOCUMENTATION.md · DOCUMENT_TEMPLATES_CODE_WALKTHROUGH.md · DOCUMENT_TEMPLATES_API_DOCUMENTATION.md*

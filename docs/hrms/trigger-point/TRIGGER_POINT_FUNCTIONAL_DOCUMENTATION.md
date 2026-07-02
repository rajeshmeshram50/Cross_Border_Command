# TRIGGER POINT MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Trigger Point Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Trigger Point Master defines the **lifecycle events** (Onboarding, Exit, Promotion, …) that HR Document Templates attach to. When an employee reaches a lifecycle stage (e.g. onboarding or exit), the system surfaces the templates bound to that trigger — enabling auto-generation of the right documents at the right moment.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Right doc, right time | Templates auto-surface at the matching lifecycle stage |
| Simple taxonomy | A short, tenant-managed list of trigger names |
| Reuse | One trigger drives many templates |

### 1.3 Key features
- **Define triggers** (module name, description, status) via the generic Master UI.
- **Bind templates** to a trigger in the template form.
- **Runtime matching** by keyword on the onboarding/exit screens.
- **Seeded canon** (Onboarding, Exit Management, Exit Process, Promotion).

---

## 2. ROLES & ACCESS
Gated by **`master.trigger_point`** (view/add/edit/delete). Super-admin bypasses. Lives under the "Document & Evidence" master category.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                    TRIGGER POINT USAGE                             │
└───────────────────────────────────────────────────────────────────┘
   HR defines a Trigger Point (e.g. "Onboarding", "Exit Management")
        │
        ▼
   Template author binds a Document Template to the trigger (Step 2)
        │
        ▼
   Employee reaches a lifecycle stage (Onboarding / Exit)
        │  screen calls /hr-document-templates/match?trigger_keyword=onboarding|exit
        │  → keyword LIKE match on module_name → templates for that trigger
        ▼
   Matching templates surface for preview / generate / signature
```

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Trigger Point Master (generic Master page)
```
┌───────────────────────────────────────────────────────────────────┐
│  Trigger Point Master                              [+ Add Trigger] │
│  [Total Triggers][Active][Inactive]                               │
│  Module Name │ Description │ Status │ Actions                     │
└───────────────────────────────────────────────────────────────────┘
```
Add/Edit: Module Name (required, e.g. "Onboarding, Offboarding, Event Based"), Description, Status (Active/Inactive).

### 4.2 In the Document Template form
Step 2 "Lifecycle & Signing" — a required **Trigger** dropdown (from `/master/trigger_point`) that stores `trigger_point_id` on the template.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Module name is required and unique (case-insensitive) per tenant |
| 2 | Templates bind to exactly one trigger point |
| 3 | Runtime matching is a **substring** keyword match on module name |
| 4 | Seeded canon: Onboarding, Exit Management, Exit Process, Promotion |
| 5 | Status Active/Inactive controls availability |
| 6 | Deleting a trigger used by templates leaves them without a trigger |

---

## 6. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Matching | Substring, so "Pre-Onboarding" also matches `onboarding`; `exit` matches both Exit rows |
| Duplicates | Two exit-flavoured canonical rows exist (Exit Management + Exit Process) |
| Integrity | No FK/soft-delete; canonical rows are deletable (can break template matching) |
| Scope | Same name may exist globally and per branch |

---

*Related documents: TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md · TRIGGER_POINT_CODE_WALKTHROUGH.md · TRIGGER_POINT_API_DOCUMENTATION.md*

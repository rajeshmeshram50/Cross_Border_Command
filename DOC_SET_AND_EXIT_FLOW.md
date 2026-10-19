# Document-Set + Exit Flow (#24, #152)

How onboarding **and** exit documents are selected, finalized, sent for signature,
signed, and how that drives stage/exit completion. Also covers the signing
"certificate" (Audit Trail + signed PDF).

> **Before testing, run both migrations:**
> ```
> php artisan migrate
> ```
> - `2026_10_19_000001` — creates the doc-set tables
> - `2026_10_19_000002` — adds the `kind` column (onboarding vs exit)

---

## 1. Why this exists

**Old problem (#24):** every document a template matched was *required*. Deprecating
a document that was already out for signature left onboarding/exit stuck forever —
it was "awaiting signature" on a document that could never be signed.

**New model:** HR **ticks** which documents a person actually needs, **finalizes**
that set, and completion is measured only against the **finalized ticked set**.
A document can't be edited or deprecated while it's out for signature.

The same mechanism now serves **onboarding** (Stage 5 — Policies & Agreements) and
**exit** (Exit Documents Management), distinguished by `kind = onboarding | exit`.

---

## 2. Document-set lifecycle (states)

```
   ┌─────────────┐   tick docs    ┌─────────────┐   Finalize    ┌─────────────┐
   │  (no set)   │ ─────────────▶ │  WORKING    │ ────────────▶ │  FINALIZED  │
   │ all matched │   (auto-save)  │  editable   │               │   locked    │
   │  pre-ticked │                │  selection  │ ◀──────────── │             │
   └─────────────┘                └─────────────┘   Re-open     └─────────────┘
                                                   (until the lifecycle
                                                    is complete)
```

- **No set yet** → every matched document shows ticked (the default), nothing enforced.
- **Working** → HR ticks/unticks; each change auto-saves.
- **Finalized** → the ticked set is frozen as the requirement; drives completion.
- **Re-open** → unlocks the set to change it again. Allowed **until the lifecycle
  is complete** (onboarding reaches stage 6 / the exit is completed). After that,
  sealed permanently.

### Rules enforced (UI + server)

| Rule | Behaviour |
|---|---|
| **Send for Signature** | Only after the set is **finalized**, and only for **ticked** docs. Otherwise a toast explains. |
| **Unticking** | A doc that is **sent or signed** can't be unticked (checkbox locked + toast). |
| **Edit / Deprecate template** | Blocked while the template is **out for signature** (Pending/In Progress run). Buttons muted in the Document Templates list + server refuses. |
| **Re-open** | Allowed until the lifecycle completes; then sealed. |
| **Completion** | Only when the set is **finalized AND every ticked document is signed**. A ticked doc retired before it was ever sent is dropped (doesn't block). |

---

## 3. Onboarding — Stage 5 (Policies & Agreements)

1. HR opens the employee's onboarding → **Stage 5**.
2. **Tick** the documents this hire needs → **Finalize document set**.
3. **Send for Signature** on each ticked document.
4. Signers sign (see §5). Each signed doc counts toward the set.
5. Stage 5 shows **n / m signed**; it completes when the finalized set is 100% signed.
6. **Next Stage / Complete Onboarding** is blocked until then, with a precise reason
   ("finalize the set" → "X of Y awaiting signature").

> Note: onboarding completion also requires the other stages (e.g. **Stage 2
> Document Management** needs the employee's identity/education/bank documents
> uploaded & verified) — independent of Stage 5.

---

## 4. Exit — the six stages

Order (Notice Period Payment only appears when the exit recovers notice pay):

| # | Stage (`key`) | What happens |
|---|---|---|
| 1 | **Exit Initiation & Approval** (`initiation`) | Record exit type, reason, notice/last-working dates, approvals. |
| 2 | **Notice Period Payment** (`notice_payment`) | *(recover exits only)* Record, verify and approve notice-period recovery. |
| 3 | **Clearance & Handover** (`clearance`) | Confirm asset handover, collect every departmental clearance. |
| 4 | **Full & Final Settlement** (`fnf`) | Calculate final settlement, deductions, process payment. |
| 5 | **Exit Documents Management** (`documents`) | **← the doc-set feature lives here.** Tick → Finalize → Send → Sign. |
| 6 | **Final Deactivation & Closure** (`closure`) | Final validation checklist, lock profile, close the case. |

### What happens in Stage 5 (Exit Documents) now

1. HR ticks the exit documents this person needs (Relieving Letter, Experience
   Letter, Exit Clearance, F&F, NOC, …) → **Finalize document set**.
2. **Send for Signature** on each ticked document (still subject to the existing
   "release documents" gate, which was left in place).
3. Signers sign. The stage **%**, the **readiness checklist**, and the
   **Complete Exit** gate all measure against the **finalized ticked set**.
4. **Complete Exit** is refused until: the set is finalized **and** every ticked
   exit document is fully signed (plus the other stages' own gates — clearances,
   F&F, HR sign-off, etc.).

---

## 5. Signing & the "certificate"

HR documents are signed **in-app** (not Zoho for HR docs):

```
Send ──▶ run created (status Pending, signers resolved from ROLES at send time)
      ──▶ each signer signs in order (sequential) or any order (parallel)
      ──▶ status: Pending → In Progress → Completed
```

- **Roles → people at send time:** "Employee" → the employee's own user, "Reporting
  Manager" → their current manager, "CEO/Client" → the client admin. (The signer
  needs an **active user account** — if "Employee" has no active user, the send is
  refused: "no active user resolves to Employee".)
- **The certificate / proof of signing** for HR docs = the **Audit Trail** +
  the **signed PDF**:
  - **Audit Trail** (Evidence Vault → a document → *Audit Trail*): the full lifecycle
    — Sent → each signer's "Signed by … (role)" with timestamp → reminders →
    "Signed & completed", with an overall progress bar.
  - **Signed PDF** (Download): the document with each signer's drawn signature image
    embedded.
  - *(CLM/Zoho-signed documents have a separate Zoho completion certificate via
    `ZohoSignService::downloadCertificate` — that's a different pathway from the HR
    in-app signing above.)*

---

## 6. Where it lives (for the reviewer)

**Backend**
- `app/Http/Controllers/Api/HrOnboardingDocSetController.php` — show / save / finalize / reopen (takes `?kind=onboarding|exit`).
- `app/Models/HrOnboardingDocSelection.php`, `HrOnboardingDocsetLock.php`
- `app/Support/HrTemplateMatch.php` — `onboardingTemplatesFor` / `exitTemplatesFor`.
- `app/Support/OnboardingGuard.php` — finalized-set completion (onboarding backstop).
- `app/Http/Controllers/Api/HrDocumentTemplateController.php` — edit/deprecate guard + `out_for_signature` flag on the list.
- Routes: `GET|PUT /employees/{id}/onboarding-doc-set`, `POST …/finalize`, `POST …/reopen`.

**Frontend**
- `resources/js/pages/employee-onboarding/HrEmployeeOnboarding.tsx` — Stage 5.
- `resources/js/pages/hrms/HrExitManagement.tsx` — Exit Documents stage.
- `resources/js/pages/hrms/HrDocumentTemplates.tsx` — muted Edit/Deprecate when out for signature.

**Data model**
- `hr_onboarding_doc_selections` (employee_id, **kind**, template_id) — one row per ticked doc.
- `hr_onboarding_docset_locks` (employee_id, **kind**, finalized_at) — the finalize lock; unique per (employee, kind).

---

## 7. Test checklist

- [ ] Run both migrations.
- [ ] **Onboarding:** tick docs → Finalize → Send → sign → Stage 5 hits 100%.
- [ ] Try **Send before finalize** → blocked with toast.
- [ ] Try to **untick a sent/signed** doc → blocked with toast.
- [ ] **Deprecate/Edit** a template that's out for signature (Document Templates) → muted + toast; server refuses.
- [ ] **Re-open** before completion works; after completion it's sealed.
- [ ] **Exit:** same checks in Exit Documents Management; Complete Exit blocked until the finalized set is fully signed.
- [ ] A signer with **no active user** → send refused (create/link the user first).

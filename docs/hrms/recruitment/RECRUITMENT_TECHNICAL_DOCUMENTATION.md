# RECRUITMENT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Recruitment (Hiring Requests → Requisitions → Candidates)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Recruitment covers the full pre-hire funnel in three linked stages:
1. **Hiring Request** — a manager's requisition (Draft → Submitted → Approved …).
2. **Recruitment** — an open requisition/campaign created from (or independent of) a hiring request.
3. **Candidate** — the applicant pipeline (Applied → … → Selected/Offered/Rejected) under a recruitment.

All three controllers gate on a single permission slug: **`hr.recruitment`** (under parent `hr.core`).

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrRecruitment.tsx  (recruitments list + hiring-request modals)       │
│  HrCandidates.tsx   (per-recruitment candidate pipeline)              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for CV)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  HiringRequestController  ── convert ──▶  RecruitmentController        │
│                                              │ recruitment_id           │
│                                              ▼                           │
│                                        CandidateController              │
│  All: authorize('hr.recruitment') · applyScope · lazy lifecycle       │
│       (expire overdue recruitments / auto-reject overdue requests)    │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  hiring_requests · recruitments (hiring_request_id) · candidates       │
│  (all soft-deletes; no DB FK constraints; tenant + status indexes)    │
│  CVs on the public disk                                               │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/
  HiringRequestController.php   # requisitions
  RecruitmentController.php     # open recruitments
  CandidateController.php       # applicant pipeline (+ CSV/XLSX import/export)
app/Models/{HiringRequest,Recruitment,Candidate}.php
database/migrations/
  2026_05_01_100001_create_recruitments_table.php (+ add_hiring_request_id)
  2026_05_01_100002_create_hiring_requests_table.php
  2026_05_01_100003_create_candidates_table.php (+ add_referred_by)
resources/js/pages/recruitment/{HrRecruitment,HrCandidates}.tsx
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Files | CV on `public` disk; CSV/XLSX import via native parser (ZipArchive+SimpleXML) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · xlsx |

---

## 3. DATABASE SCHEMA

### 3.1 `hiring_requests` (SoftDeletes; no DB FKs)
Tenancy (`client_id`/`branch_id`/`created_by`), `code` (`HRQ-###`), `title`, `job_role`, `department_id`, `team`, `requested_by_name`, `request_date`, `openings` (default 1), `employment_type`, `work_mode`, `urgency` (default Medium), `job_description`, `daily_responsibilities`, `required_skills`, `required_experience`, `required_qualification`, `preferred_profile`, `request_type`, `business_justification`, `hiring_need_reason`, `current_team_gap`, `what_if_not_filled`, `target_join_date`, **`status`** (default Draft). Index `(client_id, branch_id, status)`.

### 3.2 `recruitments` (SoftDeletes; no DB FKs)
Tenancy, **`hiring_request_id`** (link, no FK), `code` (`REC-###`), `job_title` (required), `department_id`, `designation_id`, `primary_role_id`, `employment_type`, `openings` (default 1), `experience`, `work_mode`, `ctc_range`, `priority` (default Medium), `hiring_manager_id`, `assigned_hr_id`, `start_date`, `deadline`, `job_description`, `requirements`, `post_on_portal`/`notify_team_leads`/`enable_referral_bonus` (booleans), **`status`** (default In Progress), `cancel_reason`, `cancel_notes`. Index `(client_id, branch_id, status)`.

### 3.3 `candidates` (SoftDeletes; no DB FKs)
Tenancy, **`recruitment_id`** (required), `name` (required), `email`, `mobile`, `current_address`, `qualification`, `experience_years` (decimal), `mode_of_transport`, `distance_km`, `current_salary_lpa`, `expected_salary_lpa`, `notice_period`, `source`, **`referred_by_id`/`referred_by_name`**, `cv_path`, `cv_original_name`, **`status`** (default Applied), `rejection_reason`, `status_notes`. Indexes `(recruitment_id, status)`, `(client_id, branch_id, status)`.

---

## 4. MODELS

| Model | Table | Status enum | Key relations |
|---|---|---|---|
| `HiringRequest` | hiring_requests | Draft / Submitted / Under Review / Approved / Sent Back / Rejected | client, branch, creator, department |
| `Recruitment` | recruitments | In Progress / Completed / Cancelled / Expired | client, branch, creator, department, designation, primaryRole, hiringManager, assignedHr (both `withTrashed`) |
| `Candidate` | candidates | Applied / Shortlisted / In Interview / Final Interview / Selected / Offered / Rejected / On Hold | client, branch, creator, recruitment, referrer (Employee); appends `cv_url`, `initials`, `accent` |

All three use `SoftDeletes`; money/experience fields cast `decimal:2`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/recruitments/next-code',   [RecruitmentController::class, 'nextCode']);
    Route::apiResource('recruitments', RecruitmentController::class);

    Route::get('/hiring-requests/next-code', [HiringRequestController::class, 'nextCode']);
    Route::apiResource('hiring-requests', HiringRequestController::class);

    Route::get  ('/recruitments/{recruitment}/candidates/summary', [CandidateController::class, 'recruitmentSummary']);
    Route::patch('/candidates/{candidate}/status',                 [CandidateController::class, 'updateStatus']);
    Route::get  ('/candidates/stats',   [CandidateController::class, 'stats']);
    Route::get  ('/candidates/sample',  [CandidateController::class, 'sample']);
    Route::post ('/candidates/import',  [CandidateController::class, 'import']);
    Route::get  ('/candidates/export',  [CandidateController::class, 'export']);
    Route::apiResource('candidates', CandidateController::class);
});
// PUBLIC (query-token auth):
Route::get('/candidates/{candidate}/cv', [CandidateController::class, 'downloadCv'])->name('candidates.cv');
```
Full detail in **RECRUITMENT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### 6.1 Shared mechanics
- **Permission slug `hr.recruitment`** for all three (flags view/add/edit/delete).
- **`authorize()`** — super_admin & client_admin pass; in Recruitment & HiringRequest, **reporting managers pass implicitly**; else check the `permissions` row; fallback allows client_admin/branch_user if the module isn't seeded. (CandidateController is stricter: only super_admin bypasses.)
- **`applyScope()`** — client-level + globals for admins (+ switcher); branch-isolated for branch users/employees.
- **Lazy lifecycle** (no scheduler): recruitments auto-**Expire** past deadline on read; submitted hiring requests auto-**Reject** past `target_join_date` when unconverted.
- **`guardHierarchicalAction`** blocks deleting rows created by a higher-privileged user.

### 6.2 Key rules
- **Recruitment → Completed** blocked until `Selected` candidates ≥ `openings`.
- **Candidate → Selected** capped at `openings`.
- **Candidate creation** blocked when the parent recruitment is closed/expired/past-deadline (`guardRecruitmentOpen`).
- **Duplicate guards:** recruitment (job_title+department), hiring request (title+department), candidate (email or mobile-digits per recruitment).
- **Emails:** hiring-request submit → `HiringRequestCreatedMail` + notify manager; candidate terminal transition → `CandidateSelectedMail` / `CandidateRejectedMail`.
- **Import/export:** CSV template + bulk import (only "Final Round Selected"/"Selected" rows accepted; dups skipped); CSV export honouring filters.

---

## 7. FRONTEND

### 7.1 `HrRecruitment.tsx`
Recruitments list with status tabs (In Progress/Completed/Cancelled/Expired) + KPI strip; hiring-request management via modals (Raise Request, Requests List, View/Reject, Create Recruitment — the **convert flow** prefills the recruitment form and links via `hiring_request_id`). Endpoints: `GET /recruitments`, `/candidates/stats`, `/hiring-requests`, `POST/PUT /recruitments`, `POST/PUT /hiring-requests`. Row actions gated by status (RBAC is at route/API level).

### 7.2 `HrCandidates.tsx`
Per-recruitment pipeline. Summary card + candidate table (Name, Email, Mobile, Exp, Salaries, Notice, Source, CV, Status, Actions). Tabs: Final Round Selected / Selected / Rejected. Create/edit form (Basic / Compensation / Source / CV / Status). Import/export/sample modals. Endpoints: `GET /recruitments/{id}/candidates/summary`, `GET /candidates?recruitment_id=`, `PATCH /candidates/{id}/status`, `POST /candidates` (+ `_method=PUT` edit), `/candidates/import|export|sample`, `/candidates/{id}/cv`.

**Candidate pipeline stages:** Applied → Shortlisted → In Interview → Final Interview → Selected → Offered → Rejected → On Hold.

---

## 8. SECURITY & CAVEATS
1. All three gate on **`hr.recruitment`**; Recruitment/HiringRequest additionally grant implicit access to reporting managers; Candidate does not.
2. **No DB foreign keys** on any of the three tables (soft-delete-friendly).
3. **Lazy lifecycle** transitions run on list read (no scheduler).
4. **CV download** is a public route authenticated by a `?token=` query param.
5. Copy mismatches: candidate CV inline error says "10 MB" but the cap is **2 MB**; export is labelled `.xlsx` but is a `.csv`.
6. Completion gate (Selected ≥ openings) and Selected cap (≤ openings) enforced server-side.

---

## 9. METRICS
| Metric | Value |
|---|---|
| Controllers | 3 |
| Permission slug | hr.recruitment |
| Tables | 3 (hiring_requests, recruitments, candidates) |
| DB FKs | none |
| Candidate stages | 8 |
| Test coverage | none automated |

---

*Related documents: RECRUITMENT_FUNCTIONAL_DOCUMENTATION.md · RECRUITMENT_CODE_WALKTHROUGH.md · RECRUITMENT_API_DOCUMENTATION.md*

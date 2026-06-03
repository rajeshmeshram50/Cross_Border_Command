# Part 09 — HR: Recruitment, Hiring Requests, Candidates, Custom Fields, Document Templates, Generated Documents, Overview

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}`. Permission module: `hr.recruitment` (recruitment/hiring/candidates), `hr.custom_fields`, `hr.doc_templates` (templates + generated docs). All reads/writes are tenant-scoped by `client_id` / `branch_id`; the SPA auto-injects `?branch_id=<active>` on GETs.

---

## RecruitmentController

Recruitment is the top of the hiring pipeline (Recruitment → Hiring Request → Candidate). Codes are per-tenant sequential `REC-NNN`.

### GET /api/recruitments
**Action:** `RecruitmentController@index` — list recruitments for the tenant, newest first.
**Auth:** Bearer token required
**Query params:** `search` (job_title/code, ilike), `status` (`In Progress` | `Completed` | `Cancelled`), `department_id`, `priority` (`Critical` | `High` | `Medium` | `Low`), `employment_type` (`Full Time` | `Part Time` | `Contract` | `Internship`), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/recruitments?status=In%20Progress&priority=High' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/recruitments
**Action:** `RecruitmentController@store` — create a recruitment; allocates `REC-NNN` under a row lock. Rejects duplicate (job_title + department_id) for the tenant.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/recruitments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "job_title": "Senior Export Documentation Executive",
  "department_id": 3,
  "designation_id": 7,
  "primary_role_id": 2,
  "hiring_request_id": null,
  "employment_type": "Full Time",
  "openings": 2,
  "experience": "3-5 years",
  "work_mode": "On-site",
  "ctc_range": "8-12 LPA",
  "priority": "High",
  "hiring_manager_id": 14,
  "assigned_hr_id": 9,
  "start_date": "2026-06-10",
  "deadline": "2026-07-31",
  "job_description": "Handle export documentation and compliance.",
  "requirements": "Knowledge of DGFT, customs.",
  "post_on_portal": true,
  "notify_team_leads": false,
  "enable_referral_bonus": false,
  "status": "In Progress"
}'
```

**Body fields:**
- **Required:** `job_title` (string ≤191), `department_id` (int, exists master_departments), `designation_id` (int, exists master_designations)
- **Optional:** `primary_role_id` (int, exists master_roles), `hiring_request_id` (int, exists hiring_requests), `employment_type` (enum: Full Time/Part Time/Contract/Internship), `openings` (int 1–9999), `experience` (string ≤30), `work_mode` (enum: On-site/Remote/Hybrid/Flexible), `ctc_range` (string ≤50), `priority` (enum: Critical/High/Medium/Low), `hiring_manager_id` (int, exists employees), `assigned_hr_id` (int, exists employees), `start_date` (date), `deadline` (date, ≥ start_date), `job_description` (string), `requirements` (string), `post_on_portal`/`notify_team_leads`/`enable_referral_bonus` (bool), `status` (enum: In Progress/Completed/Cancelled — defaults In Progress), `cancel_reason` (string ≤100), `cancel_notes` (string)

### GET /api/recruitments/next-code
**Action:** `RecruitmentController@nextCode` — preview the next `REC-NNN` for the tenant (no lock).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/recruitments/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/recruitments/{recruitment}
**Action:** `RecruitmentController@show` — fetch one recruitment with nested names.
**Auth:** Bearer token required
**Path params:** `{recruitment}` = recruitment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/recruitments/12' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/recruitments/{recruitment}
**Action:** `RecruitmentController@update` — update a recruitment. Re-validates dup guard; blocks `Completed` until `Selected` candidates ≥ openings.
**Auth:** Bearer token required
**Path params:** `{recruitment}` = recruitment id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/recruitments/12' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "priority": "Critical",
  "openings": 3,
  "status": "In Progress"
}'
```

**Body fields:** Same schema as store but all fields use `sometimes` (only `job_title`, `department_id`, `designation_id` carry `required` when present). Marking `status: "Completed"` requires every opening filled by a Selected candidate.

### DELETE /api/recruitments/{recruitment}
**Action:** `RecruitmentController@destroy` — soft-delete a recruitment (blocked if created by a higher-privileged user).
**Auth:** Bearer token required
**Path params:** `{recruitment}` = recruitment id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/recruitments/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## HiringRequestController

Hiring requests feed recruitments. Codes are per-tenant sequential `HRQ-NNN`. Reporting managers get implicit access. Submitting (not draft) emails the creator's reporting manager.

### GET /api/hiring-requests
**Action:** `HiringRequestController@index` — list hiring requests, newest first.
**Auth:** Bearer token required
**Query params:** `search` (title/job_role/code, ilike), `status` (`Draft` | `Submitted` | `Under Review` | `Approved` | `Sent Back` | `Rejected`), `urgency` (`Low` | `Medium` | `High` | `Critical`), `department_id`, `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hiring-requests?status=Submitted&urgency=High' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hiring-requests
**Action:** `HiringRequestController@store` — create a hiring request; allocates `HRQ-NNN`. Rejects duplicate (title + department_id). On `status=Submitted`, emails the creator's reporting manager (best-effort).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hiring-requests' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Logistics Coordinator - Mumbai Branch",
  "job_role": "Logistics Coordinator",
  "department_id": 4,
  "team": "Shipments",
  "requested_by_name": "Anil Kapoor",
  "request_date": "2026-06-03",
  "openings": 1,
  "employment_type": "Full-time",
  "work_mode": "Onsite",
  "urgency": "High",
  "job_description": "Coordinate inbound and outbound shipments.",
  "daily_responsibilities": "Track containers, liaise with CHA.",
  "required_skills": "Incoterms, customs clearance",
  "required_experience": "2-4 years",
  "required_qualification": "Graduate",
  "preferred_profile": "Prior export/import experience",
  "request_type": "New Position",
  "business_justification": "Volume growth in Q2.",
  "target_join_date": "2026-07-15",
  "status": "Submitted"
}'
```

**Body fields:**
- **Required on Submit** (relaxed to nullable on Draft / update): `title` (string ≤191), `job_role` (string ≤191), `department_id` (int, exists master_departments), `openings` (int 1–9999), `employment_type` (enum: Full-time/Part-time/Contract/Intern), `work_mode` (enum: Onsite/Remote/Hybrid/Flexible), `urgency` (enum: Low/Medium/High/Critical), `job_description` (string), `required_skills` (string ≤255), `required_experience` (string ≤30)
- **Optional:** `team` (string ≤100), `requested_by_name` (string ≤150), `request_date` (date), `daily_responsibilities` (string), `required_qualification` (string ≤100), `preferred_profile` (string ≤191), `request_type` (enum: New Position/Replacement Hiring/Backfill/Expansion Hiring/Intern Requirement/Urgent Temporary Support), `business_justification`/`hiring_need_reason`/`current_team_gap`/`what_if_not_filled` (string), `target_join_date` (date, ≥ today), `status` (enum: Draft/Submitted/Under Review/Approved/Sent Back/Rejected — defaults Submitted). Send `status: "Draft"` to relax all required fields.

### GET /api/hiring-requests/next-code
**Action:** `HiringRequestController@nextCode` — preview next `HRQ-NNN`.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/hiring-requests/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hiring-requests/{hiring_request}
**Action:** `HiringRequestController@show` — fetch one hiring request.
**Auth:** Bearer token required
**Path params:** `{hiring_request}` = hiring request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hiring-requests/5' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/hiring-requests/{hiring_request}
**Action:** `HiringRequestController@update` — update a hiring request. Fires the manager email exactly once on a Draft→Submitted transition.
**Auth:** Bearer token required
**Path params:** `{hiring_request}` = hiring request id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/hiring-requests/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "urgency": "Critical",
  "status": "Submitted"
}'
```

**Body fields:** Same schema as store, all nullable on update.

### DELETE /api/hiring-requests/{hiring_request}
**Action:** `HiringRequestController@destroy` — soft-delete a hiring request (hierarchical guard applies).
**Auth:** Bearer token required
**Path params:** `{hiring_request}` = hiring request id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/hiring-requests/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

## CandidateController

Candidates belong to a parent recruitment (inherit its tenant). CV is a file upload; status moves through the interview pipeline. Import/export via CSV (Excel-compatible).

### GET /api/candidates
**Action:** `CandidateController@index` — list candidates, newest first. Invalid `status`/`source` filters return 422.
**Auth:** Bearer token required
**Query params:** `recruitment_id`, `status` (Applied/Shortlisted/In Interview/Final Interview/Selected/Offered/Rejected/On Hold), `source` (LinkedIn/Naukri/Indeed/Referral/Company Website/Walk-in/Recruitment Agency/Internal/Other), `search` (name/email/mobile, ilike), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates?recruitment_id=12&status=Shortlisted' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/candidates
**Action:** `CandidateController@store` — create a candidate under a recruitment. Multipart (CV optional). Rejects duplicate email within the same recruitment.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/candidates' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'recruitment_id=12' \
  --form 'name=Priya Nair' \
  --form 'email=priya.nair@example.com' \
  --form 'mobile=+91 9812345678' \
  --form 'current_address=Andheri East, Mumbai' \
  --form 'qualification=MBA Finance' \
  --form 'experience_years=5' \
  --form 'mode_of_transport=Two-wheeler' \
  --form 'distance_km=12.5' \
  --form 'current_salary_lpa=15' \
  --form 'expected_salary_lpa=22' \
  --form 'notice_period=30 Days' \
  --form 'source=LinkedIn' \
  --form 'status=Applied' \
  --form 'cv=@/path/to/priya_nair_cv.pdf'
```

**Body fields (multipart/form-data):**
- **Required:** `recruitment_id` (int, exists recruitments), `name` (string ≤150)
- **Optional:** `email` (email ≤191), `mobile` (string ≤20, digits 7–15, allows `+`/spaces/dashes), `current_address` (string ≤500), `qualification` (string ≤191), `experience_years` (numeric 0–99.99), `mode_of_transport` (enum: Walk/Bicycle/Two-wheeler/Four-wheeler/Public Transport/Other), `distance_km` (numeric 0–99999.99), `current_salary_lpa` (numeric 0–9999.99), `expected_salary_lpa` (numeric 0–9999.99), `notice_period` (enum: Immediate/15 Days/30 Days/45 Days/60 Days/90 Days), `source` (enum, see index filters), `cv` (file: pdf/doc/docx, ≤2 MB), `status` (enum, see pipeline list), `rejection_reason` (string ≤100), `status_notes` (string)

### GET /api/candidates/export
**Action:** `CandidateController@export` — stream filtered candidate list as CSV (UTF-8 BOM, Excel-friendly).
**Auth:** Bearer token required
**Query params:** `recruitment_id`, `status`, `source`, `search`, `ids` (comma-separated id list for "current view only"), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates/export?recruitment_id=12' \
  --header 'Authorization: Bearer {{token}}' \
  --output candidates_export.csv
```

### POST /api/candidates/import
**Action:** `CandidateController@import` — bulk import candidates from a CSV under one recruitment. Multipart. Returns `{ created, skipped, errors:[{row,message}] }`. Duplicates (same email in recruitment) are skipped, not failed.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/candidates/import' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'recruitment_id=12' \
  --form 'file=@/path/to/candidates.csv'
```

**Body fields (multipart/form-data):**
- **Required:** `recruitment_id` (int, exists recruitments), `file` (file: csv/txt/xlsx/xls, ≤10 MB — CSV expected; xlsx parsing not supported)
- CSV columns: `Name` (required), `Email`, `Mobile`, `Experience`, `Current Salary`, `Expected Salary`, `Notice Period`, `Source`. Imported rows default to `status=Applied`.

### GET /api/candidates/sample
**Action:** `CandidateController@sample` — download a sample CSV template (header + one dummy row).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates/sample' \
  --header 'Authorization: Bearer {{token}}' \
  --output candidates_sample.csv
```

### GET /api/candidates/stats
**Action:** `CandidateController@stats` — pipeline counts per status for the KPI strip.
**Auth:** Bearer token required
**Query params:** `recruitment_id`, `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates/stats?recruitment_id=12' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/candidates/{candidate}
**Action:** `CandidateController@show` — fetch one candidate (flattened recruitment code/title).
**Auth:** Bearer token required
**Path params:** `{candidate}` = candidate id

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates/88' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/candidates/{candidate}
**Action:** `CandidateController@update` — update a candidate. Multipart (new CV replaces old). Dup-email guard applies.
**Auth:** Bearer token required
**Path params:** `{candidate}` = candidate id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/candidates/88' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'expected_salary_lpa=24' \
  --form 'notice_period=60 Days' \
  --form 'cv=@/path/to/priya_nair_updated_cv.pdf'
```

**Body fields (multipart/form-data):** Same schema as store, all fields `sometimes`. `recruitment_id`/`name` only enforced when present. Send `_method=PUT` with a POST if your client can't multipart on PUT.

### DELETE /api/candidates/{candidate}
**Action:** `CandidateController@destroy` — soft-delete a candidate (CV file retained on disk; hierarchical guard applies).
**Auth:** Bearer token required
**Path params:** `{candidate}` = candidate id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/candidates/88' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/candidates/{candidate}/cv
**Action:** `CandidateController@downloadCv` — stream the candidate's CV file (forces download under original filename). Accepts Bearer header OR `?token=<sanctum>` query for plain anchor clicks.
**Auth:** Bearer token required (or `?token=`)
**Path params:** `{candidate}` = candidate id
**Query params:** `token` (sanctum token, alternative to Authorization header)

```bash
curl -X GET 'http://127.0.0.1:8000/api/candidates/88/cv' \
  --header 'Authorization: Bearer {{token}}' \
  --output priya_nair_cv.pdf
```

### PATCH /api/candidates/{candidate}/status
**Action:** `CandidateController@updateStatus` — move a candidate's pipeline status. `Selected` is capped at the recruitment's openings.
**Auth:** Bearer token required
**Path params:** `{candidate}` = candidate id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/candidates/88/status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "Selected",
  "rejection_reason": null,
  "status_notes": "Cleared final round."
}'
```

**Body fields:**
- **Required:** `status` (enum: Applied/Shortlisted/In Interview/Final Interview/Selected/Offered/Rejected/On Hold)
- **Optional:** `rejection_reason` (string ≤100), `status_notes` (string)

### GET /api/recruitments/{recruitment}/candidates/summary
**Action:** `CandidateController@recruitmentSummary` — read-only recruitment context card (camelCase) for the candidate page.
**Auth:** Bearer token required
**Path params:** `{recruitment}` = recruitment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/recruitments/12/candidates/summary' \
  --header 'Authorization: Bearer {{token}}'
```

---

## HrCustomFieldController

Custom fields are `{{Token}}` variables (PascalCase) not available in employee data; filled manually at generation time. Module: `hr.custom_fields`. `used_in` is derived live by scanning template HTML.

### GET /api/hr-custom-fields
**Action:** `HrCustomFieldController@index` — list custom fields (alpha order) with derived `used_in` / `used_count`.
**Auth:** Bearer token required
**Query params:** `search` (name/description, ilike), `type` (`text` | `date` | `number` | `textarea`), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-custom-fields?type=date' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-custom-fields
**Action:** `HrCustomFieldController@store` — create a custom field. Name must be unique within the branch.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-custom-fields' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "LastWorkingDate",
  "type": "date",
  "description": "Employee final working day for exit documents.",
  "used_in_hint": "Relieving Letter, Experience Certificate"
}'
```

**Body fields:**
- **Required:** `name` (string ≤100, regex `^[A-Za-z_][A-Za-z0-9_]*$` — PascalCase, no spaces), `type` (enum: text/date/number/textarea)
- **Optional:** `description` (string ≤500), `used_in_hint` (string ≤500)

### GET /api/hr-custom-fields/known-tokens
**Action:** `HrCustomFieldController@knownTokens` — token catalogue for the editor sidebar: built-in employee tokens + registered custom fields.
**Auth:** Bearer token required
**Query params:** `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-custom-fields/known-tokens' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-custom-fields/stats
**Action:** `HrCustomFieldController@stats` — counts by type (text/date/number/textarea + "other").
**Auth:** Bearer token required
**Query params:** `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-custom-fields/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-custom-fields/validate-tokens
**Action:** `HrCustomFieldController@validateTokens` — scan an HTML blob for `{{Token}}` occurrences and split into known vs unknown (Signer{N}* treated as known).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-custom-fields/validate-tokens' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "content_html": "<p>Dear {{FullName}}, your last day is {{LastWorkingDate}}. Signed {{Signer1Name}} and {{UnknownField}}.</p>"
}'
```

**Body fields:**
- **Optional:** `content_html` (string — HTML/text to scan; defaults empty). Returns `{ found, known, unknown }`.

### GET /api/hr-custom-fields/{id}
**Action:** `HrCustomFieldController@show` — fetch one custom field with usage info.
**Auth:** Bearer token required
**Path params:** `{id}` = custom field id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-custom-fields/3' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/hr-custom-fields/{id}
**Action:** `HrCustomFieldController@update` — update a custom field (re-checks name uniqueness; hierarchical guard).
**Auth:** Bearer token required
**Path params:** `{id}` = custom field id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/hr-custom-fields/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "LastWorkingDate",
  "type": "date",
  "description": "Updated description."
}'
```

**Body fields:** Same schema as store (`name` + `type` required, `description`/`used_in_hint` optional).

### DELETE /api/hr-custom-fields/{id}
**Action:** `HrCustomFieldController@destroy` — delete a custom field. Refused (422) if referenced by any template.
**Auth:** Bearer token required
**Path params:** `{id}` = custom field id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/hr-custom-fields/3' \
  --header 'Authorization: Bearer {{token}}'
```

---

## HrDocumentTemplateController

Document templates merge `{{placeholder}}` tokens into DOCX/Web output. Module: `hr.doc_templates`. Codes are `CAT-ROLE-NNN` (e.g. `IT-INT-001`) per (client, branch, category, role). Two editors: Web (HTML) and Word (uploaded DOCX).

### GET /api/hr-document-templates
**Action:** `HrDocumentTemplateController@index` — list templates, newest first.
**Auth:** Bearer token required
**Query params:** `search` (name/code/description, ilike), `employee_category` (`IT` | `Non-IT` | `Legal`), `role_type` (Director / CEO | Head of Department (HOD) | Team Leader | Executive | Employee | Intern / Trainee), `doc_type`, `trigger_point_id`, `status` (`Draft` | `Active` | `Deprecated`), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates?employee_category=IT&status=Active' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-templates
**Action:** `HrDocumentTemplateController@store` — create a template; allocates `CAT-ROLE-NNN`. Multipart (optional `docx` switches editor_mode to word).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-templates' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Offer Letter - Executive",
  "description": "Standard offer letter.",
  "employee_category": "IT",
  "role_type": "Executive",
  "doc_type": "Offer Letter",
  "trigger_point_id": 2,
  "version": "v1",
  "is_mandatory": true,
  "requires_signature": true,
  "requires_manager_approval": false,
  "include_in_audit": true,
  "signing_mode": "Sequential",
  "signers": [
    { "role_id": 1, "role_name": "HR Head", "designation_name": "HR Director", "action": "Sign", "days": 3 }
  ],
  "editor_mode": "web",
  "content_html": "<p>Dear {{FullName}}, welcome to {{CompanyName}} as {{Designation}}.</p>",
  "header_config": { "title": "{{CompanyName}}", "align": "right", "logo_height": 60 },
  "footer_config": { "text": "Confidential", "align": "center", "show_page_number": true, "page_number_format": "Page N of M", "page_number_align": "right" },
  "status": "Active"
}'
```

**Body fields:**
- **Required on non-draft create:** `name` (string ≤191) — relaxed to nullable on Draft / update.
- **Optional:** `description` (string), `employee_category` (enum: IT/Non-IT/Legal), `role_type` (enum: Director / CEO | Head of Department (HOD) | Team Leader | Executive | Employee | Intern / Trainee), `doc_type` (string ≤100), `trigger_point_id` (int, exists master_trigger_points), `version` (string ≤10, defaults v1), `is_mandatory`/`requires_signature`/`requires_manager_approval`/`include_in_audit` (bool), `signing_mode` (enum: Sequential/Parallel), `signers` (array of `{role_id?, role_name? ≤100, designation_id?, designation_name? ≤100, action? ≤30, days? 0–365}`), `editor_mode` (enum: web/word), `content_html` (string), `docx` (file: doc/docx ≤20 MB — sets editor_mode=word), `header_config` (object: logo_path/logo_url ≤500, title/subtitle ≤2000, align [left/center/right/space-between], background/text_color ≤30, show_logo/show_title bool, logo_height 24–200, logo_pos/title_pos {x,y 0–100}), `footer_config` (object: text ≤500, align [left/center/right], background/text_color ≤30, show_page_number bool, page_number_align [left/center/right], page_number_format [N / Page N / Page N of M / N / M]), `status` (enum: Draft/Active/Deprecated — defaults Draft)

### GET /api/hr-document-templates/match
**Action:** `HrDocumentTemplateController@matchForEmployee` — return Active templates matching an employee's department-mapped category + designation level (optionally filtered by trigger keyword/name).
**Auth:** Bearer token required
**Query params:** `employee_id` (required, int, exists employees), `trigger_keyword` (preferred — lifecycle word like `onboarding`/`exit`, substring match on module_name, ≤120), `trigger_point_name` (legacy exact match, ≤255), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/match?employee_id=42&trigger_keyword=onboarding' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-templates/next-code
**Action:** `HrDocumentTemplateController@nextCode` — preview next `CAT-ROLE-NNN` for the chosen category/role.
**Auth:** Bearer token required
**Query params:** `employee_category` (defaults IT), `role_type` (defaults Intern)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/next-code?employee_category=IT&role_type=Executive' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-templates/stats
**Action:** `HrDocumentTemplateController@stats` — counts by status + per-category (IT/Non-IT/Legal) breakdown.
**Auth:** Bearer token required
**Query params:** `employee_category`, `role_type`, `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-templates/upload-header-logo
**Action:** `HrDocumentTemplateController@uploadHeaderLogo` — upload a header logo (pre-save; returns `{path, url}` to embed in header_config). Multipart.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-templates/upload-header-logo' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'logo=@/path/to/company_logo.png'
```

**Body fields (multipart/form-data):**
- **Required:** `logo` (file: png/jpg/jpeg/svg/webp, ≤5 MB)

### GET /api/hr-document-templates/{id}
**Action:** `HrDocumentTemplateController@show` — fetch one template.
**Auth:** Bearer token required
**Path params:** `{id}` = template id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/7' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/hr-document-templates/{id}
**Action:** `HrDocumentTemplateController@update` — update a template (re-allocates code if category/role changed; hierarchical guard). Multipart (optional docx).
**Auth:** Bearer token required
**Path params:** `{id}` = template id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/hr-document-templates/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Offer Letter - Executive (v2)",
  "status": "Active",
  "content_html": "<p>Dear {{FullName}}, updated terms apply.</p>"
}'
```

**Body fields:** Same schema as store; all fields nullable on update.

### DELETE /api/hr-document-templates/{id}
**Action:** `HrDocumentTemplateController@destroy` — soft-delete a template (removes stored docx; hierarchical guard).
**Auth:** Bearer token required
**Path params:** `{id}` = template id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/hr-document-templates/7' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-templates/{id}/download
**Action:** `HrDocumentTemplateController@downloadDocx` — download the template as DOCX (prefers a previously uploaded revised docx, else renders from HTML).
**Auth:** Bearer token required
**Path params:** `{id}` = template id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/7/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output template.docx
```

### GET /api/hr-document-templates/{id}/generate
**Action:** `HrDocumentTemplateController@generateForEmployee` — resolve `{{Tokens}}` against an employee and stream the filled DOCX.
**Auth:** Bearer token required
**Path params:** `{id}` = template id
**Query params:** `employee_id` (required, int, exists employees)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/7/generate?employee_id=42' \
  --header 'Authorization: Bearer {{token}}' \
  --output offer_letter.docx
```

### GET /api/hr-document-templates/{id}/preview
**Action:** `HrDocumentTemplateController@previewForEmployee` — return resolved body HTML + header/footer config + used/missing tokens (no DOCX, no DB write).
**Auth:** Bearer token required
**Path params:** `{id}` = template id
**Query params:** `employee_id` (required, int, exists employees)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-templates/7/preview?employee_id=42' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-templates/{id}/upload-docx
**Action:** `HrDocumentTemplateController@uploadDocx` — upload a revised DOCX (stored as-is; best-effort parsed to HTML for the web editor; sets editor_mode=word). Multipart.
**Auth:** Bearer token required
**Path params:** `{id}` = template id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-templates/7/upload-docx' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'docx=@/path/to/revised_template.docx'
```

**Body fields (multipart/form-data):**
- **Required:** `docx` (file: doc/docx, ≤20 MB)

---

## HrGeneratedDocumentController

Generated documents are rendered template+employee instances. Auth piggy-backs on `hr.doc_templates`. Token precedence: employee data → template (signers/company) → operator custom_values (override).

### POST /api/hr-generated-documents
**Action:** `HrGeneratedDocumentController@store` — bulk-generate one row per recipient employee (status=Generated, rendered_html stored). Template must be Active (else 422).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-generated-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "template_id": 7,
  "recipients": [
    { "employee_id": 42, "custom_values": { "LastWorkingDate": "2026-06-30", "EffectiveDate": "2026-06-01" } },
    { "employee_id": 51, "custom_values": {} }
  ]
}'
```

**Body fields:**
- **Required:** `template_id` (int, exists hr_document_templates — must be Active), `recipients` (array, min 1), `recipients.*.employee_id` (int, exists employees)
- **Optional:** `recipients.*.custom_values` (object of TokenName → value; operator overrides win)

### POST /api/hr-generated-documents/preview
**Action:** `HrGeneratedDocumentController@preview` — render one template/employee/custom-values combo and return resolved HTML + token map (no DB write).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-generated-documents/preview' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "template_id": 7,
  "employee_id": 42,
  "custom_values": { "LastWorkingDate": "2026-06-30" }
}'
```

**Body fields:**
- **Required:** `template_id` (int, exists hr_document_templates), `employee_id` (int, exists employees)
- **Optional:** `custom_values` (object of TokenName → value)

### GET /api/hr-generated-documents/{id}
**Action:** `HrGeneratedDocumentController@show` — fetch one generated document with template/employee/generator info.
**Auth:** Bearer token required
**Path params:** `{id}` = generated document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-generated-documents/15' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-generated-documents/{id}/download
**Action:** `HrGeneratedDocumentController@downloadDocx` — build a DOCX from the row's stored rendered_html (with template header/footer) and stream it. Filename `{template_code}-{employee_code}.docx`.
**Auth:** Bearer token required
**Path params:** `{id}` = generated document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-generated-documents/15/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output generated_document.docx
```

---

## HrOverviewController

### GET /api/hrms/overview
**Action:** `HrOverviewController@index` — single aggregate for the HRMS dashboard: KPIs, master totals, department/gender/status splits, 12-month joining + exit trends, recruitment + expense status splits, recent/upcoming joiners, department turnover %, probation snapshot, top expense categories.
**Auth:** Bearer token required
**Query params:** `branch_id` (super_admin drill-in; others auto-bound to their tenant/branch)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hrms/overview' \
  --header 'Authorization: Bearer {{token}}'
```

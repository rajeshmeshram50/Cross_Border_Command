# RECRUITMENT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Recruitment
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Permission slug: **`hr.recruitment`** (view/add/edit/delete). Super-admins bypass; reporting managers get implicit access to hiring-requests & recruitments (not candidates).
- Tenancy scoped; branch users are branch-isolated.
- Responses: arrays for lists; `{ message }` / entity object for actions; `{ message, errors }` for 422.
- Status codes: 200/201 · 401 · 403 · 404 · 422.

---

## 2. ENDPOINT INDEX

### Hiring Requests
| Method | Path |
|---|---|
| GET | `/hiring-requests` · `/hiring-requests/next-code` |
| POST | `/hiring-requests` |
| GET/PUT/DELETE | `/hiring-requests/{id}` |

### Recruitments
| Method | Path |
|---|---|
| GET | `/recruitments` · `/recruitments/next-code` |
| POST | `/recruitments` |
| GET/PUT/DELETE | `/recruitments/{id}` |

### Candidates
| Method | Path |
|---|---|
| GET | `/candidates` · `/candidates/stats` · `/candidates/sample` · `/candidates/export` |
| GET | `/recruitments/{recruitment}/candidates/summary` |
| POST | `/candidates` · `/candidates/import` |
| GET/PUT/DELETE | `/candidates/{id}` |
| PATCH | `/candidates/{candidate}/status` |
| GET | `/candidates/{candidate}/cv` (public, `?token=`) |

---

## 3. HIRING REQUESTS

### POST `/hiring-requests`
**Body (subset):** `title`*, `job_role`*, `department_id`*, `team`, `requested_by_name`, `request_date`, `openings`, `employment_type` (Full-time/Part-time/Contract/Intern), `work_mode`, `urgency` (Low/Medium/High/Critical), `job_description`*, `required_skills`*, `required_experience`*, `request_type` (New Position/Replacement/Backfill/Expansion/Intern/Urgent), `business_justification`, `target_join_date` (≥ today), `status` (default Submitted).
**Response 201:** the hiring request row (`code` `HRQ-###`). Submitting notifies the requester's manager.
**Errors:** 403 · 422 (validation / duplicate title+department).

### PUT `/hiring-requests/{id}`
Update; Draft→Submitted fires the manager notification. **Errors:** 403 · 404 · 422.

---

## 4. RECRUITMENTS

### POST `/recruitments`
**Body (subset):** `job_title`*, `department_id`*, `designation_id`*, `primary_role_id`, `hiring_request_id` (link), `employment_type` (Full Time/Part Time/Contract/Internship), `openings` (1–9999), `experience`, `work_mode` (On-site/Remote/Hybrid/Flexible), `ctc_range`, `priority` (Critical/High/Medium/Low), `hiring_manager_id`, `assigned_hr_id`, `start_date`, `deadline` (> start), `job_description`, `requirements`, `post_on_portal`, `notify_team_leads`, `enable_referral_bonus`.
**Response 201:** the recruitment row (`code` `REC-###`, status In Progress).
**Errors:** 403 · 422.

### PUT `/recruitments/{id}`
Update / cancel / complete. **Completed is rejected unless Selected candidates ≥ openings.** Cancelling accepts `cancel_reason`/`cancel_notes`. Recruitments auto-Expire past deadline on read.
**Errors:** 403 · 404 · 422 (status transition guard).

---

## 5. CANDIDATES

### GET `/candidates`
**Query:** `recruitment_id`, `status` (whitelisted, else 422), `source` (else 422), `search`, `branch_id`.
**Response 200:** serialized candidate rows (flattened `recruitment_code`/`recruitment_title`, `cv_url`, `initials`, `accent`).

### GET `/candidates/stats?recruitment_id=`
```json
{ "total": 20, "applied": 5, "shortlisted": 3, "in_interview": 4, "final_interview": 2,
  "selected": 3, "offered": 1, "rejected": 2, "on_hold": 0 }
```

### POST `/candidates` (multipart)
**Body:** `recruitment_id`*, `name`*, `email`, `mobile`, `current_address`, `qualification`, `experience_years`, `mode_of_transport`, `distance_km`, `current_salary_lpa`, `expected_salary_lpa`, `notice_period`, `source`, `referred_by_id` (required when source=Referral), `cv` (pdf/doc/docx ≤ 2 MB; required on create).
**Behaviour:** blocked if the parent recruitment is closed/expired/past-deadline; duplicate by email or mobile per recruitment rejected; tenant inherited from the recruitment.
**Response 201:** serialized candidate.
**Errors:** 403 · 422.

### PATCH `/candidates/{candidate}/status`
**Body:** `status`* (Applied…On Hold), `rejection_reason` (≤100), `status_notes`.
**Behaviour:** `Selected` is capped at the recruitment's openings; terminal transitions email the candidate.
**Response 200:** serialized candidate.
**Errors:** 403 · 422 (over openings).

### POST `/candidates/import`
**Body:** `recruitment_id`*, `file` (csv/txt/xlsx/xls ≤ 10 MB). Only rows with Status "Final Round Selected"/"Selected" are created; duplicates skipped.
**Response 200:** `{ "created": n, "skipped": m, "errors": [ … ] }`

### GET `/candidates/export` · `/candidates/sample`
Streamed CSV (export honours index filters; sample is a template). Files: `candidates_export.csv`, `candidates_sample.csv`.

### GET `/candidates/{candidate}/cv?token=<token>` (public)
Streams the CV; authenticates via bearer or `?token=`; requires `can_view`.

---

## 6. ERROR EXAMPLES
**422 — completion guard**
```json
{ "message": "Cannot complete: selected candidates are fewer than the openings." }
```
**422 — selection cap**
```json
{ "message": "All openings are already filled." }
```

---

## 7. QUICK REFERENCE

```
POST /hiring-requests                     # raise requisition (HRQ-###)
POST /recruitments {hiring_request_id}    # convert → open recruitment (REC-###)
POST /candidates {recruitment_id, cv}     # add applicant
PATCH /candidates/{id}/status Selected    # move pipeline (capped at openings)
PUT  /recruitments/{id} status=Completed  # requires Selected ≥ openings
```

---

## 8. NOTES (caveats)
1. `hr.recruitment` gates all three; managers get implicit access to requests/recruitments only.
2. No DB foreign keys.
3. CV cap 2 MB (inline copy wrongly says 10 MB); export is `.csv` despite the label.
4. Lifecycle transitions run lazily on list read.

---

*Related documents: RECRUITMENT_TECHNICAL_DOCUMENTATION.md · RECRUITMENT_FUNCTIONAL_DOCUMENTATION.md · RECRUITMENT_CODE_WALKTHROUGH.md*

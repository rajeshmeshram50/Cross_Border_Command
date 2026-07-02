# RECRUITMENT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Recruitment
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: hiring request → convert → recruitment → candidate pipeline → import. Line numbers may drift. Files: `HiringRequestController.php`, `RecruitmentController.php`, `CandidateController.php`, `HrRecruitment.tsx`, `HrCandidates.tsx`.

---

## 1. HIRING REQUEST

### `HiringRequestController::store()` (110)
```php
$this->authorize($request, 'can_add');                 // hr.recruitment
$data = $this->validatePayload($request);              // draft relaxes required→nullable
return DB::transaction(function () {
    $this->guardDuplicate($data, ...);                 // title + department key
    $code = $this->allocateCode(...);                  // HRQ-### under lock
    $row = HiringRequest::create($data + ['code'=>$code, 'status'=>$data['status'] ?? 'Submitted',
                                          'urgency'=>$data['urgency'] ?? 'Medium', ...]);
    if ($row->status === 'Submitted') $this->notifyManager($row);   // emails requester's manager
    return response()->json($row, 201);
});
```
`update()` fires `notifyManager` on a Draft→Submitted transition. `index()` first runs `autoRejectOverdue()` — Submitted requests past `target_join_date` with no linked recruitment flip to Rejected.

---

## 2. RECRUITMENT

### `RecruitmentController::store()` (103)
```php
$this->authorize($request, 'can_add');
$data = $this->validatePayload($request);
return DB::transaction(function () {
    $this->guardDuplicate($data, ...);                 // job_title + department
    $code = $this->allocateCode(...);                  // REC-### under lock
    return response()->json(Recruitment::create($data + ['code'=>$code, 'status'=>'In Progress',
        'client_id'=>$clientId, 'branch_id'=>$branchId, 'created_by'=>$uid]), 201);
});
```

### `update()` (131) — completion guard
```php
$this->authorize($request, 'can_edit');
// guardStatusTransition: Completed blocked until Selected candidates >= openings
// reconcileExpiryStatus: In Progress ↔ Expired vs deadline
```
`index()` runs `expireOverdue()` first (lazy In Progress → Expired past deadline).

### `authorize()` (273) — implicit manager access
```php
if ($user->isSuperAdmin() || $user->isClientAdmin()) return;
// reporting managers pass: Employee where reporting_manager_user_id = user OR reporting_manager_id ∈ user's employee ids
if ($isReportingManager) return;
// else Permission(user_id, module_id, perm=true); fallback allows client_admin/branch_user if module unseeded
```

---

## 3. CANDIDATE PIPELINE

### `CandidateController::store()` (197)
```php
$this->authorize($request, 'can_add');
$data = $this->validatePayload($request);              // recruitment_id required, name required, cv optional
$rec = Recruitment::scoped()->findOrFail($data['recruitment_id']);
$this->guardRecruitmentOpen($rec);                     // 422 if closed/expired/past-deadline
$this->guardDuplicate($data, $rec);                    // email OR mobile-digits per recruitment
// tenant inherited from the parent recruitment
if ($request->hasFile('cv')) [$path,$orig] = $this->storeCv(...);   // public disk
return response()->json($this->serialize($candidate), 201);
```

### `updateStatus()` (348) — pipeline move + cap
```php
$this->authorize($request, 'can_edit');
$data = $request->validate(['status'=>['required', Rule::in(self::STATUSES)], 'rejection_reason'=>'max:100', 'status_notes'=>'']);
if ($data['status'] === 'Selected' && $selectedCount >= $rec->openings)
    return 422;                                        // cap at openings
$candidate->update($data);
// terminal transition → CandidateSelectedMail / CandidateRejectedMail
```

### `import()` (502)
```php
$this->authorize($request, 'can_add');
// native CSV + XLSX parse (ZipArchive + SimpleXML); accept only rows with
// Status "Final Round Selected"/"Selected"; skip duplicates
return response()->json(['created'=>..., 'skipped'=>..., 'errors'=>[...]]);
```

### `downloadCv()` (286) — public route
```php
// route is OUTSIDE the sanctum group; authenticate via bearer OR ?token=
$user = $this->authenticateFromQueryToken($request);
$this->authorize($request, 'can_view');
return response()->download($path);
```

---

## 4. FRONTEND

### `HrRecruitment.tsx`
```tsx
GET  /recruitments · /candidates/stats · /hiring-requests
POST/PUT /recruitments · /hiring-requests
PUT  /recruitments/{id}        // cancel / mark completed
PUT  /hiring-requests/{id}      // reject
// convert: hiring request → Create Recruitment prefilled via HR_TO_REC_* maps; POST includes hiring_request_id
```

### `HrCandidates.tsx`
```tsx
GET  /recruitments/{id}/candidates/summary · /candidates?recruitment_id={id}
PATCH /candidates/{id}/status              // Mark Selected / Rejected (confirm modal)
POST /candidates | POST /candidates/{id}?_method=PUT
POST /candidates/import · GET /candidates/export · /candidates/sample
GET  /candidates/{id}/cv (blob)
// KPI counts computed client-side from the list; recClosed disables Add/Import
```

---

## 5. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Lazy lifecycle | index() of Recruitment/HiringRequest | Expire/auto-reject without a scheduler |
| Convert + link | hiring request → recruitment | `hiring_request_id` ties the funnel |
| Completion/selection guards | Recruitment update / Candidate updateStatus | Openings integrity |
| Implicit manager access | authorize() | Managers manage their own hiring |
| Query-token CV download | downloadCv | Open the file in a new tab |
| Native XLSX import | import() | No external dependency |

---

## 6. NOTES & CAVEATS
- No DB foreign keys on any of the three tables.
- Candidate management requires the explicit `hr.recruitment` grant (no manager implicit access there).
- CV cap is 2 MB (an inline error string wrongly says 10 MB); export file is `.csv` despite the label.
- DB is PostgreSQL — `ilike`, soft deletes, tenant/status indexes.

---

*Related documents: RECRUITMENT_TECHNICAL_DOCUMENTATION.md · RECRUITMENT_FUNCTIONAL_DOCUMENTATION.md · RECRUITMENT_API_DOCUMENTATION.md*

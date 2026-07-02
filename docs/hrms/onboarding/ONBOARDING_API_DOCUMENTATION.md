# EMPLOYEE ONBOARDING MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Onboarding
> Base URL: `{APP_URL}/api`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- **Public** routes (no auth): `GET/POST /onboarding/{token}` — token-gated, rate-limited **30 req/min/IP**.
- **Authenticated** route: `POST /employees/onboarding-invite` (super_admin / client_admin / branch_user).
- Tenancy derived from the invite (public) or the user (invite creation) — never the body.
- Status codes: 200/201 · 401/403 · 404 (invalid token) · 409 (double-submit) · 410 (used/expired/cancelled) · 422 (validation).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Auth | Purpose |
|---|---|---|---|---|
| 1 | POST | `/employees/onboarding-invite` | authed | Create an invite + email link |
| 2 | GET | `/onboarding/{token}` | public | Invite preview + masters |
| 3 | POST | `/onboarding/{token}/complete` | public | Provision employee + login |

Progression (6-stage): `PUT /employees/{id}` with `onboarding_stage_completed` (see the Employee module).

---

## 3. ENDPOINT DETAIL

### 3.1 POST `/employees/onboarding-invite` (authed)
**Body**
```json
{ "invitee_name": "Ravi Kumar", "invitee_email": "ravi@example.com",
  "department_id": 4, "expected_join_date": "2026-07-15", "expiry_days": 15,
  "app_origin": "https://app.example.com" }
```
`expiry_days` ∈ {3,7,15,30} (default 15). Duplicate email within the client → 422.
**Response 201**
```json
{ "message": "Onboarding invite created.",
  "invite": { "id": 51, "invitee_email": "ravi@example.com", "invitee_name": "Ravi Kumar",
              "department_id": 4, "expected_join_date": "2026-07-15",
              "expires_at": "2026-07-16T12:00:00Z",
              "url": "https://app.example.com/onboarding/<64-char-token>", "status": "pending" } }
```
**Errors:** 403 (role) · 422 (validation / duplicate email).

### 3.2 GET `/onboarding/{token}` (public)
**Response 200**
```json
{
  "invite": { "invitee_name": "Ravi Kumar", "invitee_email": "ravi@example.com",
              "department_id": 4, "expected_join_date": "2026-07-15", "expires_at": "…",
              "org_name": "IGC Group", "logo_url": "…", "website": "…" },
  "masters": { "countries": [...], "states": [...], "departments": [...],
               "designations": [...], "roles": [...], "legal_entities": [...] }
}
```
**Errors:** 404 (invalid) · 410 (completed / cancelled / expired — expiry is auto-marked on open).

### 3.3 POST `/onboarding/{token}/complete` (public)
**Body (self-fill payload; JSON, no files)**
```json
{
  "first_name": "Ravi", "middle_name": null, "last_name": "Kumar", "gender": "Male",
  "date_of_birth": "1998-04-10", "nationality_country_id": 101, "work_country_id": 101,
  "mobile": "9800000000", "alt_mobile": null,
  "country_id": 101, "state_id": 4001, "city": "Mumbai",
  "address_line1": "12 MG Road", "address_line2": null, "pincode": "400001",
  "perm_country_id": 101, "perm_state_id": 4001, "perm_city": "Mumbai",
  "perm_address_line1": "12 MG Road", "perm_pincode": "400001",
  "department_id": 4, "designation_id": 9, "primary_role_id": 3,
  "ancillary_role_id": null, "legal_entity_id": 2, "location": "Mumbai",
  "date_of_joining": "2026-07-15"
}
```
**Validation highlights:** `first_name` min 3; names regex; `date_of_birth` ≤ today − 18y (**min age 18**); mobile/pincode patterns; XSS `not_regex /[<>]/`; every FK must belong to the invite's tenant (or be global).
**Behaviour:** in a locked transaction — create `User` (employee) + allocate `EMP-###` + create `Employee` + grant self-service perms + stamp invite `completed`; then send a welcome email with credentials (synchronously, best-effort).
**Response 200**
```json
{ "message": "Onboarding complete.", "employee": { "id": 130, "emp_code": "EMP-013", "display_name": "Ravi Kumar" } }
```
**Errors:** 410 (link not usable) · 409 (double-submit race) · 422 (validation / unique email).

---

## 4. RELATED — 6-STAGE PROGRESSION (Employee module)
```
PUT /employees/{id} { "onboarding_stage_completed": 3 }   # advance (high-watermark)
PUT /employees/{id} { "onboarding_stage_completed": 6, "onboarding_complete_notes": "…" }  # complete
PUT /employees/{id} { "status": "Active", "onboarding_stage_completed": 6 }                # activate
```
Stages: 1 Setup · 2 Documents · 3 Provisioning & Assets · 4 Payroll & Finance · 5 Policies & Agreements · 6 Final Verification & Activation.

---

## 5. ERROR EXAMPLES
**410 — link used/expired**
```json
{ "message": "Onboarding link is no longer usable." }
```
**409 — double submit**
```json
{ "message": "This onboarding is already being processed." }
```
**422 — under age**
```json
{ "message": "…", "errors": { "date_of_birth": ["You must be at least 18 years old."] } }
```

---

## 6. QUICK REFERENCE

```
# HR
POST /employees/onboarding-invite      # create + email token link

# New hire (public, no auth)
GET  /onboarding/{token}               # load invite + masters
POST /onboarding/{token}/complete      # submit → employee + login provisioned

# HR wizard
PUT  /employees/{id} {onboarding_stage_completed}   # advance through the 6 stages
```

---

## 7. NOTES (caveats)
1. Public routes rate-limited 30/min/IP; token is 64-char, expiry 3/7/15/30 days.
2. Completion is race-safe (409 on double submit).
3. Onboarding URL only accepts a caller origin whose host matches config.
4. Public form collects no documents; pincode 6-digit frontend vs 4–10 backend.
5. Emails sent synchronously (no queue worker); `cancelled` invite status is unused.

---

*Related documents: ONBOARDING_TECHNICAL_DOCUMENTATION.md · ONBOARDING_FUNCTIONAL_DOCUMENTATION.md · ONBOARDING_CODE_WALKTHROUGH.md*

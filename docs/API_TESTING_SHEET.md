# Cross_Border_Command — Full API Testing Sheet (Postman / curl)

> Complete start-to-end reference of **every** API endpoint in the system, with ready-to-run request samples for manual/Postman testing.
> Generated from the live Laravel route table (`php artisan route:list`) + each controller's validation rules.
> **Generated:** 2026-06-03 · **Base URL:** `http://127.0.0.1:8000`

---

## How to use this sheet

1. **Base URL** — all paths are prefixed with `http://127.0.0.1:8000`. Change the host if testing a deployed env.
2. **Auth token** — most endpoints need a Sanctum bearer token. Get one by calling `POST /api/login` (see Part 01), copy the `token` from the response, and use it as `{{token}}` in every authed request:
   ```
   Authorization: Bearer 12|abcdEFGH....
   ```
   In Postman, set an environment variable `token` and reference it as `{{token}}`.
3. **Branch scope** — authenticated **GET** requests are auto-scoped by branch in the SPA via a `?branch_id=<id>` query param. When testing directly you may add `?branch_id=12` to branch-scoped GETs to mimic the active branch.
4. **Content types**:
   - JSON endpoints → `Content-Type: application/json` with a JSON `--data` body.
   - File-upload endpoints → `multipart/form-data` using `--form 'field=@/path/to/file'` (do **not** set Content-Type manually; curl sets the boundary).
5. **Sample data** — values shown are realistic placeholders that satisfy validation. Replace ids (`product_id`, `customer_id`, etc.) with real ones from your test tenant (e.g. IGC GROUP, client id 12).
6. **Public endpoints** — a handful need **no** token: `login`, `login/face`, `google-login`, `forgot-password/*`, public onboarding (`/api/onboarding/{token}` + `/complete`), signed PDF views (`/sales/quotations/{id}/view`, `/sales/proforma-invoices/{id}/view`), and the Razorpay webhook. These are flagged per-entry.

---

## Endpoint totals

| Metric | Count |
|---|---|
| **Total API endpoints** | **437** |
| GET | 187 |
| POST | 139 |
| PUT | 35 |
| PUT\|PATCH (resource) | 15 |
| PATCH | 9 |
| DELETE | 52 |
| Controllers | 67 |

## Document index (by part)

| Part | Module area | Endpoints |
|---|---|---|
| [Part 01](#part-01--auth-tenancy-settings-permissions-dashboard) | Auth, Tenancy (Clients/Branches), Settings, Permissions, Notifications, Dashboard, My Team | 50 |
| [Part 02](#part-02--sales-leads--acknowledgement-reasons) | Sales Leads (6-stage pipeline) & Ack Reasons | 30 |
| [Part 03](#part-03--quotations-proforma-invoices-sales-pdfemail-procurement-shipment-meetings--reminders) | Quotations, Proforma Invoices, Sales PDF/Email, Procurement, Shipment, Meetings & Reminders | 44 |
| [Part 04](#part-04--customers--consignees-with-documents--owners) | Customers & Consignees (+ Documents & Owners) | 36 |
| [Part 05](#part-05--products-vendorssuppliers-master-data-generic-segment-uploads) | Products, Vendors/Suppliers, Master Data (generic), Segment Uploads | 35 |
| [Part 06](#part-06--clm-agreements-clauses-tc-trade-documents-segments-segment-rules-authorities) | CLM: Agreements, Clauses, T&C, Trade Documents, Segments, Segment Rules, Authorities | 54 |
| [Part 07](#part-07--clm-kyc-due-diligence-qc-trade-licenses-zoho-signature-buyersupplier-profiles) | CLM: KYC, DD, QC, Trade Licenses, Zoho Signature, Buyer/Supplier Profiles | 29 |
| [Part 08](#part-08--hr-employees-documents-onboarding-exit-previous-employment-attendance-leave-plans--requests) | HR: Employees, Documents, Onboarding, Exit, Previous Employment, Attendance, Leave | 55 |
| [Part 09](#part-09--hr-recruitment-hiring-requests-candidates-custom-fields-document-templates-generated-documents-overview) | HR: Recruitment, Hiring, Candidates, Custom Fields, Doc Templates, Generated Docs, Overview | 50 |
| [Part 10](#part-10--hr-document-signatures-advances-expenses-announcements-billing-paymentsplanssubscriptionrazorpay) | HR Signatures, Advances, Expenses, Announcements, Billing (Payments/Plans/Subscription/Razorpay) | 54 |
| | **TOTAL** | **437** |

---



---

# Part 01 — Auth, Tenancy, Settings, Permissions, Dashboard

Base URL: `http://127.0.0.1:8000`

> Auth model: Laravel Sanctum bearer tokens. Public endpoints below are explicitly marked.
> All other endpoints require `Authorization: Bearer {{token}}` (the `auth:sanctum` + `user.active` middleware group).
> Validation errors return HTTP 422 with `{ "message": ..., "errors": { field: [...] } }`.

---

## AuthController

### POST /api/change-password
**Action:** `AuthController@changePassword` — change the signed-in user's password (blocks reuse of last 3, emails a confirmation).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/change-password' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "current_password": "OldPass@123",
  "password": "NewPass@456",
  "password_confirmation": "NewPass@456"
}'
```

**Body fields:**
- `current_password` (required, string) — existing password; 422 if wrong.
- `password` (required, string, min:8, confirmed) — needs a matching `password_confirmation` field.

---

### POST /api/google-login
**Action:** `AuthController@googleLogin` — verify a Google ID token and issue a Sanctum token (user must already exist).
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/google-login' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..."
}'
```

**Body fields:**
- `id_token` (required, string) — Google OAuth ID token (JWT). 401 if invalid/unverified, 404 if no matching account, 403 if account/org/branch inactive, 429 if brute-force locked.

---

### POST /api/login
**Action:** `AuthController@login` — email + password login; returns `{ token, user }`.
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/login' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "email": "admin@igcgroup.in",
  "password": "Secret@123"
}'
```

**Body fields:**
- `email` (required, email).
- `password` (required, string).
- Notes: 5 failed attempts in 15 min triggers a lockout (when `security.bruteForce` is on). Inactive account/org/branch and incomplete onboarding (stage < 6) are rejected with a 422 on `email`.

---

### POST /api/login/face
**Action:** `AuthController@faceLogin` — face-descriptor login matched against the user's enrolled Employee descriptor (Euclidean threshold 0.50).
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/login/face' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "email": "priya.sharma@igcgroup.in",
  "descriptor": [-0.0712, 0.1334, 0.0451, "... 128 floats total ..."]
}'
```

**Body fields:**
- `email` (required, email).
- `descriptor` (required, array, exactly size 128) — face-api.js 128-d descriptor.
- `descriptor.*` (required, numeric) — each element must be numeric.
- Returns `{ token, user, distance }` on success.

---

### POST /api/logout
**Action:** `AuthController@logout` — revoke the current access token.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/logout' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

### GET /api/me
**Action:** `AuthController@me` — full formatted profile of the signed-in user (permissions, tenant logos/colors, plan info, inbox count).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/me' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/me/branding
**Action:** `AuthController@updateBranding` — self-serve tenant branding (logo + colors); client_admin patches the client row, branch_user the branch row. super_admin gets 403.
**Auth:** Bearer token required — **multipart/form-data** (logo is a file)

```bash
curl -X POST 'http://127.0.0.1:8000/api/me/branding' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'primary_color=#4F46E5' \
  --form 'secondary_color=#10B981' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields:**
- `logo` (nullable, image: jpg/jpeg/png/svg/webp, max 2 MB).
- `primary_color` (nullable, string, max:7) — hex like `#4F46E5`.
- `secondary_color` (nullable, string, max:7).

---

### POST /api/me/profile
**Action:** `AuthController@updateProfile` — update own name/phone/designation + optional profile photo. Email is not editable here.
**Auth:** Bearer token required — **multipart/form-data** (profile_photo is a file)

```bash
curl -X POST 'http://127.0.0.1:8000/api/me/profile' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Rajesh Meshram' \
  --form 'phone=+91 98765 43210' \
  --form 'designation=QA Engineer' \
  --form 'profile_photo=@/path/to/photo.jpg'
```

**Body fields:**
- `name` (required, string, min:2, max:255).
- `phone` (nullable, string, max:20, regex: only digits/space/`+`/`-`/`(`/`)`, 7–20 chars).
- `designation` (nullable, string, max:100).
- `profile_photo` (nullable, image: jpg/jpeg/png, max 2 MB).

---

## ForgotPasswordController

### POST /api/forgot-password/send-otp
**Action:** `ForgotPasswordController@sendOtp` — generate a 6-digit OTP (10-min expiry) and email it. Step 1 of 3.
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/forgot-password/send-otp' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "email": "admin@igcgroup.in"
}'
```

**Body fields:**
- `email` (required, email) — 422 if no account or account inactive; 429 if requested again within the resend cooldown; 503 if platform email disabled.

---

### POST /api/forgot-password/verify-otp
**Action:** `ForgotPasswordController@verifyOtp` — verify the 6-digit OTP. Step 2 of 3.
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/forgot-password/verify-otp' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "email": "admin@igcgroup.in",
  "otp": "483920"
}'
```

**Body fields:**
- `email` (required, email).
- `otp` (required, string, exactly size 6).

---

### POST /api/forgot-password/reset
**Action:** `ForgotPasswordController@resetPassword` — set a new password after OTP verified (blocks reuse of last 3, revokes all tokens). Step 3 of 3.
**Auth:** Public

```bash
curl -X POST 'http://127.0.0.1:8000/api/forgot-password/reset' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --data '{
  "email": "admin@igcgroup.in",
  "password": "NewPass@789",
  "password_confirmation": "NewPass@789"
}'
```

**Body fields:**
- `email` (required, email) — must have a verified OTP on record (422 otherwise).
- `password` (required, string, min:8, confirmed) — needs `password_confirmation`.

---

## FaceBiometricController

### GET /api/face/status
**Action:** `FaceBiometricController@status` — whether the target employee has a face enrolled (no raw descriptor returned).
**Auth:** Bearer token required
**Query params:** `employee_id` (optional integer) — act on another employee in the same tenant; omit to act on your own linked employee row.

```bash
curl -X GET 'http://127.0.0.1:8000/api/face/status?employee_id=42' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/face/register
**Action:** `FaceBiometricController@register` — save/replace the face descriptor for the target employee. Requires explicit consent; blocks duplicate faces (threshold 0.50) within the tenant.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/face/register' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "descriptor": [-0.0712, 0.1334, 0.0451, "... 128 floats total ..."],
  "consent": true,
  "employee_id": 42
}'
```

**Body fields:**
- `descriptor` (required, array, exactly size 128).
- `descriptor.*` (required, numeric).
- `consent` (required, accepted) — must be `true`/`1`/`"yes"`/`"on"`.
- `employee_id` (nullable, integer) — target another employee in the same tenant; omit for own row.

---

### DELETE /api/face/data
**Action:** `FaceBiometricController@revoke` — wipe the descriptor and stamp `consent_revoked_at` for the target employee.
**Auth:** Bearer token required
**Query params:** `employee_id` (optional integer) — target another employee in the same tenant; omit for own row.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/face/data?employee_id=42' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClientController

### GET /api/clients
**Action:** `ClientController@index` — paginated client list with branch/user counts (super-admin view).
**Auth:** Bearer token required
**Query params:** `search` (matches org_name / unique_number / email, ILIKE), `status` (active/inactive/suspended), `per_page` (default 15), `include_stats` (bool — embeds KPI stats), `page`.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clients?search=igc&status=active&per_page=15&include_stats=1' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clients
**Action:** `ClientController@store` — create a client + auto Head-Office branch + client_admin user (sends welcome credentials email).
**Auth:** Bearer token required — **multipart/form-data** (logo/favicon/profile_photo are files)

```bash
curl -X POST 'http://127.0.0.1:8000/api/clients' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'org_name=IGC Group Exports Pvt Ltd' \
  --form 'org_type=Private Limited' \
  --form 'email=info@igcgroup.in' \
  --form 'phone=+91 9876543210' \
  --form 'website=https://igcgroup.in' \
  --form 'status=active' \
  --form 'industry=Export/Import' \
  --form 'address=Plot 21, MIDC, Andheri East' \
  --form 'city=Mumbai' \
  --form 'state=Maharashtra' \
  --form 'pincode=400093' \
  --form 'country=India' \
  --form 'gst_number=27AADCI6120M1ZH' \
  --form 'pan_number=AADCI6120M' \
  --form 'plan_id=2' \
  --form 'admin_name=Priya Sharma' \
  --form 'admin_email=priya.sharma@igcgroup.in' \
  --form 'admin_phone=+91 9123456780' \
  --form 'admin_designation=Director' \
  --form 'admin_password=Admin@1234' \
  --form 'admin_status=active' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields (key):**
- Required: `org_name` (max:255), `org_type` (max:50, must exist in organization_types.name), `email` (email, unique among clients), `status` (active|inactive|suspended), `admin_name` (max:255), `admin_email` (email, unique among users), `admin_password` (min:6).
- Optional org: `phone` (unique), `website` (max:500), `sports`, `industry` (max:100).
- Optional address: `address`, `city`, `district`, `taluka`, `pincode` (max:10), `state`, `country` (default India).
- Optional legal: `gst_number` (GSTIN regex, unique), `pan_number` (PAN regex, unique).
- Optional plan: `plan_id` (exists:plans), `plan_type` (free|paid — ignored, always created `free`), `plan_expires_at` (date).
- Optional branding: `primary_color`/`secondary_color` (max:7), `logo` (image jpg/jpeg/png/svg/webp, max 2 MB), `favicon` (image incl. ico, max 512 KB), `profile_photo` (jpg/jpeg/png, max 2 MB).
- Optional admin: `admin_phone` (unique), `admin_designation` (max:100), `admin_status` (active|inactive|pending), `notes`.

---

### GET /api/clients/form-bundle
**Action:** `ClientController@formBundle` — bundled dropdowns for the Client form (organization_types, plans, countries). Cached 5 min/user.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clients/form-bundle' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clients/stats
**Action:** `ClientController@stats` — KPI card totals (total/active/inactive + plan breakdown).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clients/stats' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clients/{client}
**Action:** `ClientController@show` — single client + admin user (super_admin gets decrypted admin password), admin permissions, and states for the client's country.
**Auth:** Bearer token required
**Path params:** `{client}` = client id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clients/12' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/clients/{client}
**Action:** `ClientController@update` — update a client and (optionally) its admin user. Deactivating cascades token revocation.
**Auth:** Bearer token required
**Path params:** `{client}` = client id.

> Note: file uploads (logo/favicon/profile_photo) on PUT require multipart. With curl, send `-X POST` plus `--form '_method=PUT'` so multipart parses, or send JSON for non-file updates.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clients/12' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "org_name": "IGC Group Exports Pvt Ltd",
  "org_type": "Private Limited",
  "email": "info@igcgroup.in",
  "phone": "+91 9876543210",
  "status": "active",
  "gst_number": "27AADCI6120M1ZH",
  "pan_number": "AADCI6120M",
  "admin_name": "Priya Sharma",
  "admin_email": "priya.sharma@igcgroup.in",
  "admin_status": "active"
}'
```

**Body fields:** Same set as store(), except `admin_name`/`admin_email`/`admin_password` are all `nullable` here (admin only updated when `admin_name` is sent). Unique rules ignore the current rows. `plan_type` cannot be flipped to `paid` from this form.

---

### DELETE /api/clients/{client}
**Action:** `ClientController@destroy` — soft-delete the client + its branches + users, revoking all their tokens.
**Auth:** Bearer token required
**Path params:** `{client}` = client id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clients/12' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

## BranchController

### GET /api/branches
**Action:** `BranchController@index` — paginated branch list scoped to the caller's client (Head Office placeholder hidden by default).
**Auth:** Bearer token required
**Query params:** `search` (name/code/city/industry, ILIKE), `status` (active/inactive), `type` (branch_type), `client_id` (super_admin only), `branch_id` (narrow to one branch), `include_head_office` (bool), `per_page` (default 15), `page`.

```bash
curl -X GET 'http://127.0.0.1:8000/api/branches?search=mumbai&status=active&per_page=15' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/branches
**Action:** `BranchController@store` — create a branch + branch_user login (enforces plan branch limit; auto-allocates BR-### code if none given).
**Auth:** Bearer token required — **multipart/form-data** (logo/profile_photo/signature_path are files)

```bash
curl -X POST 'http://127.0.0.1:8000/api/branches' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Mumbai Head Office' \
  --form 'code=BR-001' \
  --form 'email=mumbai@igcgroup.in' \
  --form 'phone=+91 9876500001' \
  --form 'website=https://igcgroup.in' \
  --form 'contact_person=Anil Kulkarni' \
  --form 'branch_type=Regional' \
  --form 'gst_number=27AADCI6120M1ZH' \
  --form 'pan_number=AADCI6120M' \
  --form 'gst_state_code=27' \
  --form 'iec=AADCI6120M' \
  --form 'address=Plot 21, MIDC, Andheri East' \
  --form 'city=Mumbai' \
  --form 'state=Maharashtra' \
  --form 'pincode=400093' \
  --form 'country=India' \
  --form 'is_main=true' \
  --form 'max_users=25' \
  --form 'status=active' \
  --form 'user_name=Anil Kulkarni' \
  --form 'user_email=anil.kulkarni@igcgroup.in' \
  --form 'user_phone=+91 9876500002' \
  --form 'user_designation=Branch Manager' \
  --form 'user_password=Branch@1234' \
  --form 'user_status=active'
```

**Body fields (key):**
- Required: `name` (max:255, unique per client), `status` (active|inactive), `user_name` (max:255), `user_email` (email, unique among users), `user_password` (min:6).
- Optional: `code` (max:50, auto BR-### if blank), `email` (email), `phone`/`user_phone` (regex 7–20 chars), `website` (URL regex), `contact_person`, `branch_type`, `industry`, `description`.
- Legal/export: `gst_number` (GSTIN regex, unique per client), `pan_number` (PAN regex, unique per client), `registration_number`, `gst_state_code` (max:10), `cin` (max:30), `iec` (max:30), `drug_license`, `pcpndt_no`, `aeo_code`, `one_star_file_no`, `one_star_udin_no` (each max:60).
- Address: `address`, `city`, `district`, `taluka`, `state`, `pincode` (max:10), `country`.
- Flags/files: `is_main` (bool), `max_users` (int, min:0), `established_at` (date), `notes`, `logo`/`profile_photo` (image, max 2 MB), `signature_path` (image jpg/jpeg/png/webp, max 2 MB), `primary_color`/`secondary_color` (max:7), `user_designation` (max:100), `user_status` (active|inactive|pending).

---

### GET /api/branches/form-bundle
**Action:** `BranchController@formBundle` — bundled countries + states (cached 5 min) plus a freshly-computed `next_code`.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/branches/form-bundle' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/branches/next-code
**Action:** `BranchController@nextCode` — peek the next auto BR-### code for the caller's client.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/branches/next-code' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/branches/{branch}
**Action:** `BranchController@show` — single branch + its branch_user (super_admin / owning client_admin get the decrypted password).
**Auth:** Bearer token required
**Path params:** `{branch}` = branch id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/branches/8' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/branches/{branch}
**Action:** `BranchController@update` — update a branch + branch_user; active→inactive cascades soft-deletes/token revocation, inactive→active restores.
**Auth:** Bearer token required
**Path params:** `{branch}` = branch id.

> Note: for file uploads on PUT use multipart with `--form '_method=PUT'`; JSON works for non-file updates.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/branches/8' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Mumbai Head Office",
  "status": "active",
  "city": "Mumbai",
  "state": "Maharashtra",
  "is_main": true,
  "max_users": 30
}'
```

**Body fields:** Same set as store(), but `name` is the only required field beyond `status`; `user_name`/`user_email`/`user_password` are `nullable` (branch_user only updated when `user_name` is sent). Name uniqueness only enforced on rename.

---

### DELETE /api/branches/{branch}
**Action:** `BranchController@destroy` — soft-deactivate a branch (status→inactive, soft-delete its users/employees, revoke tokens). Cannot delete the main branch.
**Auth:** Bearer token required
**Path params:** `{branch}` = branch id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/branches/8' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

## OrganizationTypeController

### GET /api/organization-types
**Action:** `OrganizationTypeController@index` — list organization types (ordered by sort_order/name).
**Auth:** Bearer token required
**Query params:** `active_only` (bool), `search` (name, ILIKE).

```bash
curl -X GET 'http://127.0.0.1:8000/api/organization-types?active_only=1&search=private' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/organization-types
**Action:** `OrganizationTypeController@store` — create an org type (super_admin only; auto-slugs the name).
**Auth:** Bearer token required (super_admin)

```bash
curl -X POST 'http://127.0.0.1:8000/api/organization-types' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Limited Liability Partnership",
  "icon": "ri-building-line",
  "description": "LLP registered under the LLP Act 2008",
  "status": "active",
  "sort_order": 5
}'
```

**Body fields:**
- `name` (required, string, max:100, unique).
- `icon` (nullable, string, max:50).
- `description` (nullable, string, max:255).
- `status` (required, active|inactive).
- `sort_order` (nullable, integer, min:0).

---

### GET /api/organization-types/{organizationType}
**Action:** `OrganizationTypeController@show` — single org type.
**Auth:** Bearer token required
**Path params:** `{organizationType}` = org type id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/organization-types/5' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/organization-types/{organizationType}
**Action:** `OrganizationTypeController@update` — update an org type (super_admin only).
**Auth:** Bearer token required (super_admin)
**Path params:** `{organizationType}` = org type id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/organization-types/5' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Limited Liability Partnership",
  "icon": "ri-building-2-line",
  "description": "LLP under the LLP Act 2008",
  "status": "active",
  "sort_order": 6
}'
```

**Body fields:** Same as store(); `name` unique except the current row.

---

### DELETE /api/organization-types/{organizationType}
**Action:** `OrganizationTypeController@destroy` — delete an org type (super_admin only; 422 if referenced by any client).
**Auth:** Bearer token required (super_admin)
**Path params:** `{organizationType}` = org type id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/organization-types/5' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

## SettingsController

### GET /api/settings
**Action:** `SettingsController@index` — all platform settings sections keyed by section (appearance enriched with resolved logo/favicon URLs).
**Auth:** Bearer token required (any authenticated user)

```bash
curl -X GET 'http://127.0.0.1:8000/api/settings' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/settings/appearance/asset
**Action:** `SettingsController@uploadAsset` — upload a platform logo or favicon (super_admin only); writes the path into the appearance section.
**Auth:** Bearer token required (super_admin) — **multipart/form-data**

```bash
curl -X POST 'http://127.0.0.1:8000/api/settings/appearance/asset' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'kind=logo' \
  --form 'file=@/path/to/platform-logo.png'
```

**Body fields:**
- `kind` (required, in: logo|favicon).
- `file` (required, image: jpg/jpeg/png/svg/webp/ico, max 2 MB).

---

### PUT /api/settings/{section}
**Action:** `SettingsController@update` — upsert one settings section (super_admin only). 404 if section unknown.
**Auth:** Bearer token required (super_admin)
**Path params:** `{section}` = one of `general`, `security`, `notifications`, `appearance`, `privacy`, `help`, `contact`.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/settings/security' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "tfa": false,
  "pwReset": true,
  "loginNotif": true,
  "ipWhite": false,
  "sessTimeout": true,
  "bruteForce": true
}'
```

**Body fields (vary by section):**
- `general`: `platform_name` (required, max:255), `tagline`, `description` (max:2000), `support_email`/`admin_email` (email), `contact_phone` (max:32), `website_url` (url).
- `security`: `tfa`, `pwReset`, `loginNotif`, `ipWhite`, `sessTimeout`, `bruteForce` (all boolean).
- `notifications`: `emailNotif`, `pushNotif`, `planExp`, `newUser`, `payAlerts`, `weeklyReports` (all boolean).
- `appearance`: `primary_color`/`secondary_color` (hex regex `#RRGGBB`), `dark_default` (boolean), `logo_path`/`favicon_path` (string — usually set via the asset endpoint).
- `privacy`: `encrypt`, `actLog`, `retention`, `cookie` (boolean), `privacy_policy_url` (url).
- `help`: `faqs` (array), `faqs.*.q` (string, max:500), `faqs.*.a` (string, max:5000).
- `contact`: `support_email` (email), `support_phone` (max:32), `website` (url), `status_page` (max:255), `emergency_phone` (max:32).

---

## PermissionController

### GET /api/modules
**Action:** `PermissionController@modules` — active module tree (id, parent_id, name, slug, icon, etc.) for the permissions matrix.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/modules' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/permissions/users
**Action:** `PermissionController@manageableUsers` — users the caller may grant permissions to (scope depends on role).
**Auth:** Bearer token required
**Query params:** `branch_id` (optional integer) — narrow the picker to one branch (validated against the caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/permissions/users?branch_id=8' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/permissions/user/{userId}
**Action:** `PermissionController@getUserPermissions` — the target user's current permission rows. Self-read / scoped by role.
**Auth:** Bearer token required
**Path params:** `{userId}` = target user id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/permissions/user/57' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/permissions/user/{userId}
**Action:** `PermissionController@savePermissions` — replace the target user's permissions (only leaf modules; can't grant flags the granter lacks; cascade-clears downstream).
**Auth:** Bearer token required
**Path params:** `{userId}` = target user id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/permissions/user/57' \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "permissions": [
    {
      "module_id": 12,
      "can_view": true,
      "can_add": true,
      "can_edit": true,
      "can_delete": false,
      "can_export": true,
      "can_import": false,
      "can_approve": false
    },
    {
      "module_id": 13,
      "can_view": true,
      "can_add": false,
      "can_edit": false,
      "can_delete": false,
      "can_export": false,
      "can_import": false,
      "can_approve": false
    }
  ]
}'
```

**Body fields:**
- `permissions` (required, array).
- `permissions.*.module_id` (required, exists:modules,id).
- `permissions.*.can_view` / `can_add` / `can_edit` / `can_delete` / `can_export` / `can_import` / `can_approve` (boolean, optional — default false).
- Grant scope: super_admin → client_admin only; client_admin → branch_user only; main-branch user → branch_user + employee; sub-branch user → employees in their own branch.

---

## NotificationController

### GET /api/notifications
**Action:** `NotificationController@index` — recent notifications for the signed-in user (bell dropdown).
**Auth:** Bearer token required
**Query params:** `limit` (optional integer, clamped 1–50, default 20).

```bash
curl -X GET 'http://127.0.0.1:8000/api/notifications?limit=20' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/notifications/unread-count
**Action:** `NotificationController@unreadCount` — unread notification count for the badge.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/notifications/unread-count' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/notifications/{id}/read
**Action:** `NotificationController@markRead` — mark one notification as read (404 if not the user's).
**Auth:** Bearer token required
**Path params:** `{id}` = notification UUID.

```bash
curl -X POST 'http://127.0.0.1:8000/api/notifications/9b1c2d34-5e6f-7a8b-9c0d-1e2f3a4b5c6d/read' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

### POST /api/notifications/read-all
**Action:** `NotificationController@markAllRead` — mark every unread notification as read.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/notifications/read-all' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

## DashboardController

### GET /api/dashboard/admin-stats
**Action:** `DashboardController@adminStats` — global super-admin KPIs (clients, users, revenue, plan/user/org distributions, recent activity). Cached 60s.
**Auth:** Bearer token required (super_admin view)

```bash
curl -X GET 'http://127.0.0.1:8000/api/dashboard/admin-stats' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/dashboard/client-stats
**Action:** `DashboardController@clientStats` — client dashboard (branch/user/payment counts, plan, employee analytics). Cached 60s per client/branch/role. 422 if user has no client.
**Auth:** Bearer token required
**Query params:** `branch_id` (optional integer) — scope to one branch (validated within the user's client; sub-branch users are locked to their own branch). Payment data is hidden from non-main-branch users.

```bash
curl -X GET 'http://127.0.0.1:8000/api/dashboard/client-stats?branch_id=8' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/dashboard/employee-stats
**Action:** `DashboardController@employeeStats` — personal employee snapshot (profile, expense KPIs, approvals, team peers, announcements, upcoming events, onboarding progress).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/dashboard/employee-stats' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

## MyTeamController

### GET /api/my-team/employees
**Action:** `MyTeamController@employees` — scope-aware list of the caller's team (direct reports / branch / client), capped at 500.
**Auth:** Bearer token required
**Query params:** `search` (display_name/emp_code/email, ILIKE), `status`.

```bash
curl -X GET 'http://127.0.0.1:8000/api/my-team/employees?search=anil&status=Active' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/my-team/approvals
**Action:** `MyTeamController@approvals` — unified pending-approvals queue (document signatures awaiting the user as next signer + expense claims at their manager/HR stage).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/my-team/approvals' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/my-team/my-updates
**Action:** `MyTeamController@myUpdates` — FYI feed of the user's own expense claims and advance requests actioned in the last 30 days. Empty array if no linked employee row.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/my-team/my-updates' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 02 — Sales Leads & Acknowledgement Reasons

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}` and sit behind `auth:sanctum` + `user.active`.
Tenant scoping: rows are pinned to the caller's `client_id`; sub-branch users are further pinned to their branch. Never send `client_id` in the body — it is derived from the token.

---

## SalesLeadController

### GET /api/sales/leads
**Action:** `SalesLeadController@index` — paginated lead list for the My Workplace worksheet, with status tab, facet filters, full-table search, and per-tab counters.
**Auth:** Bearer token required
**Query params:**
- `status` = `qualified` | `disqualified` | `all` (omit/anything else = no status filter)
- `platform` — scalar or array (`platform[]=Vortex&platform[]=Purvee`)
- `query_type` — scalar or array
- `salesperson_id` — scalar or array
- `assigned` = `1` (has salesperson) | `0` (unassigned)
- `lead_stage_id` — scalar or array (1–6)
- `sender_country_iso` — scalar or array (e.g. `IN`)
- `customer_id` — scalar or array
- `start_date` & `end_date` (both required together, `YYYY-MM-DD`) — filters on `query_time`
- `search` — matches opp_code, sender name/email/mobile/company, product, country, remark, salesperson & customer names
- `per_page` (1–200, default 50), `page` (default 1)
- `with_counts` = `1` (default) | `0` (skip tab counters on pure pagination)

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads?status=qualified&platform=Offline&search=Basmati&per_page=25&page=1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads
**Action:** `SalesLeadController@store` — manual lead capture (Add New Lead modal). Auto-fills `sender_country_iso` from the country master when only a name is sent; auto-allocates `opp_code` (`OPP-NNNN`), sets `platform=Offline`, `query_type=Manual`, `lead_stage_id=1`, `qualified=true`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sender_name": "Rahul Sharma",
  "sender_mobile": "+919876543210",
  "sender_email": "rahul.sharma@agriexports.in",
  "sender_company": "Agri Exports Pvt Ltd",
  "sender_address": "Plot 22, MIDC Industrial Area",
  "sender_city": "Pune",
  "sender_state": "Maharashtra",
  "sender_country_name": "India",
  "sender_pincode": "411019",
  "customer_id": 14,
  "consignee_id": 7,
  "query_message": "Need quote for 1000 MT Basmati Rice, FOB Nhava Sheva",
  "product_quantity": "1000 MT",
  "query_product_name": "Basmati Rice 1121"
}'
```

**Body fields:**
- `sender_name` — required, string, max 255
- `sender_mobile` — optional, string, max 32
- `sender_email` — optional, valid email, max 255
- `sender_company` — optional, string, max 255
- `sender_address` — optional, string, max 1000
- `sender_city` / `sender_state` — optional, string, max 128
- `sender_country_iso` — optional, string, max 8
- `sender_country_name` — optional, string, max 128 (resolves to ISO if iso omitted)
- `sender_pincode` — optional, string, max 32
- `customer_id` — optional, integer, must exist in `customers`
- `consignee_id` — optional, integer, must exist in `consignees`
- `query_message` — optional, string, max 10000
- `product_quantity` — optional, string, max 64
- `query_product_name` — optional, string, max 255

---

### POST /api/sales/leads/assign
**Action:** `SalesLeadController@assign` — assigns one or many leads to a single salesperson (row-level Assign + bulk modal). Out-of-tenant ids are silently skipped and reported in `skipped_no_scope`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/assign' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "lead_ids": [101, 102, 103],
  "salesperson_id": 27
}'
```

**Body fields:**
- `lead_ids` — required, array, min 1; each item integer
- `salesperson_id` — required, integer, must exist in `users`

---

### POST /api/sales/leads/convert-to-qualified
**Action:** `SalesLeadController@convertToQualified` — flips disqualified leads back to qualified, clearing their `lead_ack_reason_id`. Tenant-scoped (hostile ids skipped).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/convert-to-qualified' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "lead_ids": [104, 105]
}'
```

**Body fields:**
- `lead_ids` — required, array, min 1; each item integer

---

### GET /api/sales/leads/filter-options
**Action:** `SalesLeadController@filterOptions` — one round-trip feeding the Filter modal: distinct platforms, query_types, countries (`{value,label}`), customer dropdown (capped at 500), and the 6 canonical stages.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/filter-options' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/salespeople
**Action:** `SalesLeadController@salespeople` — tenant-scoped roster of active users that can own a lead (client_admin / client_user / branch_user / employee). Used by the Assign/Distribute dropdowns.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/salespeople' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/salesperson-summary
**Action:** `SalesLeadController@salespersonSummary` — Lead-Distribution table data: header totals (sales persons / leads / assigned / unassigned), distinct platforms, and one enriched row per salesperson (department, designation, roles, reporting manager, per-platform lead counts).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/salesperson-summary' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/sync
**Action:** `SalesLeadController@syncFromCrm` — pulls leads from the IndiaMart CRM keys configured per tenant. Gated by `config/lead_sync.php` (branch match); super_admin bypasses the gate. Returns 403 if the tenant gate fails.
**Auth:** Bearer token required
**Body:** none (empty POST).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/sync' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/sync/config
**Action:** `SalesLeadController@syncConfig` — tells the frontend whether to render the "Sync from IndiaMart" button. Returns `{ enabled, labels }` (enabled iff the tenant gate passes and at least one CRM key is configured).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/sync/config' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/{id}
**Action:** `SalesLeadController@show` — full lead detail for the Sales Matrix detail page (salesperson, customer, consignee, ackReason, taskManager, acknowledgements). Tenant-scoped; 404 on cross-tenant id.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/sales/leads/{id}
**Action:** `SalesLeadController@update` — edit a lead. Auto-stamps `won_at` on first entry to Stage 6 and clears it when regressing below 6. Rejects qualified+disqualified both true (422).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sender_name": "Rahul Sharma",
  "sender_mobile": "+919876543210",
  "sender_email": "rahul.sharma@agriexports.in",
  "qualified": true,
  "disqualified": false,
  "lead_stage_id": 3,
  "salesperson_id": 27,
  "key_opportunity": true,
  "remark": "Hot lead — wants delivery before Diwali",
  "price": "INR 8,50,000",
  "customer_id": 14,
  "whatsapp_status": "connected"
}'
```

**Body fields (all optional unless noted):**
- `sender_name` — sometimes required, string, max 255
- `sender_mobile` (max 32), `sender_email` (email, max 255), `sender_company` (max 255), `sender_address` (max 1000), `sender_city`/`sender_state` (max 128), `sender_pincode` (max 32), `sender_country_iso` (max 8)
- `qualified` / `disqualified` — boolean (cannot both be true → 422)
- `lead_stage_id` — integer, between 1 and 6
- `salesperson_id` — integer, must exist in `users` and not be soft-deleted
- `key_opportunity` — boolean
- `remark` — string, max 5000
- `price` — string, max 64
- `lead_ack_reason_id` — integer, must exist in `lead_ack_reasons` with `status=active`
- `customer_id` (exists customers) / `consignee_id` (exists consignees) — integer
- `has_whatsapp` — boolean
- `whatsapp_status` — in: `connected`, `pending`, `not_connected`, `opted_out`
- `whatsapp_reason` — string, max 1000

---

### DELETE /api/sales/leads/{id}
**Action:** `SalesLeadController@destroy` — soft-deletes a lead. Tenant-scoped.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/{id}/acknowledgements
**Action:** `SalesLeadController@listAcknowledgements` — Stage 2 activity log feed for a lead, newest-first.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/acknowledgements' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/acknowledgements
**Action:** `SalesLeadController@storeAcknowledgements` — bulk-creates Stage 2 activity rows from picked master reasons. All reason_ids must share one `opportunity_type` (422 otherwise). Side effect: flips the lead's qualified/disqualified flags to match the submitted bucket.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/acknowledgements' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason_ids": [3, 4]
}'
```

**Body fields:**
- `reason_ids` — required, array, min 1; each integer (must all belong to caller's tenant and same opportunity_type)

---

### GET /api/sales/leads/{id}/products
**Action:** `SalesLeadController@listLeadProducts` — Stage 3 mapped products for a lead, joined with the product master (code, name, status, segment/category) plus latest `procurement_id` and sourcing flags.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/products' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/products
**Action:** `SalesLeadController@storeLeadProduct` — maps a product master to the lead. Enforces unique (lead, product) and the single-currency-per-lead rule (first product sets the currency; later additions are pinned to it, default USD).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/products' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "product_id": 58,
  "currency": "INR",
  "quantity": 1000,
  "target_price": 78.50,
  "notes": "Customer wants 1121 grade, 2% broken max"
}'
```

**Body fields:**
- `product_id` — required, integer, must exist in `products`
- `currency` — optional, string (free-form code: INR, USD, EUR…); must match the lead's locked currency if one exists
- `quantity` — optional, numeric, min 0
- `target_price` — optional, numeric, min 0
- `notes` — optional, string, max 1000

---

### PUT /api/sales/leads/{id}/products/{mapping}
**Action:** `SalesLeadController@updateLeadProduct` — edit quantity / target_price / currency / notes for a mapping. Product itself is immutable. Currency change must still satisfy the single-currency-per-lead rule.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/leads/101/products/210' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "currency": "INR",
  "quantity": 1200,
  "target_price": 77.00,
  "notes": "Quantity revised up to 1200 MT"
}'
```

**Body fields (all optional):**
- `currency` — string (leave null/empty to keep unchanged)
- `quantity` — numeric, min 0
- `target_price` — numeric, min 0
- `notes` — string, max 1000

---

### DELETE /api/sales/leads/{id}/products/{mapping}
**Action:** `SalesLeadController@destroyLeadProduct` — unmaps a product from the lead.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/leads/101/products/210' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/sales/leads/{id}/products/{mapping}/mark-sourced
**Action:** `SalesLeadController@markLeadProductSourced` — flips `procurement_done` true. Only valid on `sourcing_status=required` rows that already have a linked procurement (422 otherwise). Returns 409 if already marked sourced (idempotency gate).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id
**Body:** none

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/leads/101/products/210/mark-sourced' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/products/{mapping}/shared-prices
**Action:** `SalesLeadController@storeSharedPrice` — Stage 4, append-only quoted-price entry for a product mapping. Blocked for draft/inactive/pending product masters (422).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/products/210/shared-prices' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "quoted_price": 79.25
}'
```

**Body fields:**
- `quoted_price` — required, numeric, greater than 0

---

### GET /api/sales/leads/{id}/products/{mapping}/shared-prices
**Action:** `SalesLeadController@listSharedPricesByProduct` — quoted-price history for one product mapping (newest-first) plus the product's currency/quantity/target_price.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/products/210/shared-prices' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/sales/leads/{id}/products/{mapping}/sourcing-status
**Action:** `SalesLeadController@updateLeadProductSourcingStatus` — Stage 3 label: marks a mapping `required` or `not_required`. Inactive/draft products cannot be `not_required` (422). Flipping to not_required clears `procurement_done`.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/leads/101/products/210/sourcing-status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sourcing_status": "required"
}'
```

**Body fields:**
- `sourcing_status` — required, in: `required`, `not_required`

---

### GET /api/sales/leads/{id}/shared-prices
**Action:** `SalesLeadController@listSharedPrices` — flat quoted-price history across all products on the lead (newest-first), enriched with product code/name/status/category/currency.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/shared-prices' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/task-manager
**Action:** `SalesLeadController@storeTaskManager` — Stage 1 (Inquiry Received) upsert; one row per (client, lead). multipart/form-data so an optional supporting document rides along. Re-saves overwrite the prior file on disk.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id
**Content-Type:** multipart/form-data

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/task-manager' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Rahul Sharma' \
  --form 'mobile_no=919876543210' \
  --form 'email=rahul.sharma@agriexports.in' \
  --form 'order_value=850000' \
  --form 'buying_plan=2026-08-15' \
  --form 'attachment=@/path/to/inquiry.pdf'
```

**Body fields:**
- `name` — required, string, max 255
- `mobile_no` — required, string, regex `^\d{6,15}$` (6–15 digits, no `+`)
- `email` — required, valid email, max 255
- `order_value` — optional, numeric, min 0
- `buying_plan` — optional, date `Y-m-d`
- `attachment` — optional, file, mimes jpg/jpeg/png/webp/pdf, max 5120 KB

---

### POST /api/sales/leads/{id}/whatsapp
**Action:** `SalesLeadController@updateWhatsApp` — updates WhatsApp status on the lead; multipart for the optional screenshot. `has_whatsapp` auto-set true iff status is `connected`. Prior screenshot unlinked when a new one is uploaded.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id
**Content-Type:** multipart/form-data

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/whatsapp' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'whatsapp_status=connected' \
  --form 'whatsapp_reason=Customer confirmed on WhatsApp' \
  --form 'screenshot=@/path/to/chat.png'
```

**Body fields:**
- `whatsapp_status` — required, in: `connected`, `pending`, `not_connected`, `opted_out`
- `whatsapp_reason` — optional, string, max 1000
- `screenshot` — optional, file, mimes jpg/jpeg/png/webp/pdf, max 5120 KB

---

### GET /api/sales/shared-prices/{id}/pdf
**Action:** `SalesLeadController@sharedPricePdf` — generates the dompdf quotation PDF for a shared-price entry (tenant-branded, Code-128 barcode `Q-#####`).
**Auth:** Bearer token required
**Path params:** `{id}` = shared-price entry id
**Query params:** `inline=1` streams in-browser; omit to download

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/shared-prices/15/pdf?inline=1' \
  --header 'Authorization: Bearer {{token}}' \
  --output quotation_00015.pdf
```

---

## LeadAckReasonController

### GET /api/sales/lead-ack-reasons
**Action:** `LeadAckReasonController@index` — returns the master reasons grouped into three buckets (`qualified`, `disqualified`, `clarity_pending`), each sorted by id. Users without a tenant get empty arrays.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/lead-ack-reasons' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/lead-ack-reasons
**Action:** `LeadAckReasonController@store` — creates a new acknowledgement reason for the caller's tenant. `dq_status` is required only when `opportunity_type=disqualified` (422 otherwise), and ignored for the other two types.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/lead-ack-reasons' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "opportunity_type": "disqualified",
  "reason": "Target price below our floor for Basmati Rice",
  "status": "active",
  "dq_status": "negative"
}'
```

**Body fields:**
- `opportunity_type` — required, in: `qualified`, `disqualified`, `clarity_pending`
- `reason` — required, string, max 500
- `status` — optional, in: `active`, `inactive` (defaults to `active`)
- `dq_status` — optional, in: `positive`, `negative`; **required** when opportunity_type is `disqualified`

---

### PUT /api/sales/lead-ack-reasons/{id}
**Action:** `LeadAckReasonController@update` — edits reason/status/dq_status (also used by the "Mark Inactive" button). `opportunity_type` is immutable; `dq_status` is only applied to disqualified rows.
**Auth:** Bearer token required
**Path params:** `{id}` = lead ack reason id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/lead-ack-reasons/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Target price below our INR floor for Basmati Rice",
  "status": "inactive",
  "dq_status": "negative"
}'
```

**Body fields (all optional; empty/null fields are ignored):**
- `reason` — string, max 500
- `status` — in: `active`, `inactive`
- `dq_status` — in: `positive`, `negative` (applied only when the row is `disqualified`)

---

### DELETE /api/sales/lead-ack-reasons/{id}
**Action:** `LeadAckReasonController@destroy` — hard-deletes an acknowledgement reason (true cleanup; the UI trash icon normally marks inactive via PUT instead). Tenant-scoped.
**Auth:** Bearer token required
**Path params:** `{id}` = lead ack reason id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/lead-ack-reasons/3' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 03 — Quotations, Proforma Invoices, Sales PDF/Email, Procurement, Shipment, Meetings & Reminders

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` **except** the two public signed-URL PDF views (marked _Public (signed URL)_).
> Response shape is generally `{ "status": true, "data": ... }`; validation failures return HTTP 422 with `{ "message": ..., "errors": {...} }`.

---

## QuotationController

Quotation code format: `QT/{FY}/{SEQ}` (e.g. `QT/2026-27/42`). Server recomputes every line `amount` plus `sub_total` / `grand_total` — client-sent totals are ignored.

### GET /api/sales/quotations
**Action:** `QuotationController@index` — paginated list of quotations (branch-scoped), each row stamped with `can_modify` + flattened creator fields.
**Auth:** Bearer token required
**Query params:** `page` (default 1), `per_page` (default 25, max 200), `status`, `doc_type`, `customer_id`, `opp_id`, `start_date` + `end_date` (both required together, `YYYY-MM-DD`), `search` (matches code / opp_code / customer_name / consignee_name).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations?page=1&per_page=25&status=draft&search=QT/2026-27' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/quotations
**Action:** `QuotationController@store` — create a quotation header + line items in one request; allocates next `QT/` code under a client row-lock.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "doc_type": "International",
  "opp_id": 144,
  "customer_id": 21,
  "consignee_id": 9,
  "bank_account_id": 3,
  "currency": "USD",
  "exchange_rate": 83.25,
  "sales_manager_id": 7,
  "inco_term": "CIP – Carriage and Insurance Paid",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 12500,
  "terms": "50% advance, balance against B/L copy.",
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "hsn_code": "90189099",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    },
    {
      "product_id": 102,
      "product_name": "Reagent Kit — VITEK 2 GN ID",
      "hsn_code": "38220090",
      "quantity": 2,
      "unit": "PACK",
      "rate": 32500,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:**
- `doc_type` (required, string) — one of `International` / `Domestic` (`Quotation::DOC_TYPES`).
- `customer_id` (required, int, exists:customers).
- `items` (required, array, min 1).
  - `items.*.product_name` (required, string ≤255)
  - `items.*.quantity` (required, numeric, min 0.01)
  - `items.*.rate` (required, numeric, **gt:0**)
  - `items.*.product_id` (optional, int)
  - `items.*.hsn_code` (optional, string ≤16)
  - `items.*.unit` (optional, string ≤16)
  - `items.*.tax_pct` (optional, numeric, min 0)
- `opp_id` (optional, int, exists:leads)
- `consignee_id` (optional, int, exists:consignees)
- `bank_account_id` (optional, int)
- `currency` (optional, free-form string)
- `exchange_rate` (optional, numeric ≥0)
- `sales_manager_id` (optional, int, exists:users — defaults to lead's salesperson, then creating user)
- `shipping` (optional, numeric ≥0)
- `terms` (optional, string ≤8000)
- `status` (optional) — one of `Quotation::STATUSES` (e.g. `draft`, `sent`, `approved`, `converted_to_pi`, `cancelled`)
- **International** `doc_type` makes these required: `inco_term` (≤100), `port_of_loading` (≤128), `port_of_discharge` (≤128), `final_destination` (≤128), `origin_country` (≤64).
- **Domestic** `doc_type` makes `state_code` (≤64) required; the shipping/port block becomes optional.

### GET /api/sales/quotations/preview-code
**Action:** `QuotationController@previewCode` — read-only preview of the next `QT/{FY}/{SEQ}` code (does not consume a sequence number).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/preview-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/sales/quotations/{id}
**Action:** `QuotationController@show` — single quotation with items, customer, consignee, lead, sales manager.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/quotations/{id}
**Action:** `QuotationController@update` — replace header + all line items (items are wholesale-replaced); enforces forward-only status transitions. Blocked (409) once status is `converted_to_pi`.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "doc_type": "International",
  "customer_id": 21,
  "currency": "USD",
  "inco_term": "FOB Chennai",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 10000,
  "status": "sent",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1700000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:** identical rule set to `store`. Status transitions are restricted: `draft → sent|cancelled`, `sent → approved|cancelled`, `approved → converted_to_pi|cancelled`; `converted_to_pi` and `cancelled` are terminal (422 on illegal move).

### DELETE /api/sales/quotations/{id}
**Action:** `QuotationController@destroy` — soft-cancel (sets `status = cancelled`). Blocked (409) if already `converted_to_pi`.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/quotations/{id}/convert-to-pi
**Action:** `QuotationController@convertToPi` — marks the quotation `converted_to_pi`. Rejected (409) if already converted or cancelled. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/convert-to-pi' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### POST /api/sales/quotations/{id}/duplicate
**Action:** `QuotationController@duplicate` — clone quotation (+ items) as a new `draft` with a freshly allocated `QT/` code. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = source quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/duplicate' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

## ProformaInvoiceController

PI code format: `INV/{FY}/{SEQ}` (e.g. `INV/2026-27/12`). With-shipment PIs also get a bank-transfer ref `BT-NNNN`. Rule: one non-cancelled PI per opportunity (`opp_id`).

### GET /api/sales/proforma-invoices
**Action:** `ProformaInvoiceController@index` — paginated PI list (branch-scoped); each row stamped with `can_modify` + `victory_reached` (lead reached Stage 6).
**Auth:** Bearer token required
**Query params:** `page`, `per_page` (max 200), `status`, `pi_type`, `doc_type`, `customer_id`, `opp_id`, `start_date` + `end_date` (together), `search` (code / bt_id / opp_code / customer_name / consignee_name / convert_from_code).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices?page=1&per_page=25&pi_type=with_shipment&search=INV/2026-27' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/proforma-invoices
**Action:** `ProformaInvoiceController@store` — create a PI header + items; allocates `INV/` code (and `BT-` ref for with-shipment). Returns 409 if the opportunity already has a non-cancelled PI.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "pi_type": "with_shipment",
  "bt_date": "2026-06-03",
  "signing_mode": "digital",
  "source_quotation_id": 55,
  "doc_type": "International",
  "opp_id": 144,
  "customer_id": 21,
  "consignee_id": 9,
  "bank_account_id": 3,
  "currency": "USD",
  "exchange_rate": 83.25,
  "sales_manager_id": 7,
  "inco_term": "CIP – Carriage and Insurance Paid",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 12500,
  "terms": "50% advance against PI, balance before dispatch.",
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "hsn_code": "90189099",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:**
- `doc_type` (required) — `International` / `Domestic`.
- `customer_id` (required, int, exists:customers).
- `items` (required, array, min 1):
  - `items.*.product_name` (required, string ≤255)
  - `items.*.quantity` (required, numeric, min 0.0001)
  - `items.*.rate` (required, numeric, **min 0**)
  - `items.*.product_id` (optional, int), `items.*.hsn_code` (≤16), `items.*.unit` (≤16), `items.*.tax_pct` (numeric ≥0)
- `pi_type` (optional) — `ProformaInvoice::TYPES` (e.g. `with_shipment` / `without_shipment`; defaults `with_shipment`).
- `bt_id` (optional, string ≤24 — auto-allocated `BT-NNNN` when with-shipment and omitted)
- `bt_date` (optional, date)
- `signing_mode` (optional) — `ProformaInvoice::SIGN_MODES`
- `source_quotation_id` (optional, int, exists:quotations — flips that quotation to `converted_to_pi`)
- `opp_id` (optional, int, exists:leads), `consignee_id` (optional, exists:consignees), `bank_account_id` (optional, int)
- `currency` (optional string), `exchange_rate` (numeric ≥0), `sales_manager_id` (int, exists:users), `shipping` (numeric ≥0), `terms` (≤8000), `status` (`ProformaInvoice::STATUSES`)
- International requires `inco_term`/`port_of_loading`/`port_of_discharge`/`final_destination`/`origin_country`; Domestic requires `state_code`.

### POST /api/sales/proforma-invoices/from-quotation/{quotationId}
**Action:** `ProformaInvoiceController@fromQuotation` — create a PI seeded entirely from a quotation (copies header, items, totals); marks the source quotation `converted_to_pi`. No request body. Rejected (409) if the quotation is already converted/cancelled or the opportunity already has a PI.
**Auth:** Bearer token required
**Path params:** `{quotationId}` = source quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/from-quotation/55' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### GET /api/sales/proforma-invoices/preview-code
**Action:** `ProformaInvoiceController@previewCode` — read-only next `INV/{FY}/{SEQ}` preview (does not consume a number).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/preview-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@show` — single PI with items, customer, consignee, lead, source quotation, sales manager.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@update` — replace header + all items. Blocked (409) once `converted_to_contract`; currency is locked (422) when the PI was created from a quotation.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "pi_type": "with_shipment",
  "doc_type": "International",
  "customer_id": 21,
  "currency": "USD",
  "inco_term": "FOB Chennai",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 11000,
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:** same rule set as `store`. Flipping `pi_type` to `without_shipment` clears `bt_id`/`bt_date`.

### DELETE /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@destroy` — soft-cancel (`status = cancelled`). Blocked (409) if `converted_to_contract`.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/proforma-invoices/{id}/duplicate
**Action:** `ProformaInvoiceController@duplicate` — clone PI (+ items) as a new `draft` with a fresh `INV/` code. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = source PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/duplicate' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

## SalesPdfController

Renders Quotation / PI PDFs (DomPDF, A4 portrait). `signature` toggles the authorised-signatory block. Email + reminder endpoints attach the PDF and send via `SalesDocumentEmail` / `SalesReminderEmail`.

### POST /api/sales/pi/preview-pdf
**Action:** `SalesPdfController@previewPi` — render a dummy/mock-data PI PDF straight from the posted row fields (no DB record needed). Returns `application/pdf` inline.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/pi/preview-pdf' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output pi-preview.pdf \
  --data '{
  "piNo": "INV/2026-27/12",
  "piDate": "03/06/2026",
  "btId": "BT-0007",
  "btDate": "03/06/2026",
  "oppId": "OPP-0144",
  "oppDate": "01/06/2026",
  "docType": "International",
  "currency": "$",
  "customer": "Al Falah Trading LLC",
  "consignee": "Jebel Ali Distribution FZE",
  "salesManager": "Ankita",
  "withSignature": true
}'
```

**Body fields (all optional):** `piNo` (≤64), `piDate` (≤32), `btId` (≤32), `btDate` (≤32), `oppId` (≤64), `oppDate` (≤32), `docType` (≤32), `currency` (≤8, accepts symbol or code), `customer` (≤255), `consignee` (≤255), `salesManager` (≤128), `withSignature` (boolean, default true).

### POST /api/sales/proforma-invoices/{id}/preview-pdf
**Action:** `SalesPdfController@previewProformaInvoice` — render the real saved PI as a PDF (inline). Tenant/branch scoped (read).
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.
**Query params:** `signature` (boolean, default true).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/preview-pdf?signature=1' \
  --header 'Authorization: Bearer {{token}}' \
  --output pi-30.pdf
```

**Body fields:** none (uses `?signature=` query flag).

### POST /api/sales/proforma-invoices/{id}/email
**Action:** `SalesPdfController@emailProformaInvoice` — render the PI PDF and email it to the customer; stamps `emailed_at` on first send. Requires write scope (normal branch users can't email main-branch records).
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/email' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:**
- `to` (optional, string) — recipient override; must be a valid email. When omitted, falls back to the customer's primary-address `cp_email`, then `customer.primary_email`. Returns 422 if no valid recipient exists.
- `signature` (optional, boolean, default true) — picks the with/without-signature PDF variant.

### POST /api/sales/proforma-invoices/{id}/remind
**Action:** `SalesPdfController@remindProformaInvoice` — send a follow-up email with the PI PDF; bumps `reminder_count` + `last_reminded_at`. Returns 422 if the initial email (`emailed_at`) was never sent.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/remind' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override), `signature` (optional boolean, default true) — same resolution rules as the email endpoint.

### GET /api/sales/proforma-invoices/{id}/view
**Action:** `SalesPdfController@publicViewProformaInvoice` — public signed-URL PDF view (with signature) opened from the email's "View PI" button.
**Auth:** Public (signed URL) — validated by Laravel `signed` middleware; URL is generated by the email sender via `temporarySignedRoute(..., now()->addDays(60))`. No bearer token.
**Path params:** `{id}` = PI id.
**Query params:** `expires`, `signature` (HMAC query string — generated, not hand-built).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/view?expires=1780000000&signature=abc123hmac' \
  --output pi-public.pdf
```

### POST /api/sales/quotations/{id}/preview-pdf
**Action:** `SalesPdfController@previewQuotation` — render the real saved quotation as a PDF (inline). Tenant/branch scoped (read).
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.
**Query params:** `signature` (boolean, default true).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/preview-pdf?signature=0' \
  --header 'Authorization: Bearer {{token}}' \
  --output qt-55.pdf
```

**Body fields:** none (uses `?signature=` query flag).

### POST /api/sales/quotations/{id}/email
**Action:** `SalesPdfController@emailQuotation` — render the quotation PDF and email it to the customer; stamps `emailed_at`. Requires write scope.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/email' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override; falls back to customer primary email; 422 if none valid), `signature` (optional boolean, default true).

### POST /api/sales/quotations/{id}/remind
**Action:** `SalesPdfController@remindQuotation` — send a reminder email with the quotation PDF; bumps `reminder_count` + `last_reminded_at`. Returns 422 if the initial email was never sent.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/remind' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override), `signature` (optional boolean, default true).

### GET /api/sales/quotations/{id}/view
**Action:** `SalesPdfController@publicViewQuotation` — public signed-URL PDF view (with signature) opened from the email's "View Quotation" button.
**Auth:** Public (signed URL) — validated by Laravel `signed` middleware; 60-day expiry. No bearer token.
**Path params:** `{id}` = quotation id.
**Query params:** `expires`, `signature` (HMAC query string — generated, not hand-built).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/55/view?expires=1780000000&signature=abc123hmac' \
  --output qt-public.pdf
```

---

## ProcurementController

Sales Matrix Stage 3. Multipart create with file attachments. Tenant-scoped to the caller's `client_id`; preview code is `PROC-###`.

### GET /api/procurements
**Action:** `ProcurementController@index` — list procurements for the caller's client (with assignee + products).
**Auth:** Bearer token required
**Query params:** `lead_id` (int), `status` (`inprogress` / `done`).

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements?lead_id=144&status=inprogress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/procurements
**Action:** `ProcurementController@store` — create a procurement with nested products and file attachments (multipart). Validates lead + lead_product cross-tenant / cross-lead integrity.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/procurements' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'lead_id=144' \
  --form 'procurement_date=2026-06-03' \
  --form 'assign_id=7' \
  --form 'status=inprogress' \
  --form 'notes=Source best price from approved vendors' \
  --form 'attachments[]=@/path/to/rfq.pdf' \
  --form 'products[0][product_id]=101' \
  --form 'products[0][lead_product_id]=512' \
  --form 'products[0][qty]=10' \
  --form 'products[0][target_price]=1650000' \
  --form 'products[0][attachment][]=@/path/to/spec-sheet.pdf' \
  --form 'products[1][product_id]=102' \
  --form 'products[1][qty]=20' \
  --form 'products[1][target_price]=31000'
```

**Body fields (multipart):**
- `products` (required, array, min 1):
  - `products.*.product_id` (required, int, exists:products)
  - `products.*.lead_product_id` (optional, int, exists:lead_products — must belong to the same `lead_id`)
  - `products.*.qty` (optional, numeric, **gt:0**)
  - `products.*.target_price` (optional, numeric, **gt:0**)
  - `products.*.attachment[]` (optional files — `jpg,jpeg,png,webp,pdf`, max 5120 KB, magic-mime checked)
- `lead_id` (optional, int, exists:leads — required when any product references `lead_product_id`; must be in caller's tenant)
- `procurement_date` (optional, date)
- `assign_id` (optional, int, exists:users)
- `status` (optional, in: `inprogress`, `done`; default `inprogress`)
- `notes` (optional, string ≤2000)
- `attachments[]` (optional files — `jpg,jpeg,png,webp,pdf`, max 5120 KB, magic-mime checked)

### GET /api/procurements/next-number
**Action:** `ProcurementController@nextNumber` — preview the next `PROC-###` code + `next_id` for the caller's client.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements/next-number' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/procurements/{id}
**Action:** `ProcurementController@show` — single procurement (assignee, creator, lead, products + linked lead products).
**Auth:** Bearer token required
**Path params:** `{id}` = procurement id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ShipmentOrderController

Sales Matrix Stage 6 (Victory). Multipart create/update. One shipment order per opportunity (DB-unique on `lead_id`; second insert → 409).

### GET /api/sales/leads/{leadId}/shipment-order
**Action:** `ShipmentOrderController@getByLead` — fetch the shipment order for a lead (Stage 6 feed). Returns `data: null` if none exists yet.
**Auth:** Bearer token required
**Path params:** `{leadId}` = lead id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/144/shipment-order' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/shipment-orders
**Action:** `ShipmentOrderController@store` — create the shipment/logistics block (multipart). Returns 409 if the opportunity already has a shipment order; 403 if lead/PI not in tenant.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/shipment-orders' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'lead_id=144' \
  --form 'proforma_invoice_id=30' \
  --form 'shipping_liability=Seller' \
  --form 'cold_chain=true' \
  --form 'zip_code=400001' \
  --form 'freight_cost=85000' \
  --form 'shipping_mode=Sea' \
  --form 'inco_term=CIP – Carriage and Insurance Paid' \
  --form 'port_of_loading=INMAA – Chennai Port' \
  --form 'port_of_unloading=Jebel Ali, UAE' \
  --form 'final_destination=Dubai, UAE' \
  --form 'origin_country=India' \
  --form 'remarks=Reefer container, temp 2-8C' \
  --form 'attachments[]=@/path/to/packing-list.pdf'
```

**Body fields (multipart):**
- `lead_id` (required, int, exists:leads — must be in caller's tenant)
- `port_of_loading` (required, string ≤128)
- `proforma_invoice_id` (optional, int, exists:proforma_invoices — must be in tenant)
- `shipping_liability` (optional, string ≤64)
- `cold_chain` (optional, boolean)
- `zip_code` (optional, string ≤12, regex `^[A-Za-z0-9\s\-]+$`)
- `freight_cost` (optional, numeric, **gt:0**)
- `shipping_mode` (optional, string ≤64)
- `inco_term` (optional, string ≤100)
- `port_of_unloading` (optional, string ≤128)
- `final_destination` (optional, string ≤128)
- `origin_country` (optional, string ≤64)
- `remarks` (optional, string ≤2000)
- `attachments[]` (optional files — `jpg,jpeg,png,webp,pdf,doc,docx`, max 5120 KB)

### GET /api/sales/shipment-orders/{id}
**Action:** `ShipmentOrderController@show` — single shipment order with lead, customer, consignee, PI, creator.
**Auth:** Bearer token required
**Path params:** `{id}` = shipment order id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/shipment-orders/8' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/shipment-orders/{id}
**Action:** `ShipmentOrderController@update` — update the shipment order (multipart); new attachments are appended to the existing list. (Route uses POST, not PUT.)
**Auth:** Bearer token required
**Path params:** `{id}` = shipment order id (scoped to caller's client).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/shipment-orders/8' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'shipping_liability=Buyer' \
  --form 'cold_chain=false' \
  --form 'freight_cost=90000' \
  --form 'shipping_mode=Air' \
  --form 'port_of_loading=INMAA – Chennai Port' \
  --form 'remarks=Switched to air freight' \
  --form 'attachments[]=@/path/to/awb.pdf'
```

**Body fields (multipart):** same fields as `store` minus `lead_id` / `proforma_invoice_id` (those are fixed at creation). `port_of_loading` is `sometimes|required` (only validated if present). All others optional with the same rules. New `attachments[]` are appended; omit to keep existing files.

---

## SalesTodoController

Productivity tracker: reminders + meetings. Default scope is "mine" (own rows); admins / main-branch users may pass `?scope=all`. Free-text fields enforce a letters/digits/spaces-only rule. Meeting codes are `M-###` (virtual) / `P-###` (physical).

### GET /api/sales/meetings
**Action:** `SalesTodoController@listMeetings` — list meetings (scoped); ordered by date desc.
**Auth:** Bearer token required
**Query params:** `scope` (`mine` default / `all`), `type` (`SalesMeeting::TYPES` — `virtual` / `physical`), `status` (`SalesMeeting::STATUSES`), `search` (customer / opp_id / code / agenda).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/meetings?scope=mine&type=virtual&status=in_progress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/meetings
**Action:** `SalesTodoController@storeMeeting` — create a meeting; allocates `M-`/`P-` code atomically. JSON body.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/meetings' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "type": "virtual",
  "opp_id": "OPP-0144",
  "customer": "Al Falah Trading LLC",
  "email": "buyer@alfalah.example",
  "contact": "+91 9850558881",
  "platform": "Google Meet",
  "date": "2026-06-10",
  "start_time": "15:00",
  "end_time": "15:30",
  "link": "https://meet.google.com/abc-defg-hij",
  "agenda": "Discuss VITEK pricing and delivery timeline",
  "status": "in_progress"
}'
```

**Body fields:**
- `type` (required) — `virtual` / `physical` (`SalesMeeting::TYPES`).
- `customer` (required, string ≤255, letters/digits/spaces only, 3–255 chars).
- `contact` (required, string ≤50, regex `^\+?[\d\s\-]{10,20}$`, 10–15 digits after stripping).
- `platform` (required, string ≤100).
- `date` (required, date).
- `start_time` (required, `H:i`).
- `end_time` (required, `H:i`, ≥ start_time).
- `agenda` (required, string ≤2000, safe-text 3–2000).
- `link` (string ≤2048, valid URL — **required when** `type=virtual`).
- `venue` (string ≤1000 — **required when** `type=physical`; safe-text 3–1000).
- `opp_id` (optional, string ≤60), `email` (optional, email ≤191), `status` (optional, `SalesMeeting::STATUSES`).

### GET /api/sales/meetings/next-code
**Action:** `SalesTodoController@nextMeetingCode` — preview next meeting code for a type (non-locking).
**Auth:** Bearer token required
**Query params:** `type` (`virtual` default / `physical`).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/meetings/next-code?type=physical' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/meetings/{id}
**Action:** `SalesTodoController@updateMeeting` — update a meeting; if `type` flips, a fresh code is re-allocated. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/meetings/17' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "type": "physical",
  "customer": "Al Falah Trading LLC",
  "contact": "+91 9850558881",
  "platform": "On-site",
  "date": "2026-06-12",
  "start_time": "11:00",
  "end_time": "12:00",
  "venue": "Solitaire Business Hub Baner Pune",
  "agenda": "Final negotiation and contract signing",
  "status": "in_progress"
}'
```

**Body fields:** same rule set as `storeMeeting` (`type`, `customer`, `contact`, `platform`, `date`, `start_time`, `end_time`, `agenda` required; `link`/`venue` conditionally required by type).

### DELETE /api/sales/meetings/{id}
**Action:** `SalesTodoController@destroyMeeting` — soft-delete a meeting. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/meetings/17' \
  --header 'Authorization: Bearer {{token}}'
```

### PATCH /api/sales/meetings/{id}/status
**Action:** `SalesTodoController@setMeetingStatus` — update only the meeting status.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/meetings/17/status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "done"
}'
```

**Body fields:** `status` (required) — one of `SalesMeeting::STATUSES` (e.g. `in_progress`, `done`, `postponed`, `cancelled`).

### GET /api/sales/reminders
**Action:** `SalesTodoController@listReminders` — list reminders (scoped); ordered by set_date desc.
**Auth:** Bearer token required
**Query params:** `scope` (`mine` default / `all`), `status` (`SalesReminder::STATUSES`), `search` (subject / opp_id / remark).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/reminders?scope=mine&status=in_progress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/reminders
**Action:** `SalesTodoController@storeReminder` — create a personal follow-up reminder; optional single file attachment (multipart when attaching).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/reminders' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'opp_id=OPP-0144' \
  --form 'opp_date=2026-06-01' \
  --form 'subject=Follow up on VITEK quotation' \
  --form 'set_date=2026-06-05' \
  --form 'tat=24 Hours' \
  --form 'remark=Customer asked for revised pricing' \
  --form 'status=in_progress' \
  --form 'attachment=@/path/to/note.pdf'
```

**Body fields:**
- `subject` (required, string ≤255, letters/digits/spaces only, 3–255 chars).
- `set_date` (required, date).
- `opp_id` (optional, string ≤60), `opp_date` (optional, date), `tat` (optional, string ≤60; default `24 Hours`), `remark` (optional, string ≤2000), `status` (optional, `SalesReminder::STATUSES`).
- `attachment` (optional file — `png,jpg,jpeg,pdf,doc,docx,xls,xlsx,csv`, max 20480 KB).

### PUT /api/sales/reminders/{id}
**Action:** `SalesTodoController@updateReminder` — update a reminder; replacing the attachment deletes the old file. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/reminders/9' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'subject=Follow up revised pricing' \
  --form 'set_date=2026-06-06' \
  --form 'tat=48 Hours' \
  --form 'remark=Sent revised PI' \
  --form 'status=in_progress'
```

**Body fields:** same rule set as `storeReminder` (`subject` + `set_date` required; others optional). Send as multipart when attaching a file.

### DELETE /api/sales/reminders/{id}
**Action:** `SalesTodoController@destroyReminder` — delete a reminder (and its attachment file). Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/reminders/9' \
  --header 'Authorization: Bearer {{token}}'
```

### PATCH /api/sales/reminders/{id}/status
**Action:** `SalesTodoController@setReminderStatus` — update only the reminder status.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/reminders/9/status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "done"
}'
```

**Body fields:** `status` (required) — one of `SalesReminder::STATUSES` (e.g. `in_progress`, `done`).


---

# Part 04 — Customers & Consignees (with Documents & Owners)

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}` and are tenant-scoped (rows resolved via `forUser()` — client/branch hierarchy). Validation rules below are extracted directly from each controller.

---

## CustomerController

### GET /api/customers
**Action:** `CustomerController@index` — list customers (tenant-scoped), with primary address, consignee counts.
**Auth:** Bearer token required
**Query params:**
- `q` — search across customer_code (exact, upper), primary_email (starts-with), company_name / legal_name / segment / type (contains), and primary address country / cp_name / cp_contact.
- `tab` — `fresh` (default, no leads yet) | `recurring` (has ≥1 lead) | `all`.
- `page`, `per_page` — optional pagination (per_page capped at 200, defaults to 50 when paging is triggered). Omit both for the legacy "return everything" shape.

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers?q=Reliance&tab=all&page=1&per_page=50' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers
**Action:** `CustomerController@store` — create a customer + its primary address (and optional extra locations). Auto-generates `C-###` code. `primary_email` mirrors `primary_address.cp_email`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Reliance Exports Pvt Ltd",
  "legal_name": "Reliance Exports Private Limited",
  "type": "Retailer",
  "segment": "Rice",
  "classification": "Strategic",
  "risk_level": "Low",
  "website": "https://relianceexports.in",
  "status": "Active",
  "primary_address": {
    "type": "Registered Office",
    "address_line": "Plot 14, MIDC Industrial Area, Andheri East",
    "country": "India",
    "state": "Maharashtra",
    "city": "Mumbai",
    "pin": "400093",
    "cp_name": "Ramesh Iyer",
    "cp_designation": "Director",
    "cp_contact": "+91 9820012345",
    "cp_email": "ramesh.iyer@relianceexports.in",
    "cp_whatsapp": "yes"
  },
  "locations": [
    {
      "type": "Warehouse",
      "address_line": "Survey 88, Bhiwandi Logistics Park",
      "country": "India",
      "state": "Maharashtra",
      "city": "Bhiwandi",
      "pin": "421302",
      "cp_name": "Sunil Patil",
      "cp_designation": "Warehouse Manager",
      "cp_contact": "+91 9890054321",
      "cp_email": "sunil.patil@relianceexports.in",
      "cp_whatsapp": "no"
    }
  ]
}'
```

**Body fields:**
- `company_name` (required, string, max 255)
- `legal_name` (optional, string, max 255 — case-insensitive unique per tenant)
- `type` (optional, string, max 64)
- `segment` (optional, string, max 1024)
- `classification` (optional, string, max 64)
- `risk_level` (optional, string, max 32)
- `website` (optional, string, max 500)
- `status` (optional, in: `Active`,`Inactive` — defaults `Active`)
- `primary_address` (required, array):
  - `.type` (required, string, max 64)
  - `.address_line` (required, string, min 4, max 1000)
  - `.country` / `.state` / `.city` (optional, string, max 64)
  - `.pin` (optional, regex `^\d{6}$` — exactly 6 digits)
  - `.cp_name` (required, string, max 255)
  - `.cp_designation` (optional, string, max 128)
  - `.cp_contact` (required, regex `^\+?[0-9\s-]{7,15}$` — unique among primary addresses per tenant)
  - `.cp_email` (required, email, max 255, strict regex — unique against `customers.primary_email` per tenant)
  - `.cp_whatsapp` (optional, in: `yes`,`no`)
- `locations` (optional, array) — each item: `.type`, `.address_line`, `.cp_name` required-with-locations; `.country`/`.state`/`.city`, `.pin` (6-digit), `.cp_designation`, `.cp_contact` (phone regex), `.cp_email` (email regex), `.cp_whatsapp` optional. Email/phone may not duplicate the primary or another location row.

---

### GET /api/customers/master-bundle
**Action:** `CustomerController@masterBundle` — single response bundling 9 master dropdowns (customer_types, segments, customer_classifications, risk_levels, address_types, countries, states, designations, document_type). Tenant-scoped, cached per-user 5 min, only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/customers/{customer}
**Action:** `CustomerController@show` — single customer with primary + extra addresses, plus embedded `documents`, `owners`, and `segment_uploads` (4 round-trips collapsed into 1).
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/customers/{customer}
**Action:** `CustomerController@update` — update a customer; replace-all on addresses (existing rows deleted and recreated from payload). Hierarchical `edit` permission enforced.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Reliance Exports Pvt Ltd",
  "legal_name": "Reliance Exports Private Limited",
  "type": "Distributor",
  "segment": "Rice",
  "classification": "Strategic",
  "risk_level": "Medium",
  "website": "https://relianceexports.in",
  "status": "Active",
  "primary_address": {
    "type": "Registered Office",
    "address_line": "Plot 14, MIDC Industrial Area, Andheri East",
    "country": "India",
    "state": "Maharashtra",
    "city": "Mumbai",
    "pin": "400093",
    "cp_name": "Ramesh Iyer",
    "cp_designation": "Managing Director",
    "cp_contact": "+91 9820012345",
    "cp_email": "ramesh.iyer@relianceexports.in",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:** Same rules as POST (uniqueness checks ignore the current row id).

---

### DELETE /api/customers/{customer}
**Action:** `CustomerController@destroy` — soft-delete a customer (addresses cascade). Hierarchical `delete` permission enforced.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## CustomerDocumentController

Files land on the `public` disk under `customer_documents/{customer_id}/`. Every create/update/delete triggers `ConsigneeKycMirror::resyncForCustomer()` to keep same-as-customer consignees in sync.

### GET /api/customers/{customer}/documents
**Action:** `CustomerDocumentController@index` — list a customer's KYC documents (Company DD + Trade Licence).
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id
**Query params:** `kind` = `dd` | `tl`; `q` = search across name / license_number / issuing_authority.

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/documents?kind=dd&q=IEC' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers/{customer}/documents
**Action:** `CustomerDocumentController@store` — upload a document (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'kind=tl' \
  --form 'name=Import Export Code (IEC)' \
  --form 'license_number=0312345678' \
  --form 'issuing_authority=DGFT' \
  --form 'issue_date=2023-04-01' \
  --form 'expiry_date=2028-03-31' \
  --form 'description=Valid IEC certificate' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/iec_certificate.pdf'
```

**Body fields (multipart):**
- `kind` (required, in: `dd`,`tl`)
- `name` (required, string, max 255)
- `license_number` (optional, string, max 128)
- `issuing_authority` (optional, string, max 255)
- `issue_date` (optional, date)
- `expiry_date` (optional, date, after_or_equal:issue_date)
- `description` (optional, string, max 1000)
- `status` (optional, in: `Active`,`Inactive`)
- `attachment` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)

---

### GET /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@show` — fetch a single document.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@update` — update a document. Use POST (multipart, method-spoofed) to replace/remove the file; use PUT (JSON) for metadata-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

POST (multipart — replace file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'kind=tl' \
  --form 'name=Import Export Code (IEC)' \
  --form 'license_number=0312345678' \
  --form 'issuing_authority=DGFT' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/iec_certificate_v2.pdf'
```

PUT (JSON — metadata only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "kind": "tl",
  "name": "Import Export Code (IEC)",
  "license_number": "0312345678",
  "issuing_authority": "DGFT",
  "status": "Inactive"
}'
```

**Body fields:** Same rules as store. Extra flag: `remove_attachment` (boolean) deletes the existing file when no new `attachment` is sent.

---

### DELETE /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@destroy` — delete a document and its file. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}'
```

---

## CustomerOwnerController

Owner KYC rows carry three file slots (`id_proof`, `address_proof`, `photograph`). Files land under `customer_documents/{customer_id}/owner-*`. Create/update/delete resync same-as-customer consignee mirrors.

### GET /api/customers/{customer}/owners
**Action:** `CustomerOwnerController@index` — list a customer's owner KYC rows.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/owners' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers/{customer}/owners
**Action:** `CustomerOwnerController@store` — add an owner with identity-proof uploads (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/owners' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'owner_name=Ramesh Iyer' \
  --form 'designation=Managing Director' \
  --form 'official_email=ramesh.iyer@relianceexports.in' \
  --form 'phone_number=+91 9820012345' \
  --form 'status=Active' \
  --form 'id_proof=@/path/to/pan_AAAAA0000A.pdf' \
  --form 'address_proof=@/path/to/utility_bill.pdf' \
  --form 'photograph=@/path/to/owner_photo.jpg'
```

**Body fields (multipart):**
- `owner_name` (required, string, max 255)
- `designation` (optional, string, max 128)
- `official_email` (optional, email, max 255)
- `phone_number` (optional, regex `^\+?[0-9\s-]{7,15}$`)
- `status` (optional, in: `Active`,`Inactive`)
- `id_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `address_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `photograph` (optional file, mimes: jpg,jpeg,png only, max 2 MB)

---

### GET /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@show` — fetch a single owner.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@update` — update an owner. Use POST (multipart, method-spoofed) to replace/remove files; use PUT (JSON) for field-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

POST (multipart — replace a file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'owner_name=Ramesh Iyer' \
  --form 'designation=Chairman' \
  --form 'photograph=@/path/to/owner_photo_v2.jpg'
```

PUT (JSON — fields only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "owner_name": "Ramesh Iyer",
  "designation": "Chairman",
  "official_email": "ramesh.iyer@relianceexports.in",
  "phone_number": "+91 9820012345",
  "status": "Active"
}'
```

**Body fields:** Same rules as store. Per-slot removal flags: `remove_id_proof`, `remove_address_proof`, `remove_photograph` (boolean) delete the existing file when no replacement is uploaded.

---

### DELETE /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@destroy` — delete an owner and its three files. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ConsigneeController

Mirrors CustomerController, plus a mandatory `customer_id` (each consignee belongs to a customer) and a `same_as_customer` mirror toggle (at most one mirror consignee per customer).

### GET /api/consignees
**Action:** `ConsigneeController@index` — list consignees (tenant-scoped) with primary address + linked customer.
**Auth:** Bearer token required
**Query params:** `q` = search across company_name / legal_name / consignee_code / primary_email / segment; `customer_id` = filter to one customer.

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees?q=Gulf&customer_id=12' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees
**Action:** `ConsigneeController@store` — create a consignee under a customer; auto-generates `CN-###`. Cross-tenant guard on `customer_id`; only one `same_as_customer` consignee allowed per customer.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12,
  "company_name": "Gulf Trading FZE",
  "legal_name": "Gulf Trading Free Zone Establishment",
  "segment": "Rice",
  "classification": "Standard",
  "risk_level": "Medium",
  "website": "https://gulftrading.ae",
  "status": "Active",
  "same_as_customer": false,
  "primary_address": {
    "type": "Delivery Address",
    "address_line": "Warehouse 22, Jebel Ali Free Zone",
    "country": "United Arab Emirates",
    "state": "Dubai",
    "city": "Dubai",
    "pin": "123456",
    "cp_name": "Khalid Al Mansoori",
    "cp_designation": "Procurement Head",
    "cp_contact": "+971 501234567",
    "cp_email": "khalid@gulftrading.ae",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:**
- `customer_id` (required, integer, exists:customers,id)
- `company_name` (required, string, max 255)
- `legal_name` (optional, string, max 255 — case-insensitive unique per tenant)
- `segment` (optional, string, max 1024)
- `classification` (optional, string, max 64)
- `risk_level` (optional, string, max 32)
- `website` (optional, string, max 500)
- `status` (optional, in: `Active`,`Inactive` — defaults `Active`)
- `same_as_customer` (optional, boolean) — when `true`, the `cp_email`/`cp_contact` uniqueness checks are skipped (the mirror deliberately copies the customer's contact). When `true`, `cp_contact` becomes optional.
- `primary_address` (required, array): same nested rules as customer — `.type` (required, max 64), `.address_line` (required, min 4, max 1000), `.country`/`.state`/`.city` (max 64), `.pin` (6-digit regex), `.cp_name` (required, max 255), `.cp_designation` (max 128), `.cp_whatsapp` (in: yes,no). When NOT same-as-customer: `.cp_email` (required, email regex, unique per tenant) + `.cp_contact` (required, phone regex, unique per tenant). When same-as-customer: `.cp_email` still required; `.cp_contact` nullable; no uniqueness.
- `locations` (optional, array) — same shape/rules as customer locations; in-payload email/phone duplication rejected.

---

### GET /api/consignees/{consignee}
**Action:** `ConsigneeController@show` — single consignee with addresses + linked customer, plus embedded `documents`, `owners`, `segment_uploads`, and parent `customer_locations`.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/consignees/{consignee}
**Action:** `ConsigneeController@update` — update a consignee; replace-all on addresses. Hierarchical `edit` permission + cross-tenant + single-mirror guards enforced.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12,
  "company_name": "Gulf Trading FZE",
  "legal_name": "Gulf Trading Free Zone Establishment",
  "segment": "Rice",
  "classification": "Standard",
  "risk_level": "Low",
  "status": "Active",
  "same_as_customer": false,
  "primary_address": {
    "type": "Delivery Address",
    "address_line": "Warehouse 22, Jebel Ali Free Zone",
    "country": "United Arab Emirates",
    "state": "Dubai",
    "city": "Dubai",
    "pin": "123456",
    "cp_name": "Khalid Al Mansoori",
    "cp_designation": "Procurement Head",
    "cp_contact": "+971 501234567",
    "cp_email": "khalid@gulftrading.ae",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:** Same rules as POST (uniqueness checks ignore the current row; `same_as_customer` defaults to the row's current value if omitted).

---

### DELETE /api/consignees/{consignee}
**Action:** `ConsigneeController@destroy` — soft-delete a consignee. Hierarchical `delete` permission enforced.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/clone-from-customer
**Action:** `ConsigneeController@cloneFromCustomer` — "Same as Customer" deep-clone via `ConsigneeKycMirror`. Wipes the consignee's existing KYC docs + owner rows (and on-disk files), then re-clones the customer's documents and owners (copying file attachments). Replace semantics. Both customer and consignee must be in tenant scope.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/clone-from-customer' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12
}'
```

**Body fields:**
- `customer_id` (required, integer, exists:customers,id)

Response: `{ "ok": true, "cloned": { "documents": N, "owners": M } }`.

---

## ConsigneeDocumentController

Mirrors CustomerDocumentController. Files land under `consignee_documents/{consignee_id}/`. (No mirror resync here — clone is driven from the consignee side.)

### GET /api/consignees/{consignee}/documents
**Action:** `ConsigneeDocumentController@index` — list a consignee's KYC documents.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id
**Query params:** `kind` = `dd` | `tl`; `q` = search across name / license_number / issuing_authority.

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/documents?kind=dd' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/documents
**Action:** `ConsigneeDocumentController@store` — upload a document (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'kind=dd' \
  --form 'name=Trade Licence' \
  --form 'license_number=JAFZA-99887' \
  --form 'issuing_authority=Jebel Ali Free Zone Authority' \
  --form 'issue_date=2024-01-15' \
  --form 'expiry_date=2027-01-14' \
  --form 'description=Free zone trade licence' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/trade_licence.pdf'
```

**Body fields (multipart):**
- `kind` (required, in: `dd`,`tl`)
- `name` (required, string, max 255)
- `license_number` (optional, string, max 128)
- `issuing_authority` (optional, string, max 255)
- `issue_date` (optional, date)
- `expiry_date` (optional, date, after_or_equal:issue_date)
- `description` (optional, string, max 1000)
- `status` (optional, in: `Active`,`Inactive`)
- `attachment` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)

---

### GET /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@show` — fetch a single document.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@update` — update a document. POST (multipart, method-spoofed) replaces/removes the file; PUT (JSON) for metadata only. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

POST (multipart — replace file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'kind=dd' \
  --form 'name=Trade Licence' \
  --form 'license_number=JAFZA-99887' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/trade_licence_v2.pdf'
```

PUT (JSON — metadata only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "kind": "dd",
  "name": "Trade Licence",
  "license_number": "JAFZA-99887",
  "issuing_authority": "Jebel Ali Free Zone Authority",
  "status": "Inactive"
}'
```

**Body fields:** Same rules as store. Extra flag: `remove_attachment` (boolean) clears the file when no new `attachment` is sent.

---

### DELETE /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@destroy` — delete a document and its file. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ConsigneeOwnerController

Mirrors CustomerOwnerController. Three file slots (`id_proof`, `address_proof`, `photograph`); files under `consignee_documents/{consignee_id}/owner-*`.

### GET /api/consignees/{consignee}/owners
**Action:** `ConsigneeOwnerController@index` — list a consignee's owner KYC rows.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/owners' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/owners
**Action:** `ConsigneeOwnerController@store` — add an owner with identity-proof uploads (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/owners' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'owner_name=Khalid Al Mansoori' \
  --form 'designation=Procurement Head' \
  --form 'official_email=khalid@gulftrading.ae' \
  --form 'phone_number=+971 501234567' \
  --form 'status=Active' \
  --form 'id_proof=@/path/to/passport.pdf' \
  --form 'address_proof=@/path/to/tenancy_contract.pdf' \
  --form 'photograph=@/path/to/owner_photo.png'
```

**Body fields (multipart):**
- `owner_name` (required, string, max 255)
- `designation` (optional, string, max 128)
- `official_email` (optional, email, max 255)
- `phone_number` (optional, regex `^\+?[0-9\s-]{7,15}$`)
- `status` (optional, in: `Active`,`Inactive`)
- `id_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `address_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `photograph` (optional file, mimes: jpg,jpeg,png only, max 2 MB)

---

### GET /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@show` — fetch a single owner.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@update` — update an owner. POST (multipart, method-spoofed) replaces/removes files; PUT (JSON) for field-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

POST (multipart — replace a file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'owner_name=Khalid Al Mansoori' \
  --form 'designation=General Manager' \
  --form 'photograph=@/path/to/owner_photo_v2.png'
```

PUT (JSON — fields only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "owner_name": "Khalid Al Mansoori",
  "designation": "General Manager",
  "official_email": "khalid@gulftrading.ae",
  "phone_number": "+971 501234567",
  "status": "Active"
}'
```

**Body fields:** Same rules as store. Per-slot removal flags: `remove_id_proof`, `remove_address_proof`, `remove_photograph` (boolean) clear the existing file when no replacement is uploaded.

---

### DELETE /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@destroy` — delete an owner and its three files. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 05 — Products, Vendors/Suppliers, Master Data (generic), Segment Uploads

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` (Sanctum) and pass through `auth:sanctum` + `user.active` middleware. All queries are tenant-scoped to the authenticated user's `client_id` / `branch_id` (creator-hierarchy via `MasterVisibility`); never send `client_id` in the body — it is derived server-side (only `super_admin` may pass `client_id`/`branch_id` to MasterController create).

---

## ProductController

Step-wise product wizard. Steps: **core → sales → quality → vendors**. Step 1 (core) creates the draft and returns an `id`; later steps target `/products/{id}/step/...`. `status` lifecycle: `draft` (after core) → `inactive` (after quality) → `active` (after vendors mapped). `product_code` auto-allocated as `P-01`, `P-02`, …

### GET /api/products
**Action:** `ProductController@index` — paginated product list, tenant-scoped, with masters + vendor maps + QC records eager-loaded.
**Auth:** Bearer token required
**Query params:** `status` (`active` | `inactive` — inactive bucket includes `draft`), `q` (search name / product_code / brand / generic_name), `vendor_id` (only products mapped to that vendor), `per_page` (default 24)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products?status=active&q=Basmati&per_page=24' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/master-bundle
**Action:** `ProductController@masterBundle` — one-shot bundle of every dropdown the Add/Edit Product modal needs (segments, haz_class, uom, hsn_codes, conditions, packaging_material, gst_percentage, vendors). Cached 5 min per user; only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/owners
**Action:** `ProductController@owners` — users eligible to own a product (branch_user/employee), scoped to caller's branch tier. Returns `[]` for client/super admins.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/owners' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/stats
**Action:** `ProductController@stats` — header chip counts `{active, inactive, total}`.
**Auth:** Bearer token required
**Query params:** `vendor_id` (optional — narrows counts to one vendor's mapped products, mirrors index)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/products/step/core
**Action:** `ProductController@storeCore` — create-or-update Core info (Step 1). Pass `id` to update an existing draft; omit to create. Supports image/file uploads → use multipart. On create it stamps `product_code`, `status=draft`, `step_completed=1`.
**Auth:** Bearer token required

Multipart (with images) example:

```bash
curl -X POST 'http://127.0.0.1:8000/api/products/step/core' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Basmati Rice 1121' \
  --form 'generic_name=Long Grain Rice' \
  --form 'brand=IGC Gold' \
  --form 'segment_id=3' \
  --form 'haz_type=Non-Haz' \
  --form 'uom_id=5' \
  --form 'hsn_id=12' \
  --form 'condition_id=2' \
  --form 'packaging_material_id=4' \
  --form 'description=Premium aged 1121 basmati' \
  --form 'confidential_info=Internal sourcing notes' \
  --form 'primary_image_file=@C:/uploads/rice-front.jpg' \
  --form 'secondary_image_files[]=@C:/uploads/spec-sheet.pdf'
```

JSON (no new files) example:

```bash
curl -X POST 'http://127.0.0.1:8000/api/products/step/core' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "id": 41,
  "name": "Basmati Rice 1121",
  "brand": "IGC Gold",
  "segment_id": 3,
  "uom_id": 5,
  "hsn_id": 12,
  "primary_image": "products/images/abc__rice-front.jpg",
  "secondary_images": ["products/images/def__spec-sheet.pdf"]
}'
```

**Body fields:**
- `id` (optional, int — existing product to update; must exist in `products`)
- `name` (required, string ≤255)
- `generic_name` (optional, string ≤255)
- `description` (optional, string)
- `brand` (optional, string ≤255)
- `segment_id` (optional, int)
- `haz_type` (optional, string ≤20)
- `haz_class_id` (optional, int)
- `uom_id` (optional, int)
- `hsn_id` (optional, int)
- `condition_id` (optional, int)
- `packaging_material_id` (optional, int)
- `confidential_info` (optional, string)
- `primary_image` (optional, string ≤500 — existing path to keep; empty string clears)
- `primary_image_file` (optional, file — jpg,jpeg,png,pdf, max 2 MB — replaces primary)
- `secondary_images` (optional, array of strings ≤500 — existing paths to keep)
- `secondary_images.*` (optional, string ≤500)
- `secondary_image_files` (optional, array, max 10 files — appended)
- `secondary_image_files.*` (file — jpg,jpeg,png,pdf, max 2 MB)

### GET /api/products/{id}
**Action:** `ProductController@show` — full product with relations + inline `segment_uploads` (QC category).
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/41' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/products/{id}
**Action:** `ProductController@destroy` — soft delete (hierarchical delete gate applies).
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/products/41' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/products/{id}/step/sales
**Action:** `ProductController@storeSales` — Step 2 pricing. Sets `step_completed=2`.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/sales' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "base_price": 1200.00,
  "gst_id": 7,
  "gst_amount": 60.00,
  "total_price": 1260.00,
  "mark_bottom": "FOB"
}'
```

**Body fields:** (all optional)
- `base_price` (numeric ≥0)
- `gst_id` (int)
- `gst_amount` (numeric ≥0)
- `total_price` (numeric ≥0)
- `mark_bottom` (string ≤30)

### PUT /api/products/{id}/step/quality
**Action:** `ProductController@storeQuality` — Step 3 quality + inventory + full-sync QC records. Flips `draft` → `inactive`, sets `step_completed=3`. QC attachments → use multipart.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/quality' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'net_weight=25' \
  --form 'gross_weight=25.5' \
  --form 'length_cm=80' \
  --form 'width_cm=50' \
  --form 'height_cm=15' \
  --form 'batch_no=BATCH-2025-01' \
  --form 'lot_no=LOT-9' \
  --form 'qc_records[0][qc_name]=Moisture Test' \
  --form 'qc_records[0][qc_purpose]=Verify moisture <14%' \
  --form 'qc_records[0][issued_by]=Lab QA' \
  --form 'qc_records[0][qa_testing_parameter]=Moisture %' \
  --form 'qc_records[0][min_acceptance_criteria]=<= 14%' \
  --form 'qc_records[0][attachment_file]=@C:/uploads/moisture-report.pdf'
```

**Body fields:** (all optional unless noted)
- `net_weight`, `gross_weight`, `length_cm`, `width_cm`, `height_cm` (numeric ≥0)
- `batch_no`, `serial_no`, `cat_no`, `lot_no` (string ≤100)
- `qc_records` (array — full replace)
  - `qc_records.*.qc_name` (required when `qc_records` present, string ≤100)
  - `qc_records.*.qc_purpose` (string ≤255)
  - `qc_records.*.issued_by` (string ≤255)
  - `qc_records.*.qa_testing_parameter` (string)
  - `qc_records.*.min_acceptance_criteria` (string)
  - `qc_records.*.attachment_path` (string ≤500 — must start with `products/qc/` or it is dropped)
  - `qc_records.*.attachment_file` (file — jpg,jpeg,png,pdf, max 10 MB)

### PUT /api/products/{id}/step/vendors
**Action:** `ProductController@storeVendors` — Step 4 (final). Full-sync vendor mappings, mirrors to vendor side, activates product (`status=active`, `step_completed=4`) and auto-activates mapped vendors.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/vendors' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "vendors": [
    {
      "vendor_id": 8,
      "vendor_code": "V-08",
      "vendor_name": "ABC Exports Pvt Ltd",
      "vendor_website": "https://abcexports.com",
      "contact_person": "Ravi Sharma",
      "contact_no": "+91 9876543210",
      "email": "ravi@abcexports.com",
      "designation": "Procurement Head",
      "purchase_price": 1100.00,
      "gst_percentage": 5,
      "gst_amount": 55.00,
      "total_amount": 1155.00,
      "map_date": "2026-06-03",
      "remarks": "Primary supplier"
    }
  ]
}'
```

**Body fields:**
- `vendors` (required, array, min 1)
  - `vendors.*.vendor_id` (optional, int — must exist in `vendors`; required to mirror onto vendor side)
  - `vendors.*.vendor_code` (optional, string ≤50)
  - `vendors.*.vendor_name` (required, string ≤255)
  - `vendors.*.vendor_website` (optional, string ≤255)
  - `vendors.*.contact_person` (optional, string ≤255)
  - `vendors.*.contact_no` (optional, string ≤50)
  - `vendors.*.email` (optional, email ≤255)
  - `vendors.*.designation` (optional, string ≤100)
  - `vendors.*.attachment_path` (optional, string ≤500)
  - `vendors.*.purchase_price`, `gst_percentage`, `gst_amount`, `total_amount` (optional, numeric ≥0)
  - `vendors.*.map_date` (optional, date)
  - `vendors.*.remarks` (optional, string)

---

## VendorController

Step-wise supplier wizard. Steps: **identity → contacts → kyc → products**. Step 1 (identity) creates the draft and returns the vendor `id` inside `data`. `vendor_code` auto-allocated `V-01`, `V-02`, … `status` lifecycle: `draft` (identity) → `inactive` (after kyc) → `active` (after products mapped). Most responses wrap the vendor in `{ "data": {...} }`. (Stage 3 "Trade Document Management" is not persisted server-side.)

### GET /api/vendors
**Action:** `VendorController@index` — paginated supplier list, tenant-scoped, with primary address + type/segment/risk + product-mapping count.
**Auth:** Bearer token required
**Query params:** `q` (search company_name / legal_name / vendor_code / primary_email), `status` (e.g. `active` / `inactive` / `draft`), `per_page` (default 24)

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors?q=ABC%20Exports&status=active&per_page=24' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/vendors/master-bundle
**Action:** `VendorController@masterBundle` — one-shot bundle of vendor form dropdowns (vendor_types, risk_levels, vendor_behaviour, segments, compliance_behaviours, countries, state_codes, states, license_name, gst_percentage). Cached 5 min per user; only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/vendors/step/identity
**Action:** `VendorController@storeIdentity` — Step 1 create-or-update vendor identity. Pass `id` to update; omit to create (stamps `vendor_code`, `status=draft`, `step_completed=1`). `vendor_type` (a name string) is find-or-created into `master_vendor_types` and resolved to `vendor_type_id`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/step/identity' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "ABC Exports Pvt Ltd",
  "legal_name": "ABC Exports Private Limited",
  "website": "https://abcexports.com",
  "vendor_type": "Material",
  "risk_level_id": 2,
  "vendor_behaviour_id": 1,
  "segment_id": 3,
  "compliance_behaviour_id": 1
}'
```

**Body fields:**
- `id` (optional, int — existing vendor; must exist in `vendors`)
- `company_name` (required, string ≤255)
- `legal_name` (optional, string ≤255)
- `website` (optional, string ≤500)
- `vendor_type_id` (optional, int — must exist in `master_vendor_types`)
- `vendor_type` (optional, string ≤255 — supplier-type name; find-or-created, overrides `vendor_type_id`)
- `risk_level_id` (optional, int — exists `master_risk_levels`)
- `vendor_behaviour_id` (optional, int — exists `master_vendor_behaviour`)
- `segment_id` (optional, int — exists `clm_segments`)
- `compliance_behaviour_id` (optional, int — exists `master_compliance_behaviours`)

### GET /api/vendors/{id}
**Action:** `VendorController@show` — full vendor with all relations + inline `segment_uploads` (supplier).
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors/8' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/vendors/{id}
**Action:** `VendorController@destroy` — soft delete vendor + cleanup on-disk files (hierarchical delete gate applies).
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/vendors/8' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/vendors/{id}/step/contacts
**Action:** `VendorController@storeContacts` — Step 1 contacts. Full-replace of `vendor_addresses` (primary + extras); mirrors primary email onto vendor.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/vendors/8/step/contacts' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "primary_address": {
    "address_line": "Plot 14, MIDC Industrial Area",
    "country_id": 1,
    "state_id": 21,
    "state_code": "MH",
    "city": "Pune",
    "pincode": "411001",
    "contact_name": "Ravi Sharma",
    "designation": "Procurement Head",
    "contact_no": "+91 9876543210",
    "email": "ravi@abcexports.com",
    "whatsapp_enabled": true
  },
  "extra_contacts": [
    {
      "contact_name": "Sneha Patil",
      "designation": "Accounts",
      "contact_no": "+91 9988776655",
      "email": "accounts@abcexports.com",
      "whatsapp_enabled": false
    }
  ]
}'
```

**Body fields:**
- `primary_address` (required, object)
  - `.address_line` (string ≤1000), `.country_id` (int, exists `master_countries`), `.state_id` (int, exists `master_states`), `.state_code` (string ≤32), `.city` (string ≤128), `.pincode` (string ≤16)
  - `.contact_name` (**required**, string ≤255)
  - `.designation` (string ≤128), `.contact_no` (string ≤32), `.email` (email ≤255), `.whatsapp_enabled` (boolean)
- `extra_contacts` (optional, array)
  - `.contact_name` (required, string ≤255)
  - `.designation` (string ≤128), `.contact_no` (string ≤32), `.email` (email ≤255), `.whatsapp_enabled` (boolean), `.attachment_path` (string ≤500)

### POST /api/vendors/{id}/step/kyc
**Action:** `VendorController@storeKyc` — Step 2 KYC/Due Diligence (multipart). Five full-replace sub-collections in one request, each with parallel file arrays. Flips `draft` → `inactive`, `step_completed=2`. Send kept-file references via each row's `existing_path`; new files via the `*_files[<index>]` slot.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/8/step/kyc' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'due_diligence[0][code]=DD-01' \
  --form 'due_diligence[0][document_name]=Company Registration Certificate' \
  --form 'due_diligence[0][issuing_authority]=MCA' \
  --form 'due_diligence[0][expiry]=2027-12-31' \
  --form 'due_diligence[0][mandatory]=1' \
  --form 'dd_files[0]=@C:/uploads/incorporation.pdf' \
  --form 'owner_kyc[0][document_name]=Director PAN' \
  --form 'owner_kyc[0][document_number]=ABCDE1234F' \
  --form 'owner_kyc[0][status]=Active' \
  --form 'owner_files[0]=@C:/uploads/pan.pdf' \
  --form 'trade_licenses[0][license_type_id]=4' \
  --form 'trade_licenses[0][license_number]=IEC0987654321' \
  --form 'trade_licenses[0][issuing_authority]=DGFT' \
  --form 'tl_files[0]=@C:/uploads/iec.pdf' \
  --form 'bank_accounts[0][bank_name]=HDFC Bank' \
  --form 'bank_accounts[0][branch_name]=Pune MIDC' \
  --form 'bank_accounts[0][account_number]=50100123456789' \
  --form 'bank_accounts[0][ifsc]=HDFC0001234' \
  --form 'cheque_files[0]=@C:/uploads/cancelled-cheque.jpg' \
  --form 'gst_scrutiny[0][gst_number]=27ABCDE1234F1Z5' \
  --form 'gst_scrutiny[0][status]=Active'
```

**Body fields:** (all sub-collections optional arrays; full-replace on save)
- **Company Due Diligence** — `due_diligence[]`: `.document_name` (required, ≤255), `.code` (≤32), `.issuing_authority` (≤255), `.expiry` (≤32), `.mandatory` (boolean), `.existing_path` (≤500). Files: `dd_files[]` (jpg,jpeg,png,webp,pdf, max 2 MB)
- **Owner KYC** — `owner_kyc[]`: `.document_name` (required, ≤255), `.code` (≤32), `.issuing_authority` (≤255), `.document_number` (≤128), `.issue_date` (date), `.expiry` (≤32), `.status` (`Active`|`Inactive`), `.existing_path` (≤500). Files: `owner_files[]` (same mimes/size)
- **Trade Licenses** — `trade_licenses[]`: `.license_type_id` (int, exists `master_license_name`), `.code` (≤32), `.license_number` (≤128), `.issuing_authority` (≤255), `.issue_date` (date), `.expiry_date` (date), `.existing_path` (≤500). Files: `tl_files[]` (same mimes/size)
- **Bank Accounts** — `bank_accounts[]`: `.bank_name` (required, ≤255), `.branch_name` (required, ≤255), `.account_number` (required, ≤64), `.ifsc` (required, ≤16), `.branch_address` (≤500), `.existing_path` (≤500). Files: `cheque_files[]` (same mimes/size)
- **GST Scrutiny** — `gst_scrutiny[]`: `.gst_number` (required, ≤16), `.status` (`Active`|`Suspended`|`Cancelled`), `.last_filing_date` (date), `.prev_non_gst_2a_invoice` (≤255), `.red_flags` (≤2000)

### POST /api/vendors/{id}/step/products
**Action:** `VendorController@storeProducts` — Step 4 (final). Full-sync product mappings, mirror to product side, activate vendor (`status=active`, `step_completed=4`) and flip mapped products to active. Duplicate `product_id` in one payload → 422.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/8/step/products' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "mappings": [
    {
      "product_id": 41,
      "batch_serial_lot": "LOT-9",
      "purchase_price": 1100.00,
      "gst_percentage": 5,
      "gst_amount": 55.00,
      "total_amount": 1155.00
    }
  ]
}'
```

**Body fields:**
- `mappings` (required, array, min 1)
  - `mappings.*.product_id` (required, int — exists in `products`; must be unique within payload)
  - `mappings.*.batch_serial_lot` (optional, string ≤128)
  - `mappings.*.purchase_price` (required, numeric ≥0)
  - `mappings.*.gst_percentage` (optional, numeric ≥0)
  - `mappings.*.gst_amount` (optional, numeric ≥0)
  - `mappings.*.total_amount` (optional, numeric ≥0 — defaults to purchase_price)

---

## MasterController

Generic schema-driven CRUD: a single set of routes dispatches ~50 master tables by `{slug}`. Body fields **vary per master** — they are declared per-master in the backend `SCHEMAS` map (and frontend `masterConfigs.ts`); the backend validates dynamically. Almost every master has a `status` enum (`Active` / `Inactive`). Permissions are enforced per slug via `master.{slug}` module (`can_view` / `can_add` / `can_edit` / `can_delete`); system-seeded rows (`is_system`) cannot be edited/deleted. Examples below use representative slugs: **`departments`**, **`countries`**, **`currencies`**.

Valid slugs include: `organization_types`, `company`, `bank_accounts`, `departments`, `roles`, `designations`, `kpis`, `legal_entities`, `countries`, `states`, `state_codes`, `address_types`, `port_of_loading`, `port_of_discharge`, `segments`, `hsn_codes`, `gst_percentage`, `currencies`, `uom`, `packaging_material`, `conditions`, `incoterms`, `customer_types`, `customer_classifications`, `vendor_types`, `vendor_behaviour`, `applicable_types`, `license_name`, `risk_levels`, `document_type`, `haz_class`, `compliance_behaviours`, `assets`, `asset_categories`, `expense_category`, `payment_terms`, `approval_authority`, `procurement_category`, `sourcing_type`, `deviation_reason`, `match_exception`, `advance_payment_rules`, `exchange_rate_log`, `goods_service_flag`, `vendor_directory`, `warehouse_master`, `zone_master`, `rack_type_master`, `temp_class_master`, `racks`, `shelf_master`, `digital_twin`, `freezers`, `leave_type`, `leave_plan`, `trigger_point`.

### GET /api/master-counts
**Action:** `MasterController@counts` — `{ slug: {active, inactive, total} }` map for every master the user can view. Powers the Master dashboard cards.
**Auth:** Bearer token required
**Query params:** `branch_id` (optional, int — branch filter)

```bash
curl -X GET 'http://127.0.0.1:8000/api/master-counts' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/master/{slug}
**Action:** `MasterController@list` — list rows for one master (tenant-scoped), with client/branch/creator names flattened in.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key (e.g. `departments`)
**Query params:** `search` (matches text/email/textarea/select fields), `country_id` (cascade filter for masters that have a `country_id` column, e.g. `states`), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments?search=Finance' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/master/{slug}
**Action:** `MasterController@store` — create a row. Fields depend on the slug's schema; `client_id`/`branch_id`/`created_by` are stamped server-side (only `super_admin` may pass `client_id`/`branch_id`). File fields named `*_file` are stored and written to the matching `*_file_path` column. Some masters auto-generate a `code` (see `next-code`).
**Auth:** Bearer token required (`master.{slug}` `can_add`)
**Path params:** `{slug}` = master key

```bash
# departments (fields: name, code, parent_id, head, email, status)
curl -X POST 'http://127.0.0.1:8000/api/master/departments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Procurement",
  "code": "DEPT-007",
  "email": "procurement@igc.com",
  "status": "Active"
}'

# countries (fields: name, iso_code, status)
curl -X POST 'http://127.0.0.1:8000/api/master/countries' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{ "name": "India", "iso_code": "IN", "status": "Active" }'

# currencies (fields: name, code, symbol, exchange_rate, status)
curl -X POST 'http://127.0.0.1:8000/api/master/currencies' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{ "name": "US Dollar", "code": "USD", "symbol": "$", "exchange_rate": 83.5, "status": "Active" }'
```

**Body fields:** Defined per-master by the backend `SCHEMAS` map (see `masterConfigs.ts` on the frontend). Each field has a name + type (`text` / `email` / `textarea` / `number` / `date` / `select`) + required flag. Common patterns: required `name`/`code`/`title`, required `status` select (`Active`/`Inactive`), `ref` fields are FK ids to another master (e.g. `country_id`, `state_id`, `department_id`). Uniqueness is enforced per-master (case-insensitive on most name/code fields).

### GET /api/master/{slug}/next-code
**Action:** `MasterController@nextCode` — next auto-generated prefixed code for masters that use one (`departments` → `DEPT-001`, `expense_category` → `EXC-01`). Returns `{code: null}` for masters without auto-codes.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/master/{slug}/{id}
**Action:** `MasterController@show` — single master row (tenant-scoped) with ownership fields flattened.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/master/{slug}/{id}
**Action:** `MasterController@update` — update a row. Same dynamic per-slug validation as store. Blocked (403) for system-seeded rows and for users below the row's creator in the hierarchy.
**Auth:** Bearer token required (`master.{slug}` `can_edit`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Procurement & Sourcing",
  "code": "DEPT-007",
  "status": "Active"
}'
```

**Body fields:** Same per-master schema as `POST /api/master/{slug}`.

### DELETE /api/master/{slug}/{id}
**Action:** `MasterController@destroy` — soft delete a row. Blocked (403) for system-seeded rows (e.g. seeded `customer_types`, `risk_levels`, `asset_categories`, `address_types`, `customer_classifications`) and by the hierarchical delete gate.
**Auth:** Bearer token required (`master.{slug}` `can_delete`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## SegmentDocUploadController

Polymorphic segment-rule document uploads (KYC/DD/TL/TD/QC) for a party entity. `{type}` ∈ `customer` | `consignee` | `supplier` (alias `vendor`) | `product`; `{id}` = that entity's id (must belong to caller's tenant). The `(entity, category, doc_code)` tuple is unique — re-uploading the same tuple replaces the previous file. Categories: `kyc`, `dd`, `tl`, `td`, `qc`.

### GET /api/segment-uploads/{type}/{id}
**Action:** `SegmentDocUploadController@index` — list uploads for an entity, plus a `by_category` bucketed map and `count`.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)
**Query params:** `category` (optional — `kyc`|`dd`|`tl`|`td`|`qc`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8?category=kyc' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/segment-uploads/{type}/{id}
**Action:** `SegmentDocUploadController@store` — upload/replace a single reference document (multipart). Replace semantics on matching `(category, doc_code)`. Returns 201 on insert, 200 on replace. (For a `consignee` flagged `same_as_customer`, writes return 409 — manage uploads on the linked customer.)
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/segment-uploads/supplier/8' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'category=kyc' \
  --form 'doc_code=KYC-PAN' \
  --form 'doc_name=Director PAN Card' \
  --form 'requirement=M' \
  --form 'attachment=@C:/uploads/pan.pdf'
```

**Body fields:**
- `category` (required — one of `kyc`,`dd`,`tl`,`td`,`qc`)
- `doc_code` (required, string ≤32)
- `doc_name` (required, string ≤255)
- `requirement` (optional — `M` mandatory | `O` optional; defaults `O`)
- `attachment` (required, file — pdf,jpg,jpeg,png,doc,docx, max 2 MB)

### GET /api/segment-uploads/{type}/{id}/summary
**Action:** `SegmentDocUploadController@summary` — KPI roll-up `{total, mandatory, optional, by_category{...}}`.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/summary' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/segment-uploads/{type}/{id}/vault
**Action:** `SegmentDocUploadController@vault` — Evidence Vault payload: merges the entity's segment rules' expected docs with actual uploads; each doc marked `Verified` (uploaded) or `Pending`. Returns per-bucket arrays (company_dd, owner_kyc, trade_licenses, trade_documents) and counts.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/vault' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/segment-uploads/{type}/{id}/{uploadId}
**Action:** `SegmentDocUploadController@destroy` — remove one upload (deletes the on-disk file).
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric), `{uploadId}` = upload row id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/57' \
  --header 'Authorization: Bearer {{token}}'
```

---

## DummyItemController

Simple `apiResource` (registered via `Route::apiResource('dummy-items', ...)`) — scaffold/diagnostic CRUD, no tenant scoping. Route-model binding param is `{dummy_item}`.

### GET /api/dummy-items
**Action:** `DummyItemController@index` — list all dummy items.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/dummy-items' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/dummy-items
**Action:** `DummyItemController@store` — create a dummy item. Returns 201.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/dummy-items' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sample Item",
  "description": "A throwaway test record"
}'
```

**Body fields:**
- `name` (required, string ≤255)
- `description` (optional, string)

### GET /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@show` — fetch one dummy item.
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X GET 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@update` — update a dummy item.
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Updated Item",
  "description": "Edited description"
}'
```

**Body fields:**
- `name` (optional but required-if-present, `sometimes|required`, string ≤255)
- `description` (optional, string)

### DELETE /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@destroy` — delete a dummy item. Returns 204 (no content).
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 06 — CLM: Agreements, Clauses, T&C, Trade Documents, Segments, Segment Rules, Authorities

> Base URL: `http://127.0.0.1:8000`
> All endpoints require header `Authorization: Bearer {{token}}` and run under `auth:sanctum` + `user.active`.
> CLM = Central Legal Module. All rows are tenant-scoped by the authenticated user's `client_id` (never sent in the body). Library entries hold TipTap rich-text HTML (`content`), segment/party mappings, and optional uploaded DOCX. `upload-docx` and `upload-header-logo` are multipart uploads.

---

## ClmAgreementController

### GET /api/clm/agreement-library
**Action:** `ClmAgreementController@libraryIndex` — list all agreement-library templates (A-NNN) for the tenant; each row carries an `is_signed` flag when a completed Zoho signature request references it.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/agreement-library
**Action:** `ClmAgreementController@libraryStore` — create an agreement-library template (auto-codes `A-NNN` per client).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "agreement_type": "Sales Contract",
  "title": "Tobacco Export Sales Contract",
  "party": "Buyer,Consignee",
  "regulatory": "highly",
  "signing": true,
  "segment": "Tobacco",
  "agr_status": "Active",
  "content": "<h1>Sales Contract</h1><p>This agreement is made between {{seller}} and {{buyer}}.</p>",
  "header_config": { "logo_path": null },
  "footer_config": { "text": "Confidential" }
}'
```

**Body fields:**
- `agreement_type` (required, string, max 255) — links to an agreement-type name.
- `title` (required, string, max 255).
- `party` (required, string, max 255) — CSV of party types, e.g. `Buyer,Consignee`.
- `regulatory` (optional, enum — one of `ClmAgreementLibrary::REG_VALUES`, e.g. `highly` / `less`; defaults to less).
- `signing` (optional, boolean; default `true`).
- `segment` (optional, string, max 1024) — CSV of segment names/codes.
- `agr_status` (optional, string, max 32; default `Active`).
- `content` (optional, string) — TipTap HTML body.
- `header_config` (optional, array/object) — page-shell config.
- `footer_config` (optional, array/object).

---

### POST /api/clm/agreement-library/upload-header-logo
**Action:** `ClmAgreementController@uploadHeaderLogo` — upload a header logo for the agreement page-shell; returns `{ path, url }`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library/upload-header-logo' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields (multipart):**
- `logo` (required, file; mimes `png,jpg,jpeg,svg,webp`; max 5120 KB).

---

### PUT /api/clm/agreement-library/{id}
**Action:** `ClmAgreementController@libraryUpdate` — update an agreement template. Returns 422 if the agreement already has a completed signature request (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/agreement-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Tobacco Export Sales Contract (Rev 2)",
  "regulatory": "highly",
  "agr_status": "Active",
  "content": "<p>Updated clause body…</p>"
}'
```

**Body fields:** all optional (use `sometimes`):
- `agreement_type` (string, max 255, required if present).
- `title` (string, max 255, required if present).
- `party` (string, max 255, required if present).
- `regulatory` (nullable, enum `ClmAgreementLibrary::REG_VALUES`).
- `signing` (nullable, boolean).
- `segment` (nullable, string, max 1024).
- `agr_status` (nullable, string, max 32).
- `content` (nullable, string).
- `header_config` (nullable, array).
- `footer_config` (nullable, array).

---

### DELETE /api/clm/agreement-library/{id}
**Action:** `ClmAgreementController@libraryDestroy` — delete an agreement template. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/agreement-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/agreement-library/{id}/download
**Action:** `ClmAgreementController@downloadDocx` — download the agreement as DOCX (streams the uploaded DOCX if present, otherwise generates one from the `content` HTML). Binary response.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-library/1/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output agreement.docx
```

---

### POST /api/clm/agreement-library/{id}/upload-docx
**Action:** `ClmAgreementController@uploadDocx` — upload a revised Word doc; stores it and refreshes the row's `content` HTML from the DOCX.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library/1/upload-docx' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'docx=@/path/to/agreement.docx'
```

**Body fields (multipart):**
- `docx` (required, file; mimes `doc,docx`; max 20480 KB / 20 MB).

---

### GET /api/clm/agreement-types
**Action:** `ClmAgreementController@typesIndex` — list agreement types (AT-NNN: Sales Contract, MSA, NDA, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-types' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/agreement-types
**Action:** `ClmAgreementController@typesStore` — create an agreement type (auto-codes `AT-NNN`). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Non-Disclosure Agreement",
  "description": "Mutual NDA used before sharing pricing and process data."
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `description` (required, string, max 500).

---

### PUT /api/clm/agreement-types/{id}
**Action:** `ClmAgreementController@typesUpdate` — update an agreement type. Returns 409 on rename to a duplicate name.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-type row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/agreement-types/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Master Service Agreement",
  "description": "Umbrella MSA covering recurring engagements."
}'
```

**Body fields:** both optional (`sometimes|required`):
- `name` (string, max 255).
- `description` (string, max 500).

---

### DELETE /api/clm/agreement-types/{id}
**Action:** `ClmAgreementController@typesDestroy` — delete an agreement type.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-type row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/agreement-types/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/leads/{leadId}/agreement-applicable
**Action:** `ClmAgreementController@applicableForLead` — resolve applicable agreements for a lead by walking its latest PI/quotation → product segments → matching agreement-library rows, grouped by regulatory tier, with live signature-request status.
**Auth:** Bearer token required
**Path params:** `{leadId}` = lead (opportunity) id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/leads/42/agreement-applicable' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmClauseController

### GET /api/clm/clause-library
**Action:** `ClmClauseController@libraryIndex` — list clause-library entries (CL-NNN: Force Majeure, Governing Law, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/clause-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/clause-library
**Action:** `ClmClauseController@libraryStore` — create a clause (auto-codes `CL-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/clause-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "clause_type": "Core Legal",
  "name": "Force Majeure",
  "party": "Buyer",
  "clause_status": "Active",
  "content": "<p>Neither party shall be liable for failure to perform due to events beyond reasonable control.</p>"
}'
```

**Body fields:**
- `clause_type` (required, string, max 255).
- `name` (required, string, max 255).
- `party` (optional, string, max 255).
- `clause_status` (optional, string, max 32; default `Active`).
- `content` (optional, string) — TipTap HTML.

---

### PUT /api/clm/clause-library/{id}
**Action:** `ClmClauseController@libraryUpdate` — update a clause.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/clause-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Governing Law",
  "clause_status": "Active",
  "content": "<p>This agreement is governed by the laws of India.</p>"
}'
```

**Body fields:** all optional:
- `clause_type` (string, max 255, required if present).
- `name` (string, max 255, required if present).
- `party` (nullable, string, max 255).
- `clause_status` (nullable, string, max 32).
- `content` (nullable, string).

---

### DELETE /api/clm/clause-library/{id}
**Action:** `ClmClauseController@libraryDestroy` — delete a clause.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/clause-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/clause-types
**Action:** `ClmClauseController@typesIndex` — list clause types (CLT-NNN: Core Legal, Commercial, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/clause-types' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/clause-types
**Action:** `ClmClauseController@typesStore` — create a clause type (auto-codes `CLT-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/clause-types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Commercial",
  "description": "Pricing, payment terms, and delivery clauses."
}'
```

**Body fields:**
- `name` (required, string, max 255).
- `description` (optional/nullable, string, max 500).

---

### PUT /api/clm/clause-types/{id}
**Action:** `ClmClauseController@typesUpdate` — update a clause type.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-type row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/clause-types/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Core Legal"
}'
```

**Body fields:** both optional:
- `name` (string, max 255, required if present).
- `description` (nullable, string, max 500).

---

### DELETE /api/clm/clause-types/{id}
**Action:** `ClmClauseController@typesDestroy` — delete a clause type.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-type row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/clause-types/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTncController

### GET /api/clm/tnc-categories
**Action:** `ClmTncController@categoriesIndex` — list T&C categories (DC-NNN: International - Proforma Invoice, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/tnc-categories' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/tnc-categories
**Action:** `ClmTncController@categoriesStore` — create a T&C category (auto-codes `DC-NNN`; `short_code` upper-cased).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/tnc-categories' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "short_code": "PI-INTL",
  "name": "International - Proforma Invoice"
}'
```

**Body fields:**
- `short_code` (required, string, max 12) — stored upper-cased.
- `name` (required, string, max 255).

---

### PUT /api/clm/tnc-categories/{id}
**Action:** `ClmTncController@categoriesUpdate` — update a T&C category.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C category row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/tnc-categories/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "short_code": "QT-INTL",
  "name": "International - Quotation"
}'
```

**Body fields:** both optional (`sometimes|required`):
- `short_code` (string, max 12).
- `name` (string, max 255).

---

### DELETE /api/clm/tnc-categories/{id}
**Action:** `ClmTncController@categoriesDestroy` — delete a T&C category.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C category row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/tnc-categories/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/tnc-library
**Action:** `ClmTncController@libraryIndex` — list T&C library blocks (TNC-NNN) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/tnc-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/tnc-library
**Action:** `ClmTncController@libraryStore` — create a reusable T&C block (auto-codes `TNC-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/tnc-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment": "Rice",
  "category": "International - Proforma Invoice",
  "party": "Buyer",
  "content": "<ol><li>Payment 100% in advance by T/T.</li><li>Goods inspected before shipment.</li></ol>"
}'
```

**Body fields:**
- `segment` (optional/nullable, string, max 64; default `General`).
- `category` (required, string, max 255).
- `party` (required, string, max 255).
- `content` (optional, string) — TipTap HTML.

---

### PUT /api/clm/tnc-library/{id}
**Action:** `ClmTncController@libraryUpdate` — update a T&C block.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/tnc-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment": "Food Grade Ethanol",
  "category": "International - Quotation",
  "party": "Consignee",
  "content": "<p>Revised terms and conditions.</p>"
}'
```

**Body fields:**
- `segment` (nullable, string, max 64).
- `category` (string, max 255, required if present).
- `party` (string, max 255, required if present).
- `content` (nullable, string).

---

### DELETE /api/clm/tnc-library/{id}
**Action:** `ClmTncController@libraryDestroy` — delete a T&C block.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/tnc-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTradeDocumentController

### GET /api/clm/trade-doc-library
**Action:** `ClmTradeDocumentController@libraryIndex` — list trade-document library entries (TD-NNN) for the tenant; rows carry an `is_signed` flag when a completed signature request references them.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-library
**Action:** `ClmTradeDocumentController@libraryStore` — create a trade-document library entry (auto-codes `TD-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Commercial Invoice",
  "title": "Export Commercial Invoice Template",
  "doc_type": "Invoice",
  "purpose": "Customs clearance and buyer billing for export shipments.",
  "party": "Buyer,Consignee",
  "file_path": null,
  "content": "<h2>Commercial Invoice</h2><p>{{shipment_details}}</p>",
  "header_config": { "logo_path": null },
  "footer_config": { "text": "Page {{page}}" }
}'
```

**Body fields:**
- `name` (required, string, max 255).
- `title` (required, string, max 255).
- `doc_type` (required, string, max 64) — e.g. `Invoice`, `Packing List`, `Certificate`.
- `purpose` (required, string, max 500).
- `party` (required, string, max 255) — CSV: `Buyer`, `Consignee`, `Supplier-Material`, etc.
- `file_path` (optional/nullable, string, max 500).
- `content` (optional, string) — TipTap HTML.
- `header_config` (optional, array/object).
- `footer_config` (optional, array/object).

---

### GET /api/clm/trade-doc-library/for-party/{party}
**Action:** `ClmTradeDocumentController@libraryForParty` — filter trade-doc library rows whose `party` CSV mentions the given party bucket.
**Auth:** Bearer token required
**Path params:** `{party}` = party key. Logical buckets: `buyer`/`customer` → matches `Buyer`; `consignee` → matches `Consignee`; `supplier` → matches any `Supplier-*` sub-type; anything else → literal substring match.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library/for-party/buyer' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-library/upload-header-logo
**Action:** `ClmTradeDocumentController@uploadHeaderLogo` — upload a header logo for the trade-doc page-shell; returns `{ path, url }`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library/upload-header-logo' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields (multipart):**
- `logo` (required, file; mimes `png,jpg,jpeg,svg,webp`; max 5120 KB).

---

### PUT /api/clm/trade-doc-library/{id}
**Action:** `ClmTradeDocumentController@libraryUpdate` — update a trade-document entry. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-doc-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Export Commercial Invoice Template (v2)",
  "doc_type": "Invoice",
  "purpose": "Updated customs + billing template.",
  "party": "Buyer",
  "content": "<p>Updated body…</p>"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `title` (string, max 255, required if present).
- `doc_type` (string, max 64, required if present).
- `purpose` (string, max 500, required if present).
- `party` (string, max 255, required if present).
- `file_path` (nullable, string, max 500).
- `content` (nullable, string).
- `header_config` (nullable, array).
- `footer_config` (nullable, array).

---

### DELETE /api/clm/trade-doc-library/{id}
**Action:** `ClmTradeDocumentController@libraryDestroy` — delete a trade-document entry. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-doc-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/trade-doc-library/{id}/download
**Action:** `ClmTradeDocumentController@downloadDocx` — download the trade document as DOCX (uploaded DOCX if present, otherwise generated from `content` HTML). Binary response.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library/1/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output trade-document.docx
```

---

### POST /api/clm/trade-doc-library/{id}/upload-docx
**Action:** `ClmTradeDocumentController@uploadDocx` — upload a revised Word doc; stores it and refreshes the row's `content` HTML from the DOCX.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library/1/upload-docx' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'docx=@/path/to/trade-document.docx'
```

**Body fields (multipart):**
- `docx` (required, file; mimes `doc,docx`; max 20480 KB / 20 MB).

---

### GET /api/clm/trade-doc-names
**Action:** `ClmTradeDocumentController@namesIndex` — list trade-document name catalog entries (TDN-NNN) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-names' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-names
**Action:** `ClmTradeDocumentController@namesStore` — create a trade-document name catalog entry (auto-codes `TDN-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-names' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Certificate of Origin"
}'
```

**Body fields:**
- `name` (required, string, max 255).

---

### PUT /api/clm/trade-doc-names/{id}
**Action:** `ClmTradeDocumentController@namesUpdate` — rename a trade-document name catalog entry.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc name row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-doc-names/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Packing List"
}'
```

**Body fields:**
- `name` (required, string, max 255).

---

### DELETE /api/clm/trade-doc-names/{id}
**Action:** `ClmTradeDocumentController@namesDestroy` — delete a trade-document name catalog entry.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc name row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-doc-names/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSegmentController

### GET /api/clm/segments
**Action:** `ClmSegmentController@index` — list business segments (S-NNN) for the tenant with `counts` for all / highly / less regulatory tiers.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segments' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/segments
**Action:** `ClmSegmentController@store` — create a segment (auto-codes `S-NNN` under a row lock). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/segments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Tobacco",
  "regulatory_status": "highly",
  "buyer_consignee": "both",
  "status": "active"
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `regulatory_status` (required, enum — one of `ClmSegment::REG_VALUES`, e.g. `highly` / `less`).
- `buyer_consignee` (required, enum — one of `ClmSegment::BC_VALUES`, e.g. `buyer` / `consignee` / `both`).
- `status` (optional/nullable, enum — one of `ClmSegment::STATUSES`, e.g. `active` / `inactive`; default `active`).

---

### PUT /api/clm/segments/{id}
**Action:** `ClmSegmentController@update` — update a segment (`code` is immutable). Returns 409 on rename to a duplicate.
**Auth:** Bearer token required
**Path params:** `{id}` = segment row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/segments/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Food Grade Ethanol",
  "regulatory_status": "highly",
  "buyer_consignee": "both",
  "status": "active"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `regulatory_status` (enum `ClmSegment::REG_VALUES`, required if present).
- `buyer_consignee` (enum `ClmSegment::BC_VALUES`, required if present).
- `status` (nullable, enum `ClmSegment::STATUSES`).

---

### DELETE /api/clm/segments/{id}
**Action:** `ClmSegmentController@destroy` — hard-delete a segment. Returns 409 with `used_in` if referenced by segment rules, vendors, products, customers, consignees, T&C/agreement library, or vendor directory.
**Auth:** Bearer token required
**Path params:** `{id}` = segment row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/segments/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSegmentRuleController

### GET /api/clm/segment-rules
**Action:** `ClmSegmentRuleController@index` — list segment rules (SR-NNN) for the tenant with `counts` for all / highly / less tiers.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/segment-rules
**Action:** `ClmSegmentRuleController@store` — create a segment rule (auto-codes `SR-NNN`; rolls up M/O counts). Returns 409 with the existing row if a rule already exists for that `segment_code` (one rule per segment per tenant).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/segment-rules' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment_code": "S-001",
  "regulatory_status": "highly",
  "auths": ["AUTH-001", "AUTH-002"],
  "doc_selections": {
    "kyc": { "KYC-001": "M", "KYC-002": "O" },
    "dd":  { "DD-001": "M" },
    "tl":  { "TL-001": "M" },
    "td":  { "TD-001": "O" },
    "qc":  { "QC-001": "O" }
  }
}'
```

**Body fields:**
- `segment_code` (required, string, max 16) — the segment's `S-NNN` code.
- `regulatory_status` (required, enum — one of `ClmSegmentRule::REG_VALUES`, e.g. `highly` / `less`).
- `auths` (optional/nullable, array of strings) — authority codes (e.g. `AUTH-001`); stored as `auths_json`.
- `doc_selections` (required, array/object) — per-category map. Sub-keys all optional arrays: `doc_selections.kyc`, `.dd`, `.tl`, `.td`, `.qc`. Each maps a document code → `M` (mandatory) or `O` (optional).

---

### GET /api/clm/segment-rules/bootstrap
**Action:** `ClmSegmentRuleController@bootstrap` — bundle every master collection the Add-Segment-Rule modal needs (segments, authorities, kyc, dd, tl, td, qc) in one round-trip.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules/bootstrap' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/segment-rules/for-segment/{segmentId}
**Action:** `ClmSegmentRuleController@forSegment` — resolve the segment rule for a segment plus full KYC/DD/TL/TD/QC master rows referenced by its `doc_selections`, each stamped with its `requirement` (`M`/`O`). Always 200 (`rule` is null when none exists).
**Auth:** Bearer token required
**Path params:** `{segmentId}` = segment row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules/for-segment/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/clm/segment-rules/{id}
**Action:** `ClmSegmentRuleController@update` — update a segment rule; re-rolls M/O counts and re-resolves `segment_id` from `segment_code`.
**Auth:** Bearer token required
**Path params:** `{id}` = segment-rule row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/segment-rules/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment_code": "S-001",
  "regulatory_status": "less",
  "auths": ["AUTH-001"],
  "doc_selections": {
    "kyc": { "KYC-001": "M" },
    "dd":  {},
    "tl":  { "TL-001": "O" },
    "td":  {},
    "qc":  {}
  }
}'
```

**Body fields:** same validation as POST:
- `segment_code` (required, string, max 16).
- `regulatory_status` (required, enum `ClmSegmentRule::REG_VALUES`).
- `auths` (nullable, array of strings).
- `doc_selections` (required, array/object) with optional `kyc`/`dd`/`tl`/`td`/`qc` sub-arrays of `code → M|O`.

---

### DELETE /api/clm/segment-rules/{id}
**Action:** `ClmSegmentRuleController@destroy` — delete a segment rule.
**Auth:** Bearer token required
**Path params:** `{id}` = segment-rule row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/segment-rules/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmAuthorityController

### GET /api/clm/authorities
**Action:** `ClmAuthorityController@index` — list regulatory authorities (AUTH-NNN: FSSAI, DGFT, BIS, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/authorities' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/authorities
**Action:** `ClmAuthorityController@store` — create an authority (auto-codes `AUTH-NNN` under a row lock). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/authorities' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "FSSAI",
  "description": "Food Safety and Standards Authority of India.",
  "status": "active"
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `description` (required, string, max 500).
- `status` (optional/nullable, enum — one of `ClmAuthority::STATUSES`, e.g. `active` / `inactive`; default `active`).

---

### PUT /api/clm/authorities/{id}
**Action:** `ClmAuthorityController@update` — update an authority. Returns 409 on rename to a duplicate.
**Auth:** Bearer token required
**Path params:** `{id}` = authority row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/authorities/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "DGFT",
  "description": "Directorate General of Foreign Trade.",
  "status": "active"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `description` (string, max 500, required if present).
- `status` (nullable, enum `ClmAuthority::STATUSES`).

---

### DELETE /api/clm/authorities/{id}
**Action:** `ClmAuthorityController@destroy` — delete an authority. Returns 409 with `used_in` if referenced by KYC/DD/trade-license/QC docs, vendor/customer documents, vendor owners (by name), or segment rules (by code in `auths_json`).
**Auth:** Bearer token required
**Path params:** `{id}` = authority row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/authorities/1' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 07 — CLM: KYC, Due Diligence, QC, Trade Licenses, Zoho Signature, Buyer/Supplier Profiles

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}`. The authenticated user's `client_id` scopes every query — never send it in the body.

---

## ClmKycController

KYC document master CRUD. Codes auto-allocate as `KYC-001`, `KYC-002`, … under a per-client row lock. `status` enum comes from `ClmKycDocument::STATUSES` (typically `active` / `inactive`). Name is unique per client (case-insensitive → 409 on collision).

### GET /api/clm/kyc-documents
**Action:** `ClmKycController@index` — list all KYC documents for the caller's tenant (ordered by id).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/kyc-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/kyc-documents
**Action:** `ClmKycController@store` — create a KYC document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/kyc-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "GST Registration Certificate",
  "authority": "GSTN",
  "expiry": "2027-03-31",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `expiry` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — must be in `ClmKycDocument::STATUSES`; defaults to active)

### PUT /api/clm/kyc-documents/{id}
**Action:** `ClmKycController@update` — partial update of a KYC document.
**Auth:** Bearer token required
**Path params:** `{id}` = KYC document id (scoped to caller's client)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/kyc-documents/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "GST Registration Certificate (Updated)",
  "authority": "GSTN",
  "expiry": "2028-03-31",
  "status": "inactive"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `expiry` (string, max 32, nullable)
- `status` (string, in `ClmKycDocument::STATUSES`, nullable)

### DELETE /api/clm/kyc-documents/{id}
**Action:** `ClmKycController@destroy` — delete a KYC document; blocked with 409 if referenced by Segment Rules or Segment Doc Uploads.
**Auth:** Bearer token required
**Path params:** `{id}` = KYC document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/kyc-documents/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmDdController

Due-Diligence document master CRUD. Identical shape to KYC; codes auto-allocate as `DD-001`, `DD-002`, …. Name unique per client (409 on collision). Deletion blocked when referenced by Segment Rules / Segment Doc Uploads.

### GET /api/clm/dd-documents
**Action:** `ClmDdController@index` — list all DD documents for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/dd-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/dd-documents
**Action:** `ClmDdController@store` — create a DD document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/dd-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sanctions Screening Report",
  "authority": "OFAC",
  "expiry": "2026-12-31",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `expiry` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — in `ClmDdDocument::STATUSES`)

### PUT /api/clm/dd-documents/{id}
**Action:** `ClmDdController@update` — partial update of a DD document.
**Auth:** Bearer token required
**Path params:** `{id}` = DD document id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/dd-documents/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sanctions Screening Report (Q2)",
  "status": "inactive"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `expiry` (string, max 32, nullable)
- `status` (string, in `ClmDdDocument::STATUSES`, nullable)

### DELETE /api/clm/dd-documents/{id}
**Action:** `ClmDdController@destroy` — delete a DD document; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = DD document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/dd-documents/3' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmQcController

Quality-Compliance document master CRUD. Codes auto-allocate as `QC-001`, …. Has a `doc_type` discriminator (`ClmQcDocument::TYPES` — cert vs comp; index returns `counts.cert`/`counts.comp`). Name unique per client. Deletion blocked if referenced by Segment Rules, Segment Doc Uploads, or Product QC Records (by name).

### GET /api/clm/qc-documents
**Action:** `ClmQcController@index` — list all QC documents plus type counts (`all`/`cert`/`comp`).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/qc-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/qc-documents
**Action:** `ClmQcController@store` — create a QC document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/qc-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Phytosanitary Certificate",
  "purpose": "Confirms consignment is free from quarantine pests",
  "issued_by": "Plant Quarantine Authority",
  "doc_type": "cert",
  "qa_params": "Moisture <= 14%; Foreign matter <= 1%",
  "min_criteria": "Grade A export quality",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `purpose` (string, required, max 500)
- `issued_by` (string, required, max 255)
- `doc_type` (string, optional — in `ClmQcDocument::TYPES`; defaults to cert)
- `qa_params` (string, optional, nullable)
- `min_criteria` (string, optional, nullable)
- `status` (string, optional — in `ClmQcDocument::STATUSES`)

### PUT /api/clm/qc-documents/{id}
**Action:** `ClmQcController@update` — partial update of a QC document.
**Auth:** Bearer token required
**Path params:** `{id}` = QC document id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/qc-documents/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "purpose": "Updated quarantine confirmation scope",
  "doc_type": "comp",
  "min_criteria": "Grade A+ export quality"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `purpose` (string, max 500, required-if-present)
- `issued_by` (string, max 255, required-if-present)
- `doc_type` (string, in `ClmQcDocument::TYPES`, nullable)
- `qa_params` (string, nullable)
- `min_criteria` (string, nullable)
- `status` (string, in `ClmQcDocument::STATUSES`, nullable)

### DELETE /api/clm/qc-documents/{id}
**Action:** `ClmQcController@destroy` — delete a QC document; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = QC document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/qc-documents/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTradeLicenseController

Trade-License master CRUD. Codes auto-allocate as `TL-001`, …. Uses `validity` (not `expiry`). Name unique per client. Deletion blocked if referenced by Segment Rules / Segment Doc Uploads.

### GET /api/clm/trade-licenses
**Action:** `ClmTradeLicenseController@index` — list all trade licenses for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-licenses' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/trade-licenses
**Action:** `ClmTradeLicenseController@store` — create a trade license (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-licenses' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Importer Exporter Code (IEC)",
  "authority": "DGFT",
  "validity": "Lifetime",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `validity` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — in `ClmTradeLicense::STATUSES`)

### PUT /api/clm/trade-licenses/{id}
**Action:** `ClmTradeLicenseController@update` — partial update of a trade license.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-license id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-licenses/2' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "FSSAI License",
  "authority": "FSSAI",
  "validity": "5 years",
  "status": "active"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `validity` (string, max 32, nullable)
- `status` (string, in `ClmTradeLicense::STATUSES`, nullable)

### DELETE /api/clm/trade-licenses/{id}
**Action:** `ClmTradeLicenseController@destroy` — delete a trade license; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-license id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-licenses/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSignatureController

Wraps Zoho Sign e-signature. Two send flows: **trade-doc** (`clm_trade_doc_library` against a single party) and **agreement** (`clm_agreement_library` against a Sales Matrix lead, auto-composing buyer + consignee signers). Send/preview render PDFs locally; send ships them to Zoho. Requires Zoho Sign configured (503 if not) and a tenant context (403 if user has no `client_id`).

### POST /api/clm/signature-requests
**Action:** `ClmSignatureController@send` — render selected trade-doc drafts to PDF, ship to Zoho Sign, persist the request.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "trade_doc_ids": [12, 13],
  "party_id": 45,
  "model_name": "Customer",
  "signers": [
    { "email": "rahul@example.com", "name": "Rahul Sharma", "order": 1 }
  ],
  "expiry_days": 30,
  "is_sequential": false,
  "notes": "Please review and sign these documents.",
  "document_settings": {
    "12": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 },
    "13": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 }
  }
}'
```

**Body fields:**
- `trade_doc_ids` (array, required, 1–10) of `integer` — each must exist in `clm_trade_doc_library`
- `party_id` (integer, required)
- `model_name` (string, optional — `Customer` | `Consignee` | `Vendor`; defaults `Customer`)
- `signers` (array, required, 1–5):
  - `signers.*.email` (email, required)
  - `signers.*.name` (string, required, max 255)
  - `signers.*.order` (integer, optional, min 1 — defaults to array position)
- `expiry_days` (integer, optional, 1–180 — defaults 30)
- `is_sequential` (boolean, optional)
- `notes` (string, optional, max 1000)
- `document_settings` (object, optional) — keyed by `trade_doc_id` → `{ x, y, page, width, height }` signature-field placement
- `header_config_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc header overrides
- `footer_config_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc footer overrides
- `content_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc body HTML override

### GET /api/clm/signature-requests
**Action:** `ClmSignatureController@index` — list signature requests (latest first, max 200); optionally polls Zoho for live status.
**Auth:** Bearer token required
**Query params:**
- `party_id` (int) — filter by party (a `Consignee` flagged `same_as_customer` is transparently swapped to its parent customer)
- `model_name` (string) — `Customer` | `Consignee` | `Vendor`
- `document_type` (string) — e.g. `agreement` to scope agreement-flow rows
- `lead_id` (int) — scope to an opportunity
- `status` (string or array) — e.g. `inprogress`, `completed`, `recalled`
- `sync` (bool) — `true` to refresh still-inprogress (and completed-but-missing-file) rows from Zoho

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests?party_id=45&model_name=Customer&status=inprogress&sync=true' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/signature-requests/agreement-preview
**Action:** `ClmSignatureController@agreementPreview` — render one agreement against a lead's buyer/consignee and return the PDF inline (no Zoho call).
**Auth:** Bearer token required
**Response:** `application/pdf` (inline)

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/agreement-preview' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output preview.pdf \
  --data '{
  "agreement_id": 8,
  "lead_id": 102
}'
```

**Body fields:**
- `agreement_id` (integer, required) — must exist in `clm_agreement_library`
- `lead_id` (integer, required) — must exist in `leads`
- `header_config_override` (object, optional)
- `footer_config_override` (object, optional)
- `content_override` (string, optional) — body HTML override

### POST /api/clm/signature-requests/agreement-send
**Action:** `ClmSignatureController@agreementSend` — render one or more agreements for a lead and send to Zoho. Buyer + consignee auto-resolved as signers; all selected agreements must share the same applicable party.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/agreement-send' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "agreement_ids": [8, 9],
  "lead_id": 102,
  "expiry_days": 30,
  "is_sequential": false,
  "notes": "Please review and sign these agreements.",
  "document_settings": {
    "8": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 },
    "9": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 }
  }
}'
```

**Body fields:**
- `agreement_id` (integer, optional) — single-send; must exist in `clm_agreement_library`
- `agreement_ids` (array, optional, 1–10) of `integer` — bulk-send; each must exist. (Supply one of `agreement_id` / `agreement_ids`; 422 if neither resolves.)
- `lead_id` (integer, required) — must exist in `leads`
- `expiry_days` (integer, optional, 1–180 — defaults 30)
- `is_sequential` (boolean, optional)
- `notes` (string, optional, max 1000)
- `document_settings` (object, optional) — keyed by `agreement_id` → `{ x, y, page, width, height }`
- `header_config_overrides` (object, optional) — keyed by `agreement_id`
- `footer_config_overrides` (object, optional) — keyed by `agreement_id`
- `content_overrides` (object, optional) — keyed by `agreement_id`

### POST /api/clm/signature-requests/preview
**Action:** `ClmSignatureController@preview` — render a single trade-doc draft against a party and return the PDF inline (no Zoho call).
**Auth:** Bearer token required
**Response:** `application/pdf` (inline)

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/preview' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output preview.pdf \
  --data '{
  "trade_doc_id": 12,
  "party_id": 45,
  "model_name": "Customer"
}'
```

**Body fields:**
- `trade_doc_id` (integer, required) — must exist in `clm_trade_doc_library`
- `party_id` (integer, required)
- `model_name` (string, optional — `Customer` | `Consignee` | `Vendor`; defaults `Customer`)
- `header_config_override` (object, optional)
- `footer_config_override` (object, optional)
- `content_override` (string, optional) — body HTML override

### GET /api/clm/signature-requests/{id}
**Action:** `ClmSignatureController@show` — fetch one request, syncing status from Zoho; pulls signed PDFs + certificate on completion.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/clm/signature-requests/{id}/certificate
**Action:** `ClmSignatureController@viewCertificate` — stream the Zoho completion certificate PDF inline (lazy-pulls from Zoho if missing and status is completed; 404 otherwise).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id
**Response:** `application/pdf` (inline)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/certificate' \
  --header 'Authorization: Bearer {{token}}' \
  --output certificate.pdf
```

### GET /api/clm/signature-requests/{id}/download-file/{index}
**Action:** `ClmSignatureController@downloadFile` — download a signed PDF as an attachment (lazy-pulls from Zoho if missing; 404 if not found).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id; `{index}` = 0-based index into the request's signed-document array
**Response:** `application/pdf` (attachment)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/download-file/0' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed-document.pdf
```

### POST /api/clm/signature-requests/{id}/recall
**Action:** `ClmSignatureController@recall` — recall an in-flight Zoho request (rejected with 400 if already completed); sets status `recalled`.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/31/recall' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Incorrect consignee details — re-sending corrected version."
}'
```

**Body fields:**
- `reason` (string, required, max 500)

### POST /api/clm/signature-requests/{id}/remind
**Action:** `ClmSignatureController@remind` — send a Zoho reminder to pending signers (only when status is `inprogress`; bumps `reminder_count`). No body.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/31/remind' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/clm/signature-requests/{id}/view-file/{index}
**Action:** `ClmSignatureController@viewFile` — stream a signed PDF inline (same lazy-pull as download; 404 if not found).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id; `{index}` = 0-based index into the signed-document array
**Response:** `application/pdf` (inline)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/view-file/0' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed-document.pdf
```

---

## ClmBuyerProfileController

### GET /api/clm/buyer-profile
**Action:** `ClmBuyerProfileController@index` — one read endpoint powering the whole Buyer Profile dashboard: customers (buyers) with KYC/DD/TL/TD + agreement progress, consignees grouped by parent, and the transaction matrix split by with-/without-shipment × buyer=consignee / buyer≠consignee. Returns `{ buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }`.
**Auth:** Bearer token required
**Query params:** none (no input; tenant-scoped via auth)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/buyer-profile' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSupplierProfileController

### GET /api/clm/supplier-profile
**Action:** `ClmSupplierProfileController@index` — Supplier Profile dashboard data: vendors bucketed by supplier type and shipment status (`ws_mat`, `ws_logi`, `wos_svc`, `wos_mat`, `wos_logi`), each with KYC/DD/TL/TD + agreement progress and shipment count.
**Auth:** Bearer token required
**Query params:** none (no input; tenant-scoped via auth)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/supplier-profile' \
  --header 'Authorization: Bearer {{token}}'
```


---

# Part 08 — HR: Employees, Documents, Onboarding, Exit, Previous Employment, Attendance, Leave Plans & Requests

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` **except** the PUBLIC onboarding pair (`GET /api/onboarding/{token}` and `POST /api/onboarding/{token}/complete`), which are 64-char token-gated and rate-limited to 30 req/min/IP.
> `{employee}` path params accept a numeric id, an `emp_code` (e.g. `EMP-001`), or the encrypted-id token used by SPA URLs (`resolveIdParam`).

---

## EmployeeController

### GET /api/employees
**Action:** `EmployeeController@index` — list employees (includes soft-deleted rows so the Disabled tab can render).
**Auth:** Bearer token required (needs `can_view` on `master.employees`)
**Query params:** `search` (matches display_name / emp_code / email / mobile), `status`, `department_id`, `branch_id` (BranchSwitcher narrow)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees?search=patekar&status=Active&department_id=3' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees
**Action:** `EmployeeController@store` — create employee + paired login User; welcome email defers to wizard Step 4.
**Auth:** Bearer token required (needs `can_add` on `master.employees`)

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "first_name": "Atharv",
  "middle_name": "Suresh",
  "last_name": "Patekar",
  "email": "atharv.patekar@example.com",
  "mobile": "+91 9876543210",
  "gender": "Male",
  "date_of_birth": "1996-04-12",
  "department_id": 3,
  "designation_id": 7,
  "designation_name": "Sales Executive",
  "date_of_joining": "2026-06-01",
  "reporting_manager_id": 2,
  "leave_plan": "Standard FY Plan",
  "status": "Active",
  "wizard_step_completed": 1
}'
```

**Body fields:**
- `first_name` (string, max 100) — **required** (only hard-required field; drives display_name).
- `email` (email, max 191) — **required** on store, unique on `users.email` (case-insensitive). Lowercased server-side.
- All other ~50 profile fields are **optional** (wizard saves incrementally). Key ones:
  - Identity (opt): `middle_name`, `last_name` (string max 100), `gender` (in: Male, Female, Other, Prefer not to say), `date_of_birth` (date), `blood_group`, `nationality_country_id`/`work_country_id` (int), `official_email` (email), `mobile`/`alt_mobile` (string max 15, regex `^[+0-9\s\-()]{6,15}$`).
  - Address (opt): `country_id`, `state_id` (int), `city`, `address_line1/2`, `pincode`; permanent mirror `perm_country_id`, `perm_state_id`, `perm_city`, `perm_address_line1/2`, `perm_pincode`.
  - Job (opt): `legal_entity_id`, `department_id`, `designation_id`, `primary_role_id`, `ancillary_role_id` (int), `ancillary_role_ids` (int array), `work_type`, `reporting_manager_id`, `reporting_manager_user_id`, `has_prior_experience` (bool), `probation_policy`, `probation_months` (0-60), `notice_period`, `notice_period_days` (0-365).
  - Work (opt, Step 3): `leave_plan`, `holiday_list`, `attendance_tracking` (bool), `shift`, `weekly_off`, `attendance_number`, `laptop_assigned`, `laptop_asset_id`, `mobile_device`, `other_assets`.
  - Compensation (opt, Step 4 — **required when `wizard_step_completed >= 4` AND `enable_payroll` true**): `annual_salary` (numeric, min 0.01, max 999999999999.99), `salary_frequency` (string max 30), `salary_effective_from` (date). Also `enable_payroll` (bool), `pay_group`, `salary_structure`, `tax_regime`, `bonus_in_annual`/`pf_eligible`/`detailed_breakup` (bool).
  - Payroll/Finance (opt): `salary_payment_mode` (in: bank, cheque, cash), `bank_name`, `bank_account_number` (max 30), `ifsc_code` (regex `^[A-Za-z]{4}0[A-Za-z0-9]{6}$`), `account_holder_name`, `bank_branch`, `bank_account_type`, `uan_number` (regex `^\d{12}$`), `pan_number` (regex `^[A-Za-z]{5}[0-9]{4}[A-Za-z]$`, tenant-unique, upper-cased), `pf_deduction`, `esi_applicable` (Yes/No), `gratuity_nominee_name`, `agreed_ctc_lpa` (numeric).
  - Assets (opt): `assets` (int array), `laptop_master_asset_id`/`mobile_master_asset_id` (int, exists:master_assets,id), `other_master_asset_ids` (int array, exists).
  - Physical setup (opt): `biometric_status` (Not Registered/Registered/Pending/Failed), `desk_workstation_no`, `id_card_status` (Not Printed/Printed/Issued/Lost/Reissued), `status` (Active/Inactive/On Leave/Probation/Notice Period/Resigned/Terminated), `onboarding_stage_completed` (int 0-6), `wizard_step_completed` (1-4).
  - Note: `client_id`/`branch_id` are derived from the authenticated user, never trusted from body (super_admin may pass them).

---

### GET /api/employees/available-assets
**Action:** `EmployeeController@availableAssets` — free assets for the Stage-1 dropdown (excludes assets booked by other employees).
**Auth:** Bearer token required (`can_view`)
**Query params:** `category` (**required** — laptop | mobile | other), `exclude_employee_id` (optional, keeps the edited row's own asset visible)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/available-assets?category=laptop&exclude_employee_id=15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/check-mobile
**Action:** `EmployeeController@checkMobile` — proactive uniqueness probe for the Mobile field.
**Auth:** Bearer token required (`can_view`)
**Query params:** `mobile` (the number to check), `exclude_employee_id` (optional, ignore this row on edit)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/check-mobile?mobile=9876543210&exclude_employee_id=15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/managers
**Action:** `EmployeeController@managers` — eligible Reporting Manager picker (active, fully-onboarded employees + tenant login users).
**Auth:** Bearer token required (`can_view`)
**Query params:** `branch_id` (optional BranchSwitcher narrow)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/managers' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/next-code
**Action:** `EmployeeController@nextCode` — next `EMP-###` code for the resolved tenant.
**Auth:** Bearer token required (`can_view`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/{employee}
**Action:** `EmployeeController@show` — single employee with all nested relations.
**Auth:** Bearer token required (`can_view`)
**Path params:** `{employee}` = id / emp_code / encrypted token

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/EMP-001' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/employees/{employee}
**Action:** `EmployeeController@update` — partial per-step wizard save; cascades name/email/status/phone to the linked User; fires welcome email on Step 4.
**Auth:** Bearer token required (`can_edit`)
**Path params:** `{employee}` = numeric id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/employees/15' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "department_id": 3,
  "designation_id": 7,
  "designation_name": "Senior Sales Executive",
  "reporting_manager_id": 2,
  "wizard_step_completed": 2
}'
```

**Body fields:** same schema as POST but all nullable (including `email`, still uniqueness-checked). Partial step payloads accepted; `wizard_step_completed` / `onboarding_stage_completed` tracked as high-watermarks (never decrease). Disabled (soft-deleted) rows reject updates with 422.

---

### DELETE /api/employees/{employee}
**Action:** `EmployeeController@destroy` — soft-delete employee + disable login + revoke tokens.
**Auth:** Bearer token required (`can_delete`; hierarchical guard blocks acting on rows owned by higher-privileged users)
**Path params:** `{employee}` = numeric id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/employees/15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### DELETE /api/employees/{id}/force
**Action:** `EmployeeController@forceDestroy` — permanently delete a row (only allowed when already soft-deleted).
**Auth:** Bearer token required (`can_delete` + hierarchical guard)
**Path params:** `{id}` = numeric id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/employees/15/force' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/employees/{id}/restore
**Action:** `EmployeeController@restore` — re-enable a soft-deleted employee (status → Active, re-enable login).
**Auth:** Bearer token required (`can_edit`)
**Path params:** `{id}` = numeric id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/employees/15/restore' \
  --header 'Authorization: Bearer {{token}}'
```

---

## EmployeeDocumentController

### GET /api/employees/{employee}/documents
**Action:** `EmployeeDocumentController@index` — list an employee's uploaded documents.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/documents' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees/{employee}/documents
**Action:** `EmployeeDocumentController@store` — upload (or replace) a document for a `document_key`.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/15/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'document_key=aadhaar' \
  --form 'file=@/path/to/aadhaar.pdf'
```

**Body fields (multipart):**
- `document_key` (string, max 60) — **required**.
- `file` (file, max 2 MB) — **required**. Allowed: PDF / JPG / JPEG / PNG / WEBP (accepted if MIME OR extension matches). Re-upload to the same key replaces the prior file and resets verification.

---

### PATCH /api/documents/{document}/verify
**Action:** `EmployeeDocumentController@verify` — mark a document verified.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/documents/42/verify' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/documents/{document}/reject
**Action:** `EmployeeDocumentController@reject` — mark a document rejected with a reason.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/documents/42/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "rejection_reason": "Document is blurry and unreadable. Please re-upload a clear scan."
}'
```

**Body fields:** `rejection_reason` (string, max 500) — **required**.

---

### DELETE /api/documents/{document}
**Action:** `EmployeeDocumentController@destroy` — soft-delete a document and remove its file from disk.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/documents/42' \
  --header 'Authorization: Bearer {{token}}'
```

---

## OnboardingController

### POST /api/employees/onboarding-invite
**Action:** `OnboardingController@createInvite` — mint a 64-char onboarding token + email the candidate.
**Auth:** Bearer token required (super_admin / client_admin / branch_user only)

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/onboarding-invite' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "invitee_name": "Sneha Kulkarni",
  "invitee_email": "sneha.kulkarni@example.com",
  "department_id": 3,
  "expected_join_date": "2026-07-01",
  "expiry_days": 15,
  "app_origin": "http://127.0.0.1:8000"
}'
```

**Body fields:**
- `invitee_name` (string, max 255) — **required**.
- `invitee_email` (email, max 191) — **required**; must not already have a user account.
- `department_id` (int, exists:master_departments,id) — optional.
- `expected_join_date` (date) — optional.
- `expiry_days` (int, in: 3, 7, 15, 30; default 15) — optional.
- `app_origin` (url, max 255) — optional; SPA origin for the invite link.

---

### GET /api/onboarding/{token}
**Action:** `OnboardingController@show` — **Public (token-gated)** — preview the invite + tenant-scoped master dropdowns.
**Auth:** Public (no login; 64-char token, rate-limited 30/min/IP)
**Path params:** `{token}` = 64-char onboarding token

```bash
curl -X GET 'http://127.0.0.1:8000/api/onboarding/AbC123...64charToken...xYz'
```

> Returns 404 (invalid), 410 (completed / cancelled / expired) as applicable.

---

### POST /api/onboarding/{token}/complete
**Action:** `OnboardingController@complete` — **Public (token-gated)** — candidate submits the full form; creates Employee + User + sends welcome credentials.
**Auth:** Public (no login; 64-char token, rate-limited 30/min/IP)
**Path params:** `{token}` = 64-char onboarding token

```bash
curl -X POST 'http://127.0.0.1:8000/api/onboarding/AbC123...64charToken...xYz/complete' \
  --header 'Content-Type: application/json' \
  --data '{
  "first_name": "Sneha",
  "middle_name": "Rajesh",
  "last_name": "Kulkarni",
  "gender": "Female",
  "date_of_birth": "1998-02-20",
  "mobile": "9876501234",
  "country_id": 1,
  "state_id": 14,
  "city": "Pune",
  "address_line1": "Flat 7, Sunrise Residency",
  "pincode": "411014",
  "designation_id": 7,
  "date_of_joining": "2026-07-01"
}'
```

**Body fields:**
- `first_name` (string, max 100, name regex `^[A-Za-z][A-Za-z\s'\-.]*$`) — **required**.
- Names (opt): `middle_name`, `last_name` (same regex).
- `gender` (in: Male, Female, Other) — optional.
- `date_of_birth` (date, must be at least 18 years ago) — optional.
- `nationality_country_id`, `work_country_id` (int) — optional.
- `mobile`, `alt_mobile` (string max 30, regex `^[+\d\s\-()]{7,20}$`) — optional.
- Current address (opt): `country_id`, `state_id` (int), `city`, `address_line1/2`, `pincode` (regex `^\d{4,10}$`).
- Permanent address (opt): `perm_country_id`, `perm_state_id`, `perm_city`, `perm_address_line1/2`, `perm_pincode` (4-10 digits).
- Job (opt, defaults from invite when omitted): `department_id`, `designation_id`, `primary_role_id`, `ancillary_role_id`, `legal_entity_id` (int), `location` (string max 191), `date_of_joining` (date).
- Note: `email` comes from the invite, not the body.

---

## ExitController

### GET /api/employees/{employee}/exit
**Action:** `ExitController@show` — return the (possibly null) exit row, pre-filling reporting manager from the employee record.
**Auth:** Bearer token required (`can_edit` on `master.employees`, same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/exit' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/employees/{employee}/exit
**Action:** `ExitController@upsert` — create or update the exit record (Stage 1 Exit Initiation).
**Auth:** Bearer token required (`can_edit` on `master.employees`, same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/employees/15/exit' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "exit_type": "Resignation",
  "initiated_by": "Employee",
  "reason_for_exit": "Better opportunity",
  "notice_date": "2026-06-03",
  "last_working_day": "2026-07-03",
  "reporting_manager_id": 2,
  "business_impact": "Medium",
  "replacement_required": "Yes — Within 30 days",
  "comments": "Smooth handover planned."
}'
```

**Body fields (all optional):**
- `exit_type` (in: Resignation, Termination, Retirement, End of Contract, Absconding, Other).
- `initiated_by` (in: Employee, HR, Manager).
- `reason_for_exit` (string, max 60), `other_reason` (string, max 255).
- `notice_date` (date), `last_working_day` (date, after_or_equal:notice_date).
- `reporting_manager_id` (int, exists:employees,id).
- `comments` (string, max 2000).
- `business_impact` (in: Low, Medium, High, Critical).
- `replacement_required` (in: `Yes — Immediate`, `Yes — Within 30 days`, `Yes — Within 90 days`, `No`).

---

## PreviousEmploymentController

### GET /api/employees/{employee}/previous-employments
**Action:** `PreviousEmploymentController@index` — list an employee's prior-employment records (Stage 2).
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/previous-employments' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees/{employee}/previous-employments
**Action:** `PreviousEmploymentController@store` — add a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/15/previous-employments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Infotech Solutions Pvt Ltd",
  "job_title": "Junior Developer",
  "start_date": "2022-01-10",
  "end_date": "2024-05-31",
  "hr_email_1": "hr@infotech.example.com",
  "hr_email_2": "payroll@infotech.example.com",
  "contact_number": "+91 2041234567"
}'
```

**Body fields:**
- `company_name` (string, max 255) — **required**.
- `job_title` (string, max 255) — optional.
- `start_date` (date) — optional.
- `end_date` (date, after_or_equal:start_date) — optional.
- `hr_email_1` (email, max 191) — optional.
- `hr_email_2` (email, max 191, different:hr_email_1) — optional.
- `contact_number` (string, max 30) — optional.

---

### PATCH /api/previous-employments/{prev}
**Action:** `PreviousEmploymentController@update` — edit a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{prev}` = numeric record id (route-model bound)

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/previous-employments/8' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Infotech Solutions Pvt Ltd",
  "job_title": "Software Developer",
  "end_date": "2024-06-30"
}'
```

**Body fields:** same as POST (`company_name` still required).

---

### DELETE /api/previous-employments/{prev}
**Action:** `PreviousEmploymentController@destroy` — soft-delete a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{prev}` = numeric record id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/previous-employments/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

## AttendanceController

### GET /api/attendance
**Action:** `AttendanceController@index` — HR/admin paginated attendance list (employee user_type is blocked → use /my).
**Auth:** Bearer token required (non-employee)
**Query params:** `branch_id`, `date`, `from`, `to`, `employee_id`, `status`, `per_page` (default 50)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance?date=2026-06-03&status=Present&per_page=50' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/daily-view
**Action:** `AttendanceController@dailyView` — per-employee daily card payload (status, punches, MTD KPIs, 90-day log) for the HR Attendance page.
**Auth:** Bearer token required (non-employee)
**Query params:** `date` (YYYY-MM-DD, default today IST), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/daily-view?date=2026-06-03&branch_id=4' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/employee/{employeeId}/summary
**Action:** `AttendanceController@employeeSummary` — month summary (today card + stats + history) for a profile page.
**Auth:** Bearer token required (self, or admin in same tenant, or super_admin)
**Path params:** `{employeeId}` = numeric id **or** emp_code (e.g. EMP-001)
**Query params:** `month` (YYYY-MM, default current month IST)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/employee/EMP-001/summary?month=2026-06' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/attendance/face/clock-in
**Action:** `AttendanceController@faceClockIn` — verify face (threshold 0.55) and write an 'in' punch (strict in→out alternation; mismatch → 422).
**Auth:** Bearer token required (caller must have a linked employee record + enrolled face)

```bash
curl -X POST 'http://127.0.0.1:8000/api/attendance/face/clock-in' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "descriptor": [0.12, -0.04, 0.08, 0.15, -0.21, 0.03, "... 128 floats total ..."],
  "label": "Check In",
  "lat": 18.5204,
  "lng": 73.8567
}'
```

**Body fields:**
- `descriptor` (array, **exactly 128** numeric values) — **required**; the face-api.js 128-d descriptor.
- `descriptor.*` (numeric) — **required**.
- `label` (string, max 50) — optional (defaults to Check In / Step In by direction). Known labels: Check In, Step Out, Step In, Lunch Out, Lunch In, Meeting, Check Out (free text accepted).
- `lat` (numeric, -90..90) — optional.
- `lng` (numeric, -180..180) — optional.

---

### POST /api/attendance/face/clock-out
**Action:** `AttendanceController@faceClockOut` — verify face and write an 'out' punch (same alternation/threshold rules as clock-in).
**Auth:** Bearer token required (linked employee + enrolled face)

```bash
curl -X POST 'http://127.0.0.1:8000/api/attendance/face/clock-out' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "descriptor": [0.11, -0.05, 0.09, 0.14, -0.20, 0.04, "... 128 floats total ..."],
  "label": "Check Out",
  "lat": 18.5204,
  "lng": 73.8567
}'
```

**Body fields:** same as `face/clock-in` — `descriptor` (128 floats, required), `label` (opt), `lat`/`lng` (opt).

---

### GET /api/attendance/my
**Action:** `AttendanceController@my` — the signed-in employee's own paginated attendance history with punches.
**Auth:** Bearer token required (linked employee)
**Query params:** `from`, `to` (YYYY-MM-DD), `per_page` (default 30)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/my?from=2026-06-01&to=2026-06-30&per_page=30' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/today
**Action:** `AttendanceController@today` — today's attendance row + punch timeline + next_direction for the signed-in employee.
**Auth:** Bearer token required (linked employee)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/today' \
  --header 'Authorization: Bearer {{token}}'
```

---

## LeavePlanController

### GET /api/employees/{employeeId}/leave-balances
**Action:** `LeavePlanController@employeeBalances` — per-type balance/ledger for an employee's assigned leave plan.
**Auth:** Bearer token required
**Path params:** `{employeeId}` = numeric id

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/leave-balances' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-balances
**Action:** `LeavePlanController@leaveBalances` — aggregated balances matrix (dynamic leave-type columns + per-employee rows) for the Leave Balances tab.
**Auth:** Bearer token required
**Query params:** `branch_id`, `department_id`, `location`, `search`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-balances?department_id=3&search=patekar' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-plans
**Action:** `LeavePlanController@index` — list leave plans (scoped) with employee/type counts.
**Auth:** Bearer token required
**Query params:** `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-plans?branch_id=4' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans
**Action:** `LeavePlanController@store` — create a leave plan.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan",
  "description": "Default annual plan for full-time staff.",
  "from_month_type": "Calendar",
  "from_month": "April",
  "calendar_year": "2026",
  "policy_explanation_mode": "System",
  "status": "Active",
  "is_default": true
}'
```

**Body fields:**
- `plan_name` (string, max 255) — **required**.
- `from_month_type` (in: Calendar, If Joining) — **required**.
- `description` (string) — optional.
- `from_month` (in: January…December) — optional.
- `calendar_year` (string, max 20) — optional.
- `policy_explanation_mode` (in: System, Custom; default System) — optional.
- `policy_doc_path` (string, max 1024) — optional.
- `status` (in: Active, Inactive; default Active) — optional.
- `is_default` (bool) — optional (setting true clears the prior default for the branch).

---

### GET /api/leave-plans/{id}
**Action:** `LeavePlanController@show` — single plan with assigned types + employees.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/leave-plans/{id}
**Action:** `LeavePlanController@update` — edit a leave plan.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan (Revised)",
  "from_month_type": "Calendar",
  "status": "Active"
}'
```

**Body fields:** all `sometimes`/optional — `plan_name` (required when present), `from_month_type` (required when present, in: Calendar/If Joining), plus `description`, `from_month`, `calendar_year`, `policy_explanation_mode`, `policy_doc_path`, `status`, `is_default` (same rules as store).

---

### DELETE /api/leave-plans/{id}
**Action:** `LeavePlanController@destroy` — delete a plan (blocked with 422 if it is the default).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/clone
**Action:** `LeavePlanController@clone` — duplicate a plan with its types/config (not employees, not default flag).
**Auth:** Bearer token required
**Path params:** `{id}` = source plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/clone' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan (Copy)"
}'
```

**Body fields:** `plan_name` (string) — optional (defaults to `"<source> (Copy)"`).

---

### POST /api/leave-plans/{id}/employees
**Action:** `LeavePlanController@assignEmployees` — assign employees to a plan (each employee belongs to exactly one plan; upsert moves them).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/employees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "employee_ids": [15, 16, 17]
}'
```

**Body fields:** `employee_ids` (array, **required**), `employee_ids.*` (int, exists:employees,id, must be in the plan's tenant scope).

---

### DELETE /api/leave-plans/{id}/employees/{employeeId}
**Action:** `LeavePlanController@removeEmployee` — unassign an employee from a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{employeeId}` = employee id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5/employees/15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/make-default
**Action:** `LeavePlanController@makeDefault` — set a plan as the branch default (clears the prior default).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/make-default' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/types
**Action:** `LeavePlanController@assignTypes` — attach/replace the set of leave types on a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "leave_type_ids": [1, 2, 3],
  "mode": "replace"
}'
```

**Body fields:** `leave_type_ids` (array, **required**), `leave_type_ids.*` (int, exists:master_leave_types,id), `mode` (in: replace, append; default replace).

---

### DELETE /api/leave-plans/{id}/types/{typeId}
**Action:** `LeavePlanController@removeType` — detach a leave type from a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{typeId}` = leave type id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5/types/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/leave-plans/{id}/types/{typeId}/config
**Action:** `LeavePlanController@saveTypeConfig` — persist the 6-tab Setup popup config for a (plan, type) pair.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{typeId}` = leave type id (must already be assigned, else 404)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/leave-plans/5/types/2/config' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "config": {
    "accrual": { "yearlyQuota": 12, "unlimited": false },
    "approval": { "chain": [{ "approver_kind": "reporting_manager" }] }
  },
  "quota_summary": "12 days / year",
  "eoy_summary": "Lapse unused"
}'
```

**Body fields:** `config` (array/object, **required** — the full LeaveTypeConfig blob), `quota_summary` (string, max 255) — optional, `eoy_summary` (string, max 255) — optional.

---

## LeaveRequestController

### GET /api/leave-requests
**Action:** `LeaveRequestController@index` — list an employee's own leave requests (or a specified employee's, tenant-guarded).
**Auth:** Bearer token required
**Query params:** `employee_id` (admin viewing another), `status` (Pending | Approved | Rejected)

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests?employee_id=15&status=Pending' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests
**Action:** `LeaveRequestController@store` — submit a leave application (computes days, overlap + past-date + plan/type guards, snapshots the approval chain).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "employee_id": 15,
  "leave_type_id": 2,
  "from_date": "2026-06-10",
  "to_date": "2026-06-12",
  "day_type": "full",
  "reason": "Family function",
  "handover_required": true,
  "cover_person_id": 16,
  "handover_notes": "Sai will cover client follow-ups.",
  "avail_on_call": true,
  "emergency_number": "+91 9876543210",
  "notify": { "employee_ids": [17, 18] }
}'
```

**Body fields:**
- `leave_type_id` (int, exists:master_leave_types,id) — **required** (must be part of the employee's assigned plan).
- `from_date` (date, today or later) — **required**.
- `to_date` (date, after_or_equal:from_date) — **required**.
- `employee_id` (int, exists:employees,id) — optional (admin filing on behalf; else self).
- `day_type` (in: full, first_half, second_half) — optional (half-day only valid on a single day → 0.5 day).
- `reason` (string) — optional.
- `attachment_path` (string, max 1024) — optional.
- `notify` (array, e.g. `{ "employee_ids": [..] }`) — optional (same-tenant only).
- `handover_required` (bool), `cover_person_id` (int, exists, same-tenant), `handover_notes` (string), `critical_tasks` (string) — optional.
- `avail_on_call` (bool), `emergency_number` (string, max 50), `avail_note` (string) — optional.

---

### GET /api/leave-requests/approvals
**Action:** `LeaveRequestController@approvals` — pending requests the signed-in user can approve (admins see the whole tenant; managers see their chain levels).
**Auth:** Bearer token required
**Query params:** `status` (default Pending; or `All`), `branch_id`, `search`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/approvals?status=Pending&search=patekar' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-requests/colleagues
**Action:** `LeaveRequestController@colleagues` — lightweight same-tenant employee search for the Notify / Cover-person picker.
**Auth:** Bearer token required (any authenticated user)
**Query params:** `search`, `limit` (1-20, default 10)

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/colleagues?search=sai&limit=10' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-requests/{id}
**Action:** `LeaveRequestController@show` — single request with every relation the approval modal needs (tenant-guarded against IDOR).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/42' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests/{id}/approve
**Action:** `LeaveRequestController@approve` — approve the current chain level (advances to next level or finalizes).
**Auth:** Bearer token required (approver for the level, or admin override)
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Approved. Enjoy your time off."
}'
```

**Body fields:** `comment` (string) — optional.

---

### GET /api/leave-requests/{id}/approvers
**Action:** `LeaveRequestController@approvers` — the snapshotted approval chain with per-level status + resolved approver name/email.
**Auth:** Bearer token required (tenant-guarded)
**Path params:** `{id}` = numeric request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/42/approvers' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests/{id}/cancel
**Action:** `LeaveRequestController@cancel` — cancel a Pending request (owner or HR only).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/cancel' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (only Pending requests can be cancelled).

---

### POST /api/leave-requests/{id}/reject
**Action:** `LeaveRequestController@reject` — reject the request at the current level (terminates immediately).
**Auth:** Bearer token required (approver for the level, or admin override)
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Insufficient leave balance for this period."
}'
```

**Body fields:** `comment` (string) — optional.


---

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


---

# Part 10 — HR Document Signatures, Advances, Expenses, Announcements, Billing (Payments/Plans/Subscription/Razorpay)

Base URL: `http://127.0.0.1:8000`

All endpoints require `Authorization: Bearer {{token}}` **except** `POST /api/razorpay/webhook`, which is a Public, signature-verified server-to-server callback.

---

## HrDocumentSignatureController

### GET /api/employees/{slug}/signed-documents
**Action:** `HrDocumentSignatureController@forEmployee` — list signature runs targeting one employee.
**Auth:** Bearer token required
**Path params:** `{slug}` = Employee numeric id OR `emp_code` (e.g. `EMP-001`)
**Query params:** `status` (default `Completed`; pass `all` to include in-flight runs)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/EMP-001/signed-documents?status=all' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-signatures
**Action:** `HrDocumentSignatureController@index` — list signature runs (tenant-scoped).
**Auth:** Bearer token required
**Query params:** `employee_id` (int), `status` (Pending|In Progress|Completed|Rejected|Cancelled), `template_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures?status=In%20Progress&employee_id=5' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-signatures
**Action:** `HrDocumentSignatureController@store` — send a template into its signing workflow against one employee. Resolves signers to real users and freezes the body HTML at send time.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "template_id": 3,
  "employee_id": 5
}'
```

**Body fields:**
- `template_id` (int, required) — must exist in `hr_document_templates`.
- `employee_id` (int, required) — must exist in `employees`.

### GET /api/hr-document-signatures/inbox
**Action:** `HrDocumentSignatureController@inbox` — signature runs where the current user is the next pending signer.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/inbox' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-signatures/{id}
**Action:** `HrDocumentSignatureController@show` — one run with audit log + resolved HTML.
**Auth:** Bearer token required
**Path params:** `{id}` = `hr_document_signatures.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-signatures/{id}/action
**Action:** `HrDocumentSignatureController@action` — current signer signs / approves / acknowledges; advances the workflow. For `Sign` steps a typed `signed_name` is mandatory and an optional drawn signature image is baked into the doc.
**Auth:** Bearer token required (must be the current signer)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/action' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "action": "Sign",
  "signed_name": "Rajesh Meshram",
  "signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "note": "Reviewed and signed"
}'
```

**Body fields:**
- `action` (string, required) — one of `Sign`, `Approve`, `Acknowledge`.
- `signed_name` (string, optional, max 120) — required at runtime when the current signer's step is a `Sign` step (else 422).
- `signature_image` (string, optional, max 5,600,000 chars) — base64 PNG/JPG/GIF/WEBP/SVG data URL from the signature pad; ≤ 4 MB decoded or it's silently dropped to the typed cursive fallback.
- `note` (string, optional, max 500) — stored on non-Sign (Approve/Acknowledge) steps.

### POST /api/hr-document-signatures/{id}/cancel
**Action:** `HrDocumentSignatureController@cancel` — sender (or admin) cancels the entire run.
**Auth:** Bearer token required (creator, `super_admin`, or `client_admin`)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/cancel' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### GET /api/hr-document-signatures/{id}/download
**Action:** `HrDocumentSignatureController@downloadSigned` — stream the run's current content as a DOCX (final signed copy when completed).
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed.docx
```

### GET /api/hr-document-signatures/{id}/download-pdf
**Action:** `HrDocumentSignatureController@downloadSignedPdf` — DomPDF render of the signed document (A4), images inlined as data URIs.
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12/download-pdf' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed.pdf
```

### POST /api/hr-document-signatures/{id}/email-employee
**Action:** `HrDocumentSignatureController@emailToEmployee` — email the signed DOCX to the subject employee. Only valid for `Completed` runs.
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/email-employee' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (recipient resolved from the employee's email on file; 422 if missing or run not Completed).

### POST /api/hr-document-signatures/{id}/reject
**Action:** `HrDocumentSignatureController@reject` — current signer rejects the run; sets status `Rejected`.
**Auth:** Bearer token required (must be the current signer)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Wrong designation listed on the offer letter."
}'
```

**Body fields:**
- `reason` (string, required, max 500).

---

## AdvanceRequestController

Two-stage approval (manager → HR/Finance). Advance numbers are `ADV-0001` per (client, branch). Attachments uploaded as multipart `files[]`.

### GET /api/advance-requests
**Action:** `AdvanceRequestController@index` — list advance requests, role-scoped.
**Auth:** Bearer token required
**Query params:** `scope` (`mine`|`team`|`all`, default `mine`; `all` needs HR `can_view`), `status` (`pending`|`approved`|`rejected`), `employee_id` (int or EMP code), `employee_code` (string), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests?scope=team&status=pending' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/advance-requests
**Action:** `AdvanceRequestController@store` — file an advance request (under your own employee record unless super_admin). Multipart for attachments.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'advance_type=Travel Advance' \
  --form 'amount=25000' \
  --form 'requested_date=2026-06-03' \
  --form 'recovery_start=2026-07-01' \
  --form 'recovery_mode=emi' \
  --form 'recovery_months=5' \
  --form 'monthly_emi=5000' \
  --form 'reason=Advance for upcoming client visit to Dubai.' \
  --form 'files[]=@C:\temp\itinerary.pdf'
```

**Body fields:**
- `advance_type` (string, required) — one of `Travel Advance`, `Salary Advance`, `Medical Advance`, `Other`.
- `advance_type_other` (string, optional, max 255) — required when `advance_type=Other`.
- `amount` (numeric, required, min 0, max 9999999999999.99).
- `requested_date` (date, required).
- `recovery_start` (date, required, ≥ `requested_date`).
- `recovery_mode` (string, required) — one of `emi`, `lumpsum`, `bimonthly`.
- `recovery_months` (int, optional, 1–120) — required when `recovery_mode=emi`.
- `monthly_emi` (numeric, optional, min 0, max 9999999999999.99) — meaningful only for `emi`.
- `reason` (string, required, max 2000).
- `employee_id` / `employee_code` (optional) — target another employee (super_admin only).
- `files[]` (file, optional, repeatable) — attachments stored on the public disk.

### GET /api/advance-requests/{id}
**Action:** `AdvanceRequestController@show` — one advance request (tenant-checked).
**Auth:** Bearer token required
**Path params:** `{id}` = `advance_requests.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests/8' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/advance-requests/{id}/attachments/{index}
**Action:** `AdvanceRequestController@downloadAttachment` — stream one attachment by array index. Supports `?token=` query-token auth for direct browser opens.
**Auth:** Bearer token required (header or `?token=`)
**Path params:** `{id}` = advance request id; `{index}` = zero-based attachment index

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests/8/attachments/0?token={{token}}' \
  --output attachment.pdf
```

### POST /api/advance-requests/{id}/hr-approve
**Action:** `AdvanceRequestController@hrApprove` — HR/Finance approves (final). Requires manager already approved and HR `can_approve` permission.
**Auth:** Bearer token required
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/hr-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Approved by Finance. Recovery starts next cycle."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/hr-reject
**Action:** `AdvanceRequestController@hrReject` — HR/Finance rejects (closes the request).
**Auth:** Bearer token required
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/hr-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Budget unavailable this quarter."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/manager-approve
**Action:** `AdvanceRequestController@managerApprove` — assigned reporting manager approves stage 1.
**Auth:** Bearer token required (must be the assigned manager or super_admin)
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/manager-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Justified — approving."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/manager-reject
**Action:** `AdvanceRequestController@managerReject` — manager rejects (closes the request).
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/manager-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Not needed for this trip."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

---

## ExpenseClaimController

Two-stage approval (manager → HR/Finance). Claim numbers are `EXP-0001` per (client, branch). Attachments uploaded as multipart `files[]`.

### GET /api/expense-claims
**Action:** `ExpenseClaimController@index` — list expense claims, role-scoped.
**Auth:** Bearer token required
**Query params:** `scope` (`mine`|`team`|`all`, default `mine`; `all` needs HR `can_view`), `status` (`pending`|`approved`|`rejected`), `employee_id` (int or EMP code), `employee_code` (string), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims?scope=mine&status=approved' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/expense-claims
**Action:** `ExpenseClaimController@store` — file an expense claim (your own employee record unless super_admin). Multipart for receipts.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'title=Client dinner in Mumbai' \
  --form 'amount=4500' \
  --form 'expense_date=2026-06-01' \
  --form 'category_id=2' \
  --form 'currency=INR' \
  --form 'project=Q2 Rice Export' \
  --form 'payment_method=Personal Card' \
  --form 'vendor=Trident Hotel' \
  --form 'purpose=Business development dinner with buyer.' \
  --form 'files[]=@C:\temp\receipt.jpg'
```

**Body fields:**
- `title` (string, required, max 255).
- `amount` (numeric, required, min 0, max 9999999999999.99).
- `expense_date` (date, required).
- `category_id` (int, optional) — `ExpenseCategories` id (e.g. Travel, Medical); name auto-resolved.
- `currency` (string, optional, max 8; default `INR`).
- `project` (string, optional, max 64).
- `payment_method` (string, optional, max 64).
- `vendor` (string, optional, max 255).
- `purpose` (string, optional).
- `employee_id` / `employee_code` (optional) — target another employee (super_admin only).
- `files[]` (file, optional, repeatable) — receipts stored on the public disk.

### GET /api/expense-claims/{id}
**Action:** `ExpenseClaimController@show` — one claim (tenant-checked).
**Auth:** Bearer token required
**Path params:** `{id}` = `expense_claims.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims/14' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/expense-claims/{id}/attachments/{index}
**Action:** `ExpenseClaimController@downloadAttachment` — stream one receipt by array index. Supports `?token=` query-token auth.
**Auth:** Bearer token required (header or `?token=`)
**Path params:** `{id}` = claim id; `{index}` = zero-based attachment index

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims/14/attachments/0?token={{token}}' \
  --output receipt.jpg
```

### POST /api/expense-claims/{id}/hr-approve
**Action:** `ExpenseClaimController@hrApprove` — HR/Finance approves (final). Requires manager approved + HR `can_approve`.
**Auth:** Bearer token required
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/hr-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Reimbursed in this month payroll."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/hr-reject
**Action:** `ExpenseClaimController@hrReject` — HR/Finance rejects (closes claim).
**Auth:** Bearer token required
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/hr-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Missing valid GST receipt."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/manager-approve
**Action:** `ExpenseClaimController@managerApprove` — assigned manager approves stage 1.
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/manager-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Legitimate business expense."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/manager-reject
**Action:** `ExpenseClaimController@managerReject` — manager rejects (closes claim).
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/manager-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Personal expense, not claimable."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

---

## AnnouncementController

Broadcast Centre. Codes are `ANN-0001` per (client, branch). Gated by `hr.broadcast` module permissions. Attachment uploaded as multipart `attachment`. Lifecycle status (Draft/Scheduled/Active/Expired/Archived) is server-resolved.

### GET /api/announcements
**Action:** `AnnouncementController@index` — list announcements (refreshes lifecycle statuses on read). Needs `can_view`.
**Auth:** Bearer token required
**Query params:** `search` (title/code/description), `type` (`General`|`Policy`|`Urgent`), `status` (Draft|Scheduled|Active|Expired|Archived), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements?status=Active&type=Policy' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/announcements
**Action:** `AnnouncementController@store` — create an announcement. Needs `can_add`. If it resolves to `Active`, the email blast fires immediately. Multipart for the attachment.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/announcements' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'title=Office closed for Eid' \
  --form 'description=The office will remain closed on June 17.' \
  --form 'type=General' \
  --form 'priority=High' \
  --form 'audience_type=all_employees' \
  --form 'publish_type=immediate' \
  --form 'expires_at=2026-06-18' \
  --form 'ack_required=1' \
  --form 'ack_mode=Mandatory' \
  --form 'ack_reminder_frequency=Daily' \
  --form 'ack_escalation_days=2' \
  --form 'notify_email=1' \
  --form 'notify_in_app=1' \
  --form 'status=Active' \
  --form 'attachment=@C:\temp\holiday-notice.pdf'
```

**Body fields:** (most are `required` only when publishing — i.e. not `status=Draft` and not an update)
- `title` (string, max 191) — required unless Draft/update.
- `description` (string) — required unless Draft/update.
- `type` (optional) — `General`|`Policy`|`Urgent`.
- `priority` (optional) — `Normal`|`High`|`Critical`.
- `attachment` (file, optional) — mimes `png,jpg,jpeg,pdf`, max 20 MB.
- `audience_type` (optional) — `all_employees`|`roles`|`designations`.
- `audience_role_ids` (int[], optional); `audience_designation_ids` (int[], optional); `exclude_employee_ids` (int[], optional).
- `publish_type` (optional) — `immediate`|`scheduled`.
- `publish_at` (date, optional); `expires_at` (date, optional, ≥ `publish_at`).
- `ack_required` (bool, optional); `ack_mode` (`Mandatory`|`Optional`); `ack_reminder_frequency` (`Daily`|`Weekly`|`Never`); `ack_escalation_days` (int 0–365).
- `notify_email` / `notify_in_app` / `notify_sms` / `notify_whatsapp` (bool, optional).
- `status` (optional) — `Draft`|`Scheduled`|`Active`|`Expired`|`Archived` (server may override based on dates).

### GET /api/announcements/next-code
**Action:** `AnnouncementController@nextCode` — peek the next `ANN-####` code for the caller's tenant.
**Auth:** Bearer token required (needs `can_view`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/announcements/stats
**Action:** `AnnouncementController@stats` — KPI counts (total/active/scheduled/draft/expired/archived).
**Auth:** Bearer token required (needs `can_view`)
**Query params:** `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/announcements/{announcement}
**Action:** `AnnouncementController@show` — one announcement (tenant-scoped). Needs `can_view`.
**Auth:** Bearer token required
**Path params:** `{announcement}` = `announcements.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/announcements/{announcement}
**Action:** `AnnouncementController@update` — update an announcement. Needs `can_edit`. Publishing (Draft/Scheduled → Active) fires the email once; editing an already-Active row does not re-blast.
**Auth:** Bearer token required
**Path params:** `{announcement}` = announcement id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Office closed for Eid (updated)",
  "description": "Closure extended to June 18.",
  "type": "General",
  "priority": "High",
  "expires_at": "2026-06-19",
  "status": "Active"
}'
```

**Body fields:** same rule set as `store`, but all fields are `nullable` on update (file attachment must use multipart). See store body fields for types/enums.

### DELETE /api/announcements/{announcement}
**Action:** `AnnouncementController@destroy` — soft-delete an announcement. Needs `can_delete`; blocked if created by a higher-privileged user.
**Auth:** Bearer token required
**Path params:** `{announcement}` = announcement id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## PaymentController

Manual payment records + invoice PDFs. `index`/`stats`/`show`/invoice scoped to super_admin (any) or client_admin (own client). Create/update/delete/reminder are super_admin only.

### GET /api/payments
**Action:** `PaymentController@index` — paginated payment list.
**Auth:** Bearer token required (super_admin = all; client_admin = own client; others get empty)
**Query params:** `search` (txn_id/order_id/invoice_number/org_name), `status` (pending|success|failed|refunded), `client_id` (int), `from` (date), `to` (date), `per_page` (default 15)

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments?status=success&per_page=20' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/payments
**Action:** `PaymentController@store` — record a manual payment (auto-generates `INV-...`). Sends invoice email when `status=success`.
**Auth:** Bearer token required (super_admin only)

```bash
curl -X POST 'http://127.0.0.1:8000/api/payments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "client_id": 12,
  "plan_id": 2,
  "txn_id": "pay_Nabc123XyZ",
  "order_id": "order_Nabc123XyZ",
  "amount": 10000,
  "gst": 1800,
  "discount": 0,
  "total": 11800,
  "currency": "INR",
  "method": "net_banking",
  "gateway": "manual",
  "status": "success",
  "billing_cycle": "yearly",
  "valid_from": "2026-06-03",
  "valid_until": "2027-06-03",
  "auto_renew": false,
  "notes": "Offline NEFT received."
}'
```

**Body fields:**
- `client_id` (int, required) — exists in `clients`.
- `plan_id` (int, optional) — exists in `plans`.
- `txn_id` (string, optional, max 100); `order_id` (string, optional, max 100).
- `amount` (numeric, required, min 0); `gst` (numeric, optional); `discount` (numeric, optional).
- `total` (numeric, required, min 0).
- `currency` (string, optional, max 10).
- `method` (string, required) — `upi`|`credit_card`|`debit_card`|`net_banking`|`wallet`|`cash`|`cheque`.
- `gateway` (string, optional) — `razorpay`|`stripe`|`paytm`|`manual`.
- `status` (string, required) — `pending`|`success`|`failed`|`refunded`.
- `billing_cycle` (string, optional) — `monthly`|`quarterly`|`yearly`.
- `valid_from` / `valid_until` (date, optional).
- `auto_renew` (bool, optional); `notes` (string, optional).

### GET /api/payments/stats
**Action:** `PaymentController@stats` — revenue + count breakdown by status.
**Auth:** Bearer token required (super_admin = all; client_admin = own client)

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/payments/{payment}
**Action:** `PaymentController@show` — one payment with client/plan/processedBy.
**Auth:** Bearer token required (super_admin or owning client_admin)
**Path params:** `{payment}` = `payments.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/payments/{payment}
**Action:** `PaymentController@update` — update a payment record.
**Auth:** Bearer token required
**Path params:** `{payment}` = payment id

> Note: the controller exposes an `update` route but the method is not implemented in this controller body; treat as a standard resource update of the same fields as `store`.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "refunded",
  "notes": "Refunded on client request."
}'
```

**Body fields:** same shape as `store` (client_id, plan_id, amounts, method, status, etc.).

### DELETE /api/payments/{payment}
**Action:** `PaymentController@destroy` — delete a payment record.
**Auth:** Bearer token required (super_admin only)
**Path params:** `{payment}` = payment id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/payments/{payment}/invoice/download
**Action:** `PaymentController@downloadInvoice` — download the invoice PDF as an attachment. Supports `?token=` query-token auth.
**Auth:** Bearer token required (header or `?token=`; super_admin or owning client_admin)
**Path params:** `{payment}` = payment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30/invoice/download?token={{token}}' \
  --output invoice.pdf
```

### GET /api/payments/{payment}/invoice/view
**Action:** `PaymentController@viewInvoice` — stream the invoice PDF inline in the browser. Supports `?token=`.
**Auth:** Bearer token required (header or `?token=`; super_admin or owning client_admin)
**Path params:** `{payment}` = payment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30/invoice/view?token={{token}}'
```

### POST /api/payments/{payment}/send-reminder
**Action:** `PaymentController@sendReminder` — email a plan-expiry reminder to the client (and client_admin). Gated by Settings → Notifications → planExp.
**Auth:** Bearer token required (super_admin only)
**Path params:** `{payment}` = payment id

```bash
curl -X POST 'http://127.0.0.1:8000/api/payments/30/send-reminder' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (returns 422 if client email missing, 503 if planExp notifications disabled).

---

## PlanController

Plan tiers + `plan_modules` join. Plan names slugify to a unique `slug`.

### GET /api/plans
**Action:** `PlanController@index` — list plans with client count + modules.
**Auth:** Bearer token required
**Query params:** `search` (plan name)

```bash
curl -X GET 'http://127.0.0.1:8000/api/plans?search=Pro' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/plans
**Action:** `PlanController@store` — create a plan and its included modules.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/plans' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Pro",
  "price": 4999,
  "period": "month",
  "max_branches": 5,
  "max_users": 50,
  "storage_limit": "50GB",
  "support_level": "Priority",
  "is_featured": true,
  "badge": "Popular",
  "color": "#2563eb",
  "description": "For growing export teams.",
  "best_for": "SMB exporters",
  "status": "active",
  "trial_days": 14,
  "yearly_discount": 15,
  "is_custom": false,
  "modules": [
    { "module_id": 1, "access_level": "full" },
    { "module_id": 2, "access_level": "limited" }
  ]
}'
```

**Body fields:**
- `name` (string, required, max 100) — must slugify uniquely.
- `price` (numeric, required, min 0).
- `period` (string, required) — `month`|`quarter`|`year`.
- `max_branches` (int, optional, min 0); `max_users` (int, optional, min 0).
- `storage_limit` (string, optional, max 20); `support_level` (string, optional, max 50).
- `is_featured` (bool); `badge` (string, optional, max 50); `color` (string, optional, max 7, hex).
- `description` (string, optional); `best_for` (string, optional, max 255).
- `status` (string, required) — `active`|`inactive`.
- `trial_days` (int, optional, min 0); `yearly_discount` (numeric, optional, 0–100).
- `is_custom` (bool).
- `modules` (array, optional) — each `{ module_id (exists:modules,id), access_level: full|limited|addon|not_included }`. `not_included` rows are skipped.

### GET /api/plans/{plan}
**Action:** `PlanController@show` — one plan with client count, modules, and planModules.
**Auth:** Bearer token required
**Path params:** `{plan}` = `plans.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/plans/{plan}
**Action:** `PlanController@update` — update a plan; replaces all its `plan_modules`.
**Auth:** Bearer token required
**Path params:** `{plan}` = plan id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Pro",
  "price": 5499,
  "period": "month",
  "status": "active",
  "modules": [
    { "module_id": 1, "access_level": "full" }
  ]
}'
```

**Body fields:** identical rule set to `store` (see above).

### DELETE /api/plans/{plan}
**Action:** `PlanController@destroy` — delete a plan (422 if any client still uses it).
**Auth:** Bearer token required
**Path params:** `{plan}` = plan id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

## SubscriptionController

Client-admin self-serve subscription via Razorpay: `create-order` → checkout → `verify-payment` (or `cancel-order`).

### POST /api/subscription/cancel-order
**Action:** `SubscriptionController@cancelOrder` — mark a pending payment `failed` after the user cancels the Razorpay modal. Idempotent.
**Auth:** Bearer token required (owning client)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/cancel-order' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "razorpay_order_id": "order_Nabc123XyZ",
  "reason": "user_cancelled"
}'
```

**Body fields:**
- `razorpay_order_id` (string, required).
- `reason` (string, optional, max 255).

### POST /api/subscription/create-order
**Action:** `SubscriptionController@createOrder` — create a Razorpay order + pending Payment (or instantly activate free plans). May return a 422 requesting `kept_branch_ids` when downsizing branches.
**Auth:** Bearer token required (must have `client_id`)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/create-order' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_id": 2,
  "payment_method": "upi",
  "billing_cycle": "year",
  "kept_branch_ids": [1, 4]
}'
```

**Body fields:**
- `plan_id` (int, required) — exists in `plans`.
- `payment_method` (string, required) — `upi`|`card`|`net_banking`.
- `billing_cycle` (string, required) — `month`|`quarter`|`year`.
- `kept_branch_ids` (int[], optional) — required (422) only when the new plan's `max_branches` is below the current active branch count; each must exist in `branches` and belong to the caller's client.

### GET /api/subscription/plans
**Action:** `SubscriptionController@plans` — list active plans (with modules) for the subscription picker.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/subscription/plans' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/subscription/status
**Action:** `SubscriptionController@status` — current client's plan state (has_plan / expired / plan / expires_at).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/subscription/status' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/subscription/verify-payment
**Action:** `SubscriptionController@verifyPayment` — verify the Razorpay signature, mark the Payment success, and activate the plan (grants module permissions, enforces branch limit). Idempotent.
**Auth:** Bearer token required (owning client)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/verify-payment' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "razorpay_order_id": "order_Nabc123XyZ",
  "razorpay_payment_id": "pay_NdEf456GhI",
  "razorpay_signature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d"
}'
```

**Body fields:**
- `razorpay_order_id` (string, required).
- `razorpay_payment_id` (string, required).
- `razorpay_signature` (string, required) — HMAC signature from the Razorpay checkout callback.

---

## RazorpayWebhookController

### POST /api/razorpay/webhook
**Action:** `RazorpayWebhookController@handle` — Razorpay server-to-server event callback. Verifies `X-Razorpay-Signature`, then on `payment.captured`/`order.paid` activates the plan (with amount-tampering and concurrency guards); on `payment.failed` marks the Payment failed.
**Auth:** **Public (webhook, signature-verified).** No Bearer token — authenticity is proven by the `X-Razorpay-Signature` header against the raw request body. An invalid signature returns 400.

```bash
curl -X POST 'http://127.0.0.1:8000/api/razorpay/webhook' \
  --header 'Content-Type: application/json' \
  --header 'X-Razorpay-Signature: {{razorpay_webhook_signature}}' \
  --data '{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_NdEf456GhI",
        "order_id": "order_Nabc123XyZ",
        "amount": 1180000,
        "method": "upi"
      }
    }
  }
}'
```

**Body fields:** raw Razorpay event envelope (sent by Razorpay, not hand-built):
- `event` (string) — e.g. `payment.captured`, `order.paid`, `payment.failed`.
- `payload.payment.entity` (object) — `id`, `order_id` (matched to the local Payment), `amount` (paise; must equal `total × 100` or activation is refused), `method`, optional `error_description`.

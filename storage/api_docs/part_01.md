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

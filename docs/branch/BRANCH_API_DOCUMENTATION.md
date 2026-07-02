# BRANCH MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Branch (a tenant's office)
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Branch" is
A **Branch** is an office of a Client — the middle tier of **Client → Branch → User**. Creating a branch also provisions its **branch-user login**. Almost all business data is scoped by `branch_id`.

### 1.2 Authentication & access
All branch endpoints sit behind `auth:sanctum` + `user.active`. Send:
```
Authorization: Bearer <token>
Accept: application/json
```
> **Access model:** there is no role middleware. Authorization is **in-method**: every mutating call requires the branch to belong to the caller's client (`branch.client_id === user.client_id`; super-admin exempt), and **create requires the user to have a `client_id`** (a client-admin). The "Branches" menu is shown only to client-admins in the SPA.

### 1.3 Tenant / branch scoping
- `client_id` is always derived from the authenticated user, never the body.
- The SPA auto-injects `?branch_id=<active>` on GETs (via the BranchSwitcher). **Only `index()` honours it** (after verifying the branch belongs to the caller's client). `show/update/destroy` bind by URL id.

### 1.4 Response envelope
No uniform `{ data: ... }` envelope (no API Resources):

| Endpoint | Success shape | Status |
|---|---|---|
| `index` | raw Laravel paginator (`{ data, current_page, per_page, total, … }`) | 200 |
| `store` | `{ message, branch, branch_user, mail_warning }` | **201** |
| `show` | `{ branch, branch_user }` | 200 |
| `update` | `{ message, branch }` | 200 |
| `destroy` | `{ message }` (deactivated) | 200 |
| `nextCode` | `{ code, prefix }` | 200 |
| `formBundle` | `{ countries, states, next_code, prefix }` | 200 |

`branch` objects carry appended `logo_url`, `profile_photo_url`, `signature_url`, plus `users_count` / `departments_count` on the list.

### 1.5 Status codes
| Code | Meaning |
|---|---|
| 200 / 201 | Success (201 on create) |
| 401 | Not authenticated |
| 403 | User inactive · cross-tenant · non-client-admin create |
| 404 | Branch not found |
| 422 | Validation · plan `max_branches` reached · duplicate branch-user email |

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/branches/next-code` | Preview next `BR-###` code |
| 2 | GET | `/branches/form-bundle` | Countries / states / next code for the form |
| 3 | GET | `/branches` | Paginated branch list |
| 4 | POST | `/branches` | Create branch (+ branch-user) |
| 5 | GET | `/branches/{branch}` | Branch detail |
| 6 | PUT/PATCH | `/branches/{branch}` | Update branch (+ optional user) |
| 7 | DELETE | `/branches/{branch}` | **Deactivate** branch (not deleted) |

> `next-code` and `form-bundle` are registered before `apiResource('branches')` so the literal paths win over `{branch}`.

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/branches`
Paginated list, scoped to the caller's client. Excludes the Head Office branch unless `include_head_office=1`.

**Query params**
| Param | Type | Notes |
|---|---|---|
| `search` | string | ILIKE over name, code, city, industry |
| `status` | string | exact (`active` / `inactive`) |
| `type` | string | filters `branch_type` |
| `include_head_office` | bool | include the HO branch (default excluded) |
| `branch_id` | int | narrow to one branch (BranchSwitcher; ownership-checked) |
| `client_id` | int | super-admin only, to target a client |
| `per_page` | int | default 15 |

**Response 200** (paginator; each row):
```json
{
  "current_page": 1, "per_page": 15, "total": 3,
  "data": [
    {
      "id": 5, "client_id": 12, "name": "Mumbai HQ", "code": "BR-001",
      "email": "mumbai@igc.com", "phone": "9800000000", "contact_person": "Ravi",
      "branch_type": "company", "industry": "Trading",
      "city": "Mumbai", "state": "Maharashtra", "country": "India",
      "gst_number": "27ABCDE1234F1Z5", "gst_state_code": "27",
      "status": "active", "max_users": 0,
      "primary_color": "#4F46E5", "secondary_color": "#10B981",
      "logo_url": "https://…/storage/branches/logos/xxx.png",
      "profile_photo_url": null, "signature_url": null,
      "users_count": 6, "departments_count": 4
    }
  ]
}
```

---

### 3.2 GET `/branches/next-code`
Preview the next auto branch code without allocating.
**Response 200:** `{ "code": "BR-004", "prefix": "BR-" }`

---

### 3.3 GET `/branches/form-bundle`
Bootstrap data for the create/edit form. Countries + active states are cached 5 min per user (visibility-scoped); `next_code` is always fresh.

**Response 200**
```json
{
  "countries": [ { "id": 101, "name": "India", "iso_code": "IN", "status": "active" } ],
  "states":    [ { "id": 4001, "country_id": 101, "name": "Maharashtra", "status": "active" } ],
  "next_code": "BR-004",
  "prefix": "BR-"
}
```

---

### 3.4 POST `/branches`
Creates a branch **and** its branch-user in one transaction. Requires the caller to have a `client_id` (client-admin) and enforces the plan's `max_branches`.

**Content type:** `application/json`, or `multipart/form-data` when uploading `logo` / `profile_photo` / `signature_path`.

**Pre-processing:** `gst_number` / `pan_number` uppercased before validation.

**Request body**
```
# Branch identity
name*              string(255)   unique per client (not soft-deleted)
code               string(50)    optional — auto BR-### if blank
email              email(255)
phone              string(20)    phone regex
website            string(500)   URL regex
contact_person     string(255)
branch_type        string(50)
industry           string(100)
description         string
status*            in:active,inactive
# Legal / letterhead
gst_number         string(20)    GST regex, unique per client
gst_state_code     string(10)
pan_number         string(20)    PAN regex, unique per client
registration_number string(50)
cin                string(30)
iec                string(30)
drug_license       string(60)
pcpndt_no          string(60)
aeo_code           string(60)
one_star_file_no   string(60)
one_star_udin_no   string(60)
# Address
address            string
city/district/taluka/state   string(100)
pincode            string(10)
country            string(100)   defaults 'India'
# Ops / branding
max_users          integer min:0 (default 0 = unlimited)
established_at     date
primary_color / secondary_color   string(7)
logo               image jpg,jpeg,png,svg,webp  max 2MB
profile_photo      image jpg,jpeg,png           max 2MB
signature_path     image jpg,jpeg,png,webp      max 2MB
notes              string
# Branch user (provisioned as branch_user)
user_name*         string(255)
user_email*        email  unique in users (scoped to this client, not soft-deleted)
user_phone         string(20)  phone regex
user_designation   string(100)
user_password*     string min:6
user_status        in:active,inactive,pending
```

**Behaviour**
- If `code` is blank, a race-safe `BR-###` is allocated (row lock).
- The branch-user password is stored **twice** (bcrypt `password` + reversible `password_encrypted`).
- Uploads go to the `public` disk (relative paths); logo generates a dark-mode variant.
- A Welcome Credentials email (containing the plaintext password) is sent if mail is enabled; failure is **non-fatal** and returned as `mail_warning`.

**Response 201**
```json
{
  "message": "Branch created successfully",
  "branch": { "id": 5, "name": "Mumbai HQ", "code": "BR-001", "status": "active", "…": "…" },
  "branch_user": { "id": 88, "name": "Ravi", "email": "ravi@igc.com",
                   "user_type": "branch_user", "status": "active" },
  "mail_warning": null
}
```
**Errors:** 403 (no client_id) · 422 (validation / `max_branches` reached / duplicate `user_email`).

---

### 3.5 GET `/branches/{branch}`
Branch detail + its branch-user. Ownership-checked.

**Response 200**
```json
{
  "branch": { "id": 5, "name": "Mumbai HQ", "code": "BR-001", "…": "…",
              "logo_url": "…", "signature_url": "…" },
  "branch_user": {
    "id": 88, "name": "Ravi", "email": "ravi@igc.com",
    "phone": "9800000000", "designation": "Manager", "status": "active",
    "password_plain": "S3cret!"     // ONLY for super_admin or the owning client_admin
  }
}
```
> `password_plain` (decrypted `password_encrypted`) is returned **only** to a super-admin or the owning client-admin; `null` on a rotated `APP_KEY`.

**Errors:** 403 (cross-tenant) · 404.

---

### 3.6 PUT/PATCH `/branches/{branch}`
Updates the branch and, optionally, its branch-user. Ownership-checked. `DB::transaction`.

**Validation:** same rules as create, except — `name` uniqueness only enforced when the name changes; GST/PAN uniques ignore this branch; **`user_name` / `user_email` / `user_password` are nullable** (the branch-user block runs only when `user_name` is present). `status` is still required.

**Status transitions (key behaviour)**
| Transition | Effect |
|---|---|
| active → inactive | Revoke all branch-user tokens; soft-delete the branch's users + employees |
| inactive → active | Restore the branch's soft-deleted users + employees |

If `user_password` is supplied it is re-hashed + re-encrypted and a Password-Changed email is sent (non-fatal). Uploaded files replace the old ones (old files deleted).

**Response 200**
```json
{ "message": "Branch updated successfully", "branch": { "id": 5, "status": "inactive", "…": "…" } }
```
**Errors:** 403 · 404 · 422.

---

### 3.7 DELETE `/branches/{branch}`
**Deactivates** the branch — it is **not** removed. `DB::transaction`.

**Cascade:** revoke all branch-user tokens → soft-delete the branch's users + employees → set `branch.status = 'inactive'` (the branch row is **retained**).

**Response 200**
```json
{ "message": "Branch deactivated successfully" }
```
**Errors:** 403 (cross-tenant) · 404.

---

## 4. RELATED ENDPOINTS USED BY THE BRANCH UI

| Method | Path | Used by | Purpose |
|---|---|---|---|
| GET | `/branches?per_page=100` | BranchSwitcher | List branches for the switcher dropdown |
| GET | `/branches/{id}/users` (UI route) | Branch users screen | Manage a branch's users (`UsersPage`) |
| GET | `/dashboard/client-stats?branch_id=` | BranchDashboard | Scoped dashboard stats |
| GET | `/master/states?country_id=` | BranchForm | Lazy states by country |
| GET | `/permissions/...`, POST `/permissions/user/{id}` | Branch permissions | Branch-user permission matrix |

> There is **no dedicated branch-switcher API** — the switcher simply lists branches and the Axios interceptor injects `?branch_id=` on GETs. Active branch is stored client-side (`localStorage` key `cbc_selected_branch_id_<userId>`).

---

## 5. ERROR RESPONSE EXAMPLES

**403 — cross-tenant / not a client-admin**
```json
{ "message": "Unauthorized" }
```
```json
{ "message": "Only client admins can create branches" }
```
**422 — plan limit**
```json
{ "message": "Branch limit (3) reached. Upgrade your plan to add more branches." }
```
**422 — validation / duplicate branch-user email**
```json
{
  "message": "The user email has already been taken.",
  "errors": { "user_email": ["This email is already registered for this client."] }
}
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
GET  /branches/form-bundle                # countries / states / next BR-### code
GET  /branches/next-code                  # (optional) preview next code
POST /branches                            # create branch + branch-user (201)
GET  /branches?include_head_office=0      # list (HO hidden)
GET  /branches/{id}                       # detail (owner sees password_plain)
PUT  /branches/{id}                       # edit; active→inactive cascades (deactivate)
DELETE /branches/{id}                     # deactivate (row retained)
# switcher: GET /branches?per_page=100  + interceptor ?branch_id=<id> on GETs
```

---

## 7. SECURITY NOTES (client-facing caveats)

1. **No route-level role guard** — client-admin restriction is menu-visibility + in-method ownership.
2. **Reversible branch-user password** — returned to super-admin / owning client-admin and emailed in cleartext.
3. **Delete = deactivate** — the branch row is never removed.
4. **Plan limit** — `plan.max_branches` gates creation; per-branch `max_users` is stored but not enforced here.
5. **Branch code** is not unique at the DB level (uniqueness relies on the allocator).

---

*Related documents: BRANCH_TECHNICAL_DOCUMENTATION.md · BRANCH_FUNCTIONAL_DOCUMENTATION.md · BRANCH_CODE_WALKTHROUGH.md*

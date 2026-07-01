# CLIENT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Client (top-level tenant)
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Client" is
A **Client** is the company that bought the SaaS — the top of the tenancy hierarchy **Client → Branch → User**. Creating a Client also provisions its default **Head Office branch** and its **client-admin user** in one transaction.

### 1.2 Authentication & access
All client endpoints sit behind `auth:sanctum` + `user.active` (`EnsureUserActive`). Send:
```
Authorization: Bearer <token>
Accept: application/json
```

> **Access model (important):** the routes carry **no `super_admin` middleware, no policy, and no `$this->authorize()` call**. Any authenticated, active user whose token reaches these routes can call them, and there is **no `client_id` scoping** on `index`/`show`/`update`/`destroy` — `index` lists every client platform-wide. Restriction to super-admins is a **frontend convention**, not a server-enforced gate. The only in-code role check shapes the `show()` response (plaintext password disclosure) and is not an access gate.

### 1.3 Response envelope
This controller does **not** use a uniform `{ data: ... }` envelope (no API Resources).

| Endpoint | Success shape | Status |
|---|---|---|
| `index` | raw Laravel paginator (`{ data, current_page, per_page, total, … }`), `+ stats` when `include_stats=1` | 200 |
| `stats` | `{ total, active, inactive, plans_count, plan_breakdown }` | 200 |
| `store` | `{ message, client, admin_user }` | **201** |
| `show` | `{ client, admin_user, admin_permissions, states }` | 200 |
| `update` | `{ message, client }` | 200 |
| `destroy` | `{ message }` | 200 |
| `formBundle` | `{ organization_types, plans, countries }` | 200 |

`client` objects are raw Eloquent models with appended `logo_url`, `favicon_url`, `profile_photo_url`, plus eager-loaded `plan`, `createdBy`, `branches_count`, `users_count`.

### 1.4 Status codes
| Code | Meaning |
|---|---|
| 200 / 201 | Success (201 on create) |
| 401 | Not authenticated (`auth:sanctum`) |
| 403 | User inactive (`user.active`) |
| 404 | Client not found / soft-deleted (route-model binding) |
| 422 | Validation failure (`{ message, errors: {…} }`) |

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/clients/stats` | KPI stats for the listing page |
| 2 | GET | `/clients/form-bundle` | Dropdown data for the client form |
| 3 | GET | `/clients` | Paginated client list |
| 4 | POST | `/clients` | Create client (+ HO branch + admin user) |
| 5 | GET | `/clients/{client}` | Full client detail |
| 6 | PUT/PATCH | `/clients/{client}` | Update client (+ optional admin) |
| 7 | DELETE | `/clients/{client}` | Soft-delete client cascade |

> Route order: `/clients/stats` and `/clients/form-bundle` are registered **before** `apiResource('clients')` so the literal paths win over the `{client}` wildcard.

**Related (not on ClientController):**
- `GET /dashboard/admin-stats` → `DashboardController` (cross-tenant super-admin dashboard).
- `GET /settings`, `PUT /settings/{section}`, `POST /settings/appearance/asset` → `SettingsController` (backs `client_settings` feature flags).

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/clients`
Paginated list of **all** clients.

**Query params**
| Param | Type | Notes |
|---|---|---|
| `search` | string | matches `org_name`, `unique_number`, `email` (ILIKE) |
| `status` | string | exact match (`active` / `inactive` / `suspended`) |
| `per_page` | int | default 15 |
| `include_stats` | bool | when `1`, adds a top-level `stats` block |

Eager loads `plan`, `createdBy`; `branches_count` (excludes the `HO` branch) and `users_count`; ordered `created_at DESC`.

**Response 200**
```json
{
  "current_page": 1, "per_page": 15, "total": 3,
  "data": [
    {
      "id": 12, "org_name": "IGC Group", "unique_number": "EAIG260101120000",
      "email": "info@igc.com", "phone": "9800000000", "status": "active",
      "plan_type": "free", "plan_id": 2, "org_type": "Business",
      "primary_color": "#4F46E5", "secondary_color": "#10B981",
      "logo_url": "https://…/storage/clients/logos/xxx.png",
      "favicon_url": null, "profile_photo_url": null,
      "plan": { "id": 2, "name": "Growth" },
      "created_by": { "id": 1, "name": "Super Admin" },
      "branches_count": 3, "users_count": 14
    }
  ],
  "stats": {
    "total": 3, "active": 2, "inactive": 1,
    "plans_count": 2,
    "plan_breakdown": [ { "plan_name": "Growth", "count": 2 }, { "plan_name": "Free", "count": 1 } ]
  }
}
```

---

### 3.2 GET `/clients/stats`
Standalone KPI stats (same as the `include_stats` block).

**Response 200**
```json
{
  "total": 3, "active": 2, "inactive": 1, "plans_count": 2,
  "plan_breakdown": [ { "plan_name": "Growth", "count": 2 }, { "plan_name": "Free", "count": 1 } ]
}
```

---

### 3.3 GET `/clients/form-bundle`
One-shot dropdown data for the create/edit form. Cached per-user for 5 minutes; each list is scoped via `MasterVisibility::applyReadScope` and filtered to active status. States are intentionally **excluded** (fetched lazily by country).

**Response 200**
```json
{
  "organization_types": [ { "id": 1, "name": "Business", "slug": "business", "icon": "Building2", "status": "active", "sort_order": 1 } ],
  "plans": [ { "id": 2, "name": "Growth", "slug": "growth", "price": 4999, "period": "monthly", "status": "active", "trial_days": 14, "is_featured": true, "sort_order": 2 } ],
  "countries": [ { "id": 101, "name": "India", "iso_code": "IN", "status": "active" } ]
}
```

---

### 3.4 POST `/clients`
Creates a client + default Head Office branch + client-admin user in one `DB::transaction`.

**Content type:** `multipart/form-data` (supports `logo` / `favicon` / `profile_photo` uploads).

**Pre-processing (server-side, before validation):** `gst_number`/`pan_number` uppercased; `email`/`admin_email` lowercased+trimmed; `phone`/`admin_phone` stripped to digits.

**Request body**
```
# Organization
org_name*          string(255)
org_type*          string(50)   exists:organization_types,name
email*             email(255)   unique (clients, not soft-deleted)
phone              string(20)   unique
website            string(500)
status*            in:active,inactive,suspended
sports             string(100)
industry           string(100)
# Address
address            string
city / district / taluka / state / country   string(100)
pincode            string(10)
# Legal
gst_number         string(20)   GST regex, unique
pan_number         string(20)   PAN regex, unique
# Plan
plan_id            exists:plans,id
plan_type          in:free,paid   (IGNORED — always stored 'free')
plan_expires_at    date
# Branding
primary_color / secondary_color   string(7)
logo               image jpg,jpeg,png,svg,webp  max 2MB
favicon            image jpg,jpeg,png,ico,svg,webp  max 512KB
profile_photo      image jpg,jpeg,png  max 2MB
notes              string
# Client Admin (provisioned as client_admin user)
admin_name*        string(255)
admin_email*       email        (no uniqueness on create; per-client DB index is the backstop)
admin_phone        string(20)   unique
admin_designation  string(100)
admin_password*    string min:6
admin_status       in:active,inactive,pending
```

**Behaviour**
- `unique_number` auto-generated: `EA` + first 2 chars of org_name (upper) + `ymdHis` timestamp.
- `plan_type` **forced to `free`** (paid activation only via SubscriptionController).
- `status` defaults to `inactive` if absent; colors default `#4F46E5` / `#10B981`.
- Creates a `HO` branch (`<org> — Head Office`, status `active`).
- Creates the `client_admin` user with **dual password storage**: bcrypt `password` + reversible `password_encrypted` (Crypt).
- Sends `WelcomeCredentialsMail` (contains the plaintext admin password) if mail is enabled; email failure does **not** fail the request.

**Response 201**
```json
{
  "message": "Client created successfully",
  "client": { "id": 12, "org_name": "IGC Group", "unique_number": "EAIG260101120000",
              "plan_type": "free", "status": "inactive", "…": "…",
              "plan": {…}, "created_by": {…}, "branches_count": 1, "users_count": 1 },
  "admin_user": { "id": 55, "name": "Admin", "email": "admin@igc.com",
                  "user_type": "client_admin", "status": "active" }
}
```
**Errors:** 422 (validation).

---

### 3.5 GET `/clients/{client}`
Full detail for the edit/detail screen.

**Response 200**
```json
{
  "client": { "id": 12, "org_name": "IGC Group", "…": "…", "plan": {…}, "created_by": {…} },
  "admin_user": {
    "id": 55, "name": "Admin", "email": "admin@igc.com",
    "phone": "9800000000", "designation": "Director", "status": "active",
    "password_plain": "S3cret!"          // ONLY present when the requester is super_admin
  },
  "admin_permissions": [
    { "id": 900, "can_view": true, "can_edit": true, "module": { "id": 3, "name": "Payroll", "slug": "hr.payroll", "icon": "Wallet" } }
  ],
  "states": [ { "id": 4001, "name": "Maharashtra", "state_code": "27" } ]
}
```
> **Password disclosure:** `admin_user.password_plain` is added **only** when `request()->user()->user_type === 'super_admin'` and decryption succeeds (it decrypts `password_encrypted`). On a rotated `APP_KEY` it becomes `null`. Non-super-admins never receive this field.

**Errors:** 404 (unknown / soft-deleted client).

---

### 3.6 PUT/PATCH `/clients/{client}`
Updates the client and, optionally, its client-admin. `DB::transaction`.

**Content type:** `multipart/form-data` (for branding replacement).

**Validation:** same rule set as create, with:
- All `clients` uniqueness rules `->ignore($client->id)`.
- `admin_name` **nullable** — the admin block only runs when `admin_name` is present.
- `admin_email` **nullable**, uniqueness **scoped to this client** (`where client_id = {id}`, ignoring the current admin).
- `admin_password` **nullable**, min:6.

**Behaviour**
- Whitelisted mass-assign. **Free→paid escalation is blocked** — a `plan_type=paid` on a non-paid client is silently dropped.
- **Status `active → non-active` revokes all Sanctum tokens** for the client's users (forced re-login / lockout).
- Branding files replaced (old files deleted from the `public` disk).
- If `admin_password` supplied → updates both `password` (hash) and `password_encrypted` (Crypt) and sends `PasswordChangedMail` (plaintext) if mail enabled.

**Response 200**
```json
{ "message": "Client updated successfully",
  "client": { "id": 12, "org_name": "IGC Group", "status": "active", "…": "…" } }
```
**Errors:** 404 · 422.

---

### 3.7 DELETE `/clients/{client}`
Soft-deletes the client and its dependents. `DB::transaction`.

**Cascade:** revoke all user tokens → soft-delete all `users` (client_id) → soft-delete all `branches` (client_id) → soft-delete the client. (All `SoftDeletes` — recoverable, not hard-deleted.)

**Response 200**
```json
{ "message": "Client deleted successfully" }
```
**Errors:** 404.

---

## 4. RELATED ENDPOINTS USED BY THE CLIENT UI

| Method | Path | Controller | Purpose |
|---|---|---|---|
| GET | `/dashboard/admin-stats` | DashboardController | Cross-tenant super-admin dashboard |
| GET | `/settings` | SettingsController | Read client feature-flag settings (`client_settings`) |
| PUT | `/settings/{section}` | SettingsController | Update a settings section (general/branding/security/notification/approval) |
| POST | `/settings/appearance/asset` | SettingsController | Upload a branding asset |
| GET | `/plans` | PlanController | Plan list for the plan dropdown |

---

## 5. ERROR RESPONSE EXAMPLES

**422 — validation**
```json
{
  "message": "The org name field is required. (and 2 more errors)",
  "errors": {
    "org_name": ["The org name field is required."],
    "email": ["This email is already registered to another client."],
    "gst_number": ["The GST number format is invalid."]
  }
}
```
**401 — unauthenticated**
```json
{ "message": "Unauthenticated." }
```
**404 — not found**
```json
{ "message": "No query results for model [App\\Models\\Client] 999" }
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
GET  /clients/form-bundle                 # load org types / plans / countries
POST /clients                             # create client + HO branch + admin (201)
GET  /clients?include_stats=1             # list + KPI cards
GET  /clients/{id}                        # open detail (super-admin sees password_plain)
PUT  /clients/{id}                        # edit; active→inactive revokes tokens
DELETE /clients/{id}                      # soft-delete cascade
```

---

## 7. SECURITY NOTES (client-facing caveats)

1. **No route-level role guard / no tenant scoping** on client CRUD — enforce super-admin access at the gateway/frontend, or add a policy.
2. **Reversible admin password** — stored `Crypt`-encrypted and returned as `password_plain` to super-admins; also emailed in cleartext. Anyone with DB + `APP_KEY` can decrypt.
3. **Per-tenant email** — the same email may exist across different clients (partial unique index on `COALESCE(client_id,0)+email`).
4. **Plan escalation** to `paid` is not possible through this API (only via the subscription/billing flow).

---

*Related documents: CLIENT_TECHNICAL_DOCUMENTATION.md · CLIENT_FUNCTIONAL_DOCUMENTATION.md · CLIENT_CODE_WALKTHROUGH.md*

# SAAS PLATFORM — API DOCUMENTATION

> Cross_Border_Command · Multi-tenant SaaS ERP
> Platform-level API conventions, auth, tenancy, and the billing/access endpoint index.
> Base URL: `{APP_URL}/api`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial platform API documentation |

> This documents the **platform-wide** conventions and the SaaS/tenancy/billing/access endpoints. For full per-endpoint request/response bodies see the module API docs: `docs/client/`, `docs/branch/`, `docs/plan/`, `docs/payment/`, `docs/permission/`.

---

## 1. CONVENTIONS

### 1.1 Base & auth
- All routes live in `routes/api.php` under the global `/api` prefix.
- **Public** routes (no auth): listed in §2.
- **Protected** routes sit under `auth:sanctum` + `user.active`. Send:
```
Authorization: Bearer <sanctum_token>
Accept: application/json
```

### 1.2 Tenancy
- `client_id` is derived from the authenticated user — **never** sent in the body.
- The SPA auto-injects `?branch_id=<active>` on GETs (BranchSwitcher); branch users are pinned.
- Reads are scoped by `MasterVisibility` (globals + own client (+ own branch for branch users)).

### 1.3 Response shapes (vary by controller)
- Reads: usually `{ data: ... }` (some return raw paginators / raw models).
- Actions: `{ message, ... }`.
- Validation errors: `{ message, errors: { field: [..] } }`.

### 1.4 Status codes
| Code | Meaning |
|---|---|
| 200 / 201 | Success |
| 400 | Signature/verification failure (checkout) |
| 401 | Unauthenticated |
| 403 | Inactive user/tenant/branch · cross-tenant · role |
| 404 | Not found |
| 422 | Validation / business rule |
| 500 | Server error |
| 502 / 503 | Razorpay order failure / mail disabled |

---

## 2. PUBLIC ENDPOINTS (no auth)

| Method | Path | Purpose |
|---|---|---|
| POST | `/login` | Email + password login (returns token or `needs_org_selection`) |
| POST | `/login/face` | Face-descriptor login (threshold 0.50) |
| POST | `/google-login` | Google OAuth login |
| POST | `/forgot-password/send-otp` · `/verify-otp` · `/reset` | OTP password reset |
| GET | `/onboarding/{token}` · POST `/onboarding/{token}/complete` | Public employee onboarding (rate-limited 30/min/IP) |
| GET | `/sales/quotations/{id}/view` · `/sales/proforma-invoices/{id}/view` | Signed PDF links (expire ~60 days) |
| GET | `/payments/{id}/invoice/view` · `/download` | Invoice PDFs (self-auth via `?token=`) |
| POST | `/razorpay/webhook` | Razorpay webhook (signature-gated; **disabled locally**) |

---

## 3. AUTH & SESSION ENDPOINTS

### 3.1 POST `/login`
**Body:** `{ "email": "...", "password": "..." }`
**Response 200 (single tenant):**
```json
{ "token": "…", "user": { "id": 1, "user_type": "client_admin", "client_id": 12, "branch_id": 5,
  "permissions": { "hr.payroll": { "can_view": true, "can_edit": true, "…": false } },
  "plan": { "has_plan": true, "expired": false } } }
```
**Response 200 (email in multiple tenants):**
```json
{ "needs_org_selection": true, "orgs": [ { "client_id": 12, "org_name": "IGC Group" }, { "client_id": 20, "org_name": "…" } ] }
```
Re-submit with the chosen `client_id`.
**Errors:** 422 (invalid credentials) · 429/403 (brute-force lockout, 5/15min).

### 3.2 GET `/me`
Returns the current user with a fresh `permissions` map and `plan` status. Used by the SPA to refresh gating.

### 3.3 POST `/logout`
Revokes the current token.

---

## 4. TENANCY & BILLING ENDPOINT INDEX

> Full bodies in the per-module API docs.

### 4.1 Clients (super-admin) — `docs/client/`
| Method | Path |
|---|---|
| GET | `/clients` · `/clients/stats` · `/clients/form-bundle` |
| POST | `/clients` (create + HO branch + admin) |
| GET/PUT/DELETE | `/clients/{client}` |

### 4.2 Branches (client-admin) — `docs/branch/`
| Method | Path |
|---|---|
| GET | `/branches` · `/branches/next-code` · `/branches/form-bundle` |
| POST | `/branches` (create + branch user) |
| GET/PUT/DELETE | `/branches/{branch}` (delete = deactivate) |

### 4.3 Plans (catalogue) — `docs/plan/`
| Method | Path |
|---|---|
| GET/POST | `/plans` |
| GET/PUT/DELETE | `/plans/{plan}` |
| GET | `/subscription/plans` (active catalogue for checkout) |

### 4.4 Subscription & Payments — `docs/payment/`
| Method | Path |
|---|---|
| GET | `/subscription/status` |
| POST | `/subscription/create-order` · `/verify-payment` · `/cancel-order` |
| GET | `/payments` · `/payments/stats` |
| POST | `/payments` (manual record) · `/payments/{id}/send-reminder` |
| GET | `/payments/{id}` · `/payments/{id}/invoice/view|download` |
| POST | `/razorpay/webhook` (public) |

### 4.5 Permissions & modules — `docs/permission/`
| Method | Path |
|---|---|
| GET | `/modules` |
| GET | `/permissions/users` · `/permissions/user/{userId}` |
| POST | `/permissions/user/{userId}` (full replace) |

### 4.6 Settings (feature flags & branding)
| Method | Path |
|---|---|
| GET | `/settings` |
| PUT | `/settings/{section}` |
| POST | `/settings/appearance/asset` |

### 4.7 Dashboards
| Method | Path | Audience |
|---|---|---|
| GET | `/dashboard/admin-stats` | super-admin (cross-tenant) |
| GET | `/dashboard/client-stats` | client-admin / branch / client-user (branch_id aware) |
| GET | `/dashboard/employee-stats` | employee |

---

## 5. BUSINESS-MODULE ENDPOINTS (scoped by tenancy)

All five pillars follow the same conventions (auth + `user.active`, `client_id`/`branch_id` scoping, `apiResource` + extra verbs). Examples:
- **Sales:** `/customers`, `/consignees`, `/sales/leads`, `/sales/quotations`, `/proforma-invoices`, `/procurements`.
- **CLM:** `/clm/segments`, `/clm/kyc`, `/clm/agreements`, `/clm/signatures/*`.
- **HRMS:** `/employees`, `/attendance`, `/leave-requests`, `/expense-claims`, `/payroll/*` (see `docs/payroll/`).
- **Procurement:** `/products/step/*`, `/vendors/step/*`.
- **Masters:** generic `GET|POST|PUT|DELETE /master/{key}`.

Each is bounded by the **five gating layers** (tenancy scope · role · plan/module · feature flag · per-user permission — see the Functional doc §4).

---

## 6. GLOBAL ERROR EXAMPLES

**401 — no/expired token**
```json
{ "message": "Unauthenticated." }
```
**403 — suspended tenant / inactive user (user.active)**
```json
{ "message": "Your account or organization is inactive." }
```
**422 — validation**
```json
{ "message": "The given data was invalid.", "errors": { "email": ["…"] } }
```

---

## 7. PLATFORM SECURITY NOTES

1. **Tenant isolation** is enforced by `client_id` scoping + `MasterVisibility`; `client_id` is never taken from the body.
2. **Three access layers** (plan gating · feature flags · per-user permissions) + role + scope — but most business APIs are **not** individually flag-enforced (gating is SPA-side).
3. **Reversible admin passwords** (Client/Branch) — decryptable with DB + `APP_KEY`.
4. **Public routes** are minimal and either signed, rate-limited, or self-authenticated (`?token=`).
5. **Razorpay webhook disabled locally** — the checkout verify path is authoritative.
6. **Per-tenant email uniqueness** — the same email may belong to users in different clients.

---

## 8. QUICK REFERENCE — TENANT LIFECYCLE (API)

```
# provision (super-admin)
POST /clients                         # tenant + HO branch + admin
PUT  /clients/{id}                    # activate (status → active)

# subscribe (client-admin)
GET  /subscription/plans
POST /subscription/create-order → Razorpay → POST /subscription/verify-payment   # activate + unlock modules

# set up org (client-admin)
POST /branches                        # office + branch user
POST /permissions/user/{id}           # grant scoped access
PUT  /settings/{section}              # feature flags / branding

# operate
GET  /<module>?branch_id=<active>     # scoped reads across the 5 pillars

# renew / offboard
GET  /subscription/status             # expiry check → /my-plan or /plan-blocked
PUT  /clients/{id} (status inactive)  # deactivate (revokes tokens)
DELETE /clients/{id}                  # soft-delete cascade
```

---

*Related documents: SAAS_TECHNICAL_DOCUMENTATION.md · SAAS_FUNCTIONAL_DOCUMENTATION.md · SAAS_CODE_WALKTHROUGH.md · and the per-module sets under docs/.*

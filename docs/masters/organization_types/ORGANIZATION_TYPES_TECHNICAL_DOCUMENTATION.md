# ORGANIZATION TYPES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Organization Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\OrganizationType` (note: `App\Models`, **not** `App\Models\Masters` — predates the masters namespace).
- **Table:** `organization_types` (no `master_` prefix, no `client_id`/`branch_id` columns).
- **Fillable:** `name, slug, icon, description, status, sort_order`
- **Casts:** `sort_order => integer`
- **Helper:** `isActive()` → `status === 'active'`
- **Controller:** `App\Http\Controllers\Api\OrganizationTypeController` (dedicated, **not** `MasterController`).

---

## 2. VALIDATION SPEC (from `OrganizationTypeController`)

| Field | store | update |
|---|---|---|
| name | required, string, max 100, `unique:organization_types,name` | same + `,{id}` ignore |
| icon | nullable, string, max 50 | same |
| description | nullable, string, max 255 | same |
| status | required, `in:active,inactive` | same |
| sort_order | nullable, integer, min 0 | same |

`slug` is derived (`Str::slug(name)`), not accepted from the request. `sort_order` defaults to `max(sort_order)+1` when omitted.

---

## 3. UNIQUENESS MODEL

Single-column DB-level unique on `name` (Laravel `unique` rule, case-sensitive at the DB collation). Not tenant-scoped — this is a global platform vocabulary. No `uEach`/`uFields` engine logic applies (this master bypasses `MasterController::validatePayload`).

---

## 4. ENDPOINTS

Registered via `Route::apiResource('organization-types', OrganizationTypeController::class)` under `auth:sanctum` + `user.active`.

| Verb | Path | Method | Access |
|---|---|---|---|
| GET | `/api/organization-types` | `index` (?active_only=, ?search=) | any authenticated user |
| POST | `/api/organization-types` | `store` | super admin only |
| GET | `/api/organization-types/{id}` | `show` | any authenticated user |
| PUT/PATCH | `/api/organization-types/{id}` | `update` | super admin only |
| DELETE | `/api/organization-types/{id}` | `destroy` | super admin only |
| GET | `/api/master-counts` | `MasterController::counts` | contributes the dashboard card count |

There is **no** `/master/organization_types` route and no `next-code` endpoint.

---

## 5. SPECIAL HANDLING

- **Dashboard-only registry entry:** `organization_types` is listed in `MasterController::MODELS` (mapped to `App\Models\OrganizationType`) purely so `/master-counts` includes it; without the entry the card was stuck at 0.
- **Super-admin gate:** `authorizeSuperAdmin` on every mutation.
- **Slug auto-derivation:** on create always; on update only when name changes.
- **Delete in-use guard:** blocked if any `Client.org_type == name`.
- **Cache:** `MasterBundleCache::bump()` after each write (feeds the client form dropdown).

---

## 6. SECURITY & SCOPING

- Reads are open to any authenticated user (the registration form needs the list); writes are super-admin only.
- No creator-hierarchy / branch scoping — the table has no ownership columns.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 6 (name, slug, icon, description, status, sort_order) |
| Required fields | 2 (name, status) |
| Uniqueness model | Global DB unique on `name` (not tenant-scoped) |
| Auto-code | No (slug + sort_order auto-derived, not a sequence) |
| Special | Own controller/endpoint, super-admin only, delete in-use guard |

---
*Related documents: ORGANIZATION_TYPES_FUNCTIONAL_DOCUMENTATION.md, ORGANIZATION_TYPES_API_DOCUMENTATION.md, ORGANIZATION_TYPES_CODE_WALKTHROUGH.md*

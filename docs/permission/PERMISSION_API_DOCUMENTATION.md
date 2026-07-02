# PERMISSION MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Access Control → Permissions
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Permission" is
One row per `(user, leaf-module)` with seven booleans: `can_view, can_add, can_edit, can_delete, can_export, can_import, can_approve`. Grants follow a cascade (super-admin → client-admin → branch-user → employee) and you can only grant flags you hold. Any action forces `can_view = true`.

### 1.2 Auth & access
All endpoints require Sanctum + `user.active`. There is **no permission middleware**; the grant endpoints enforce the cascade in-controller. Read/write are role-scoped (see each endpoint).

### 1.3 Action keys (7)
`can_view · can_add · can_edit · can_delete · can_export · can_import · can_approve`

### 1.4 Notes
- `POST /permissions/user/{id}` is a **full replace** (no per-permission PUT/DELETE).
- The save payload is **leaf modules only** — parents are skipped server-side.
- `GET /modules` is served by `PermissionController` (no dedicated ModuleController).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/modules` | Full active module catalogue (tree via `parent_id`) |
| 2 | GET | `/permissions/users` | Users the caller may grant to (role-scoped picker) |
| 3 | GET | `/permissions/user/{userId}` | Read a user's saved permissions |
| 4 | POST | `/permissions/user/{userId}` | Replace a user's permissions |

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/modules`
Active modules for building the matrix (client builds the tree from `parent_id`).
**Response 200**
```json
[
  { "id": 1, "parent_id": null, "name": "Dashboard", "slug": "dashboard", "icon": "LayoutDashboard", "is_default": true, "sort_order": 1, "description": null },
  { "id": 30, "parent_id": 8, "name": "Payroll", "slug": "hr.payroll", "icon": "Wallet", "is_default": false, "sort_order": 3, "description": null }
]
```

### 3.2 GET `/permissions/users`
Users the caller may manage.
**Query:** `branch_id` (optional; client-admin narrowing).
**Scope:** super-admin → active client-admins; client-admin → active branch_user/employee in own client (minus self); branch_user → active employees in own client+branch (minus self); else empty.
**Response 200**
```json
[ { "id": 88, "name": "Ravi", "email": "ravi@igc.com", "user_type": "branch_user",
    "client_id": 12, "branch_id": 5, "status": "active" } ]
```

### 3.3 GET `/permissions/user/{userId}`
Read one user's grants (to hydrate the matrix).
**Access:** self · super-admin · client-admin (same client, or orphan `client_id=null`) · branch_user (own-branch employee). Else 403.
**Response 200**
```json
{
  "user": { "id": 88, "name": "Ravi", "email": "ravi@igc.com", "user_type": "branch_user" },
  "permissions": [
    { "id": 900, "module_id": 30, "can_view": true, "can_add": false, "can_edit": true,
      "can_delete": false, "can_export": false, "can_import": false, "can_approve": false,
      "module": { "id": 30, "name": "Payroll", "slug": "hr.payroll", "icon": "Wallet" } }
  ]
}
```
**Errors:** 403 · 404.

### 3.4 POST `/permissions/user/{userId}`
Replace the target user's permissions.
**Body**
```json
{
  "permissions": [
    { "module_id": 30, "can_view": true, "can_add": false, "can_edit": true,
      "can_delete": false, "can_export": false, "can_import": false, "can_approve": false },
    { "module_id": 2,  "can_view": true, "can_add": true, "can_edit": true,
      "can_delete": true, "can_export": true, "can_import": false, "can_approve": false }
  ]
}
```
**Validation:** `permissions` required array; each `module_id` required + exists; each `can_*` boolean.

**Server pipeline**
1. **Grant scope:** super-admin → target must be `client_admin`; client-admin → target must be `branch_user` (adopts orphan `client_id=null` targets first); branch_user → target must be an `employee` in the same client+branch. Else **403**.
2. **Can't-grant-what-you-don't-have:** granting any flag the caller lacks → **422**.
3. **Leaf-only:** parent/group modules are skipped (counted in `skipped_parent_modules`).
4. **Replace:** delete the target's rows, then insert (not wrapped in a transaction).
5. **Action-implies-view:** any action true ⇒ `can_view` forced true; all-false rows skipped.
6. **Downstream cascade:** if super-admin edits a client-admin, downstream branch/employee flags the admin no longer holds are stripped.

**Response 200**
```json
{
  "message": "Permissions updated",
  "saved_count": 12,
  "db_count": 12,
  "skipped_parent_modules": 4,
  "target_user_id": 88,
  "cascade_branch_users_updated": 0
}
```
**Errors:** 403 (grant scope) · 422 (validation / can't-grant-what-you-don't-have).

---

## 4. ERROR RESPONSE EXAMPLES

**403 — outside the grant cascade**
```json
{ "message": "Unauthorized" }
```
**422 — can't grant what you don't have**
```json
{ "message": "You cannot grant can_edit that you do not have." }
```
**422 — validation**
```json
{ "message": "The permissions field is required.", "errors": { "permissions": ["…"] } }
```

---

## 5. QUICK REFERENCE — TYPICAL FLOW

```
GET  /modules                         # module tree
GET  /permissions/users               # pick a manageable user
GET  /permissions/user/{id}           # load their current grants
GET  /permissions/user/{myId}         # load my grants → grantableBy
POST /permissions/user/{id}           # save (leaf-only; view auto-forced)
```

---

## 6. HOW THE RESULT IS CONSUMED (gating)
The saved flags surface in the login payload as `user.permissions` keyed by **module slug** (built in `AuthController::formatUser`, refreshed via `/me`). The SPA gates menus/pages on `perms[slug].can_view` (`Sidebar.canView`, `utils/menuAccess.moduleVisible`). Super-admins bypass. Most business API endpoints are **not** flag-enforced — gating is primarily SPA-side.

---

## 7. NOTES (caveats)
1. **Full-replace** save; **leaf-only** payload.
2. **Action-implies-view** enforced (API + UI + backfill).
3. **No `UNIQUE(user_id, module_id)`**; save is not transactional.
4. **Grant cascade + can't-grant-what-you-don't-have** are the only server-side permission checks in the module.
5. **`GET /modules`** served by `PermissionController`.
6. **Hidden from the matrix:** clients, plans, payments, settings, permissions, master.organization_types.

---

*Related documents: PERMISSION_TECHNICAL_DOCUMENTATION.md · PERMISSION_FUNCTIONAL_DOCUMENTATION.md · PERMISSION_CODE_WALKTHROUGH.md*

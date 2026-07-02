# PLAN MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Plans
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Plan" is
A subscription tier: price, cycle, limits and the **modules it unlocks** (via `plan_modules.access_level`). Plans are **global** (no tenant scoping) — the catalogue is a super-admin function (menu-gated).

### 1.2 Auth & access
All plan endpoints require Sanctum + `user.active`. There is no route-level role middleware; the catalogue is restricted to super-admins by menu visibility. The client-facing catalogue for checkout is `GET /subscription/plans` (see the Payment module).

### 1.3 Response shapes
`index` returns a raw array; store/update return `{ message, plan }`; destroy returns `{ message }`. Errors: `{ message }` (+ `errors` on 422).

### 1.4 Access levels (`plan_modules.access_level`)
`full` · `limited` · `addon` · `not_included` (**never persisted** — dropped on save).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/plans` | List plans (+ clients_count + modules) |
| 2 | POST | `/plans` | Create a plan (+ module access) |
| 3 | GET | `/plans/{plan}` | Plan detail |
| 4 | PUT/PATCH | `/plans/{plan}` | Update a plan (replaces module set) |
| 5 | DELETE | `/plans/{plan}` | Delete a plan (hard; guarded) |

**Related (Payment module):**
| Method | Path | Purpose |
|---|---|---|
| GET | `/subscription/plans` | Active plans for the client checkout |
| POST | `/subscription/create-order` | Assign/pay a plan |
| POST | `/subscription/verify-payment` | Activate the plan for the client |
| GET | `/modules` | Module catalogue (for the plan form) — served by PermissionController |

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/plans`
**Query:** `search` (ILIKE on name).
**Response 200**
```json
[
  {
    "id": 3, "name": "Pro", "slug": "pro", "price": "4999.00", "period": "month",
    "max_branches": 25, "max_users": 50, "storage_limit": "25GB", "support_level": "Priority",
    "is_featured": true, "badge": "Most Popular", "color": "#5A51E8",
    "description": "…", "best_for": "Growing teams", "status": "active",
    "sort_order": 3, "trial_days": 14, "yearly_discount": "20.00", "is_custom": false,
    "clients_count": 2,
    "modules": [
      { "id": 2, "name": "Branches", "slug": "branches", "pivot": { "access_level": "full" } }
    ]
  }
]
```

### 3.2 POST `/plans`
**Body**
```json
{
  "name": "Pro", "price": 4999, "period": "month",
  "max_branches": 25, "max_users": 50, "storage_limit": "25GB", "support_level": "Priority",
  "is_featured": true, "badge": "Most Popular", "color": "#5A51E8",
  "description": "…", "best_for": "Growing teams", "status": "active",
  "trial_days": 14, "yearly_discount": 20, "is_custom": false,
  "modules": [
    { "module_id": 2, "access_level": "full" },
    { "module_id": 7, "access_level": "limited" },
    { "module_id": 9, "access_level": "not_included" }
  ]
}
```
**Validation:** `name` req ≤100; `price` req ≥0; `period` in month,quarter,year; `max_branches`/`max_users` int ≥0; `storage_limit` ≤20; `support_level` ≤50; `is_featured`/`is_custom` bool; `badge` ≤50; `color` ≤7; `status` in active,inactive; `trial_days` int ≥0; `yearly_discount` numeric 0–100; `modules.*.module_id` exists; `modules.*.access_level` in full,limited,addon,not_included.

**Behaviour:** slug auto-derived (unique, else 422 on `name`); `sort_order = max+1`; `not_included` module rows dropped; transaction; cache bumped.
**Response 201:** `{ "message": "Plan created successfully", "plan": { …, "modules": [...] } }`
**Errors:** 422 (validation / duplicate slug).

### 3.3 GET `/plans/{plan}`
**Response 200:** `{ …plan…, "clients_count": 2, "modules": [...(with pivot)], "planModules": [...raw rows] }`
**Errors:** 404.

### 3.4 PUT/PATCH `/plans/{plan}`
Same body/validation as create. **Replaces** the module set (delete + reinsert). **Note:** `slug` is validated but **not rewritten** — a renamed plan keeps its slug.
**Response 200:** `{ "message": "Plan updated successfully", "plan": { …, "modules": [...] } }`
**Errors:** 404 · 422.

### 3.5 DELETE `/plans/{plan}`
Hard delete (plan + its `plan_modules`).
**Response 200:** `{ "message": "Plan deleted successfully" }`
**Errors:** 404 · **422** if any client is on the plan:
```json
{ "message": "Cannot delete plan with active clients. Reassign clients first." }
```

---

## 4. RELATED — SUBSCRIPTION CATALOGUE

### GET `/subscription/plans`
Active plans (`status='active'`) with modules, ordered by `sort_order` — used by the client "My Plan" checkout.
```json
{ "data": [ { "id": 3, "name": "Pro", "price": "4999.00", "period": "month",
             "max_branches": 25, "max_users": 50, "yearly_discount": "20.00",
             "modules": [ { "id": 2, "name": "Branches", "pivot": { "access_level": "full" } } ] } ] }
```
Assignment/activation (create-order → verify-payment) is documented in the **Payment** module — activation turns the plan's `access_level` map into the client-admin's permission rows and enforces the branch limit.

---

## 5. ERROR RESPONSE EXAMPLES

**422 — duplicate name/slug**
```json
{ "message": "A plan with a similar name already exists.", "errors": { "name": ["…"] } }
```
**422 — delete guarded**
```json
{ "message": "Cannot delete plan with active clients. Reassign clients first." }
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
# super-admin catalogue
GET  /modules                    # module tree for the form
GET  /plans                      # list
POST /plans                      # create (+ module access)
PUT  /plans/{id}                 # edit (replaces modules; slug unchanged)
DELETE /plans/{id}               # delete (blocked if clients on it)

# client assignment (Payment module)
GET  /subscription/plans         # active catalogue
POST /subscription/create-order  # pick & pay
POST /subscription/verify-payment# activate → unlock modules
```

---

## 7. NOTES (caveats)
1. **Plans are global** — no tenant scoping.
2. **`not_included` module rows are never stored.**
3. **`update` does not change `slug`.**
4. **Hard delete**, blocked while clients reference the plan.
5. **`period` is the cycle**; pricing (×1/×3/×12, +18% GST, yearly discount) is computed at checkout.
6. **`GET /modules`** is served by `PermissionController::modules`, not a dedicated ModuleController.

---

*Related documents: PLAN_TECHNICAL_DOCUMENTATION.md · PLAN_FUNCTIONAL_DOCUMENTATION.md · PLAN_CODE_WALKTHROUGH.md*

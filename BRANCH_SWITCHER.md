# Branch Switcher — Implementation & Setup Guide

End-to-end documentation for the top-bar branch switcher in Cross Border Command.

---

## 1. What it does

A dropdown in the top bar that lets a **main-branch user** (and a **client admin**) pick which branch's data they want to see. The dashboard re-fetches scoped to that branch. Sub-branch users are locked to their own branch and see a read-only label instead of a dropdown.

---

## 2. Behaviour by user type

| User type | Top bar shows | Default selection on first login | Can switch? |
|---|---|---|---|
| **Super Admin** | Nothing | — | — |
| **Client Admin** | Dropdown | "All Branches" | Yes (any branch in their client) |
| **Main Branch User** (`branch_user` + `branches.is_main = true`) | Dropdown | **Their own branch name** | Yes (any branch in their client, or "All Branches") |
| **Sub-Branch User** (`branch_user` + `is_main = false`) | Static label with their branch name | Locked to own branch | No |

> **Default for main branch user**: when you first log in, the dropdown shows your branch name (e.g. "Mumbai HQ ▼"), not "All Branches". You can switch to any other branch or pick "All Branches" if needed.

---

## 3. Data flow

```
┌─────────────┐  1. user picks branch  ┌──────────────────────┐
│  Top bar    │ ─────────────────────▶ │ BranchSwitcher       │
│  dropdown   │                        │ Context              │
└─────────────┘                        │ • selectedBranchId    │
                                       │ • localStorage save   │
                                       └──────────┬───────────┘
                                                  │
                          ┌───────────────────────┴─────────────────┐
                          ▼                                         ▼
            ┌──────────────────────┐                  ┌──────────────────────┐
            │  ClientDashboard     │                  │  BranchDashboard     │
            │  useEffect re-runs   │                  │  useEffect re-runs   │
            │  on selectedBranchId │                  │  on selectedBranchId │
            └──────────┬───────────┘                  └──────────┬───────────┘
                       │                                         │
                       └────────────────┬────────────────────────┘
                                        │
                                        ▼
              GET /api/dashboard/client-stats?branch_id=<id>
                                        │
                                        ▼
               DashboardController::clientStats($request)
               • validates branch_id belongs to user's client
               • locks sub-branch users to their own branch
               • scopes Users + Branches list + user_roles by branch_id
               • payments stay client-level (subscription is per client)
                                        │
                                        ▼
                       JSON response with filter.branch_id
                                        │
                                        ▼
                    Dashboard re-renders with new data
```

---

## 4. Files changed

### Frontend

| # | File | Change |
|---|---|---|
| 1 | [resources/js/contexts/BranchSwitcherContext.tsx](resources/js/contexts/BranchSwitcherContext.tsx) | Default `selectedBranchId` for main-branch user = their own branch (was `null`); persist to `localStorage.cbc_selected_branch_id`; restore on reload |
| 2 | [resources/js/velzon/Layouts/Header.tsx](resources/js/velzon/Layouts/Header.tsx) | Imported & rendered `<BranchSwitcher />` in the right-side header block (between search and FullScreen) |
| 3 | [resources/js/pages/dashboard/ClientDashboard.tsx](resources/js/pages/dashboard/ClientDashboard.tsx) | Read `selectedBranchId` from context; pass as `?branch_id=`; refetch when switched |
| 4 | [resources/js/pages/dashboard/BranchDashboard.tsx](resources/js/pages/dashboard/BranchDashboard.tsx) | Same as #3 |

### Backend

| # | File | Change |
|---|---|---|
| 5 | [app/Http/Controllers/Api/DashboardController.php](app/Http/Controllers/Api/DashboardController.php) | `clientStats()` now accepts `?branch_id=` query param. Validates ownership against user's `client_id`. Forces sub-branch users back to their own branch. Scopes Users/Branches/user_roles by branch when filter is active. Returns `filter.branch_id` in response. |

### Already existed (used as-is)

| File | Role |
|---|---|
| [resources/js/components/BranchSwitcher.tsx](resources/js/components/BranchSwitcher.tsx) | The dropdown UI component |
| [routes/api.php](routes/api.php) | `/branches` endpoint already returns the branches list to the context provider |
| [app/Http/Controllers/Api/BranchController.php](app/Http/Controllers/Api/BranchController.php) | Already filters branches by `client_id` |

---

## 5. API contract

### Endpoint
```
GET /api/dashboard/client-stats
GET /api/dashboard/client-stats?branch_id=5
```

Auth: Bearer (Sanctum).

### Query params

| Param | Type | Required | Notes |
|---|---|---|---|
| `branch_id` | integer | no | When present, scope users/branches to that branch. Must belong to caller's `client_id` — otherwise silently ignored. Sub-branch users have this overridden to their own `branch_id`. |

### Response shape (excerpt)

```json
{
  "client": { ... },
  "plan": { ... },
  "counts": {
    "total_branches": 1,         // 1 when filtered, all when not
    "active_branches": 1,
    "total_users": 12,            // scoped by branch when filtered
    "active_users": 11,
    "total_payments": 16,         // always client-level
    "success_payments": 14,
    "pending_payments": 1,
    "total_paid": 142761.12
  },
  "branches": [...],              // single branch when filtered
  "recent_payments": [...],       // client-level
  "payment_trend": [...],         // client-level (subscription)
  "user_roles": { ... },          // scoped by branch when filtered
  "filter": {
    "branch_id": 5                // echoes back what was applied; null when no filter
  }
}
```

---

## 6. localStorage persistence

| Key | Value | Set by | Read by |
|---|---|---|---|
| `cbc_selected_branch_id` | numeric branch id, or string `"null"` for "All Branches" | `BranchSwitcherContext.setBranch()` | Same context on next mount |

Stale ids (e.g. branch was deleted, or user switched to a different client) are validated against the loaded branches list — if invalid, the default (own branch for main user / null for client admin) is used instead.

To reset: open DevTools → Application → Local Storage → delete `cbc_selected_branch_id`.

---

## 7. Security model

| Concern | How it's handled |
|---|---|
| User passes a `branch_id` belonging to another client | Backend validates `Branch::where('client_id', $user->client_id)->where('id', $branchId)->exists()` — invalid ids are silently dropped to `null` (no error leak) |
| Sub-branch user tries to view another branch via direct API call | Backend overrides `branchId = $user->branch_id` for any non-main `branch_user` regardless of what was sent |
| Frontend hides dropdown for sub-branch user | UI guard only — backend is the source of truth |
| Selected branch persists across logout | Cleared by `localStorage` survival, but backend re-validates on every request — safe |

---

## 8. Where the switcher appears in the UI

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  [IGC]  ☰   [Search...]              [Mumbai HQ ▼]  [⛶]  [🌙]  [🔔]  [👤 User]  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                          ↑
                                   Branch Switcher
                       (between search & fullscreen, right side)
```

On mobile (< 576px), only the icon shows — the branch name label is hidden via `hidden sm:inline`.

---

## 9. QA test plan

| # | Scenario | Expected |
|---|---|---|
| TC-01 | Main branch user logs in for first time | Dropdown shows their branch name (e.g. "Mumbai HQ"), NOT "All Branches" |
| TC-02 | Main branch user picks "Delhi Office" | Dashboard cards refresh — `total_branches=1`, `total_users` = users in Delhi only |
| TC-03 | Main branch user picks "All Branches" | `total_branches` = all client's branches; `total_users` = all users in client |
| TC-04 | Main branch user reloads page after picking "Delhi Office" | Dropdown still shows "Delhi Office" — selection persisted |
| TC-05 | Sub-branch user logs in | Sees a static label with their branch name (no dropdown caret) |
| TC-06 | Sub-branch user calls `/api/dashboard/client-stats?branch_id=999` directly via curl | Backend ignores the param; returns data scoped to their own branch_id |
| TC-07 | Client admin logs in | Dropdown shows "All Branches" by default |
| TC-08 | Super admin logs in | No switcher visible |
| TC-09 | Switcher dropdown closes on outside click | ✅ |
| TC-10 | User selects a branch, switches to a page that doesn't filter by branch (e.g. Plans) | Page works normally; selection retained for when they go back to Dashboard |
| TC-11 | Branch is deleted while user has it selected | On next load, selection silently falls back to own branch / "All" |
| TC-12 | View on mobile (≤576px) | Dropdown trigger shows only the building icon (label hidden) |

---

## 10. Setup / deploy checklist

- [ ] Pull latest code
- [ ] `composer install --no-dev --optimize-autoloader` (no new packages, but safe)
- [ ] **No migrations needed** — uses existing schema (`users.branch_id`, `branches.is_main`, `branches.client_id`)
- [ ] `npm run build` (or `npm run dev` for local)
- [ ] `php artisan config:clear && php artisan route:clear`
- [ ] Hard reload `cbc.idims.in` and verify dropdown appears in top bar

---

## 11. Not in scope yet (future enhancements)

| Feature | Notes |
|---|---|
| **Filter Payments page by branch** | Payments are subscription-level (per client) so a "branch payments" view doesn't currently make sense schema-wise. Would need a `branch_id` column on `payments` first. |
| **Filter Users list page by branch** | The Users page is a placeholder ("coming soon") — once it's built, plug `selectedBranchId` into its API call same as the dashboard. |
| **Filter Employees page** | Currently uses mock data; no API integration. |
| **Filter Permissions / Reports** | Not yet wired. |
| **Multiple-branch select (checkboxes instead of single radio)** | Would need backend to accept `branch_id[]=1&branch_id[]=2` and use `whereIn`. |
| **"Recently switched" history in dropdown** | Show last 3 picked branches at the top of the list. |

---

## 12. Quick reference card

```
LOCAL STORAGE:
  cbc_selected_branch_id    → "5" (branch id) | "null" (All Branches)

CONTEXT API (useBranchSwitcher()):
  branches            → Branch[]
  selectedBranchId    → number | null
  selectedBranch      → Branch | null
  isMainBranchUser    → boolean
  canSwitch           → boolean
  setBranch(id)       → updates state + localStorage

ENDPOINT:
  GET /api/dashboard/client-stats?branch_id=<id>
  Returns: counts/users/branches scoped by branch (when allowed)
           + filter.branch_id echo

USER TYPE → DEFAULT BRANCH:
  super_admin    → no switcher
  client_admin   → null ("All Branches")
  main branch    → user.branch_id (their own branch)
  sub branch     → user.branch_id (locked)
```

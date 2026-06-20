# Permissions Hierarchy & Menu Visibility — Reference Sheet

> How HR, Sales Matrix, CLM (and every other module) appear for an employee, and
> how the View / Add / Edit / Delete / Export / Import / Approve flags relate.
> Audience: QA + whoever grants access on the **Permissions** sheet.

_Last updated: 2026-06-04._

---

## 1. The seven flags

Every leaf module a user can be granted carries seven independent capabilities:

| Flag | Meaning |
|---|---|
| `can_view` | See the module in the menu **and** open its page (read-only) |
| `can_add` | Show the **Add / Create** button |
| `can_edit` | Show the **Edit / Update** button |
| `can_delete` | Show the **Delete** button |
| `can_export` | Show **Export** |
| `can_import` | Show **Import** |
| `can_approve` | Show **Approve** actions |

## 2. The core rule — **action implies view**

`can_view` is the baseline. **Granting any action automatically grants view.**

| You grant… | Result the user actually gets |
|---|---|
| View only | View only — no Add/Edit/Delete buttons |
| Edit | View **+** Edit (View auto-on, can't be removed while Edit is on) |
| Delete | View **+** Delete |
| Add | View **+** Add |
| Export / Import / Approve | View **+** that action |
| Edit + Delete | View **+** Edit **+** Delete |

Granting **View alone never adds** Add/Edit/Delete — view stays view-only.
The implication is **one-directional**: an action turns View on; turning View
off is only possible once every action on that row is cleared.

This is enforced in **three** places that stay in sync:

1. **UI** — `resources/js/components/PermissionMatrix.tsx`: ticking any action
   auto-ticks View and locks it (greyed, checked) with the tooltip
   _"View is required by Add / Edit / Delete / Export / Import / Approve."_
2. **API save** — `PermissionController::savePermissions()` forces
   `can_view = true` on any row that has an action flag before it is stored.
3. **Backfill** — migration
   `2026_06_04_000100_backfill_can_view_for_action_permissions` repaired all
   pre-existing rows once.

## 3. Menu & submenu visibility (HR / Sales Matrix / CLM)

All three modules are now gated **the same way** — there are no role-based
bypasses left:

- A top-level menu (HR, Sales Matrix, CLM) appears only if the user has
  `can_view` on **at least one leaf** under it.
- Each **submenu category** appears only if it has at least one viewable leaf;
  empty categories are dropped.
- Each **leaf link** appears only if the user has `can_view` on that leaf.

Because action ⇒ view (§2), granting an employee _Edit_ on, say, **HR → Employee**
is enough to make HR → Employee show up in their sidebar and open the page with
the Edit button — they no longer need a separate View tick.

Built in `resources/js/velzon/Layouts/LayoutMenuData.tsx`
(`hasAnyHrView` / `hasAnySalesView` / `hasAnyClmView` + the `build*SubItems`
helpers). Super-admin sees everything; an expired/missing plan hides all tenant
modules.

> **Behaviour change (2026-06-04):** CLM previously surfaced for **every**
> `branch_user` / `employee` regardless of grants (a rollout bypass). It now
> follows the Permissions sheet exactly, like HR and Sales. Employees who should
> keep CLM access must be granted at least one `clm.*` leaf.

## 4. Page-level button gating

Inside a page the flags map directly to buttons, e.g.
`user.permissions['sales.customers'].can_edit` shows the Edit button. A user
without `can_view` hits the page's "You don't have permission…" stop screen —
but since any action implies view, anyone with Edit/Delete/etc. always gets in.

## 5. Who can grant what (unchanged)

| Granter | Can assign to |
|---|---|
| super_admin | client_admin only |
| client_admin | branch_user only |
| branch_user | employees in their own branch |

A granter can never hand out a flag they don't hold themselves. Because View is
implied for the granter too, they can always delegate View alongside any action
they own.

## 6. Backend enforcement status (for QA expectations)

| Module group | API enforces flags? |
|---|---|
| Master data (50+ types) | ✅ Yes (`authorizeMaster`) |
| HR core / documents | ✅ Yes (controller `authorize`) |
| Sales Matrix | ⚠️ Menu/page gated on the frontend; API endpoints not yet flag-checked |
| CLM | ⚠️ Menu/page gated on the frontend; API endpoints not yet flag-checked |

So for Sales/CLM, hiding the menu is the current control; deep-linking the API
directly is not yet blocked server-side. Log that as a separate finding if it
matters for a given test.

## 7. Issues found & fixed (end-to-end audit, 2026-06-04)

| # | Issue | Fix |
|---|---|---|
| 1 | Flags fully independent — an "Edit-only" grant left `can_view=false`, so the module vanished from the menu **and** the page hard-stopped the user out. | Action ⇒ view, enforced in UI + API save + a one-time backfill (§2). |
| 2 | **CLM** menu surfaced for every `branch_user`/`employee` regardless of grants (rollout bypass). | Bypass removed — CLM follows the Permissions sheet like HR/Sales. |
| 3 | **"Leave Approvals" submenu could never appear** for any tenant user. Its module row (`hr.leave_approvals`) was missing: the seed migration creates it only if `hr.time_pay` exists, but that parent is created by a *seeder* that runs after `migrate`, so it bailed early on a fresh bootstrap. No module → not grantable → never shown. | Idempotent repair migration `2026_06_04_000200_ensure_hr_leave_approvals_module` re-creates the leaf (now id 148) and copies view perms from `hr.leave`. |

Verified after fixes: all 47 HR/Sales/CLM sidebar leaves resolve to a real
module (no dead menu entries), every permission writer keeps `can_view` implied,
and the frontend builds clean.

## 8. QA quick test

1. As a branch admin, open **HR → Employee → Permissions** for an employee.
2. Tick **only Edit** on `HR → Employee`. Note View auto-ticks and locks.
3. Save, log in as that employee → HR menu shows, Employee page opens, **Edit**
   button present, **Add/Delete** absent.
4. Repeat with **only View** → page opens read-only, no Edit/Add/Delete.
5. Grant a `clm.*` leaf → CLM menu appears; revoke all `clm.*` → CLM disappears.

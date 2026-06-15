# Sales Matrix — Permission & Visibility (QA Guide)

This guide explains, in plain language, **which leads each person can see** and **who they can
hand leads to** in the Sales Matrix — plus step-by-step **setup and test cases** so QA can verify it.

> One-line summary: the **Designation** decides a person's level, and one **permission toggle**
> can promote a Team Leader to distribute leads. Lead flow goes **HOD → Team Leader → Employee**.

---

## 1. Key terms (read first)

| Term | What it means |
|---|---|
| **Designation** | Set in **HR → Employees → edit → Designation**. The org level: Director/CEO, HOD, Team Leader, Executive, Employee, Intern/Trainee. |
| **HOD** | *Head of Department* — acts as the **Sales Manager** (top of Sales). |
| **Team Leader (TL)** | Leads a small team. Can distribute leads **only if given the permission**. |
| **Reporting Manager** | Set in HR → Employees. Makes an employee a "report" of their manager (this is how a TL's team is known). |
| **Distribute / Assign** | Giving a lead to someone (sets who owns it). Done via **Assign Leads / Lead Distribution / the row Assign icon** in My Workplace. |
| **The permission** | Permissions screen → **Sales Matrix → My Workplace → "can edit"**. This is the "can distribute leads" switch. |
| **Assigned lead** | A lead where the "Assigned To / Salesperson" is set to that person. |

---

## 2. Who sees what (Visibility)

| Person | Leads they see in My Workplace |
|---|---|
| Super Admin / Client Admin / **Branch Admin** (any `branch_user` login) | **All** leads in their scope |
| **HOD** (Sales Manager) | **All** sales leads in the branch |
| **Team Leader WITH the permission** | **Only the leads the HOD assigned to that TL** (not their team's, not all) |
| Team Leader WITHOUT the permission | Only leads assigned to them |
| Executive / Employee / Intern / Director-CEO | **Only leads assigned to them** |

✅ An empty list for a fresh Employee is **correct** — they only see leads once something is assigned to them.

---

## 3. Who can give leads to whom (Assignment chain)

**Assignment is FLAT — the visibility hierarchy does NOT restrict it.** Every level (Admin, Branch
Admin, HOD, Team Leader, Employee) can open Assign and hand a lead to **any Sales-department
employee**. The Assign picker shows the **same full list of Sales-department people for everyone**.

```
   EVERY level (Admin / HOD / TL / Employee) ──► ANY Sales-department employee
```

| Assigner | Can assign a lead to… |
|---|---|
| Everyone who can open Sales Matrix | **any Sales-department employee** (the full Sales list) |

**Department gate (the ONLY assignment restriction):** a lead can **only** be assigned to a
**Sales-department** member. People from other departments (e.g. Quality Control) and non-employee
accounts (e.g. the branch login) **never appear** in the Assign picker and are rejected by the server.

This is enforced **two ways**, so test both:
1. **The picker** lists **all Sales-department employees** (same for every logged-in user) — no
   other-department people, no branch-login account.
2. **The server** rejects a non-Sales target — if forced via API it returns **403**
   ("…to Sales-department members.").

> Note: this is **assignment** only. **Visibility** (which leads you actually SEE in your list) still
> follows the hierarchy in section 2 — HOD sees all, a TL/Employee sees only their own.

---

## 4. Setup for testing (do this once)

You need 3 test logins. As **Branch Admin** (or HOD), in **HR → Employees**:

1. **Create the HOD**
   - Designation = **Head of Department (HOD)**. Give them a login.
2. **Create a Team Leader**
   - Designation = **Team Leader**. Give them a login.
   - (For the delegated test) grant **Sales Matrix → My Workplace → can edit** on the Permissions screen.
3. **Create an Employee**
   - Designation = **Employee** (or Executive/Intern). Give them a login.
   - **Reporting Manager = the Team Leader** from step 2. ← important, this links them to the TL.
4. Make sure all three have **Sales Matrix → My Workplace → can view** so the menu appears.

> The Reporting-Manager link no longer affects **assignment** (the Assign picker shows all Sales
> employees to everyone). It still matters only as employee data. The `can edit` permission /
> Team-Leader designation now only affect what extra a TL can do, not the assign picker contents.

---

## 5. Test cases

| # | Logged in as | Action | Expected result |
|---|---|---|---|
| T1 | **HOD** | Open My Workplace | Sees **all** branch leads. Assign buttons **visible**. |
| T2 | **Any level** (HOD / TL / Employee / Branch Admin) | Open the Assign picker | Shows **all Sales-department employees** — the **same list for everyone**. No other-department people, no branch-login account. |
| T3 | **HOD** | Assign a lead to any Sales employee | Success. |
| T4 | **Employee** | Open Assign picker | Shows the **same full Sales-department list** (assignment is flat). |
| T5 | **Employee** | Assign their lead to another Sales employee | Success. |
| T6 | **Anyone** | Try to assign to a non-Sales person (e.g. Quality Control) via API | **403** ("…to Sales-department members."). Not in the picker either. |
| V1 | **HOD** | Open My Workplace | Sees **all** branch leads (visibility). |
| V2 | **Team Leader** | Open My Workplace | Sees **only the leads assigned to them** (not all, not the team's). |
| V3 | **Employee** (before anything assigned) | Open My Workplace | **Empty list** (correct). |
| V4 | **Employee** (after a lead is assigned to them) | Open My Workplace | That one lead appears. |
| V5 | **Branch Admin** | Open My Workplace | Sees **all** leads. |

Also verify the same scoping applies to **Sales Matrix → Quotation Vs PI History** (a person only
sees quotations/PIs for leads they're allowed to see).

---

## 6. "Is it a bug or expected?" quick reference

| You see… | Verdict |
|---|---|
| New Employee sees an empty lead list | ✅ Expected (nothing assigned yet) |
| The Assign picker shows the **same full Sales list** for an Employee as for the HOD | ✅ Expected (assignment is flat — everyone assigns to any Sales employee) |
| A lead leaves a person's list after they assign it to someone else | ✅ Expected (you only see leads assigned to you, unless HOD/admin) |
| Director/CEO sees only their own leads, not all | ✅ Expected (only **HOD** sees all) |
| An Employee sees **all** branch leads | ❌ **Bug** — check their Designation isn't HOD and they have no admin login |
| A non-Sales-department person (or the branch login) appears in the Assign picker | ❌ **Bug** — picker is Sales-department only |
| Assigning to a non-Sales-department person succeeds | ❌ **Bug** — server should return 403 |

---

## 7. Permissions vs Visibility (don't confuse them)

- **Permission (can view / can edit)** = the **door**. `can view` shows the Sales Matrix menu;
  `can edit` on My Workplace is the "can distribute" switch for a Team Leader.
- **Designation** = **how much they see** once inside.
- You need **both**: a person with the menu but the wrong designation will still be limited; a person
  with the right designation but no `can view` won't see the menu at all.

> ⚠️ **Primary Role and Secondary (Ancillary) Role do NOT affect the Sales Matrix.** They are
> ignored by the permission logic. Only **Designation** + the **My Workplace permission** matter.
> (Role may still appear in some summary/display screens, but it never changes what a user can see
> or assign.)

---

## 8. Technical reference (for developers)

- Core logic: [`app/Support/SalesVisibility.php`](app/Support/SalesVisibility.php) —
  `tier()` (`all` / `team` / `self`), `resolveScope()`, `canDistribute()`, `assignableUserIds()`.
- Distribute permission = `can_edit` on module slug **`sales.workplace`**.
- Reporting link read from `employees.reporting_manager_id` (fallback `reporting_manager_user_id`).
- Enforcement: [`SalesLeadController@assign`](app/Http/Controllers/Api/SalesLeadController.php),
  `@salespeople` (picker), `@index` (returns `can_distribute`); quotations/PIs via
  `SalesVisibility::applyToSalesDocs`.
- Lead activity (generate / assign / reassign) recorded in `lead_assignment_histories`
  ([`LeadActivity`](app/Support/LeadActivity.php)) — shown in the per-lead **Activity Tracker**.

*Update this guide whenever the rules in `SalesVisibility.php` change.*

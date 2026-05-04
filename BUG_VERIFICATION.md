# QA Bug Verification Report — 27 Apr 2026 batch

Verification of 21 bugs reported by QA. For each: REAL / NOT REAL / NEEDS RECREATION, with code evidence (file:line) and recommended fix scope.

**Reviewer:** Claude (code audit)
**Date:** 2026-04-27
**Bugs reviewed:** 21
**Real bugs confirmed:** 13
**Likely cache/refresh issue:** 2
**Design / feature requests:** 2
**Resolved already (false positive):** 1
**Needs recreation:** 3

---

## Verdict legend

| Symbol | Meaning |
|---|---|
| 🐞 | Real bug — confirmed in code, must fix |
| 🧊 | Cache/staleness issue — backend OK but frontend doesn't refresh |
| 🎨 | Design / spec / feature request — not a bug per se |
| ✅ | Already resolved in current code — false positive |
| ❓ | Cannot verify from code alone — needs reproduction with steps |

---

## Bug-by-bug verdict

### 🐞 BUG-01 — Client perm removed → branch perm should also be removed
**Verdict:** REAL (partial — depends on which "remove" you mean)

**Evidence:**
- [database/migrations/2026_04_14_000009_create_permissions_table.php:15-17](database/migrations/2026_04_14_000009_create_permissions_table.php#L15-L17) — `user_id` FK has `cascadeOnDelete()`, so **deleting the user** does cascade to permissions.
- [app/Http/Controllers/Api/PermissionController.php:138](app/Http/Controllers/Api/PermissionController.php#L138) — when client_admin saves their own permissions, it does NOT touch any branch user's permission rows. So if client admin's `master.warehouse` is removed, the branch users they previously granted it to **keep their access** until someone manually re-saves their perms.
- No background job or trigger to re-synchronize on grant-revocation.

**Fix scope:** When client_admin's permissions are saved, cascade-clear any flags they no longer own from all branch users in their client.

---

### 🧊 BUG-02 — View-only permission lets user add/update
**Verdict:** Most likely CACHE / STALE PERMISSIONS — backend code is correct

**Evidence:**
- [app/Http/Controllers/Api/MasterController.php:299-328](app/Http/Controllers/Api/MasterController.php#L299-L328) — `authorizeMaster()` correctly checks the SPECIFIC perm (`can_add` for store, `can_edit` for update, etc.). Non-super-admin without that flag gets 403.
- [resources/js/pages/master/MasterPage.tsx:53-60](resources/js/pages/master/MasterPage.tsx#L53-L60) — `caps.add/edit/delete` properly fall back to `false` if `modulePerm.can_*` is false. UI buttons correctly hidden.
- [resources/js/pages/master/MasterPage.tsx:681](resources/js/pages/master/MasterPage.tsx#L681) — Add button only renders if `caps.add`.

**So why does the bug appear?**
[resources/js/contexts/AuthContext.tsx:46-54](resources/js/contexts/AuthContext.tsx#L46-L54) caches `user.permissions` in localStorage (`cbc_user`). After a client_admin changes a branch_user's permissions, the branch_user's existing browser session still uses the **old** cached perms until they:
1. Log out and back in, OR
2. Trigger `/me` refresh (window focus event — line 86-93)

So if QA tested by changing perms then testing in the same already-open tab, they're seeing stale perms.

**Fix scope:** After `savePermissions` succeeds, force the target user's `/me` to refresh on their next request (server-side cache version), OR display a banner to the affected user "Your permissions changed — please log out and back in".

---

### 🎨 BUG-03 — View-only allows all actions; add+edit only hides master
**Verdict:** PART 1 = same as BUG-02 (cache). PART 2 = INTENTIONAL DESIGN.

**Evidence:**
- Part 1 ("view only allows all actions") → identical root cause to BUG-02 above.
- Part 2 ("add+edit without view → master not visible"):
  - [resources/js/pages/master/MasterPage.tsx:602](resources/js/pages/master/MasterPage.tsx#L602) — without `caps.view`, page shows "Access Denied"
  - Sidebar uses `can_view` to decide menu visibility too
  - **This is intentional**: how can you add a record to a list you can't see?

**Fix scope:** No code fix needed for part 2. UX decision: should the Permissions page warn users when granting add/edit without view? (e.g., auto-tick view when you tick add).

---

### 🐞 BUG-04 — Approval authority: scope already-used cannot be reused (CRITICAL)
**Verdict:** REAL — affects ALL masters with multi-field `uFields`

**Evidence:**
- [app/Http/Controllers/Api/MasterController.php:107](app/Http/Controllers/Api/MasterController.php#L107) — `'approval_authority'` has `'uFields' => ['role_name', 'module_scope']`
- [app/Http/Controllers/Api/MasterController.php:474-478](app/Http/Controllers/Api/MasterController.php#L474-L478) — for each uField, applies `Rule::unique($table, $field)` **individually**, not as a composite

```php
if (in_array($f['n'], $uFields, true)) {
    $rule = Rule::unique($table, $f['n']);  // each field unique on its own
    if ($id) $rule = $rule->ignore($id);
    $r[] = $rule;
}
```

**Concrete scenario:** Add `('Manager', 'Purchase Order')` → succeeds. Now try `('Director', 'Purchase Order')` → fails because `module_scope='Purchase Order'` is "already taken" — when really only the COMBO should be unique.

**Same bug also affects:**
- `advance_payment_rules` (uFields = `['vendor_type', 'procurement_cat']`)
- `exchange_rate_log` (`['currency_code', 'effective_date']`)
- `vendor_directory` (`['vendor_company_name', 'mobile_number']`)
- `rack_type_master`, `temp_class_master`, `freezers`

**Fix scope:** Change `validatePayload()` to apply composite-unique when `count($uFields) > 1`:
```php
$rule = Rule::unique($table, $uFields[0]);
foreach (array_slice($uFields, 1) as $other) {
    $rule->where($other, $request->input($other));
}
```

---

### 🐞 BUG-05 — Client form: paid plan type bypasses payment
**Verdict:** REAL

**Evidence:**
- [app/Http/Controllers/Api/ClientController.php:135](app/Http/Controllers/Api/ClientController.php#L135) — `'plan_type' => $request->plan_type ?? 'free'` — accepts `'paid'` directly with no payment validation
- [resources/js/pages/ClientForm.tsx:183-189](resources/js/pages/ClientForm.tsx#L183-L189) — frontend auto-syncs `plan_type` based on plan price; super admin form lets them save it

**However — secondary claim "shows permission to client user" is partially wrong:**
- Looking at ClientController.store (lines 65-191) — there's NO permission insertion. Client_admin user is created with NO permission rows.
- Permissions are only inserted via `SubscriptionController::activatePlan()` which fires from successful payment OR free-plan path.
- So a client created with `plan_type='paid'` directly has `client.plan_type='paid'` BUT the admin has zero module permissions until someone runs the subscribe flow.
- The client_admin would log in and see basically nothing usable.

**Fix scope:**
1. Block frontend selection of `plan_type='paid'` from the create-client form (only super admin can override, OR force a payment flow)
2. OR: when `plan_type='paid'` is set on creation, automatically grant default permissions and call `activatePlan()` server-side (but then payment is genuinely bypassed — risky)
3. Recommended: only allow `plan_type='free'` on initial client creation. Force client_admin to subscribe via Razorpay flow after first login.

---

### 🐞 BUG-06 — Deleted client email cannot be reused
**Verdict:** REAL

**Evidence:**
- [app/Http/Controllers/Api/ClientController.php:105](app/Http/Controllers/Api/ClientController.php#L105) — `'admin_email' => 'required|email|unique:users,email'` — Laravel's `unique` rule does NOT respect `deleted_at` automatically
- [app/Http/Controllers/Api/ClientController.php:283-295](app/Http/Controllers/Api/ClientController.php#L283-L295) — `destroy()` soft-deletes (User has SoftDeletes trait). The user row stays with email + `deleted_at IS NOT NULL`.
- Result: trying to recreate a client with the same admin email fails on validation because the soft-deleted user still owns that email.

**Fix scope:**
```php
'admin_email' => ['required', 'email', Rule::unique('users', 'email')->whereNull('deleted_at')],
```

Same pattern needed in `BranchController` line 110 (`user_email`), and in any `update()` paths.

---

### 🐞 BUG-07 — Inactive client → user can still login
**Verdict:** REAL

**Evidence:**
- [app/Http/Controllers/Api/AuthController.php:29-33](app/Http/Controllers/Api/AuthController.php#L29-L33) — only checks `$user->status !== 'active'`
- No check for `$user->client?->status` (so inactive/suspended client doesn't block login)
- Same gap in [`googleLogin()` at line 89-93](app/Http/Controllers/Api/AuthController.php#L89-L93)

**Fix scope:** Add right after the user.status check:
```php
if ($user->client_id && $user->client && $user->client->status !== 'active') {
    throw ValidationException::withMessages([
        'email' => ['Your organization is not active. Contact administrator.'],
    ]);
}
```

This single fix covers BUG-07, BUG-21 (suspended), and the client side of BUG-10.

---

### 🐞 BUG-08 — After plan UPDATE, doesn't redirect to list view
**Verdict:** REAL — clear bug, simple fix

**Evidence:**
- [resources/js/pages/AddPlan.tsx:95-102](resources/js/pages/AddPlan.tsx#L95-L102):
```ts
if (isEdit) {
    await api.put(`/plans/${editId}`, payload);
    toast.success('Plan Updated', `"${form.name}" updated successfully`);
    // ❌ no onBack() call — stays on form
} else {
    await api.post('/plans', payload);
    toast.success('Plan Created', `"${form.name}" created successfully`);
    setTimeout(() => onBack(), 1000);  // ✅ goes back to list
}
```

**Fix scope:** Move `setTimeout(() => onBack(), 1000);` after the toast in BOTH branches.

---

### ✅ BUG-09 — Branch duplicate email shows raw DB error
**Verdict:** ALREADY RESOLVED in current code

**Evidence:**
- [app/Http/Controllers/Api/BranchController.php:110](app/Http/Controllers/Api/BranchController.php#L110) — `'user_email' => ['required', 'email', Rule::unique('users', 'email')]` — Laravel validation catches duplicates BEFORE the SQL hits, returning HTTP 422 with `errors.user_email`
- [app/Http/Controllers/Api/BranchController.php:194-201](app/Http/Controllers/Api/BranchController.php#L194-L201) — defensive `try/catch` for `QueryException` with `isUniqueEmailViolation()` helper — wraps the DB error in a friendly `ValidationException`

**Either:**
- Bug was filed before this fix landed (commit history would tell), OR
- Frontend isn't displaying the 422 errors properly → check how BranchForm handles `err.response.data.errors`

**Action:** Verify with QA — try to recreate. If still showing raw DB error, the frontend toast handler is the actual bug. If it's friendly now, mark resolved.

Same as bug 6: the `unique:users,email` doesn't respect soft-delete, so the friendly message will trigger for recently-deleted branch users too. Fix per BUG-06.

---

### 🐞 BUG-10 — Inactive branch → user can still login
**Verdict:** REAL — same root cause as BUG-07

**Evidence:**
- Same as BUG-07: `AuthController.login()` doesn't check `$user->branch?->status`
- The "inactive user blocks login" half is correctly handled by the `user.status !== 'active'` check

**Fix scope:** Add to login (right after the client.status check from BUG-07 fix):
```php
if ($user->branch_id && $user->branch && $user->branch->status !== 'active') {
    throw ValidationException::withMessages([
        'email' => ['Your branch is not active. Contact administrator.'],
    ]);
}
```

---

### ✅ BUG-11 — Main branch login can see all branches of that user
**Verdict:** NOT A BUG — this is the BranchSwitcher feature we just shipped

**Evidence:**
- The main branch user dropdown in the top bar lets them switch between any branch in their client (or "All Branches"). This is the documented design from [BRANCH_SWITCHER.md](BRANCH_SWITCHER.md).
- Backend correctly scopes by `client_id` — no cross-client leakage (verified in [BRANCH_SWITCHER_AUDIT.md](BRANCH_SWITCHER_AUDIT.md) section 4).

**Action:** Confirm with QA whether the bug claim was about cross-client visibility (would be a real bug) or within-client visibility (intentional). If within-client = working as designed.

---

### ❓ BUG-12 — Failed payment entries not shown
**Verdict:** NEEDS RECREATION — code paths look correct

**Evidence (looks correct):**
- [app/Http/Controllers/Api/PaymentController.php:38-40](app/Http/Controllers/Api/PaymentController.php#L38-L40) — `index()` only filters by status if status query param is present. By default returns ALL statuses including failed.
- [resources/js/pages/Payments.tsx:55](resources/js/pages/Payments.tsx#L55) — `statusFilter` defaults to `''` (no filter)
- [resources/js/pages/Payments.tsx:43](resources/js/pages/Payments.tsx#L43) — `'failed'` is in `statusCfg` map (rendered with red badge)

**Likely causes:**
1. No failed payments exist in DB (historic data only had `status='success'` because old subscribe flow always succeeded)
2. Or the dashboard "Total Payments" stat that was checked excludes failed

**Action:** Force a failed payment via Razorpay test (`failure@razorpay`) → check if it shows up in Payments list. If yes → close bug. If no → the bug is real and needs deeper trace.

---

### 🐞 BUG-13 — Removing client perm cascades to its branch
**Verdict:** REAL — duplicate of BUG-01

**Action:** Same fix as BUG-01.

---

### ❓ BUG-14 — Client admin gives perm to branch → branch row not valid
**Verdict:** NEEDS RECREATION — claim is unclear

**Evidence:** This may be the same cache issue (BUG-02): the branch user has stale cached perms after client admin saves new ones. Without clearer steps it's hard to verify.

**Action:** Get exact reproduction steps from QA. Possibly:
- Step 1: Login as client_admin
- Step 2: Open Permissions, pick a branch user
- Step 3: Toggle some permissions
- Step 4: Save
- Step 5: ??? what shows as "not valid"?

---

### 🐞 BUG-15 — Dashboard/Profile permissions should be frozen as default
**Verdict:** REAL — UX gap

**Evidence:**
- [database/seeders/ModuleSeeder.php:15,24](database/seeders/ModuleSeeder.php#L15) — Dashboard & Profile seeded with `is_default => true`
- [app/Http/Controllers/Api/SubscriptionController.php:286-305](app/Http/Controllers/Api/SubscriptionController.php#L286-L305) — `activatePlan()` auto-grants ALL flags to `is_default` modules regardless of plan
- [resources/js/pages/Permissions.tsx:23](resources/js/pages/Permissions.tsx#L23) — `HIDDEN_SLUGS` does NOT include 'dashboard' or 'profile' → they appear in the matrix
- The matrix renders them as fully editable checkboxes, but the values are auto-granted on plan activate. So toggling them off is meaningless — they'll be re-granted next time the plan re-activates / refreshes.

**Fix scope:** In Permissions.tsx, render `is_default` modules with disabled checkboxes + a "Default — always granted" badge. Or hide them entirely.

---

### 🐞 BUG-16 — Same as 15, for client login view
**Verdict:** Same as BUG-15 — same code path, same fix.

---

### 🎨 BUG-17 — Branch login should show permission module to grant to its users
**Verdict:** FEATURE REQUEST — not currently supported

**Evidence:**
- [app/Http/Controllers/Api/PermissionController.php:47-58](app/Http/Controllers/Api/PermissionController.php#L47-L58) — `manageableUsers()` only returns users for super_admin (→ client_admins) and client_admin (→ branch_users). Branch users get an empty collection regardless of `is_main`.
- The Permissions page is hidden from branch users entirely via `HIDDEN_SLUGS` check + sidebar logic.

**Fix scope:** Allow main-branch users (`is_main = true`) to manage permissions for other users in their own branch only. Requires:
1. PermissionController changes: extend `manageableUsers()` and `savePermissions()` to authorize main-branch users
2. Sidebar: show "Permissions" entry for main-branch users
3. Each grantable permission must be ≤ what the main branch user themselves has

---

### 🐞 BUG-18 — Inactive client still selectable for permission grant
**Verdict:** REAL

**Evidence:**
- [app/Http/Controllers/Api/PermissionController.php:47-58](app/Http/Controllers/Api/PermissionController.php#L47-L58) — `manageableUsers()` returns users with `status` field but never filters by it
- [resources/js/pages/Permissions.tsx](resources/js/pages/Permissions.tsx) — dropdown renders all users; no disabled state for inactive ones

**Fix scope (one of):**
- Backend: `->where('status', 'active')` on `manageableUsers()` query — hides inactive completely
- Frontend: render inactive users in dropdown but disabled with "Inactive" badge — clearer for admin

---

### 🐞 BUG-19 — Same for inactive branch
**Verdict:** REAL — same as BUG-18

**Evidence:** When listing branch users for a client_admin, the branch's status is not checked. A branch_user in an `inactive` branch still appears in the picker.

**Fix scope:** Same as BUG-18 but joined with branch:
```php
->whereHas('branch', fn($q) => $q->where('status', 'active'))
```

---

### ❓ BUG-20 — Client dashboard total paid amount shown wrong
**Verdict:** NEEDS RECREATION — code calculation looks correct

**Evidence:**
- [app/Http/Controllers/Api/DashboardController.php:198](app/Http/Controllers/Api/DashboardController.php#L198) — `$totalPaid = (float) Payment::where('client_id', $clientId)->where('status', 'success')->sum('total');`
- This sums the `total` column (which includes GST) of all `success` payments scoped to the client
- Calculation appears correct

**Possible interpretations:**
- "Wrong" = should sum `amount` (without GST) instead of `total` (with GST)?
- "Wrong" = display formatting issue (₹100,000 vs ₹1,00,000)?
- "Wrong" = should be branch-scoped (after my BranchSwitcher work, total_paid stays client-level — see BRANCH_SWITCHER.md section 4)?

**Action:** Get from QA: expected value vs actual value, with a screenshot. Then I can pinpoint which calculation is off.

---

### 🐞 BUG-21 — Suspended organization → user can still login
**Verdict:** REAL — same root cause as BUG-07

**Evidence:** `AuthController.login()` only checks user.status. Client.status='suspended' doesn't block login.

**Action:** Single fix from BUG-07 covers this — any non-`active` client status will block.

---

## Summary table

| # | Description | Verdict | Fix complexity |
|---|---|---|---|
| 1 | Client perm cascade to branch | 🐞 REAL | High (cascade logic) |
| 2 | View-only allows add | 🧊 cache | Low (force /me refresh) |
| 3 | View+edit no view = invisible | 🎨 partly intent / 🧊 partly cache | Low |
| 4 | Approval authority unique constraint | 🐞 REAL CRITICAL | Low (validatePayload fix) |
| 5 | Paid plan bypasses payment | 🐞 REAL | Medium |
| 6 | Deleted client email reuse | 🐞 REAL | Low (whereNull deleted_at) |
| 7 | Inactive client login | 🐞 REAL | Low (one if statement) |
| 8 | Plan update no redirect | 🐞 REAL | Trivial (1 line) |
| 9 | Branch duplicate email DB error | ✅ resolved (verify FE) | None or low |
| 10 | Inactive branch login | 🐞 REAL | Low (covered by 7's fix pattern) |
| 11 | Main branch sees all branches | ✅ feature delivered | None |
| 12 | Failed payments not shown | ❓ needs recreation | Unknown |
| 13 | Client perm cascade (dup of 1) | 🐞 REAL | (covered by 1) |
| 14 | Branch row not valid after grant | ❓ needs recreation | Unknown |
| 15 | Default modules not frozen | 🐞 REAL | Low (UI badge + disable) |
| 16 | Same as 15 for client | 🐞 REAL (same fix) | (covered by 15) |
| 17 | Branch login can grant perms | 🎨 feature request | Medium-High |
| 18 | Inactive client in grant dropdown | 🐞 REAL | Low (filter or disable) |
| 19 | Inactive branch in grant dropdown | 🐞 REAL | Low |
| 20 | Total paid amount wrong | ❓ needs recreation | Unknown |
| 21 | Suspended org login | 🐞 REAL (covered by 7) | (covered by 7) |

---

## Recommended fix order (by impact / effort)

### Quick wins (< 1 hour each)
1. **BUG-08** — Add `setTimeout(onBack, 1000)` to plan UPDATE branch (1 line)
2. **BUG-07 + BUG-10 + BUG-21** — Add 2 if-checks to AuthController.login() and googleLogin() (covers 3 bugs in one PR)
3. **BUG-06** — Add `whereNull('deleted_at')` to admin_email + user_email unique rules (2 lines)
4. **BUG-04** — Composite unique check in MasterController.validatePayload() (~10 lines)
5. **BUG-18 + BUG-19** — Filter or disable inactive users/branches in PermissionController.manageableUsers (~5 lines)

### Medium effort (1-3 hours)
6. **BUG-15 + BUG-16** — Mark `is_default` modules as frozen in Permissions UI
7. **BUG-05** — Force payment-first flow OR restrict client form to free plans

### Higher effort (multi-PR)
8. **BUG-01 + BUG-13** — Cascade-clear branch user perms when client admin loses a flag
9. **BUG-02** — Force-refresh affected user's session after savePermissions
10. **BUG-17** — Allow main-branch user to manage their branch users' perms

### Need clarification first
11. **BUG-09** — Verify whether frontend toast renders 422 errors correctly
12. **BUG-12** — Reproduce with a real failed payment (Razorpay `failure@razorpay`)
13. **BUG-14** — Get exact steps from QA
14. **BUG-20** — Get expected vs actual value from QA

---

## Final answer to your question

Out of 21 reported bugs:
- **13 are REAL bugs** with code-level evidence — must fix before production-confidence (BUG-01, 04, 05, 06, 07, 08, 10, 13, 15, 16, 18, 19, 21)
- **2 are likely CACHE issues** (BUG-02, BUG-03 part 1) — backend correct, frontend stale; needs auto-refresh logic
- **2 are FEATURE REQUESTS / DESIGN** (BUG-03 part 2, BUG-17) — current behavior is intentional; user wants different
- **1 is RESOLVED** in current code (BUG-09) — needs frontend verification
- **1 is the FEATURE WE JUST SHIPPED** (BUG-11) — confirmed working as designed
- **3 NEED RECREATION** before they can be confirmed (BUG-12, 14, 20) — code looks fine, need user to provide exact steps

Want me to start fixing these in the order above? **BUG-08, BUG-07/10/21, BUG-06, BUG-04, BUG-18/19** can all be done in one focused pass — that knocks out 8 of the 13 real bugs in maybe an hour.

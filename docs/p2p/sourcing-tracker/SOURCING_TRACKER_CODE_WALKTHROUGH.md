# P2P SOURCING MANAGEMENT TRACKER

## Code Walkthrough

**Module:** P2P Sourcing Management Tracker  
**Menu Path:** Procure to Pay (P2P) → Procurement Management → Sourcing Management Tracker  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**Document Type:** Code Walkthrough  

---

## CONTENTS

1. Introduction
2. Project File Structure
3. API Routing and Access
4. Common Conventions
5. Feature 1 — Open the Page and the List
6. Feature 2 — The Assign To List
7. Feature 3 — Create a Sourcing Target
8. Feature 4 — Edit a Sourcing Target
9. Feature 5 — Product Clarity (Text, Link, PDF)
10. Feature 6 — Sourcing Target Report and Product List
11. Feature 7 — Map Supplier from the Supplier Master
12. Feature 8 — Map a New Supplier
13. Feature 9 — Edit a Mapped Supplier
14. Feature 10 — The Mapped Suppliers Popup
15. Feature 11 — Convert a New Supplier to the Supplier Master
16. Feature 12 — Product Status and Target Progress
17. Pricing Engine — `SupplierPricing`
18. Design Patterns Used
19. Troubleshooting Guide
20. Complete Flow Summary

---

## 1. INTRODUCTION

### 1.1 Purpose

This document is the guided tour of the code. For every feature it shows:
**which screen → which component and function → which API → which backend
method → which database tables → what comes back → what the screen does next.**

Read the Functional document first (what the module does for the user) and the
Technical document (architecture and data model). This document connects the two.

### 1.2 How to read the references

* Code is referenced by **file, function, component or constant name**. Search
  for the name. Line numbers are not given, because they change with every edit
  (most backend comments were removed on 23-Nov-2026).
* **SC** = `SourcingController` (`app/Http/Controllers/Api/P2p/SourcingController.php`).
* Verified against the code up to commit `6170fa175` (prices capped at the
  server's limits; Map Supplier dropdowns keep the field's width), which
  includes `bf7dad2ed` (all departments, self-assign, Convert links early,
  Converted badge).

### 1.3 Module in one picture

```
Sourcing Target (ST-001)                     p2p_sourcing_targets
  └─ Products (master or manual)             p2p_sourcing_products
       └─ Mapped Suppliers                   p2p_sourcing_product_suppliers
            ├─ Supplier Master supplier      → vendors
            └─ New Supplier                  → p2p_suppliers  ──Convert──►  vendors
```

---

## 2. PROJECT FILE STRUCTURE

### 2.1 Backend Files

| File | Responsibility |
|---|---|
| `app/Http/Controllers/Api/P2p/SourcingController.php` (1432 lines) | **The whole module API**: list, create / edit target, report, products, team members, masters, upload, mapping, pricing, Convert |
| `app/Http/Controllers/Api/VendorController.php` → `storeContacts()` | The Supplier wizard's Contacts step. When `convert_supplier_id` is sent it **links** a New Supplier to the new vendor (moves its mappings) |
| `app/Support/SupplierPricing.php` (153 lines) | Domestic / international price arithmetic, `vsTarget()`, `assertFits()`, and the caps `MAX_PRICE`, `MAX_RATE`, `MAX_AMOUNT` |
| `app/Models/P2p/SourcingTarget.php` | Model for `p2p_sourcing_targets` |
| `app/Models/P2p/SourcingProduct.php` | Model for `p2p_sourcing_products` |
| `app/Models/P2p/SourcingProductSupplier.php` | Model for `p2p_sourcing_product_suppliers` |
| `app/Models/P2p/Supplier.php` (`P2pSupplier`) | The New Supplier directory (`p2p_suppliers`), with the unique-email hook |
| `app/Support/Concerns/EnforcesUniqueEmail.php` · `app/Support/EmailGuard.php` · `config/email_uniqueness.php` | System-wide duplicate-email check (`vendor` scope: `vendors.primary_email` + `p2p_suppliers.email`) |
| `app/Support/MasterVisibility.php` | Read scope for masters (currencies, countries) |
| `app/Models/Vendor.php` | `Vendor::scopeForUser()` (who sees which Supplier Master record); `Vendor::$convertingSupplierId` and `sameEmailOwnerRows()` used by Convert |

### 2.2 Frontend Files

All under `resources/js/pages/p2p/procurement-management/sourcing-tracker/`.

**Page**

| File | Responsibility |
|---|---|
| `SourcingTracker.tsx` (636 lines) | The page: tabs, search, list, pager, row. Owns every popup's open state. Runs Convert (`startConvert`, `finishConvert`, `closeConvert`) |

**Popups**

| File | Responsibility |
|---|---|
| `AssignTargetModal.tsx` (797) | Create / edit a sourcing target |
| `SourcingTargetReport.tsx` (219) | The Sourcing Target Report |
| `ProductList.tsx` (161) | Read-only product list |
| `MappedSuppliers.tsx` (360) | Supplier cards, Edit, Convert button, Converted badge |
| `MapSupplierModal.tsx` (215) | The Map Supplier steps (Master / New → Domestic / International → form) and the save |
| `ClarityDialog.tsx` (152) · `ClarityNoteView.tsx` (39) | Write a clarity · read a text clarity |

**Forms and pieces inside popups**

| File | Responsibility |
|---|---|
| `SupplierTypeChooser.tsx` (69) | The Domestic / International cards |
| `SupplierMasterForm.tsx` (346) | Pick a Supplier Master supplier and enter its price |
| `NewSupplierForm.tsx` (445) | Register a New Supplier and its quote |
| `ClarityChip.tsx` (68) | Shows a product's clarity (Text note / Open link / View PDF) |
| `AttachPicker.tsx` (120) · `AttachedFiles.tsx` (47) | Upload file / Take photo menu · the picked-file list (View / Remove) |

**Helpers**

| File | Responsibility |
|---|---|
| `data.ts` (119) | Types, `fromApi()`, `progressOf()`, `tatState()`, `todayIso()` |
| `targetProducts.ts` (98) | `useTargetReport()`, `productProgress()`, `viewDocument()` |
| `formMasters.ts` (71) | `useFormMasters()` (cached `/p2p/form-masters`), `rateOf`, `stateCodeOf`, `gstTypeFor`, `indianStates`, `overseasCountries` |
| `popupHooks.ts` (143) | `usePopup()` (Esc stack, scroll lock, focus), `useFitRows()` |
| `useSaveGuard.ts` (35) | One save at a time (blocks double clicks) |
| `upload.ts` (18) | `uploadP2pFile()` — multipart upload |
| `apiError.ts` (11) | `apiErrorMessage()`, `apiFieldErrors()` |
| `format.ts` (43) | `dmy()`, `initials()`, `inr()`, and the typing caps `limitNum()` with `PRICE_INT 10`, `PRICE_DEC 2`, `RATE_INT 5`, `RATE_DEC 4` |
| `currency.ts` (21) | `COUNTRY_CURRENCY` (browser suggestion map), `money()` |
| `icons.tsx` (42) · `ClipText.tsx` (15) | Icons · one-line clipped text with tooltip |

**CSS** — each file has its own prefix (`sct-`, `sta-`, `stsrc-`, `str-`, `stpl-`,
`stsv-`, `stmap-`, `stnf-`, `stsm-`, `stfile-`). Never reuse `bulk-sourcing.css`
class names; that file is global.

### 2.3 Shared Components Used

| Component | From | Used for |
|---|---|---|
| `MasterSelect` | `components/ui/MasterSelect` | Assign To, Supplier Name, and all New Supplier dropdowns |
| `MasterDatePicker` | `components/ui/MasterDatePicker` | Sourcing TAT, Price Valid Till |
| `Tooltip` | `components/ui/Tooltip` | Disabled-button reasons, clipped text |
| `TruncText` | `components/ui/TruncText` | Product names cut at 30 characters in the target form |
| `lazyPage` | `utils/lazyPage` | How `SupplierMasterForm.tsx` loads `AddVendorModal` for "+" |
| `FitTip` | `purchase-management/order/create-po/form-fields` | Target price cells — tooltip only when the text is cut |
| `WorklistPager` · `useFitPageSize` | `components/ui/WorklistPager` · `hooks/useFitPageSize` | List pager; rows that fit the screen (at least 4) |
| `Shimmer` · `FullPageLoader` | `components/ui/` | Loading states |
| `useToast` · `useAuth` | `contexts/ToastContext` · `contexts/AuthContext` | Toasts; the logged-in user's id |
| `AddVendorModal` | `p2p-master-management/supplier-management/AddVendorModal` | The full Add Supplier wizard ("+" in Supplier Master form, and Convert) |
| `CameraCaptureModal` | `purchase-management/order/physical-inspection/CameraCaptureModal` | Take photo (clarity, business card) |
| `api` | `resources/js/api` | Axios instance with the Sanctum token |

---

## 3. API ROUTING AND ACCESS

### 3.1 Backend Routes

`routes/api.php`, inside the `auth:sanctum` · `user.active` · `tenant` group:

```php
// Masters and lookups
Route::get   ('/p2p/products',      [SourcingController::class, 'products']);
Route::get   ('/p2p/team-members',  [SourcingController::class, 'teamMembers']);
Route::get   ('/p2p/suppliers',     [SourcingController::class, 'suppliers']);
Route::get   ('/p2p/form-masters',  [SourcingController::class, 'formMasters']);

// New Supplier directory and Convert
Route::get   ('/p2p/new-suppliers', [SourcingController::class, 'newSuppliers']);                         // not used by the screen
Route::get   ('/p2p/new-suppliers/{supplier}/sourcings', [SourcingController::class, 'supplierSourcings']); // not used by the screen
Route::get   ('/p2p/new-suppliers/{supplier}/convert',   [SourcingController::class, 'convertPrefill']);
Route::post  ('/p2p/new-suppliers/{supplier}/convert',   [SourcingController::class, 'convertSupplier']);

// Files
Route::post  ('/p2p/upload',           [SourcingController::class, 'upload']);
Route::get   ('/p2p/clarity/download', [SourcingController::class, 'downloadClarity']);

// Sourcing targets
Route::get   ('/p2p/sourcing-targets',           [SourcingController::class, 'index']);
Route::get   ('/p2p/sourcing-targets/next-code', [SourcingController::class, 'nextCode']);
Route::post  ('/p2p/sourcing-targets',           [SourcingController::class, 'store']);
Route::get   ('/p2p/sourcing-targets/{target}',  [SourcingController::class, 'show']);
Route::put   ('/p2p/sourcing-targets/{target}',  [SourcingController::class, 'update']);
Route::get   ('/p2p/sourcing-targets/{target}/report', [SourcingController::class, 'report']);

// Products of a target
Route::patch ('/p2p/sourcing-targets/{target}/products/{product}/status',  [SourcingController::class, 'setProductStatus']);     // not used by the screen
Route::put   ('/p2p/sourcing-targets/{target}/products/{product}/clarity', [SourcingController::class, 'updateProductClarity']); // Bulk Sourcing only

// Suppliers of a product
Route::get   ('/p2p/sourcing-targets/{target}/products/{product}/suppliers', [SourcingController::class, 'mappedSuppliers']);
Route::post  ('/p2p/sourcing-targets/{target}/products/{product}/suppliers', [SourcingController::class, 'mapSupplier']);
Route::put   ('/p2p/sourcing-targets/{target}/products/{product}/suppliers/{supplier}',       [SourcingController::class, 'updateSupplier']);
Route::patch ('/p2p/sourcing-targets/{target}/products/{product}/suppliers/{supplier}/price', [SourcingController::class, 'updateSupplierPrice']);

// Supplier wizard (Supplier Management) — used by Convert
Route::put   ('/vendors/{id}/step/contacts', [VendorController::class, 'storeContacts']);  // sent as POST + _method=PUT
```

`{product}` and `{supplier}` are numeric (`whereNumber`). `{target}` is the
target code, e.g. `ST-004`.

### 3.2 Frontend Route and Menu

| Item | Value |
|---|---|
| URL | `/p2p/sourcing-tracker` |
| Registered in | `App.tsx` → `lazyPage(SourcingTracker)` |
| Access check | `utils/routeAccess.ts` maps the URL to the permission `p2p.sourcing_tracker` |
| Who gets in | A **branch user** or an **employee** who has `p2p.sourcing_tracker.can_view` (`canAccessPath()`: `isBiz && leaf('p2p.sourcing_tracker')` — branch users need the permission too). Super admin and client admin are not let in |

### 3.3 Who Can Do What (server checks)

| Check (in SC) | Who passes | Used by | Refusal |
|---|---|---|---|
| `viewDenial()` | super admin, client admin, creator, assignee | `show()`, `report()`, `mappedSuppliers()`, `setProductStatus()`, `updateProductClarity()` | 403 *Only the creator, the assignee or the client admin can open this sourcing target.* |
| creator check in `update()` | creator only | Edit target | 403 *Only the creator can edit this sourcing target.* |
| `canMapSuppliers()` | assignee, creator, super admin (**not** client admin) | `mapSupplier()`, `updateSupplier()`, `updateSupplierPrice()` | 403 *Only the creator or the assignee of this sourcing target can map suppliers.* (wording differs per action) |
| `assigneeIsActive()` | target whose assignee is active | Edit target (also fills `show()`'s `assigneeActive` flag) | 403 *…it is view-only and can't be edited.* |
| none | anyone in the client | `index()`, `store()`, Convert | — |

```php
private function canMapSuppliers($t, $user): bool
{
    return (int) $t->assignee_id === (int) $user->id
        || (int) $t->created_by === (int) $user->id
        || $user->user_type === 'super_admin';
}
```

---

## 4. COMMON CONVENTIONS

### 4.1 Request and Response Shapes

| Case | Shape |
|---|---|
| Success (SC) | `{ "status": true, "data": … }` |
| Refusal written by SC | `{ "status": false, "message": "…" }` — the 403s and the 422s SC writes by hand (e.g. *already mapped*, *has suppliers mapped*) |
| Not found (`abort(404)`) | `{ "message": "…" }` (no `status` key) — e.g. *Sourcing target not found.*, *Product not found in this sourcing target.* The upload's bad-extension 422 is `{ message, errors }` |
| Laravel validation failure | 422 `{ "message": "…", "errors": { "field": ["msg"] } }` |
| Not logged in / inactive | 401 *Unauthenticated.* / 401 *Account is no longer active. Please sign in again.* |

### 4.2 How the Frontend Handles Errors

```ts
// apiError.ts
apiErrorMessage(e)   // the server's message, for the toast
apiFieldErrors(e)    // the 422 errors object, mapped to form fields
```

Every save shows field errors under the fields it knows, and the message in a
toast (*Assign failed*, *Update failed*, *Supplier not mapped*, *Supplier not
updated*).

### 4.3 How the Page Is Wired

```
/p2p/sourcing-tracker  →  App.tsx lazyPage(SourcingTracker)
  └─ SourcingTracker()
       ├─ state: sub tab ('all'), page, pageSize (useFitPageSize, min 4), query → q
       ├─ fetch: GET /p2p/sourcing-targets?tab&page&per_page&q
       ├─ rows → fromApi() (data.ts) → progressOf(), tatState()
       └─ popup state: assignOpen / editing, productsRow, reportRow, mapTarget, converting
            (the Mapped Suppliers popup is owned by SourcingTargetReport)
```

---

## 5. FEATURE 1 — OPEN THE PAGE AND THE LIST

### 5.1 Overview

The list shows the targets the user **created** or is **assigned** to, with
three sub-tabs, a search box and a pager.

### 5.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `SourcingTracker.tsx` → `SourcingTracker()`, `switchSub()`, `TargetRow`, `SkeletonRows` |
| Helpers | `data.ts` → `fromApi()`, `progressOf()`, `tatState()` |
| API | `GET /p2p/sourcing-targets` |
| Backend | `SC::index()` → `SC::trackerList()` → `SC::row()` |

### 5.3 Step-by-Step Flow

**Step 1 — Open the menu**
* Menu **P2P → Procurement Management → Sourcing Management Tracker**.
* `routeAccess.ts` checks `p2p.sourcing_tracker.can_view`.

**Step 2 — Shimmer rows**
* `SkeletonRows` shows as many shimmer rows as the fitted page size.

**Step 3 — Load the list**
* API: `GET /api/p2p/sourcing-targets?tab=all&page=1&per_page=8&q=30/11/2026`
* `q` is left out when the search is empty. `per_page` is the fitted size until the user picks 10 / 25 / 50.

**Step 4 — Show rows and counts**
* `fromApi()` maps each row; `TargetRow` draws it.
* `counts` fill the three sub-tab badges and the main tab badge. `booted` keeps the badges at 0 until the first answer.

**Step 5 — User actions**
* Switch **All / Created by Me / Assigned to Me** → `switchSub()` → page 1, search cleared.
* Type in the search → sent 300 ms after typing stops (`SEARCH_DEBOUNCE_MS`), back to page 1.
* Change page or rows per page.

### 5.4 Fetch Logic (browser)

```
300 ms search debounce · 120 ms coalescing
reqSeq          → a late answer of an older request is dropped
shownFor        → 'tab|q|reloadKey|page' of the rows on screen
                  same key (only per_page changed) + rows showing → no shimmer, rows swapped in place  (CS-2215)
lastServed      → skips the request when page 1 already held every row and the page size only grew
server clamped the page → setPage(served)
```

**Processing Explanation:**
1. Changing only the page size does not blink the table to the shimmer.
2. Fast typing sends one request, not one per key.
3. An old slow answer can never overwrite a newer one.

### 5.5 Backend Processing — `SC::trackerList()`

```
load ALL client targets, latest(), with products (+ suppliers_count)
tab:  created  = created_by == me
      assigned = assignee_id == me
      all      = created ∪ assigned, unique('id'), sortByDesc('id')     ← done in PHP
q:    mb_strtolower(trim(q)), str_contains over the row text
page: slice in PHP, page = min(page, last)
return { rows: row()[], counts: {all, created, assigned}, pagination }
```

**Searched text:** code, `source`, every `sources` label, creator name, assignee
name, `progressStatus` (*In Progress* / *Completed*), the word *overdue* (only
when overdue), all product names, and the **due** date as `Y-m-d` and `d/m/Y`.

**What `row()` computes for each target:**

```php
sources         = distinct product.source → labels (fallback: target.source)
done            = products with status 'Completed'
progress        = round(done * 100 / total)
overdue         = !complete && due_date->endOfDay()->isPast()
mappedSuppliers = Σ suppliers_count
firstProduct    = product with the lowest id
```

### 5.6 Validation (server)

| Param | Rule | Failure |
|---|---|---|
| `tab` | `required\|in:all,created,assigned` | 422 |
| `q` | `nullable\|string\|max:100` | 422 → the screen shows *Couldn't load sourcing targets* |
| `status` | `nullable\|in:In Progress,Completed,Overdue` | 422 (the screen never sends it) |
| `page` | `nullable\|integer\|min:1` | 422 |
| `per_page` | `nullable\|integer\|min:1\|max:200` (default 10) | 422 |

`SC::index()` has **no** permission check. A user without a `client_id` gets an
empty 200 answer.

### 5.7 Database

| Read | Written |
|---|---|
| `p2p_sourcing_targets` (`client_id`, `code`, `source`, `start_date`, `due_date`, `assignee_id`, `assignee_name`, `created_by`, `created_by_name`; soft-deleted excluded) · `p2p_sourcing_products` (`id`, `sourcing_target_id`, `status`, `source`, `name`) · `COUNT` of `p2p_sourcing_product_suppliers` per product | nothing |

### 5.8 Response

```json
{ "status": true, "data": {
  "rows": [ { "id": "ST-004", "source": "Product Master", "sources": ["Product Master", "Manual Entry"],
              "start": "2026-11-20", "due": "2026-11-30", "createdBy": "Asha", "createdById": "7",
              "assignee": "Ravi", "assigneeId": "42", "products": 3, "completed": 1, "overdue": false,
              "firstProduct": "Bolt M8", "moreProducts": 2, "pending": 2, "progress": 33,
              "progressPercent": "33%", "totalProducts": 3, "completedProducts": 1,
              "mappedSuppliers": 5, "progressStatus": "In Progress" } ],
  "counts": { "all": 12, "created": 7, "assigned": 5 },
  "pagination": { "page": 1, "per_page": 8, "total": 12, "last_page": 2 } } }
```

### 5.9 Row Logic in the Browser

```ts
progressOf(row)  → done / total / percent / status
tatState(row)    → complete ? 'ontrack'
                 : row.overdue ? 'overdue'                // server flag
                 : daysLeft(today, due) <= 7 ? 'atrisk'   // browser date
                 : 'ontrack'

canEdit = row.createdById === me                          // Edit pencil
canMap  = row.assigneeId === me || row.createdById === me // passed to the report
```

### 5.10 Screen States

| State | Text |
|---|---|
| Error (any status) | *Couldn't load sourcing targets — Check your connection and try again.* + **Retry** (`reload()` bumps `reloadKey`) |
| Empty | *No sourcing targets yet* |
| Empty search | *No results found — Try a different search term.* |

### 5.11 Edge Cases and Known Gaps

* A search for `0` is ignored (falsy check).
* More than 100 characters → error state, not a message.
* Only *In Progress*, *Completed* and *overdue* are searchable status words; *at risk* / *on track* and the start date are not.
* `counts` ignore the search.
* "All" = created ∪ assigned, not the whole company.
* Every target and product of the client is loaded and filtered in PHP on every request.
* The RFQ tab and **Create RFQ** are frozen; the RFQ badge is the constant `RFQ_COUNT = 129`.

---

## 6. FEATURE 2 — THE ASSIGN TO LIST

### 6.1 Overview

The **Assign To** dropdown in the Add form lists the people a target can be
assigned to. Any department is allowed, and the creator can assign to
themselves (`bf7dad2ed`).

### 6.2 Files Involved

| Layer | File · Function |
|---|---|
| Form | `AssignTargetModal.tsx` → mount `useEffect`, `memberOptions` |
| API | `GET /p2p/team-members` |
| Backend | `SC::teamMembers()`; re-check on save: `SC::assigneeAllowed()`, `SC::resolveAssignee()` |

### 6.3 Step-by-Step Flow

**Step 1 — Load** — **Assign Sourcing Target** → `AssignTargetModal` mounts → `GET /p2p/team-members`. Loaded only on **Add**; on Edit the field is locked (*Fixed*).

**Step 2 — Open the list** — `MasterSelect`; a search box (*Search people…*) appears when there are more than 6 people.

**Step 3 — Each row** — employee-code chip (`EMP-001`), *"Name · Role"* (own row *"Name (You) · Role"*), department as a violet badge (in the open list only). Nothing is disabled.

**Step 4 — After picking** — the field shows *"EMP-001 · Name"* (or just the name when there is no code).

### 6.4 Backend Processing — `SC::teamMembers()`

**Query 1 — eligible employees** (`employees`, soft-deleted excluded):

```
client_id = caller's client
LOWER(status) = 'active'
onboarding_stage_completed >= 6
user_id IS NOT NULL
with designation (master_designations.name), department (master_departments.name), emp_code
```

**Query 2 — users** (`users`):

```
client_id = caller's client
AND ( id IN (eligible employees' user_id)
      OR user_type = 'branch_user'
      OR id = caller )                       ← the creator, so self-assign works
AND LOWER(status) = 'active'
AND branch_id = caller's branch_id           (when the caller has one; else ?branch_id if sent; else no filter)
AND user_type <> 'super_admin'
ORDER BY name
```

**Processing Explanation:**
1. The employee's own branch is **not** checked — only the linked user's branch (Query 2).
2. There is **no department filter**.
3. Branch users and the caller are always included, even without an employee record.

### 6.5 Row Shape

| Field | Value |
|---|---|
| `id` | `users.id` as a string |
| `name` | `users.name` |
| `code` | the eligible employee's `emp_code`, else `null` |
| `department` | the employee's department; else **`Branch Admin`** for a branch user; else `null` (no badge) |
| `role` | the employee's designation; else `users.designation`; else the user type in words (*Branch User*, *Employee*) |

**Examples**

| Person | Shows as |
|---|---|
| Onboarded Purchase employee | chip `EMP-001`, *"Ravi · Purchase Executive"*, badge *Purchase* |
| Branch user, no employee record | no chip, *"Asha · Branch User"*, badge *Branch Admin* |
| Creator whose onboarding is not finished | *"Meera (You) · Employee"*, no chip, no badge |

**Not listed:** inactive users; users of another branch (when the caller has a
branch); super admins; employees with onboarding stage below 6 or an inactive
employee record (unless branch user or caller); client admins / client users who
are not eligible employees (unless caller).

### 6.6 Validation

| Where | Rule | Message |
|---|---|---|
| Browser (Add) | an assignee is picked | *Assign this target to a team member* |
| Server | `assignee_id` `required` | *Assign this sourcing target to a team member before saving.* |
| Server | `assigneeAllowed()`: a `users` row in the **same client**, not super admin, active | 422 `errors.assignee_id` *Pick an active team member of your company to assign this sourcing target.* |

`assigneeAllowed()` does **not** re-check the branch, onboarding stage, employee
status or department. The saved name is `users.name` (`resolveAssignee()`).

### 6.7 Database

| Read | Written |
|---|---|
| `employees`, `master_designations`, `master_departments`, `users` | nothing |

### 6.8 Response and UI

`{ "status": true, "data": [ {…} ] }` → `memberOptions` (`value` = id, `code`
chip, `label`, `selectedLabel`, `badge: { text: department, tone: 'violet', listOnly: true }`).

* Load failure → toast *Team not loaded — The Assign To list could not be loaded.*
* Empty list → placeholder *No team members available*.

### 6.9 Edge Cases and Known Gaps

* Two people with the same name are told apart only by the code chip and role.
* The server accepts any active non-super-admin user of the client, so an API caller can assign someone the list would not show.
* The list is read once when the form opens.

---

## 7. FEATURE 3 — CREATE A SOURCING TARGET

### 7.1 Overview

The user picks a TAT date, an assignee and products (from the Product Master or
typed by hand), gives each a target price and optional clarity, and saves. The
server gives the target its code (`ST-005`).

### 7.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `SourcingTracker.tsx` → `saveTarget()` |
| Form | `AssignTargetModal.tsx` → mount effects, `priceBad()`, `goToFirstError()`, `uploadClarities()`, `submit()` |
| Helpers | `format.ts` → `limitNum()`; `useSaveGuard.ts`; `upload.ts` → `uploadP2pFile()` |
| API | `GET /p2p/products`, `GET /p2p/team-members`, `GET /p2p/sourcing-targets/next-code`, `POST /p2p/upload`, `POST /p2p/sourcing-targets` |
| Backend | `SC::store()` → `validatePayload()`, `assigneeAllowed()`, `resolveAssignee()`, `syncProducts()`, `padCode()` |

### 7.3 Step-by-Step Flow

**Step 1 — Open the form**
* **Assign Sourcing Target** → the form mounts and loads `GET /p2p/products`, `GET /p2p/team-members`, `GET /p2p/sourcing-targets/next-code`.
* The header **Sourcing Target ID** shows the preview code.

**Step 2 — Dates**
* **Start Date** is fixed to today (*Today*).
* **Sourcing TAT** — calendar; days before today are blocked. Hint: *"{N} days turnaround from start"*.

**Step 3 — Assign To** (Feature 2).

**Step 4 — Choose the source**
* *From Product Master* or *Manual Product Entry*. Switching only changes which adder shows; the list can hold both kinds.

**Step 5 — Add products**
* Product Master: search (code, name or segment), tick, **Add**. Each row gets key `m-<code>`. Products already on the list show *(added)*.
* Manual: **Product Name** (max 255) + **Target Price (₹)**, **Add to List** or Enter.

**Step 6 — Product List** — type each **Target Price (₹)**; optionally **Add clarity** (Feature 5).

**Step 7 — Save** — **Assign Target** (*Assigning…*) → `submit()`.

### 7.4 Typing Caps — `limitNum()` (CS-2308)

Both target-price inputs pass the typed text through `limitNum()`:

```ts
// format.ts
export const PRICE_INT = 10;
export const PRICE_DEC = 2;
export const RATE_INT = 5;
export const RATE_DEC = 4;
/** Digits and one point only, at most `int` digits before it and `dec` after ("12a.3.45" → "12.34"). */
export const limitNum = (raw: string, int = PRICE_INT, dec = PRICE_DEC) => {
  const clean = raw.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  const whole = (dot < 0 ? clean : clean.slice(0, dot)).slice(0, int);
  return dot < 0 ? whole : `${whole}.${clean.slice(dot + 1).replace(/\./g, '').slice(0, dec)}`;
};
```

**Processing Explanation:**
1. Letters and extra points are removed.
2. At most 10 digits before the point and 2 after — so `9,999,999,999.99` is the largest value that can be typed.
3. `priceBad()` is still needed for values the cap lets through (`.5`, `5.`, `0`) and for older stored values loaded on Edit.

### 7.5 Validation — Browser

| Field | Rule | Message / effect |
|---|---|---|
| Sourcing TAT | required | *Pick the target completion date* |
| Sourcing TAT | not before today (Add) | *The Sourcing TAT cannot be in the past* |
| Sourcing TAT | not before the start date | *TAT cannot be before the start date* |
| Assign To | required | *Assign this target to a team member* |
| Product List | at least one product | *Add at least one product* |
| Manual adder | name not blank and price > 0 | the empty field turns red |
| Manual adder | name not already a manual product (case-insensitive) | toast *Already in the list — "X" is already a manual product on this target.* |
| Price — typing | `limitNum()` | extra characters are not typed |
| Price — save | `priceBad()`: > 0, ≤ `MAX_TARGET_PRICE` (9,999,999,999.99), `^\d+(\.\d{1,2})?$`, ≤ 64 chars, not in `serverPriceKeys` | field turns red; tooltip *Enter a price more than 0 and up to ₹9,99,99,99,999.99, with at most 2 decimals* |

With anything wrong, `goToFirstError()` scrolls to and focuses the first marked
field (switching the Masters / Manual tab if needed) and **nothing is sent**.

### 7.6 Validation — Server (`SC::validatePayload($request, true)`)

| Field | Rule | Custom message |
|---|---|---|
| `due_date` | `required\|date\|after_or_equal:today` | *Pick the Sourcing TAT (target completion date).* · *The Sourcing TAT cannot be in the past.* |
| `source` | `required\|in:master,manual` | default |
| `assignee_id` | `required` | *Assign this sourcing target to a team member before saving.* |
| `products` | `required\|array\|min:1` | *Add at least one product to the Product List.* |
| `products.*.id` | `nullable\|integer` | default |
| `products.*.from` | `required\|in:master,manual` | default |
| `products.*.code` | `nullable\|required_if:products.*.from,master\|string\|max:64` | *Pick a product from the Product Master.* |
| `products.*.name` | `nullable\|required_if:products.*.from,manual\|string\|max:255` | *Enter the product name.* |
| `products.*.target_price` | `nullable`, `required_if:…,manual`, `regex:/^\d[\d,]*(\.\d{1,2})?$/`, `max:64` | *Enter the target price.* · *The target price must be a number (up to 2 decimals).* |
| `products.*.clarity` | `nullable\|array` | default |
| `products.*.clarity.type` | `nullable\|in:text,link,pdf` | default |
| `products.*.clarity.val` | `nullable\|string` | default |

Then `assigneeAllowed()` (Feature 2). The server has **no numeric cap** on
`target_price` and does not require it for a master product.

### 7.7 Frontend Save — `submit()`

```
run(async () => {                                  ← useSaveGuard: one save at a time
   clarity = await uploadClarities()
        each product's new File → POST /p2p/upload kind=clarity (in parallel)
        → '/storage/…' into clarity.val
   body = { source, due_date, assignee_id, products:[{id?, from, code|name, target_price, clarity}] }
   isEdit ? PUT /p2p/sourcing-targets/{code} : POST /p2p/sourcing-targets
   onSaved({ code, count, assignee, isEdit })      → saveTarget() in the page
   catch: apiFieldErrors → serverErr (due_date, assignee_id) under the fields;
          products.N.target_price → serverPriceKeys (row N) → marked + focused;
          toast "Assign failed" / "Update failed"
})
```

### 7.8 API Request

```json
POST /api/p2p/sourcing-targets
{ "source": "master", "due_date": "2026-11-30", "assignee_id": "42",
  "products": [
    { "from": "master", "code": "P-001", "target_price": "1250",
      "clarity": { "type": "pdf", "val": "/storage/p2p/clarity/c12/Ab3…/spec.pdf" } },
    { "from": "master", "code": "P-014", "target_price": "870.50",
      "clarity": { "type": "link", "val": "https://example.com/spec" } },
    { "from": "manual", "name": "Custom gasket", "target_price": "85.5", "clarity": null } ] }
```

`source` = the radio's last choice; `assignee_id` = the picked id as a string;
products in list order; no `id` on Add.

### 7.9 Backend Processing — `SC::store()`

```php
if (! $user->client_id) → 403 'No tenant context'
validatePayload(true); assigneeAllowed();

DB::transaction(function () {
    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
    $seq  = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
    $code = sprintf('ST-%03d', $seq);
    $assignee = $this->resolveAssignee(...);
    $target = SourcingTarget::create([...]);      // start_date = today, status = 'In Progress'
    $this->syncProducts($target, $clientId, $products);
});
return ok(['id' => $code]);
```

**Processing Explanation:**
1. The `clients` row lock makes code allocation one-at-a-time per company.
2. The code is **count + 1**, soft-deleted targets included, so codes are not reused (`ST-001` … `ST-999`, then `ST-1000`).
3. `syncProducts()` inserts one product row per item, in the order sent.

**`syncProducts()` — finding a master product (in this order):**
1. `products` with `client_id`, `product_code` = sent code exactly, `branch_id` = target's branch (only when the target has one);
2. the same without the branch;
3. the client's products of that branch (or all), first whose **padded** code (`padCode()`: `P-41` → `P-041`) equals the sent code;
4. the same over **all** the client's products.

**Snapshot saved:** `product_id` (null when not found), `code` = sent code,
`name` = product name (else sent name, else code), `segment` =
`clm_segments.name`, `hsn` = `master_hsn_codes.hsn_code`. A **manual** product
saves `name` only (`—` if missing); `product_id`, `code`, `segment`, `hsn` null.

### 7.10 Database

| Table | Read / Write | Columns and values |
|---|---|---|
| `clients` | Read (row lock) | — |
| `p2p_sourcing_targets` | Read | count incl. soft-deleted |
| `users` | Read | `assigneeAllowed()`, `resolveAssignee()` |
| `products` + `clm_segments` + `master_hsn_codes` | Read | master product lookup |
| `p2p_sourcing_targets` | **Write** | `client_id`, `branch_id` (user's branch or null), `code`, `source`, `start_date` = today, `due_date`, `assignee_id`, `assignee_name`, `created_by`, `created_by_name`, `status` = *In Progress* |
| `p2p_sourcing_products` | **Write** (one per product) | `sourcing_target_id`, `source`, `product_id`, `code`, `name`, `segment`, `hsn`, `target_price` (string as sent), `clarity_type`, `clarity_value`, `status` = *In Progress* |
| public disk | **Write** | clarity files — uploaded **before** the target, kept even if the target save fails |

### 7.11 Response and UI

`{ "status": true, "data": { "id": "ST-005" } }` → `saveTarget()`:
* toast *"ST-005 created — N product(s) assigned to <name>."*
* list switches to **Created by Me**, page 1, search cleared;
* popup closes; `reload()`.

### 7.12 Edge Cases and Known Gaps

* The header ID is a **preview** (`nextCode()` counts without the lock); the saved code can differ.
* `(client_id, code)` is **not unique** in the database; a hard delete or manual insert can make a duplicate, and `target()` then uses `first()`.
* An unknown master code is accepted: `product_id` null, name = code (repair: `php artisan sourcing:backfill-product-names --apply`; without `--apply` it is a dry run).
* `p2p_sourcing_products.segment` is `string(128)`; a segment name of 129–255 characters → **500**.
* An upload error fails the whole save with *Assign failed*; already uploaded files stay on disk.
* There is no delete for a target.

---

## 8. FEATURE 4 — EDIT A SOURCING TARGET

### 8.1 Overview

Only the creator can edit. The TAT, source, products, prices and clarity can
change; the assignee and start date cannot. A product with suppliers cannot be
removed. If the assignee is inactive, the target is **view only**.

### 8.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `SourcingTracker.tsx` → Edit pencil (`canEdit`) |
| Form | `AssignTargetModal.tsx` (with `initial`), `plainPrice()`, `submit()` |
| API | `GET /p2p/products`, `GET /p2p/sourcing-targets/{code}`, `POST /p2p/upload`, `PUT /p2p/sourcing-targets/{code}` |
| Backend | `SC::show()` (`viewDenial()`, `productDisplayResolver()`), `SC::update()` (`validatePayload()`, `assigneeIsActive()`, `syncProducts()`) |

### 8.3 Access

| Layer | Rule | Refusal |
|---|---|---|
| Frontend | pencil active only when `row.createdById === myId` | disabled; tooltip *Only the creator can edit this target* |
| `GET` (`show()`) | target of the client; `viewDenial()` | 404 *Sourcing target not found.* · 403 *Only the creator, the assignee or the client admin can open this sourcing target.* |
| `PUT` (`update()`), in this order | 404 → creator only → validation → product with suppliers left out → assignee active | 403 *Only the creator can edit this sourcing target.* · 422 *"X" has suppliers mapped in the Sourcing Report and can't be removed. Unmap its suppliers first.* · 403 *This sourcing target's assignee is inactive or exited — it is view-only and can't be edited.* |

### 8.4 Step-by-Step Flow

**Step 1 — Open** — pencil → `AssignTargetModal` with `initial` = the row. Shimmer while `GET /p2p/sourcing-targets/{code}` and `GET /p2p/products` load.

**Step 2 — Fill** — TAT, start date (*Locked*), assignee (*Fixed*), source, products (keys `s-<id>`), prices (commas removed by `plainPrice()`), clarities. Products with suppliers get `mapped` → a **lock** instead of the remove button (*Suppliers are mapped to this product — it can't be removed*).

**Step 3 — View-only check** — `assigneeActive === false` → **View Only** tag, toast *View only — This sourcing target's assignee is inactive or exited, so it can't be edited.*; only **Close**; all inputs off; the row's *Add clarity* / *Edit clarity* buttons are disabled, and the note view (`ClarityNoteView`) shows no **Edit Clarity**.

**Step 4 — Change** — TAT, source, add products, rename manual products, prices, clarity, remove products without suppliers.

**Step 5 — Save** — **Update Target** (*Updating…*) → clarity uploads → `PUT`.

### 8.5 `assigneeIsActive()`

```php
private function assigneeIsActive($clientId, $assigneeUserId): bool
{
    if (! $assigneeUserId) return false;
    $userActive = User::where('id', $assigneeUserId)
        ->whereRaw('LOWER(status) = ?', ['active'])->exists();
    // … and either no employees row for that user in the client, or that row is active
}
```

### 8.6 Validation

* **Browser** — as Create, except: no past-date check (TAT only ≥ start date; the calendar's `minDate` is the start date); no assignee check; a renamed manual name may not be blank; **no duplicate check on rename**.
* **Server** — `validatePayload($request)` (no `after_or_equal:today`) + the checks in 8.3.

### 8.7 API Request

```json
PUT /api/p2p/sourcing-targets/ST-004
{ "source": "manual", "due_date": "2026-12-05", "assignee_id": "42",
  "products": [
    { "id": 12, "from": "master", "code": "P-001", "target_price": "1200", "clarity": { "type": "text", "val": "Grade A only" } },
    { "id": 13, "from": "manual", "name": "Custom gasket (EPDM)", "target_price": "85.50", "clarity": null },
    { "from": "manual", "name": "Spacer ring", "target_price": "40", "clarity": null } ] }
```

* `assignee_id` = the row's `assigneeId` — required by the rule, **ignored** by the server.
* Kept products carry `id`; new ones don't; a removed product is simply left out.

### 8.8 Backend Processing — `SC::update()`

1. `target()`; creator check; `validatePayload()`.
2. Load existing products `withCount('suppliers')`; the first one **with suppliers** that is not in the payload → 422.
3. `assigneeIsActive()` → 403.
4. `DB::transaction`:
   * target: `source`, `due_date`;
   * sent product with an `id` of **this** target → update `target_price` (sent or **null**), `clarity_type` / `clarity_value` (sent or **null**), and `name` when `from = manual`;
   * anything else (no id, or an id of another target) → `syncProducts()` as **new**;
   * products not kept → `$p->suppliers()->delete()` then `$p->delete()` (both soft deletes).

### 8.9 Database

| Read | Written | Never written on edit |
|---|---|---|
| `p2p_sourcing_targets`, `p2p_sourcing_products` (+ supplier counts), `users`, `employees`, `products` | target `source`, `due_date`; products `target_price`, `clarity_type`, `clarity_value`, `name` (manual), new rows, `deleted_at`; suppliers of removed products `deleted_at` | `assignee_id`, `assignee_name`, `start_date`, `code`, `created_by`, `status`, a kept master product's `code` / `name` / `segment` / `hsn` |

### 8.10 Response and UI

`{ "data": { "id": "ST-004" } }` → toast *"ST-004 updated — N product(s) on this
target."*, popup closes, `reload()`. Error → toast *Update failed — <message>*.

### 8.11 Edge Cases and Known Gaps

* `show()` displays the **live** Product Master name / segment / HSN, but the saved snapshot is not refreshed.
* The source **can** be switched on Edit (an in-file comment says it is locked).
* A past TAT is accepted on Edit if it is after the start date.
* A kept product's `target_price` or `clarity` left out of the body is **cleared** (the screen always sends both).
* A target with no `assignee_id` sends `null` → 422, shown only in the toast.
* Supplier mapping and re-pricing are **not** blocked when the assignee is inactive.

---

## 9. FEATURE 5 — PRODUCT CLARITY (TEXT, LINK, PDF)

### 9.1 Overview

A clarity is extra information about a product: a note, a link or a file. It is
stored **in the form** until the target is saved; files are uploaded at save
time.

### 9.2 Files Involved

| Layer | File · Function |
|---|---|
| Write | `ClarityDialog.tsx`, `AttachPicker.tsx`, `AttachedFiles.tsx`, `CameraCaptureModal` |
| Show / read | `ClarityChip.tsx`, `ClarityNoteView.tsx`, `targetProducts.ts` → `viewDocument()` |
| Upload | `AssignTargetModal.tsx` → `uploadClarities()`; `upload.ts` → `uploadP2pFile()` |
| API | `POST /p2p/upload`, `GET /p2p/clarity/download` |
| Backend | `SC::upload()` (`safeUploadName()`), `SC::downloadClarity()` |

### 9.3 Step-by-Step Flow

**Step 1** — In a product row: **Add clarity** (or pencil **Edit clarity**) → **Product Clarity** dialog, tabs **Text** / **Link** / **PDF**.

**Step 2** — Text: a note. Link: a URL. PDF: **Upload file** or **Take photo** (one shot), or drag and drop. The file shows with **View** / **Remove**.

**Step 3** — **Save Clarity** → stored in the form only; the cell shows a chip (*Text note*, *Open link*, *View PDF* / *View file*) and a pencil.

**Step 4** — On target save, the file is uploaded and its path goes into `clarity.val`.

### 9.4 Validation

| Where | Rule | Message |
|---|---|---|
| Browser — Text | empty = remove the clarity | — |
| Browser — Link | empty = remove; else `/^https?:\/\/\S+\.\S+/i` | *Enter a valid link starting with http:// or https://* |
| Browser — PDF | `CLARITY_EXT` `.pdf .jpg .jpeg .png .webp`, ≤ 5 MB (`CLARITY_MAX_BYTES`); one file per product | *Upload a PDF, JPG, PNG or WEBP file up to 5 MB.* |
| Server — upload | `file` `required\|file\|max:5120`; `kind` `nullable\|in:clarity,card` | Laravel defaults |
| Server — upload | extension (from the client file name) in `pdf, jpg, jpeg, png, webp` | 422 *The file must be a PDF, JPG, PNG, or WEBP.* |
| Server — target | `clarity.type` `in:text,link,pdf`; `.val` `string` | defaults — no URL or length check |
| Esc | closes the dialog only while nothing changed | — |

### 9.5 API Calls

```
POST /api/p2p/upload        (multipart)  file=<spec.pdf>  kind=clarity
→ { "status": true, "data": { "path": "/storage/p2p/clarity/c12/Ab3dE…24chars/spec.pdf", "name": "spec.pdf" } }
```

The target body then carries `"clarity": { "type": "pdf", "val": "<path>" }`
(or `text` / `link`, or `null`).

Viewing: `GET /api/p2p/clarity/download?path=/storage/p2p/clarity/c12/…/spec.pdf` (`responseType: blob`).

### 9.6 Backend Processing

**`SC::upload()`**
1. Validate; check the extension.
2. `token = Str::random(24)`.
3. `safeUploadName()` — letters, digits, `- _ .` and spaces only, at most 120 characters, `document` if empty, + lower-case extension.
4. Folder `p2p/clarity/c{client_id}/{token}` (`kind=card` → `p2p/supplier-cards/…`).
5. `storeAs(…, 'public')`; return `/storage/` + path and the original name.

**`SC::downloadClarity()`**
1. `path` required; backslashes turned into `/`; a leading `/` and `storage/` stripped.
2. Refuse (404) if it contains `..` or does not start with `p2p/clarity/`.
3. Allowed when under `p2p/clarity/c{your client}/`, or (older files outside any `c<n>/` folder) when a product of your client has a `clarity_value` containing it.
4. File must exist on the `public` disk (404); stream it as a download.

**`viewDocument()` (browser)** — opens a blank tab **synchronously** (so the
browser allows it), fetches the blob, points the tab at it. A path outside
`/p2p/clarity/` (a business card) is opened directly. Failure → tab closed,
toast *Couldn't open the document — Please try again.*

### 9.7 Database

| Read | Written |
|---|---|
| `p2p_sourcing_products` (legacy download check) | `p2p_sourcing_products.clarity_type` (`text\|link\|pdf`, `string(16)`), `.clarity_value` (`text`) — by the target save; the upload writes only the file |

### 9.8 Edge Cases and Known Gaps

* The upload area says *Click to upload a PDF specification*, though images are accepted.
* Type checked by **extension only**; files are on the public disk, so the direct `/storage/…` URL bypasses the download check (the random token is the only protection).
* Files of a failed save are never cleaned up.
* Older / Bulk Sourcing clarity can hold several newline-joined paths: the chip shows ×N and opens the first.
* `PUT …/products/{id}/clarity` (Bulk Sourcing only) without `clarity_type` → 500.

---

## 10. FEATURE 6 — SOURCING TARGET REPORT AND PRODUCT LIST

### 10.1 Overview

The **Report** shows every product with its status, clarity and mapped-supplier
count, and is where suppliers are mapped. The **Product List** is a read-only
version.

### 10.2 Files Involved

| Layer | File · Function |
|---|---|
| Popups | `SourcingTargetReport.tsx`, `ProductList.tsx` |
| Helpers | `targetProducts.ts` → `useTargetReport()`, `toProduct()`, `productProgress()`; `popupHooks.ts` → `useFitRows()`; `format.ts` → `inr()` |
| API | `GET /p2p/sourcing-targets/{code}/report` |
| Backend | `SC::report()` → `viewDenial()`, `productDisplayResolver()`, `padCode()` |

### 10.3 Step-by-Step Flow

**Step 1 — Open**
* Report: row **Sourcing Target Report** (or the **Mapped Suppliers** count when > 0).
* Product List: the **Total Products** cell.

**Step 2 — Load** — `useTargetReport(row, refreshKey)` → `GET /api/p2p/sourcing-targets/ST-004/report`. Old rows stay on screen while it reloads.

**Step 3 — Tabs** — Product Master / Manual; opens on the non-empty one. `useFitRows`: rows = min(5, rows of the **viewed** tab), then it scrolls (CS-2215).

**Step 4 — Each row (Report)**
* Target Price → `FitTip(inr(price))` in `.str-price-cell` — one line, "…" + tooltip when cut.
* `ClarityChip` (text → `ClarityNoteView` · link → new tab · pdf → `viewDocument()`).
* Supplier Count → opens Mapped Suppliers (button only when > 0).
* **Map Supplier Directory** → `onMapSupplier(row, product)` — enabled only when `canMap`; otherwise tooltip *Only the creator or the assignee maps suppliers to this target*.

### 10.4 Backend Processing — `SC::report()`

1. `target()`; `viewDenial()` (403); unknown code → 404.
2. Products `withCount('suppliers')`.
3. `productDisplayResolver()` — master rows with a `product_id` get the **live** `products.name`, segment and HSN; others the snapshot.
4. Map each product (`padCode()` on the code; `price` as stored).

### 10.5 Response

```json
{ "status": true, "data": { "id": "ST-004", "source": "Product Master", "start": "2026-11-20", "due": "2026-11-30",
  "createdBy": "Asha", "assignee": "Ravi",
  "products": [ { "id": 12, "type": "master", "code": "P-001", "name": "Bolt M8", "segment": "Hardware",
                  "hsn": "7318", "price": "1250", "status": "Completed", "supplierCount": 2,
                  "clarity": { "type": "pdf", "val": "/storage/…" } } ] } }
```

### 10.6 What the Browser Computes

| Item | Rule |
|---|---|
| `toProduct()` | `done = status === 'Completed'`; commas removed from price; manual rows get `—` for code / segment / HSN |
| `productProgress()` | total, done, pending, `pct = round(done / total × 100)`, `full = total > 0 && done ≥ total` |
| Header tiles | from the **list row** (code, source, start, due, created by, assigned to); Due Date red when `tatState(row) === 'overdue'` |
| Report status | *Completed* / *Pending* |
| Product List status | *Completed* / *In Progress*; blank segment / HSN → *N/A* |
| States | *Loading the products…* · *Couldn't load the products.* + **Retry** · empty-tab texts |
| Refresh | after a map, edit or convert the page bumps `reportRefresh` |

### 10.7 Database

| Read | Written |
|---|---|
| `p2p_sourcing_targets`, `p2p_sourcing_products`, `COUNT` of `p2p_sourcing_product_suppliers`, `products` (+ segment, HSN) | nothing |

### 10.8 Edge Cases and Known Gaps

* The same product reads *In Progress* (Product List) and *Pending* (Report).
* The *Generated* date is the browser's today.
* Header tiles show the list row's values (they stay in step because the list reloads after every save).

---

## 11. FEATURE 7 — MAP SUPPLIER FROM THE SUPPLIER MASTER

### 11.1 Overview

The creator or assignee picks an existing Supplier Master supplier for a product
and enters its price. The server copies the supplier's details (a snapshot),
computes GST / INR and marks the product **Completed**.

### 11.2 Files Involved

| Layer | File · Function |
|---|---|
| Popup | `MapSupplierModal.tsx` → steps, `save()` |
| Chooser | `SupplierTypeChooser.tsx` (`mode="master"`) |
| Form | `SupplierMasterForm.tsx` → `loadPool()`, `onTakenClick()`, `supplierAdded()`, `numeric()`, `numericRate()`, `save()` |
| Page | `SourcingTracker.tsx` → `finishMap()` |
| API | `GET /p2p/suppliers`, `GET …/products/{id}/suppliers`, `POST …/products/{id}/suppliers` |
| Backend | `SC::suppliers()`, `SC::mapSupplier()` → `canMapSuppliers()`, `sourcingPrice()`, `SupplierPricing` |

### 11.3 The Map Supplier Steps

```
step 'choose'      Supplier Master | New Supplier
step 'masterType'  SupplierTypeChooser mode="master" — "{n} available"
step 'newType'     SupplierTypeChooser (New) — "New"
step 'master'      SupplierMasterForm  (replaces the whole popup box)
step 'new'         NewSupplierForm     (in the popup body, under the product strip)
Edit opens straight on 'master' (edit.master set) or 'new'.
```

### 11.4 Step-by-Step Flow

**Step 1** — **Map Supplier Directory** → step **choose** → **Supplier Master**.

**Step 2** — step **masterType**: *Supplier Master — Choose the supplier type for <product>*. Each card shows *"{n} available"* from `GET /p2p/suppliers` (failure → 0 / 0).

**Step 3** — a card → `SupplierMasterForm` (header *Supplier Master* + Domestic / International tag).

**Step 4 — Supplier Name**
* `loadPool()` → `GET /p2p/suppliers?origin=domestic|international`.
* Mapped ids → `GET …/products/{id}/suppliers` → its Master rows' `supplier_id` (minus the one being edited) are **disabled**.
* Each option: code chip, name (International: *"name · country"*), type badge (violet material, green transport / FFD / logistics / freight, grey service), `fullLabel` tooltip when the name is cut.
* Disabled row: hover *"<name> — already mapped to this product"*; click → `onTakenClick()` → toast *Already mapped — <name> is already mapped to this product.* (list stays open).
* Until the pool arrives: *Loading suppliers…*. Empty origin: *No Domestic suppliers in the Supplier Master*.

**Step 5 — "+" (add a new Supplier Master record)**
* Opens `AddVendorModal` for the same origin (`canMapProducts={false}`).
* After save → `supplierAdded()`: `loadPool()` again and select the new vendor (*"<name> added to Supplier Master — It is now selected in this form."*), or *"<name> saved — It is not a Domestic / an International supplier, so it is not in this list."*

**Step 6 — Auto fields** — Supplier Code, Supplier Type, Contact Person; Domestic: State, GST State Code; International: Country, City / Region.

**Step 7 — Price**
* Domestic: **Price (₹)**, **GST %** (master rates, default 18), GST Amount and Total (computed).
* International: **Currency** (non-INR), **Price**, **Exchange Rate**, Total = price.

**Step 8 — Save** (*Saving…*) → `save()` in `MapSupplierModal`.

### 11.5 The Dropdown Width Fix

```css
/* supplier-master-form.css */
.master-select-menu.stsm-sup-menu:not(:has(.master-select-empty)) { width: 0 !important; }
```

**Processing Explanation:** with rows, the menu is exactly the field's width
(the inline `min-width`) and never resizes while scrolling. While loading or
empty, it keeps the field's plain width (`6170fa175` — it used to open small
with "No options" and then jump).

### 11.6 Supplier Pool — `SC::suppliers()`

1. `origin` `nullable|in:domestic,international` (else 422 *The selected origin is invalid.*).
2. `Vendor::query()->forUser($user, branch_id)`:
   * employee / branch user → `client_id` null **or** (own client **and** (`branch_id` null **or** own branch));
   * client admin / client user → own client (or null);
   * super admin → all. Soft-deleted excluded. **No status filter.**
3. With segment, vendor type, addresses (**`is_primary` desc, then id**), country, state; ordered by `company_name`.
4. From the **first (primary) address**: country, `origin = originOf(country)`, `currency = currencyFor(country)`, state, `stateCode`, city, contact, email (address email, else `vendors.primary_email`), region.
5. Filter by `origin` in PHP.

### 11.7 Validation

| Where | Rule | Message |
|---|---|---|
| Browser — typing | Price `limitNum(v, 10, 2)`; Rate `limitNum(v, 5, 4)` | can't type more |
| Browser — Save | supplier picked; price > 0; International rate > 0 | *This field is required* |
| Browser — Save | picked id is in the loaded pool | otherwise `save()` returns **silently** (only reachable in Edit) |
| Server | `price` `required\|numeric\|gt:0\|max:9999999999.99` | *Please enter the supplier's unit price.* · *The unit price must be more than 0.* · *The unit price cannot be more than 9,999,999,999.99.* |
| Server | `gst_percentage` `nullable\|numeric\|min:0\|max:100`; `gst_type` `nullable\|in:intra,inter`; `currency` `nullable\|string\|size:3\|alpha`; `origin` `nullable\|in:domestic,international` | defaults |
| Server | `exchange_rate` `nullable\|numeric\|gt:0\|max:99999.9999` | *The exchange rate must be more than 0.* · *The exchange rate cannot be more than 99999.9999.* |
| Server | `valid_till` `nullable\|date\|after_or_equal:today` | *Price Valid Till cannot be in the past.* |
| Server | vendor visible (`Vendor::forUser()->findOrFail`) | **404** |
| Server | not already mapped (CS-2308) | 422 *"<company name>" is already mapped to this product.* |
| Server | origin matches the vendor's country | 422 `errors.origin` *This supplier is based in India — map it as a Domestic supplier.* / *…based in <country> — map it as an International supplier.* |
| Server | International: currency not INR | 422 `errors.currency` *Pick the supplier's currency — an International price is not in ₹.* |
| Server | International: a rate (sent or master) | 422 `errors.exchange_rate` *Please enter the exchange rate (₹ per <CUR>).* |
| Server | total / INR ≤ 999,999,999,999.99 (`assertFits()`) | 422 `errors.price` *The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.* |

`price`, `currency`, `exchange_rate` errors show under their fields; `origin`,
`valid_till` and *already mapped* show only in the toast *Supplier not mapped —
<message>*. *Too large* can only happen for International (price × rate).

### 11.8 API Request

```json
POST /api/p2p/sourcing-targets/ST-004/products/12/suppliers
{ "supplier_id": "17", "origin": "domestic", "price": 100, "gst_percentage": 18 }

{ "supplier_id": "88", "origin": "international", "price": 250, "currency": "USD", "exchange_rate": 84.2 }
```

The Domestic body has **no `gst_type`** and no `valid_till` (the form has no
Valid Till field).

### 11.9 Frontend Save — `MapSupplierModal.save()`

```
run(async () => {
   card File? → POST /p2p/upload kind=card → path → new_supplier.card     (New Supplier only)
   edit Master → PATCH …/suppliers/{m}/price
   edit New    → PUT   …/suppliers/{m}
   otherwise   → POST  …/products/{id}/suppliers
   onMapped(name) → page finishMap(): toast, bump reportRefresh, reload()
})
error → apiFieldErrors() → serverErrors + toast "Supplier not mapped" / "Supplier not updated"
```

### 11.10 Backend Processing — `SC::mapSupplier()` (`supplier_id` branch)

```
canMapSuppliers() → 403
product of this target? → 404 'Product not found in this sourcing target.'
validate
Vendor::forUser()->with(segment, addresses)->findOrFail(supplier_id)   → 404
already mapped? → 422
   = a master row for this vendor
     OR a new row whose P2pSupplier.converted_vendor_id = this vendor   (CS-2308)
snapshot from the primary address (country, state, state code)
price = sourcingPrice()     → see Section 17
assertFits()
create SourcingProductSupplier
product.status = 'Completed'
return { supplierCount }
```

**Processing Explanation:**
1. The duplicate check also catches a **converted** New Supplier of the same vendor (CS-2308).
2. For Domestic, the server decides **intra / inter** GST by comparing the vendor's state with **the mapping user's branch** state.
3. The supplier's details are **copied** into the mapping row — later edits to the vendor do not change it.

### 11.11 Database

| Table | Read / Write | Columns |
|---|---|---|
| `p2p_sourcing_targets`, `p2p_sourcing_products` | Read | target and product |
| `vendors` + `clm_segments`, vendor type, `vendor_addresses`, `master_countries`, `master_states` | Read | supplier and snapshot |
| `p2p_suppliers` | Read | converted check |
| `p2p_sourcing_product_suppliers` | Read | duplicate check |
| `branches` | Read | home state for GST type |
| `master_currencies` | Read | default rate |
| `p2p_sourcing_product_suppliers` | **Write** (new row) | `sourcing_product_id`, `supplier_id` = `vendors.id`, `source` = `master`, `name` = `company_name`, `segment`, `contact`, `mobile`, `email` (address email or `primary_email`), `country` (*India* when domestic and blank), `state`, `state_code`, `city`; pricing: `origin`, `currency_code`, `price`, `gst_percentage`, `gst_type`, `cgst_amount`, `sgst_amount`, `igst_amount`, `gst_amount`, `total_amount`, `exchange_rate`, `inr_amount`, `price_valid_till` (null), `mapped_by`. **Not** copied: `gmaps`, `address`, `card_path` |
| `p2p_sourcing_products` | **Write** | `status` = *Completed* |

### 11.12 Response and UI

`{ "status": true, "data": { "supplierCount": 3 } }` → `finishMap()`:
info toast *Supplier mapped — <name> mapped to <product>.*, popup closes,
`reportRefresh` +1 (report and an open Mapped Suppliers reload), `reload()`.

### 11.13 Edge Cases and Known Gaps

* The picker greys out only **Master** rows; the CS-2308 case is refused only by the server (toast).
* No vendor status filter — inactive / incomplete Supplier Master records can be picked.
* "{n} available" includes suppliers already mapped to this product.
* The browser's GST Amount / Total are a preview; the server's values are stored.
* A currency missing from the Currency master starts with an empty rate.
* No Price Valid Till, INR equivalent or *vs target* on this form.

---

## 12. FEATURE 8 — MAP A NEW SUPPLIER

### 12.1 Overview

For a supplier that is not in the Supplier Master, the user types its details
and quote. The server stores it in the **New Supplier directory**
(`p2p_suppliers`) and maps it to the product.

### 12.2 Files Involved

| Layer | File · Function |
|---|---|
| Popup | `MapSupplierModal.tsx` → steps `newType` / `new`, `save()` |
| Form | `NewSupplierForm.tsx` → `save()`, `SERVER_FIELD`, summary tiles |
| Helpers | `formMasters.ts` → `useFormMasters()`, `stateCodeOf()`, `gstTypeFor()`; `currency.ts` → `COUNTRY_CURRENCY` |
| API | `GET /p2p/form-masters`, `POST /p2p/upload` (`kind=card`), `POST …/products/{id}/suppliers` |
| Backend | `SC::mapSupplier()` (`new_supplier` branch), `P2pSupplier` + `EnforcesUniqueEmail` |

### 12.3 Step-by-Step Flow

**Step 1** — **Map Supplier Directory** → **New Supplier** → *New Supplier — Register a new supplier for <product>* → Domestic or International.

**Step 2** — `NewSupplierForm` opens (tag *New · Domestic* / *New · International*) with four sections: **Supplier Information**, **Address**, **Supplier Price & GST** (or **& Currency**), **Documents**.

**Step 3** — `useFormMasters()` loads segments, countries, states, state codes, GST rates, currencies and the home state.

**Step 4** — Fill the fields (12.4). The GST type defaults by comparing the supplier's state with your branch's state (by name), until picked by hand.

**Step 5** — **Save Supplier** (*Saving…*) → business card uploaded first (if picked) → `POST`.

### 12.4 Fields — Browser Rule → Server Rule → Stored Where

| Field | Browser | Server (`new_supplier.*`) | Stored in |
|---|---|---|---|
| Supplier Company Name \* | not blank — *Enter the supplier company name* | `required_with:new_supplier\|string\|max:255` | `p2p_suppliers.name` and mapping `name` (trimmed) |
| Contact Person \* | not blank — *Enter the contact person* | `nullable\|string\|max:255` | `contact` |
| Mobile Number \* | Domestic: digits, max 10, `^\d{10}$` — *Enter a 10-digit mobile number*. International: digits, `+`, spaces, dashes, max 20, `^\+?\d[\d\s-]{6,17}$` — *Enter the mobile number with its country code* | `nullable\|string\|max:64` | `mobile` |
| Segment \* | picked — *Select a segment* | `nullable\|string\|max:512` | `segment` (name) |
| Email ID \* | `^\S+@\S+\.\S+$` — *Enter a valid email ID* | `nullable\|email\|max:255`; unique system-wide on create | `email` |
| Google Location Link | optional | `nullable\|string\|max:512` | `gmaps` |
| Street Address \* | not blank | `nullable\|string\|max:255` | `address` |
| Country \* | Domestic: text box (default *India*) — **India is always sent**. International: countries outside India — *Select a country* | `nullable\|string\|max:128` + origin checks | `country` |
| State | Domestic \*: Indian states; fills State Code and GST type. International: free text, optional | `nullable\|string\|max:128` | `state` |
| State Code | Domestic only; max 3; upper-cased | `nullable\|string\|max:16` | `state_code` |
| City \* | not blank | `nullable\|string\|max:128` | `city` |
| Unit Price \* | `limitNum(…, 10, 2)`; > 0 | `required\|numeric\|gt:0\|max:9999999999.99` | `price` |
| GST Rate \* (Domestic) | master rates, default 18 | `nullable\|numeric\|min:0\|max:100` | `gst_percentage` |
| GST Type \* (Domestic) | *CGST + SGST (Intra-state)* / *IGST (Inter-state)*; changeable | `nullable\|in:intra,inter` — **used as sent** | `gst_type` |
| Currency \* (International) | non-INR; default USD; country suggests its currency | `nullable\|string\|size:3\|alpha`; INR refused | `currency_code` |
| Exchange Rate \* (International) | `limitNum(…, 5, 4)`; > 0; master default | `nullable\|numeric\|gt:0\|max:99999.9999` | `exchange_rate` |
| Price Valid Till | today or later | `nullable\|date\|after_or_equal:today` | `price_valid_till` |
| Business Card | `.pdf .jpg .jpeg .png`, ≤ 5 MB — *PDF, JPG or PNG up to 5 MB.* | upload rules with `kind=card`; `new_supplier.card` `nullable\|string\|max:512` | `card_path` |

All six dropdowns use `menuClassName="stnf-ms-menu"` → each menu is exactly as
wide as its field (`6170fa175`); long names end in "…" with a tooltip.

### 12.5 Summary Tiles (browser only, per unit)

| Origin | Tiles |
|---|---|
| Domestic | *Taxable Value*, *GST Amount* (`CGST x% ₹… · SGST x% ₹…` or `IGST x% ₹…`), *Price incl. GST*, *vs Target Price* (*x% below — Saves ₹… / unit*, *At target*, *x% above — ₹… / unit over target*) |
| International | *Total Amount* (in the currency), *No GST*, *INR Equivalent* (*@ ₹{rate} / {cur}*) |

### 12.6 API Request

```json
POST /api/p2p/sourcing-targets/ST-004/products/12/suppliers
{ "new_supplier": { "name": "ABC Traders", "segment": "Hardware", "contact": "Priya",
                    "mobile": "9876543210", "email": "abc@example.com",
                    "gmaps": "https://maps.google.com/…", "address": "Plot 4, MIDC",
                    "country": "India", "state": "Maharashtra", "state_code": "27", "city": "Pune",
                    "card": "/storage/p2p/supplier-cards/c12/Xy…/card.jpg" },
  "origin": "domestic", "price": 100, "gst_percentage": 18, "gst_type": "intra",
  "valid_till": "2026-12-31" }
```

```json
{ "new_supplier": { "name": "Global Parts LLC", "segment": "Hardware", "contact": "Sam",
                    "mobile": "+1 555-123-4567", "email": "sam@globalparts.com",
                    "address": "1 Main St", "country": "United States", "state": "Texas", "city": "Austin" },
  "origin": "international", "price": 250, "currency": "USD", "exchange_rate": 84.2 }
```

Empty optional fields are left out; `valid_till` only when picked.

### 12.7 Backend Processing — `SC::mapSupplier()` (`new_supplier` branch)

```
access, product, validation (as Feature 7 + new_supplier.* rules)
name = trim(name)
origin checks:
   International + India/blank country → 422 new_supplier.country
        'Please select the supplier's country (outside India).'
   Domestic + foreign country          → 422
        'A Domestic supplier must be in India — choose International for an overseas supplier.'
price = sourcingPrice()                 ← Domestic uses the SENT gst_type
directory:
   P2pSupplier where client and LOWER(name) = lower(name)
   found     → reused as is (not updated, email not checked)
   not found → P2pSupplier::create(…)  → EnforcesUniqueEmail runs
converted entry? → 422 '"<name>" is already in the Supplier Master — map it from Supplier Master.'
already mapped?  → 422 '"<name>" is already mapped to this product.'
create mapping; product → Completed; return { supplierCount }
```

**Processing Explanation:**
1. The directory is matched **by name, ignoring case**. A second supplier typed with an existing name reuses the old entry.
2. The unique-email check runs only when a **new** entry is created. Scope `vendor` is **system-wide** (every company): it checks `vendors.primary_email` and `p2p_suppliers.email` → 422 `errors.email` *This email address is already used by another vendor or supplier in the system. Please use a different address.*
3. There is **no transaction** around the directory insert and the mapping insert.

### 12.8 Database

| Table | Read / Write | Columns |
|---|---|---|
| as Feature 7 + `p2p_suppliers`, `vendors` | Read | name lookup, email check |
| `p2p_suppliers` | **Write** (only when no entry has that name) | `client_id`, `branch_id`, `name`, `segment`, `contact`, `mobile`, `email`, `gmaps`, `address`, `country`, `state`, `state_code`, `city`, `card_path`, `origin`, `created_by` |
| `p2p_sourcing_product_suppliers` | **Write** | `supplier_id` = `p2p_suppliers.id`, `source` = `new`, `name`, every field **as typed** + pricing columns + `mapped_by` |
| `p2p_sourcing_products` | **Write** | `status` = *Completed* |

### 12.9 Response and UI

As Feature 7 (toast *Supplier mapped*). Errors: `SERVER_FIELD` maps
`new_supplier.*`, `price`, `exchange_rate`, `valid_till`, `currency` and `email`
to their fields; toast *Supplier not mapped — <message>*.

### 12.10 Edge Cases and Known Gaps

* **Reuse by name:** a different supplier with an existing name shares that directory entry — the email check is skipped, and Convert later prefills from the **old** entry.
* The Domestic Country box can be typed in, but India is always saved.
* The Domestic GST type is trusted as sent.
* The browser refuses a WEBP card (the server would accept it).
* The International form has no *vs Target* tile.
* A card uploaded before a refused save stays on disk.
* A failed mapping insert can leave a directory entry without a mapping (no transaction).

---

## 13. FEATURE 9 — EDIT A MAPPED SUPPLIER

### 13.1 Overview

There are two edit paths:

| Card | Button | API | What can change |
|---|---|---|---|
| New Supplier | **Edit supplier & quote** | `PUT …/suppliers/{m}` | all details + price |
| Master (incl. Converted) | **Edit price** | `PATCH …/suppliers/{m}/price` | price only |

### 13.2 Files Involved

| Layer | File · Function |
|---|---|
| Cards | `MappedSuppliers.tsx` → `editOf()`, `masterEditOf()` |
| Popup / forms | `MapSupplierModal.tsx`, `NewSupplierForm.tsx`, `SupplierMasterForm.tsx` (title **Edit Supplier Master**) |
| Backend | `SC::updateSupplier()`, `SC::updateSupplierPrice()`, `SC::mappedRow()` |

### 13.3 Access

| Layer | Rule | Refusal |
|---|---|---|
| Frontend | Edit icon only when `canMap` | hidden |
| Server | `canMapSuppliers()` | 403 *Only the creator or the assignee of this sourcing target can edit its suppliers.* (PUT) / *…can change a mapped supplier's price.* (PATCH) |
| Server | product / mapping exist | 404 *Product not found in this sourcing target.* · 404 *Mapped supplier not found for this product.* |

### 13.4 Path A — New Supplier Card (`PUT`)

**Step 1** — `editOf(s)` → `MapSupplierModal` with `edit` → step `new` (header *Edit · Domestic*).

**Step 2 — Prefill** — name, contact, segment, email, gmaps, address, city, state, state code; mobile = **last 10 digits** (Domestic) or as stored; country; price; GST % = stored **`|| 18`**; GST type = stored (kept, not re-derived); valid till; currency / rate; card. The Mapped Suppliers popup stays open behind it.

**Step 3 — Save** → `PUT`.

**Validation (server, `updateSupplier()`):**
* `source` must be `new` → else 422 *Only new (manual) suppliers can be edited here. Edit master suppliers from the Supplier master.*
* `new_supplier` `required|array`; `new_supplier.name` `required|string|max:255`; other rules as Feature 8.
* `price` `sometimes|required|numeric|gt:0|max:9999999999.99`; others as Feature 7 (Laravel's default messages here).
* Country vs the **stored** origin → 422 *This is an International supplier — choose a country outside India.* / *This is a Domestic supplier — the country must be India.*

```json
PUT /api/p2p/sourcing-targets/ST-004/products/12/suppliers/31
{ "new_supplier": { "name": "ABC Traders", "segment": "Hardware", "contact": "Priya Shah",
                    "mobile": "9876543210", "email": "abc@example.com", "address": "Plot 4, MIDC",
                    "country": "India", "state": "Maharashtra", "state_code": "27", "city": "Pune",
                    "card": "/storage/p2p/supplier-cards/c12/Xy…/card.jpg" },
  "origin": "domestic", "price": 95, "gst_percentage": 18, "gst_type": "intra" }
```

**Backend processing:**
1. access → product → row → `source = new` → validate;
2. `fields` from `new_supplier` — **every optional field not sent becomes null** (card included);
3. origin check;
4. if `price` is present: force the row's origin, `sourcingPrice()` (so `price_valid_till` = sent or **null**);
5. update the mapping row;
6. update the **directory entry** with a query-builder `update()` — **no model events, no unique-email check**.

**Database:** written `p2p_sourcing_product_suppliers` (snapshot, pricing,
`price_valid_till`; `mapped_by` **not** changed) and `p2p_suppliers` (contact
fields and name).

**Response:** `{ "data": { "id": "31" } }` → toast *Supplier updated — <name> on
<product> is updated.*; `reportRefresh` +1 (open Mapped Suppliers re-reads).

### 13.5 Path B — Master Card (`PATCH`)

**Step 1** — `masterEditOf(s)` → step `master` with `edit.master` → **Edit Supplier Master**.

**Step 2** — the pool loads; the supplier is shown **Locked** (*Loading supplier…* until the pool arrives); no "+", no Back. Price, GST %, currency (stored if not INR, else USD), rate prefilled.

**Step 3 — Update** (*Updating…*). If the supplier is not in the pool, **Update does nothing and shows nothing** (`!sup`).

```json
PATCH /api/p2p/sourcing-targets/ST-004/products/12/suppliers/40/price
{ "origin": "domestic", "price": 95, "gst_percentage": 12, "valid_till": "2026-12-31" }

{ "origin": "international", "price": 240, "currency": "USD", "exchange_rate": 84.5 }
```

`valid_till` is the card's stored date, sent only when there is one.

**Backend processing (`updateSupplierPrice()`):**
1. access → product → row → validate (same messages as Feature 7);
2. `origin` = the **row's** origin (the sent one is overwritten); country = the row's;
3. `sourcingPrice()` with the row's state / state code — Domestic GST type is re-derived against **the current user's branch**;
4. update pricing + `price_valid_till` (sent or null) + `mapped_by` = current user.

**Database:** written pricing columns, `price_valid_till`, `mapped_by`. The
snapshot and the `vendors` row are not touched.

**Response:** the full `mappedRow()` (`converted` always false; the screen
ignores the body) → same `finishMap()`.

### 13.6 Edge Cases and Known Gaps

* **Expired Valid Till:** the stored date is resent; once it is past, every Edit price fails with *Price Valid Till cannot be in the past.* (toast only) and there is no field to change it.
* **Silent no-op:** the pool is branch-scoped and filtered by the vendor's **current** country — a vendor converted in another branch, or whose country changed, is missing, so Update does nothing.
* A Domestic re-price can flip *intra* ↔ *inter* when a user of a different branch edits it.
* PUT clears optional fields not sent and writes the directory without the email check; PUT doesn't update `mapped_by`, PATCH does.
* A Domestic New Supplier at 0 % GST reopens at 18 %.
* Editing one New Supplier card renames it on other targets too (shared `p2p_suppliers` row).

---

## 14. FEATURE 10 — THE MAPPED SUPPLIERS POPUP

### 14.1 Overview

Shows every supplier mapped to one product as a card, with price, GST and how it
compares to the target. From here the user can Edit, Convert, or Add Supplier.

### 14.2 Files Involved

| Layer | File · Function |
|---|---|
| Popup | `MappedSuppliers.tsx` → `MappedSuppliers()`, `toSup()`, `PriceRow()`, `VsTarget()`, `editOf()`, `masterEditOf()` |
| Owner | `SourcingTargetReport.tsx` (opens it); page's `converted` set |
| API | `GET /p2p/sourcing-targets/{code}/products/{id}/suppliers` |
| Backend | `SC::mappedSuppliers()` → `viewDenial()`, `mappedRow()`, `SupplierPricing::vsTarget()` |

### 14.3 Step-by-Step Flow

**Step 1 — Open** — the report's **Supplier Count** button (only when > 0).

**Step 2 — Load** — `GET …/products/12/suppliers` → `toSup()` → cards, newest first. Re-read when `refreshKey` changes.

**Step 3 — Header** — *Mapped Suppliers* + code pill; *"Sourcing Reference · <source> · Generated <today>"*; tiles Sourcing ID · Product Code · Product Name · Segment (if any) · Target Price (`inr()`) · Suppliers Mapped. Every tile value in `FitTip`.

**Step 4 — Each card** — index, initials, name, tags (*Domestic* / *International*, segment, *Master* / *New Supplier*), contact, mobile, email, `PriceRow()`, `VsTarget()`.

**Step 5 — Actions** (`.stsv-card-acts`, right edge, 8 px apart)
* **Edit** (canMap only) → New: `onEdit(editOf(s))`; Master: `onEdit(masterEditOf(s))`.
* **Convert to Supplier** (`s.canConvert`) → `onConvert(supplierId, name)` — shown to anyone who can open the report (no canMap check).
* **Converted** badge (`s.converted`) — title *This New Supplier is now in the Supplier Master*.

**Step 6 — Footer** — *"N suppliers mapped to <product>"*, **Close**, **Add Supplier** (canMap only — closes this popup and opens Map Supplier).

### 14.4 Backend Processing — `SC::mappedSuppliers()`

1. `target()`; `viewDenial()`; product (404).
2. `target` = the product's `target_price`, commas removed, as a float (null when empty).
3. `$converted` = `p2p_suppliers` `id → converted_vendor_id` for the product's `source = new` rows.
4. `$convertedVendorIds` = `converted_vendor_id`s that are among the product's `source = master` `supplier_id`s.
5. Rows `latest()` → `mappedRow()`.

**Row shape** (`mappedRow()`): `id`, `converted`, `supplier_id`, `name`,
`segment`, `contact`, `mobile`, `email`, `card`, `gmaps`, `address`, `country`,
`state`, `state_code`, `city`, `source`, `origin`, `currency`, `price`,
`gstPercentage`, `gstType`, `cgst`, `sgst`, `igst`, `gstAmount`, `total`,
`exchangeRate`, `inrAmount`, `validTill`, `vsTarget`, `mappedOn`, `canConvert`.

| Flag | Rule |
|---|---|
| `vsTarget` | `SupplierPricing::vsTarget(unit, target)`; unit = **ex-GST price** (domestic) or **INR amount** (international) — see Section 17 |
| `canConvert` | `source = new` and its directory entry has no `converted_vendor_id` |
| `converted` | `source = master` and the vendor is in `$convertedVendorIds` — **per vendor** |

### 14.5 Price Row

| Case | Shows |
|---|---|
| No price | *Price & GST not mapped for this supplier* |
| Domestic | Unit Price · GST % (*CGST a% + SGST a%* or *IGST x%*) · GST Amount · Price incl. GST + `VsTarget` · Valid Till |
| International | Origin + country · Unit Price (`money()`) · Exchange Rate · No GST · INR Equivalent + `VsTarget` |

`VsTarget` texts: *x% below target*, *x% above target*, *At target*.

### 14.6 Database

| Read | Written |
|---|---|
| `p2p_sourcing_targets`, `p2p_sourcing_products`, `p2p_sourcing_product_suppliers`, `p2p_suppliers` | nothing |

### 14.7 Edge Cases and Known Gaps

* A header comment says contact details are masked; they are not.
* The empty state (*No Suppliers Mapped*) can't be reached.
* There is no unmap.
* The Converted badge is per vendor, not per row.

---

## 15. FEATURE 11 — CONVERT A NEW SUPPLIER TO THE SUPPLIER MASTER

### 15.1 Overview

**Convert to Supplier** turns a New Supplier into a full Supplier Master record.
It opens the real **Add Supplier** wizard, prefilled. The **link happens at the
Contact Person step** (`VendorController::storeContacts()`); the final call only
confirms and copies the business card.

### 15.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `SourcingTracker.tsx` → `startConvert()`, `finishConvert()`, `closeConvert()`, `ConvertOpening` |
| Wizard | `AddVendorModal.tsx` (Supplier Management) — prefill `useEffect`, `saveContacts()`, `finishSupplier()` |
| API | `GET /p2p/new-suppliers/{id}/convert`, `POST /vendors/step/identity`, `POST /vendors/{id}/step/contacts` (`_method=PUT`), `POST /p2p/new-suppliers/{id}/convert` |
| Backend | `SC::convertPrefill()`, `VendorController::storeContacts()`, `SC::convertSupplier()` → `copyBusinessCard()` |

### 15.3 Access

| Layer | Rule |
|---|---|
| Frontend | the button shows on a card with `canConvert` — to **anyone** who can open the report |
| `convertPrefill()` / `convertSupplier()` | the New Supplier belongs to the user's client (else 404) |
| `storeContacts()` | vendor visible via `Vendor::forUser()` (else 404); New Supplier in the client and not converted into a **different** vendor (else 422) |

### 15.4 Frontend Flow at a Glance

```
startConvert(supplierId, name)
   close the report / mapped popup
   ConvertOpening "Opening Add Supplier — loading <name>'s details…"
   Promise.all([ GET /p2p/new-suppliers/{id}/convert, loadAddVendorModal() ])
   already converted → info toast, reopen the report
   else → <AddVendorModal scope prefill convertSupplierId canMapProducts={false}>

AddVendorModal:
   Identification tab   → POST /vendors/step/identity            (the vendor is created)
   Contact Person tab   → POST /vendors/{id}/step/contacts (_method=PUT) + convert_supplier_id
                      ══► THE LINK HAPPENS HERE (VendorController::storeContacts)
   … KYC steps → finishSupplier() → onSubmit(payload)

finishConvert(payload)
   POST /p2p/new-suppliers/{id}/convert { vendor_id }   (confirms; copies the card)
```

### 15.5 Step-by-Step Flow

**Step 1 — Click Convert** — `startConvert()` remembers the report row, shows the loader, closes the report.

**Step 2 — Load in parallel** — `GET /api/p2p/new-suppliers/{id}/convert` and the `AddVendorModal` code chunk.

**Step 3 — Server `SC::convertPrefill()`**
* `P2pSupplier` of the client (`findOrFail`);
* `country_id`, `state_id`, `segment_id` looked up **by name, ignoring case**;
* `origin` = stored or from the country; `sourcing_count` = number of `source = new` mapping rows.

```json
{ "status": true, "data": { "supplier_id": 5, "origin": "domestic", "converted": false,
  "converted_vendor_id": null, "sourcing_count": 3,
  "identity": { "company_name": "ABC Traders", "legal_name": "ABC Traders", "primary_email": "abc@example.com",
                "segment_id": 2, "segment": "Hardware", "gst_applicable": null },
  "address": { "address_line": "Plot 4, MIDC", "country_id": 1, "country": "India", "state_id": 14,
               "state": "Maharashtra", "state_code": "27", "city": "Pune", "google_location": "…",
               "contact_name": "Priya", "contact_no": "9876543210", "email": "abc@example.com",
               "is_primary": true },
  "business_card": "/storage/p2p/supplier-cards/c12/Xy…/card.jpg" } }
```

**Step 4 — Open the wizard**
* `converted: true` → toast *<name> is already in the Supplier Master — Its mappings show it as Master.*, report reopens.
* Failure → *Couldn't open Convert to Supplier — <message>*, report reopens.
* Else `AddVendorModal` with `scope` = origin, `prefill = { origin, identity, address }`, `convertSupplierId`, `canMapProducts={false}`. The `business_card` is **not** passed (it is copied later by `copyBusinessCard()`).

**Step 5 — What the wizard prefills**

| Prefilled | Not prefilled (user must fill) |
|---|---|
| Company Name, Legal Name, Segment, GST Applicable (*No* for International), Registered Office, Country, State, State Code, City, Google Location, Contact Person Name, Contact No, Email | Supplier type, website, GSTIN / TIN, risk level, supplier behaviour, compliance, pincode, address type, **Designation** (required), WhatsApp (defaults on), contact attachment, KYC, bank, GST scrutiny, trade documents |

A country / state / segment name with no master match stays empty.

**Step 6 — Identification → Save & Next** — `POST /api/vendors/step/identity` → the **vendor is created**. The wizard's own rules apply (e.g. Domestic State Code must be 1–2 digits). Toast *Identity saved*.

**Step 7 — Contact Person → Save & Next** — `saveContacts()`:

```
POST /api/vendors/{vendorId}/step/contacts     (multipart)
_method=PUT
primary_address[address_type]=…   primary_address[address_line]=Plot 4, MIDC
primary_address[country_id]=1     primary_address[state_id]=14     primary_address[state_code]=27
primary_address[city]=Pune        primary_address[pincode]=        primary_address[google_location]=…
primary_address[contact_name]=Priya   primary_address[designation]=Sales Manager
primary_address[contact_no]=9876543210   primary_address[email]=abc@example.com
primary_address[whatsapp_enabled]=1
primary_attachment=<file>  (or primary_address[attachment_path]=…)   — only if attached
convert_supplier_id=5
```

**Step 8 — Server `VendorController::storeContacts()` — THE LINK**
1. `Vendor::forUser($user)->findOrFail($id)` (404).
2. Validate (`primary_address` required; `contact_name` required; `email` valid; `google_location` starts with `http(s)://`; country / state exist; attachment `jpg,jpeg,png,webp,pdf`; `convert_supplier_id` `nullable|integer`).
3. `convert_supplier_id`: `P2pSupplier` of the client; missing or converted into **another** vendor → 422 `errors.convert_supplier_id` *This New Supplier cannot be converted into this supplier.* Else `Vendor::$convertingSupplierId = id`.
4. Transaction: replace the primary address; store the attachment; `vendors.primary_email` = lower(trim(email)). The unique-email check ignores this vendor, its converted New Suppliers and the converting one (`sameEmailOwnerRows()`) — any other owner → 422 `errors.primary_email`. `$convertingSupplierId` is reset in `finally`.
5. If not yet linked — second transaction, for **every** `source = new` row of this New Supplier (any target):
   * product already has this vendor as Master → **soft-delete** the New row (merge);
   * else **move** it: `source = master`, `supplier_id = vendor id`, `name = company_name` (contact / pricing snapshot kept).
   * Then `p2p_suppliers.converted_vendor_id`, `converted_at`, `converted_by`.
6. Toast *Contacts saved*; refusal → *Save failed — <message>*.

**Step 9 — KYC → finish** — `finishSupplier()`: at least one bank account, a GST scrutiny row when GST = Yes; toast *Supplier saved — S-031 — <name> completed and saved.* → `onSubmit(payload)`.

**Step 10 — `finishConvert(payload)`**
* No `vendorId` → *Supplier saved, not linked — … Open Convert to Supplier again to link it.*
* Else `POST /api/p2p/new-suppliers/5/convert` `{ "vendor_id": 88 }`.

**Step 11 — Server `SC::convertSupplier()`**
1. New Supplier of the client (404); `vendor_id` `required|integer` (*Save the supplier in the Supplier Master first.*).
2. `Vendor::where('client_id', client)->find(vendor_id)` — **client-scoped** — else 422 *Unknown supplier in the Supplier Master.*
3. Converted into another vendor → 422 *"<name>" is already converted to another supplier in the Supplier Master.*
4. Transaction: move / merge any `source = new` row still left (normally none) and stamp `converted_*` **again**.
5. `copyBusinessCard()` — only if the vendor's primary address has **no** attachment and the file exists → copy to `vendor_documents/{vendor_id}/contact-{8 hex}__{name}.{ext}`, set `vendor_addresses.attachment_path`.

```json
{ "status": true, "data": { "supplier_id": 5, "vendor_id": 88, "vendor_code": "S-088",
  "vendor_name": "ABC Traders", "mappings_moved": 0, "mappings_merged": 0,
  "business_card_copied": true, "message": "ABC Traders is now in the Supplier Master as S-088." } }
```

**Step 12 — Browser** — `converted` set += `new-5`; toast *Converted to Supplier — <message>*; `reportRefresh` +1; `reload()`; report reopens. The card now reads **Master** with **Converted**. Error → *Supplier saved, not linked — <reason>*.

### 15.6 Cancel

| When cancelled | Result |
|---|---|
| Before the Contacts step | New Supplier unchanged (Convert still shows). A vendor created at Identification **stays**, unlinked; a new attempt makes a second vendor |
| After the Contacts step | Already linked (mappings moved, `converted_*` set); business card **not** copied |

### 15.7 Database — What Convert Changes

| Table | Columns | When |
|---|---|---|
| `vendors` | new row; later `primary_email`, `step_completed`, … | wizard steps |
| `vendor_addresses` | primary contact row (re-inserted each Contacts save); `attachment_path` by `copyBusinessCard()` | Contacts step; final convert |
| `p2p_sourcing_product_suppliers` | `source` `new` → `master`, `supplier_id` → vendor, `name` → company name (move); or `deleted_at` (merge) | Contacts step; final convert (leftovers) |
| `p2p_suppliers` | `converted_vendor_id`, `converted_at`, `converted_by` | Contacts step; stamped again at final convert |
| public disk | `vendor_documents/{vendor}/contact-…` | final convert |

### 15.8 Edge Cases and Known Gaps

* No creator / assignee check anywhere in Convert.
* The move / merge code is duplicated in `storeContacts()` and `convertSupplier()`.
* Moved rows keep the New Supplier's contact / email / mobile / card snapshot.
* Two New Suppliers that shared a name share one directory entry and one Convert.
* *Supplier saved, not linked* can show though the link was already made at the Contacts step.
* `sourcing_count` counts mapping rows (the unused `/new-suppliers` list counts targets).
* A typed New Supplier state code may fail the wizard's *1–2 digit* rule; Designation must be typed.

---

## 16. FEATURE 12 — PRODUCT STATUS AND TARGET PROGRESS

### 16.1 Overview

A product becomes **Completed** when its first supplier is mapped. The target's
progress and status are **computed** from its products; the target's own status
column is never updated.

### 16.2 Who Changes the Status

| Action | Effect on `p2p_sourcing_products.status` |
|---|---|
| `SC::mapSupplier()` | → *Completed* (if not already) |
| Edit a mapping (PUT / PATCH) | no change |
| Convert (merge only when the vendor is already Master on that product) | no change |
| Edit target | no change |
| `PATCH …/products/{id}/status` (`setProductStatus()`) | either value — **no screen calls it** |

There is **no unmap**, so a Completed product never goes back.
`p2p_sourcing_targets.status` stays *In Progress* forever.

### 16.3 The Computation (same rule everywhere)

| Value | Rule | Where |
|---|---|---|
| done | products with status *Completed* | `row()`, `toProduct()` |
| progress % | `round(done × 100 / total)` (0 when no products) | `row()`, `progressOf()`, `productProgress()` |
| target status | *Completed* when total > 0 and done ≥ total, else *In Progress* | same |
| overdue | not complete and the due date's end of day has passed (server time zone) | `row()` |
| at risk | not complete, not overdue, ≤ 7 days left by the browser's date | `tatState()` |

### 16.4 UI Refresh

After a map, `finishMap()` bumps `reportRefresh` (report + Mapped Suppliers
reload) and calls `reload()` (progress bar, *X done · Y pending*, Mapped
Suppliers count, TAT colour).

### 16.5 Edge Cases

* Removing a still-pending product on Edit raises the %.
* The unused status PATCH can mark a product *In Progress* with suppliers still mapped.

---

## 17. PRICING ENGINE — `SupplierPricing`

### 17.1 Overview

All supplier money is computed **on the server** in
`app/Support/SupplierPricing.php`, called from `SC::sourcingPrice()`. The browser
only shows a preview.

### 17.2 Limits

```php
public const MAX_PRICE  = 9999999999.99;     // price (typing cap: 10 + 2 digits)
public const MAX_RATE   = 99999.9999;        // exchange rate (typing cap: 5 + 4 digits)
public const MAX_AMOUNT = 999999999999.99;   // total / INR value (assertFits)
```

### 17.3 `SC::sourcingPrice()` — Steps

1. `origin` = sent, else `originOf(country)`; must equal `originOf(country)` (blank or India → domestic).
2. **International:** `currency` = sent (upper-cased) else `currencyFor(country)`; INR → 422; `rate` = sent else `defaultRate()` (active `master_currencies` row, client's own before global); none → 422 → `international()`.
3. **Domestic:** home = the **user's branch** (`branches.state`, `branches.gst_state_code`); `gst_type` = sent, else `gstTypeFor()`; `gst %` = sent else 18 → `domestic()`.
4. `assertFits()`; add `price_valid_till` = `valid_till` or null.

### 17.4 GST Type

```php
public static function gstTypeFor(?string $supplierState, ?string $supplierStateCode,
                                  ?string $ourState, ?string $ourStateCode): string
{
    $a = trim((string) $supplierStateCode);
    $b = trim((string) $ourStateCode);
    if ($a !== '' && $b !== '') {
        return strcasecmp($a, $b) === 0 ? self::GST_INTRA : self::GST_INTER;
    }
    $s = trim((string) $supplierState);
    $o = trim((string) $ourState);
    return ($s !== '' && $o !== '' && strcasecmp($s, $o) === 0) ? self::GST_INTRA : self::GST_INTER;
}
```

**Processing Explanation:**
1. If both state **codes** are known, compare codes.
2. Else compare state **names**.
3. If anything is missing → *inter* (IGST).

### 17.5 Domestic Calculation

```php
$price = round($price, 2);
$gst   = round($price * $gstPct / 100, 2);
$half  = round($gst / 2, 2);
$total = round($price + $gst, 2);
// intra: cgst = half, sgst = gst - half, igst = 0
// inter: cgst = 0, sgst = 0, igst = gst
// total_amount = inr_amount = total; currency_code = 'INR'; exchange_rate = null
```

**Example:** price 100, GST 18 %, intra → GST 18.00, CGST 9.00, SGST 9.00,
total 118.00.

### 17.6 International Calculation

```php
'exchange_rate' => round($rate, 4),
'price'         => round($price, 2),
'gst_*'         => 0, 'gst_type' => 'none',
'total_amount'  => $price,
'inr_amount'    => round($price * $rate, 2),
```

**Example:** USD 250 at 84.2 → INR 21,050.00.

### 17.7 Compared With the Target — `vsTarget()`

```php
if (! $unitInr || ! $target || $target <= 0) return null;
$pct = round(($unitInr - $target) / $target * 100, 2);
return [
    'target'     => round($target, 2),
    'difference' => round($unitInr - $target, 2),
    'percent'    => abs($pct),
    'status'     => abs($pct) < 0.005 ? 'at' : ($pct < 0 ? 'below' : 'above'),
];
```

`unitInr` = the ex-GST price (domestic) or the INR amount (international).

### 17.8 Too-Large Guard — `assertFits()`

If `total_amount` or `inr_amount` > `MAX_AMOUNT` → 422 `errors.price` *The total
value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.*

---

## 18. DESIGN PATTERNS USED

| Pattern | Where | Purpose |
|---|---|---|
| **The page owns the popups** | `SourcingTracker.tsx` state (Mapped Suppliers is owned by the Report) | Report, Map and Convert open and close each other without long prop chains |
| **Lazy loading** | Assign, Report, Product List, Map, `AddVendorModal` are `React.lazy` | Small first load; each popup's code arrives when it opens |
| **Refresh counters** | `reportRefresh`, `reloadKey` | After a save, bump a number; `useTargetReport` / the list refetch |
| **Single-flight saves** | `useSaveGuard` | A double click creates one record; the form locks while saving |
| **Upload first, then save** | Clarity files, business cards | The record stores a `/storage/…` path |
| **Typing caps = server caps** | `limitNum()` + `PRICE_INT/DEC`, `RATE_INT/DEC` | A price / rate can't be typed past what `SupplierPricing` accepts |
| **Snapshots** | Product name / segment / HSN; supplier contact | The target keeps what was true when it was made |
| **Server-computed money** | `sourcingPrice()` / `SupplierPricing` | The browser shows a preview; the server's numbers are stored |
| **Popup stack** | `usePopup` | Esc closes only the top popup; scroll lock is counted |
| **Quiet refetch** | list effect (`shownFor`, `lastServed`, `reqSeq`) | No shimmer blink on a page-size change; no stale answers |
| **Own CSS prefixes** | `sct-`, `sta-`, `stsrc-`, `str-`, `stpl-`, `stsv-`, `stmap-`, `stnf-`, `stsm-`, `stfile-` | `bulk-sourcing.css` is global — never reuse its class names |

---

## 19. TROUBLESHOOTING GUIDE

### 19.1 List and Target

| Symptom | Look in |
|---|---|
| A target is missing from "All" | `trackerList()` — "All" is created ∪ assigned only |
| Search doesn't find a date | `trackerList()` — only `yyyy-mm-dd` / `dd/mm/yyyy` of the **due** date |
| Wrong TAT colour | `tatState()` in `data.ts` (browser date) vs `row()` overdue (server time zone) |
| Progress / Completed looks wrong | `row()`, `progressOf()`; product status set in `mapSupplier()` |
| The list blinks to the shimmer | `SourcingTracker.tsx` list effect — quiet fetch covers only a page-size change |
| Someone can't be assigned | `teamMembers()` — onboarding stage ≥ 6, employee / user status, the **user's** branch |
| A department badge is missing or says "Branch Admin" | `teamMembers()` `department` |
| Edit shows View Only | `assigneeIsActive()` |
| A product can't be removed | It has suppliers — `update()` refuses |
| A target price is refused in the form | `AssignTargetModal.tsx priceBad()` or a server 422 `products.N.target_price` |
| A target price shows "…" | `inr()` + `FitTip`; cells `.str-price-cell`, `.stpl-price-cell`, `.stmap-ppill--price` |
| A price / rate stops accepting digits | `limitNum()` in `format.ts` — 10 + 2 for prices, 5 + 4 for rates |
| 500 on saving a target with a master product | `syncProducts()` — `p2p_sourcing_products.segment` is 128 chars; a segment name can be 255 |
| A master product shows its code as the name | Unknown code on save; `php artisan sourcing:backfill-product-names --apply` |
| A target needs to be deleted | Not possible — no route or UI |

### 19.2 Clarity

| Symptom | Look in |
|---|---|
| Clarity file won't open | `viewDocument()`, `downloadClarity()` path checks |
| 500 on clarity update | `updateProductClarity()` — `clarity_type` key missing (Bulk Sourcing) |

### 19.3 Mapping and Editing Suppliers

| Symptom | Look in |
|---|---|
| A supplier missing from the Supplier Master list | `suppliers()` — origin from the primary address's country; already mapped → disabled |
| "Already mapped" though not greyed out | CS-2308: a converted New Supplier row of that vendor is on the product |
| A dropdown wider / narrower than its field | `.stsm-sup-menu` (`supplier-master-form.css`) / `.stnf-ms-menu` (`map-supplier-modal.css`) |
| Wrong GST type / amount | `sourcingPrice()` home state (current user's branch); `SupplierPricing::domestic()`; New Supplier: sent `gst_type` |
| Wrong INR value | `SupplierPricing::international()`; the Currency master rate |
| Duplicate-email error | `EnforcesUniqueEmail` on `P2pSupplier` — system-wide (`config/email_uniqueness.php`) |
| Two New Suppliers merged into one | Directory reuse by `LOWER(name)` in `mapSupplier()` |
| Edit supplier & quote / Edit price refused under Valid Till | The saved (now past) date is resent |
| Edit price saved a different GST % | `SupplierMasterForm.tsx` GST-rate effect resets an inactive rate |
| Edit price does nothing, no message | `SupplierMasterForm.tsx save()` returns on `!sup` — vendor not in the branch-scoped pool |
| Editing one New Supplier renamed it on other targets | `updateSupplier()` updates the shared `p2p_suppliers` row |
| Edit reopens a 0 % GST supplier at 18 % | `MappedSuppliers.tsx editOf()` (`\|\| 18`) |

### 19.4 Convert

| Symptom | Look in |
|---|---|
| Convert didn't link | `VendorController::storeContacts()` (`convert_supplier_id`); then `finishConvert()` / `convertSupplier()` |
| Business card not copied | Wizard closed after Contacts — only `convertSupplier()` copies it; or the contact already had an attachment |
| A Master card shows "Converted" though mapped from the Supplier Master | `mappedSuppliers()` `$convertedVendorIds` — per vendor |
| Wizard refuses the prefilled State Code | Wizard rule (Domestic: 1–2 digits) |
| Someone who isn't creator / assignee converted | Convert has no creator / assignee check |

### 19.5 Styling

| Symptom | Look in |
|---|---|
| A Sourcing style changed another screen | A rule without its `st*` / `sct-` prefix; `bulk-sourcing.css` |

---

## 20. COMPLETE FLOW SUMMARY

### 20.1 End to End

```
Open Sourcing Tracker
   → Assign Sourcing Target (TAT, Assign To, products, target prices, clarity)
   → Save  → ST-005 created (status In Progress)
   → Assignee opens Sourcing Target Report
   → Map Supplier Directory
        ├─ Supplier Master → pick supplier → price → Save
        └─ New Supplier    → type details + quote → Save   (→ p2p_suppliers)
   → Product becomes Completed; target progress rises
   → Mapped Suppliers: compare prices vs target, Edit if needed
   → (optional) Convert to Supplier → Add Supplier wizard → linked at Contacts step
   → All products Completed → target shows Completed
```

### 20.2 One Save, Layer by Layer (Map Supplier)

```
MapSupplierModal.save()
  → POST /p2p/sourcing-targets/{code}/products/{id}/suppliers
  → SC::mapSupplier()  (access → validate → duplicate → sourcingPrice → assertFits)
  → INSERT p2p_sourcing_product_suppliers ; UPDATE p2p_sourcing_products.status
  → { supplierCount }
  → finishMap(): toast, reportRefresh + 1, reload()
```

---

## END OF DOCUMENT

| Item | Covered |
|---|---|
| File structure (backend, frontend, shared) | Section 2 |
| Every API route | Section 3 |
| Access rules | Sections 3.3 and each feature |
| 12 features: steps, validation, API, backend, database, response, gaps | Sections 5–16 |
| Pricing engine | Section 17 |
| Patterns | Section 18 |
| Troubleshooting | Section 19 |
| Complete flow | Section 20 |

**Related documents:** Sourcing Tracker Functional Documentation · Technical
Documentation · API Documentation.

**Verified against code up to:** commit `6170fa175`.

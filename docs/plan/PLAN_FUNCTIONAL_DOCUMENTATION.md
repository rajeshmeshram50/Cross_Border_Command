# PLAN MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Plans (subscription tiers & module gating)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
A **Plan** is a subscription tier the platform sells to tenants. It sets the price, billing cycle, limits (branches, users, storage), trial period, yearly discount, and — most importantly — **which modules/features it unlocks**. Super-admins build and maintain the plan catalogue; a client subscribes to a plan (via the Payment module), which stamps the client's plan and unlocks the corresponding modules for the client-admin.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Packaging | Bundle features into sellable tiers (Starter → Enterprise) |
| Module gating | A plan precisely controls which modules a tenant can use |
| Limits | Enforce branch/user caps per tier |
| Pricing flexibility | Monthly/quarterly/yearly with a yearly discount and trials |
| Merchandising | Featured badge, colour, "best for" copy for the pricing page |
| Governance | Deletion blocked while clients are on the plan |

### 1.3 Key Features
- **Plan catalogue** — carousel of plan cards with limits, modules and active-client counts.
- **Create / edit plan** — full form + a **Module Access** selector (per-module access level).
- **Module gating** — each plan lists its modules with an access level (Full / Limited / Add-on / Not Included).
- **Default modules** — some modules (Dashboard, Profile, Developers) are granted in every plan.
- **Client-facing selection** — clients compare and pick a plan on "My Plan" (checkout via Payments).
- **Lifecycle** — active/inactive status; hard delete guarded by client usage.

---

## 2. USER ROLES & PERMISSIONS

| Role | Access |
|---|---|
| **Super Admin** | Full — the "Plans" menu is theirs; creates/edits/deletes plans and sets module access |
| **Client Admin** | Sees "My Plan" (PlanSelection) to compare and subscribe; cannot edit the catalogue |
| Branch User | Walled to `/plan-blocked` when the plan is expired/missing |
| Others | No access |

### 2.1 Capability Matrix
| Feature | Super Admin | Client Admin | Others |
|---|---|---|---|
| View plan catalogue (`/plans`) | ✓ | ✗ | ✗ |
| Create / edit plan | ✓ | ✗ | ✗ |
| Set module access per plan | ✓ | ✗ | ✗ |
| Delete plan | ✓ (if unused) | ✗ | ✗ |
| Compare & subscribe (`/my-plan`) | — | ✓ | ✗ |

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Plan lifecycle & assignment

```
┌───────────────────────────────────────────────────────────────────┐
│                     PLAN CATALOGUE & ASSIGNMENT                     │
└───────────────────────────────────────────────────────────────────┘
   SUPER-ADMIN                                    CLIENT-ADMIN
        │                                              │
        ▼                                              │
┌──────────────────────────────┐                      │
│ CREATE / EDIT PLAN           │                      │
│ • name, price, period        │                      │
│ • limits (branches/users/    │                      │
│   storage), trial, discount  │                      │
│ • Module Access: cycle each  │                      │
│   module Not Included → Full │                      │
│   → Limited → Add-on         │                      │
│ • status active/inactive     │                      │
└──────────────┬───────────────┘                      │
               │ saved (plan + plan_modules)          │
               ▼                                       ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ CATALOGUE (active plans)     │──────► │ MY PLAN (PlanSelection)      │
│ shown to clients             │        │ • compare tiers              │
└──────────────────────────────┘        │ • pick cycle & pay (Payment) │
                                         └──────────────┬───────────────┘
                                                        │ verified payment
                                                        ▼
                                         ┌──────────────────────────────┐
                                         │ ACTIVATE (SubscriptionCtrl)  │
                                         │ • client.plan_id / plan_type │
                                         │ • unlock plan's modules →    │
                                         │   regrant admin permissions  │
                                         │ • enforce branch limit       │
                                         └──────────────────────────────┘
```

### 3.2 Access levels (per module, on a plan)
| Access level | Meaning | Persisted? |
|---|---|---|
| **Full** | Module unlocked with all actions | Yes |
| **Limited** | Module unlocked, restricted (view + basic) | Yes |
| **Add-on** | Optional/paid add-on marker | Yes |
| **Not Included** | Module excluded from the plan | **No** (filtered out on save) |
| *(is_default)* | Granted in every plan regardless (Dashboard, Profile, Developers) | n/a |

### 3.3 Pricing (applied at checkout, Payment module)
`amount = price × (month 1 / quarter 3 / year 12)`; yearly applies the plan's `yearly_discount`; +18% GST → total. Validity = now → +cycle.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Plans catalogue (`Plans.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Plans                                              [Back] [+ Add]  │
├───────────────────────────────────────────────────────────────────┤
│   ◄  ┌──────────┐  ┌──────────┐  ┌──────────┐  ►                   │
│      │ Starter  │  │  Basic   │  │   Pro ★  │                      │
│      │ Free     │  │ ₹1999/mo │  │ ₹4999/mo │                      │
│      │ Branches1│  │ Branch 5 │  │ Branch 25│                      │
│      │ Users 3  │  │ Users 15 │  │ Users 50 │                      │
│      │ ✓ modules│  │ ✓ modules│  │ ✓ modules│                      │
│      │ [Edit][X]│  │ [Edit][X]│  │ [Edit][X]│                      │
│      └──────────┘  └──────────┘  └──────────┘                      │
└───────────────────────────────────────────────────────────────────┘
```
Each card shows price/period, limits (branches/users/storage/support), an "Included Modules" tick list, trial/discount lines, active-client count, and a featured badge. Edit → AddPlan; Delete → SweetAlert2 confirm. A modal shows the full "Included Modules" list with access-level badges.

### 4.2 Screen: Add / Edit Plan (`AddPlan.tsx`)
Two-column layout with a live-preview card.
| Section | Fields |
|---|---|
| **A. Plan Details** | Name*, Price* (₹), Period*, Best For, Status*, Badge, Description, Featured toggle, Custom toggle, Colour |
| **B. Usage Limits** | Max Branches (∞ if blank), Max Users (∞), Storage Limit (e.g. `25GB`), Support Level, Trial Days, Yearly Discount % |
| **Module Access** | Searchable tile grid; click a tile to cycle **Not Included → Full → Limited → Add-on**; "All Full" / "Clear" bulk buttons; count shown |

Validation mirrors the API (name 2–100, price 0–99,999,999, storage pattern `^\d+(\.\d+)?\s?(KB|MB|GB|TB)$`, trial 0–365, discount 0–100). Footer: Cancel / Reset / Create-or-Update.

### 4.3 Screen: My Plan (`PlanSelection.tsx`)
Client-facing carousel with a billing-cycle toggle, current-plan pill (or expired alert), a "Suggested" highlight, the branch-keep modal (on downgrade), and the Razorpay payment modal. (Detailed in the Payment module docs.)

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Module gating | A plan unlocks exactly the modules in its `plan_modules` (full/limited); not-included excluded |
| 2 | Default modules | `is_default` modules (Dashboard, Profile, Developers) are granted in every plan |
| 3 | Access levels | Full/Limited/Add-on persist; Not Included is dropped on save |
| 4 | Slug | Auto-derived from name; unique; **not rewritten on edit** |
| 5 | Sort order | New plans get `max(sort_order)+1` |
| 6 | Pricing | period ×1/×3/×12; yearly discount on year; +18% GST (at checkout) |
| 7 | Delete guard | Cannot delete a plan that any client is on (422) |
| 8 | Assignment | Only subscription activation sets `client.plan_type = paid` |
| 9 | Global | Plans are platform-wide (no tenant scoping); catalogue is super-admin only |
| 10 | Free plan | Zero-price plan activates instantly (no checkout) |

---

## 6. STATUS MODELS

### 6.1 Plan status
`active` (shown to clients) / `inactive` (hidden from checkout).

### 6.2 Client plan state (on `clients`)
`plan_id` + `plan_type` (`free`/`paid`) + `plan_expires_at`. Set at activation; drives expiry redirects.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Slug on edit | Renaming a plan does not update its slug |
| Plan type | `plan_type` can't be flipped to paid via client edit — only via subscription |
| Free plan | Activation still sets `plan_type = paid` (no reset-to-free path) |
| Delete | Hard delete (no soft delete); blocked while clients reference the plan |
| Types | Frontend `Plan`/`Module` types are duplicated per file (no shared type) |

---

*Related documents: PLAN_TECHNICAL_DOCUMENTATION.md · PLAN_CODE_WALKTHROUGH.md · PLAN_API_DOCUMENTATION.md*

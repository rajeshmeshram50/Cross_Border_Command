# HR Menu — Permission Module Sheet

Permission-tree implementation for the HR module group, mirroring the IDIMS HR menu design.

---

## 1. What was added

A complete **HR** module tree (32 entries) was added to the existing `modules` table via [ModuleSeeder.php](database/seeders/ModuleSeeder.php). It uses the same 3-level convention as the existing **Master** tree:

```
Level 1 (root)              parent_id = null
└── Level 2 (categories)    parent_id = root.id
    └── Level 3 (leaves)    parent_id = category.id
```

Permissions can only be granted on **leaf** modules — the parents exist for visual grouping in the matrix and the sidebar.

---

## 2. Menu structure (matches the IDIMS screenshot)

### HR (root) — slug: `hr`, icon: `Users`, sort_order: 9

| Category | Slug | Icon | Leaves |
|---|---|---|---|
| **HRMS Command** | `hr.command` | `LayoutDashboard` | 2 |
| **HR Core** | `hr.core` | `Users` | 5 |
| **HR Operations** | `hr.operations` | `Workflow` | 3 |
| **Time & Pay Inputs** | `hr.time_pay` | `IndianRupee` | 5 |
| **Document & Evidence** | `hr.documents` | `FileText` | 8 |
| **AI Intelligence** | `hr.ai` | `Brain` | 2 |

### Full leaf-by-leaf reference

#### 🟦 HRMS Command (`hr.command`)
| Name | Slug | Icon |
|---|---|---|
| HRMS Overview | `hr.overview` | `LayoutGrid` |
| PIP | `hr.pip` | `ClipboardCheck` |

#### 🟦 HR Core (`hr.core`)
| Name | Slug | Icon |
|---|---|---|
| Employee | `hr.employee` | `User` |
| Department | `hr.department` | `Building2` |
| Designation | `hr.designation` | `BadgeCheck` |
| Role | `hr.role` | `UserCog` |
| KPI's | `hr.kpis` | `TrendingUp` |

#### 🟦 HR Operations (`hr.operations`)
| Name | Slug | Icon |
|---|---|---|
| Recruitment | `hr.recruitment` | `UserPlus` |
| Employee Onboarding | `hr.onboarding` | `UserCheck` |
| Exit Management | `hr.exit` | `LogOut` |

#### 🟦 Time & Pay Inputs (`hr.time_pay`)
| Name | Slug | Icon |
|---|---|---|
| Payroll | `hr.payroll` | `IndianRupee` |
| Calculation Master | `hr.calculation_master` | `Calculator` |
| Attendance | `hr.attendance` | `CalendarCheck` |
| Leave | `hr.leave` | `CalendarOff` |
| Expense Management | `hr.expense` | `Receipt` |

#### 🟦 Document & Evidence (`hr.documents`)

> ⚠️ The IDIMS screenshot shows a "MASTERS" sub-section header inside the Document column. The `modules` table is 3-level deep, so the four MASTERS items are added as **direct leaves** under `hr.documents` (with clear names). When the actual sidebar is built later, those four items can be visually grouped under a "MASTERS" header at render time without changing the data model.

| Name | Slug | Icon |
|---|---|---|
| Dashboard | `hr.doc_dashboard` | `LayoutGrid` |
| Templates | `hr.templates` | `FileText` |
| Policies | `hr.policies` | `BookOpen` |
| Broadcast Centre | `hr.broadcast` | `Megaphone` |
| Document Category | `hr.doc_category` | `FolderOpen` |
| Document Types | `hr.doc_types` | `FileBadge` |
| Doc Generation Rules | `hr.doc_gen_rules` | `Settings2` |
| Custom Fields | `hr.custom_fields` | `PlusSquare` |

#### 🟦 AI Intelligence (`hr.ai`)
| Name | Slug | Icon |
|---|---|---|
| HR Reports | `hr.reports` | `BarChart3` |
| AI Master | `hr.ai_master` | `Sparkles` |

---

## 3. Total module count

| Type | Count |
|---|---|
| Root | 1 (`hr`) |
| Categories | 6 |
| Leaves (grantable) | 25 |
| **Total in DB** | **32** |

Verified via tinker after seeding: `Total HR modules in DB: 32` ✅

---

## 4. How permissions work for these modules

Same as every other module:

- **Super admin** has implicit access to everything
- **Client admin** (after plan activation) can grant any HR leaf permission to branch users — subject to plan-module restrictions if HR is later wired into Plan modules
- **Main branch user** can grant HR leaves to other users in their own branch (via the BUG-17 fix)
- Each leaf supports the 7 standard flags: `can_view`, `can_add`, `can_edit`, `can_delete`, `can_export`, `can_import`, `can_approve`
- Parents (`hr`, `hr.command`, etc.) cannot have permissions — they only group leaves visually

---

## 5. Where it shows up

| Place | Status | Notes |
|---|---|---|
| Permissions matrix UI | ✅ Auto-shows | `Permissions.tsx` calls `/api/modules` which returns all `is_active=true` rows. The matrix renders nested via recursive `renderRow(mod, depth)` so 3 levels work today |
| Sidebar (live navigation) | ❌ Not yet | `MENU_ITEMS` in [resources/js/constants.ts](resources/js/constants.ts) doesn't include `hr` yet. Add when actual HR pages are built |
| Master controller / API routes | ❌ Not yet | These are permission stubs only. The actual HR CRUD endpoints (`/api/hr/employees`, `/api/hr/payroll`, etc.) need to be built when the corresponding features are implemented |

This is intentional — **permissions are scaffolded ahead of features** so admins can pre-configure access, and so plan-vs-module pricing can include HR before any HR page exists.

---

## 6. Files changed

| File | Change |
|---|---|
| [database/seeders/ModuleSeeder.php](database/seeders/ModuleSeeder.php) | Added `'HR'` to top-level array (sort_order 9, pushed Settings to 10 and Profile to 11). Appended a new `$hrCategories` + `$hrLeaves` block at the end mirroring the existing Master pattern (idempotent — uses `updateOrCreate`). |

**No migration was needed** — existing schema already supports nested modules via `parent_id`. The seeder is idempotent so re-running on a fresh database, on staging, or on production all produce the same result.

---

## 7. How to apply on production

```bash
# On the server
php artisan db:seed --class=ModuleSeeder --force
```

Existing modules are not duplicated (`updateOrCreate` matches on `slug`). New HR rows are inserted. If an HR module is already present (e.g. partial earlier seed), it is updated to match the latest definition.

---

## 8. Verification

After running the seeder:

```php
// Quick check via tinker
\App\Models\Module::where('slug', 'like', 'hr%')->count()
// → 32
```

Then open the Permissions page → pick a user → expand HR row in the matrix → all 6 categories with their leaves appear with checkboxes. Default (Dashboard, Profile) and Master remain unchanged.

---

## 9. Design rationale & deviations from the screenshot

| Screenshot shows | We did | Why |
|---|---|---|
| 6 column headers (HRMS COMMAND, HR CORE, …) | 6 categories with same names | 1:1 mapping |
| MASTERS sub-section under Document & Evidence | 4 leaves named clearly under `hr.documents` (Document Category, Document Types, etc.) | `modules` schema is 3-level deep; sub-section is a visual grouping done at render time, not in data |
| Each item shown as a coloured icon + label | Icons mapped to Lucide icon names (`UserCog`, `Briefcase`, etc.) | Frontend already uses Lucide; consistent with existing module icons |
| Items in a specific order in the design | Same order preserved via `sort_order` | Matches user expectation |

---

## 10. Next steps (NOT in this batch)

To make the HR menu actually clickable / functional in the live sidebar:

1. Add `'hr'` to `MENU_ITEMS` in [resources/js/constants.ts](resources/js/constants.ts) — with the same `roles` array as other modules
2. Add a router entry in `App.tsx` for `/hr` and the leaves
3. Build the actual HR feature pages and backend endpoints
4. Optionally wire HR modules into `PlanModule` so plans can include/exclude HR features

Until step 1 is done, the HR tree is **invisible in the sidebar** but **fully manageable in the Permissions page** — exactly what was requested.

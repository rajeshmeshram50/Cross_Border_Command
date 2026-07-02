# TRIGGER POINT MASTER — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Trigger Point Master
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: define (generic Master) → bind to a template → runtime keyword match. Files: `MasterController.php`, `Masters/TriggerPoints.php`, `masterConfigs.ts`, `TemplateForm.tsx`, `HrDocumentTemplateController.php`.

---

## 1. DEFINE (generic MasterController, slug `trigger_point`)

```php
// schema registration
'trigger_point' => ['fields' => [
    ['n'=>'module_name','t'=>'text','r'=>true],
    ['n'=>'description','t'=>'textarea'],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uFields' => ['module_name'], 'tenantScoped' => true],

// store($request, 'trigger_point')
$this->authorizeMaster($request, 'trigger_point', 'can_add');     // permission master.trigger_point
$data = $this->validatePayload(...);   // module_name required + case-insensitive tenant-unique; status in [Active,Inactive]
[$clientId,$branchId] = $this->resolveOwnership($request);        // super-admin may create globals
TriggerPoints::create($data + ['client_id'=>$clientId,'branch_id'=>$branchId,'created_by'=>$user->id]);
MasterBundleCache::bump();   // 201

// destroy: hierarchical denial gate; HARD delete (no deleted_at); no is_system lock for trigger_point
```

---

## 2. BIND A TEMPLATE (`TemplateForm.tsx`)

```tsx
const triggerPoints = (await api.get('/master/trigger_point')).data;   // options
// Step 2 required MasterSelect {value:id, label:module_name}
// validate: if (!triggerPointId) e.trigger_point_id = 'Select a lifecycle event'
// submit: { ..., trigger_point_id: triggerPointId || null }
```

---

## 3. RUNTIME MATCH (`HrDocumentTemplateController::matchForEmployee`)

```php
// GET /hr-document-templates/match?employee_id=N&trigger_keyword=onboarding
$ids = master_trigger_points
    ->whereRaw('LOWER(TRIM(module_name)) LIKE ?', ['%'.strtolower(trim($keyword)).'%'])
    ->pluck('id');
$templates = HrDocumentTemplate::where('status','Active')
    ->when($ids->isNotEmpty(), fn($q) => $q->whereIn('trigger_point_id', $ids))   // guard empty
    ->where('employee_category', $mappedCategory)
    ->where('role_type', $designationLevel)
    ->with('triggerPoint:id,module_name')
    ->get();
// legacy exact-match variant: trigger_point_name
```

Callers:
```tsx
// HrEmployeeOnboarding.tsx  → trigger_keyword: 'onboarding'
// HrExitManagement.tsx      → trigger_keyword: 'exit'  (and 'onboarding' for the vault)
// both render tpl.trigger_point?.module_name as the "Trigger: …" label
```

---

## 4. SEED CANON (migrations)
```
2026_05_14_000002  register module slug master.trigger_point (parent hr.documents); backfill permissions
2026_05_15_000000  seed Onboarding + Exit Management (per client + global)
2026_05_18_120000  consolidate → global (null,null) Onboarding/Exit Management/Promotion; repoint template FKs; drop per-client dups
2026_05_20_000003  seed Onboarding + Exit Process as platform rows (super_admin)
// effective global canon: Onboarding, Exit Management, Exit Process, Promotion
// ClientController::store also picks up canonical rows for new clients
```

---

## 5. AUTH & SCOPE
```php
authorizeMaster(): super_admin bypass; else permissions row on master.trigger_point
resolveOwnership(): super_admin body-driven (globals); client_admin → [client_id,null]; branch_user/employee → [client_id,branch_id]
applyScope(): MasterVisibility::applyReadScope → globals + own tenant
```

---

## 6. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Schema-driven CRUD | MasterController | One engine for ~50 masters |
| Case-insensitive tenant unique | validatePayload | No dup trigger names per tenant |
| Substring keyword match | matchForEmployee | Tolerant lifecycle matching |
| Global canon + repoint | consolidate migration | Every tenant shares the same triggers |

---

## 7. NOTES & CAVEATS
- Substring match can over-match (Pre-Onboarding, both Exit rows).
- No FK / soft delete / is_system — canonical rows deletable; deleting a used trigger orphans template links.
- Same name may exist globally and per branch.
- DB is PostgreSQL.

---

*Related documents: TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md · TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md · TRIGGER_POINT_API_DOCUMENTATION.md*

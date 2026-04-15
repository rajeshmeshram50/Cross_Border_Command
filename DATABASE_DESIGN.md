# Cross Border Command - Database Design Document
## Based on TenantOS/IGC SaaS Architecture

---

## 1. HIERARCHY FLOW

```
Super Admin (SaaS Owner)
    │
    ├── Client Admin (Organization Owner) ── [Payment Required to Activate]
    │       │
    │       ├── Client Users (Org-level managers/viewers)
    │       │
    │       ├── Main Branch ── [Can see ALL branches data]
    │       │       │
    │       │       ├── Branch Users / Employees
    │       │       └── Branch Users / Employees
    │       │
    │       ├── Branch 2
    │       │       ├── Branch Users / Employees
    │       │       └── Branch Users / Employees
    │       │
    │       └── Branch N...
    │
    ├── Client Admin 2 (Another Organization)
    │       └── ... same structure
    │
    └── Inactive Client ── [Blocked until payment]
```

---

## 2. USER FLOW (Step by Step)

### Step 1: Super Admin (Seeder)
- Added via `DatabaseSeeder` - hardcoded
- Has full platform access
- Manages all clients, plans, billing, permissions

### Step 2: Client Registration
- Admin creates a Client (Organization)
- Client gets `status: inactive` initially
- Client must complete payment to activate

### Step 3: Payment & Activation
- Client selects a Plan (Starter/Basic/Pro/Business/Enterprise)
- Completes payment (UPI/Card/NetBanking)
- On success → `status: active`
- Now client can access the platform

### Step 4: Client Adds Branches
- Client creates branches under their organization
- One branch can be marked as `is_main = true` (Main Branch)
- Main Branch users can see ALL branches' data

### Step 5: Branch Adds Employees/Users
- Branch Manager adds users (employees)
- Each user gets a role (Manager/Staff/Viewer/Intern)
- Users login with email + password

### Step 6: Permissions
- Admin assigns permissions to Client
- Client assigns permissions to Branch
- Branch assigns permissions to Users
- **Rule: Child cannot exceed Parent permissions**

---

## 3. DATABASE TABLES

### 3.1 `users` - SINGLE LOGIN TABLE (All user types)

This is the **ONE table for ALL logins** - Admin, Client, Branch User, Employee.

```sql
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    
    -- Identity
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password            VARCHAR(255) NOT NULL,
    phone               VARCHAR(20) NULL,
    
    -- Role & Hierarchy
    user_type           VARCHAR(20) NOT NULL DEFAULT 'branch_user',
                        -- 'super_admin', 'client_admin', 'client_user', 'branch_user'
    client_id           BIGINT NULL REFERENCES clients(id) ON DELETE CASCADE,
    branch_id           BIGINT NULL REFERENCES branches(id) ON DELETE CASCADE,
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
                        -- 'active', 'inactive', 'suspended', 'pending'
    
    -- Profile
    avatar              VARCHAR(500) NULL,
    designation         VARCHAR(255) NULL,
    
    -- Auth
    email_verified_at   TIMESTAMP NULL,
    remember_token      VARCHAR(100) NULL,
    last_login_at       TIMESTAMP NULL,
    last_login_ip       VARCHAR(45) NULL,
    
    -- Timestamps
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    deleted_at          TIMESTAMP NULL  -- Soft delete
);

-- Indexes
CREATE INDEX idx_users_user_type ON users(user_type);
CREATE INDEX idx_users_client_id ON users(client_id);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_status ON users(status);
```

**Who goes where:**
| user_type | client_id | branch_id | Who |
|-----------|-----------|-----------|-----|
| super_admin | NULL | NULL | SaaS Owner (seeder) |
| client_admin | 1 | NULL | Organization Owner |
| client_user | 1 | NULL | Org-level manager/viewer |
| branch_user | 1 | 3 | Branch employee/staff |

---

### 3.2 `clients` - Organizations/Companies

```sql
CREATE TABLE clients (
    id                  BIGSERIAL PRIMARY KEY,
    
    -- Organization Info
    org_name            VARCHAR(255) NOT NULL,
    unique_number       VARCHAR(50) NOT NULL UNIQUE,  -- Auto-generated: EA + timestamp
    email               VARCHAR(255) NOT NULL,
    phone               VARCHAR(20) NULL,
    website             VARCHAR(500) NULL,
    
    -- Address
    address             TEXT NULL,
    state               VARCHAR(100) NULL,
    district            VARCHAR(100) NULL,
    taluka              VARCHAR(100) NULL,
    
    -- Classification
    user_type           VARCHAR(50) NULL,  -- 'Business', 'Sports', 'Education', etc.
    sports              VARCHAR(100) NULL, -- If sports type
    
    -- Plan & Billing
    plan_id             BIGINT NULL REFERENCES plans(id),
    plan_type           VARCHAR(20) NOT NULL DEFAULT 'free',  -- 'free', 'paid'
    status              VARCHAR(20) NOT NULL DEFAULT 'inactive',
                        -- 'inactive' (needs payment), 'active', 'suspended'
    
    -- Branding (White Label)
    primary_color       VARCHAR(7) NULL DEFAULT '#4F46E5',
    secondary_color     VARCHAR(7) NULL DEFAULT '#10B981',
    logo                VARCHAR(500) NULL,
    
    -- Timestamps
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    deleted_at          TIMESTAMP NULL
);

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_plan_type ON clients(plan_type);
```

---

### 3.3 `branches` - Client Branches

```sql
CREATE TABLE branches (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Branch Info
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NULL,
    phone               VARCHAR(20) NULL,
    contact_person      VARCHAR(255) NULL,
    address             TEXT NULL,
    
    -- Hierarchy
    is_main             BOOLEAN NOT NULL DEFAULT FALSE,
                        -- TRUE = Main Branch (can see ALL branches data)
                        -- Only ONE per client
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
                        -- 'active', 'inactive'
    
    -- Timestamps
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    deleted_at          TIMESTAMP NULL
);

CREATE INDEX idx_branches_client_id ON branches(client_id);
CREATE INDEX idx_branches_is_main ON branches(is_main);
CREATE INDEX idx_branches_status ON branches(status);

-- Ensure only ONE main branch per client
CREATE UNIQUE INDEX idx_branches_one_main 
    ON branches(client_id) WHERE is_main = TRUE AND deleted_at IS NULL;
```

---

### 3.4 `plans` - Subscription Plans

```sql
CREATE TABLE plans (
    id                  BIGSERIAL PRIMARY KEY,
    
    name                VARCHAR(100) NOT NULL,  -- Starter, Basic, Pro, Business, Enterprise
    slug                VARCHAR(100) NOT NULL UNIQUE,
    price               DECIMAL(10,2) NOT NULL DEFAULT 0,
    period              VARCHAR(20) NOT NULL DEFAULT 'month', -- month, quarter, year
    
    -- Limits
    max_branches        INTEGER NULL,   -- NULL = unlimited
    max_users           INTEGER NULL,
    storage_limit       VARCHAR(20) NULL,  -- '1GB', '25GB', etc.
    support_level       VARCHAR(50) NULL,  -- 'Email', 'Priority', 'Dedicated'
    
    -- Display
    is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
    badge               VARCHAR(50) NULL,  -- 'Most Popular', 'Best Value'
    color               VARCHAR(7) NULL,
    description         TEXT NULL,
    best_for            VARCHAR(255) NULL,
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);
```

---

### 3.5 `plan_modules` - Which modules each plan includes

```sql
CREATE TABLE plan_modules (
    id                  BIGSERIAL PRIMARY KEY,
    plan_id             BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    module_id           BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    
    access_level        VARCHAR(20) NOT NULL DEFAULT 'full',
                        -- 'full', 'limited', 'addon', 'not_included'
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    
    UNIQUE(plan_id, module_id)
);
```

---

### 3.6 `modules` - Platform Modules (ERP features)

```sql
CREATE TABLE modules (
    id                  BIGSERIAL PRIMARY KEY,
    parent_id           BIGINT NULL REFERENCES modules(id),  -- For sub-modules
    
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(255) NOT NULL UNIQUE,
    icon                VARCHAR(100) NULL,
    description         TEXT NULL,
    
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);

-- Seed data example:
-- id=1, parent_id=NULL, name='Dashboard', slug='dashboard'
-- id=2, parent_id=NULL, name='Sales Matrix', slug='sales'
-- id=3, parent_id=2,    name='Customer Master', slug='sales_cust'
-- id=4, parent_id=2,    name='Sales CRM', slug='sales_crm'
-- id=5, parent_id=NULL, name='Procure to Pay', slug='p2p'
-- etc.
```

---

### 3.7 `permissions` - RBAC Permission Matrix

```sql
CREATE TABLE permissions (
    id                  BIGSERIAL PRIMARY KEY,
    
    -- Who
    user_id             BIGINT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id           BIGINT NULL REFERENCES clients(id) ON DELETE CASCADE,
    branch_id           BIGINT NULL REFERENCES branches(id) ON DELETE CASCADE,
    role                VARCHAR(50) NOT NULL,
                        -- 'client_admin', 'branch_manager', 'staff', 'viewer'
    
    -- What
    module_id           BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    
    -- CRUD
    can_view            BOOLEAN NOT NULL DEFAULT FALSE,
    can_add             BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit            BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete          BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);

CREATE INDEX idx_permissions_client ON permissions(client_id, role);
CREATE INDEX idx_permissions_user ON permissions(user_id);
CREATE INDEX idx_permissions_module ON permissions(module_id);
```

**Permission Hierarchy Rule:**
```
Admin gives to Client Admin  →  Client Admin gives to Branch Manager
→  Branch Manager gives to Staff/Viewer

Child can NEVER exceed Parent permissions.
```

---

### 3.8 `payments` - Payment & Transaction History

```sql
CREATE TABLE payments (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    plan_id             BIGINT NOT NULL REFERENCES plans(id),
    
    -- Transaction
    txn_id              VARCHAR(100) NOT NULL UNIQUE,
    amount              DECIMAL(10,2) NOT NULL,
    gst                 DECIMAL(10,2) NOT NULL DEFAULT 0,
    total               DECIMAL(10,2) NOT NULL,
    
    -- Payment Method
    method              VARCHAR(50) NOT NULL,  -- 'upi', 'credit_card', 'net_banking'
    card_info           VARCHAR(100) NULL,     -- masked: '**** 4521' or 'rajesh@upi'
    
    -- Billing Cycle
    billing_cycle       VARCHAR(20) NULL,      -- 'monthly', 'yearly'
    valid_from          DATE NULL,
    valid_until         DATE NULL,
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
                        -- 'pending', 'success', 'failed', 'expired', 'refunded'
    
    -- Meta
    gateway_response    JSONB NULL,
    notes               TEXT NULL,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);

CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_txn ON payments(txn_id);
```

---

### 3.9 `departments` - Branch Departments

```sql
CREATE TABLE departments (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    branch_id           BIGINT NULL REFERENCES branches(id) ON DELETE CASCADE,
    
    name                VARCHAR(255) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    deleted_at          TIMESTAMP NULL
);
```

---

### 3.10 `user_details` - Extended User Profile

```sql
CREATE TABLE user_details (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    
    -- Personal
    gender              VARCHAR(20) NULL,
    date_of_birth       DATE NULL,
    blood_group         VARCHAR(10) NULL,
    
    -- Employment
    employee_id         VARCHAR(50) NULL,
    department_id       BIGINT NULL REFERENCES departments(id),
    role_level          VARCHAR(20) NULL,  -- 'manager', 'employee', 'intern'
    joining_date        DATE NULL,
    
    -- Salary
    basic_salary        DECIMAL(10,2) NULL,
    hra                 DECIMAL(10,2) NULL,
    da                  DECIMAL(10,2) NULL,
    gross_salary        DECIMAL(10,2) NULL,
    
    -- Documents
    aadhaar_number      VARCHAR(20) NULL,
    pan_number          VARCHAR(20) NULL,
    
    -- Emergency
    emergency_contact   VARCHAR(255) NULL,
    emergency_phone     VARCHAR(20) NULL,
    
    -- Address
    current_address     TEXT NULL,
    permanent_address   TEXT NULL,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);
```

---

### 3.11 `approval_queue` - Maker-Checker-Approver

```sql
CREATE TABLE approval_queue (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    branch_id           BIGINT NULL REFERENCES branches(id),
    
    -- What
    type                VARCHAR(50) NOT NULL,  -- 'branch_user', 'hr_employee', 'document'
    title               VARCHAR(255) NOT NULL,
    description         TEXT NULL,
    data                JSONB NULL,            -- Submitted form data
    
    -- Who
    submitted_by        BIGINT NOT NULL REFERENCES users(id),
    approver_id         BIGINT NULL REFERENCES users(id),
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
                        -- 'draft', 'pending', 'in_progress', 'approved', 'rejected'
    priority            VARCHAR(20) NOT NULL DEFAULT 'medium',
                        -- 'low', 'medium', 'high'
    comment             TEXT NULL,
    
    approved_at         TIMESTAMP NULL,
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);

CREATE INDEX idx_approval_client ON approval_queue(client_id, status);
CREATE INDEX idx_approval_submitted ON approval_queue(submitted_by);
```

---

### 3.12 `activity_logs` - System Activity Log

```sql
CREATE TABLE activity_logs (
    id                  BIGSERIAL PRIMARY KEY,
    
    user_id             BIGINT NULL REFERENCES users(id),
    client_id           BIGINT NULL REFERENCES clients(id),
    
    action              VARCHAR(100) NOT NULL,  -- 'login', 'create_client', 'update_branch', etc.
    target_type         VARCHAR(100) NULL,       -- 'client', 'branch', 'user', etc.
    target_id           BIGINT NULL,
    description         TEXT NULL,
    ip_address          VARCHAR(45) NULL,
    user_agent          TEXT NULL,
    
    created_at          TIMESTAMP NULL
);

CREATE INDEX idx_activity_user ON activity_logs(user_id);
CREATE INDEX idx_activity_client ON activity_logs(client_id);
CREATE INDEX idx_activity_created ON activity_logs(created_at);
```

---

### 3.13 `client_settings` - Per-Client Configuration

```sql
CREATE TABLE client_settings (
    id                  BIGSERIAL PRIMARY KEY,
    client_id           BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    key                 VARCHAR(100) NOT NULL,
    value               TEXT NULL,
    
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    
    UNIQUE(client_id, key)
);

-- Example keys:
-- 'privacy_policy', 'about_us', 'contact_info', 'security_2fa_enabled'
-- 'white_label_enabled', 'approval_mode' (default/custom)
```

---

## 4. ENTITY RELATIONSHIP DIAGRAM

```
plans ──────────┐
                │
clients ────────┤──── payments
  │             │
  │        plan_modules ──── modules (self-referencing parent_id)
  │                              │
  ├── branches                   │
  │     │                   permissions
  │     ├── departments          │
  │     │                        │
  │     └── users (branch_user)──┘
  │           │
  │           └── user_details
  │
  ├── users (client_admin, client_user)
  │
  ├── approval_queue
  │
  ├── client_settings
  │
  └── activity_logs
```

---

## 5. SEEDER ORDER

Run seeders in this order:

1. **PlansSeeder** - Create 6 plans (Starter, Basic, Pro, Business, Enterprise, Custom)
2. **ModulesSeeder** - Create all modules + sub-modules
3. **PlanModulesSeeder** - Link plans to modules with access levels
4. **AdminSeeder** - Create Super Admin user
5. **(Optional) DummyDataSeeder** - Create sample clients, branches, users for testing

---

## 6. LOGIN LOGIC (Single Table)

```php
// Login Controller Logic:
$user = User::where('email', $request->email)->first();

if (!$user || !Hash::check($request->password, $user->password)) {
    return error('Invalid credentials');
}

// Check user type and redirect
switch ($user->user_type) {
    case 'super_admin':
        // Full access - admin dashboard
        break;
    
    case 'client_admin':
    case 'client_user':
        // Check if client is active
        if ($user->client->status !== 'active') {
            return redirect('activate-account');
        }
        break;
    
    case 'branch_user':
        // Check if client AND branch are active
        if ($user->client->status !== 'active') {
            return error('Organization inactive');
        }
        if ($user->branch->status !== 'active') {
            return error('Branch inactive');
        }
        // Check if Main Branch
        $isMainBranch = $user->branch->is_main;
        break;
}
```

---

## 7. KEY BUSINESS RULES

| Rule | Description |
|------|-------------|
| **One Login Table** | All users (admin, client, branch) login from `users` table |
| **Client Activation** | Client must pay before accessing platform |
| **One Main Branch** | Only 1 branch per client can be `is_main = true` |
| **Main Branch Visibility** | Main branch users see ALL branches' data |
| **Permission Inheritance** | Child permissions cannot exceed parent |
| **Plan Module Lock** | Modules not in plan show as locked |
| **Maker-Checker** | Branch submits → Client Admin approves → Goes live |
| **Soft Delete** | Users, clients, branches use `deleted_at` for soft delete |

---

## 8. MIGRATION FILES NEEDED

```
2026_04_14_000001_create_plans_table
2026_04_14_000002_create_modules_table
2026_04_14_000003_create_plan_modules_table
2026_04_14_000004_create_clients_table
2026_04_14_000005_create_branches_table
2026_04_14_000006_create_departments_table
2026_04_14_000007_create_users_table  (modify existing)
2026_04_14_000008_create_user_details_table
2026_04_14_000009_create_permissions_table
2026_04_14_000010_create_payments_table
2026_04_14_000011_create_approval_queue_table
2026_04_14_000012_create_activity_logs_table
2026_04_14_000013_create_client_settings_table
```

---

*Document Version: 1.0*
*Project: Cross_Border_Command*
*Database: PostgreSQL 18*
*Framework: Laravel 12*

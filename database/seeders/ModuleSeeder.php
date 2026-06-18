<?php

namespace Database\Seeders;

use App\Models\Module;
use Illuminate\Database\Seeder;

class ModuleSeeder extends Seeder
{
    public function run(): void
    {
        // Top-level modules (parent_id = null)
        // Keep original ones & add Master as new parent.
        $topLevel = [
            ['name' => 'Dashboard',   'slug' => 'dashboard',   'icon' => 'LayoutGrid',  'sort_order' => 1,  'is_default' => true],
            ['name' => 'Clients',     'slug' => 'clients',     'icon' => 'Building2',   'sort_order' => 2,  'is_default' => false, 'description' => 'Manage client organizations'],
            ['name' => 'Branches',    'slug' => 'branches',    'icon' => 'GitBranch',   'sort_order' => 3,  'is_default' => false, 'description' => 'Manage branches/companies'],
            ['name' => 'Employees',   'slug' => 'employees',   'icon' => 'UserCheck',   'sort_order' => 4,  'is_default' => false, 'description' => 'Employee management'],
            ['name' => 'Plans',       'slug' => 'plans',       'icon' => 'CreditCard',  'sort_order' => 5,  'is_default' => false, 'description' => 'Subscription plans'],
            ['name' => 'Payments',    'slug' => 'payments',    'icon' => 'IndianRupee', 'sort_order' => 6,  'is_default' => false, 'description' => 'Payment transactions'],
            ['name' => 'Permissions', 'slug' => 'permissions', 'icon' => 'ShieldCheck', 'sort_order' => 7,  'is_default' => false, 'description' => 'Access control'],
            ['name' => 'Master',      'slug' => 'master',      'icon' => 'Database',    'sort_order' => 8,  'is_default' => false, 'description' => 'Master data control center'],
            ['name' => 'HRMS',        'slug' => 'hr',          'icon' => 'Users',       'sort_order' => 9,  'is_default' => false, 'description' => 'Human resources, payroll, attendance & policies'],
            ['name' => 'Sales Matrix','slug' => 'sales',       'icon' => 'TrendingUp',  'sort_order' => 10, 'is_default' => false, 'description' => 'Sales insights, customer masters & opportunity operations'],
            ['name' => 'CLM',         'slug' => 'clm',         'icon' => 'FileText',    'sort_order' => 11, 'is_default' => false, 'description' => 'Contract Lifecycle Management — operations, masters & analytics'],
            ['name' => 'Settings',    'slug' => 'settings',    'icon' => 'Settings',    'sort_order' => 12, 'is_default' => false, 'description' => 'System settings'],
            ['name' => 'Profile',     'slug' => 'profile',     'icon' => 'UserCircle',  'sort_order' => 13, 'is_default' => true],
            // New top-level header modules — permission-gated, page-less for
            // now (frontend renders a stub). P2P is promoted from a Sales
            // Insights leaf to its own module; the rest are new placeholders.
            ['name' => 'Credentials Vault',            'slug' => 'credentials-vault', 'icon' => 'KeyRound',    'sort_order' => 14, 'is_default' => false, 'description' => 'Central store for tenant credentials, secrets & access keys'],
            ['name' => 'Project Navigator',            'slug' => 'project-navigator', 'icon' => 'Compass',     'sort_order' => 15, 'is_default' => false, 'description' => 'Cross-module project workspace'],
            ['name' => 'Procure to Pay (P2P)',         'slug' => 'p2p',               'icon' => 'ShoppingBag', 'sort_order' => 16, 'is_default' => false, 'description' => 'Procure-to-pay summary & operations'],
            ['name' => 'GTS (E-Docs)',                 'slug' => 'gts',               'icon' => 'Globe',       'sort_order' => 17, 'is_default' => false, 'description' => 'Global trade services & electronic trade documents'],
            ['name' => 'Inventory Management System',  'slug' => 'inventory',         'icon' => 'Boxes',       'sort_order' => 18, 'is_default' => false, 'description' => 'Stock, warehouse & movement tracking'],
            ['name' => 'Developers',                   'slug' => 'developers',        'icon' => 'Code',        'sort_order' => 19, 'is_default' => false, 'description' => 'Operational tooling — Business Task (Shipment) list'],
        ];

        foreach ($topLevel as $mod) {
            Module::updateOrCreate(['slug' => $mod['slug']], $mod + ['parent_id' => null]);
        }

        // Master category parents (level 2)
        $master = Module::where('slug', 'master')->first();

        $categories = [
            ['name' => 'Identity & Entity',     'slug' => 'master.identity',     'icon' => 'IdCard',      'description' => 'Legal identity, entity & organization'],
            ['name' => 'Geography & Location', 'slug' => 'master.geography',    'icon' => 'Globe',       'description' => 'Countries, states, ports & addresses'],
            ['name' => 'Trade & Commercial',    'slug' => 'master.trade',        'icon' => 'TrendingUp',  'description' => 'HSN, GST, currency, units, incoterms'],
            ['name' => 'Party & Classification', 'slug' => 'master.party',       'icon' => 'Users',       'description' => 'Customer, vendor and party types'],
            ['name' => 'Legal & Compliance',    'slug' => 'master.legal',        'icon' => 'Scale',       'description' => 'Licenses, risk, documents, hazards'],
            ['name' => 'Operations & Support',  'slug' => 'master.operations',   'icon' => 'Wrench',      'description' => 'Assets and asset categories'],
            ['name' => 'P2P Masters',           'slug' => 'master.p2p',          'icon' => 'Handshake',   'description' => 'Procure-to-pay configuration'],
            ['name' => 'Warehouse Masters',     'slug' => 'master.warehouse',    'icon' => 'Warehouse',   'description' => 'Warehouse, zones, racks, freezers'],
            ['name' => 'Attendance Master Management', 'slug' => 'master.attendance', 'icon' => 'CalendarCheck', 'description' => 'Branch attendance configuration: leave types & leave plans'],
        ];

        $catIds = [];
        foreach ($categories as $i => $cat) {
            $row = Module::updateOrCreate(
                ['slug' => $cat['slug']],
                $cat + ['parent_id' => $master->id, 'sort_order' => $i + 1, 'is_active' => true, 'is_default' => false]
            );
            $catIds[$cat['slug']] = $row->id;
        }

        // Leaf masters (level 3) grouped by category slug.
        // Slugs are prefixed with `master.` so they don't collide with existing top-level slugs.
        $leaves = [
            'master.identity' => [
                ['name' => 'Organization Types','slug' => 'master.organization_types','icon' => 'Building',       'description' => 'Client organization categories (Business, Sports, NGO…)'],
                ['name' => 'Company Details',   'slug' => 'master.company',           'icon' => 'Building',       'description' => 'Legal identity: GSTIN, PAN, IEC'],
                ['name' => 'Bank Accounts',     'slug' => 'master.bank_accounts',     'icon' => 'Landmark',       'description' => 'Bank registry for export (SWIFT + AD code)'],
                ['name' => 'Departments',       'slug' => 'master.departments',       'icon' => 'Building2',      'description' => 'Organizational units for staff assignment'],
                ['name' => 'Roles',             'slug' => 'master.roles',             'icon' => 'UserCog',        'description' => 'Access roles for module control'],
                ['name' => 'Designations',      'slug' => 'master.designations',      'icon' => 'BadgeCheck',     'description' => 'Job titles on HR docs and letters'],
                ['name' => 'Employees',         'slug' => 'master.employees',         'icon' => 'Users',          'description' => 'Employee master with login provisioning'],
                ['name' => 'KPIs',              'slug' => 'master.kpis',              'icon' => 'Target',         'description' => 'KPI catalogue mapped to roles'],
                ['name' => 'Legal Entities',    'slug' => 'master.legal_entities',    'icon' => 'Scale',          'description' => 'Registered legal entities + bank accounts'],
            ],
            'master.geography' => [
                ['name' => 'Countries',         'slug' => 'master.countries',         'icon' => 'Globe2',         'description' => 'Country master for trade documents'],
                ['name' => 'States',            'slug' => 'master.states',            'icon' => 'Map',            'description' => 'States for address & GST place-of-supply'],
                ['name' => 'State Codes',       'slug' => 'master.state_codes',       'icon' => 'Hash',           'description' => '2-digit GST state codes'],
                ['name' => 'Address Types',     'slug' => 'master.address_types',     'icon' => 'Home',           'description' => 'Billing, shipping, registered address tags'],
                ['name' => 'Ports of Loading',  'slug' => 'master.port_of_loading',   'icon' => 'Anchor',         'description' => 'Origin ports on shipping bills'],
                ['name' => 'Ports of Discharge','slug' => 'master.port_of_discharge', 'icon' => 'Ship',           'description' => 'Destination ports on packing lists'],
            ],
            'master.trade' => [
                ['name' => 'Segments',              'slug' => 'master.segments',            'icon' => 'Target',        'description' => 'Business segments for orders & products'],
                ['name' => 'HSN Codes',             'slug' => 'master.hsn_codes',           'icon' => 'Binary',        'description' => '8-digit commodity codes for GST/customs'],
                ['name' => 'GST Percentages',       'slug' => 'master.gst_percentage',      'icon' => 'Percent',       'description' => 'GST tax slabs applied on invoices'],
                ['name' => 'Currencies',            'slug' => 'master.currencies',          'icon' => 'DollarSign',    'description' => 'Active currencies with exchange rates'],
                ['name' => 'Units of Measurement',  'slug' => 'master.uom',                 'icon' => 'Ruler',         'description' => 'Units (Kg, Box, Pcs) for products'],
                ['name' => 'Packaging Materials',   'slug' => 'master.packaging_material',  'icon' => 'Package',       'description' => 'Box, carton & wrapping types'],
                ['name' => 'Product Conditions',    'slug' => 'master.conditions',          'icon' => 'Leaf',          'description' => 'Storage states: organic, fresh, frozen'],
                ['name' => 'Incoterms',             'slug' => 'master.incoterms',           'icon' => 'Handshake',     'description' => 'Trade terms: FOB, CIF, EXW etc.'],
            ],
            'master.party' => [
                ['name' => 'Customer Types',          'slug' => 'master.customer_types',           'icon' => 'UserSquare',   'description' => 'Classify buyers: domestic/export'],
                ['name' => 'Customer Classifications','slug' => 'master.customer_classifications', 'icon' => 'Award',        'description' => 'Tier labels for credit & discount'],
                ['name' => 'Vendor Types',            'slug' => 'master.vendor_types',             'icon' => 'Store',        'description' => 'Supplier categories'],
                ['name' => 'Vendor Behaviour',        'slug' => 'master.vendor_behaviour',         'icon' => 'Activity',     'description' => 'Performance tags for vendors'],
                ['name' => 'Applicable Parties',      'slug' => 'master.applicable_types',         'icon' => 'Users2',       'description' => 'Buyer, consignee, notify party roles'],
            ],
            'master.legal' => [
                ['name' => 'License Types',          'slug' => 'master.license_name',             'icon' => 'FileBadge',     'description' => 'Import/export license categories'],
                ['name' => 'Risk Levels',            'slug' => 'master.risk_levels',              'icon' => 'Zap',           'description' => 'Risk severity tags for screening'],
                ['name' => 'Document Types',         'slug' => 'master.document_type',            'icon' => 'FileText',      'description' => 'Document categories for upload'],
                ['name' => 'Hazard Classifications', 'slug' => 'master.haz_class',                'icon' => 'AlertTriangle', 'description' => 'GHS/UN hazard classes'],
                ['name' => 'Compliance Behaviours',  'slug' => 'master.compliance_behaviours',    'icon' => 'Scale',         'description' => 'Rules for regulated substances'],
            ],
            'master.operations' => [
                ['name' => 'Assets',             'slug' => 'master.assets',             'icon' => 'Briefcase',    'description' => 'Company equipment & assets'],
                ['name' => 'Asset Categories',   'slug' => 'master.asset_categories',   'icon' => 'Tags',         'description' => 'Group assets by type & depreciation'],
                ['name' => 'Expense Categories', 'slug' => 'master.expense_category',   'icon' => 'IndianRupee',  'description' => 'Classify expenses with monthly & yearly policy limits'],
            ],
            'master.p2p' => [
                ['name' => 'Payment Terms',               'slug' => 'master.payment_terms',         'icon' => 'CalendarDays',  'description' => 'Credit days, advance %, milestone structure'],
                ['name' => 'Approval Authority',          'slug' => 'master.approval_authority',    'icon' => 'ShieldUser',    'description' => 'Value threshold for approvals'],
                ['name' => 'Procurement Category',        'slug' => 'master.procurement_category',  'icon' => 'Boxes',         'description' => 'Goods/Services/AMC match logic'],
                ['name' => 'Sourcing Type',               'slug' => 'master.sourcing_type',         'icon' => 'Tag',           'description' => 'Direct, open market, spot, rate contract'],
                ['name' => 'Override / Deviation Reason', 'slug' => 'master.deviation_reason',      'icon' => 'AlertOctagon',  'description' => 'Locked picklist for overrides'],
                ['name' => 'Match Exception Type',        'slug' => 'master.match_exception',       'icon' => 'GitCompare',    'description' => 'Exceptions for 3-way match engine'],
                ['name' => 'Advance Payment Rules',       'slug' => 'master.advance_payment_rules', 'icon' => 'CreditCard',    'description' => 'Max advance % per vendor type'],
                ['name' => 'Currency Exchange Rate Log',  'slug' => 'master.exchange_rate_log',     'icon' => 'Repeat',        'description' => 'Date-wise exchange rate history'],
                ['name' => 'Goods vs Service Flag',       'slug' => 'master.goods_service_flag',    'icon' => 'ToggleRight',   'description' => 'Switches GRN logic: goods vs service'],
                ['name' => 'Vendor Directory',            'slug' => 'master.vendor_directory',      'icon' => 'BookUser',      'description' => 'Vendor info & document verification'],
            ],
            'master.warehouse' => [
                ['name' => 'Warehouse Master',          'slug' => 'master.warehouse_master',   'icon' => 'Warehouse',     'description' => 'All warehouse locations (own & third party)'],
                ['name' => 'Zone Master',               'slug' => 'master.zone_master',        'icon' => 'Grid3X3',       'description' => 'Storage zones: cold chain, hazmat, dispatch'],
                ['name' => 'Rack Type Master',          'slug' => 'master.rack_type_master',   'icon' => 'Layers',        'description' => 'Rack types: pallet, cool, hazardous'],
                ['name' => 'Temperature Class Master',  'slug' => 'master.temp_class_master',  'icon' => 'Thermometer',   'description' => 'Ambient, cold chain, frozen classes'],
                ['name' => 'Rack & Location Master',    'slug' => 'master.racks',              'icon' => 'Rows3',         'description' => 'Warehouse → Zone → Rack → Shelf'],
                ['name' => 'Shelf / Level Master',      'slug' => 'master.shelf_master',       'icon' => 'RowsIcon',      'description' => 'Shelves/levels inside each rack'],
                ['name' => 'Digital Twin',              'slug' => 'master.digital_twin',       'icon' => 'Monitor',       'description' => 'Visual warehouse location view'],
                ['name' => 'Freezer Management',        'slug' => 'master.freezers',           'icon' => 'Snowflake',     'description' => 'Cold storage units, direct placement'],
            ],
            'master.attendance' => [
                ['name' => 'Leave Type Master', 'slug' => 'master.leave_type', 'icon' => 'CalendarOff',   'description' => 'Define leave categories (Regular, Incident Based, Unpaid) with short codes'],
                ['name' => 'Leave Plan Master', 'slug' => 'master.leave_plan', 'icon' => 'CalendarRange', 'description' => 'Configure leave plans with calendar year & start-month rules'],
            ],
        ];

        foreach ($leaves as $catSlug => $items) {
            foreach ($items as $i => $item) {
                Module::updateOrCreate(
                    ['slug' => $item['slug']],
                    $item + [
                        'parent_id'  => $catIds[$catSlug],
                        'sort_order' => $i + 1,
                        'is_active'  => true,
                        'is_default' => false,
                    ]
                );
            }
        }

        
        $hr = Module::where('slug', 'hr')->first();

        $hrCategories = [
            ['name' => 'HRMS Command Center', 'slug' => 'hr.command',    'icon' => 'LayoutDashboard', 'description' => 'HRMS overview, PIP, reports & AI configuration'],
            ['name' => 'HR Core',             'slug' => 'hr.core',       'icon' => 'Users',           'description' => 'Recruitment, employees, onboarding & exit'],
            ['name' => 'Time & Pay Inputs',   'slug' => 'hr.time_pay',   'icon' => 'IndianRupee',     'description' => 'Payroll, attendance, leave & expenses'],
            ['name' => 'Document & Evidence', 'slug' => 'hr.documents',  'icon' => 'FileText',        'description' => 'Policies, templates, document masters'],
        ];

        $hrCatIds = [];
        foreach ($hrCategories as $i => $cat) {
            $row = Module::updateOrCreate(
                ['slug' => $cat['slug']],
                $cat + ['parent_id' => $hr->id, 'sort_order' => $i + 1, 'is_active' => true, 'is_default' => false]
            );
            $hrCatIds[$cat['slug']] = $row->id;
        }

        $hrLeaves = [
            'hr.command' => [
                ['name' => 'HRMS Overview', 'slug' => 'hr.overview',  'icon' => 'LayoutGrid',     'description' => 'Headcount, joinings, exits & headline KPIs'],
                ['name' => 'PIP',           'slug' => 'hr.pip',       'icon' => 'ClipboardCheck', 'description' => 'Performance improvement plans'],
                ['name' => 'HR Reports',    'slug' => 'hr.reports',   'icon' => 'BarChart3',      'description' => 'Standard & custom HR analytics reports'],
                ['name' => 'AI Master',     'slug' => 'hr.ai_master', 'icon' => 'Sparkles',       'description' => 'AI configuration & training data'],
            ],
            'hr.core' => [
                ['name' => 'Recruitment',         'slug' => 'hr.recruitment', 'icon' => 'UserPlus',  'description' => 'Job posts, candidates & interviews'],
                ['name' => 'Employee',            'slug' => 'hr.employee',    'icon' => 'User',      'description' => 'Employee master with personal & job data'],
                ['name' => 'Employee Onboarding', 'slug' => 'hr.onboarding',  'icon' => 'UserCheck', 'description' => 'New-hire workflow & documentation'],
                ['name' => 'Exit Management',     'slug' => 'hr.exit',        'icon' => 'LogOut',    'description' => 'Resignations, F&F, exit checklist'],
            ],
            'hr.time_pay' => [
                ['name' => 'Payroll',            'slug' => 'hr.payroll',            'icon' => 'IndianRupee',  'description' => 'Salary processing, payslips, statutory'],
                ['name' => 'Attendance',         'slug' => 'hr.attendance',         'icon' => 'CalendarCheck','description' => 'Daily attendance & shift tracking'],
                ['name' => 'Leave',              'slug' => 'hr.leave',              'icon' => 'CalendarOff',  'description' => 'Leave requests, balance & policy'],
                ['name' => 'Holiday',            'slug' => 'hr.holiday',            'icon' => 'CalendarDays', 'description' => 'Company holiday calendar'],
                ['name' => 'Expense Management', 'slug' => 'hr.expense',            'icon' => 'Receipt',      'description' => 'Reimbursable expenses & approvals'],
            ],
            'hr.documents' => [
                ['name' => 'Dashboard',           'slug' => 'hr.doc_dashboard',  'icon' => 'LayoutGrid',     'description' => 'Document analytics & broadcast status'],
                ['name' => 'Templates',           'slug' => 'hr.templates',      'icon' => 'FileText',       'description' => 'Letter, contract & policy templates'],
                ['name' => 'Policies',            'slug' => 'hr.policies',       'icon' => 'BookOpen',       'description' => 'Company policy library'],
                ['name' => 'Broadcast Centre',    'slug' => 'hr.broadcast',      'icon' => 'Megaphone',      'description' => 'Push policies/notices to employees'],
                // The "MASTERS" sub-section in the HR Document column — flattened
                // here as direct leaves under hr.documents because the modules
                // table is 3-level deep. Slugs include `doc_` for clarity.
                ['name' => 'Document Category',       'slug' => 'hr.doc_category',  'icon' => 'FolderOpen',  'description' => 'Document category master'],
                ['name' => 'Document Types',          'slug' => 'hr.doc_types',     'icon' => 'FileBadge',   'description' => 'Document type definitions'],
                ['name' => 'Doc Generation Rules',    'slug' => 'hr.doc_gen_rules', 'icon' => 'Settings2',   'description' => 'Auto-generation rule sets'],
                ['name' => 'Custom Fields',           'slug' => 'hr.custom_fields', 'icon' => 'PlusSquare',  'description' => 'Custom data fields for HR documents'],
                // Document Templates — role-based document templates with
                // lifecycle triggers + signing workflows. Backed by the
                // dedicated HrDocumentTemplateController (not the generic
                // master shell — too domain-specific for the 50-master mold).
                ['name' => 'Document Templates',      'slug' => 'hr.doc_templates', 'icon' => 'FileText',    'description' => 'Role-based document templates — versions, variables & approval flows'],
                // Trigger Point Master — defines lifecycle trigger modules
                // (Onboarding, Offboarding, Event Based) used by the Doc
                // Generation Rules engine. Uses `master.` prefix so the
                // generic /master/:slug shell + MasterController back it.
                ['name' => 'Trigger Point Master',    'slug' => 'master.trigger_point', 'icon' => 'Zap',     'description' => 'Define lifecycle trigger modules for document generation'],
            ],
        ];

        foreach ($hrLeaves as $catSlug => $items) {
            foreach ($items as $i => $item) {
                Module::updateOrCreate(
                    ['slug' => $item['slug']],
                    $item + [
                        'parent_id'  => $hrCatIds[$catSlug],
                        'sort_order' => $i + 1,
                        'is_active'  => true,
                        'is_default' => false,
                    ]
                );
            }
        }

        // Retired modules — removed from the product. Drop the module rows and
        // their permission grants so they no longer surface in the Permissions
        // matrix (/api/modules returns is_active=true rows). Idempotent: a
        // no-op once the rows are gone. 'hr.calculation_master' removed
        // 2026-06-04 (Calculation Master feature dropped).
        $retiredSlugs = ['hr.calculation_master'];
        $retiredIds = Module::whereIn('slug', $retiredSlugs)->pluck('id');
        if ($retiredIds->isNotEmpty()) {
            \App\Models\Permission::whereIn('module_id', $retiredIds)->delete();
            Module::whereIn('id', $retiredIds)->delete();
        }

        // Sales Matrix tree — 3 grouping categories + 8 leaves. Matches the
        // top-nav mega-menu (Sales Insights & Productivity / Sales Core
        // Masters / Sales Matrix Operations). Permissions are explicit only:
        // super_admin grants Sales perms to client_admin, who grants to
        // branch_user, who grants to employees — same cascade the existing
        // PermissionController enforces. No backfill copy from a peer module.
        $sales = Module::where('slug', 'sales')->first();

        $salesCategories = [
            ['name' => 'Sales Insights & Productivity', 'slug' => 'sales.insights',  'icon' => 'BarChart3', 'description' => 'Sales analytics, productivity tracker & P2P summary'],
            ['name' => 'Sales Core (Masters)',          'slug' => 'sales.core',      'icon' => 'Database',  'description' => 'Customer, consignee & lead acknowledgement masters'],
            ['name' => 'Sales Matrix Operations',       'slug' => 'sales.operations','icon' => 'Activity',  'description' => 'My Workplace & quotation/PI tracking'],
        ];

        $salesCatIds = [];
        foreach ($salesCategories as $i => $cat) {
            $row = Module::updateOrCreate(
                ['slug' => $cat['slug']],
                $cat + ['parent_id' => $sales->id, 'sort_order' => $i + 1, 'is_active' => true, 'is_default' => false]
            );
            $salesCatIds[$cat['slug']] = $row->id;
        }

        $salesLeaves = [
            'sales.insights' => [
                ['name' => 'Sales Analytics',          'slug' => 'sales.analytics',            'icon' => 'BarChart3',     'description' => 'Sales dashboard, diagnosis & resolution center'],
                ['name' => 'Productivity Tracker',     'slug' => 'sales.productivity_tracker', 'icon' => 'ClipboardCheck','description' => 'Manage reminders, meetings & to-do activities'],
                ['name' => 'Procure to Pay (P2P) Summary', 'slug' => 'sales.p2p_summary',      'icon' => 'ShoppingBag',   'description' => 'Track opportunity-wise product sourcing summary'],
                ['name' => 'Diagnosis',                'slug' => 'sales.diagnosis',            'icon' => 'Stethoscope',   'description' => 'Diagnose sales pipeline issues by branch & rep'],
                ['name' => 'Resolution Center',        'slug' => 'sales.resolution_center',    'icon' => 'Wrench',        'description' => 'Track and resolve flagged sales blockers'],
                ['name' => 'Performance',              'slug' => 'sales.performance',          'icon' => 'TrendingUp',    'description' => 'Overview, targets, leaderboard & activity'],
            ],
            'sales.core' => [
                ['name' => 'Customers',                'slug' => 'sales.customers',     'icon' => 'UserSquare', 'description' => 'Manage customer master records'],
                ['name' => 'Consignee',                'slug' => 'sales.consignee',     'icon' => 'Truck',      'description' => 'Manage consignee master records'],
                ['name' => 'Lead Acknowledgement Master', 'slug' => 'sales.lead_ack_master', 'icon' => 'BadgeCheck', 'description' => 'Manage Lead Acknowledgement reasons'],
            ],
            'sales.operations' => [
                ['name' => 'My Workplace',             'slug' => 'sales.workplace',        'icon' => 'Activity',    'description' => 'Manage active sales opportunities'],
                ['name' => 'Quotation Vs PI History',  'slug' => 'sales.quotation_vs_pi',  'icon' => 'FileText',    'description' => 'Track quotation & PI conversion history'],
                ['name' => 'Sign Document Tracker',    'slug' => 'sales.sign_tracker',     'icon' => 'ClipboardCheck','description' => 'Track all documents sent for e-signature'],
                ['name' => 'Lead Distribution',        'slug' => 'sales.lead_distribution','icon' => 'Share2',      'description' => 'Distribute and reassign opportunity leads'],
                ['name' => 'Lead Detail',              'slug' => 'sales.lead_detail',      'icon' => 'FileSearch',  'description' => 'Full opportunity detail view'],
                ['name' => 'Enquiries',                'slug' => 'sales.enquiries',        'icon' => 'Mail',        'description' => 'Inbound enquiries log & triage'],
                ['name' => 'Leads Details',            'slug' => 'sales.leads_details',    'icon' => 'ListChecks',  'description' => 'Per-salesperson leads drill-down'],
            ],
        ];

        foreach ($salesLeaves as $catSlug => $items) {
            foreach ($items as $i => $item) {
                Module::updateOrCreate(
                    ['slug' => $item['slug']],
                    $item + [
                        'parent_id'  => $salesCatIds[$catSlug],
                        'sort_order' => $i + 1,
                        'is_active'  => true,
                        'is_default' => false,
                    ]
                );
            }
        }

        // ─────────────────────────────────────────────────────────────
        //  CENTRAL CLM TREE — 5 grouping categories + 16 leaves.
        //
        //  Categories mirror the SalesMatrix_v4_9 CLM landing page:
        //    1. CLM Command Center          (analytics + diagnosis + resolution)
        //    2. CLM Operations / With Ship  (buyer + supplier profile)
        //    3. CLM Operations / Without    (case-to-case + agreements)
        //    4. CLM Master / Compliance     (segment / authority / KYC / DD / licences)
        //    5. CLM Master / Documents      (control panel / templates / clauses)
        //
        //  Permissions cascade follows the same super_admin → client_admin →
        //  branch_user → employee chain enforced by PermissionController.
        // ─────────────────────────────────────────────────────────────
        $clm = Module::where('slug', 'clm')->first();

        $clmCategories = [
            ['name' => 'CLM Command Center',          'slug' => 'clm.command',            'icon' => 'LayoutDashboard', 'description' => 'CLM analytics, diagnosis & resolution overview'],
            ['name' => 'CLM Operations — With Shipment ID',    'slug' => 'clm.ops_with',    'icon' => 'Truck',           'description' => 'Buyer & supplier profile management'],
            ['name' => 'CLM Operations — Without Shipment ID', 'slug' => 'clm.ops_without', 'icon' => 'FileText',        'description' => 'One-time contracts & agreement traffic'],
            ['name' => 'Compliance & Regulatory',     'slug' => 'clm.compliance',         'icon' => 'ShieldCheck',     'description' => 'Segment, authority, KYC, DD, trade licences'],
            ['name' => 'Contract & Document Masters', 'slug' => 'clm.documents',          'icon' => 'BookOpen',        'description' => 'Document panel, templates, clauses & T&C'],
        ];

        $clmCatIds = [];
        foreach ($clmCategories as $i => $cat) {
            $row = Module::updateOrCreate(
                ['slug' => $cat['slug']],
                $cat + ['parent_id' => $clm->id, 'sort_order' => $i + 1, 'is_active' => true, 'is_default' => false]
            );
            $clmCatIds[$cat['slug']] = $row->id;
        }

        $clmLeaves = [
            'clm.command' => [
                ['name' => 'CLM Analytics',             'slug' => 'clm.analytics',             'icon' => 'BarChart3',     'description' => 'Track contract KPIs & legal performance'],
                ['name' => 'Diagnosis & Resolution Center', 'slug' => 'clm.diagnosis_resolution', 'icon' => 'Stethoscope', 'description' => 'Diagnose contract risks & drive resolution actions'],
                ['name' => 'Regulatory Defense File',   'slug' => 'clm.regulatory_defense',    'icon' => 'ShieldCheck',   'description' => 'Read-only regulatory defense file repository'],
            ],
            'clm.ops_with' => [
                ['name' => 'Buyer Profile',             'slug' => 'clm.buyer_profile',         'icon' => 'User',          'description' => 'Manage buyer onboarding & agreements'],
                ['name' => 'Supplier Profile',          'slug' => 'clm.supplier_profile',      'icon' => 'Truck',         'description' => 'Manage supplier contracts & compliance'],
            ],
            'clm.ops_without' => [
                ['name' => 'Case to Case Contracts',    'slug' => 'clm.case_to_case',          'icon' => 'FileText',      'description' => 'Manage one-time operational contracts'],
                ['name' => 'Agreements We Sent',        'slug' => 'clm.agreements_sent',       'icon' => 'Send',          'description' => 'Track agreements sent for approval'],
                ['name' => 'Agreements To Approve',     'slug' => 'clm.agreements_to_approve', 'icon' => 'CheckCircle',   'description' => 'Review and approve received agreements'],
            ],
            'clm.compliance' => [
                ['name' => 'Segment',                   'slug' => 'clm.segment',               'icon' => 'LayoutGrid',    'description' => 'Manage segment-wise contract structures'],
                ['name' => 'Authority',                 'slug' => 'clm.authority',             'icon' => 'Award',         'description' => 'Manage certifying & issuing authorities'],
                ['name' => 'Quality & Compliance Docs', 'slug' => 'clm.quality_docs',          'icon' => 'CheckSquare',   'description' => 'Manage QC & compliance documents'],
                ['name' => 'KYC',                       'slug' => 'clm.kyc',                   'icon' => 'UserCheck',     'description' => 'Manage customer & vendor KYC records'],
                ['name' => 'Due Diligence (DD)',        'slug' => 'clm.due_diligence',         'icon' => 'Search',        'description' => 'Manage risk verification processes'],
                ['name' => 'Trade Licenses',            'slug' => 'clm.trade_licenses',        'icon' => 'FileBadge',     'description' => 'Manage statutory license documents'],
            ],
            'clm.documents' => [
                ['name' => 'Document Control Panel',    'slug' => 'clm.document_panel',        'icon' => 'PenSquare',     'description' => 'Where all masters converge — the CLM execution handshake'],
                ['name' => 'Trade Documents',           'slug' => 'clm.trade_documents',       'icon' => 'Hexagon',       'description' => 'Manage declarations & trade papers'],
                ['name' => 'Agreements',                'slug' => 'clm.agreements',            'icon' => 'Users',         'description' => 'Manage agreement templates & masters'],
                ['name' => 'Terms & Conditions',        'slug' => 'clm.terms_conditions',      'icon' => 'List',          'description' => 'Manage reusable legal T&C structures'],
                ['name' => 'Clause Library',            'slug' => 'clm.clause_library',        'icon' => 'BookOpen',      'description' => 'Manage reusable legal clauses'],
            ],
        ];

        foreach ($clmLeaves as $catSlug => $items) {
            foreach ($items as $i => $item) {
                Module::updateOrCreate(
                    ['slug' => $item['slug']],
                    $item + [
                        'parent_id'  => $clmCatIds[$catSlug],
                        'sort_order' => $i + 1,
                        'is_active'  => true,
                        'is_default' => false,
                    ]
                );
            }
        }

        // ── Developers (level 2 category + level 3 leaves) ──
        // Marked is_default so client_admins receive it on plan (re)activation
        // (SubscriptionController grants is_default modules); branch users /
        // employees still need an explicit grant from the Permissions screen.
        $developers = Module::where('slug', 'developers')->first();
        $devCat = Module::updateOrCreate(
            ['slug' => 'developers.ops'],
            [
                'name' => 'Operations', 'icon' => 'Truck',
                'description' => 'Business Task (Shipment) operations',
                'parent_id' => $developers->id, 'sort_order' => 1,
                'is_active' => true, 'is_default' => true,
            ]
        );
        $devShip = Module::updateOrCreate(
            ['slug' => 'developers.shipment'],
            [
                'name' => 'Shipment', 'icon' => 'Truck',
                'description' => 'Business Task list — all shipment orders',
                'parent_id' => $devCat->id, 'sort_order' => 1,
                'is_active' => true, 'is_default' => true,
            ]
        );
        // Also mark the top-level Developers parent as default.
        $developers->update(['is_default' => true]);

        // Back-fill: grant the Developers modules to every existing CLIENT_ADMIN
        // so they can immediately pass it down to branch users / employees from
        // the Permissions screen (without waiting for a plan re-activation).
        $devModuleIds = [$developers->id, $devCat->id, $devShip->id];
        $clientAdmins = \App\Models\User::where('user_type', 'client_admin')->get();
        foreach ($clientAdmins as $admin) {
            foreach ($devModuleIds as $mid) {
                \App\Models\Permission::updateOrCreate(
                    ['user_id' => $admin->id, 'module_id' => $mid],
                    [
                        'client_id'   => $admin->client_id,
                        'branch_id'   => $admin->branch_id,
                        'role'        => 'client_admin',
                        'can_view'    => true,
                        'can_add'     => true,
                        'can_edit'    => true,
                        'can_delete'  => true,
                        'can_export'  => true,
                        'can_import'  => true,
                        'can_approve' => true,
                        'granted_by'  => $admin->id,
                    ]
                );
            }
        }
    }
}

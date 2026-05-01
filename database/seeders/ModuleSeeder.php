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
            ['name' => 'HR',          'slug' => 'hr',          'icon' => 'Users',       'sort_order' => 9,  'is_default' => false, 'description' => 'Human resources, payroll, attendance & policies'],
            ['name' => 'Settings',    'slug' => 'settings',    'icon' => 'Settings',    'sort_order' => 10, 'is_default' => false, 'description' => 'System settings'],
            ['name' => 'Profile',     'slug' => 'profile',     'icon' => 'UserCircle',  'sort_order' => 11, 'is_default' => true],
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
                ['name' => 'Assets',           'slug' => 'master.assets',            'icon' => 'Briefcase',    'description' => 'Company equipment & assets'],
                ['name' => 'Asset Categories', 'slug' => 'master.asset_categories',  'icon' => 'Tags',         'description' => 'Group assets by type & depreciation'],
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

        // ── HR module tree ────────────────────────────────────────────────
        // Mirrors the IDIMS HR menu: 1 root → 6 category groups → 24 leaves.
        // Slugs use `hr.` prefix so they don't collide with anything else.
        $hr = Module::where('slug', 'hr')->first();

        $hrCategories = [
            ['name' => 'HRMS Command',     'slug' => 'hr.command',    'icon' => 'LayoutDashboard', 'description' => 'HRMS overview & performance improvement plans'],
            ['name' => 'HR Core',          'slug' => 'hr.core',       'icon' => 'Users',           'description' => 'Employees, departments, designations, roles & KPIs'],
            ['name' => 'HR Operations',    'slug' => 'hr.operations', 'icon' => 'Workflow',        'description' => 'Recruitment, onboarding & exit'],
            ['name' => 'Time & Pay Inputs','slug' => 'hr.time_pay',   'icon' => 'IndianRupee',     'description' => 'Payroll, attendance, leave & expenses'],
            ['name' => 'Document & Evidence','slug' => 'hr.documents','icon' => 'FileText',        'description' => 'Policies, templates, document masters'],
            ['name' => 'AI Intelligence',  'slug' => 'hr.ai',         'icon' => 'Brain',           'description' => 'HR reports & AI-driven master data'],
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
                ['name' => 'HRMS Overview', 'slug' => 'hr.overview', 'icon' => 'LayoutGrid',     'description' => 'Headcount, joinings, exits & headline KPIs'],
                ['name' => 'PIP',           'slug' => 'hr.pip',      'icon' => 'ClipboardCheck', 'description' => 'Performance improvement plans'],
            ],
            'hr.core' => [
                ['name' => 'Employee',    'slug' => 'hr.employee',    'icon' => 'User',         'description' => 'Employee master with personal & job data'],
                ['name' => 'Department',  'slug' => 'hr.department',  'icon' => 'Building2',    'description' => 'Department setup for employee assignment'],
                ['name' => 'Designation', 'slug' => 'hr.designation', 'icon' => 'BadgeCheck',   'description' => 'Job titles used in offer letters & HR docs'],
                ['name' => 'Role',        'slug' => 'hr.role',        'icon' => 'UserCog',      'description' => 'Functional roles for module-level access'],
                ['name' => "KPI's",       'slug' => 'hr.kpis',        'icon' => 'TrendingUp',   'description' => 'Goal-setting & performance metrics'],
            ],
            'hr.operations' => [
                ['name' => 'Recruitment',         'slug' => 'hr.recruitment', 'icon' => 'UserPlus',  'description' => 'Job posts, candidates & interviews'],
                ['name' => 'Employee Onboarding', 'slug' => 'hr.onboarding',  'icon' => 'UserCheck', 'description' => 'New-hire workflow & documentation'],
                ['name' => 'Exit Management',     'slug' => 'hr.exit',        'icon' => 'LogOut',    'description' => 'Resignations, F&F, exit checklist'],
            ],
            'hr.time_pay' => [
                ['name' => 'Payroll',            'slug' => 'hr.payroll',            'icon' => 'IndianRupee',  'description' => 'Salary processing, payslips, statutory'],
                ['name' => 'Calculation Master', 'slug' => 'hr.calculation_master', 'icon' => 'Calculator',   'description' => 'Pay heads, formulas, tax slabs'],
                ['name' => 'Attendance',         'slug' => 'hr.attendance',         'icon' => 'CalendarCheck','description' => 'Daily attendance & shift tracking'],
                ['name' => 'Leave',              'slug' => 'hr.leave',              'icon' => 'CalendarOff',  'description' => 'Leave requests, balance & policy'],
                ['name' => 'Expense Management', 'slug' => 'hr.expense',            'icon' => 'Receipt',      'description' => 'Reimbursable expenses & approvals'],
            ],
            'hr.documents' => [
                ['name' => 'Dashboard',           'slug' => 'hr.doc_dashboard',  'icon' => 'LayoutGrid',     'description' => 'Document analytics & broadcast status'],
                ['name' => 'Templates',           'slug' => 'hr.templates',      'icon' => 'FileText',       'description' => 'Letter, contract & policy templates'],
                ['name' => 'Policies',            'slug' => 'hr.policies',       'icon' => 'BookOpen',       'description' => 'Company policy library'],
                ['name' => 'Broadcast Centre',    'slug' => 'hr.broadcast',      'icon' => 'Megaphone',      'description' => 'Push policies/notices to employees'],
                // The "MASTERS" sub-section in the HR Document column — flattened
                // here as direct leaves under hr.documents because the modules
                // table is 3-level deep. Slugs include `master` for clarity.
                ['name' => 'Document Category',       'slug' => 'hr.doc_category',  'icon' => 'FolderOpen',  'description' => 'Document category master'],
                ['name' => 'Document Types',          'slug' => 'hr.doc_types',     'icon' => 'FileBadge',   'description' => 'Document type definitions'],
                ['name' => 'Doc Generation Rules',    'slug' => 'hr.doc_gen_rules', 'icon' => 'Settings2',   'description' => 'Auto-generation rule sets'],
                ['name' => 'Custom Fields',           'slug' => 'hr.custom_fields', 'icon' => 'PlusSquare',  'description' => 'Custom data fields for HR documents'],
            ],
            'hr.ai' => [
                ['name' => 'HR Reports', 'slug' => 'hr.reports',   'icon' => 'BarChart3',    'description' => 'Standard & custom HR analytics reports'],
                ['name' => 'AI Master',  'slug' => 'hr.ai_master', 'icon' => 'Sparkles',     'description' => 'AI configuration & training data'],
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
    }
}

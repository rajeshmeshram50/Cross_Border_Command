<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MasterController extends Controller
{
    /**
     * slug -> Eloquent model class map
     */
    private const MODELS = [
        // Super-admin-only platform master — lives under App\Models (not
        // App\Models\Masters) because it pre-dates the masters namespace.
        // Without this entry the /master-counts batch endpoint silently
        // skipped organization_types and the dashboard card was stuck
        // at active=0 / inactive=0 even when records existed.
        'organization_types' => \App\Models\OrganizationType::class,
        'company' => \App\Models\Masters\Company::class,
        'bank_accounts' => \App\Models\Masters\BankAccounts::class,
        'departments' => \App\Models\Masters\Departments::class,
        'roles' => \App\Models\Masters\Roles::class,
        'designations' => \App\Models\Masters\Designations::class,
        'kpis' => \App\Models\Masters\Kpis::class,
        'countries' => \App\Models\Masters\Countries::class,
        'states' => \App\Models\Masters\States::class,
        'state_codes' => \App\Models\Masters\StateCodes::class,
        'address_types' => \App\Models\Masters\AddressTypes::class,
        'port_of_loading' => \App\Models\Masters\PortOfLoading::class,
        'port_of_discharge' => \App\Models\Masters\PortOfDischarge::class,
        'segments' => \App\Models\Masters\Segments::class,
        'hsn_codes' => \App\Models\Masters\HsnCodes::class,
        'gst_percentage' => \App\Models\Masters\GstPercentage::class,
        'currencies' => \App\Models\Masters\Currencies::class,
        'uom' => \App\Models\Masters\Uom::class,
        'packaging_material' => \App\Models\Masters\PackagingMaterial::class,
        'conditions' => \App\Models\Masters\Conditions::class,
        'incoterms' => \App\Models\Masters\Incoterms::class,
        'customer_types' => \App\Models\Masters\CustomerTypes::class,
        'customer_classifications' => \App\Models\Masters\CustomerClassifications::class,
        'vendor_types' => \App\Models\Masters\VendorTypes::class,
        'vendor_behaviour' => \App\Models\Masters\VendorBehaviour::class,
        'applicable_types' => \App\Models\Masters\ApplicableTypes::class,
        'license_name' => \App\Models\Masters\LicenseName::class,
        'risk_levels' => \App\Models\Masters\RiskLevels::class,
        'document_type' => \App\Models\Masters\DocumentType::class,
        'haz_class' => \App\Models\Masters\HazClass::class,
        'compliance_behaviours' => \App\Models\Masters\ComplianceBehaviours::class,
        'assets' => \App\Models\Masters\Assets::class,
        'asset_categories' => \App\Models\Masters\AssetCategories::class,
        'expense_category' => \App\Models\Masters\ExpenseCategories::class,
        'payment_terms' => \App\Models\Masters\PaymentTerms::class,
        'approval_authority' => \App\Models\Masters\ApprovalAuthority::class,
        'procurement_category' => \App\Models\Masters\ProcurementCategory::class,
        'sourcing_type' => \App\Models\Masters\SourcingType::class,
        'deviation_reason' => \App\Models\Masters\DeviationReason::class,
        'match_exception' => \App\Models\Masters\MatchException::class,
        'advance_payment_rules' => \App\Models\Masters\AdvancePaymentRules::class,
        'exchange_rate_log' => \App\Models\Masters\ExchangeRateLog::class,
        'goods_service_flag' => \App\Models\Masters\GoodsServiceFlag::class,
        'vendor_directory' => \App\Models\Masters\VendorDirectory::class,
        'warehouse_master' => \App\Models\Masters\WarehouseMaster::class,
        'zone_master' => \App\Models\Masters\ZoneMaster::class,
        'rack_type_master' => \App\Models\Masters\RackTypeMaster::class,
        'temp_class_master' => \App\Models\Masters\TempClassMaster::class,
        'racks' => \App\Models\Masters\Racks::class,
        'shelf_master' => \App\Models\Masters\ShelfMaster::class,
        'digital_twin' => \App\Models\Masters\DigitalTwin::class,
        'freezers' => \App\Models\Masters\Freezers::class,
        'leave_type' => \App\Models\Masters\LeaveTypes::class,
        'leave_plan' => \App\Models\Masters\LeavePlans::class,
        'overtime_rates' => \App\Models\Masters\OvertimeRates::class,
        'pt_slabs' => \App\Models\Masters\PtSlabs::class,
        'trigger_point' => \App\Models\Masters\TriggerPoints::class,
    ];

    /**
     * slug -> ['fields' => [{n,t,r,ref?}, ...], 'uFields' => [...]]
     */
    private const SCHEMAS = [
        'company' => ['fields' => [['n' => 'company_name', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'gstin', 't' => 'text', 'r' => true, 'normalize' => 'upper'], ['n' => 'pan', 't' => 'text', 'r' => true, 'normalize' => 'upper'], ['n' => 'cin', 't' => 'text', 'normalize' => 'upper'], ['n' => 'iec', 't' => 'text'], ['n' => 'email', 't' => 'email'], ['n' => 'mobile', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'state', 't' => 'text'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['company_name', 'gstin', 'pan']],
        'bank_accounts' => ['fields' => [['n' => 'bank_name', 't' => 'text', 'r' => true, 'pattern' => "/^[A-Za-z][A-Za-z .,&'()\\-]*$/", 'patternMessage' => 'Bank Name may only contain letters (no numbers or special characters).'], ['n' => 'account_holder', 't' => 'text', 'r' => true, 'pattern' => "/^[A-Za-z][A-Za-z .,&'()\\-]*$/", 'patternMessage' => 'Account Holder may only contain letters.'], ['n' => 'account_number', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{9,18}$/', 'patternMessage' => 'Account Number must be 9 to 18 digits.'], ['n' => 'ifsc_code', 't' => 'text', 'r' => true, 'normalize' => 'upper', 'pattern' => '/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/', 'patternMessage' => 'Enter a valid 11-character IFSC code.'], ['n' => 'branch_name', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'swift_code', 't' => 'text', 'r' => true], ['n' => 'ad_code', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{14}$/', 'patternMessage' => 'AD Code must be exactly 14 digits.'], ['n' => 'is_primary', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['account_number', 'ifsc_code']],
        // `uEach` — department name and code each independently unique.
        'departments' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'parent_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'head', 't' => 'select'], ['n' => 'email', 't' => 'email'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code'], 'tenantScoped' => true],
        // A role name is unique per (role type + department), NOT across the whole
        // master: "Manager" may exist as a Primary role in Sales and again in HR,
        // and Primary/Ancillary are separate vocabularies. A single global name
        // check blocked adding "Manager" as a Primary role because it existed as
        // an Ancillary one, with nothing on the Primary tab to explain it (QA #68).
        // `dupContext` — role names are unique across the whole master, but the
        // Role Master page splits into Primary / Ancillary tabs by role_type.
        // A bare "already registered" therefore contradicted the (filtered)
        // list on screen: "Manager" held as an Ancillary role blocked adding it
        // from the Primary tab with nothing visible to explain it (QA #68).
        // Quoting the clashing row's type + code points the user at it.
        'roles' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'role_type', 't' => 'select', 'r' => true, 'opts' => ['Primary', 'Ancillary']], ['n' => 'department_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'role_category', 't' => 'select', 'opts' => ['Technical', 'Management', 'Operational', 'Support', 'Sales', 'Compliance', 'Finance', 'HR']], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'role_type', 'department_id'], 'dupContext' => ['code']],
        'designations' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'department_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'level', 't' => 'select', 'r' => true, 'opts' => ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee']], ['n' => 'reports_to_id', 't' => 'select', 'ref' => 'designations'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'kpis' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'role_id', 't' => 'select', 'r' => true, 'ref' => 'roles'], ['n' => 'target_type', 't' => 'select', 'r' => true, 'opts' => ['Numeric', 'Percentage', 'Currency', 'Boolean', 'Date-based', 'Rating']], ['n' => 'priority', 't' => 'select', 'r' => true, 'opts' => ['Critical', 'High', 'Medium', 'Low']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        // `uEach` (not `uFields`) — entity_name and CIN must EACH be
// independently unique (case-insensitive). Composite uniqueness
// would have allowed "TesT" + CIN-A and "Test" + CIN-B as separate
// rows because the combination differs; users expect the name and
// CIN to each be globally unique within the tenant scope.
        'countries' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'iso_code', 't' => 'text', 'normalize' => 'upper'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'iso_code']],
        'states' => ['fields' => [['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'country_id']],
        'state_codes' => ['fields' => [['n' => 'state_id', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'state_code', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['state_id', 'state_code']],
        // Case-insensitive name uniqueness — `uEach` uses LOWER() so
        // "registered office" can't be added when "Registered Office"
        // already exists. Combined with the system-seed collision
        // check in store/update, manually creating duplicates of the
        // three globally-seeded fixed types (Registered Office,
        // Warehouse, Billing Address) is also blocked.
        'address_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        // `uEach` — port name and code each independently unique
        // (case-insensitive). Prevents two "Banner" entries with
        // different codes from coexisting.
        'port_of_loading' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        'port_of_discharge' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'city', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        'segments' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        /* GST rate was dropped from this master — the rate belongs to the
           PRODUCT (products.gst_id), which is what every downstream document
           reads. Carrying a second copy on the HSN row invited the two to
           disagree with nothing to reconcile them.
           `master_hsn_codes.gst_rate_id` is deliberately LEFT IN THE DATABASE
           holding its historic values; it is simply no longer written, read or
           offered. Nothing references it now, so the stored values are inert. */
        'hsn_codes' => ['fields' => [['n' => 'hsn_code', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{4,10}$/', 'patternMessage' => 'HSN/SAC code must be 4 to 10 digits.'], ['n' => 'description', 't' => 'textarea', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['hsn_code']],
        'gst_percentage' => ['fields' => [['n' => 'percentage', 't' => 'number', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['percentage']],
        // `uEach` — currency name and code each independently unique.
        'currencies' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'symbol', 't' => 'text', 'r' => true], ['n' => 'exchange_rate', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        // `uEach` — UOM title and short code each independently unique.
        'uom' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'unit_type', 't' => 'select', 'opts' => ['Weight', 'Volume', 'Length', 'Area', 'Count', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['title', 'short_code']],
        'packaging_material' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'material_type', 't' => 'select', 'opts' => ['Bag', 'Box', 'Crate', 'Drum', 'Pallet', 'Wrap', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['title']],
        'conditions' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        // `uEach` — Incoterm code and full name each independently unique.
        'incoterms' => ['fields' => [['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'full_name', 't' => 'text', 'r' => true], ['n' => 'transport_mode', 't' => 'select', 'opts' => ['Sea/Inland Waterway', 'Any Mode', 'Air', 'Road', 'Rail']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['code', 'full_name']],
        // Case-insensitive name + system-seed collision check —
        // Retailer / Wholesaler are seeded as global is_system rows,
        // and the controller blocks shadow-creating duplicates of them
        // under any tenant scope (see uEach handler).
        'customer_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'gst_applicable', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        // Case-insensitive name + system-seed collision check
        // (Standard, VIP are seeded as global is_system rows).
        'customer_classifications' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'credit_limit', 't' => 'number'], ['n' => 'payment_terms', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'vendor_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'vendor_behaviour' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'applicable_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'party_type', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Third Party', 'Carrier', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        // `uEach` — license name and code each independently unique.
        'license_name' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'license_code', 't' => 'text'], ['n' => 'issuing_authority', 't' => 'text'], ['n' => 'validity_months', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'license_code']],
        // Case-insensitive name uniqueness + system-seed collision check
        // (Low / High are seeded as global is_system rows and can't be
        // shadow-created under any tenant scope).
        'risk_levels' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'text'], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'document_type' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'applicable_to', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Supplier', 'Both', 'Internal']], ['n' => 'is_mandatory', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'haz_class' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'compliance_behaviours' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'assets' => ['fields' => [['n' => 'asset_name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'asset_type_id', 't' => 'select', 'r' => true, 'ref' => 'asset_categories'], ['n' => 'description', 't' => 'textarea'], ['n' => 'vendor_id', 't' => 'select', 'ref' => 'vendor_directory'], ['n' => 'purchase_date', 't' => 'date'], ['n' => 'warranty_expiry_date', 't' => 'date'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive', 'Under Repair', 'Disposed']]], 'uEach' => ['asset_name', 'code']],
        'asset_categories' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'depreciation_rate', 't' => 'number'], ['n' => 'useful_life_years', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        // `uEach` — expense category code and name each independently unique.
        'expense_category' => ['fields' => [['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'monthly_limit', 't' => 'number'], ['n' => 'yearly_limit', 't' => 'number'], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['code', 'name'], 'tenantScoped' => true],
        'payment_terms' =>['fields' => [['n' => 'term_code', 't' => 'text', 'r' => true], ['n' => 'term_name', 't' => 'text', 'r' => true], ['n' => 'credit_days', 't' => 'number', 'r' => true], ['n' => 'advance_pct', 't' => 'number'], ['n' => 'payment_type', 't' => 'select', 'r' => true, 'opts' => ['Full Advance', 'Partial Advance', 'Credit', 'Milestone-Based', 'COD']], ['n' => 'milestone_desc', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['term_code', 'term_name']],
        'approval_authority' => ['fields' => [['n' => 'role_name', 't' => 'text', 'r' => true], ['n' => 'module_scope', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Payment', 'VTI', 'GRN', 'All']], ['n' => 'min_value', 't' => 'number'], ['n' => 'max_value', 't' => 'number', 'r' => true], ['n' => 'currency', 't' => 'select', 'opts' => ['INR', 'USD', 'EUR', 'GBP']], ['n' => 'escalate_to', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['role_name', 'module_scope']],
        'procurement_category' => ['fields' => [['n' => 'cat_code', 't' => 'text', 'r' => true], ['n' => 'cat_name', 't' => 'text', 'r' => true], ['n' => 'match_logic', 't' => 'select', 'r' => true, 'opts' => ['3-Way Match (PO+VTI+GRN)', '2-Way Match (PO+VTI)', '4-Way Match (PO+VTI+GRN+QC)']], ['n' => 'grn_required', 't' => 'select', 'r' => true, 'opts' => ['Yes — Physical Receipt', 'Yes — Service Confirmation', 'No']], ['n' => 'gst_applicable', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No', 'Reverse Charge']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['cat_code', 'cat_name']],
        'sourcing_type' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'quotation_required', 't' => 'select', 'r' => true, 'opts' => ['Mandatory — Min 3 Quotes', 'Mandatory — Min 1 Quote', 'Optional', 'Not Required']], ['n' => 'approval_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'urgency_flag', 't' => 'select', 'opts' => ['Normal', 'Urgent', 'Emergency']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['type_code', 'type_name']],
        'deviation_reason' => ['fields' => [['n' => 'reason_code', 't' => 'text', 'r' => true], ['n' => 'reason_name', 't' => 'text', 'r' => true], ['n' => 'module', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Vendor Comparison', 'VTI', 'GRN', 'Payment', 'All']], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'requires_approval', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['reason_code', 'reason_name']],
        'match_exception' => ['fields' => [['n' => 'exc_code', 't' => 'text', 'r' => true], ['n' => 'exc_name', 't' => 'text', 'r' => true], ['n' => 'tolerance_pct', 't' => 'number', 'min' => 0, 'max' => 100], ['n' => 'blocks_payment', 't' => 'select', 'r' => true, 'opts' => ['Yes — Hard Block', 'Yes — Soft Block (Warning)', 'No']], ['n' => 'resolver_role', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['exc_code', 'exc_name']],
        'advance_payment_rules' => ['fields' => [['n' => 'vendor_type', 't' => 'text', 'r' => true], ['n' => 'procurement_cat', 't' => 'text'], ['n' => 'max_advance_pct', 't' => 'number', 'r' => true, 'min' => 0, 'max' => 100], ['n' => 'approval_above', 't' => 'number'], ['n' => 'approver_role', 't' => 'text'], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['vendor_type', 'procurement_cat']],
        'exchange_rate_log' => ['fields' => [['n' => 'currency_code', 't' => 'text', 'r' => true], ['n' => 'currency_name', 't' => 'text'], ['n' => 'rate_vs_inr', 't' => 'number', 'r' => true], ['n' => 'effective_date', 't' => 'date', 'r' => true], ['n' => 'rate_source', 't' => 'select', 'r' => true, 'opts' => ['RBI Reference Rate', 'Bank Rate', 'Agreed Rate', 'Custom']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Superseded']]], 'uFields' => ['currency_code', 'effective_date']],
        'goods_service_flag' => ['fields' => [['n' => 'flag_code', 't' => 'text', 'r' => true], ['n' => 'flag_name', 't' => 'text', 'r' => true], ['n' => 'grn_screen', 't' => 'select', 'r' => true, 'opts' => ['Physical Receipt — Qty + Batch + Warehouse', 'Service Completion — Date + Proof Doc', 'Mixed — Partial Goods + Service']], ['n' => 'evidence_type', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['flag_code', 'flag_name']],
        // `uEach` — vendor company name, mobile, and email each must be
// independently unique (case-insensitive on name + email). Prevents
// "ABC Corp" / "abc corp" duplicates across the directory.
'vendor_directory' => ['fields' => [['n' => 'vendor_company_name', 't' => 'textarea', 'r' => true, 'maxLen' => 512], ['n' => 'contact_person', 't' => 'text', 'r' => true], ['n' => 'mobile_number', 't' => 'text', 'r' => true], ['n' => 'email_id', 't' => 'email', 'r' => true], ['n' => 'segment_id', 't' => 'select', 'r' => true, 'ref' => 'segments'], ['n' => 'address', 't' => 'text', 'r' => true], ['n' => 'country', 't' => 'select', 'r' => true, 'opts' => ['India', 'USA', 'UAE', 'UK', 'Germany', 'Australia', 'Singapore', 'Other']], ['n' => 'state', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'mapping_mode', 't' => 'select', 'r' => true, 'opts' => ['Map from Vendor Master', 'Map New Vendor']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['vendor_company_name', 'mobile_number', 'email_id']],
        'warehouse_master' => ['fields' => [['n' => 'wh_id', 't' => 'text', 'r' => true], ['n' => 'wh_name', 't' => 'text', 'r' => true], ['n' => 'wh_type', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'state', 't' => 'text'], ['n' => 'pincode', 't' => 'text'], ['n' => 'contact_person', 't' => 'text'], ['n' => 'contact_phone', 't' => 'text'], ['n' => 'area_sqft', 't' => 'number'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['wh_id', 'wh_name']],
        'zone_master' => ['fields' => [['n' => 'zone_id', 't' => 'text', 'r' => true], ['n' => 'zone_name', 't' => 'text', 'r' => true], ['n' => 'zone_type', 't' => 'select', 'r' => true, 'opts' => ['Storage Zone', 'Cold Chain Zone', 'Hazardous Zone', 'Dispatch Zone', 'Holding Zone', 'QC Hold Zone', 'Overflow Zone', 'Blocked Zone', 'Regulated Zone']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'purpose', 't' => 'textarea'], ['n' => 'cold_chain', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'hazardous', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['zone_id', 'zone_name']],
        // `uEach` — code and name each independently unique (case-insensitive).
'rack_type_master' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'suitable_for', 't' => 'select', 'opts' => ['General Inventory', 'Cold Chain', 'Hazardous', 'Heavy Duty', 'Retail', 'Pharma', 'All Types']], ['n' => 'max_load_per_shelf', 't' => 'number'], ['n' => 'typical_shelves', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['type_code', 'type_name']],
        // `uEach` — code and name each independently unique (case-insensitive).
'temp_class_master' => ['fields' => [['n' => 'class_code', 't' => 'text', 'r' => true], ['n' => 'class_name', 't' => 'text', 'r' => true], ['n' => 'temp_range_min', 't' => 'number'], ['n' => 'temp_range_max', 't' => 'number'], ['n' => 'description', 't' => 'textarea'], ['n' => 'requires_monitoring', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'alert_threshold', 't' => 'number'], ['n' => 'suitable_products', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['class_code', 'class_name']],
        'racks' => ['fields' => [['n' => 'whType', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'zone', 't' => 'select', 'r' => true, 'ref' => 'zone_master'], ['n' => 'rackName', 't' => 'text', 'r' => true], ['n' => 'rackType', 't' => 'select', 'r' => true, 'ref' => 'rack_type_master'], ['n' => 'rackStatus', 't' => 'select', 'r' => true, 'opts' => ['Partially Filled', 'Full', 'Blocked', 'Reserved', 'Under Maintenance', 'Empty']], ['n' => 'tempClass', 't' => 'select', 'ref' => 'temp_class_master'], ['n' => 'shelves', 't' => 'number'], ['n' => 'maxWeight', 't' => 'number'], ['n' => 'maxVolume', 't' => 'number']], 'uFields' => ['rackName']],
        'shelf_master' => ['fields' => [['n' => 'rack_ref', 't' => 'select', 'r' => true, 'ref' => 'racks'], ['n' => 'shelf_name', 't' => 'text', 'r' => true], ['n' => 'level_no', 't' => 'number', 'r' => true], ['n' => 'shelf_type', 't' => 'select', 'r' => true, 'opts' => ['Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf']], ['n' => 'max_weight', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Available', 'Partially Used', 'Full', 'Blocked', 'Under Maintenance']]], 'uFields' => ['shelf_name']],
        'digital_twin' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'freezers' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'capacity', 't' => 'number', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'warehouse']],
        'leave_type' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true, 'pattern' => '#^(?=.*[A-Za-z])[A-Za-z0-9 .,\-&()\'/]+$#', 'patternMessage' => 'Leave Type Name cannot contain special characters (only letters, numbers, spaces and . , - & ( ) / \' are allowed).'], ['n' => 'description', 't' => 'textarea'], ['n' => 'type', 't' => 'select', 'r' => true, 'opts' => ['Regular', 'Incident Based Leave', 'Unpaid Leave', 'Compoff']], ['n' => 'short_code', 't' => 'text', 'r' => true, 'normalize' => 'upper', 'pattern' => '/^[A-Za-z0-9]+$/', 'patternMessage' => 'Only letters and numbers are allowed (no spaces or special characters).'], ['n' => 'is_sick_medical', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'paid_unpaid', 't' => 'select', 'opts' => ['Paid', 'Unpaid']], ['n' => 'gender_restriction', 't' => 'select', 'opts' => ['None', 'Male', 'Female']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'short_code'], 'tenantScoped' => true],
        'leave_plan' => ['fields' => [['n' => 'plan_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'from_month_type', 't' => 'select', 'r' => true, 'opts' => ['Calendar', 'If Joining']], ['n' => 'from_month', 't' => 'select', 'opts' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']], ['n' => 'calendar_year', 't' => 'text'], ['n' => 'policy_explanation_mode', 't' => 'select', 'opts' => ['System', 'Custom']], ['n' => 'policy_doc_path', 't' => 'text'], ['n' => 'is_default', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['plan_name'], 'tenantScoped' => true],
        'trigger_point' => ['fields' => [['n' => 'module_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['module_name'], 'tenantScoped' => true],
        // Overtime (OT) rate master — feeds the Employee "Overtime" picker.
        // `rate_name` is unique (case-insensitive) per tenant scope;
        // `multiplier` is the factor applied to the base hourly rate
        // (1 = normal, 1.5 = time-and-a-half, 2 = double time, …).
        'overtime_rates' => ['fields' => [['n' => 'rate_name', 't' => 'text', 'r' => true], ['n' => 'multiplier', 't' => 'number', 'r' => true, 'min' => 0, 'max' => 100], ['n' => 'description', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['rate_name']],
        // Rule 9 — Professional Tax bands. Uniqueness is the whole band, not the
        // state: a state legitimately has many rows (one per gross slab), and a
        // gendered state such as Maharashtra has parallel male/female ladders.
        'pt_slabs' => ['fields' => [['n' => 'state', 't' => 'text', 'r' => true], ['n' => 'gender', 't' => 'select', 'r' => true, 'opts' => ['any', 'male', 'female']], ['n' => 'min_gross', 't' => 'number', 'r' => true, 'min' => 0], ['n' => 'max_gross', 't' => 'number', 'min' => 0], ['n' => 'amount', 't' => 'number', 'r' => true, 'min' => 0], ['n' => 'feb_amount', 't' => 'number', 'min' => 0], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['state', 'gender', 'min_gross']],
    ];

    /**
     * Relationships to eager-load on every list/show so the frontend can render
     * client name / branch name / creator name without extra round-trips.
     */
    private const OWNERSHIP_WITH = [
        'client:id,org_name',
        'branch:id,name',
        // eager-load the creator's branch too so the frontend can render
        // the "Created By" sub-label without a second round-trip.
        'creator:id,name,user_type,branch_id',
        'creator.branch:id,name',
    ];

    /**
     * Batch count endpoint for the Master dashboard. Returns a `{ slug:
     * { active, inactive, total } }` map covering every registered master
     * the current user has `can_view` on. The dashboard previously made one
     * /master/{slug} request per card (~50 round-trips); this collapses
     * everything into a single query so the Active/Inactive pills paint
     * within a single tick, regardless of which masters are in the menu.
     *
     * Perm-denied or empty tables fall back to {active:0, inactive:0, total:0}
     * so the card never gets stuck in its "loading" state.
     */
    public function counts(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        // For non-super-admins, pre-load the module slug → permission row so
        // we only query the masters they're allowed to see. Super admins
        // bypass the perm check entirely (they see every master).
        $allowedSlugs = null;
        if (!$user->isSuperAdmin()) {
            $rows = \DB::table('permissions')
                ->join('modules', 'permissions.module_id', '=', 'modules.id')
                ->where('permissions.user_id', $user->id)
                ->where('permissions.can_view', true)
                ->where('modules.slug', 'like', 'master.%')
                ->pluck('modules.slug')
                ->all();
            $allowedSlugs = [];
            foreach ($rows as $moduleSlug) {
                $allowedSlugs[substr($moduleSlug, strlen('master.'))] = true;
            }
        }

        $out = [];
        foreach (self::MODELS as $slug => $modelClass) {
            if ($allowedSlugs !== null && !isset($allowedSlugs[$slug])) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
                continue;
            }
            try {
                $q = $modelClass::query();
                $this->applyScope($q, $user, $branchFilter);
                // Count in SQL with a single aggregate instead of pulling every
                // row into PHP — the old get(['status']) loaded whole tables
                // (e.g. `states` has tens of thousands of rows) on every counts
                // call, which is what made the master pages crawl (bug #16/#21).
                $stat = $q->selectRaw(
                    "COUNT(*) AS total, "
                    . "SUM(CASE WHEN LOWER(TRIM(status)) IN ('active','1','true','yes','enabled') THEN 1 ELSE 0 END) AS active"
                )->first();
                $total  = (int) ($stat->total ?? 0);
                $active = (int) ($stat->active ?? 0);
                $out[$slug] = [
                    'active'   => $active,
                    'inactive' => max(0, $total - $active),
                    'total'    => $total,
                ];
            } catch (\Throwable $e) {
                // Don't fail the whole batch for one bad model — just record
                // a zero entry so the dashboard's card unstucks gracefully.
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
            }
        }

        return response()->json($out);
    }

    /**
     * GET /api/master/bulk?keys=departments,designations,roles&fields=id,name
     *
     * Several master lists in one response.
     *
     * The Employee screen opened with ten separate master fetches, each a full
     * round trip, serialised behind the browser's connection limit — 2.3s to
     * 6.6s on the wire for about 30 KB of data that changes maybe monthly. The
     * payload was never the problem; the request count was.
     *
     * Each key is served by list() itself rather than a re-implementation, so a
     * change to scoping, permissions or the ?fields trim applies to both paths
     * automatically. A key the caller may not see is omitted rather than
     * failing the whole call — one forbidden master should not blank nine
     * legitimate ones.
     */
    public function bulk(Request $request)
    {
        $keys = collect(explode(',', (string) $request->query('keys')))
            ->map(fn ($k) => trim($k))
            ->filter()
            ->unique()
            // Bounded: the parameter comes from the URL, and each key is a
            // query. Twenty is far more than any screen asks for.
            ->take(20)
            ->values();

        if ($keys->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'Pass ?keys=a,b,c'], 422);
        }

        $out = [];
        $skipped = [];
        foreach ($keys as $slug) {
            try {
                $res = $this->list($request, $slug);
                $out[$slug] = $res instanceof \Illuminate\Http\JsonResponse
                    ? $res->getData(true)
                    : $res;
            } catch (\Throwable $e) {
                // Unknown slug, or no permission for this one master.
                $skipped[$slug] = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpException
                    ? $e->getStatusCode()
                    : 500;
            }
        }

        return response()->json([
            'status'  => true,
            'data'    => $out,
            'skipped' => $skipped,
        ]);
    }

    public function list(Request $request, string $slug)
    {
        $this->authorizeMaster($request, $slug, 'can_view');
        $modelClass = $this->resolveModel($slug);

        /* ?fields=id,name — for the callers that only need to fill a dropdown.
         *
         * A master row is built for the Master pages, which show who created it
         * and which client and branch own it: three eager-loaded relations plus
         * the four *_name attributes withOwnership() derives from them. That is
         * 427 bytes a row, and /master/countries returns 249 of them — 104 KB
         * for a picker that renders an id and a label.
         *
         * Opt-in, so the Master pages and every other existing caller are
         * untouched. Column names are intersected with the table's real columns
         * before they reach the query: the value arrives from the URL, and
         * select() would otherwise take whatever it was handed.
         */
        $requestedFields = collect(explode(',', (string) $request->query('fields')))
            ->map(fn ($f) => trim($f))
            ->filter()
            ->values();
        $slim = $requestedFields->isNotEmpty();

        $q = $modelClass::query()->orderByDesc('id');
        if (!$slim) {
            $q->with(self::OWNERSHIP_WITH);
        }
        // Eager-load the state relation for state_codes so the list endpoint
        // returns the state name inline (master_states has tens of thousands
        // of subdivisions — downloading the whole table just to translate an
        // id on the frontend was prohibitively slow).
        /* Real headcount for the two masters whose list shows an "Employees"
         * column. withCount names the attribute `employees_count`, which is
         * exactly what the frontend column reads — it previously fell back to a
         * hash-of-the-id mock, so Departments reported numbers (19, 18, 17 …)
         * larger than the entire employee table. */
        if (in_array($slug, ['departments', 'designations'], true)) {
            $q->withCount('employees');
        }
        if ($slug === 'state_codes') {
            // Country id rides along so the frontend can cascade State
            // off the chosen Country (e.g. vendor address form filters
            // states to India once the user picks India).
            $q->with('state:id,name,country_id');
        }
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        if ($search = $request->query('search')) {
            $schema = self::SCHEMAS[$slug] ?? ['fields' => []];
            $fields = $schema['fields'] ?? [];
            $q->where(function ($w) use ($fields, $search) {
                foreach ($fields as $f) {
                    if (in_array($f['t'], ['text', 'email', 'textarea', 'select'])) {
                        $w->orWhere($f['n'], 'ilike', "%{$search}%");
                    }
                }
            });
        }

        // country_id cascade filter — used by forms that resolve states /
        // ports off the chosen Country (ClientForm, BranchForm, vendor
        // address sub-modal). Replaces the prior "load 1797 states upfront"
        // pattern with "load ~30 states once a country is picked".
        if ($countryId = $request->integer('country_id')) {
            $schema = self::SCHEMAS[$slug] ?? ['fields' => []];
            $hasCountryId = collect($schema['fields'] ?? [])
                ->contains(fn ($f) => ($f['n'] ?? null) === 'country_id');
            if ($hasCountryId) {
                $q->where('country_id', $countryId);
            }
        }

        if ($slim) {
            // Anything not an actual column is dropped rather than passed
            // through; `id` is always kept because every caller keys on it.
            $columns = collect(\Illuminate\Support\Facades\Schema::getColumnListing((new $modelClass)->getTable()));
            $safe = $requestedFields->intersect($columns)->values();
            if (!$safe->contains('id') && $columns->contains('id')) $safe->push('id');
            $select = $safe->all();

            /* `name` is the label EVERY caller of this endpoint reads, but a
             * dozen masters spell their label column differently — rate_name,
             * plan_name, wh_name, module_name and so on. Asking for
             * ?fields=id,name then intersecting against the real columns
             * dropped `name` on those tables and returned rows of nothing but
             * an id, so the dropdown rendered "undefined" for every option
             * (overtime_rates in the employee and onboarding forms).
             *
             * Aliasing keeps the endpoint's promise — ask for `name`, get a
             * name — without every caller having to know which master spells
             * it which way. The alias source comes from the table's own column
             * listing, never from the request, so nothing user-supplied reaches
             * the raw fragment. Masters with no label-ish column at all are
             * left exactly as they were. */
            if ($requestedFields->contains('name') && !$columns->contains('name')) {
                $label = $columns->first(fn ($c) => str_ends_with($c, '_name'))
                    ?? $columns->first(fn ($c) => in_array($c, ['title', 'label'], true));
                if ($label) {
                    $select[] = \Illuminate\Support\Facades\DB::raw(
                        '"' . $label . '" as name'
                    );
                }
            }

            return response()->json($q->get(empty($select) ? ['*'] : $select));
        }

        return response()->json($q->get()->map(fn ($r) => $this->withOwnership($r)));
    }

    public function show(Request $request, string $slug, $id)
    {
        $this->authorizeMaster($request, $slug, 'can_view');
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);
        return response()->json($this->withOwnership($row));
    }

    public function store(Request $request, string $slug)
    {
        $this->authorizeMaster($request, $slug, 'can_add');

        // Locked-fixed masters — Address Types is a closed vocabulary
        // (Registered Office / Warehouse / Branch only). No tenant can
        // extend it; the three rows are seeded by migration
        // 2026_06_05_000100_set_address_types_office_warehouse_branch and
        // are protected from edit + delete via the is_system flag. Block
        // create here so even a direct API hit (Postman) can't add
        // new entries.
        //
        // Designations is closed for the same reason: the six seeded levels
        // ARE the org hierarchy, and every HR screen that groups by level
        // (the hierarchy strip, the level KPI tiles, reporting-line pickers)
        // assumes exactly that set. A tenant-added seventh title has no level
        // to sit at. Existing rows stay editable — only creation is blocked.
        $lockedFixed = [
            'address_types' => 'Address Types is a fixed master. Only Registered Office, Warehouse, and Branch are allowed — no new types can be added.',
            'designations' => 'Designations is a fixed master. The five seeded titles cover the whole hierarchy — no new designations can be added.',
        ];
        if (isset($lockedFixed[$slug])) {
            return response()->json(['message' => $lockedFixed[$slug]], 403);
        }

        $modelClass = $this->resolveModel($slug);
        $data = $this->validatePayload($request, $slug, null);
        $user = $request->user();
        $data['created_by'] = optional($user)->id;

        // Stamp client/branch scope from the authenticated user.
        // super_admin may optionally pass client_id/branch_id in request; others are locked to their own.
        [$clientId, $branchId] = $this->resolveOwnership($request, $user);
        $data['client_id'] = $clientId;
        $data['branch_id'] = $branchId;

        // Persist any uploaded files (Asset master ships invoice_file +
        // warranty_card_file). Convention: a file field arriving as
        // `foo_file` is stored under `master/{slug}/{kind}` and the
        // resulting disk path is written to the matching `foo_file_path`
        // column on the model. The original `foo_file` key is removed
        // from the payload so the mass-assignment doesn't try to set
        // a non-existent column.
        $data = $this->absorbUploads($request, $modelClass, $slug, $data);

        $row = $modelClass::create($data);

        // Invalidate the form-bundle dropdown caches so this new master shows
        // in the Customer/Product/Vendor/Client/Branch forms immediately.
        MasterBundleCache::bump();

        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row), 201);
    }

    public function update(Request $request, string $slug, $id)
    {
        $this->authorizeMaster($request, $slug, 'can_edit');
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH);
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);

        /* ── Hierarchical edit rule ─── */
        $denial = $this->hierarchicalDenial($request->user(), $row, 'edit');
        if ($denial) return response()->json(['message' => $denial], 403);

        /* System-seeded rows (is_system = true on the model) are
         * fully locked — name, credit limit, status, the lot. The
         * previous behaviour ("name pinned, other fields editable")
         * still let users mutate seed data which downstream modules
         * rely on as constants. Block the whole update instead so
         * admins use a custom row when they want tunable behaviour. */
        if (!empty($row->is_system)) {
            return response()->json([
                'message' => 'This record is system-managed and cannot be edited. Create a custom entry if you need different values.',
            ], 403);
        }

        $data = $this->validatePayload($request, $slug, $id);

        // Same file-upload absorbtion as store(). For update, we also
        // clean up the previously-stored file when a new one is being
        // uploaded so we don't accumulate orphans on disk.
        $data = $this->absorbUploads($request, $modelClass, $slug, $data, $row);

        $row->update($data);

        // Edited values may feed cached form-bundle dropdowns — refresh them.
        MasterBundleCache::bump();

        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row));
    }

    /**
     * slug -> ['col' => column_name, 'prefix' => 'DEPT-', 'pad' => 3]
     * Registry of masters that auto-generate a sequenced code (e.g. DEPT-001).
     * The next number is computed on the server against the same tenant scope
     * the row will be saved under, so each tenant gets its own DEPT-001…N
     * series independently of other tenants.
     */
    private const AUTO_CODES = [
        'departments'      => ['col' => 'code', 'prefix' => 'DEPT-', 'pad' => 3],
        'expense_category' => ['col' => 'code', 'prefix' => 'EXC-',  'pad' => 2],
    ];

    /**
     * Return the next auto-generated code for the given master, scoped to the
     * (client_id, branch_id) tuple the new row will be stamped with. Used by
     * the frontend to pre-fill the code field on form open.
     *
     * Response: { "code": "DEPT-001", "prefix": "DEPT-" }   when configured
     *           { "code": null }                            when not configured
     */
    public function nextCode(Request $request, string $slug)
    {
        $this->authorizeMaster($request, $slug, 'can_view');

        if (!isset(self::AUTO_CODES[$slug])) {
            return response()->json(['code' => null]);
        }
        $cfg = self::AUTO_CODES[$slug];
        $col    = $cfg['col'];
        $prefix = $cfg['prefix'];
        $pad    = $cfg['pad'];

        $modelClass = $this->resolveModel($slug);

        // Compute the next code over the SAME set of rows the LIST shows
        // (applyReadScope + the active branch filter) — NOT a strict
        // (client_id, branch_id) tuple. Otherwise a user who can SEE
        // DEPT-001…010 (via the hierarchy / a broader scope) but whose own
        // strict tuple holds none of them would be handed "DEPT-001" again,
        // colliding with a visible row. Mirrors index()'s scoping.
        $q = $modelClass::query();
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        $codes = $q->pluck($col);
        $max = 0;
        $re  = '/^' . preg_quote($prefix, '/') . '(\d+)$/i';
        foreach ($codes as $c) {
            if (preg_match($re, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }
        $next = $prefix . str_pad((string) ($max + 1), $pad, '0', STR_PAD_LEFT);

        return response()->json([
            'code'   => $next,
            'prefix' => $prefix,
        ]);
    }

    public function destroy(Request $request, string $slug, $id)
    {
        $this->authorizeMaster($request, $slug, 'can_delete');
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query();
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);

        /* ── Hierarchical delete rule ─── */
        $denial = $this->hierarchicalDenial($request->user(), $row, 'delete');
        if ($denial) return response()->json(['message' => $denial], 403);

        // System-seeded rows are pinned. Stage 1 of employee onboarding
        // pulls Laptop / Mobile asset lists by category name; deleting
        // the underlying category would silently break that screen.
        if ($slug === 'asset_categories' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This category is system-managed and cannot be deleted.',
            ], 403);
        }
        // Same protection for the seeded "Office" address type — other
        // pages reference it by name so deletion would break them.
        if ($slug === 'address_types' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This address type is system-managed and cannot be deleted.',
            ], 403);
        }
        // System-seeded Customer Consignee Types (Retailer, Wholesaler)
        // are referenced by customer records via customer_type — block
        // deletion so the link doesn't go dangling.
        if ($slug === 'customer_types' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This customer consignee type is system-managed and cannot be deleted.',
            ], 403);
        }
        // System-seeded Risk Levels (Low, High) — referenced by KYC /
        // compliance flows, blocking delete keeps those links stable.
        if ($slug === 'risk_levels' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This risk level is system-managed and cannot be deleted.',
            ], 403);
        }
        // System-seeded Customer Classifications (Standard, VIP) —
        // customer records reference these tiers for credit + payment
        // terms, so deletion would break those links.
        if ($slug === 'customer_classifications' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This customer classification is system-managed and cannot be deleted.',
            ], 403);
        }

        /* A GST rate that products still reference must not be deleted — doing
         * so orphans products.gst_id and the Product screens then render a
         * stale/random rate (QA #43, #44).
         *
         * HSN codes are no longer counted here. They used to be, back when the
         * HSN master carried its own GST rate; that field is gone from the
         * form, so an HSN row's leftover gst_rate_id is a value nobody can see
         * or clear. Keeping it in the guard would make a GST rate permanently
         * undeletable, blocked by a link with no screen to unlink it on. */
        if ($slug === 'gst_percentage') {
            $productHits = \App\Models\Product::where('gst_id', $row->id)->count();
            if ($productHits > 0) {
                return response()->json([
                    'message' => 'This GST rate is in use by ' . $productHits . ' product'
                        . ($productHits === 1 ? '' : 's')
                        . ' and cannot be deleted. Reassign those records to another GST rate first.',
                ], 409);
            }
        }

        /* An ASSET currently held by somebody must not be deleted — the device
           is on a desk, and dropping the master row leaves the employee's
           record pointing at nothing (their profile, the exit clearance list
           and the asset-return checklist all resolve the name from here).
           "Held" matches EmployeeController::assertAssetsNotDoubleBooked
           exactly, so the picker, the double-booking guard and this rule can
           never disagree about who has what: disabled employees still hold
           their kit, employees who have EXITED have returned it. */
        if ($slug === 'assets') {
            $holders = \App\Models\Employee::query()
                ->withTrashed()
                ->where(function ($w) {
                    $w->whereNull('status')
                      ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                ->when($row->client_id, fn ($x) => $x->where('client_id', $row->client_id))
                ->get(['id', 'display_name', 'emp_code', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])
                /* Compared in PHP, not with whereJsonContains: multipart form
                   posts store the "other assets" ids as STRINGS (["3"]), so a
                   JSON containment check for the integer 3 silently misses
                   them and the asset would delete anyway. */
                ->filter(function ($e) use ($row) {
                    $id = (int) $row->id;
                    if ((int) $e->laptop_master_asset_id === $id) return true;
                    if ((int) $e->mobile_master_asset_id === $id) return true;
                    foreach ((array) ($e->other_master_asset_ids ?? []) as $aid) {
                        if ((int) $aid === $id) return true;
                    }
                    return false;
                })
                ->values();

            if ($holders->isNotEmpty()) {
                $names = $holders->take(3)
                    ->map(fn ($e) => $e->display_name ?: $e->emp_code ?: ('Employee #' . $e->id))
                    ->implode(', ');
                $more = $holders->count() - min(3, $holders->count());
                return response()->json([
                    'message' => 'This asset is currently assigned to ' . $names
                        . ($more > 0 ? " and {$more} other" . ($more === 1 ? '' : 's') : '')
                        . ' and cannot be deleted. Unassign it from the employee record first.',
                ], 409);
            }
        }

        /* An EXPENSE CATEGORY referenced by a claim (or by a line on a claim
           payment) must not be deleted — those rows keep `category_id` and read
           the live name from it, so deleting the master leaves settled expense
           history labelled with nothing. */
        if ($slug === 'expense_category') {
            $claimHits   = \App\Models\ExpenseClaim::where('category_id', $row->id)->count();
            $paymentHits = \App\Models\ExpenseClaimPayment::where('category_id', $row->id)->count();
            if ($claimHits > 0 || $paymentHits > 0) {
                $parts = [];
                if ($claimHits > 0)   $parts[] = $claimHits . ' expense claim' . ($claimHits === 1 ? '' : 's');
                if ($paymentHits > 0) $parts[] = $paymentHits . ' claim payment line' . ($paymentHits === 1 ? '' : 's');
                return response()->json([
                    'message' => 'This expense category cannot be deleted because it is associated with '
                        . implode(' and ', $parts) . '. Reassign or remove those records first.',
                ], 409);
            }
        }

        $row->delete();

        // Removing a master must drop it from the cached form-bundle dropdowns.
        MasterBundleCache::bump();

        return response()->json(['message' => 'Deleted']);
    }

    /* ---------------- helpers ---------------- */

    /**
     * Enforce a granular permission (can_view / can_add / can_edit / can_delete /
     * can_export / can_import / can_approve) for the master identified by $slug.
     *
     * Module slugs in the modules table are prefixed with `master.`, matching
     * what AuthController::formatUser() returns to the frontend (see the
     * `master.` keys used by Sidebar/MasterPlaceholder/MasterPage). Super
     * admins always pass; everyone else needs an explicit row in `permissions`
     * with the requested column = true.
     */
    private function authorizeMaster(Request $request, string $slug, string $perm): void
    {
        $user = $request->user();
        if (!$user) {
            abort(401, 'Authentication required');
        }
        if ($user->isSuperAdmin()) {
            return;
        }

        $allowed = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];
        if (!in_array($perm, $allowed, true)) {
            abort(500, "Invalid permission flag: {$perm}");
        }

        $moduleSlug = "master.{$slug}";
        $moduleId = Module::where('slug', $moduleSlug)->value('id');
        if (!$moduleId) {
            abort(403, "No module registered for {$moduleSlug}");
        }

        $hasPerm = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();

        if (!$hasPerm) {
            abort(403, "You do not have permission to perform this action ({$perm}).");
        }
    }

    private function resolveModel(string $slug): string
    {
        if (!isset(self::MODELS[$slug])) {
            abort(404, "Unknown master: {$slug}");
        }
        return self::MODELS[$slug];
    }

    /**
     * Hierarchical edit/delete gate.
     *
     * Returns a denial message (string) if the current user is NOT allowed
     * to mutate this row, or `null` if they may proceed.
     *
     * Rank order (higher = more privileged):
     *   super_admin              5
     *   client_admin / user      4
     *   branch_user / employee   2   (every branch is an isolated peer)
     *
     * Rule: rank(creator) must be <= rank(currentUser). The creator's
     * "level" is derived from the row's ownership stamps (client_id +
     * branch_id).
     *
     * Users may always mutate their OWN rows (created_by === user.id).
     */
    private function hierarchicalDenial(?User $user, $row, string $action): ?string
    {
        return MasterVisibility::hierarchicalDenial($user, $row, $action);
    }

    /**
     * Flatten eager-loaded client/branch/creator into scalar name fields on the
     * serialized row so the frontend doesn't need to drill into nested objects.
     */
    private function withOwnership($row): array
    {
        $arr = $row->toArray();
        $arr['client_name']       = $row->client?->org_name;
        $arr['branch_name']       = $row->branch?->name;
        $arr['creator_name']      = $row->creator?->name;
        $arr['creator_user_type'] = $row->creator?->user_type;

        /* Absolute URL for every stored file path.
         *
         * The frontend used to build these itself as `{origin}/storage/{path}`.
         * That is only correct while the app runs on the LOCAL disk — the Azure
         * deployment serves the same file from
         * idimsbucket.blob.core.windows.net/cbc-saas/…, so every master
         * attachment link (Asset Invoice / Warranty Card) opened a 404 there
         * while working perfectly on a developer's machine.
         *
         * file_url() resolves against the CONFIGURED disk, so the one value is
         * right in both environments. Keys are snapshotted before the loop
         * because we add to the same array inside it. */
        foreach (array_keys($arr) as $k) {
            if (!is_string($k) || !str_ends_with($k, '_path')) continue;
            $v = $arr[$k];
            if (!is_string($v) || trim($v) === '') continue;
            $arr[$k . '_url'] = file_url($v);
        }

        // GST rates referenced by any product are "in use" — the frontend
        // disables their Delete button + shows a tooltip, mirroring the hard
        // guard in destroy() (QA #43). HSN codes are no longer part of this
        // test; see the note on that guard.
        if ($row instanceof \App\Models\Masters\GstPercentage) {
            $arr['in_use'] = \App\Models\Product::where('gst_id', $row->id)->exists();
        }

        return $arr;
    }


    /**
     * Pull any uploaded files off the request, stash them on the
     * public disk, and rewrite the data array so the `_path` column on
     * the model receives the resulting disk-relative path.
     *
     * Convention: a request key ending in `_file` (e.g. `invoice_file`)
     * maps to a column ending in `_file_path` (e.g. `invoice_file_path`)
     * on the same model. We only operate on keys the model actually
     * supports — anything else is ignored, so non-asset masters that
     * don't ship file fields are unaffected.
     *
     * On update, the previously-saved file is best-effort deleted from
     * disk before the new path overwrites the column.
     */
    private function absorbUploads(Request $request, string $modelClass, string $slug, array $data, $row = null): array
    {
        $files = $request->allFiles();
        if (empty($files)) return $data;

        $fillable = (new $modelClass())->getFillable();

        foreach ($files as $key => $file) {
            if (!is_string($key)) continue;
            // Resolve the target column. Most file fields ship `*_file`
            // → `*_file_path`. Fall back to the key itself in case a
            // master uses a path-style name directly.
            $targetCol = str_ends_with($key, '_file_path')
                ? $key
                : (str_ends_with($key, '_file') ? $key . '_path' : $key);

            if (!in_array($targetCol, $fillable, true)) continue;

            // Single-file fields arrive as UploadedFile, multi-file as
            // an array — handle both shapes defensively.
            $uploaded = is_array($file) ? ($file[0] ?? null) : $file;
            if (!$uploaded) continue;

            // Drop the stale file from disk on update before the new
            // path takes its place. Wrapped in try/catch — a missing
            // file mustn't block the save.
            if ($row && !empty($row->{$targetCol})) {
                try { \Illuminate\Support\Facades\Storage::disk('public')->delete($row->{$targetCol}); } catch (\Throwable $e) {}
            }

            $path = $uploaded->store("master/{$slug}", 'public');
            $data[$targetCol] = $path;

            // Make sure the raw `*_file` key isn't accidentally mass-
            // assigned (would crash on a missing column).
            unset($data[$key]);
        }

        return $data;
    }

    /**
     * Scope a query to what the current user is allowed to see. Rules:
     *
     *   super_admin         -> everything
     *
     *   client_admin/user   -> rows where client_id IS NULL (super-admin "global" rows)
     *                          OR client_id = own client
     *
     *   branch_user         -> rows where client_id IS NULL
     *                          OR (client_id = own client AND (
     *                                branch_id IS NULL          -- client-level rows
     *                                OR branch_id = own branch  -- own branch rows
     *                              ))
     *                          Every branch is an equal, isolated peer.
     */
    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        MasterVisibility::applyReadScope($q, $user, $branchFilter);
    }

    /**
     * Pick the (client_id, branch_id) that should be stamped on a new row.
     * Non-super-admins cannot spoof other tenants' ids.
     */
    private function resolveOwnership(Request $request, $user): array
    {
        if ($user && $user->user_type === 'super_admin') {
            return [
                $request->input('client_id'),
                $request->input('branch_id'),
            ];
        }

        if ($user && in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return [$user->client_id, null];
        }

        // branch_user / employee — both belong to a single (client, branch)
        // tuple, so any master row they create gets stamped with both. Same
        // rule keeps tenant numbering sequences (e.g. DEPT-###) isolated.
        if ($user && in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return [$user->client_id, $user->branch_id];
        }

        return [null, null];
    }

    /**
     * Human label for a value used in a duplicate-row message. Reference
     * columns hold an id, so "Department: 3" tells the user nothing — resolve
     * it to the referenced row's name when we can, and fall back to the raw
     * value when we can't (unknown ref, deleted row, non-ref column).
     */
    private function refLabelFor(?string $refSlug, $value): string
    {
        if ($refSlug === null || $value === null || $value === '') {
            return (string) $value;
        }
        try {
            $refModel = $this->resolveModel($refSlug);
            $row = $refModel::find($value);
            $label = $row?->name ?? $row?->title ?? null;
            return $label !== null ? (string) $label : (string) $value;
        } catch (\Throwable $e) {
            return (string) $value;
        }
    }

    private function validatePayload(Request $request, string $slug, $id = null): array
    {
        $schema = self::SCHEMAS[$slug] ?? ['fields' => [], 'uFields' => []];
        $fields = $schema['fields'] ?? [];
        $uFields = $schema['uFields'] ?? [];
        // `uEach` lists fields that must EACH be independently unique
        // (in addition to / separate from the composite `uFields` check).
        // Nullable fields with an empty value skip the unique check via
        // Laravel's `nullable` rule.
        $uEach = $schema['uEach'] ?? [];
        // `dupContext` names extra columns quoted back in the duplicate message
        // so it identifies the offending ROW, not just the value. Matters where
        // the UI slices the list by a column outside the unique key — the clash
        // then sits on a tab the user isn't looking at (see the roles schema).
        $dupContext = $schema['dupContext'] ?? [];
        $modelClass = $this->resolveModel($slug);
        $table = (new $modelClass)->getTable();
        $isComposite = count($uFields) > 1;

        // Field-type lookup so the case-insensitive logic below knows
        // which uFields entries are text (need LOWER comparison) vs.
        // numeric / reference IDs (need exact equality — "01" and "1"
        // shouldn't collide just because lower-casing is a no-op).
        $fieldTypeMap = [];
        foreach ($fields as $f) {
            $fieldTypeMap[$f['n']] = ['t' => $f['t'] ?? 'text', 'ref' => $f['ref'] ?? null];
        }
        $isTextField = function (string $col) use ($fieldTypeMap): bool {
            $info = $fieldTypeMap[$col] ?? null;
            if (!$info) return false;
            if (!empty($info['ref'])) return false; // FK ids → exact
            return in_array($info['t'], ['text', 'textarea', 'email'], true);
        };

        // Promote single-field text uFields to case-insensitive checks
        // so "India" and "india" can't both exist as separate rows.
        // Reference IDs + number fields keep exact-match uniqueness
        // (no semantic value in case-folding them).
        $singleTextUFields = [];
        if (!$isComposite && !empty($uFields)) {
            foreach ($uFields as $col) {
                if ($isTextField($col)) $singleTextUFields[] = $col;
            }
        }

        // Determine the (client_id, branch_id) tuple this row will live
        // under so the unique check matches what `store()` will stamp.
        // On update we keep the existing row's owner; on create we ask
        // resolveOwnership() based on the caller's user_type.
        $tenantClientId = null;
        $tenantBranchId = null;
        if ($id !== null) {
            $existing = $modelClass::find($id);
            $tenantClientId = $existing?->client_id;
            $tenantBranchId = $existing?->branch_id;
        } else {
            [$tenantClientId, $tenantBranchId] = $this->resolveOwnership($request, $request->user());
        }
        $applyTenantScope = function ($rule) use ($tenantClientId, $tenantBranchId) {
            return $rule->where(function ($q) use ($tenantClientId, $tenantBranchId) {
                $tenantClientId === null
                    ? $q->whereNull('client_id')
                    : $q->where('client_id', $tenantClientId);
                $tenantBranchId === null
                    ? $q->whereNull('branch_id')
                    : $q->where('branch_id', $tenantBranchId);
            });
        };

        // Pre-validation normalization (e.g. uppercase ISO codes) so the
        // uniqueness check and the stored value are case-canonical. Without
        // this, "us" and "US" would bypass each other.
        $normalizers = [];
        foreach ($fields as $f) {
            $norm = $f['normalize'] ?? null;
            if (!$norm) continue;
            $val = $request->input($f['n']);
            if (is_string($val) && $val !== '') {
                $normalized = $norm === 'upper' ? strtoupper($val)
                    : ($norm === 'lower' ? strtolower($val) : $val);
                $normalizers[$f['n']] = $normalized;
            }
        }
        if ($normalizers) $request->merge($normalizers);

        $rules = [];
        foreach ($fields as $f) {
            $r = [];
            $r[] = $f['r'] ?? false ? 'required' : 'nullable';
            if ($f['t'] === 'number') {
                $r[] = 'numeric';
                // Honour per-field numeric bounds (e.g. percentages capped at
                // 0..100) so the server rejects out-of-range values too (bugs
                // #31/#32), not just the frontend.
                if (isset($f['min'])) $r[] = 'min:' . $f['min'];
                if (isset($f['max'])) $r[] = 'max:' . $f['max'];
            } elseif ($f['t'] === 'email') {
                $r[] = 'email';
                $r[] = 'max:255';
            } elseif ($f['t'] === 'date') {
                $r[] = 'date';
            } elseif ($f['t'] === 'textarea') {
                $r[] = 'string';
                // Textareas are uncapped by default (descriptions/addresses can
                // run long), but honour an explicit `maxLen` so fields backed by
                // a fixed-width column can't overflow it (Postgres errors hard).
                if (isset($f['maxLen'])) {
                    $r[] = 'max:' . $f['maxLen'];
                }
            } elseif (!empty($f['ref'])) {
                // Reference IDs (foreign keys) can arrive as either strings (from
                // <MasterSelect>'s hidden input) or integers (when echoing back a
                // row's existing values). Accept both — Eloquent will cast to int
                // on save anyway because the underlying column is unsignedBigInt.
                $r[] = 'integer';
            } else {
                $r[] = 'string';
                /* Default cap on text fields lowered from 255 → 50 to
                 * match the frontend's maxLength. Stops users pasting
                 * paragraphs into a name. Per-field override via
                 * `maxLen` in SCHEMAS lets specific fields like
                 * legal_name / address lines opt back into longer
                 * limits when needed. */
                $r[] = 'max:' . ($f['maxLen'] ?? 50);
            }
            // Enforce enum options server-side when present and no ref override
            if (!empty($f['opts']) && empty($f['ref'])) {
                $r[] = Rule::in($f['opts']);
            }
            // Optional per-field regex — used for masters whose code/number
            // columns have a fixed format (e.g. HSN/SAC = 6–8 digits). The
            // regex is wrapped in slashes by the caller so Laravel passes it
            // straight to PHP's preg_match without escaping.
            if (!empty($f['pattern'])) {
                $r[] = 'regex:' . $f['pattern'];
            }
            // Single-field uniqueness — applied per-field. Composite uniqueness
            // (uFields with more than one column) is enforced AFTER this loop so
            // the unique check matches the ROW combination instead of each field
            // independently. Without that, picking a value once would block any
            // other row from using it even with a different second column.
            // TEXT fields skip the case-sensitive Rule::unique here and run
            // through the LOWER() block below so "India" and "india" collide.
            // Numeric / reference-id uFields keep the exact Rule::unique check.
            if (!$isComposite
                && in_array($f['n'], $uFields, true)
                && !in_array($f['n'], $singleTextUFields, true)
            ) {
                $rule = $applyTenantScope(Rule::unique($table, $f['n']));
                if ($id) $rule = $rule->ignore($id);
                $r[] = $rule;
            } 
            // `uEach` (independent per-field uniqueness) is checked AFTER
            // this loop using a case-INSENSITIVE comparison, so "india" and
            // "India" are treated as the same value. Skip the standard
            // case-sensitive Rule::unique here for those fields — it would
            // miss case-mismatched duplicates and just adds a redundant
            // query when both pass.
            $rules[$f['n']] = $r;
        }

        // Per-field custom validation messages — currently only used by
        // schemas that set a `pattern` + `patternMessage` (e.g. HSN/SAC).
        $messages = [];
        foreach ($fields as $f) {
            if (!empty($f['pattern']) && !empty($f['patternMessage'])) {
                $messages[$f['n'] . '.regex'] = $f['patternMessage'];
            }
        }

        $validated = $request->validate($rules, $messages);

        // Case-insensitive uniqueness check for `uEach` + promoted
        // single-text `uFields`. Done manually with whereRaw + LOWER()
        // because Laravel's Rule::unique builds a case-sensitive
        // `column = ?` clause we can't easily override. This is what
        // stops "India" / "india" / "INDIA" from existing as separate
        // rows across every master that declares uniqueness on a text
        // field.
        $caseInsensitiveCols = array_values(array_unique(array_merge($uEach, $singleTextUFields)));
        foreach ($caseInsensitiveCols as $colName) {
            $value = $validated[$colName] ?? null;
            if ($value === null || $value === '') continue; // nullable → skip

            $query = $modelClass::query()
                ->whereRaw('LOWER(' . $colName . ') = LOWER(?)', [(string) $value]);

            if ($id) $query->where('id', '!=', $id);

            // Always scope the case-insensitive uniqueness check by the
            // (client_id, branch_id) tuple this row belongs to so the same
            // name can recur across branches of one client.
            $tenantClientId === null
                ? $query->whereNull('client_id')
                : $query->where('client_id', $tenantClientId);
            $tenantBranchId === null
                ? $query->whereNull('branch_id')
                : $query->where('branch_id', $tenantBranchId);

            // Keep the row rather than a boolean so `dupContext` can quote it.
            $clash = $query->first();
            if ($clash) {
                // Pretty per-field labels for the duplicate message — falls
                // back to a humanized version of the column name.
                $labels = [
                    'gstin' => 'GSTIN',
                    'pan' => 'PAN',
                    'cin' => 'CIN',
                    'iso_code' => 'ISO code',
                    'short_code' => 'Short code',
                    'company_name' => 'Company name',
                    'name' => 'Name',
                    'code' => 'Code',
                    'account_number' => 'Account number',
                    'ifsc_code' => 'IFSC code',
                    'hsn_code' => 'HSN/SAC code',
                    'title' => 'Title',
                ];
                $label = $labels[$colName] ?? ucfirst(str_replace('_', ' ', $colName));
                $ctx = [];
                foreach ($dupContext as $ctxCol) {
                    if ($ctxCol === $colName) continue;
                    $ctxVal = trim((string) ($clash->{$ctxCol} ?? ''));
                    if ($ctxVal === '') continue;
                    $ctxLabel = $labels[$ctxCol] ?? ucfirst(str_replace('_', ' ', $ctxCol));
                    $ctx[] = "{$ctxLabel}: {$ctxVal}";
                }
                $suffix = $ctx ? ' (' . implode(', ', $ctx) . ')' : '';
                throw ValidationException::withMessages([
                    $colName => "This {$label} is already registered{$suffix}. Please use a different value.",
                ]);
            }

            // ── System-seed collision check ────────────────────────────
            // The tenant-scoped query above only sees rows owned by the
            // current (client, branch). Globally-seeded is_system rows
            // live at (client_id=NULL, branch_id=NULL), so a branch
            // user could otherwise shadow-create "Registered Office"
            // inside their own branch — visible alongside the real
            // system one. Run a second case-insensitive lookup against
            // the global system rows and reject if it matches.
            $tableName = (new $modelClass)->getTable();
            if (\Illuminate\Support\Facades\Schema::hasColumn($tableName, 'is_system')) {
                $sysQuery = $modelClass::query()
                    ->whereNull('client_id')
                    ->whereNull('branch_id')
                    ->where('is_system', true)
                    ->whereRaw('LOWER(' . $colName . ') = LOWER(?)', [(string) $value]);
                if ($id) $sysQuery->where('id', '!=', $id);
                if ($sysQuery->exists()) {
                    $label = $labels[$colName] ?? ucfirst(str_replace('_', ' ', $colName));
                    throw ValidationException::withMessages([
                        $colName => "\"{$value}\" is a system-managed {$label} and cannot be re-created.",
                    ]);
                }
            }
        }

        // Composite uniqueness — match the COMBINATION of all uFields.
        // Done manually so each TEXT column in the composite uses a
        // case-insensitive LOWER() comparison while reference-id /
        // numeric columns stay exact. Replaces the old Rule::unique
        // path which couldn't case-fold any column.
        if ($isComposite) {
            $query = $modelClass::query();
            foreach ($uFields as $col) {
                $val = $validated[$col] ?? null;
                if ($val === '') $val = null;
                // An optional column left blank is its own bucket, not a
                // wildcard: `where(col, null)` compiles to `col = NULL`, which
                // matches nothing, so two rows that are identical except for
                // both having no department slipped through as non-duplicates.
                if ($val === null) {
                    $query->whereNull($col);
                } elseif ($isTextField($col)) {
                    $query->whereRaw('LOWER(' . $col . ') = LOWER(?)', [(string) $val]);
                } else {
                    $query->where($col, $val);
                }
            }
            if ($id) $query->where('id', '!=', $id);
            $tenantClientId === null
                ? $query->whereNull('client_id')
                : $query->where('client_id', $tenantClientId);
            $tenantBranchId === null
                ? $query->whereNull('branch_id')
                : $query->where('branch_id', $tenantBranchId);
            if ($query->exists()) {
                $first = $uFields[0];
                // Spell out the combination that clashed — "already exists"
                // alone sends the user hunting through a list that is sliced
                // by exactly these columns.
                $human = fn (string $c) => ucfirst(str_replace('_', ' ', preg_replace('/_id$/', '', $c)));
                $ctx = [];
                foreach (array_slice($uFields, 1) as $col) {
                    $val = $validated[$col] ?? null;
                    $ctx[] = $human($col) . ': ' . ($val === null || $val === ''
                        ? '—'
                        : $this->refLabelFor($fieldTypeMap[$col]['ref'] ?? null, $val));
                }
                $suffix = $ctx ? ' (' . implode(', ', $ctx) . ')' : '';
                throw ValidationException::withMessages([
                    $first => $human($first) . ' "' . ($validated[$first] ?? '') . '" already exists'
                        . $suffix . '. Change one of them.',
                ]);
            }
        }

        // Strip empty strings on nullable fields so DB gets NULL
        foreach ($validated as $k => $v) {
            if ($v === '') $validated[$k] = null;
        }
        return $validated;
    }
}

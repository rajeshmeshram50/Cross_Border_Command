<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MasterController extends Controller
{
    private const INVENTORY_COUNT_MODELS = [
        'warehouse_master' => \App\Models\Inventory\Warehouse::class,
        'zone_master'      => \App\Models\Inventory\Zone::class,
        'racks'            => \App\Models\Inventory\Rack::class,
        'product_flags'    => \App\Models\Inventory\ProductFlag::class,
    ];

    private const CLM_COUNT_MODELS = [
        'clm.authority'        => \App\Models\ClmAuthority::class,
        'clm.kyc'              => \App\Models\ClmKycDocument::class,
        'clm.due_diligence'    => \App\Models\ClmDdDocument::class,
        'clm.trade_licenses'   => \App\Models\ClmTradeLicense::class,
        'clm.quality_docs'     => \App\Models\ClmQcDocument::class,
        'clm.trade_documents'  => \App\Models\ClmTradeDocLibrary::class,
        'clm.agreements'       => \App\Models\ClmAgreementLibrary::class,
        'clm.terms_conditions' => \App\Models\ClmTncLibrary::class,
        'clm.clause_library'   => \App\Models\ClmClauseLibrary::class,
    ];

    private const INVENTORY_COUNT_PERM_ALIAS = [
        'product_flags' => 'warehouse_master',
    ];

    private const MODELS = [
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
        'supplier_category' => \App\Models\Masters\SupplierCategory::class,
        'service_categories' => \App\Models\Masters\ServiceCategory::class,
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

    private const SCHEMAS = [
        'company' => ['fields' => [['n' => 'company_name', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'gstin', 't' => 'text', 'r' => true, 'normalize' => 'upper'], ['n' => 'pan', 't' => 'text', 'r' => true, 'normalize' => 'upper'], ['n' => 'cin', 't' => 'text', 'normalize' => 'upper'], ['n' => 'iec', 't' => 'text'], ['n' => 'email', 't' => 'email'], ['n' => 'mobile', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'state', 't' => 'text'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['company_name', 'gstin', 'pan']],
        'bank_accounts' => ['fields' => [['n' => 'bank_name', 't' => 'text', 'r' => true, 'pattern' => "/^[A-Za-z][A-Za-z .,&'()\\-]*$/", 'patternMessage' => 'Bank Name may only contain letters (no numbers or special characters).'], ['n' => 'account_holder', 't' => 'text', 'r' => true, 'pattern' => "/^[A-Za-z][A-Za-z .,&'()\\-]*$/", 'patternMessage' => 'Account Holder may only contain letters.'], ['n' => 'account_number', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{9,18}$/', 'patternMessage' => 'Account Number must be 9 to 18 digits.'], ['n' => 'ifsc_code', 't' => 'text', 'r' => true, 'normalize' => 'upper', 'pattern' => '/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/', 'patternMessage' => 'Enter a valid 11-character IFSC code.'], ['n' => 'branch_name', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'swift_code', 't' => 'text', 'r' => true], ['n' => 'ad_code', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{14}$/', 'patternMessage' => 'AD Code must be exactly 14 digits.'], ['n' => 'is_primary', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['account_number', 'ifsc_code']],
        'departments' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'parent_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'head', 't' => 'select'], ['n' => 'email', 't' => 'email'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code'], 'tenantScoped' => true],
        'roles' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'role_type', 't' => 'select', 'r' => true, 'opts' => ['Primary', 'Ancillary']], ['n' => 'department_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'role_category', 't' => 'select', 'opts' => ['Technical', 'Management', 'Operational', 'Support', 'Sales', 'Compliance', 'Finance', 'HR']], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'role_type', 'department_id'], 'dupContext' => ['code']],
        'designations' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'department_id', 't' => 'select', 'ref' => 'departments'], ['n' => 'level', 't' => 'select', 'r' => true, 'opts' => ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee']], ['n' => 'reports_to_id', 't' => 'select', 'ref' => 'designations'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'kpis' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'role_id', 't' => 'select', 'r' => true, 'ref' => 'roles'], ['n' => 'target_type', 't' => 'select', 'r' => true, 'opts' => ['Numeric', 'Percentage', 'Currency', 'Boolean', 'Date-based', 'Rating']], ['n' => 'priority', 't' => 'select', 'r' => true, 'opts' => ['Critical', 'High', 'Medium', 'Low']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'countries' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'iso_code', 't' => 'text', 'normalize' => 'upper'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'iso_code']],
        'states' => ['fields' => [['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'country_id']],
        'state_codes' => ['fields' => [['n' => 'state_id', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'state_code', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['state_id', 'state_code']],
        'address_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'port_of_loading' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        'port_of_discharge' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'city', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        'segments' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'hsn_codes' => ['fields' => [['n' => 'hsn_code', 't' => 'text', 'r' => true, 'pattern' => '/^[0-9]{4,8}$/', 'patternMessage' => 'HSN/SAC code must be 4 to 8 digits.'], ['n' => 'description', 't' => 'textarea', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['hsn_code']],
        'gst_percentage' => ['fields' => [['n' => 'percentage', 't' => 'number', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['percentage']],
        'currencies' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'symbol', 't' => 'text', 'r' => true], ['n' => 'exchange_rate', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'code']],
        'uom' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'unit_type', 't' => 'select', 'opts' => ['Weight', 'Volume', 'Length', 'Area', 'Count', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['title', 'short_code']],
        'packaging_material' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'material_type', 't' => 'select', 'opts' => ['Bag', 'Box', 'Crate', 'Drum', 'Pallet', 'Wrap', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['title']],
        'conditions' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'incoterms' => ['fields' => [['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'full_name', 't' => 'text', 'r' => true], ['n' => 'transport_mode', 't' => 'select', 'opts' => ['Sea/Inland Waterway', 'Any Mode', 'Air', 'Road', 'Rail']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['code', 'full_name']],
        'customer_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'gst_applicable', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'customer_classifications' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'credit_limit', 't' => 'number'], ['n' => 'payment_terms', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'vendor_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'vendor_behaviour' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'applicable_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'party_type', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Third Party', 'Carrier', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'license_name' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'license_code', 't' => 'text'], ['n' => 'issuing_authority', 't' => 'text'], ['n' => 'validity_months', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'license_code']],
        'risk_levels' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'text'], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name']],
        'document_type' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'applicable_to', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Supplier', 'Both', 'Internal']], ['n' => 'is_mandatory', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'haz_class' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'compliance_behaviours' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'assets' => ['fields' => [['n' => 'asset_name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text'], ['n' => 'asset_type_id', 't' => 'select', 'r' => true, 'ref' => 'asset_categories'], ['n' => 'description', 't' => 'textarea'], ['n' => 'vendor_id', 't' => 'select', 'ref' => 'vendor_directory'], ['n' => 'purchase_date', 't' => 'date'], ['n' => 'warranty_expiry_date', 't' => 'date'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive', 'Under Repair', 'Disposed']]], 'uEach' => ['asset_name', 'code']],
        'asset_categories' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'depreciation_rate', 't' => 'number'], ['n' => 'useful_life_years', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'expense_category' => ['fields' => [['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'monthly_limit', 't' => 'number'], ['n' => 'yearly_limit', 't' => 'number'], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['code', 'name'], 'tenantScoped' => true],
        'payment_terms' => ['fields' => [['n' => 'term_code', 't' => 'text', 'r' => true], ['n' => 'term_name', 't' => 'text', 'r' => true], ['n' => 'credit_days', 't' => 'number', 'r' => true], ['n' => 'advance_pct', 't' => 'number'], ['n' => 'payment_type', 't' => 'select', 'r' => true, 'opts' => ['Full Advance', 'Partial Advance', 'Credit', 'Milestone-Based', 'COD']], ['n' => 'milestone_desc', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['term_code', 'term_name']],
        'approval_authority' => ['fields' => [['n' => 'role_name', 't' => 'text', 'r' => true], ['n' => 'module_scope', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Payment', 'VTI', 'GRN', 'All']], ['n' => 'min_value', 't' => 'number'], ['n' => 'max_value', 't' => 'number', 'r' => true], ['n' => 'currency', 't' => 'select', 'opts' => ['INR', 'USD', 'EUR', 'GBP']], ['n' => 'escalate_to', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['role_name', 'module_scope']],
        'procurement_category' => ['fields' => [['n' => 'cat_code', 't' => 'text', 'r' => true], ['n' => 'cat_name', 't' => 'text', 'r' => true], ['n' => 'match_logic', 't' => 'select', 'r' => true, 'opts' => ['3-Way Match (PO+VTI+GRN)', '2-Way Match (PO+VTI)', '4-Way Match (PO+VTI+GRN+QC)']], ['n' => 'grn_required', 't' => 'select', 'r' => true, 'opts' => ['Yes — Physical Receipt', 'Yes — Service Confirmation', 'No']], ['n' => 'gst_applicable', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No', 'Reverse Charge']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['cat_code', 'cat_name']],
        'sourcing_type' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'quotation_required', 't' => 'select', 'r' => true, 'opts' => ['Mandatory — Min 3 Quotes', 'Mandatory — Min 1 Quote', 'Optional', 'Not Required']], ['n' => 'approval_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'urgency_flag', 't' => 'select', 'opts' => ['Normal', 'Urgent', 'Emergency']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['type_code', 'type_name']],
        'deviation_reason' => ['fields' => [['n' => 'reason_code', 't' => 'text', 'r' => true], ['n' => 'reason_name', 't' => 'text', 'r' => true], ['n' => 'module', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Vendor Comparison', 'VTI', 'GRN', 'Payment', 'All']], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'requires_approval', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['reason_code', 'reason_name']],
        'match_exception' => ['fields' => [['n' => 'exc_code', 't' => 'text', 'r' => true], ['n' => 'exc_name', 't' => 'text', 'r' => true], ['n' => 'tolerance_pct', 't' => 'number', 'min' => 0, 'max' => 100], ['n' => 'blocks_payment', 't' => 'select', 'r' => true, 'opts' => ['Yes — Hard Block', 'Yes — Soft Block (Warning)', 'No']], ['n' => 'resolver_role', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['exc_code', 'exc_name']],
        'advance_payment_rules' => ['fields' => [['n' => 'vendor_type', 't' => 'text', 'r' => true], ['n' => 'procurement_cat', 't' => 'text'], ['n' => 'max_advance_pct', 't' => 'number', 'r' => true, 'min' => 0, 'max' => 100], ['n' => 'approval_above', 't' => 'number'], ['n' => 'approver_role', 't' => 'text'], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['vendor_type', 'procurement_cat']],
        'exchange_rate_log' => ['fields' => [['n' => 'currency_code', 't' => 'text', 'r' => true], ['n' => 'currency_name', 't' => 'text'], ['n' => 'rate_vs_inr', 't' => 'number', 'r' => true], ['n' => 'effective_date', 't' => 'date', 'r' => true], ['n' => 'rate_source', 't' => 'select', 'r' => true, 'opts' => ['RBI Reference Rate', 'Bank Rate', 'Agreed Rate', 'Custom']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Superseded']]], 'uFields' => ['currency_code', 'effective_date']],
        'goods_service_flag' => ['fields' => [['n' => 'flag_code', 't' => 'text', 'r' => true], ['n' => 'flag_name', 't' => 'text', 'r' => true], ['n' => 'grn_screen', 't' => 'select', 'r' => true, 'opts' => ['Physical Receipt — Qty + Batch + Warehouse', 'Service Completion — Date + Proof Doc', 'Mixed — Partial Goods + Service']], ['n' => 'evidence_type', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['flag_code', 'flag_name']],
        'vendor_directory' => ['fields' => [['n' => 'vendor_company_name', 't' => 'textarea', 'r' => true, 'maxLen' => 512], ['n' => 'contact_person', 't' => 'text', 'r' => true], ['n' => 'mobile_number', 't' => 'text', 'r' => true], ['n' => 'email_id', 't' => 'email', 'r' => true], ['n' => 'segment_id', 't' => 'select', 'r' => true, 'ref' => 'segments'], ['n' => 'address', 't' => 'text', 'r' => true], ['n' => 'country', 't' => 'select', 'r' => true, 'opts' => ['India', 'USA', 'UAE', 'UK', 'Germany', 'Australia', 'Singapore', 'Other']], ['n' => 'state', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'mapping_mode', 't' => 'select', 'r' => true, 'opts' => ['Map from Vendor Master', 'Map New Vendor']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['vendor_company_name', 'mobile_number', 'email_id']],
        'warehouse_master' => ['fields' => [['n' => 'wh_id', 't' => 'text', 'r' => true], ['n' => 'wh_name', 't' => 'text', 'r' => true], ['n' => 'wh_type', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'state', 't' => 'text'], ['n' => 'pincode', 't' => 'text'], ['n' => 'contact_person', 't' => 'text'], ['n' => 'contact_phone', 't' => 'text'], ['n' => 'area_sqft', 't' => 'number'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['wh_id', 'wh_name']],
        'zone_master' => ['fields' => [['n' => 'zone_id', 't' => 'text', 'r' => true], ['n' => 'zone_name', 't' => 'text', 'r' => true], ['n' => 'zone_type', 't' => 'select', 'r' => true, 'opts' => ['Storage Zone', 'Cold Chain Zone', 'Hazardous Zone', 'Dispatch Zone', 'Holding Zone', 'QC Hold Zone', 'Overflow Zone', 'Blocked Zone', 'Regulated Zone']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'purpose', 't' => 'textarea'], ['n' => 'cold_chain', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'hazardous', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['zone_id', 'zone_name']],
        'rack_type_master' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'suitable_for', 't' => 'select', 'opts' => ['General Inventory', 'Cold Chain', 'Hazardous', 'Heavy Duty', 'Retail', 'Pharma', 'All Types']], ['n' => 'max_load_per_shelf', 't' => 'number'], ['n' => 'typical_shelves', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['type_code', 'type_name']],
        'temp_class_master' => ['fields' => [['n' => 'class_code', 't' => 'text', 'r' => true], ['n' => 'class_name', 't' => 'text', 'r' => true], ['n' => 'temp_range_min', 't' => 'number'], ['n' => 'temp_range_max', 't' => 'number'], ['n' => 'description', 't' => 'textarea'], ['n' => 'requires_monitoring', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'alert_threshold', 't' => 'number'], ['n' => 'suitable_products', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['class_code', 'class_name']],
        'racks' => ['fields' => [['n' => 'whType', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'zone', 't' => 'select', 'r' => true, 'ref' => 'zone_master'], ['n' => 'rackName', 't' => 'text', 'r' => true], ['n' => 'rackType', 't' => 'select', 'r' => true, 'ref' => 'rack_type_master'], ['n' => 'rackStatus', 't' => 'select', 'r' => true, 'opts' => ['Partially Filled', 'Full', 'Blocked', 'Reserved', 'Under Maintenance', 'Empty']], ['n' => 'tempClass', 't' => 'select', 'ref' => 'temp_class_master'], ['n' => 'shelves', 't' => 'number'], ['n' => 'maxWeight', 't' => 'number'], ['n' => 'maxVolume', 't' => 'number']], 'uFields' => ['rackName']],
        'shelf_master' => ['fields' => [['n' => 'rack_ref', 't' => 'select', 'r' => true, 'ref' => 'racks'], ['n' => 'shelf_name', 't' => 'text', 'r' => true], ['n' => 'level_no', 't' => 'number', 'r' => true], ['n' => 'shelf_type', 't' => 'select', 'r' => true, 'opts' => ['Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf']], ['n' => 'max_weight', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Available', 'Partially Used', 'Full', 'Blocked', 'Under Maintenance']]], 'uFields' => ['shelf_name']],
        'digital_twin' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'freezers' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'capacity', 't' => 'number', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'warehouse']],
        'leave_type' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true, 'pattern' => '#^(?=.*[A-Za-z])[A-Za-z0-9 .,\-&()\'/]+$#', 'patternMessage' => 'Leave Type Name cannot contain special characters (only letters, numbers, spaces and . , - & ( ) / \' are allowed).'], ['n' => 'description', 't' => 'textarea'], ['n' => 'type', 't' => 'select', 'r' => true, 'opts' => ['Regular', 'Incident Based Leave', 'Unpaid Leave', 'Compoff']], ['n' => 'short_code', 't' => 'text', 'r' => true, 'normalize' => 'upper', 'pattern' => '/^[A-Za-z0-9]+$/', 'patternMessage' => 'Only letters and numbers are allowed (no spaces or special characters).'], ['n' => 'is_sick_medical', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'paid_unpaid', 't' => 'select', 'opts' => ['Paid', 'Unpaid']], ['n' => 'gender_restriction', 't' => 'select', 'opts' => ['None', 'Male', 'Female']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['name', 'short_code'], 'tenantScoped' => true],
        'leave_plan' => ['fields' => [['n' => 'plan_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'from_month_type', 't' => 'select', 'r' => true, 'opts' => ['Calendar', 'If Joining']], ['n' => 'from_month', 't' => 'select', 'opts' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']], ['n' => 'calendar_year', 't' => 'text'], ['n' => 'policy_explanation_mode', 't' => 'select', 'opts' => ['System', 'Custom']], ['n' => 'policy_doc_path', 't' => 'text'], ['n' => 'is_default', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['plan_name'], 'tenantScoped' => true],
        'trigger_point' => ['fields' => [['n' => 'module_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['module_name'], 'tenantScoped' => true],
        'overtime_rates' => ['fields' => [['n' => 'rate_name', 't' => 'text', 'r' => true], ['n' => 'multiplier', 't' => 'number', 'r' => true, 'min' => 0, 'max' => 100], ['n' => 'description', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uEach' => ['rate_name']],

        'pt_slabs' => ['fields' => [['n' => 'state', 't' => 'text', 'r' => true], ['n' => 'gender', 't' => 'select', 'r' => true, 'opts' => ['any', 'male', 'female']], ['n' => 'min_gross', 't' => 'number', 'r' => true, 'min' => 0], ['n' => 'max_gross', 't' => 'number', 'min' => 0], ['n' => 'amount', 't' => 'number', 'r' => true, 'min' => 0], ['n' => 'feb_amount', 't' => 'number', 'min' => 0], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['state', 'gender', 'min_gross']],
        'supplier_category' => [
            'fields' => [
                ['n' => 'name', 't' => 'text', 'r' => true, 'maxLen' => 100],
                ['n' => 'supplier_service', 't' => 'select', 'r' => true, 'opts' => ['self', 'other']],
                ['n' => 'supplier_type', 't' => 'text', 'maxLen' => 100],

                ['n' => 'status', 't' => 'number', 'r' => true, 'min' => 0, 'max' => 1],
            ],
            'uEach' => ['name'],
            'tenantScoped' => true
        ],
        'service_categories' => [
            'fields' => [
                ['n' => 'service_type', 't' => 'select', 'r' => true, 'opts' => ['soft_digital', 'other_operational']],
                ['n' => 'classification', 't' => 'select', 'opts' => ['professional', 'utility', 'facility', 'maintenance', 'outsourcing']],
                ['n' => 'name', 't' => 'text', 'r' => true, 'maxLen' => 150],
                ['n' => 'status', 't' => 'select', 'opts' => ['Active', 'Inactive']],
            ],
            'uFields' => ['name', 'service_type', 'classification'],
            'tenantScoped' => true,
        ],
    ];

    private const OWNERSHIP_WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type,branch_id',
        'creator.branch:id,name',
    ];

    public function counts(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

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
                $inventoryModel = self::INVENTORY_COUNT_MODELS[$slug] ?? null;
                $q = ($inventoryModel ?? $modelClass)::query();
                if ($inventoryModel === null) {
                    $this->applyScope($q, $user, $branchFilter);
                }
                $stat = $q->selectRaw(
                    "COUNT(*) AS total, "
                    . "SUM(CASE WHEN LOWER(TRIM(CAST(status AS TEXT))) IN ('active','1','true','yes','enabled') THEN 1 ELSE 0 END) AS active"
                )->first();
                $total  = (int) ($stat->total ?? 0);
                $active = (int) ($stat->active ?? 0);
                $out[$slug] = [
                    'active'   => $active,
                    'inactive' => max(0, $total - $active),
                    'total'    => $total,
                ];
            } catch (\Throwable $e) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
            }
        }

        foreach (self::INVENTORY_COUNT_MODELS as $slug => $modelClass) {
            if (isset($out[$slug])) continue;
            $permSlug = self::INVENTORY_COUNT_PERM_ALIAS[$slug] ?? $slug;
            if ($allowedSlugs !== null && !isset($allowedSlugs[$permSlug])) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
                continue;
            }
            try {
                $total  = (int) $modelClass::query()->count();
                $active = (int) $modelClass::query()->where('status', 1)->count();
                $out[$slug] = ['active' => $active, 'inactive' => max(0, $total - $active), 'total' => $total];
            } catch (\Throwable $e) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
            }
        }

        $allowedClm = null;
        if (!$user->isSuperAdmin()) {
            $allowedClm = array_flip(\DB::table('permissions')
                ->join('modules', 'permissions.module_id', '=', 'modules.id')
                ->where('permissions.user_id', $user->id)
                ->where('permissions.can_view', true)
                ->whereIn('modules.slug', array_keys(self::CLM_COUNT_MODELS))
                ->pluck('modules.slug')
                ->all());
        }
        foreach (self::CLM_COUNT_MODELS as $slug => $modelClass) {
            if ($allowedClm !== null && !isset($allowedClm[$slug])) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
                continue;
            }
            try {
                $q = $modelClass::query();
                $this->applyScope($q, $user, $branchFilter);
                $stat = $q->selectRaw(
                    "COUNT(*) AS total, "
                        . "SUM(CASE WHEN LOWER(TRIM(CAST(status AS TEXT))) IN ('active','1','true','yes','enabled') THEN 1 ELSE 0 END) AS active"
                )->first();
                $total  = (int) ($stat->total ?? 0);
                $active = (int) ($stat->active ?? 0);
                $out[$slug] = ['active' => $active, 'inactive' => max(0, $total - $active), 'total' => $total];
            } catch (\Throwable $e) {
                $out[$slug] = ['active' => 0, 'inactive' => 0, 'total' => 0];
            }
        }

        return response()->json($out);
    }

    public function bulk(Request $request)
    {
        $keys = collect(explode(',', (string) $request->query('keys')))
            ->map(fn($k) => trim($k))
            ->filter()
            ->unique()
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

    /**
     * A search term that reads as a date ("23-Nov-2026", "23/11/2026", "2026-11-23")
     * or a month ("Nov-2026", "11/2026") becomes a created_at range for that day or
     * month in the viewer's time zone, in the app's storage time zone.
     */
    private function searchDateRange(string $term, string $tz): ?array
    {
        $term = preg_replace('/\s+/', ' ', trim($term));
        $zone = in_array($tz, \DateTimeZone::listIdentifiers(), true) ? $tz : config('app.timezone');
        $store = config('app.timezone');
        $try = function (array $formats) use ($term, $zone) {
            foreach ($formats as $fmt) {
                $d = \DateTime::createFromFormat('!' . $fmt, $term, new \DateTimeZone($zone));
                $err = \DateTime::getLastErrors();
                if ($d && (!$err || ($err['warning_count'] === 0 && $err['error_count'] === 0))) return $d;
            }
            return null;
        };
        $day = $try(['d-M-Y', 'j-M-Y', 'd M Y', 'j M Y', 'd-M-y', 'd/m/Y', 'j/n/Y', 'd-m-Y', 'j-n-Y', 'd.m.Y', 'Y-m-d', 'd-F-Y', 'd F Y']);
        if ($day) {
            $from = \Carbon\Carbon::instance($day)->setTimezone($store);
            return [$from, $from->copy()->addDay()];
        }
        $month = $try(['M-Y', 'M Y', 'F Y', 'F-Y', 'm/Y', 'n/Y', 'm-Y', 'Y-m']);
        if ($month) {
            $start = \Carbon\Carbon::instance($month)->startOfMonth();
            return [$start->copy()->setTimezone($store), $start->copy()->addMonth()->setTimezone($store)];
        }
        return null;
    }

    private function paginateMaster($q, Request $request, array $cols)
    {
        $requested = (int) $request->query('per_page', 24);
        $perPage = ($requested > 0 && $requested <= 200) ? $requested : 24;
        return $q->paginate($perPage, $cols);
    }

    public function list(Request $request, string $slug)
    {
        $this->authorizeMaster($request, $slug, 'can_view');
        $modelClass = $this->resolveModel($slug);

        $requestedFields = collect(explode(',', (string) $request->query('fields')))
            ->map(fn($f) => trim($f))
            ->filter()
            ->values();
        $slim = $requestedFields->isNotEmpty();

        $q = $modelClass::query()->orderByDesc('id');
        if (!$slim) {
            $q->with(self::OWNERSHIP_WITH);
        }
        if (in_array($slug, ['departments', 'designations'], true)) {
            $q->withCount('employees');
        }
        if ($slug === 'state_codes') {
            $q->with('state:id,name,country_id');
        }
        $this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);

        $search = trim((string) ($request->query('search') ?? $request->query('q') ?? ''));
        if ($search !== '') {
            $schema = self::SCHEMAS[$slug] ?? ['fields' => []];
            $model = new $modelClass;
            $columns = \Illuminate\Support\Facades\Schema::getColumnListing($model->getTable());
            $textCols = collect($schema['fields'] ?? [])
                ->filter(fn($f) => in_array($f['t'] ?? '', ['text', 'email', 'textarea', 'select'], true)
                    && empty($f['ref'])
                    && !str_ends_with($f['n'], '_id')
                    && in_array($f['n'], $columns, true))
                ->pluck('n')
                ->all();
            $refCols = collect($schema['fields'] ?? [])
                ->filter(fn($f) => !empty($f['ref']) && isset(self::MODELS[$f['ref']]) && in_array($f['n'], $columns, true))
                ->mapWithKeys(function ($f) {
                    $refModel = self::MODELS[$f['ref']];
                    $refTableCols = \Illuminate\Support\Facades\Schema::getColumnListing((new $refModel)->getTable());
                    $label = in_array('name', $refTableCols, true) ? 'name'
                        : collect($refTableCols)->first(fn($c) => str_ends_with($c, '_name') || in_array($c, ['title', 'label'], true));
                    return $label ? [$f['n'] => [$refModel, $label]] : [];
                })
                ->all();
            $date = $this->searchDateRange($search, (string) $request->query('tz', ''));
            $like = '%' . addcslashes(mb_strtolower($search), '%_\\') . '%';
            $q->where(function ($w) use ($textCols, $refCols, $like, $date, $columns, $model) {
                $grammar = $w->getGrammar();
                foreach ($textCols as $col) {
                    $w->orWhereRaw('LOWER(' . $grammar->wrap($col) . ') LIKE ?', [$like]);
                }
                foreach ($refCols as $col => [$refModel, $label]) {
                    $ids = $refModel::query()->whereRaw('LOWER(' . $grammar->wrap($label) . ') LIKE ?', [$like])->limit(500)->pluck('id')->map(fn($id) => (string) $id)->all();
                    if ($ids) $w->orWhereIn($col, $ids);
                }
                if (method_exists($model, 'creator')) {
                    $w->orWhereHas('creator', fn($u) => $u->whereRaw('LOWER(name) LIKE ?', [$like]));
                }
                if ($date && in_array('created_at', $columns, true)) {
                    $w->orWhere(fn($m) => $m->where('created_at', '>=', $date[0])->where('created_at', '<', $date[1]));
                }
            });
        }

        if ($slug === 'service_categories') {
            if ($t = $request->query('service_type'))   $q->where('service_type', $t);
            if ($c = $request->query('classification')) $q->where('classification', $c);
            if ($s = $request->query('status'))         $q->whereRaw('LOWER(status) = ?', [strtolower($s)]);
        }

        if ($countryId = $request->integer('country_id')) {
            $schema = self::SCHEMAS[$slug] ?? ['fields' => []];
            $hasCountryId = collect($schema['fields'] ?? [])
                ->contains(fn($f) => ($f['n'] ?? null) === 'country_id');
            if ($hasCountryId) {
                $q->where('country_id', $countryId);
            }
        }

        if ($slim) {
            /* Slim (fields=…) is the dropdown projection — bulk() and the form
               country/state/department lookups all use it. A disabled master row
               must never be offered in a picker, so active-only here fixes every
               slim consumer at once. The paginated branch below (the master
               manager) is untouched and still shows Inactive. status_tab=inactive
               stays an explicit opt-out. */
            if (\Illuminate\Support\Facades\Schema::hasColumn((new $modelClass)->getTable(), 'status')
                && strtolower((string) $request->query('status_tab', '')) !== 'inactive') {
                $q->where(fn($w) => $w->whereNull('status')
                    ->orWhereRaw('LOWER(TRIM(CAST(status AS CHAR(32)))) <> ?', ['inactive']));
            }
            $columns = collect(\Illuminate\Support\Facades\Schema::getColumnListing((new $modelClass)->getTable()));
            $safe = $requestedFields->intersect($columns)->values();
            if (!$safe->contains('id') && $columns->contains('id')) $safe->push('id');
            $select = $safe->all();

            if ($requestedFields->contains('name') && !$columns->contains('name')) {
                $label = $columns->first(fn($c) => str_ends_with($c, '_name'))
                    ?? $columns->first(fn($c) => in_array($c, ['title', 'label'], true));
                if ($label) {
                    $select[] = \Illuminate\Support\Facades\DB::raw(
                        '"' . $label . '" as name'
                    );
                }
            }

            $cols = empty($select) ? ['*'] : $select;
            if ($request->has('per_page') || $request->has('page')) {
                return response()->json($this->paginateMaster($q, $request, $cols));
            }
            return response()->json($q->get($cols));
        }

        if ($request->has('per_page') || $request->has('page')) {
            $statusCounts = null;
            if (\Illuminate\Support\Facades\Schema::hasColumn((new $modelClass)->getTable(), 'status')) {
                $byStatus = (clone $q)->reorder()->toBase()
                    ->select(\Illuminate\Support\Facades\DB::raw('LOWER(CAST(status AS TEXT)) as s'), \Illuminate\Support\Facades\DB::raw('COUNT(*) as c'))
                    ->groupBy(\Illuminate\Support\Facades\DB::raw('LOWER(CAST(status AS TEXT))'))
                    ->pluck('c', 's');
                $inactive = (int) ($byStatus['inactive'] ?? 0);
                $total = (int) $byStatus->sum();
                $statusCounts = ['all' => $total, 'active' => $total - $inactive, 'inactive' => $inactive];
                $tab = strtolower((string) $request->query('status_tab', ''));
                if ($tab === 'inactive') {
                    $q->whereRaw('LOWER(TRIM(CAST(status AS CHAR(32)))) = ?', ['inactive']);
                } elseif ($tab === 'active') {
                    $q->where(fn($w) => $w->whereNull('status')->orWhereRaw('LOWER(TRIM(CAST(status AS CHAR(32)))) <> ?', ['inactive']));
                }
            }
            $page = $this->paginateMaster($q, $request, ['*']);
            $page->getCollection()->transform(fn($r) => $this->withOwnership($r));
            return response()->json($page->toArray() + ['status_counts' => $statusCounts]);
        }

        return response()->json($q->get()->map(fn($r) => $this->withOwnership($r)));
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

        $lockedFixed = [
            'address_types' => 'Address Types is a fixed master. Only Registered Office, Warehouse, and Branch are allowed — no new types can be added.',
            'designations' => 'Designations is a fixed master. The six seeded titles (Director / CEO, Head of Department, Team Leader, Executive, Employee, Intern / Trainee) cover the whole hierarchy — no new designations can be added. Existing designations can still be edited.',
        ];
        if (isset($lockedFixed[$slug])) {
            return response()->json(['message' => $lockedFixed[$slug]], 403);
        }

        $modelClass = $this->resolveModel($slug);
        $data = $this->validatePayload($request, $slug, null);
        if ($slug === 'service_categories') $data = $this->normaliseServiceCategory($data);
        $user = $request->user();
        $data['created_by'] = optional($user)->id;

        [$clientId, $branchId] = $this->resolveOwnership($request, $user);
        $data['client_id'] = $clientId;
        $data['branch_id'] = $branchId;

        $data = $this->absorbUploads($request, $modelClass, $slug, $data);

        $row = $modelClass::create($data);

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

        $denial = $this->hierarchicalDenial($request->user(), $row, 'edit');
        if ($denial) return response()->json(['message' => $denial], 403);

        if (!empty($row->is_system)) {
            return response()->json([
                'message' => 'This record is system-managed and cannot be edited. Create a custom entry if you need different values.',
            ], 403);
        }

        if ($row instanceof \App\Models\Masters\ServiceCategory
            && array_keys($request->except(['_method'])) === ['status']) {
            $status = ucfirst(strtolower((string) $request->input('status')));
            if (!in_array($status, ['Active', 'Inactive'], true)) {
                return response()->json(['message' => 'The status must be Active or Inactive.', 'errors' => ['status' => ['The status must be Active or Inactive.']]], 422);
            }
            $row->update(['status' => $status]);
            MasterBundleCache::bump();
            $row->load(self::OWNERSHIP_WITH);
            return response()->json($this->withOwnership($row));
        }

        if ($row instanceof \App\Models\Masters\ServiceCategory && ($used = $row->usageCount()) > 0) {
            return response()->json([
                'message' => 'This service category is used by ' . $used . ' service' . ($used === 1 ? '' : 's')
                    . ' and cannot be edited. Create a new category instead.',
            ], 409);
        }

        $data = $this->validatePayload($request, $slug, $id);
        if ($slug === 'service_categories') $data = $this->normaliseServiceCategory($data, $row);

        $data = $this->absorbUploads($request, $modelClass, $slug, $data, $row);

        $row->update($data);

        MasterBundleCache::bump();

        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row));
    }

    private const AUTO_CODES = [
        'departments'      => ['col' => 'code', 'prefix' => 'DEPT-', 'pad' => 3],
        'expense_category' => ['col' => 'code', 'prefix' => 'EXC-',  'pad' => 2],
    ];

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

        $denial = $this->hierarchicalDenial($request->user(), $row, 'delete');
        if ($denial) return response()->json(['message' => $denial], 403);

        if ($slug === 'asset_categories' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This category is system-managed and cannot be deleted.',
            ], 403);
        }
        if ($slug === 'address_types' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This address type is system-managed and cannot be deleted.',
            ], 403);
        }
        if ($slug === 'customer_types' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This customer consignee type is system-managed and cannot be deleted.',
            ], 403);
        }
        if ($slug === 'risk_levels' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This risk level is system-managed and cannot be deleted.',
            ], 403);
        }
        if ($slug === 'customer_classifications' && !empty($row->is_system)) {
            return response()->json([
                'message' => 'This customer classification is system-managed and cannot be deleted.',
            ], 403);
        }

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

        if ($slug === 'assets') {
            $holders = \App\Models\Employee::query()
                ->withTrashed()
                ->where(function ($w) {
                    $w->whereNull('status')
                        ->orWhereNotIn('status', ['Resigned', 'Terminated']);
                })
                ->when($row->client_id, fn($x) => $x->where('client_id', $row->client_id))
                ->get(['id', 'display_name', 'emp_code', 'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids'])
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
                    ->map(fn($e) => $e->display_name ?: $e->emp_code ?: ('Employee #' . $e->id))
                    ->implode(', ');
                $more = $holders->count() - min(3, $holders->count());
                return response()->json([
                    'message' => 'This asset is currently assigned to ' . $names
                        . ($more > 0 ? " and {$more} other" . ($more === 1 ? '' : 's') : '')
                        . ' and cannot be deleted. Unassign it from the employee record first.',
                ], 409);
            }
        }

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

        if ($row instanceof \App\Models\Masters\ServiceCategory) {
            return response()->json([
                'message' => 'Service categories cannot be deleted. Set the status to Inactive instead.',
            ], 405);
        }

        // Generic "in use" guard — a master value referenced anywhere cannot be
        // deleted. Sources: declared DB foreign keys, config `ref` dropdown
        // fields, and the explicit USAGE_MAP for plain (un-constrained) columns.
        $usage = $this->masterUsage($slug, $row);
        if ($usage) {
            $total = array_sum(array_column($usage, 1));
            $where = collect($usage)
                ->sortByDesc(1)
                ->take(4)
                ->map(fn ($h) => $h[1] . ' in ' . $this->humanTable($h[0]))
                ->implode(', ');
            return response()->json([
                'message' => 'This ' . $this->masterLabel($slug) . ' is in use by '
                    . $total . ' record' . ($total === 1 ? '' : 's') . ' (' . $where . ')'
                    . ' and cannot be deleted. Reassign or remove those records first, or set it to Inactive.',
            ], 409);
        }

        $row->delete();

        MasterBundleCache::bump();

        return response()->json(['message' => 'Deleted']);
    }

    /*
    | Explicit usage map for masters whose values are referenced by plain columns
    | (no DB foreign key and no config `ref` field, so they can't be discovered
    | automatically). slug => [[referencing_table, column], ...]. Built from a
    | code audit; a column that does not exist is skipped safely.
    */
    private const USAGE_MAP = [
        // Masters referenced by plain id columns (no DB FK, no config ref).
        // `assets` and `expense_category` are intentionally omitted — their
        // specific guards above already cover them (assets incl. the JSON
        // `other_master_asset_ids` column, which a scalar check can't match).
        'bank_accounts'      => [['quotations', 'bank_account_id'], ['proforma_invoices', 'bank_account_id']],
        'hsn_codes'          => [['products', 'hsn_id'], ['p2p_services', 'hsn_id']],
        'gst_percentage'     => [['products', 'gst_id'], ['p2p_services', 'gst_id'], ['p2p_service_suppliers', 'gst_id']],
        'uom'                => [['products', 'uom_id'], ['p2p_services', 'uom_id']],
        'packaging_material' => [['products', 'packaging_material_id'], ['p2p_services', 'packaging_id']],
        'conditions'         => [['products', 'condition_id'], ['p2p_services', 'condition_id']],
        'incoterms'          => [['shipment_orders', 'inco_term_id']],
        'haz_class'          => [['products', 'haz_class_id'], ['p2p_services', 'haz_class_id']],
        'trigger_point'      => [['hr_document_templates', 'trigger_point_id']],
    ];

    /*
    | Masters referenced by their VALUE (name/code string) instead of their id —
    | e.g. the Sales customer & consignee forms store the picked master's name in
    | a plain string column. slug => [[referencing_table, column, master_field], …]
    | where master_field is the column on the master row whose value is stored.
    | A missing table/column is skipped safely.
    */
    private const VALUE_USAGE_MAP = [
        'customer_classifications' => [['customers', 'classification', 'name'], ['consignees', 'classification', 'name']],
        'customer_types'           => [['customers', 'type', 'name'], ['consignees', 'type', 'name']],
        'risk_levels'              => [['customers', 'risk_level', 'name'], ['consignees', 'risk_level', 'name']],
    ];

    /**
     * Every place a master row is referenced, with a non-zero count.
     *
     * Three sources, merged and de-duplicated: declared DB foreign keys,
     * config `ref` dropdown fields, and the explicit USAGE_MAP. Counts across
     * all tenants on purpose — a value used anywhere must not be deletable.
     *
     * @return array<int, array{0:string,1:int}>  [[table, count], ...]
     */
    private function masterUsage(string $slug, $row): array
    {
        $table = $row->getTable();
        $id    = $row->getKey();
        $pk    = $row->getKeyName();

        $sources = array_merge(
            $this->incomingForeignKeys($table),
            $this->configReverseRefs($slug),
            self::USAGE_MAP[$slug] ?? []
        );

        $seen = [];
        $hits = [];
        foreach ($sources as [$srcTable, $srcCol]) {
            $key = $srcTable . '.' . $srcCol;
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            if ($srcTable === $table && $srcCol === $pk) continue;              // never the PK itself
            if (!Schema::hasTable($srcTable) || !Schema::hasColumn($srcTable, $srcCol)) continue;
            $n = DB::table($srcTable)->where($srcCol, $id)->count();
            if ($n > 0) $hits[] = [$srcTable, $n];
        }

        // Value references — the master's name/code stored as a plain string
        // (e.g. the Sales customer form keeps the classification/type by name).
        foreach (self::VALUE_USAGE_MAP[$slug] ?? [] as [$srcTable, $srcCol, $field]) {
            $value = $row->{$field} ?? null;
            if ($value === null || $value === '') continue;
            if (!Schema::hasTable($srcTable) || !Schema::hasColumn($srcTable, $srcCol)) continue;
            $n = DB::table($srcTable)->whereRaw('lower(trim(' . $srcCol . ')) = ?', [mb_strtolower(trim((string) $value))])->count();
            if ($n > 0) $hits[] = [$srcTable, $n];
        }

        return $hits;
    }

    /** Incoming DB foreign keys to $table: [[srcTable, srcCol], ...], cached per request. */
    private function incomingForeignKeys(string $table): array
    {
        static $cache = [];
        if (!array_key_exists($table, $cache)) {
            $rows = DB::select(
                "SELECT tc.table_name AS src_table, kcu.column_name AS src_col
                   FROM information_schema.table_constraints tc
                   JOIN information_schema.key_column_usage kcu
                     ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                   JOIN information_schema.constraint_column_usage ccu
                     ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                  WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = ?",
                [$table]
            );
            $cache[$table] = array_map(fn ($r) => [$r->src_table, $r->src_col], $rows);
        }

        return $cache[$table];
    }

    /** Config `ref` dropdown fields that point at $slug: [[srcTable, srcCol], ...]. */
    private function configReverseRefs(string $slug): array
    {
        $out = [];
        foreach (self::SCHEMAS as $s => $cfg) {
            $model = self::MODELS[$s] ?? null;
            if (!$model) continue;
            foreach (($cfg['fields'] ?? []) as $f) {
                if (($f['ref'] ?? null) === $slug) {
                    $out[] = [(new $model)->getTable(), $f['n']];
                }
            }
        }

        return $out;
    }

    /** "master_vendor_directory" => "Vendor Directory", "leave_requests" => "Leave Requests". */
    private function humanTable(string $table): string
    {
        return ucwords(str_replace('_', ' ', preg_replace('/^master_/', '', $table)));
    }

    /** "payment_terms" => "Payment Terms". */
    private function masterLabel(string $slug): string
    {
        return ucwords(str_replace('_', ' ', $slug));
    }

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

    private function hierarchicalDenial(?User $user, $row, string $action): ?string
    {
        return MasterVisibility::hierarchicalDenial($user, $row, $action);
    }

    private function withOwnership($row): array
    {
        $arr = $row->toArray();
        $arr['client_name']       = $row->client?->org_name;
        $arr['branch_name']       = $row->branch?->name;
        $arr['creator_name']      = $row->creator?->name;
        $arr['creator_user_type'] = $row->creator?->user_type;

        foreach (array_keys($arr) as $k) {
            if (!is_string($k) || !str_ends_with($k, '_path')) continue;
            $v = $arr[$k];
            if (!is_string($v) || trim($v) === '') continue;
            $arr[$k . '_url'] = file_url($v);
        }

        if ($row instanceof \App\Models\Masters\GstPercentage) {
            $arr['in_use'] = \App\Models\Product::where('gst_id', $row->id)->exists();
        }

        if ($row instanceof \App\Models\Masters\ServiceCategory) {
            $arr['used_count'] = $row->usageCount();
            $arr['in_use']     = $arr['used_count'] > 0;
        }

        return $arr;
    }

    private function normaliseServiceCategory(array $data, $row = null): array
    {
        $type  = $data['service_type'] ?? $row?->service_type;
        $class = array_key_exists('classification', $data) ? $data['classification'] : $row?->classification;

        if ($type === 'soft_digital') {
            $data['classification'] = null;
        } elseif (!in_array($class, \App\Models\Masters\ServiceCategory::OTHER_CLASSIFICATIONS, true)) {
            throw ValidationException::withMessages([
                'classification' => ['Choose the Other Operational type: Professional, Utility, Facility, Maintenance or Outsourcing.'],
            ]);
        }
        if (($data['status'] ?? null) === null) {
            if ($row) unset($data['status']);
            else $data['status'] = 'Active';
        }
        return $data;
    }

    private function absorbUploads(Request $request, string $modelClass, string $slug, array $data, $row = null): array
    {
        $files = $request->allFiles();
        if (empty($files)) return $data;

        $fillable = (new $modelClass())->getFillable();

        foreach ($files as $key => $file) {
            if (!is_string($key)) continue;
            $targetCol = str_ends_with($key, '_file_path')
                ? $key
                : (str_ends_with($key, '_file') ? $key . '_path' : $key);

            if (!in_array($targetCol, $fillable, true)) continue;

            $uploaded = is_array($file) ? ($file[0] ?? null) : $file;
            if (!$uploaded) continue;

            if ($row && !empty($row->{$targetCol})) {
                try {
                    \Illuminate\Support\Facades\Storage::disk('public')->delete($row->{$targetCol});
                } catch (\Throwable $e) {
                }
            }

            $path = $uploaded->store("master/{$slug}", 'public');
            $data[$targetCol] = $path;

            unset($data[$key]);
        }

        return $data;
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        MasterVisibility::applyReadScope($q, $user, $branchFilter);
    }

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

        if ($user && in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return [$user->client_id, $user->branch_id];
        }

        return [null, null];
    }

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
        $uEach = $schema['uEach'] ?? [];
        $dupContext = $schema['dupContext'] ?? [];
        $modelClass = $this->resolveModel($slug);
        $table = (new $modelClass)->getTable();
        $isComposite = count($uFields) > 1;

        $fieldTypeMap = [];
        foreach ($fields as $f) {
            $fieldTypeMap[$f['n']] = ['t' => $f['t'] ?? 'text', 'ref' => $f['ref'] ?? null];
        }
        $isTextField = function (string $col) use ($fieldTypeMap): bool {
            $info = $fieldTypeMap[$col] ?? null;
            if (!$info) return false;
            if (!empty($info['ref'])) return false;
            return in_array($info['t'], ['text', 'textarea', 'email'], true);
        };

        $singleTextUFields = [];
        if (!$isComposite && !empty($uFields)) {
            foreach ($uFields as $col) {
                if ($isTextField($col)) $singleTextUFields[] = $col;
            }
        }

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
                if (isset($f['min'])) $r[] = 'min:' . $f['min'];
                if (isset($f['max'])) $r[] = 'max:' . $f['max'];
            } elseif ($f['t'] === 'email') {
                $r[] = 'email';
                $r[] = 'max:255';
            } elseif ($f['t'] === 'date') {
                $r[] = 'date';
            } elseif ($f['t'] === 'textarea') {
                $r[] = 'string';
                if (isset($f['maxLen'])) {
                    $r[] = 'max:' . $f['maxLen'];
                }
            } elseif (!empty($f['ref'])) {
                $r[] = 'integer';
            } else {
                $r[] = 'string';
                $r[] = 'max:' . ($f['maxLen'] ?? 50);
            }
            if (!empty($f['opts']) && empty($f['ref'])) {
                $r[] = Rule::in($f['opts']);
            }
            if (!empty($f['pattern'])) {
                $r[] = 'regex:' . $f['pattern'];
            }
            if (
                !$isComposite
                && in_array($f['n'], $uFields, true)
                && !in_array($f['n'], $singleTextUFields, true)
            ) {
                $rule = $applyTenantScope(Rule::unique($table, $f['n']));
                if ($id) $rule = $rule->ignore($id);
                $r[] = $rule;
            }
            $rules[$f['n']] = $r;
        }

        $messages = [];
        foreach ($fields as $f) {
            if (!empty($f['pattern']) && !empty($f['patternMessage'])) {
                $messages[$f['n'] . '.regex'] = $f['patternMessage'];
            }
        }

        $validated = $request->validate($rules, $messages);

        $caseInsensitiveCols = array_values(array_unique(array_merge($uEach, $singleTextUFields)));
        foreach ($caseInsensitiveCols as $colName) {
            $value = $validated[$colName] ?? null;
            if ($value === null || $value === '') continue;

            $query = $modelClass::query()
                ->whereRaw('LOWER(' . $colName . ') = LOWER(?)', [(string) $value]);

            if ($id) $query->where('id', '!=', $id);

            $tenantClientId === null
                ? $query->whereNull('client_id')
                : $query->where('client_id', $tenantClientId);
            $tenantBranchId === null
                ? $query->whereNull('branch_id')
                : $query->where('branch_id', $tenantBranchId);

            $clash = $query->first();
            if ($clash) {
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

        if ($isComposite) {
            $query = $modelClass::query();
            foreach ($uFields as $col) {
                $val = $validated[$col] ?? null;
                if ($val === '') $val = null;
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
                $human = fn(string $c) => ucfirst(str_replace('_', ' ', preg_replace('/_id$/', '', $c)));
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

        foreach ($validated as $k => $v) {
            if ($v === '') $validated[$k] = null;
        }
        return $validated;
    }
}

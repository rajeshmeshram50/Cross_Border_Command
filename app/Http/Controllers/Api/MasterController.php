<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class MasterController extends Controller
{
    /**
     * slug -> Eloquent model class map
     */
    private const MODELS = [
        'company' => \App\Models\Masters\Company::class,
        'bank_accounts' => \App\Models\Masters\BankAccounts::class,
        'departments' => \App\Models\Masters\Departments::class,
        'roles' => \App\Models\Masters\Roles::class,
        'designations' => \App\Models\Masters\Designations::class,
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
        'numbering_series' => \App\Models\Masters\NumberingSeries::class,
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
    ];

    /**
     * slug -> ['fields' => [{n,t,r,ref?}, ...], 'uFields' => [...]]
     */
    private const SCHEMAS = [
        'company' => ['fields' => [['n' => 'company_name', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'gstin', 't' => 'text', 'r' => true], ['n' => 'pan', 't' => 'text', 'r' => true], ['n' => 'cin', 't' => 'text'], ['n' => 'iec', 't' => 'text'], ['n' => 'email', 't' => 'email'], ['n' => 'mobile', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'state', 't' => 'text'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['company_name', 'gstin', 'pan']],
        'bank_accounts' => ['fields' => [['n' => 'bank_name', 't' => 'text', 'r' => true], ['n' => 'account_holder', 't' => 'text', 'r' => true], ['n' => 'account_number', 't' => 'text', 'r' => true], ['n' => 'ifsc_code', 't' => 'text', 'r' => true], ['n' => 'branch_name', 't' => 'text'], ['n' => 'city', 't' => 'text'], ['n' => 'swift_code', 't' => 'text', 'r' => true], ['n' => 'ad_code', 't' => 'text', 'r' => true], ['n' => 'is_primary', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['account_number', 'ifsc_code']],
        'departments' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'roles' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'designations' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'countries' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'iso_code', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'states' => ['fields' => [['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'country_id']],
        'state_codes' => ['fields' => [['n' => 'state_id', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'state_code', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['state_id', 'state_code']],
        'address_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'port_of_loading' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['code']],
        'port_of_discharge' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'country_id', 't' => 'select', 'r' => true, 'ref' => 'countries'], ['n' => 'city', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['code']],
        'segments' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'hsn_codes' => ['fields' => [['n' => 'hsn_code', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea', 'r' => true], ['n' => 'gst_rate', 't' => 'select', 'opts' => ['0%', '5%', '12%', '18%', '28%']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['hsn_code']],
        'gst_percentage' => ['fields' => [['n' => 'percentage', 't' => 'number', 'r' => true], ['n' => 'label', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['percentage']],
        'currencies' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'symbol', 't' => 'text', 'r' => true], ['n' => 'exchange_rate', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['code']],
        'uom' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'short_code', 't' => 'text', 'r' => true], ['n' => 'unit_type', 't' => 'select', 'opts' => ['Weight', 'Volume', 'Length', 'Area', 'Count', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['short_code']],
        'packaging_material' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'material_type', 't' => 'select', 'opts' => ['Bag', 'Box', 'Crate', 'Drum', 'Pallet', 'Wrap', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'conditions' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'incoterms' => ['fields' => [['n' => 'code', 't' => 'text', 'r' => true], ['n' => 'full_name', 't' => 'text', 'r' => true], ['n' => 'transport_mode', 't' => 'select', 'opts' => ['Sea/Inland Waterway', 'Any Mode', 'Air', 'Road', 'Rail']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['code']],
        'customer_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'gst_applicable', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'customer_classifications' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'credit_limit', 't' => 'number'], ['n' => 'payment_terms', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'vendor_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'vendor_behaviour' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'applicable_types' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'party_type', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Third Party', 'Carrier', 'Other']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'license_name' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'license_code', 't' => 'text'], ['n' => 'issuing_authority', 't' => 'text'], ['n' => 'validity_months', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['license_code']],
        'risk_levels' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'text'], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'document_type' => ['fields' => [['n' => 'title', 't' => 'text', 'r' => true], ['n' => 'applicable_to', 't' => 'select', 'opts' => ['Customer', 'Vendor', 'Both', 'Internal']], ['n' => 'is_mandatory', 't' => 'select', 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['title']],
        'haz_class' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'haz_code', 't' => 'text'], ['n' => 'packing_group', 't' => 'select', 'opts' => ['I (High Danger)', 'II (Medium Danger)', 'III (Low Danger)', 'N/A']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['haz_code']],
        'compliance_behaviours' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'action_required', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'assets' => ['fields' => [['n' => 'asset_name', 't' => 'text', 'r' => true], ['n' => 'asset_number', 't' => 'text', 'r' => true], ['n' => 'asset_type_id', 't' => 'select', 'r' => true, 'ref' => 'asset_categories'], ['n' => 'assign_date', 't' => 'date'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive', 'Under Repair', 'Disposed']]], 'uFields' => ['asset_number']],
        'asset_categories' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'depreciation_rate', 't' => 'number'], ['n' => 'useful_life_years', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'numbering_series' => ['fields' => [['n' => 'module', 't' => 'text', 'r' => true], ['n' => 'prefix', 't' => 'text', 'r' => true], ['n' => 'fy_format', 't' => 'select', 'opts' => ['YYYY-YY', 'YYYY', 'YY-YY', 'None']], ['n' => 'next_number', 't' => 'number', 'r' => true], ['n' => 'is_locked', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['module']],
        'payment_terms' => ['fields' => [['n' => 'term_code', 't' => 'text', 'r' => true], ['n' => 'term_name', 't' => 'text', 'r' => true], ['n' => 'credit_days', 't' => 'number', 'r' => true], ['n' => 'advance_pct', 't' => 'number'], ['n' => 'payment_type', 't' => 'select', 'r' => true, 'opts' => ['Full Advance', 'Partial Advance', 'Credit', 'Milestone-Based', 'COD']], ['n' => 'milestone_desc', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['term_code']],
        'approval_authority' => ['fields' => [['n' => 'role_name', 't' => 'text', 'r' => true], ['n' => 'module_scope', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Payment', 'VTI', 'GRN', 'All']], ['n' => 'min_value', 't' => 'number'], ['n' => 'max_value', 't' => 'number', 'r' => true], ['n' => 'currency', 't' => 'select', 'opts' => ['INR', 'USD', 'EUR', 'GBP']], ['n' => 'escalate_to', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['role_name', 'module_scope']],
        'procurement_category' => ['fields' => [['n' => 'cat_code', 't' => 'text', 'r' => true], ['n' => 'cat_name', 't' => 'text', 'r' => true], ['n' => 'match_logic', 't' => 'select', 'r' => true, 'opts' => ['3-Way Match (PO+VTI+GRN)', '2-Way Match (PO+VTI)', '4-Way Match (PO+VTI+GRN+QC)']], ['n' => 'grn_required', 't' => 'select', 'r' => true, 'opts' => ['Yes — Physical Receipt', 'Yes — Service Confirmation', 'No']], ['n' => 'gst_applicable', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No', 'Reverse Charge']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['cat_code']],
        'sourcing_type' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'quotation_required', 't' => 'select', 'r' => true, 'opts' => ['Mandatory — Min 3 Quotes', 'Mandatory — Min 1 Quote', 'Optional', 'Not Required']], ['n' => 'approval_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'urgency_flag', 't' => 'select', 'opts' => ['Normal', 'Urgent', 'Emergency']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['type_code']],
        'deviation_reason' => ['fields' => [['n' => 'reason_code', 't' => 'text', 'r' => true], ['n' => 'reason_name', 't' => 'text', 'r' => true], ['n' => 'module', 't' => 'select', 'r' => true, 'opts' => ['Purchase Order', 'Vendor Comparison', 'VTI', 'GRN', 'Payment', 'All']], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'requires_approval', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['reason_code']],
        'match_exception' => ['fields' => [['n' => 'exc_code', 't' => 'text', 'r' => true], ['n' => 'exc_name', 't' => 'text', 'r' => true], ['n' => 'tolerance_pct', 't' => 'number'], ['n' => 'blocks_payment', 't' => 'select', 'r' => true, 'opts' => ['Yes — Hard Block', 'Yes — Soft Block (Warning)', 'No']], ['n' => 'resolver_role', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['exc_code']],
        'advance_payment_rules' => ['fields' => [['n' => 'vendor_type', 't' => 'text', 'r' => true], ['n' => 'procurement_cat', 't' => 'text'], ['n' => 'max_advance_pct', 't' => 'number', 'r' => true], ['n' => 'approval_above', 't' => 'number'], ['n' => 'approver_role', 't' => 'text'], ['n' => 'attachment_required', 't' => 'select', 'r' => true, 'opts' => ['Yes', 'No']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['vendor_type', 'procurement_cat']],
        'exchange_rate_log' => ['fields' => [['n' => 'currency_code', 't' => 'text', 'r' => true], ['n' => 'currency_name', 't' => 'text'], ['n' => 'rate_vs_inr', 't' => 'number', 'r' => true], ['n' => 'effective_date', 't' => 'date', 'r' => true], ['n' => 'rate_source', 't' => 'select', 'r' => true, 'opts' => ['RBI Reference Rate', 'Bank Rate', 'Agreed Rate', 'Custom']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Superseded']]], 'uFields' => ['currency_code', 'effective_date']],
        'goods_service_flag' => ['fields' => [['n' => 'flag_code', 't' => 'text', 'r' => true], ['n' => 'flag_name', 't' => 'text', 'r' => true], ['n' => 'grn_screen', 't' => 'select', 'r' => true, 'opts' => ['Physical Receipt — Qty + Batch + Warehouse', 'Service Completion — Date + Proof Doc', 'Mixed — Partial Goods + Service']], ['n' => 'evidence_type', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['flag_code']],
        'vendor_directory' => ['fields' => [['n' => 'vendor_company_name', 't' => 'text', 'r' => true], ['n' => 'contact_person', 't' => 'text', 'r' => true], ['n' => 'mobile_number', 't' => 'text', 'r' => true], ['n' => 'email_id', 't' => 'email', 'r' => true], ['n' => 'segment_id', 't' => 'select', 'r' => true, 'ref' => 'segments'], ['n' => 'address', 't' => 'text', 'r' => true], ['n' => 'country', 't' => 'select', 'r' => true, 'opts' => ['India', 'USA', 'UAE', 'UK', 'Germany', 'Australia', 'Singapore', 'Other']], ['n' => 'state', 't' => 'select', 'r' => true, 'ref' => 'states'], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'mapping_mode', 't' => 'select', 'r' => true, 'opts' => ['Map from Vendor Master', 'Map New Vendor']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['vendor_company_name', 'mobile_number']],
        'warehouse_master' => ['fields' => [['n' => 'wh_id', 't' => 'text', 'r' => true], ['n' => 'wh_name', 't' => 'text', 'r' => true], ['n' => 'wh_type', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'city', 't' => 'text', 'r' => true], ['n' => 'state', 't' => 'text'], ['n' => 'pincode', 't' => 'text'], ['n' => 'contact_person', 't' => 'text'], ['n' => 'contact_phone', 't' => 'text'], ['n' => 'area_sqft', 't' => 'number'], ['n' => 'address', 't' => 'textarea'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['wh_id']],
        'zone_master' => ['fields' => [['n' => 'zone_id', 't' => 'text', 'r' => true], ['n' => 'zone_name', 't' => 'text', 'r' => true], ['n' => 'zone_type', 't' => 'select', 'r' => true, 'opts' => ['Storage Zone', 'Cold Chain Zone', 'Hazardous Zone', 'Dispatch Zone', 'Holding Zone', 'QC Hold Zone', 'Overflow Zone', 'Blocked Zone', 'Regulated Zone']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'purpose', 't' => 'textarea'], ['n' => 'cold_chain', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'hazardous', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['zone_id']],
        'rack_type_master' => ['fields' => [['n' => 'type_code', 't' => 'text', 'r' => true], ['n' => 'type_name', 't' => 'text', 'r' => true], ['n' => 'description', 't' => 'textarea'], ['n' => 'suitable_for', 't' => 'select', 'opts' => ['General Inventory', 'Cold Chain', 'Hazardous', 'Heavy Duty', 'Retail', 'Pharma', 'All Types']], ['n' => 'max_load_per_shelf', 't' => 'number'], ['n' => 'typical_shelves', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['type_code', 'type_name']],
        'temp_class_master' => ['fields' => [['n' => 'class_code', 't' => 'text', 'r' => true], ['n' => 'class_name', 't' => 'text', 'r' => true], ['n' => 'temp_range_min', 't' => 'number'], ['n' => 'temp_range_max', 't' => 'number'], ['n' => 'description', 't' => 'textarea'], ['n' => 'requires_monitoring', 't' => 'select', 'opts' => ['No', 'Yes']], ['n' => 'alert_threshold', 't' => 'number'], ['n' => 'suitable_products', 't' => 'text'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['class_code', 'class_name']],
        'racks' => ['fields' => [['n' => 'whType', 't' => 'select', 'r' => true, 'opts' => ['Own Warehouse', 'Third Party Warehouse']], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'zone', 't' => 'select', 'r' => true, 'ref' => 'zone_master'], ['n' => 'rackName', 't' => 'text', 'r' => true], ['n' => 'rackType', 't' => 'select', 'r' => true, 'ref' => 'rack_type_master'], ['n' => 'rackStatus', 't' => 'select', 'r' => true, 'opts' => ['Partially Filled', 'Full', 'Blocked', 'Reserved', 'Under Maintenance', 'Empty']], ['n' => 'tempClass', 't' => 'select', 'ref' => 'temp_class_master'], ['n' => 'shelves', 't' => 'number'], ['n' => 'maxWeight', 't' => 'number'], ['n' => 'maxVolume', 't' => 'number']], 'uFields' => ['rackName']],
        'shelf_master' => ['fields' => [['n' => 'rack_ref', 't' => 'select', 'r' => true, 'ref' => 'racks'], ['n' => 'shelf_name', 't' => 'text', 'r' => true], ['n' => 'level_no', 't' => 'number', 'r' => true], ['n' => 'shelf_type', 't' => 'select', 'r' => true, 'opts' => ['Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf']], ['n' => 'max_weight', 't' => 'number'], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Available', 'Partially Used', 'Full', 'Blocked', 'Under Maintenance']]], 'uFields' => ['shelf_name']],
        'digital_twin' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name']],
        'freezers' => ['fields' => [['n' => 'name', 't' => 'text', 'r' => true], ['n' => 'warehouse', 't' => 'select', 'r' => true, 'ref' => 'warehouse_master'], ['n' => 'capacity', 't' => 'number', 'r' => true], ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']]], 'uFields' => ['name', 'warehouse']],
    ];

    /**
     * Relationships to eager-load on every list/show so the frontend can render
     * client name / branch name / creator name without extra round-trips.
     */
    private const OWNERSHIP_WITH = [
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
    ];

    public function list(Request $request, string $slug)
    {
        $this->authorizeMaster($request, $slug, 'can_view');
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query()->with(self::OWNERSHIP_WITH)->orderByDesc('id');
        $this->applyScope($q, $request->user());

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
        $modelClass = $this->resolveModel($slug);
        $data = $this->validatePayload($request, $slug, null);
        $user = $request->user();
        $data['created_by'] = optional($user)->id;

        // Stamp client/branch scope from the authenticated user.
        // super_admin may optionally pass client_id/branch_id in request; others are locked to their own.
        [$clientId, $branchId] = $this->resolveOwnership($request, $user);
        $data['client_id'] = $clientId;
        $data['branch_id'] = $branchId;

        $row = $modelClass::create($data);
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

        /* ── Hierarchical edit rule (mirrors destroy()) ───────────────
         *  super_admin always passes. Lower-ranked users may not edit
         *  records created by users above them in the hierarchy.
         *  Rule: creator's role-rank must be <= current user's role-rank.
         *  super_admin = 3, client_* = 2, branch_user = 1.
         */
        $user = $request->user();
        if ($user && $user->user_type !== 'super_admin' && $row->created_by) {
            $creator = User::find($row->created_by);
            if ($creator && $creator->id !== $user->id) {
                $rank = function (?string $type): int {
                    return match ($type) {
                        'super_admin'  => 3,
                        'client_admin' => 2,
                        'client_user'  => 2,
                        'branch_user'  => 1,
                        default        => 0,
                    };
                };
                if ($rank($creator->user_type) > $rank($user->user_type)) {
                    $byWhom = match ($creator->user_type) {
                        'super_admin'  => 'a Super Admin',
                        'client_admin' => 'a Client Admin',
                        'client_user'  => 'a Client user',
                        'branch_user'  => 'a Branch user',
                        default        => 'a higher-privileged user',
                    };
                    return response()->json([
                        'message' => "You cannot edit this record — it was created by {$byWhom}.",
                    ], 403);
                }
            }
        }

        $data = $this->validatePayload($request, $slug, $id);
        $row->update($data);
        $row->load(self::OWNERSHIP_WITH);
        return response()->json($this->withOwnership($row));
    }

    public function destroy(Request $request, string $slug, $id)
    {
        $this->authorizeMaster($request, $slug, 'can_delete');
        $modelClass = $this->resolveModel($slug);
        $q = $modelClass::query();
        $this->applyScope($q, $request->user());
        $row = $q->findOrFail($id);

        /* ── Hierarchical delete rule ──────────────────────────────────
         *  super_admin   : may delete any record (highest privilege).
         *  client_admin  : may delete records created by self or by any
         *  client_user     branch under their client. CANNOT delete
         *                  records created by a super_admin.
         *  branch_user   : may delete records created by self only.
         *                  CANNOT delete records created by super_admin
         *                  or client_admin / client_user.
         *
         *  Rule = creator's role-rank must be <= current user's role-rank.
         *  super_admin = 3, client_* = 2, branch_user = 1.
         */
        $user = $request->user();
        if ($user && $user->user_type !== 'super_admin' && $row->created_by) {
            $creator = User::find($row->created_by);
            if ($creator && $creator->id !== $user->id) {
                $rank = function (?string $type): int {
                    return match ($type) {
                        'super_admin'  => 3,
                        'client_admin' => 2,
                        'client_user'  => 2,
                        'branch_user'  => 1,
                        default        => 0,
                    };
                };
                if ($rank($creator->user_type) > $rank($user->user_type)) {
                    $byWhom = match ($creator->user_type) {
                        'super_admin'  => 'a Super Admin',
                        'client_admin' => 'a Client Admin',
                        'client_user'  => 'a Client user',
                        'branch_user'  => 'a Branch user',
                        default        => 'a higher-privileged user',
                    };
                    return response()->json([
                        'message' => "You cannot delete this record — it was created by {$byWhom}.",
                    ], 403);
                }
            }
        }

        $row->delete();
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
        return $arr;
    }

    /**
     * Scope a query to what the current user is allowed to see. Rules:
     *
     *   super_admin         -> everything
     *
     *   client_admin/user   -> rows where client_id IS NULL (super-admin "global" rows)
     *                          OR client_id = own client
     *
     *   branch_user (main)  -> rows where client_id IS NULL
     *                          OR client_id = own client (any branch, any null branch)
     *                          A main-branch user sees every row under their client.
     *
     *   branch_user (sub)   -> rows where client_id IS NULL
     *                          OR (client_id = own client AND (
     *                                branch_id IS NULL                    -- client-level rows
     *                                OR branch_id = own branch            -- own rows
     *                                OR branch_id = main branch id        -- main-branch shared rows
     *                              ))
     */
    private function applyScope($q, $user): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $clientId = $user->client_id;
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
            return;
        }

        if ($user->user_type === 'branch_user') {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                return;
            }

            // Non-main branch user: include global rows, client-level rows, own branch, main-branch-shared rows.
            $mainBranchId = \App\Models\Branch::where('client_id', $clientId)
                ->where('is_main', true)
                ->value('id');

            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $mainBranchId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($mainBranchId) {
                                 $wb->orWhere('branch_id', $mainBranchId);
                             }
                         });
                  });
            });
            return;
        }

        // unknown type -> see nothing
        $q->whereRaw('1 = 0');
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

        if ($user && $user->user_type === 'branch_user') {
            return [$user->client_id, $user->branch_id];
        }

        return [null, null];
    }

    private function validatePayload(Request $request, string $slug, $id = null): array
    {
        $schema = self::SCHEMAS[$slug] ?? ['fields' => [], 'uFields' => []];
        $fields = $schema['fields'] ?? [];
        $uFields = $schema['uFields'] ?? [];
        $modelClass = $this->resolveModel($slug);
        $table = (new $modelClass)->getTable();

        $rules = [];
        foreach ($fields as $f) {
            $r = [];
            $r[] = $f['r'] ?? false ? 'required' : 'nullable';
            if ($f['t'] === 'number') {
                $r[] = 'numeric';
            } elseif ($f['t'] === 'email') {
                $r[] = 'email';
                $r[] = 'max:255';
            } elseif ($f['t'] === 'date') {
                $r[] = 'date';
            } elseif ($f['t'] === 'textarea') {
                $r[] = 'string';
            } else {
                $r[] = 'string';
                $r[] = 'max:255';
            }
            // Enforce enum options server-side when present and no ref override
            if (!empty($f['opts']) && empty($f['ref'])) {
                $r[] = Rule::in($f['opts']);
            }
            if (in_array($f['n'], $uFields, true)) {
                $rule = Rule::unique($table, $f['n']);
                if ($id) $rule = $rule->ignore($id);
                $r[] = $rule;
            }
            $rules[$f['n']] = $r;
        }

        $validated = $request->validate($rules);
        // Strip empty strings on nullable fields so DB gets NULL
        foreach ($validated as $k => $v) {
            if ($v === '') $validated[$k] = null;
        }
        return $validated;
    }
}

<?php

namespace Database\Seeders;

use App\Http\Controllers\Api\MasterController;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use ReflectionClass;

/**
 * Seeds every master table with real, domain-appropriate records
 * (not placeholder "Sample Name" data).
 *
 * Each row is stamped with:
 *   client_id  = NULL   (super-admin "global" rows visible to every tenant)
 *   branch_id  = NULL
 *   created_by = <super admin user id>
 *
 * On every run, previously admin-seeded global rows (matching this pattern:
 *   created_by = adminId AND client_id IS NULL AND branch_id IS NULL)
 * are cleared and re-seeded with the current definitions below. This keeps
 * the DB in sync with any edits made here without affecting client/branch data.
 *
 * Run:   php artisan db:seed --class=Database\\Seeders\\MasterDataSeeder
 */
class MasterDataSeeder extends Seeder
{
    public function run(): void
    {
        $ref     = new ReflectionClass(MasterController::class);
        $MODELS  = $ref->getConstant('MODELS');

        $admin = User::where('user_type', 'super_admin')->first();
        if (! $admin) {
            $this->command->warn('No super_admin user found — run DatabaseSeeder first.');
            return;
        }
        $adminId = $admin->id;

        // Seed order: use MODELS order, but bump asset_categories BEFORE assets
        // (MODELS lists assets first, but assets references asset_categories via ref).
        $order = array_keys($MODELS);
        $aIdx  = array_search('assets', $order, true);
        $acIdx = array_search('asset_categories', $order, true);
        if ($aIdx !== false && $acIdx !== false && $acIdx > $aIdx) {
            // move asset_categories to just before assets
            unset($order[$acIdx]);
            array_splice($order, $aIdx, 0, ['asset_categories']);
        }

        // countries + states are owned by GeographySeeder (full ISO dataset).
        // Skip them here so we don't wipe + re-seed with the older small sample.
        $ownedByGeographySeeder = ['countries', 'states'];

        // Walk masters in dependency-safe order so ref columns (e.g. states -> countries)
        // always find the referenced row already present.
        foreach ($order as $slug) {
            if (in_array($slug, $ownedByGeographySeeder, true)) {
                continue;
            }
            $modelClass = $MODELS[$slug];
            $table = (new $modelClass)->getTable();

            // Clear previously admin-seeded global rows (safe: leaves client/branch data alone).
            DB::table($table)
                ->where('created_by', $adminId)
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->delete();

            $rows = $this->dataFor($slug, $MODELS);
            if (empty($rows)) {
                $this->command->info(sprintf('skip   %-28s (no real-data definition)', $slug));
                continue;
            }

            $now = now();
            $toInsert = array_map(fn ($r) => array_merge($r, [
                'client_id'  => null,
                'branch_id'  => null,
                'created_by' => $adminId,
                'created_at' => $now,
                'updated_at' => $now,
            ]), $rows);

            DB::table($table)->insert($toInsert);
            $this->command->info(sprintf('insert %-28s +%d rows', $slug, count($rows)));
        }
    }

    /** Resolve the id of an existing row in a referenced master by its name/title column. */
    private function refIdByField(array $MODELS, string $refSlug, string $field, string $value): ?int
    {
        $cls = $MODELS[$refSlug] ?? null;
        if (! $cls) return null;
        return $cls::where($field, $value)->value('id');
    }

    /** Pick the Nth existing id (1-based) from a referenced master; wraps around. */
    private function refIdNth(array $MODELS, string $refSlug, int $n): ?int
    {
        $cls = $MODELS[$refSlug] ?? null;
        if (! $cls) return null;
        $ids = $cls::orderBy('id')->pluck('id')->all();
        if (! $ids) return null;
        return $ids[($n - 1) % count($ids)];
    }

    /**
     * Real-world records per master. 10 entries each, curated for the domain
     * (Indian cross-border trade / ERP / logistics).
     */
    private function dataFor(string $slug, array $MODELS): array
    {
        switch ($slug) {
            /* ───────────── IDENTITY & ENTITY ───────────── */

            case 'company':
                return [
                    ['company_name' => 'Inorbvict Healthcare India Pvt Ltd', 'short_code' => 'IHC',  'gstin' => '27AADCI6120M1ZH', 'pan' => 'AADCI6120M', 'cin' => 'U85100PN2014PTC152252', 'iec' => '3114017398', 'email' => 'info@inhpl.com',        'mobile' => '+91 98500 00001', 'city' => 'Pune',      'state' => 'Maharashtra',   'address' => 'Solitaire Hub, Outer Ring Road, Balewadi, Pune - 411045',       'status' => 'Active'],
                    ['company_name' => 'Bharat Agro Exports Pvt Ltd',        'short_code' => 'BAE',  'gstin' => '24AABCB1234C1Z5', 'pan' => 'AABCB1234C', 'cin' => 'U15100GJ2008PTC054321', 'iec' => '0807005432', 'email' => 'contact@bharatagro.in', 'mobile' => '+91 98500 00002', 'city' => 'Ahmedabad', 'state' => 'Gujarat',       'address' => 'SG Highway, Bodakdev, Ahmedabad - 380054',                      'status' => 'Active'],
                    ['company_name' => 'Chennai Spice Traders LLP',          'short_code' => 'CST',  'gstin' => '33AACFC5678D1Z6', 'pan' => 'AACFC5678D', 'cin' => 'AAT-1234',             'iec' => '0411008765', 'email' => 'sales@chennaispice.com','mobile' => '+91 98500 00003', 'city' => 'Chennai',   'state' => 'Tamil Nadu',    'address' => 'Anna Salai, Chennai - 600002',                                 'status' => 'Active'],
                    ['company_name' => 'Mumbai International Traders Ltd',   'short_code' => 'MIT',  'gstin' => '27AABCM9876E1Z7', 'pan' => 'AABCM9876E', 'cin' => 'L51100MH1995PLC087654', 'iec' => '0311009876', 'email' => 'info@mumbaitraders.in', 'mobile' => '+91 98500 00004', 'city' => 'Mumbai',    'state' => 'Maharashtra',   'address' => 'Nariman Point, Mumbai - 400021',                               'status' => 'Active'],
                    ['company_name' => 'Punjab Rice Millers Pvt Ltd',        'short_code' => 'PRM',  'gstin' => '03AAECP4567F1Z8', 'pan' => 'AAECP4567F', 'cin' => 'U15400PB2010PTC033210', 'iec' => '0507003210', 'email' => 'export@punjabrice.in', 'mobile' => '+91 98500 00005', 'city' => 'Amritsar',  'state' => 'Punjab',        'address' => 'GT Road, Amritsar - 143001',                                   'status' => 'Active'],
                    ['company_name' => 'Karnataka Coffee Exports Pvt Ltd',   'short_code' => 'KCE',  'gstin' => '29AAECK2345G1Z9', 'pan' => 'AAECK2345G', 'cin' => 'U15200KA2012PTC062345', 'iec' => '0712002345', 'email' => 'coffee@kce.in',         'mobile' => '+91 98500 00006', 'city' => 'Bengaluru', 'state' => 'Karnataka',     'address' => 'MG Road, Bengaluru - 560001',                                  'status' => 'Active'],
                    ['company_name' => 'Kerala Tea Merchants Ltd',           'short_code' => 'KTM',  'gstin' => '32AABCK5678H1Z0', 'pan' => 'AABCK5678H', 'cin' => 'L15400KL1988PLC005678', 'iec' => '1088005678', 'email' => 'info@keralatea.in',    'mobile' => '+91 98500 00007', 'city' => 'Kochi',     'state' => 'Kerala',        'address' => 'Willingdon Island, Kochi - 682003',                            'status' => 'Active'],
                    ['company_name' => 'Delhi Dry Fruits Co.',               'short_code' => 'DDF',  'gstin' => '07AACFD7890I1Z1', 'pan' => 'AACFD7890I', 'cin' => null,                   'iec' => '0506008765', 'email' => 'hello@ddf.in',          'mobile' => '+91 98500 00008', 'city' => 'New Delhi', 'state' => 'Delhi',         'address' => 'Karol Bagh, New Delhi - 110005',                               'status' => 'Active'],
                    ['company_name' => 'Rajasthan Handicraft Exports',       'short_code' => 'RHE',  'gstin' => '08AABCR1234J1Z2', 'pan' => 'AABCR1234J', 'cin' => 'U20100RJ2005PTC020034', 'iec' => '1305004321', 'email' => 'export@rhe.in',         'mobile' => '+91 98500 00009', 'city' => 'Jaipur',    'state' => 'Rajasthan',     'address' => 'Amer Road, Jaipur - 302002',                                   'status' => 'Active'],
                    ['company_name' => 'Bengal Pulses & Grains Ltd',         'short_code' => 'BPG',  'gstin' => '19AABCB7654K1Z3', 'pan' => 'AABCB7654K', 'cin' => 'U15499WB2001PLC094321', 'iec' => '0205007654', 'email' => 'grains@bpg.in',         'mobile' => '+91 98500 00010', 'city' => 'Kolkata',   'state' => 'West Bengal',   'address' => 'BBD Bagh, Kolkata - 700001',                                   'status' => 'Active'],
                ];

            case 'bank_accounts':
                return [
                    ['bank_name' => 'State Bank of India',       'account_holder' => 'Inorbvict Healthcare India Pvt Ltd', 'account_number' => '30123456789012', 'ifsc_code' => 'SBIN0000691', 'branch_name' => 'New Delhi Main Branch', 'city' => 'New Delhi', 'swift_code' => 'SBININBB104', 'ad_code' => '0510573', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'HDFC Bank',                 'account_holder' => 'Bharat Agro Exports Pvt Ltd',        'account_number' => '50100123456789', 'ifsc_code' => 'HDFC0000001', 'branch_name' => 'Fort Branch',           'city' => 'Mumbai',    'swift_code' => 'HDFCINBB',    'ad_code' => '0234511', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'ICICI Bank',                'account_holder' => 'Chennai Spice Traders LLP',          'account_number' => '000123456789012','ifsc_code' => 'ICIC0000007', 'branch_name' => 'T Nagar',               'city' => 'Chennai',   'swift_code' => 'ICICINBB',    'ad_code' => '0601234', 'is_primary' => 'No',  'status' => 'Active'],
                    ['bank_name' => 'Axis Bank',                 'account_holder' => 'Mumbai International Traders Ltd',   'account_number' => '917010012345678', 'ifsc_code' => 'UTIB0000002','branch_name' => 'Nariman Point',         'city' => 'Mumbai',    'swift_code' => 'AXISINBB',    'ad_code' => '0212345', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'Punjab National Bank',      'account_holder' => 'Punjab Rice Millers Pvt Ltd',        'account_number' => '001122334455667', 'ifsc_code' => 'PUNB0000100','branch_name' => 'GT Road',               'city' => 'Amritsar',  'swift_code' => 'PUNBINBB',    'ad_code' => '0189234', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'Canara Bank',               'account_holder' => 'Karnataka Coffee Exports Pvt Ltd',   'account_number' => '100000112233445', 'ifsc_code' => 'CNRB0001000','branch_name' => 'MG Road',               'city' => 'Bengaluru', 'swift_code' => 'CNRBINBB',    'ad_code' => '0712034', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'Federal Bank',              'account_holder' => 'Kerala Tea Merchants Ltd',           'account_number' => '11112222333344',  'ifsc_code' => 'FDRL0001234','branch_name' => 'Willingdon Island',     'city' => 'Kochi',     'swift_code' => 'FDRLINBB',    'ad_code' => '0400567', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'Bank of Baroda',            'account_holder' => 'Delhi Dry Fruits Co.',               'account_number' => '03750500000123', 'ifsc_code' => 'BARB0DBPATE','branch_name' => 'Karol Bagh',            'city' => 'New Delhi', 'swift_code' => 'BARBINBB',    'ad_code' => '0513045', 'is_primary' => 'No',  'status' => 'Active'],
                    ['bank_name' => 'Kotak Mahindra Bank',       'account_holder' => 'Rajasthan Handicraft Exports',       'account_number' => '1234567890123456','ifsc_code' => 'KKBK0000567','branch_name' => 'MI Road',               'city' => 'Jaipur',    'swift_code' => 'KKBKINBB',    'ad_code' => '0134567', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'Union Bank of India',       'account_holder' => 'Bengal Pulses & Grains Ltd',         'account_number' => '387901010011223', 'ifsc_code' => 'UBIN0538791','branch_name' => 'BBD Bagh',              'city' => 'Kolkata',   'swift_code' => 'UBININBB',    'ad_code' => '0312789', 'is_primary' => 'Yes', 'status' => 'Active'],
                ];

            case 'departments':
                return [
                    ['name' => 'Sales',            'description' => 'Revenue generation, client relations, order management',                'status' => 'Active'],
                    ['name' => 'Human Resources',  'description' => 'Recruitment, employee records, payroll, compliance',                      'status' => 'Active'],
                    ['name' => 'Accounts',         'description' => 'Financial transactions, ledgers, GST, audit',                             'status' => 'Active'],
                    ['name' => 'Logistics',        'description' => 'Transportation, shipment coordination, freight management',               'status' => 'Active'],
                    ['name' => 'Purchase',         'description' => 'Procurement, vendor management, purchase orders',                          'status' => 'Active'],
                    ['name' => 'IT',               'description' => 'Infrastructure, system maintenance, application support',                  'status' => 'Active'],
                    ['name' => 'Legal',            'description' => 'Contract review, compliance, documentation',                               'status' => 'Active'],
                    ['name' => 'Warehouse',        'description' => 'Inventory storage, stock management, goods receipt',                       'status' => 'Active'],
                    ['name' => 'Quality Control',  'description' => 'Product inspection, quality assurance, testing',                            'status' => 'Active'],
                    ['name' => 'Export-Import',    'description' => 'Customs clearance, shipping documents, trade compliance',                   'status' => 'Active'],
                ];

            case 'roles':
                return [
                    ['name' => 'Admin',             'status' => 'Active'],
                    ['name' => 'Manager',           'status' => 'Active'],
                    ['name' => 'Executive',         'status' => 'Active'],
                    ['name' => 'Staff',             'status' => 'Active'],
                    ['name' => 'Viewer',            'status' => 'Active'],
                    ['name' => 'Director',          'status' => 'Active'],
                    ['name' => 'Operator',          'status' => 'Active'],
                    ['name' => 'Auditor',           'status' => 'Active'],
                    ['name' => 'Accountant',        'status' => 'Active'],
                    ['name' => 'Approver',          'status' => 'Active'],
                ];

            case 'designations':
                return [
                    ['name' => 'Software Developer',       'description' => 'Full-stack development, system integration',     'status' => 'Active'],
                    ['name' => 'Operations Manager',       'description' => 'Oversees daily operations and team coordination', 'status' => 'Active'],
                    ['name' => 'HR Executive',             'description' => 'Recruitment, onboarding, employee engagement',   'status' => 'Active'],
                    ['name' => 'Sales Manager',            'description' => 'Drives revenue, manages accounts and targets',   'status' => 'Active'],
                    ['name' => 'Purchase Officer',         'description' => 'Raises purchase orders, liaises with vendors',   'status' => 'Active'],
                    ['name' => 'Chartered Accountant',     'description' => 'Statutory audit, GST filing, financial reports', 'status' => 'Active'],
                    ['name' => 'Warehouse Supervisor',     'description' => 'Manages stock, GRN, dispatch floor',             'status' => 'Active'],
                    ['name' => 'Logistics Coordinator',    'description' => 'Coordinates shipments, freight forwarders',      'status' => 'Active'],
                    ['name' => 'Quality Inspector',        'description' => 'Product QC, certification, lab tests',           'status' => 'Active'],
                    ['name' => 'Compliance Officer',       'description' => 'Ensures regulatory and trade compliance',        'status' => 'Active'],
                ];

            /* ───────────── GEOGRAPHY & LOCATION ───────────── */

            case 'countries':
                return [
                    ['name' => 'India',          'iso_code' => 'IN', 'status' => 'Active'],
                    ['name' => 'United States',  'iso_code' => 'US', 'status' => 'Active'],
                    ['name' => 'United Kingdom', 'iso_code' => 'GB', 'status' => 'Active'],
                    ['name' => 'Germany',        'iso_code' => 'DE', 'status' => 'Active'],
                    ['name' => 'China',          'iso_code' => 'CN', 'status' => 'Active'],
                    ['name' => 'Japan',          'iso_code' => 'JP', 'status' => 'Active'],
                    ['name' => 'UAE',            'iso_code' => 'AE', 'status' => 'Active'],
                    ['name' => 'Australia',      'iso_code' => 'AU', 'status' => 'Active'],
                    ['name' => 'Canada',         'iso_code' => 'CA', 'status' => 'Active'],
                    ['name' => 'Singapore',      'iso_code' => 'SG', 'status' => 'Active'],
                ];

            case 'states':
                $india = $this->refIdByField($MODELS, 'countries', 'name', 'India');
                return [
                    ['country_id' => $india, 'name' => 'Maharashtra',    'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Gujarat',        'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Delhi',          'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Karnataka',      'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Tamil Nadu',     'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Kerala',         'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Punjab',         'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'West Bengal',    'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Uttar Pradesh',  'status' => 'Active'],
                    ['country_id' => $india, 'name' => 'Rajasthan',      'status' => 'Active'],
                ];

            case 'state_codes':
                $byName = function (string $n) use ($MODELS) {
                    return $this->refIdByField($MODELS, 'states', 'name', $n);
                };
                return [
                    ['state_id' => $byName('Maharashtra'),   'state_code' => '27', 'status' => 'Active'],
                    ['state_id' => $byName('Gujarat'),       'state_code' => '24', 'status' => 'Active'],
                    ['state_id' => $byName('Delhi'),         'state_code' => '07', 'status' => 'Active'],
                    ['state_id' => $byName('Karnataka'),     'state_code' => '29', 'status' => 'Active'],
                    ['state_id' => $byName('Tamil Nadu'),    'state_code' => '33', 'status' => 'Active'],
                    ['state_id' => $byName('Kerala'),        'state_code' => '32', 'status' => 'Active'],
                    ['state_id' => $byName('Punjab'),        'state_code' => '03', 'status' => 'Active'],
                    ['state_id' => $byName('West Bengal'),   'state_code' => '19', 'status' => 'Active'],
                    ['state_id' => $byName('Uttar Pradesh'), 'state_code' => '09', 'status' => 'Active'],
                    ['state_id' => $byName('Rajasthan'),     'state_code' => '08', 'status' => 'Active'],
                ];

            case 'address_types':
                return [
                    ['name' => 'Registered Office',   'status' => 'Active'],
                    ['name' => 'Warehouse',            'status' => 'Active'],
                    ['name' => 'Branch Address',       'status' => 'Active'],
                    ['name' => 'Billing Address',      'status' => 'Active'],
                    ['name' => 'Shipping Address',     'status' => 'Active'],
                    ['name' => 'Factory',              'status' => 'Active'],
                    ['name' => 'Godown',               'status' => 'Active'],
                    ['name' => 'Corporate Office',     'status' => 'Active'],
                    ['name' => 'Correspondence',       'status' => 'Active'],
                    ['name' => 'Export Yard',          'status' => 'Active'],
                ];

            case 'port_of_loading':
                return [
                    ['name' => 'Jawaharlal Nehru Port',       'code' => 'INNSA', 'address' => 'JNPT, Nhava Sheva, Mumbai - 400707',                      'status' => 'Active'],
                    ['name' => 'Chennai Port',                'code' => 'INMAA', 'address' => 'Chennai Port Trust, Chennai - 600001',                   'status' => 'Active'],
                    ['name' => 'Mundra Port',                 'code' => 'INMUN', 'address' => 'Mundra, Kutch, Gujarat - 370421',                        'status' => 'Active'],
                    ['name' => 'Kandla Port',                 'code' => 'INIXY', 'address' => 'Kandla, Gujarat - 370210',                                'status' => 'Active'],
                    ['name' => 'Cochin Port',                 'code' => 'INCOK', 'address' => 'Willingdon Island, Kochi - 682009',                      'status' => 'Active'],
                    ['name' => 'Visakhapatnam Port',          'code' => 'INVTZ', 'address' => 'Port Area, Visakhapatnam - 530001',                      'status' => 'Active'],
                    ['name' => 'Tuticorin Port',              'code' => 'INTUT', 'address' => 'V.O.Chidambaranar Port, Tuticorin - 628004',             'status' => 'Active'],
                    ['name' => 'Delhi Air Cargo',             'code' => 'INDEL', 'address' => 'IGI Airport Cargo Complex, New Delhi - 110037',          'status' => 'Active'],
                    ['name' => 'Mumbai Air Cargo',            'code' => 'INBOM', 'address' => 'Chhatrapati Shivaji Intl Airport, Mumbai - 400099',      'status' => 'Active'],
                    ['name' => 'Bangalore Air Cargo',         'code' => 'INBLR', 'address' => 'Kempegowda Intl Airport, Bengaluru - 560300',            'status' => 'Active'],
                ];

            case 'port_of_discharge':
                $cid = fn (string $n) => $this->refIdByField($MODELS, 'countries', 'name', $n);
                return [
                    ['name' => 'Port Jebel Ali',       'code' => 'AEJEA', 'country_id' => $cid('UAE'),            'city' => 'Dubai',       'status' => 'Active'],
                    ['name' => 'Port of Hamburg',      'code' => 'DEHAM', 'country_id' => $cid('Germany'),        'city' => 'Hamburg',     'status' => 'Active'],
                    ['name' => 'Port of Los Angeles',  'code' => 'USLAX', 'country_id' => $cid('United States'),  'city' => 'Los Angeles', 'status' => 'Active'],
                    ['name' => 'Port of Singapore',    'code' => 'SGSIN', 'country_id' => $cid('Singapore'),      'city' => 'Singapore',   'status' => 'Active'],
                    ['name' => 'Port of Shanghai',     'code' => 'CNSHA', 'country_id' => $cid('China'),          'city' => 'Shanghai',    'status' => 'Active'],
                    ['name' => 'Port of Rotterdam',    'code' => 'NLRTM', 'country_id' => $cid('Germany'),        'city' => 'Rotterdam',   'status' => 'Active'],
                    ['name' => 'Port of Felixstowe',   'code' => 'GBFXT', 'country_id' => $cid('United Kingdom'), 'city' => 'Felixstowe',  'status' => 'Active'],
                    ['name' => 'Port of Yokohama',     'code' => 'JPYOK', 'country_id' => $cid('Japan'),          'city' => 'Yokohama',    'status' => 'Active'],
                    ['name' => 'Port of Sydney',       'code' => 'AUSYD', 'country_id' => $cid('Australia'),      'city' => 'Sydney',      'status' => 'Active'],
                    ['name' => 'Port of Vancouver',    'code' => 'CAVAN', 'country_id' => $cid('Canada'),         'city' => 'Vancouver',   'status' => 'Active'],
                ];

            /* ───────────── TRADE & COMMERCIAL ───────────── */

            case 'segments':
                return [
                    ['title' => 'Dry Fruits',          'status' => 'Active'],
                    ['title' => 'Agro-Chemicals',      'status' => 'Active'],
                    ['title' => 'Spices & Condiments', 'status' => 'Active'],
                    ['title' => 'Oil Seeds',           'status' => 'Active'],
                    ['title' => 'Pulses',              'status' => 'Active'],
                    ['title' => 'Fresh Produce',       'status' => 'Active'],
                    ['title' => 'Food Grains',         'status' => 'Active'],
                    ['title' => 'Dairy Products',      'status' => 'Active'],
                    ['title' => 'Processed Foods',     'status' => 'Active'],
                    ['title' => 'Handicrafts',         'status' => 'Active'],
                ];

            case 'hsn_codes':
                return [
                    ['hsn_code' => '08021200', 'description' => 'Almonds — Shelled',                        'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '08062000', 'description' => 'Dried Grapes (Raisins)',                   'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '12074000', 'description' => 'Sesame Seeds',                             'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '09042190', 'description' => 'Dried Chilli — Neither Crushed Nor Ground','gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '10063090', 'description' => 'Semi-Milled / Wholly Milled Rice — Other', 'gst_rate' => '0%',  'status' => 'Active'],
                    ['hsn_code' => '09011190', 'description' => 'Coffee — Not Roasted / Not Decaffeinated', 'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '09024010', 'description' => 'Black Tea (Fermented)',                    'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '07131000', 'description' => 'Peas — Dried, Shelled',                    'gst_rate' => '0%',  'status' => 'Active'],
                    ['hsn_code' => '09081110', 'description' => 'Cardamom — Small',                          'gst_rate' => '5%',  'status' => 'Active'],
                    ['hsn_code' => '08013100', 'description' => 'Cashew Nuts — In Shell',                   'gst_rate' => '5%',  'status' => 'Active'],
                ];

            case 'gst_percentage':
                return [
                    ['percentage' => 0,    'label' => 'GST 0% — Exempt',     'status' => 'Active'],
                    ['percentage' => 0.1,  'label' => 'GST 0.1% — Merchant', 'status' => 'Active'],
                    ['percentage' => 0.25, 'label' => 'GST 0.25% — Rough Diamonds', 'status' => 'Active'],
                    ['percentage' => 3,    'label' => 'GST 3% — Gold',       'status' => 'Active'],
                    ['percentage' => 5,    'label' => 'GST 5%',              'status' => 'Active'],
                    ['percentage' => 6,    'label' => 'GST 6%',              'status' => 'Active'],
                    ['percentage' => 12,   'label' => 'GST 12%',             'status' => 'Active'],
                    ['percentage' => 18,   'label' => 'GST 18%',             'status' => 'Active'],
                    ['percentage' => 28,   'label' => 'GST 28%',             'status' => 'Active'],
                    ['percentage' => 40,   'label' => 'GST 40% — Cess', 'status' => 'Active'],
                ];

            case 'currencies':
                return [
                    ['name' => 'Indian Rupee',     'code' => 'INR', 'symbol' => '₹',  'exchange_rate' => 1,       'status' => 'Active'],
                    ['name' => 'US Dollar',        'code' => 'USD', 'symbol' => '$',  'exchange_rate' => 83.50,   'status' => 'Active'],
                    ['name' => 'Euro',             'code' => 'EUR', 'symbol' => '€',  'exchange_rate' => 90.20,   'status' => 'Active'],
                    ['name' => 'British Pound',    'code' => 'GBP', 'symbol' => '£',  'exchange_rate' => 105.00,  'status' => 'Active'],
                    ['name' => 'UAE Dirham',       'code' => 'AED', 'symbol' => 'د.إ','exchange_rate' => 22.70,   'status' => 'Active'],
                    ['name' => 'Japanese Yen',     'code' => 'JPY', 'symbol' => '¥',  'exchange_rate' => 0.56,    'status' => 'Active'],
                    ['name' => 'Australian Dollar','code' => 'AUD', 'symbol' => 'A$', 'exchange_rate' => 55.40,   'status' => 'Active'],
                    ['name' => 'Canadian Dollar',  'code' => 'CAD', 'symbol' => 'C$', 'exchange_rate' => 61.20,   'status' => 'Active'],
                    ['name' => 'Singapore Dollar', 'code' => 'SGD', 'symbol' => 'S$', 'exchange_rate' => 62.00,   'status' => 'Active'],
                    ['name' => 'Chinese Yuan',     'code' => 'CNY', 'symbol' => '¥',  'exchange_rate' => 11.60,   'status' => 'Active'],
                ];

            case 'uom':
                return [
                    ['title' => 'Kilogram',    'short_code' => 'KG',  'unit_type' => 'Weight', 'status' => 'Active'],
                    ['title' => 'Metric Ton',  'short_code' => 'MT',  'unit_type' => 'Weight', 'status' => 'Active'],
                    ['title' => 'Gram',        'short_code' => 'GM',  'unit_type' => 'Weight', 'status' => 'Active'],
                    ['title' => 'Liter',       'short_code' => 'LTR', 'unit_type' => 'Volume', 'status' => 'Active'],
                    ['title' => 'Cubic Meter', 'short_code' => 'CBM', 'unit_type' => 'Volume', 'status' => 'Active'],
                    ['title' => 'Piece',       'short_code' => 'PCS', 'unit_type' => 'Count',  'status' => 'Active'],
                    ['title' => 'Box',         'short_code' => 'BOX', 'unit_type' => 'Count',  'status' => 'Active'],
                    ['title' => 'Carton',      'short_code' => 'CTN', 'unit_type' => 'Count',  'status' => 'Active'],
                    ['title' => 'Bag',         'short_code' => 'BAG', 'unit_type' => 'Count',  'status' => 'Active'],
                    ['title' => 'Dozen',       'short_code' => 'DZN', 'unit_type' => 'Count',  'status' => 'Active'],
                ];

            case 'packaging_material':
                return [
                    ['title' => 'PP Bag',           'material_type' => 'Bag',    'status' => 'Active'],
                    ['title' => 'Gunny Bag',        'material_type' => 'Bag',    'status' => 'Active'],
                    ['title' => 'Jute Bag',         'material_type' => 'Bag',    'status' => 'Active'],
                    ['title' => 'Plastic Crate',    'material_type' => 'Crate',  'status' => 'Active'],
                    ['title' => 'Wooden Crate',     'material_type' => 'Crate',  'status' => 'Active'],
                    ['title' => 'Corrugated Box',   'material_type' => 'Box',    'status' => 'Active'],
                    ['title' => 'Master Carton',    'material_type' => 'Box',    'status' => 'Active'],
                    ['title' => 'Pallet',           'material_type' => 'Pallet', 'status' => 'Active'],
                    ['title' => 'Steel Drum',       'material_type' => 'Drum',   'status' => 'Active'],
                    ['title' => 'Stretch Wrap',     'material_type' => 'Wrap',   'status' => 'Active'],
                ];

            case 'conditions':
                return [
                    ['title' => 'Organic',     'status' => 'Active'],
                    ['title' => 'Fresh',       'status' => 'Active'],
                    ['title' => 'Processed',   'status' => 'Active'],
                    ['title' => 'Raw',         'status' => 'Active'],
                    ['title' => 'Ambient',     'status' => 'Active'],
                    ['title' => 'Cold Chain',  'status' => 'Active'],
                    ['title' => 'Frozen',      'status' => 'Active'],
                    ['title' => 'Dry',         'status' => 'Active'],
                    ['title' => 'Refrigerated','status' => 'Active'],
                    ['title' => 'Pasteurized', 'status' => 'Active'],
                ];

            case 'incoterms':
                return [
                    ['code' => 'EXW', 'full_name' => 'Ex Works',                    'transport_mode' => 'Any Mode',             'status' => 'Active'],
                    ['code' => 'FCA', 'full_name' => 'Free Carrier',                'transport_mode' => 'Any Mode',             'status' => 'Active'],
                    ['code' => 'FAS', 'full_name' => 'Free Alongside Ship',         'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],
                    ['code' => 'FOB', 'full_name' => 'Free On Board',               'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],
                    ['code' => 'CFR', 'full_name' => 'Cost and Freight',            'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],
                    ['code' => 'CIF', 'full_name' => 'Cost, Insurance and Freight', 'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],
                    ['code' => 'CPT', 'full_name' => 'Carriage Paid To',            'transport_mode' => 'Any Mode',             'status' => 'Active'],
                    ['code' => 'CIP', 'full_name' => 'Carriage and Insurance Paid', 'transport_mode' => 'Any Mode',             'status' => 'Active'],
                    ['code' => 'DAP', 'full_name' => 'Delivered At Place',          'transport_mode' => 'Any Mode',             'status' => 'Active'],
                    ['code' => 'DDP', 'full_name' => 'Delivered Duty Paid',         'transport_mode' => 'Any Mode',             'status' => 'Active'],
                ];

            /* ───────────── PARTY & CLASSIFICATION ───────────── */

            case 'customer_types':
                return [
                    ['name' => 'Domestic',       'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Export',         'gst_applicable' => 'No',  'status' => 'Active'],
                    ['name' => 'Wholesale',      'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Retail',         'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Distributor',    'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Institutional',  'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Government',     'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Online',         'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'OEM',            'gst_applicable' => 'Yes', 'status' => 'Active'],
                    ['name' => 'Dealer',         'gst_applicable' => 'Yes', 'status' => 'Active'],
                ];

            case 'customer_classifications':
                return [
                    ['name' => 'Tier A — Key Account',   'credit_limit' => 5000000, 'payment_terms' => 45, 'status' => 'Active'],
                    ['name' => 'Tier B — Regular',       'credit_limit' => 1000000, 'payment_terms' => 30, 'status' => 'Active'],
                    ['name' => 'Tier C — New',           'credit_limit' => 200000,  'payment_terms' => 15, 'status' => 'Active'],
                    ['name' => 'VIP',                    'credit_limit' => 10000000,'payment_terms' => 60, 'status' => 'Active'],
                    ['name' => 'Strategic Partner',      'credit_limit' => 7500000, 'payment_terms' => 45, 'status' => 'Active'],
                    ['name' => 'Gold',                   'credit_limit' => 3000000, 'payment_terms' => 30, 'status' => 'Active'],
                    ['name' => 'Silver',                 'credit_limit' => 1500000, 'payment_terms' => 30, 'status' => 'Active'],
                    ['name' => 'Bronze',                 'credit_limit' => 500000,  'payment_terms' => 15, 'status' => 'Active'],
                    ['name' => 'Trial',                  'credit_limit' => 100000,  'payment_terms' => 7,  'status' => 'Active'],
                    ['name' => 'Blacklisted',            'credit_limit' => 0,       'payment_terms' => 0,  'status' => 'Inactive'],
                ];

            case 'vendor_types':
                return [
                    ['name' => 'Farmer',            'description' => 'Direct farm sourcing',                    'status' => 'Active'],
                    ['name' => 'Trader',            'description' => 'Commodity trader / middleman',             'status' => 'Active'],
                    ['name' => 'Manufacturer',      'description' => 'Processed goods manufacturer',             'status' => 'Active'],
                    ['name' => 'Supplier',          'description' => 'General goods supplier',                   'status' => 'Active'],
                    ['name' => 'Distributor',       'description' => 'Regional distributor',                     'status' => 'Active'],
                    ['name' => 'Importer',          'description' => 'Imports goods for local resale',           'status' => 'Active'],
                    ['name' => 'Agent',             'description' => 'Commission-based sourcing agent',          'status' => 'Active'],
                    ['name' => 'Broker',            'description' => 'Deal facilitator — no stock holding',      'status' => 'Active'],
                    ['name' => 'Cooperative',       'description' => 'Farmer / producer cooperative society',    'status' => 'Active'],
                    ['name' => 'Service Provider',  'description' => 'Non-goods services: logistics, consulting','status' => 'Active'],
                ];

            case 'vendor_behaviour':
                return [
                    ['name' => 'Excellent',     'description' => 'Consistently exceeds expectations',     'status' => 'Active'],
                    ['name' => 'Good',          'description' => 'Meets expectations reliably',            'status' => 'Active'],
                    ['name' => 'Average',       'description' => 'Meets basic requirements',              'status' => 'Active'],
                    ['name' => 'Poor',          'description' => 'Below acceptable standards',            'status' => 'Active'],
                    ['name' => 'On-Time',       'description' => 'Delivers within promised timeline',     'status' => 'Active'],
                    ['name' => 'Delayed',       'description' => 'Frequently misses delivery dates',      'status' => 'Active'],
                    ['name' => 'Reliable',      'description' => 'Consistent quality and quantity',       'status' => 'Active'],
                    ['name' => 'Unreliable',    'description' => 'Inconsistent — avoid for key orders',   'status' => 'Active'],
                    ['name' => 'Consistent',    'description' => 'Stable performance over time',          'status' => 'Active'],
                    ['name' => 'Improving',     'description' => 'Upward trend over recent engagements',  'status' => 'Active'],
                ];

            case 'applicable_types':
                return [
                    ['name' => 'Buyer',         'party_type' => 'Customer',    'status' => 'Active'],
                    ['name' => 'Consignee',     'party_type' => 'Customer',    'status' => 'Active'],
                    ['name' => 'Notify Party',  'party_type' => 'Third Party', 'status' => 'Active'],
                    ['name' => 'Shipper',       'party_type' => 'Third Party', 'status' => 'Active'],
                    ['name' => 'Exporter',      'party_type' => 'Customer',    'status' => 'Active'],
                    ['name' => 'Importer',      'party_type' => 'Vendor',      'status' => 'Active'],
                    ['name' => 'Agent',         'party_type' => 'Third Party', 'status' => 'Active'],
                    ['name' => 'Carrier',       'party_type' => 'Carrier',     'status' => 'Active'],
                    ['name' => 'Insurance',     'party_type' => 'Third Party', 'status' => 'Active'],
                    ['name' => 'CHA',           'party_type' => 'Third Party', 'status' => 'Active'],
                ];

            /* ───────────── LEGAL & COMPLIANCE ───────────── */

            case 'license_name':
                return [
                    ['name' => 'IEC Code',                 'license_code' => 'IEC',     'issuing_authority' => 'DGFT',          'validity_months' => 0,   'status' => 'Active'],
                    ['name' => 'FSSAI License',            'license_code' => 'FSSAI',   'issuing_authority' => 'FSSAI',         'validity_months' => 12,  'status' => 'Active'],
                    ['name' => 'APEDA Registration',       'license_code' => 'APEDA',   'issuing_authority' => 'APEDA',         'validity_months' => 60,  'status' => 'Active'],
                    ['name' => 'Spices Board Certificate', 'license_code' => 'SPB',     'issuing_authority' => 'Spices Board',  'validity_months' => 36,  'status' => 'Active'],
                    ['name' => 'MPEDA Registration',       'license_code' => 'MPEDA',   'issuing_authority' => 'MPEDA',         'validity_months' => 36,  'status' => 'Active'],
                    ['name' => 'Drug Wholesale License',   'license_code' => 'DWL',     'issuing_authority' => 'CDSCO',         'validity_months' => 12,  'status' => 'Active'],
                    ['name' => 'Plant Quarantine',         'license_code' => 'PQ',      'issuing_authority' => 'Plant Quarantine', 'validity_months' => 12, 'status' => 'Active'],
                    ['name' => 'Tea Board Certificate',    'license_code' => 'TEA',     'issuing_authority' => 'Tea Board',     'validity_months' => 36,  'status' => 'Active'],
                    ['name' => 'Coffee Board Certificate', 'license_code' => 'COFFEE',  'issuing_authority' => 'Coffee Board',  'validity_months' => 36,  'status' => 'Active'],
                    ['name' => 'GST Registration',         'license_code' => 'GSTIN',   'issuing_authority' => 'GST Council',   'validity_months' => 0,   'status' => 'Active'],
                ];

            case 'risk_levels':
                return [
                    ['name' => 'Very Low',    'description' => 'Negligible risk',                'action_required' => 'None',                      'status' => 'Active'],
                    ['name' => 'Low',         'description' => 'Minimal risk',                   'action_required' => 'None',                      'status' => 'Active'],
                    ['name' => 'Moderate',    'description' => 'Noticeable but manageable',      'action_required' => 'Monitor',                   'status' => 'Active'],
                    ['name' => 'Medium',      'description' => 'Mid-level risk',                 'action_required' => 'Verify documents',          'status' => 'Active'],
                    ['name' => 'High',        'description' => 'Significant risk',               'action_required' => 'Escalate to manager',       'status' => 'Active'],
                    ['name' => 'Severe',      'description' => 'High-impact risk',               'action_required' => 'Senior approval required',  'status' => 'Active'],
                    ['name' => 'Critical',    'description' => 'Severe risk — likely block',     'action_required' => 'Block immediately',         'status' => 'Active'],
                    ['name' => 'Extreme',     'description' => 'Maximum risk — sanctioned',      'action_required' => 'Reject, report compliance', 'status' => 'Active'],
                    ['name' => 'Watchlist',   'description' => 'Entity under observation',        'action_required' => 'Enhanced due diligence',    'status' => 'Active'],
                    ['name' => 'Standard',    'description' => 'Default new-customer level',     'action_required' => 'KYC + credit check',        'status' => 'Active'],
                ];

            case 'document_type':
                return [
                    ['title' => 'GST Registration Certificate', 'applicable_to' => 'Both',     'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'PAN Card',                     'applicable_to' => 'Both',     'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Aadhaar Card',                 'applicable_to' => 'Both',     'is_mandatory' => 'No',  'status' => 'Active'],
                    ['title' => 'Trade License',                'applicable_to' => 'Customer', 'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Certificate of Analysis',      'applicable_to' => 'Vendor',   'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Commercial Invoice',           'applicable_to' => 'Internal', 'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Packing List',                 'applicable_to' => 'Internal', 'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Bill of Lading',               'applicable_to' => 'Internal', 'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Shipping Bill',                'applicable_to' => 'Internal', 'is_mandatory' => 'Yes', 'status' => 'Active'],
                    ['title' => 'Insurance Certificate',        'applicable_to' => 'Internal', 'is_mandatory' => 'No',  'status' => 'Active'],
                ];

            case 'haz_class':
                return [
                    ['name' => 'Explosives',            'haz_code' => 'UN0001', 'packing_group' => 'I (High Danger)',   'status' => 'Active'],
                    ['name' => 'Flammable Gas',         'haz_code' => 'UN1001', 'packing_group' => 'II (Medium Danger)', 'status' => 'Active'],
                    ['name' => 'Flammable Liquid',      'haz_code' => 'UN1263', 'packing_group' => 'II (Medium Danger)', 'status' => 'Active'],
                    ['name' => 'Flammable Solid',       'haz_code' => 'UN1325', 'packing_group' => 'III (Low Danger)',  'status' => 'Active'],
                    ['name' => 'Oxidizer',              'haz_code' => 'UN1942', 'packing_group' => 'II (Medium Danger)', 'status' => 'Active'],
                    ['name' => 'Toxic Substance',       'haz_code' => 'UN2810', 'packing_group' => 'III (Low Danger)',  'status' => 'Active'],
                    ['name' => 'Infectious',            'haz_code' => 'UN2814', 'packing_group' => 'II (Medium Danger)', 'status' => 'Active'],
                    ['name' => 'Radioactive',           'haz_code' => 'UN2912', 'packing_group' => 'I (High Danger)',   'status' => 'Active'],
                    ['name' => 'Corrosive',             'haz_code' => 'UN1789', 'packing_group' => 'II (Medium Danger)', 'status' => 'Active'],
                    ['name' => 'Non-Hazardous',         'haz_code' => 'UN0000', 'packing_group' => 'N/A',                'status' => 'Active'],
                ];

            case 'compliance_behaviours':
                return [
                    ['name' => 'Compliant',               'action_required' => 'None',                           'status' => 'Active'],
                    ['name' => 'Non-Compliant',           'action_required' => 'Issue correction notice',        'status' => 'Active'],
                    ['name' => 'Under Review',            'action_required' => 'Await audit',                    'status' => 'Active'],
                    ['name' => 'Exempt',                  'action_required' => 'Maintain records',               'status' => 'Active'],
                    ['name' => 'Pending',                 'action_required' => 'Submit missing documents',       'status' => 'Active'],
                    ['name' => 'Conditionally Compliant', 'action_required' => 'Monitor quarterly',              'status' => 'Active'],
                    ['name' => 'Flagged',                 'action_required' => 'Compliance lead review',          'status' => 'Active'],
                    ['name' => 'Cleared',                 'action_required' => 'Resume normal processing',        'status' => 'Active'],
                    ['name' => 'Approved',                'action_required' => 'None — fully approved',          'status' => 'Active'],
                    ['name' => 'Watchlist',               'action_required' => 'Enhanced due diligence required', 'status' => 'Active'],
                ];

            /* ───────────── OPERATIONS & SUPPORT ───────────── */

            case 'asset_categories':
                // Seed this BEFORE `assets` so assets can reference category ids.
                return [
                    ['name' => 'Laptop',              'depreciation_rate' => 33.33, 'useful_life_years' => 3,  'status' => 'Active'],
                    ['name' => 'Desktop Computer',    'depreciation_rate' => 33.33, 'useful_life_years' => 3,  'status' => 'Active'],
                    ['name' => 'Office Furniture',    'depreciation_rate' => 10,    'useful_life_years' => 10, 'status' => 'Active'],
                    ['name' => 'Printer',             'depreciation_rate' => 25,    'useful_life_years' => 4,  'status' => 'Active'],
                    ['name' => 'Vehicle',             'depreciation_rate' => 15,    'useful_life_years' => 8,  'status' => 'Active'],
                    ['name' => 'Machinery',           'depreciation_rate' => 15,    'useful_life_years' => 10, 'status' => 'Active'],
                    ['name' => 'Cold Storage Unit',   'depreciation_rate' => 10,    'useful_life_years' => 15, 'status' => 'Active'],
                    ['name' => 'Electronics',         'depreciation_rate' => 25,    'useful_life_years' => 5,  'status' => 'Active'],
                    ['name' => 'Building',            'depreciation_rate' => 2.5,   'useful_life_years' => 40, 'status' => 'Active'],
                    ['name' => 'Handheld Tools',      'depreciation_rate' => 40,    'useful_life_years' => 2,  'status' => 'Active'],
                ];

            case 'assets':
                $catByName = fn (string $n) => $this->refIdByField($MODELS, 'asset_categories', 'name', $n);
                return [
                    ['asset_name' => 'HP EliteBook 840 G9',     'asset_number' => 'A-LT-001', 'asset_type_id' => $catByName('Laptop'),            'assign_date' => now()->subDays(10)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Dell Latitude 5530',      'asset_number' => 'A-LT-002', 'asset_type_id' => $catByName('Laptop'),            'assign_date' => now()->subDays(25)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Dell OptiPlex 7090',      'asset_number' => 'A-DT-001', 'asset_type_id' => $catByName('Desktop Computer'),  'assign_date' => now()->subDays(40)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Godrej Executive Chair',  'asset_number' => 'A-FR-001', 'asset_type_id' => $catByName('Office Furniture'),  'assign_date' => now()->subDays(60)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'HP LaserJet Pro M404dn',  'asset_number' => 'A-PR-001', 'asset_type_id' => $catByName('Printer'),           'assign_date' => now()->subDays(75)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Tata Ace Delivery Van',   'asset_number' => 'A-VH-001', 'asset_type_id' => $catByName('Vehicle'),           'assign_date' => now()->subDays(180)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Toyota Forklift 8FBN25',  'asset_number' => 'A-MC-001', 'asset_type_id' => $catByName('Machinery'),         'assign_date' => now()->subDays(120)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Bluestar Cold Room 50CMT','asset_number' => 'A-CS-001', 'asset_type_id' => $catByName('Cold Storage Unit'), 'assign_date' => now()->subDays(200)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Zebra ZT411 Barcode Printer','asset_number' => 'A-EL-001', 'asset_type_id' => $catByName('Electronics'),    'assign_date' => now()->subDays(95)->format('Y-m-d'), 'status' => 'Active'],
                    ['asset_name' => 'Honeywell Scanner CT40',  'asset_number' => 'A-EL-002', 'asset_type_id' => $catByName('Electronics'),       'assign_date' => now()->subDays(45)->format('Y-m-d'), 'status' => 'Active'],
                ];

            case 'numbering_series':
                return [
                    ['module' => 'Purchase Order',    'prefix' => 'PO/',     'fy_format' => 'YYYY-YY', 'next_number' => 126, 'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Proforma Invoice',  'prefix' => 'INV/',    'fy_format' => 'YYYY-YY', 'next_number' => 89,  'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Quotation',         'prefix' => 'QT/',     'fy_format' => 'YYYY-YY', 'next_number' => 45,  'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Shipment',          'prefix' => 'SHP-EXP-','fy_format' => 'YYYY',    'next_number' => 1,   'is_locked' => 'No',  'status' => 'Active'],
                    ['module' => 'GRN',               'prefix' => 'GRN/',    'fy_format' => 'YYYY-YY', 'next_number' => 300, 'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Delivery Challan',  'prefix' => 'DC/',     'fy_format' => 'YYYY-YY', 'next_number' => 212, 'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Payment Voucher',   'prefix' => 'PAY/',    'fy_format' => 'YYYY-YY', 'next_number' => 150, 'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Credit Note',       'prefix' => 'CN/',     'fy_format' => 'YYYY-YY', 'next_number' => 34,  'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Debit Note',        'prefix' => 'DN/',     'fy_format' => 'YYYY-YY', 'next_number' => 22,  'is_locked' => 'Yes', 'status' => 'Active'],
                    ['module' => 'Goods Receipt',     'prefix' => 'RCV/',    'fy_format' => 'YYYY',    'next_number' => 101, 'is_locked' => 'No',  'status' => 'Active'],
                ];

            /* ───────────── P2P MASTERS ───────────── */

            case 'payment_terms':
                return [
                    ['term_code' => 'ADV100','term_name' => '100% Advance',                    'credit_days' => 0,  'advance_pct' => 100, 'payment_type' => 'Full Advance',     'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'COD',   'term_name' => 'Cash on Delivery',                 'credit_days' => 0,  'advance_pct' => 0,   'payment_type' => 'COD',              'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'NET15', 'term_name' => 'Net 15 Days',                      'credit_days' => 15, 'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'NET30', 'term_name' => 'Net 30 Days',                      'credit_days' => 30, 'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'NET45', 'term_name' => 'Net 45 Days',                      'credit_days' => 45, 'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'NET60', 'term_name' => 'Net 60 Days',                      'credit_days' => 60, 'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => '',                                     'status' => 'Active'],
                    ['term_code' => 'ADV30', 'term_name' => '30% Advance + 70% on Dispatch',    'credit_days' => 0,  'advance_pct' => 30,  'payment_type' => 'Partial Advance',  'milestone_desc' => '30% advance, 70% against dispatch',    'status' => 'Active'],
                    ['term_code' => 'ADV50', 'term_name' => '50% Advance + 50% on Delivery',    'credit_days' => 0,  'advance_pct' => 50,  'payment_type' => 'Milestone-Based',  'milestone_desc' => '50% advance, 50% on GRN confirmation', 'status' => 'Active'],
                    ['term_code' => 'LC',    'term_name' => 'Letter of Credit (Sight)',         'credit_days' => 0,  'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => 'LC at sight — documents released on payment', 'status' => 'Active'],
                    ['term_code' => 'DP',    'term_name' => 'Documents Against Payment',         'credit_days' => 0,  'advance_pct' => 0,   'payment_type' => 'Credit',           'milestone_desc' => 'Docs released to buyer against payment',   'status' => 'Active'],
                ];

            case 'approval_authority':
                return [
                    ['role_name' => 'Purchase Executive', 'module_scope' => 'Purchase Order', 'min_value' => 0,        'max_value' => 50000,    'currency' => 'INR', 'escalate_to' => 'Purchase Manager', 'status' => 'Active'],
                    ['role_name' => 'Purchase Manager',   'module_scope' => 'Purchase Order', 'min_value' => 50001,    'max_value' => 500000,   'currency' => 'INR', 'escalate_to' => 'Director',          'status' => 'Active'],
                    ['role_name' => 'Director',           'module_scope' => 'All',            'min_value' => 500001,   'max_value' => 99999999, 'currency' => 'INR', 'escalate_to' => '',                 'status' => 'Active'],
                    ['role_name' => 'Finance Executive',  'module_scope' => 'Payment',        'min_value' => 0,        'max_value' => 100000,   'currency' => 'INR', 'escalate_to' => 'Finance Manager',  'status' => 'Active'],
                    ['role_name' => 'Finance Manager',    'module_scope' => 'Payment',        'min_value' => 100001,   'max_value' => 1000000,  'currency' => 'INR', 'escalate_to' => 'Director',          'status' => 'Active'],
                    ['role_name' => 'Warehouse Manager',  'module_scope' => 'GRN',            'min_value' => 0,        'max_value' => 99999999, 'currency' => 'INR', 'escalate_to' => 'Operations Head',  'status' => 'Active'],
                    ['role_name' => 'Compliance Head',    'module_scope' => 'VTI',            'min_value' => 0,        'max_value' => 99999999, 'currency' => 'INR', 'escalate_to' => 'Director',          'status' => 'Active'],
                    ['role_name' => 'Sales Manager',      'module_scope' => 'All',            'min_value' => 0,        'max_value' => 250000,   'currency' => 'INR', 'escalate_to' => 'Director',          'status' => 'Active'],
                    ['role_name' => 'CFO',                'module_scope' => 'Payment',        'min_value' => 1000001,  'max_value' => 99999999, 'currency' => 'INR', 'escalate_to' => 'CEO',              'status' => 'Active'],
                    ['role_name' => 'CEO',                'module_scope' => 'All',            'min_value' => 0,        'max_value' => 99999999, 'currency' => 'INR', 'escalate_to' => '',                 'status' => 'Active'],
                ];

            case 'procurement_category':
                return [
                    ['cat_code' => 'GDS',  'cat_name' => 'Goods',                        'match_logic' => '3-Way Match (PO+VTI+GRN)',    'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'SVC',  'cat_name' => 'Services',                     'match_logic' => '2-Way Match (PO+VTI)',        'grn_required' => 'Yes — Service Confirmation',  'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'AMC',  'cat_name' => 'Annual Maintenance Contract',  'match_logic' => '2-Way Match (PO+VTI)',        'grn_required' => 'Yes — Service Confirmation',  'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'JOB',  'cat_name' => 'Job Work',                     'match_logic' => '3-Way Match (PO+VTI+GRN)',    'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'IMP',  'cat_name' => 'Import',                       'match_logic' => '4-Way Match (PO+VTI+GRN+QC)', 'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'No',             'status' => 'Active'],
                    ['cat_code' => 'CAP',  'cat_name' => 'Capital Expenditure',          'match_logic' => '3-Way Match (PO+VTI+GRN)',    'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'CON',  'cat_name' => 'Consumables',                  'match_logic' => '3-Way Match (PO+VTI+GRN)',    'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'RAW',  'cat_name' => 'Raw Material',                 'match_logic' => '4-Way Match (PO+VTI+GRN+QC)', 'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'PAC',  'cat_name' => 'Packaging Material',           'match_logic' => '3-Way Match (PO+VTI+GRN)',    'grn_required' => 'Yes — Physical Receipt',      'gst_applicable' => 'Yes',            'status' => 'Active'],
                    ['cat_code' => 'LIC',  'cat_name' => 'License / Subscription',       'match_logic' => '2-Way Match (PO+VTI)',        'grn_required' => 'No',                          'gst_applicable' => 'Reverse Charge', 'status' => 'Active'],
                ];

            case 'sourcing_type':
                return [
                    ['type_code' => 'DIR',  'type_name' => 'Direct Purchase',      'quotation_required' => 'Mandatory — Min 1 Quote',  'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'OMK',  'type_name' => 'Open Market',          'quotation_required' => 'Mandatory — Min 3 Quotes', 'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'SPOT', 'type_name' => 'Spot Purchase',        'quotation_required' => 'Optional',                  'approval_required' => 'Yes', 'urgency_flag' => 'Urgent',    'status' => 'Active'],
                    ['type_code' => 'RC',   'type_name' => 'Rate Contract',        'quotation_required' => 'Not Required',              'approval_required' => 'No',  'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'EMG',  'type_name' => 'Emergency Purchase',   'quotation_required' => 'Not Required',              'approval_required' => 'Yes', 'urgency_flag' => 'Emergency', 'status' => 'Active'],
                    ['type_code' => 'TND',  'type_name' => 'Tender',               'quotation_required' => 'Mandatory — Min 3 Quotes', 'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'NEG',  'type_name' => 'Negotiated Purchase',  'quotation_required' => 'Mandatory — Min 1 Quote',  'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'CNT',  'type_name' => 'Contract Purchase',    'quotation_required' => 'Not Required',              'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'BID',  'type_name' => 'Bidding',              'quotation_required' => 'Mandatory — Min 3 Quotes', 'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                    ['type_code' => 'AUC',  'type_name' => 'Auction',              'quotation_required' => 'Mandatory — Min 3 Quotes', 'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                ];

            case 'deviation_reason':
                return [
                    ['reason_code' => 'RATE-REV',  'reason_name' => 'Rate Revised Post Negotiation',       'module' => 'Purchase Order',    'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'VND-CHG',   'reason_name' => 'Vendor Changed — Original Unavailable','module' => 'Vendor Comparison','attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'QTY-SHORT', 'reason_name' => 'Partial Delivery — Short Quantity GRN','module' => 'GRN',             'attachment_required' => 'No',  'requires_approval' => 'No',  'status' => 'Active'],
                    ['reason_code' => 'QTY-EXCESS','reason_name' => 'Quantity Exceeded — Excess Receipt',   'module' => 'GRN',             'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'GRN-REJ',   'reason_name' => 'Material Rejected — Quality Failure', 'module' => 'GRN',             'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'DATE-EXT',  'reason_name' => 'Delivery Date Extended by Vendor',    'module' => 'Purchase Order',    'attachment_required' => 'No',  'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'TAX-CORR',  'reason_name' => 'Tax Rate Correction on VTI',          'module' => 'VTI',               'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'SPEC-CHG',  'reason_name' => 'Specification Changed Post PO',        'module' => 'Purchase Order',    'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'PACK-CHG',  'reason_name' => 'Packaging Changed at Vendor Request', 'module' => 'GRN',               'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                    ['reason_code' => 'TOL-BRCH',  'reason_name' => 'Tolerance Breach — Out of Spec',      'module' => 'GRN',               'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                ];

            case 'match_exception':
                return [
                    ['exc_code' => 'QTY-TOL',  'exc_name' => 'Quantity Tolerance Breach',          'tolerance_pct' => 2, 'blocks_payment' => 'Yes — Soft Block (Warning)', 'resolver_role' => 'Purchase Manager',  'status' => 'Active'],
                    ['exc_code' => 'RATE-VAR', 'exc_name' => 'Rate Variance vs PO',                'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Purchase Manager',  'status' => 'Active'],
                    ['exc_code' => 'TAX-MIS',  'exc_name' => 'GST Rate Mismatch — VTI vs PO',      'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Finance Manager',   'status' => 'Active'],
                    ['exc_code' => 'GRN-MISS', 'exc_name' => 'GRN Not Done — Goods Category',      'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Warehouse Manager', 'status' => 'Active'],
                    ['exc_code' => 'DUP-INV',  'exc_name' => 'Duplicate Invoice Number',            'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Finance Executive', 'status' => 'Active'],
                    ['exc_code' => 'PO-EXP',   'exc_name' => 'PO Validity Expired',                 'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Purchase Manager',  'status' => 'Active'],
                    ['exc_code' => 'PAY-DEL',  'exc_name' => 'Payment Delay Beyond Terms',          'tolerance_pct' => 0, 'blocks_payment' => 'No',                         'resolver_role' => 'Finance Manager',   'status' => 'Active'],
                    ['exc_code' => 'CURR-MIS', 'exc_name' => 'Currency Mismatch — VTI vs PO',       'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Finance Manager',   'status' => 'Active'],
                    ['exc_code' => 'DOC-MIS',  'exc_name' => 'Mandatory Document Missing',          'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Soft Block (Warning)', 'resolver_role' => 'Compliance Head',   'status' => 'Active'],
                    ['exc_code' => 'QUAL-REJ', 'exc_name' => 'QC Rejection After GRN',              'tolerance_pct' => 0, 'blocks_payment' => 'Yes — Hard Block',           'resolver_role' => 'Warehouse Manager', 'status' => 'Active'],
                ];

            case 'advance_payment_rules':
                return [
                    ['vendor_type' => 'Farmer',        'procurement_cat' => 'Goods',          'max_advance_pct' => 50, 'approval_above' => 100000, 'approver_role' => 'Purchase Manager', 'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Trader',        'procurement_cat' => 'Goods',          'max_advance_pct' => 30, 'approval_above' => 200000, 'approver_role' => 'Finance Manager',  'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Manufacturer',  'procurement_cat' => 'Goods',          'max_advance_pct' => 25, 'approval_above' => 500000, 'approver_role' => 'Director',          'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Supplier',      'procurement_cat' => 'Services',       'max_advance_pct' => 20, 'approval_above' => 50000,  'approver_role' => 'Purchase Manager', 'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Importer',      'procurement_cat' => 'Import',         'max_advance_pct' => 40, 'approval_above' => 500000, 'approver_role' => 'CFO',              'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Agent',         'procurement_cat' => 'Services',       'max_advance_pct' => 15, 'approval_above' => 25000,  'approver_role' => 'Purchase Manager', 'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Broker',        'procurement_cat' => 'Services',       'max_advance_pct' => 0,  'approval_above' => 0,      'approver_role' => '',                 'attachment_required' => 'No',  'status' => 'Active'],
                    ['vendor_type' => 'Cooperative',   'procurement_cat' => 'Goods',          'max_advance_pct' => 40, 'approval_above' => 200000, 'approver_role' => 'Purchase Manager', 'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Distributor',   'procurement_cat' => 'Goods',          'max_advance_pct' => 25, 'approval_above' => 300000, 'approver_role' => 'Finance Manager',  'attachment_required' => 'Yes', 'status' => 'Active'],
                    ['vendor_type' => 'Job Worker',    'procurement_cat' => 'Job Work',       'max_advance_pct' => 30, 'approval_above' => 150000, 'approver_role' => 'Purchase Manager', 'attachment_required' => 'Yes', 'status' => 'Active'],
                ];

            case 'exchange_rate_log':
                $today = now()->format('Y-m-d');
                return [
                    ['currency_code' => 'USD', 'currency_name' => 'US Dollar',         'rate_vs_inr' => 83.45,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'EUR', 'currency_name' => 'Euro',               'rate_vs_inr' => 90.12,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'GBP', 'currency_name' => 'British Pound',      'rate_vs_inr' => 105.30, 'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'AED', 'currency_name' => 'UAE Dirham',         'rate_vs_inr' => 22.70,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'JPY', 'currency_name' => 'Japanese Yen',       'rate_vs_inr' => 0.56,   'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'AUD', 'currency_name' => 'Australian Dollar',  'rate_vs_inr' => 55.40,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'CAD', 'currency_name' => 'Canadian Dollar',    'rate_vs_inr' => 61.20,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'SGD', 'currency_name' => 'Singapore Dollar',   'rate_vs_inr' => 62.00,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'CNY', 'currency_name' => 'Chinese Yuan',       'rate_vs_inr' => 11.60,  'effective_date' => $today,                           'rate_source' => 'RBI Reference Rate', 'status' => 'Active'],
                    ['currency_code' => 'USD', 'currency_name' => 'US Dollar (prev)',   'rate_vs_inr' => 83.20,  'effective_date' => now()->subDays(1)->format('Y-m-d'), 'rate_source' => 'RBI Reference Rate', 'status' => 'Superseded'],
                ];

            case 'goods_service_flag':
                return [
                    ['flag_code' => 'GDS',     'flag_name' => 'Goods',                    'grn_screen' => 'Physical Receipt — Qty + Batch + Warehouse',   'evidence_type' => 'Delivery Challan / Gate Entry Slip',      'status' => 'Active'],
                    ['flag_code' => 'SVC',     'flag_name' => 'Services',                  'grn_screen' => 'Service Completion — Date + Proof Doc',        'evidence_type' => 'Service Completion Certificate',          'status' => 'Active'],
                    ['flag_code' => 'MIX',     'flag_name' => 'Mixed (Goods + Service)',   'grn_screen' => 'Mixed — Partial Goods + Service',              'evidence_type' => 'Delivery Challan + Completion Certificate', 'status' => 'Active'],
                    ['flag_code' => 'GDS-IMP', 'flag_name' => 'Imported Goods',            'grn_screen' => 'Physical Receipt — Qty + Batch + Warehouse',   'evidence_type' => 'Bill of Entry + Delivery Challan',        'status' => 'Active'],
                    ['flag_code' => 'GDS-EXP', 'flag_name' => 'Export Goods',              'grn_screen' => 'Physical Receipt — Qty + Batch + Warehouse',   'evidence_type' => 'Shipping Bill + Packing List',            'status' => 'Active'],
                    ['flag_code' => 'SVC-AMC', 'flag_name' => 'AMC Services',              'grn_screen' => 'Service Completion — Date + Proof Doc',        'evidence_type' => 'Service Completion Certificate',          'status' => 'Active'],
                    ['flag_code' => 'SVC-JOB', 'flag_name' => 'Job Work Services',         'grn_screen' => 'Service Completion — Date + Proof Doc',        'evidence_type' => 'Job Work Completion Certificate',         'status' => 'Active'],
                    ['flag_code' => 'CAP',     'flag_name' => 'Capital Goods',             'grn_screen' => 'Physical Receipt — Qty + Batch + Warehouse',   'evidence_type' => 'Delivery Challan + Installation Report',  'status' => 'Active'],
                    ['flag_code' => 'DIG',     'flag_name' => 'Digital Goods / Licenses',  'grn_screen' => 'Service Completion — Date + Proof Doc',        'evidence_type' => 'License Activation Email / Portal Proof', 'status' => 'Active'],
                    ['flag_code' => 'HYB',     'flag_name' => 'Hybrid — Goods + AMC',      'grn_screen' => 'Mixed — Partial Goods + Service',              'evidence_type' => 'Delivery Challan + Service SLA',          'status' => 'Active'],
                ];

            case 'vendor_directory':
                $seg = fn (string $n) => $this->refIdByField($MODELS, 'segments', 'title', $n);
                $st  = fn (string $n) => $this->refIdByField($MODELS, 'states', 'name', $n);
                return [
                    ['vendor_company_name' => 'TechParts India Pvt Ltd',    'contact_person' => 'Ramesh Joshi',   'mobile_number' => '9876543210', 'email_id' => 'ramesh@techparts.in',  'segment_id' => $seg('Processed Foods'),      'address' => '101, Business Park, MG Road',   'country' => 'India', 'state' => $st('Maharashtra'), 'city' => 'Pune',      'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Agro Supplies Co.',          'contact_person' => 'Suresh Patil',   'mobile_number' => '9823456780', 'email_id' => 'suresh@agrosupplies.in','segment_id' => $seg('Food Grains'),          'address' => 'Plot 5, MIDC, Satara Road',    'country' => 'India', 'state' => $st('Maharashtra'), 'city' => 'Satara',    'mapping_mode' => 'Map New Vendor',          'status' => 'Active'],
                    ['vendor_company_name' => 'Spice Traders Ltd',          'contact_person' => 'Anand Kumar',    'mobile_number' => '9845012345', 'email_id' => 'anand@spicetraders.in', 'segment_id' => $seg('Spices & Condiments'), 'address' => '22, Anna Salai',                'country' => 'India', 'state' => $st('Tamil Nadu'),  'city' => 'Chennai',   'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Gujarat Pulses Pvt Ltd',     'contact_person' => 'Nilesh Shah',    'mobile_number' => '9824098765', 'email_id' => 'nilesh@gujpulses.in',   'segment_id' => $seg('Pulses'),               'address' => 'APMC Market Yard',              'country' => 'India', 'state' => $st('Gujarat'),     'city' => 'Rajkot',    'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Karnataka Coffee Exports',   'contact_person' => 'Ravi Kumar',     'mobile_number' => '9740087654', 'email_id' => 'ravi@kce.in',           'segment_id' => $seg('Processed Foods'),      'address' => 'Rajajinagar Industrial Area',   'country' => 'India', 'state' => $st('Karnataka'),   'city' => 'Bengaluru', 'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Punjab Rice Mills',          'contact_person' => 'Harjit Singh',   'mobile_number' => '9878012345', 'email_id' => 'harjit@punjabrice.in',  'segment_id' => $seg('Food Grains'),          'address' => 'Industrial Focal Point',        'country' => 'India', 'state' => $st('Punjab'),      'city' => 'Ludhiana',  'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'UP Pharma Suppliers',        'contact_person' => 'Pranav Mishra',  'mobile_number' => '9719087654', 'email_id' => 'pranav@uppharma.in',    'segment_id' => $seg('Processed Foods'),      'address' => 'Pharma Hub, Dehradun Road',     'country' => 'India', 'state' => $st('Uttar Pradesh'),'city' => 'Noida',     'mapping_mode' => 'Map New Vendor',          'status' => 'Active'],
                    ['vendor_company_name' => 'MH Packaging Solutions',     'contact_person' => 'Prakash Gore',   'mobile_number' => '9820098765', 'email_id' => 'prakash@mhpack.in',     'segment_id' => $seg('Processed Foods'),      'address' => 'MIDC Bhosari',                  'country' => 'India', 'state' => $st('Maharashtra'), 'city' => 'Pune',      'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Kerala Tea Exports',         'contact_person' => 'Binoy Thomas',   'mobile_number' => '9446012345', 'email_id' => 'binoy@keralatea.in',    'segment_id' => $seg('Processed Foods'),      'address' => 'Spencer Junction',              'country' => 'India', 'state' => $st('Kerala'),      'city' => 'Kochi',     'mapping_mode' => 'Map from Vendor Master', 'status' => 'Active'],
                    ['vendor_company_name' => 'Bengal Jute Industries',     'contact_person' => 'Amit Ganguly',   'mobile_number' => '9831012345', 'email_id' => 'amit@bengaljute.in',    'segment_id' => $seg('Handicrafts'),          'address' => 'Howrah Industrial Estate',      'country' => 'India', 'state' => $st('West Bengal'), 'city' => 'Kolkata',   'mapping_mode' => 'Map New Vendor',          'status' => 'Active'],
                ];

            /* ───────────── WAREHOUSE MASTERS ───────────── */

            case 'warehouse_master':
                return [
                    ['wh_id' => 'WH-001', 'wh_name' => 'Pune Main',         'wh_type' => 'Own Warehouse',          'city' => 'Pune',       'state' => 'Maharashtra',    'pincode' => '411045', 'contact_person' => 'Rajesh Kumar',  'contact_phone' => '+91 98100 00001', 'area_sqft' => 25000, 'address' => 'Solitaire Hub, Balewadi, Pune',       'status' => 'Active'],
                    ['wh_id' => 'WH-002', 'wh_name' => 'Mumbai Hub',        'wh_type' => 'Own Warehouse',          'city' => 'Mumbai',     'state' => 'Maharashtra',    'pincode' => '400001', 'contact_person' => 'Priya Mehta',    'contact_phone' => '+91 98100 00002', 'area_sqft' => 40000, 'address' => 'JNPT Industrial Area, Mumbai',        'status' => 'Active'],
                    ['wh_id' => 'WH-003', 'wh_name' => 'Nashik',            'wh_type' => 'Third Party Warehouse',  'city' => 'Nashik',     'state' => 'Maharashtra',    'pincode' => '422001', 'contact_person' => 'Suresh Patil',   'contact_phone' => '+91 98100 00003', 'area_sqft' => 18000, 'address' => 'MIDC Ambad, Nashik',                   'status' => 'Active'],
                    ['wh_id' => 'WH-004', 'wh_name' => 'Nagpur',            'wh_type' => 'Third Party Warehouse',  'city' => 'Nagpur',     'state' => 'Maharashtra',    'pincode' => '440001', 'contact_person' => 'Amit Shah',      'contact_phone' => '+91 98100 00004', 'area_sqft' => 15000, 'address' => 'Butibori MIDC, Nagpur',                'status' => 'Active'],
                    ['wh_id' => 'WH-005', 'wh_name' => 'Delhi NCR',         'wh_type' => 'Own Warehouse',          'city' => 'Gurugram',   'state' => 'Haryana',        'pincode' => '122003', 'contact_person' => 'Vivek Malhotra', 'contact_phone' => '+91 98100 00005', 'area_sqft' => 35000, 'address' => 'Sector 34, Gurugram',                  'status' => 'Active'],
                    ['wh_id' => 'WH-006', 'wh_name' => 'Bangalore South',   'wh_type' => 'Third Party Warehouse',  'city' => 'Bengaluru',  'state' => 'Karnataka',      'pincode' => '560100', 'contact_person' => 'Divya Iyer',     'contact_phone' => '+91 98100 00006', 'area_sqft' => 22000, 'address' => 'Electronics City Phase 2',              'status' => 'Active'],
                    ['wh_id' => 'WH-007', 'wh_name' => 'Chennai Port',      'wh_type' => 'Own Warehouse',          'city' => 'Chennai',    'state' => 'Tamil Nadu',     'pincode' => '600019', 'contact_person' => 'Karthik R',      'contact_phone' => '+91 98100 00007', 'area_sqft' => 30000, 'address' => 'Tondiarpet, near Chennai Port',        'status' => 'Active'],
                    ['wh_id' => 'WH-008', 'wh_name' => 'Kolkata East',      'wh_type' => 'Third Party Warehouse',  'city' => 'Kolkata',    'state' => 'West Bengal',    'pincode' => '700156', 'contact_person' => 'Sourav Ghosh',   'contact_phone' => '+91 98100 00008', 'area_sqft' => 17000, 'address' => 'Salt Lake Industrial Zone',             'status' => 'Active'],
                    ['wh_id' => 'WH-009', 'wh_name' => 'Ahmedabad West',    'wh_type' => 'Own Warehouse',          'city' => 'Ahmedabad',  'state' => 'Gujarat',        'pincode' => '382210', 'contact_person' => 'Hiren Patel',    'contact_phone' => '+91 98100 00009', 'area_sqft' => 28000, 'address' => 'Changodar GIDC',                        'status' => 'Active'],
                    ['wh_id' => 'WH-010', 'wh_name' => 'Hyderabad Central', 'wh_type' => 'Third Party Warehouse',  'city' => 'Hyderabad',  'state' => 'Telangana',      'pincode' => '500032', 'contact_person' => 'Arun Reddy',     'contact_phone' => '+91 98100 00010', 'area_sqft' => 20000, 'address' => 'Gachibowli Logistics Park',             'status' => 'Active'],
                ];

            case 'zone_master':
                $wh = fn (string $n) => $this->refIdByField($MODELS, 'warehouse_master', 'wh_name', $n);
                return [
                    ['zone_id' => 'ZN-001', 'zone_name' => 'Zone A — General Storage', 'zone_type' => 'Storage Zone',     'warehouse' => $wh('Pune Main'),        'purpose' => 'General goods storage',                   'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-002', 'zone_name' => 'Zone B — Cold Chain',      'zone_type' => 'Cold Chain Zone',  'warehouse' => $wh('Pune Main'),        'purpose' => 'Temperature-controlled storage',          'cold_chain' => 'Yes', 'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-003', 'zone_name' => 'Zone C — Dispatch',        'zone_type' => 'Dispatch Zone',    'warehouse' => $wh('Mumbai Hub'),       'purpose' => 'Outward dispatch staging area',           'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-004', 'zone_name' => 'Zone D — Hazmat',          'zone_type' => 'Hazardous Zone',   'warehouse' => $wh('Nashik'),           'purpose' => 'Hazardous material storage',              'cold_chain' => 'No',  'hazardous' => 'Yes', 'status' => 'Active'],
                    ['zone_id' => 'ZN-005', 'zone_name' => 'Zone E — Holding',         'zone_type' => 'Holding Zone',     'warehouse' => $wh('Delhi NCR'),        'purpose' => 'Receipt staging before putaway',           'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-006', 'zone_name' => 'Zone F — QC Hold',         'zone_type' => 'QC Hold Zone',     'warehouse' => $wh('Delhi NCR'),        'purpose' => 'Goods awaiting quality clearance',         'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-007', 'zone_name' => 'Zone G — Overflow',        'zone_type' => 'Overflow Zone',    'warehouse' => $wh('Bangalore South'),  'purpose' => 'Seasonal overflow storage',                'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-008', 'zone_name' => 'Zone H — Blocked',         'zone_type' => 'Blocked Zone',     'warehouse' => $wh('Chennai Port'),     'purpose' => 'Damaged / returned goods hold',            'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-009', 'zone_name' => 'Zone I — Regulated',       'zone_type' => 'Regulated Zone',   'warehouse' => $wh('Kolkata East'),     'purpose' => 'Licensed / regulated goods storage',       'cold_chain' => 'No',  'hazardous' => 'No',  'status' => 'Active'],
                    ['zone_id' => 'ZN-010', 'zone_name' => 'Zone J — Cold Dispatch',   'zone_type' => 'Dispatch Zone',    'warehouse' => $wh('Ahmedabad West'),   'purpose' => 'Cold chain dispatch staging',              'cold_chain' => 'Yes', 'hazardous' => 'No',  'status' => 'Active'],
                ];

            case 'rack_type_master':
                return [
                    ['type_code' => 'PLT', 'type_name' => 'Pallet Rack',      'description' => 'Standard selective pallet racking for bulk storage',   'suitable_for' => 'General Inventory','max_load_per_shelf' => 1000, 'typical_shelves' => 4, 'status' => 'Active'],
                    ['type_code' => 'FLR', 'type_name' => 'Floor Rack',       'description' => 'Ground-level floor rack for heavy or bulk items',       'suitable_for' => 'Heavy Duty',        'max_load_per_shelf' => 3000, 'typical_shelves' => 2, 'status' => 'Active'],
                    ['type_code' => 'CLD', 'type_name' => 'Cool Rack',        'description' => 'Temperature-resistant rack for cold chain storage',     'suitable_for' => 'Cold Chain',        'max_load_per_shelf' => 800,  'typical_shelves' => 3, 'status' => 'Active'],
                    ['type_code' => 'HAZ', 'type_name' => 'Hazardous Rack',   'description' => 'Isolated rack with safety features for hazmat goods',   'suitable_for' => 'Hazardous',         'max_load_per_shelf' => 500,  'typical_shelves' => 2, 'status' => 'Active'],
                    ['type_code' => 'CNT', 'type_name' => 'Cantilever Rack',  'description' => 'Open-arm rack for long or irregularly shaped items',    'suitable_for' => 'General Inventory', 'max_load_per_shelf' => 1500, 'typical_shelves' => 5, 'status' => 'Active'],
                    ['type_code' => 'SLV', 'type_name' => 'Selective Rack',   'description' => 'Selective pallet rack for fast-moving SKUs',            'suitable_for' => 'General Inventory', 'max_load_per_shelf' => 1200, 'typical_shelves' => 4, 'status' => 'Active'],
                    ['type_code' => 'DRV', 'type_name' => 'Drive-In Rack',    'description' => 'High-density rack for homogeneous pallets',              'suitable_for' => 'General Inventory', 'max_load_per_shelf' => 2000, 'typical_shelves' => 5, 'status' => 'Active'],
                    ['type_code' => 'MZN', 'type_name' => 'Mezzanine Rack',   'description' => 'Multi-tier rack using vertical warehouse space',         'suitable_for' => 'Retail',            'max_load_per_shelf' => 600,  'typical_shelves' => 6, 'status' => 'Active'],
                    ['type_code' => 'FLW', 'type_name' => 'Flow Rack',        'description' => 'Gravity flow rack — FIFO picking',                       'suitable_for' => 'Retail',            'max_load_per_shelf' => 400,  'typical_shelves' => 4, 'status' => 'Active'],
                    ['type_code' => 'PHR', 'type_name' => 'Pharma Rack',      'description' => 'Validated storage rack for pharma with temperature log', 'suitable_for' => 'Pharma',            'max_load_per_shelf' => 500,  'typical_shelves' => 3, 'status' => 'Active'],
                ];

            case 'temp_class_master':
                return [
                    ['class_code' => 'AMB', 'class_name' => 'Ambient',              'temp_range_min' => 15,  'temp_range_max' => 35,   'description' => 'Standard room temperature for dry goods, FMCG, general inventory', 'requires_monitoring' => 'No',  'alert_threshold' => 40,  'suitable_products' => 'Dry goods, Grains, FMCG, Packaging', 'status' => 'Active'],
                    ['class_code' => 'RMT', 'class_name' => 'Room Temperature',     'temp_range_min' => 18,  'temp_range_max' => 25,   'description' => 'Controlled room temperature for pharma and sensitive goods',       'requires_monitoring' => 'Yes', 'alert_threshold' => 28,  'suitable_products' => 'Pharma, Cosmetics, Electronics',    'status' => 'Active'],
                    ['class_code' => 'CLD', 'class_name' => 'Cold Chain',            'temp_range_min' => 2,   'temp_range_max' => 8,    'description' => 'Refrigerated storage for perishables and temperature-sensitive products', 'requires_monitoring' => 'Yes', 'alert_threshold' => 10,  'suitable_products' => 'Dairy, Fresh Produce, Vaccines',    'status' => 'Active'],
                    ['class_code' => 'FRZ', 'class_name' => 'Frozen',                'temp_range_min' => -25, 'temp_range_max' => -18,  'description' => 'Deep freeze storage for frozen goods and long-term preservation',   'requires_monitoring' => 'Yes', 'alert_threshold' => -15, 'suitable_products' => 'Frozen Foods, Ice Cream, Meat',     'status' => 'Active'],
                    ['class_code' => 'HAZ', 'class_name' => 'Hazardous Controlled', 'temp_range_min' => 15,  'temp_range_max' => 30,   'description' => 'Controlled environment for hazardous, flammable or regulated materials', 'requires_monitoring' => 'Yes', 'alert_threshold' => 35,  'suitable_products' => 'Chemicals, Flammables',             'status' => 'Active'],
                    ['class_code' => 'CRY', 'class_name' => 'Cryogenic',             'temp_range_min' => -196,'temp_range_max' => -150, 'description' => 'Ultra-low temperature storage for biologics and samples',          'requires_monitoring' => 'Yes', 'alert_threshold' => -140,'suitable_products' => 'Biologics, Research Samples',       'status' => 'Active'],
                    ['class_code' => 'CTR', 'class_name' => 'Controlled Room',      'temp_range_min' => 20,  'temp_range_max' => 22,   'description' => 'Narrow-band controlled room — validated pharma storage',           'requires_monitoring' => 'Yes', 'alert_threshold' => 24,  'suitable_products' => 'Sensitive Pharma, Biotech',        'status' => 'Active'],
                    ['class_code' => 'HOT', 'class_name' => 'Heated',                'temp_range_min' => 35,  'temp_range_max' => 45,   'description' => 'Heated storage to keep products above ambient',                     'requires_monitoring' => 'Yes', 'alert_threshold' => 50,  'suitable_products' => 'Liquid Chemicals, Oils',            'status' => 'Active'],
                    ['class_code' => 'INC', 'class_name' => 'Incubator',             'temp_range_min' => 36,  'temp_range_max' => 38,   'description' => 'Lab-grade incubation temperature',                                  'requires_monitoring' => 'Yes', 'alert_threshold' => 40,  'suitable_products' => 'Biotech Cultures',                  'status' => 'Active'],
                    ['class_code' => 'VAR', 'class_name' => 'Variable',              'temp_range_min' => -10, 'temp_range_max' => 40,   'description' => 'Multi-purpose chamber with adjustable temperature',                 'requires_monitoring' => 'Yes', 'alert_threshold' => 45,  'suitable_products' => 'Flex-use storage',                  'status' => 'Active'],
                ];

            case 'racks': {
                $wh    = fn (string $n) => $this->refIdByField($MODELS, 'warehouse_master', 'wh_name', $n);
                $zn    = fn (string $n) => $this->refIdByField($MODELS, 'zone_master', 'zone_name', $n);
                $rt    = fn (string $c) => $this->refIdByField($MODELS, 'rack_type_master', 'type_code', $c);
                $tc    = fn (string $c) => $this->refIdByField($MODELS, 'temp_class_master', 'class_code', $c);
                return [
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Pune Main'),       'zone' => $zn('Zone A — General Storage'), 'rackName' => 'RC-001', 'rackType' => $rt('PLT'), 'rackStatus' => 'Partially Filled',    'shelves' => 4, 'maxWeight' => 2000, 'maxVolume' => 12, 'tempClass' => $tc('AMB')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Pune Main'),       'zone' => $zn('Zone B — Cold Chain'),      'rackName' => 'RC-002', 'rackType' => $rt('CLD'), 'rackStatus' => 'Partially Filled',    'shelves' => 3, 'maxWeight' => 1500, 'maxVolume' => 8,  'tempClass' => $tc('CLD')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Mumbai Hub'),      'zone' => $zn('Zone C — Dispatch'),        'rackName' => 'RC-003', 'rackType' => $rt('SLV'), 'rackStatus' => 'Full',               'shelves' => 4, 'maxWeight' => 1200, 'maxVolume' => 10, 'tempClass' => $tc('AMB')],
                    ['whType' => 'Third Party Warehouse', 'warehouse' => $wh('Nashik'),          'zone' => $zn('Zone D — Hazmat'),          'rackName' => 'RC-004', 'rackType' => $rt('HAZ'), 'rackStatus' => 'Reserved',           'shelves' => 2, 'maxWeight' => 800,  'maxVolume' => 5,  'tempClass' => $tc('HAZ')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Delhi NCR'),       'zone' => $zn('Zone E — Holding'),         'rackName' => 'RC-005', 'rackType' => $rt('PLT'), 'rackStatus' => 'Empty',              'shelves' => 5, 'maxWeight' => 2500, 'maxVolume' => 15, 'tempClass' => $tc('AMB')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Delhi NCR'),       'zone' => $zn('Zone F — QC Hold'),         'rackName' => 'RC-006', 'rackType' => $rt('FLW'), 'rackStatus' => 'Blocked',            'shelves' => 4, 'maxWeight' => 400,  'maxVolume' => 6,  'tempClass' => $tc('RMT')],
                    ['whType' => 'Third Party Warehouse', 'warehouse' => $wh('Bangalore South'), 'zone' => $zn('Zone G — Overflow'),        'rackName' => 'RC-007', 'rackType' => $rt('MZN'), 'rackStatus' => 'Partially Filled',    'shelves' => 6, 'maxWeight' => 600,  'maxVolume' => 14, 'tempClass' => $tc('AMB')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Chennai Port'),    'zone' => $zn('Zone H — Blocked'),         'rackName' => 'RC-008', 'rackType' => $rt('FLR'), 'rackStatus' => 'Under Maintenance',  'shelves' => 2, 'maxWeight' => 3000, 'maxVolume' => 18, 'tempClass' => $tc('AMB')],
                    ['whType' => 'Third Party Warehouse', 'warehouse' => $wh('Kolkata East'),    'zone' => $zn('Zone I — Regulated'),       'rackName' => 'RC-009', 'rackType' => $rt('PHR'), 'rackStatus' => 'Partially Filled',    'shelves' => 3, 'maxWeight' => 500,  'maxVolume' => 7,  'tempClass' => $tc('RMT')],
                    ['whType' => 'Own Warehouse',         'warehouse' => $wh('Ahmedabad West'),  'zone' => $zn('Zone J — Cold Dispatch'),   'rackName' => 'RC-010', 'rackType' => $rt('CLD'), 'rackStatus' => 'Full',               'shelves' => 3, 'maxWeight' => 900,  'maxVolume' => 9,  'tempClass' => $tc('CLD')],
                ];
            }

            case 'shelf_master': {
                $rack = fn (string $n) => $this->refIdByField($MODELS, 'racks', 'rackName', $n);
                return [
                    ['rack_ref' => $rack('RC-001'), 'shelf_name' => 'A1-L1', 'level_no' => 1, 'shelf_type' => 'Standard Shelf',   'max_weight' => 500, 'status' => 'Available'],
                    ['rack_ref' => $rack('RC-001'), 'shelf_name' => 'A1-L2', 'level_no' => 2, 'shelf_type' => 'Standard Shelf',   'max_weight' => 500, 'status' => 'Partially Used'],
                    ['rack_ref' => $rack('RC-002'), 'shelf_name' => 'B1-L1', 'level_no' => 1, 'shelf_type' => 'Cold Shelf',       'max_weight' => 400, 'status' => 'Full'],
                    ['rack_ref' => $rack('RC-003'), 'shelf_name' => 'C1-L1', 'level_no' => 1, 'shelf_type' => 'Standard Shelf',   'max_weight' => 450, 'status' => 'Full'],
                    ['rack_ref' => $rack('RC-004'), 'shelf_name' => 'D1-L1', 'level_no' => 1, 'shelf_type' => 'Heavy Duty Shelf', 'max_weight' => 700, 'status' => 'Blocked'],
                    ['rack_ref' => $rack('RC-005'), 'shelf_name' => 'E1-L1', 'level_no' => 1, 'shelf_type' => 'Standard Shelf',   'max_weight' => 500, 'status' => 'Available'],
                    ['rack_ref' => $rack('RC-006'), 'shelf_name' => 'F1-L1', 'level_no' => 1, 'shelf_type' => 'Mesh Shelf',       'max_weight' => 300, 'status' => 'Under Maintenance'],
                    ['rack_ref' => $rack('RC-007'), 'shelf_name' => 'G1-L1', 'level_no' => 1, 'shelf_type' => 'Wire Deck Shelf',  'max_weight' => 350, 'status' => 'Partially Used'],
                    ['rack_ref' => $rack('RC-008'), 'shelf_name' => 'H1-L1', 'level_no' => 1, 'shelf_type' => 'Heavy Duty Shelf', 'max_weight' => 800, 'status' => 'Under Maintenance'],
                    ['rack_ref' => $rack('RC-009'), 'shelf_name' => 'I1-L1', 'level_no' => 1, 'shelf_type' => 'Cantilever Shelf', 'max_weight' => 400, 'status' => 'Partially Used'],
                ];
            }

            case 'digital_twin':
                return [
                    ['name' => 'Pune Main — 3D View',         'status' => 'Active'],
                    ['name' => 'Mumbai Hub — 3D View',        'status' => 'Active'],
                    ['name' => 'Nashik — Floor Map',          'status' => 'Active'],
                    ['name' => 'Nagpur — Layout',             'status' => 'Active'],
                    ['name' => 'Delhi NCR — Digital Twin',    'status' => 'Active'],
                    ['name' => 'Bangalore South — Heatmap',   'status' => 'Active'],
                    ['name' => 'Chennai Port — Live View',    'status' => 'Active'],
                    ['name' => 'Kolkata East — Overview',     'status' => 'Active'],
                    ['name' => 'Ahmedabad West — 3D View',    'status' => 'Active'],
                    ['name' => 'Hyderabad Central — Twin',    'status' => 'Active'],
                ];

            case 'freezers': {
                $wh = fn (string $n) => $this->refIdByField($MODELS, 'warehouse_master', 'wh_name', $n);
                return [
                    ['name' => 'Freezer Alpha',    'warehouse' => $wh('Pune Main'),        'capacity' => 200, 'status' => 'Active'],
                    ['name' => 'Freezer Beta',     'warehouse' => $wh('Pune Main'),        'capacity' => 150, 'status' => 'Active'],
                    ['name' => 'Cold Zone A',      'warehouse' => $wh('Mumbai Hub'),       'capacity' => 300, 'status' => 'Active'],
                    ['name' => 'Cold Zone B',      'warehouse' => $wh('Mumbai Hub'),       'capacity' => 300, 'status' => 'Active'],
                    ['name' => 'Freezer Gamma',    'warehouse' => $wh('Nashik'),           'capacity' => 100, 'status' => 'Active'],
                    ['name' => 'Freezer Delta',    'warehouse' => $wh('Delhi NCR'),        'capacity' => 250, 'status' => 'Active'],
                    ['name' => 'Freezer Epsilon',  'warehouse' => $wh('Bangalore South'),  'capacity' => 180, 'status' => 'Active'],
                    ['name' => 'Cold Zone C',      'warehouse' => $wh('Chennai Port'),     'capacity' => 220, 'status' => 'Active'],
                    ['name' => 'Cold Zone D',      'warehouse' => $wh('Ahmedabad West'),   'capacity' => 200, 'status' => 'Active'],
                    ['name' => 'Freezer Zeta',     'warehouse' => $wh('Hyderabad Central'),'capacity' => 160, 'status' => 'Active'],
                ];
            }

            default:
                return [];
        }
    }
}

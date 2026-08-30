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
 * Re-seed is IDEMPOTENT and ID-STABLE:
 *
 *   - Each row is identified by its NAME within the (admin-owned, client=null,
 *     branch=null) scope and upserted via DB::updateOrInsert.
 *   - Existing rows KEEP THEIR IDs across re-seeds. This is critical because
 *     employee.department_id, recruitment.department_id, candidate.* etc all
 *     store integer FKs pointing into these masters. Wiping + reinserting
 *     would reassign auto-increment IDs and silently corrupt every record
 *     that references them.
 *   - New rows (defined here but absent in DB) are inserted.
 *   - Rows present in DB but no longer in this file are LEFT ALONE — they
 *     may be referenced by user data. Operator can delete them manually if
 *     they're truly obsolete.
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
        /* hsn_codes used to be ordered after gst_percentage, because it seeded
           a gst_rate_id looked up out of that master. The GST rate has been
           dropped from the HSN master (the rate lives on the product), so the
           two are independent again and no reordering is needed. */

        // countries + states are owned by GeographySeeder (full ISO dataset).
        // Skip them here so we don't wipe + re-seed with the older small sample.
        //
        // `segments` maps to the unified `clm_segments` table, which is
        // TENANT-scoped: client_id is NOT NULL and code/regulatory_status/
        // buyer_consignee are required + auto-filled only by the Segments model
        // hook (this seeder uses the raw query builder, which bypasses it). A
        // global null-client row therefore violates the NOT NULL constraint
        // (23502). CLM segments are created per-client at runtime by
        // ClmSegmentController, so we don't seed them here.
        $ownedElsewhere = ['countries', 'states', 'segments'];

        // Walk masters in dependency-safe order so ref columns (e.g. states -> countries)
        // always find the referenced row already present.
        foreach ($order as $slug) {
            if (in_array($slug, $ownedElsewhere, true)) {
                continue;
            }
            $modelClass = $MODELS[$slug];
            $table = (new $modelClass)->getTable();

            $rows = $this->dataFor($slug, $MODELS);
            if (empty($rows)) {
                $this->command->info(sprintf('skip   %-28s (no real-data definition)', $slug));
                continue;
            }

            // Pick the natural-key column to identify rows for idempotent
            // upsert. Most masters use `name`; a few use `code`/`title`/etc.
            // We probe in priority order and fall back to `name`.
            // Per-slug natural-key overrides for masters whose unique column
            // isn't 'name'/'title'/'code'. Without this gst_percentage would
            // fall through to array_key_first() and key on whatever the row's
            // first column happens to be (status), causing every re-seed to
            // collide and update the same single row.
            $perSlugKey = [
                'gst_percentage' => 'percentage',
                'overtime_rates' => 'rate_name',
            ];
            $keyColumn = $perSlugKey[$slug] ?? $this->resolveNaturalKey($table, $rows[0]);

            $now = now();
            $inserted = 0;
            $updated  = 0;

            foreach ($rows as $row) {
                if (!array_key_exists($keyColumn, $row)) {
                    // Defensive: row missing the natural key — skip to avoid
                    // colliding with random first-row insert. Surfaces as a
                    // log line so the operator sees it.
                    $this->command->warn(sprintf("  %s: row missing '%s' — skipped", $slug, $keyColumn));
                    continue;
                }

                // updateOrInsert PRESERVES the existing row's id. This is the
                // whole point of the fix — see the docblock at top of file.
                $matchedExisting = DB::table($table)
                    ->where($keyColumn, $row[$keyColumn])
                    ->where('created_by', $adminId)
                    ->whereNull('client_id')
                    ->whereNull('branch_id')
                    ->exists();

                $values = array_merge($row, [

                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_by' => $adminId,
                    'updated_at' => $now,
                ]);
                if (!$matchedExisting) {
                    $values['created_at'] = $now;
                }

                DB::table($table)->updateOrInsert(
                    [
                        $keyColumn   => $row[$keyColumn],
                        'created_by' => $adminId,
                        'client_id'  => null,
                        'branch_id'  => null,
                    ],
                    $values
                );

                if ($matchedExisting) $updated++;
                else $inserted++;
            }

            $this->command->info(sprintf(
                'upsert %-28s +%d new, %d updated (key=%s)',
                $slug,
                $inserted,
                $updated,
                $keyColumn
            ));

            // ── Authoritative prune for designations ──
            // The designations master is a fixed org hierarchy — any row NOT in
            // the canonical list is removed so the table holds exactly the
            // seeded set. Null out every reference (employees + recruitments)
            // to a pruned row first so the designation_id FK never dangles.
            if ($slug === 'designations') {
                $keepNames = array_column($rows, 'name');
                $stale = DB::table($table)->whereNotIn('name', $keepNames)->pluck('id')->all();
                if (!empty($stale)) {
                    $empCleared = DB::table('employees')->whereIn('designation_id', $stale)->update(['designation_id' => null]);
                    $recCleared = DB::table('recruitments')->whereIn('designation_id', $stale)->update(['designation_id' => null]);
                    $removed = DB::table($table)->whereIn('id', $stale)->delete();
                    $this->command->info(sprintf(
                        'prune  %-28s -%d removed (refs cleared: %d employees, %d recruitments)',
                        $slug,
                        $removed,
                        $empCleared,
                        $recCleared
                    ));
                }

                // Stamp a stable code derived from the DB id → DES-001, DES-002…
                // so the Code column reflects each designation's row id.
                foreach (DB::table($table)->get(['id']) as $r) {
                    DB::table($table)->where('id', $r->id)->update([
                        'code' => 'DES-' . str_pad((string) $r->id, 3, '0', STR_PAD_LEFT),
                    ]);
                }
                $this->command->info('stamp  designations               codes set (DES-<id>)');
            }
        }
    }

    /**
     * Pick the most-likely natural-key column for a master. Used to identify
     * existing rows so re-seed updates instead of inserts duplicates.
     *
     * Most masters have `name`. A handful (state_codes, hsn_codes) use `code`.
     * We probe both the table schema and the seed row to pick safely.
     */
    private function resolveNaturalKey(string $table, array $sampleRow): string
    {
        // Order matters — first match wins. Pre-existing rows from this file
        // mostly use `name`, so we try that first.
        foreach (['name', 'title', 'code', 'slug', 'key'] as $candidate) {
            if (array_key_exists($candidate, $sampleRow) && \Illuminate\Support\Facades\Schema::hasColumn($table, $candidate)) {
                return $candidate;
            }
        }
        // Last-ditch fallback: use whatever the seed row's first key is.
        return array_key_first($sampleRow);
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
                return [];

            case 'bank_accounts':
                return [
                    ['bank_name' => 'State Bank of India',       'account_holder' => 'Inorbvict Healthcare India Pvt Ltd', 'account_number' => '30123456789012', 'ifsc_code' => 'SBIN0000691', 'branch_name' => 'New Delhi Main Branch', 'city' => 'New Delhi', 'swift_code' => 'SBININBB104', 'ad_code' => '0510573', 'is_primary' => 'Yes', 'status' => 'Active'],
                    ['bank_name' => 'HDFC Bank',                 'account_holder' => 'Bharat Agro Exports Pvt Ltd',        'account_number' => '50100123456789', 'ifsc_code' => 'HDFC0000001', 'branch_name' => 'Fort Branch',           'city' => 'Mumbai',    'swift_code' => 'HDFCINBB',    'ad_code' => '0234511', 'is_primary' => 'Yes', 'status' => 'Active'],
                ];

            case 'departments':
                return [
                    ['name' => 'Sales',            'code' => 'DEPT-001', 'head' => 'Durgesh Urkude', 'email' => 'sales@enterprise.com',     'description' => 'Revenue generation, client relations, order management',         'status' => 'Active'],
                    ['name' => 'Human Resources',  'code' => 'DEPT-002', 'head' => 'Sonal Pawar',    'email' => 'hr@enterprise.com',        'description' => 'Recruitment, employee records, payroll, compliance',             'status' => 'Active'],
                    ['name' => 'Accounts',         'code' => 'DEPT-003', 'head' => 'Priti Shende',   'email' => 'accounts@enterprise.com',  'description' => 'Financial transactions, ledgers, GST, audit',                    'status' => 'Active'],
                    ['name' => 'Logistics',        'code' => 'DEPT-004', 'head' => 'Sandeep Kadu',   'email' => 'logistics@enterprise.com', 'description' => 'Transportation, shipment coordination, freight management',      'status' => 'Active'],
                    ['name' => 'Purchase',         'code' => 'DEPT-005', 'head' => 'Ankit Bhosale',  'email' => 'purchase@enterprise.com',  'description' => 'Procurement, vendor management, purchase orders',                'status' => 'Active'],
                    ['name' => 'IT',               'code' => 'DEPT-006', 'head' => 'Gaurav Jagtap',  'email' => 'it@enterprise.com',        'description' => 'Infrastructure, system maintenance, application support',        'status' => 'Active'],
                    ['name' => 'Legal',            'code' => 'DEPT-007', 'head' => null,             'email' => null,                       'description' => 'Contract review, compliance, documentation',                     'status' => 'Active'],
                    ['name' => 'Warehouse',        'code' => 'DEPT-008', 'head' => 'Manoj Gawade',   'email' => 'warehouse@enterprise.com', 'description' => 'Inventory storage, stock management, goods receipt',             'status' => 'Active'],
                    ['name' => 'Quality Control',  'code' => 'DEPT-009', 'head' => 'Atharv Patekar', 'email' => null,                       'description' => 'Product inspection, quality assurance, testing',                  'status' => 'Active'],
                    ['name' => 'Export-Import',    'code' => 'DEPT-010', 'head' => 'Kiran Patel',    'email' => 'exim@enterprise.com',      'description' => 'Customs clearance, shipping documents, trade compliance',        'status' => 'Active'],
                ];

            case 'roles':
                return [
                    ['name' => 'Admin',             'status' => 'Active'],
                ];

            case 'designations':
                return [
                    ['name' => 'Head of Department (HOD)',  'level' => 'Head of Department (HOD)',  'description' => 'Department head, reports to the Branch Director (Branch User)', 'status' => 'Active'],
                    ['name' => 'Team Leader',               'level' => 'Team Leader',               'description' => 'Leads a team, reports to the HOD',               'status' => 'Active'],
                    ['name' => 'Executive',                 'level' => 'Executive',                 'description' => 'Individual contributor, reports to Team Leader', 'status' => 'Active'],
                    ['name' => 'Employee',                  'level' => 'Employee',                  'description' => 'Standard employee',                             'status' => 'Active'],
                    ['name' => 'Intern / Trainee',          'level' => 'Intern / Trainee',          'description' => 'Trainee / intern',                              'status' => 'Active'],
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
                // Owned by migration 2026_05_19_000002_promote_three_fixed_address_types.
                // That migration seeds the only three address types the
                // product needs (Registered Office, Warehouse, Billing
                // Address) as `is_system = true` global rows, and a
                // companion cleanup migration drops every other global
                // row. Letting this seeder re-insert the old long list
                // would just undo the migration on every `db:seed`.
                // Returning [] makes MasterDataSeeder skip the slug
                // (see the empty-rows guard at line 75).
                return [];

            case 'port_of_loading':
                /* Indian sea ports + air cargo complexes actually used on export
                   documents. Codes follow ICEGATE: the plain UN/LOCODE where it is
                   free, and the customs suffix where two facilities share a city
                   (sea = 1, air cargo = 4). Mumbai and Chennai each have BOTH a sea
                   port and an air cargo complex, so they cannot both hold the bare
                   INBOM / INMAA code — `port_of_loading` enforces uEach on name AND
                   code (MasterController), so a collision would fail the save. */
                return [
                    // ── Sea ports ──
                    ['name' => 'Nhava Sheva / JNPT',    'code' => 'INNSA1', 'address' => 'Jawaharlal Nehru Port, Nhava Sheva, Navi Mumbai - 400707',   'status' => 'Active'],
                    ['name' => 'Mundra Port',           'code' => 'INMUN',  'address' => 'Mundra, Kutch, Gujarat - 370421',                            'status' => 'Active'],
                    ['name' => 'Chennai Port',          'code' => 'INMAA',  'address' => 'Rajaji Salai, Chennai, Tamil Nadu - 600001',                 'status' => 'Active'],
                    ['name' => 'Kolkata Port',          'code' => 'INCCU',  'address' => 'Syama Prasad Mookerjee Port, Kolkata, West Bengal - 700043', 'status' => 'Active'],
                    ['name' => 'Cochin Port',           'code' => 'INCOK',  'address' => 'Willingdon Island, Kochi, Kerala - 682009',                  'status' => 'Active'],
                    ['name' => 'Kandla Port',           'code' => 'INIXY',  'address' => 'Deendayal Port, Kandla, Gujarat - 370210',                   'status' => 'Active'],
                    ['name' => 'Visakhapatnam Port',    'code' => 'INVTZ',  'address' => 'Port Area, Visakhapatnam, Andhra Pradesh - 530035',          'status' => 'Active'],
                    ['name' => 'Mumbai Port',           'code' => 'INBOM1', 'address' => 'Mumbai Port Trust, Shoorji Vallabhdas Marg, Mumbai - 400001', 'status' => 'Active'],

                    // ── Air cargo complexes ──
                    ['name' => 'Delhi Air Cargo',       'code' => 'INDEL',  'address' => 'IGI Airport Cargo Terminal, New Delhi - 110037',             'status' => 'Active'],
                    ['name' => 'Mumbai Air Cargo',      'code' => 'INBOM',  'address' => 'CSMI Airport Air Cargo Complex, Mumbai - 400099',            'status' => 'Active'],
                    ['name' => 'Chennai Air Cargo',     'code' => 'INMAA4', 'address' => 'Chennai Airport Air Cargo Complex, Chennai - 600027',        'status' => 'Active'],
                    ['name' => 'Bengaluru Air Cargo',   'code' => 'INBLR4', 'address' => 'Kempegowda Airport Cargo Terminal, Bengaluru - 560300',      'status' => 'Active'],
                    ['name' => 'Hyderabad Air Cargo',   'code' => 'INHYD',  'address' => 'Rajiv Gandhi Airport Cargo Terminal, Hyderabad - 500409',    'status' => 'Active'],
                ];

            case 'port_of_discharge':
                $cid = fn(string $n) => $this->refIdByField($MODELS, 'countries', 'name', $n);
                return [

                    ['name' => 'Port of Los Angeles',  'code' => 'USLAX', 'country_id' => $cid('United States'),  'city' => 'Los Angeles', 'status' => 'Active'],

                ];

                /* ───────────── TRADE & COMMERCIAL ───────────── */

            case 'segments':
                // Column was renamed `title` → `name` in the
                // consolidate-segments-into-clm migration; data block
                // updated to match so re-seeding doesn't 42703.
                return [];

            case 'hsn_codes':
                /* The GST rate was dropped from this master — the rate lives on
                   the PRODUCT (products.gst_id), which is what the invoices and
                   quotations actually read. `master_hsn_codes.gst_rate_id` still
                   exists and keeps whatever it already held; nothing writes it
                   any more, so the seeder no longer looks a percentage up. */
                return [
                    ['hsn_code' => '08021200', 'description' => 'Almonds — Shelled', 'status' => 'Active'],

                ];

            case 'gst_percentage':
                // `label` was dropped — the master now stores percentage + status only.
                return [

                    ['percentage' => 0,    'status' => 'Active'],
                    ['percentage' => 5,    'status' => 'Active'],

                    ['percentage' => 12,   'status' => 'Active'],
                    ['percentage' => 18,   'status' => 'Active'],
                    ['percentage' => 40,   'status' => 'Active'],
                ];

            case 'overtime_rates':
                // Standard overtime multipliers. `rate_name` is the natural key
                // (see $perSlugKey override in run()). Seeded as global rows
                // (client_id/branch_id NULL) so every tenant sees them in the
                // Employee "Overtime" picker; tenants may add their own too.
                return [
                    ['rate_name' => 'Regular Time',            'multiplier' => 1,    'description' => 'Normal hourly rate',   'status' => 'Active'],
                    ['rate_name' => 'Time and a Half',         'multiplier' => 1.5,  'description' => '150% of hourly rate',  'status' => 'Active'],
                    ['rate_name' => 'Double Time',             'multiplier' => 2,    'description' => '200% of hourly rate',  'status' => 'Active'],
                    ['rate_name' => 'Double Time and a Half',  'multiplier' => 2.5,  'description' => '250% of hourly rate',  'status' => 'Active'],
                    ['rate_name' => 'Triple Time',             'multiplier' => 3,    'description' => '300% of hourly rate',  'status' => 'Active'],
                ];

            case 'currencies':
                return [
                    ['name' => 'Indian Rupee',     'code' => 'INR', 'symbol' => '₹',  'exchange_rate' => 1,       'status' => 'Active'],
                    ['name' => 'US Dollar',        'code' => 'USD', 'symbol' => '$',  'exchange_rate' => 83.50,   'status' => 'Active'],
                    ['name' => 'Euro',             'code' => 'EUR', 'symbol' => '€',  'exchange_rate' => 90.20,   'status' => 'Active'],
                    ['name' => 'British Pound',    'code' => 'GBP', 'symbol' => '£',  'exchange_rate' => 105.00,  'status' => 'Active'],
                    ['name' => 'UAE Dirham',       'code' => 'AED', 'symbol' => 'د.إ', 'exchange_rate' => 22.70,   'status' => 'Active'],
                    ['name' => 'Japanese Yen',     'code' => 'JPY', 'symbol' => '¥',  'exchange_rate' => 0.56,    'status' => 'Active'],
                    ['name' => 'Australian Dollar', 'code' => 'AUD', 'symbol' => 'A$', 'exchange_rate' => 55.40,   'status' => 'Active'],
                    ['name' => 'Canadian Dollar',  'code' => 'CAD', 'symbol' => 'C$', 'exchange_rate' => 61.20,   'status' => 'Active'],
                    ['name' => 'Singapore Dollar', 'code' => 'SGD', 'symbol' => 'S$', 'exchange_rate' => 62.00,   'status' => 'Active'],
                    ['name' => 'Chinese Yuan',     'code' => 'CNY', 'symbol' => '¥',  'exchange_rate' => 11.60,   'status' => 'Active'],
                ];

            case 'uom':
                return [
                    ['title' => 'Kilogram',    'short_code' => 'KG',  'unit_type' => 'Weight', 'status' => 'Active'],
                    ['title' => 'Number',   'short_code' => 'NOS',   'unit_type' => 'Quantity', 'status' => 'Active'],
                    ['title' => 'Kilogram', 'short_code' => 'KG',    'unit_type' => 'Weight',   'status' => 'Active'],
                    ['title' => 'Gram',     'short_code' => 'G',     'unit_type' => 'Weight',   'status' => 'Active'],
                    ['title' => 'Liter',    'short_code' => 'L',     'unit_type' => 'Volume',   'status' => 'Active'],
                    ['title' => 'Milliliter', 'short_code' => 'ML',   'unit_type' => 'Volume',   'status' => 'Active'],
                    ['title' => 'Meter',    'short_code' => 'M',     'unit_type' => 'Length',   'status' => 'Active'],
                    ['title' => 'Centimeter', 'short_code' => 'CM',   'unit_type' => 'Length',   'status' => 'Active'],
                    ['title' => 'Millimeter', 'short_code' => 'MM',   'unit_type' => 'Length',   'status' => 'Active'],
                    ['title' => 'Dozen',    'short_code' => 'DOZEN', 'unit_type' => 'Quantity', 'status' => 'Active'],

                ];

            case 'packaging_material':
                return
                    [
                        ['title' => 'Corrugated Box',   'material_type' => 'Box',       'status' => 'Active'],
                        ['title' => 'Carton Box',       'material_type' => 'Box',       'status' => 'Active'],
                        ['title' => 'Wooden Crate',     'material_type' => 'Crate',     'status' => 'Active'],
                        ['title' => 'Wooden Pallet',    'material_type' => 'Pallet',    'status' => 'Active'],
                        ['title' => 'Plastic Pallet',   'material_type' => 'Pallet',    'status' => 'Active'],
                        ['title' => 'Plastic Box',      'material_type' => 'Box',       'status' => 'Active'],
                        ['title' => 'Plastic Container', 'material_type' => 'Container', 'status' => 'Active'],
                        ['title' => 'Glass Bottle',     'material_type' => 'Bottle',    'status' => 'Active'],
                        ['title' => 'Glass Vial',       'material_type' => 'Vial',      'status' => 'Active'],
                        ['title' => 'HDPE Bottle',      'material_type' => 'Bottle',    'status' => 'Active'],
                        ['title' => 'LDPE Bag',         'material_type' => 'Bag',       'status' => 'Active'],
                        ['title' => 'Poly Bag',         'material_type' => 'Bag',       'status' => 'Active'],
                        ['title' => 'Bubble Wrap',      'material_type' => 'Wrap',      'status' => 'Active'],
                        ['title' => 'Foam',             'material_type' => 'Protective', 'status' => 'Active'],
                        ['title' => 'Thermocol',        'material_type' => 'Protective', 'status' => 'Active'],
                        ['title' => 'Shrink Wrap',      'material_type' => 'Wrap',      'status' => 'Active'],
                        ['title' => 'Vacuum Pack',      'material_type' => 'Pack',      'status' => 'Active'],
                        ['title' => 'Drum',             'material_type' => 'Drum',      'status' => 'Active'],
                        ['title' => 'Can',              'material_type' => 'Can',       'status' => 'Active'],
                        ['title' => 'Tube',             'material_type' => 'Tube',      'status' => 'Active'],
                    ];
            case 'conditions':
                return [

                    ['title' => 'Fresh',       'status' => 'Active'],
                ];

            case 'incoterms':
                return [
                    ['code' => 'EXW', 'full_name' => 'Ex Works',                    'transport_mode' => 'Any Mode',             'status' => 'Active'],

                    ['code' => 'FOB', 'full_name' => 'Free On Board',               'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],

                    ['code' => 'CIF', 'full_name' => 'Cost, Insurance and Freight', 'transport_mode' => 'Sea/Inland Waterway',  'status' => 'Active'],
                    ['code' => 'C&F', 'full_name' => 'Cost and Freight',            'transport_mode' => 'Any Mode',             'status' => 'Active'],

                ];

                /* ───────────── PARTY & CLASSIFICATION ───────────── */

            case 'customer_types':
                // Owned by migration 2026_05_19_000004_seed_fixed_customer_types.
                // That migration seeds the only two Customer Consignee
                // Types the product needs (Retailer, Wholesaler) as
                // `is_system = true` global rows, and a cleanup step
                // drops every other global row. Returning an empty
                // array makes MasterDataSeeder skip the slug (see the
                // empty-rows guard near line 75).
                return [];

            case 'customer_classifications':
                // Owned by migration 2026_05_19_000006_seed_fixed_customer_classifications.
                // That migration seeds Standard and VIP as `is_system = true`
                // global rows and drops every other global row. Returning
                // empty makes MasterDataSeeder skip the slug.
                return [];

            case 'vendor_types':
                return [];

            case 'vendor_behaviour':
                return [];

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
                return [];

            case 'risk_levels':
                // Owned by migration 2026_05_19_000005_seed_fixed_risk_levels.
                // That migration seeds Low and High as `is_system = true`
                // global rows and drops every other global row. Returning
                // empty makes MasterDataSeeder skip the slug.
                return [];

            case 'document_type':
                return [];

            case 'haz_class':
                // haz_code + packing_group columns were dropped — master is
                // simplified to just name + status (see migration
                // 2026_05_19_000010_simplify_master_haz_class).
                return [
                    ['name' => 'Non-Hazardous',                         'status' => 'Active'],
                    ['name' => 'Explosives',                            'status' => 'Active'],
                    ['name' => 'Gases',                                 'status' => 'Active'],
                    ['name' => 'Flammable Liquids',                     'status' => 'Active'],
                    ['name' => 'Flammable Solids',                      'status' => 'Active'],
                    ['name' => 'Oxidizing Substances',                  'status' => 'Active'],
                    ['name' => 'Toxic & Infectious Substances',         'status' => 'Active'],
                    ['name' => 'Radioactive Material',                  'status' => 'Active'],
                    ['name' => 'Corrosive Substances',                  'status' => 'Active'],
                    ['name' => 'Miscellaneous Dangerous Goods',          'status' => 'Active'],
                ];

            case 'compliance_behaviours':
                return [
                    ['name' => 'Compliant',               'action_required' => 'None',                           'status' => 'Active'],
                    ['name' => 'Non-Compliant',           'action_required' => 'Issue correction notice',        'status' => 'Active'],

                ];

                /* ───────────── OPERATIONS & SUPPORT ───────────── */

            case 'asset_categories':
                // Seed this BEFORE `assets` so assets can reference category ids.
                return [
                    ['name' => 'Laptop',              'depreciation_rate' => 33.33, 'useful_life_years' => 3,  'status' => 'Active'],

                ];

            case 'assets':
                $catByName = fn(string $n) => $this->refIdByField($MODELS, 'asset_categories', 'name', $n);
                return [
                    ['asset_name' => 'HP EliteBook 840 G9',     'asset_number' => 'A-LT-001', 'asset_type_id' => $catByName('Laptop'),            'assign_date' => now()->subDays(10)->format('Y-m-d'), 'status' => 'Active'],

                ];

                /* ───────────── P2P MASTERS ───────────── */

            case 'payment_terms':
                return [];

            case 'approval_authority':
                return [];

            case 'procurement_category':
                return [
                    ['cat_code' => 'LIC',  'cat_name' => 'License / Subscription',       'match_logic' => '2-Way Match (PO+VTI)',        'grn_required' => 'No',                          'gst_applicable' => 'Reverse Charge', 'status' => 'Active'],
                ];

            case 'sourcing_type':
                return [
                    ['type_code' => 'DIR',  'type_name' => 'Direct Purchase',      'quotation_required' => 'Mandatory — Min 1 Quote',  'approval_required' => 'Yes', 'urgency_flag' => 'Normal',    'status' => 'Active'],
                ];

            case 'deviation_reason':
                return [
                    ['reason_code' => 'RATE-REV',  'reason_name' => 'Rate Revised Post Negotiation',       'module' => 'Purchase Order',    'attachment_required' => 'Yes', 'requires_approval' => 'Yes', 'status' => 'Active'],
                ];

            case 'match_exception':
                return [];

            case 'advance_payment_rules':
                return [];

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
                ];

            case 'vendor_directory':

                return [];

                /* ───────────── WAREHOUSE MASTERS ───────────── */

            case 'warehouse_master':
                return [];

            case 'zone_master':
                return [];

            case 'rack_type_master':
                return [];

            case 'temp_class_master':
                return [];

            case 'racks': {
                    return [];
                }

            case 'shelf_master': {
                    return [];
                }

            case 'digital_twin':
                return [];

            case 'freezers': {
                    return [];
                }

            default:
                return [];
        }
    }
}

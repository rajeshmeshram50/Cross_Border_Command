<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Five international suppliers, one per country, for testing the Zoho Books
 * currency rules on a purchase order.
 *
 * The tenant had exactly one supplier outside India, so the only currency path
 * anyone could exercise was that supplier's — a domestic supplier has its
 * currency forced to INR and never shows the field at all.
 *
 * Singapore is deliberate: SGD sits in our currency master but is NOT enabled in
 * the Zoho org, so that supplier is the one to test the "currency not in Zoho
 * Books" notice with. The other four use currencies Zoho has.
 *
 * Re-runnable: a supplier already carrying its code is left exactly as it is.
 */
class InternationalSupplierSeeder extends Seeder
{
    /** Material / Goods — the type a Material / Goods purchase order requires. */
    private const VENDOR_TYPE = 'Material / Goods';
    private const RISK_LEVEL  = 'Low';

    public function run(): void
    {
        $clientId = (int) (DB::table('clients')->orderBy('id')->value('id') ?? 0);
        if (!$clientId) {
            $this->command?->warn('No client — nothing to seed against.');
            return;
        }
        /* The branch the tenant's existing suppliers actually sit in, not simply
           the first one. Vendors are branch-scoped, so a supplier seeded into a
           branch nobody works in never reaches the purchase-order dropdown. */
        $branchId = DB::table('vendors')
            ->where('client_id', $clientId)->whereNull('deleted_at')->whereNotNull('branch_id')
            ->select('branch_id')->selectRaw('count(*) as n')
            ->groupBy('branch_id')->orderByDesc('n')->value('branch_id')
            ?? DB::table('branches')->where('client_id', $clientId)->orderBy('id')->value('id');

        $typeId = DB::table('master_vendor_types')->where('name', self::VENDOR_TYPE)->value('id');
        $riskId = DB::table('master_risk_levels')->where('name', self::RISK_LEVEL)->value('id');

        /* Segments that actually hold products, so Stage 02 has something to
           order. A supplier mapped to an empty segment stalls the whole PO. */
        $segments = DB::table('products')
            ->where('client_id', $clientId)->whereNull('deleted_at')->whereNotNull('segment_id')
            ->distinct()->pluck('segment_id')->map(fn ($id) => (int) $id)->take(3)->values()->all();

        foreach ($this->suppliers() as $s) {
            if (DB::table('vendors')->where('vendor_code', $s['code'])->exists()) {
                $this->command?->line("  {$s['code']} {$s['company']} — already there, left alone");
                continue;
            }

            $countryId = DB::table('master_countries')->whereRaw('LOWER(name) = ?', [strtolower($s['country'])])->value('id');
            if (!$countryId) {
                $this->command?->warn("  {$s['country']} is not in master_countries — {$s['code']} skipped");
                continue;
            }

            $vendorId = DB::table('vendors')->insertGetId([
                'client_id'         => $clientId,
                'branch_id'         => $branchId,
                'vendor_code'       => $s['code'],
                'company_name'      => $s['company'],
                'legal_name'        => $s['legal'],
                'vendor_type_id'    => $typeId,
                'risk_level_id'     => $riskId,
                'supplier_category' => 'general',
                'segment_id'        => $segments[0] ?? null,
                'status'            => 'active',
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);

            DB::table('vendor_addresses')->insert([
                'vendor_id'        => $vendorId,
                'address_line'     => $s['address'],
                'country_id'       => $countryId,
                'city'             => $s['city'],
                'contact_name'     => $s['contact'],
                'designation'      => 'Export Manager',
                'contact_no'       => $s['phone'],
                'email'            => $s['email'],
                'is_primary'       => true,
                'address_type'     => 'Registered Office',
                'whatsapp_enabled' => false,
                'created_at'       => now(),
                'updated_at'       => now(),
            ]);

            foreach ($segments as $segmentId) {
                DB::table('vendor_segments')->insert([
                    'vendor_id' => $vendorId, 'segment_id' => $segmentId,
                ]);
            }

            $this->command?->info("  {$s['code']} {$s['company']} · {$s['country']} · test with {$s['currency']}");
        }
    }

    /**
     * @return array<int, array{code:string,company:string,legal:string,country:string,city:string,
     *     address:string,contact:string,phone:string,email:string,currency:string}>
     */
    private function suppliers(): array
    {
        return [
            [
                'code' => 'S-101', 'company' => 'Atlantic Grain Traders LLC', 'legal' => 'Atlantic Grain Traders LLC',
                'country' => 'United States', 'city' => 'Houston',
                'address' => '1200 Smith Street, Suite 1600, Houston, TX 77002',
                'contact' => 'Daniel Reyes', 'phone' => '17135550142', 'email' => 'daniel.reyes@mailinator.com',
                'currency' => 'USD',
            ],
            [
                'code' => 'S-102', 'company' => 'Shandong Hengyuan Chemical Co', 'legal' => 'Shandong Hengyuan Chemical Co Ltd',
                'country' => 'China', 'city' => 'Qingdao',
                'address' => 'No. 88 Hong Kong East Road, Laoshan District, Qingdao, Shandong 266061',
                'contact' => 'Li Wei', 'phone' => '8653255510088', 'email' => 'li.wei@mailinator.com',
                'currency' => 'CNY',
            ],
            [
                'code' => 'S-103', 'company' => 'Rheinland Pharma GmbH', 'legal' => 'Rheinland Pharma GmbH',
                'country' => 'Germany', 'city' => 'Cologne',
                'address' => 'Industriestrasse 45, 50996 Koln, Nordrhein-Westfalen',
                'contact' => 'Anke Brandt', 'phone' => '4922155501790', 'email' => 'anke.brandt@mailinator.com',
                'currency' => 'EUR',
            ],
            [
                'code' => 'S-104', 'company' => 'Gulf Commodities FZE', 'legal' => 'Gulf Commodities FZE',
                'country' => 'United Arab Emirates', 'city' => 'Dubai',
                'address' => 'Office 304, Jebel Ali Free Zone, PO Box 17999, Dubai',
                'contact' => 'Omar Al Farsi', 'phone' => '97145550311', 'email' => 'omar.alfarsi@mailinator.com',
                'currency' => 'AED',
            ],
            [
                // SGD is in our master list but NOT enabled in Zoho — the notice case.
                'code' => 'S-105', 'company' => 'Straits Agri Pte Ltd', 'legal' => 'Straits Agri Pte Ltd',
                'country' => 'Singapore', 'city' => 'Singapore',
                'address' => '8 Marina Boulevard, Level 11, Marina Bay Financial Centre, Singapore 018981',
                'contact' => 'Tan Wei Ming', 'phone' => '6565550920', 'email' => 'tan.weiming@mailinator.com',
                'currency' => 'SGD — not enabled in Zoho, use for the notice',
            ],
        ];
    }
}

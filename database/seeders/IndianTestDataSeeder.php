<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

/**
 * One-off QA fixture: 20 customers, 20 consignees, 20 products and
 * 20 vendors (suppliers) of realistic Indian export/import data for the
 * IGC GROUP tenant (client_id = 1, main branch Healthcare = 2,
 * owned by the QA user rajeshmeshram = user id 3).
 *
 * Codes are allocated exactly the way the controllers do:
 *   customer_code  C-### (zero-padded id)
 *   consignee_code CN-### (zero-padded id)
 *   product_code   P-## (per-client max + 1)
 *   vendor_code    V-## (per-client max + 1)
 *
 * Run: php artisan db:seed --class=IndianTestDataSeeder
 */
class IndianTestDataSeeder extends Seeder
{
    private int $clientId = 1;
    private int $branchId = 2;   // Healthcare (main branch)
    private int $createdBy = 3;  // rajeshmeshram (branch_user on main branch)

    public function run(): void
    {
        $now = Carbon::now();

        // Idempotency guard — this fixture inserts a fixed list of 20
        // customers/consignees/products/vendors, so re-running it would
        // DUPLICATE them. If the first marker row already exists for this
        // tenant, treat the fixture as already seeded and skip. To re-seed
        // from scratch, clear the tenant's rows first.
        $already = DB::table('customers')
            ->where('client_id', $this->clientId)
            ->where('company_name', 'Rajdhani Agro Exports Pvt Ltd')
            ->exists();
        if ($already) {
            $this->command?->warn('IndianTestDataSeeder: fixture already seeded for this tenant — skipping (re-run safe).');
            return;
        }

        DB::transaction(function () use ($now) {
            $customerIds = $this->seedCustomers($now);
            $this->seedConsignees($now, $customerIds);
            $this->seedProducts($now);
            $this->seedVendors($now);
        });
    }

    /* ───────────────────────── CUSTOMERS ───────────────────────── */
    private function seedCustomers(Carbon $now): array
    {
        $rows = [
            ['Rajdhani Agro Exports Pvt Ltd', 'Food & Agro', 'Exporter', 'A', 'Low', 'New Delhi', 'Delhi', '110044', 'Plot 14, Okhla Industrial Estate Phase II', 'Anil Khurana', 'Export Manager'],
            ['Konkan Spices & Foods Pvt Ltd', 'Food & Agro', 'Exporter', 'A', 'Low', 'Mumbai', 'Maharashtra', '400072', 'Unit 7, MIDC Andheri East', 'Sneha Kamat', 'Director'],
            ['Surya Pharma Labs Pvt Ltd', 'Pharma', 'Exporter', 'A', 'Medium', 'Hyderabad', 'Telangana', '500032', 'Genome Valley, Shameerpet', 'Dr. Ravi Teja', 'GM Exports'],
            ['Gujarat Cotton Mills Ltd', 'Textile', 'Exporter', 'A', 'Low', 'Ahmedabad', 'Gujarat', '380015', 'Naroda GIDC, Phase 1', 'Hiren Patel', 'Sales Head'],
            ['Deccan Chemicals Pvt Ltd', 'Chemicals', 'Wholesaler', 'B', 'Medium', 'Pune', 'Maharashtra', '411026', 'D-22, Bhosari Industrial Area', 'Prashant Joshi', 'Procurement Lead'],
            ['Coromandel Marine Exports', 'Food & Agro', 'Exporter', 'A', 'Medium', 'Visakhapatnam', 'Andhra Pradesh', '530035', 'Fishing Harbour Road, Pedagantyada', 'Lakshmi Naidu', 'Export Executive'],
            ['Himalaya Basmati Rice Co', 'Food & Agro', 'Exporter', 'A', 'Low', 'Karnal', 'Haryana', '132001', 'Grain Market, Sector 12', 'Gurpreet Singh', 'Proprietor'],
            ['Madras Engineering Works Pvt Ltd', 'Metal & Mining', 'Wholesaler', 'B', 'Medium', 'Chennai', 'Tamil Nadu', '600058', 'Ambattur Industrial Estate', 'Karthik Subramaniam', 'Purchase Manager'],
            ['Rajasthan Minerals & Metals Ltd', 'Metal & Mining', 'Exporter', 'B', 'High', 'Jaipur', 'Rajasthan', '302013', 'Sitapura Industrial Area', 'Mahendra Sharma', 'Director'],
            ['Kerala Spice Board Traders', 'Food & Agro', 'Wholesaler', 'A', 'Low', 'Kochi', 'Kerala', '682016', 'Jew Town, Mattancherry', 'Thomas Varghese', 'Partner'],
            ['Punjab Agro Foods Ltd', 'Food & Agro', 'Exporter', 'A', 'Low', 'Ludhiana', 'Punjab', '141003', 'Focal Point, Phase 5', 'Harjit Kaur', 'Export Manager'],
            ['Bengal Tea Exporters Pvt Ltd', 'Food & Agro', 'Exporter', 'A', 'Low', 'Kolkata', 'West Bengal', '700017', '15 Camac Street', 'Soumitra Banerjee', 'Sr. Manager'],
            ['Indore Soya Products Ltd', 'Food & Agro', 'Wholesaler', 'B', 'Low', 'Indore', 'Madhya Pradesh', '452015', 'Pithampur Sector 3', 'Neha Agrawal', 'Operations Head'],
            ['Nagpur Citrus Exports', 'Food & Agro', 'Exporter', 'B', 'Medium', 'Nagpur', 'Maharashtra', '440016', 'MIDC Hingna Road', 'Rohit Deshmukh', 'Proprietor'],
            ['Vadodara Pharma Chem Ltd', 'Pharma', 'Exporter', 'A', 'Medium', 'Vadodara', 'Gujarat', '390010', 'Makarpura GIDC', 'Dr. Falguni Shah', 'AGM Exports'],
            ['Tirupur Knitwear Exports', 'Textile', 'Exporter', 'A', 'Low', 'Tirupur', 'Tamil Nadu', '641604', 'Avinashi Road, Mannarai', 'Senthil Kumar', 'Export Director'],
            ['Goa Cashew Industries Pvt Ltd', 'Food & Agro', 'Exporter', 'B', 'Low', 'Panaji', 'Goa', '403001', 'Kundaim Industrial Estate', 'Maria Fernandes', 'Manager'],
            ['Jodhpur Handicrafts Exports', 'Textile', 'Exporter', 'B', 'Medium', 'Jodhpur', 'Rajasthan', '342005', 'Basni Industrial Area Phase 2', 'Vikram Rathore', 'Owner'],
            ['Mangalore Cashew & Coir Co', 'Food & Agro', 'Wholesaler', 'B', 'Low', 'Mangalore', 'Karnataka', '575001', 'Bunder Area, Old Port Road', 'Suresh Shetty', 'Partner'],
            ['Kanpur Leather Exports Pvt Ltd', 'Textile', 'Exporter', 'B', 'High', 'Kanpur', 'Uttar Pradesh', '208010', 'Jajmau Leather Cluster', 'Imran Qureshi', 'Export Manager'],
        ];

        $ids = [];
        foreach ($rows as $i => $r) {
            [$name, $segment, $type, $cls, $risk, $city, $state, $pin, $addr, $cp, $desig] = $r;
            $slug  = $this->slug($name);
            $email = $cp ? ($this->slugName($cp) . '@' . $slug . '.co.in') : null;

            $id = DB::table('customers')->insertGetId([
                'client_id'      => $this->clientId,
                'branch_id'      => $this->branchId,
                'created_by'     => $this->createdBy,
                'company_name'   => $name,
                'legal_name'     => $name,
                'type'           => $type,
                'segment'        => $segment,
                'classification' => $cls,
                'risk_level'     => $risk,
                'website'        => 'https://www.' . $slug . '.co.in',
                'primary_email'  => $email,
                'status'         => 'Active',
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);

            DB::table('customers')->where('id', $id)
                ->update(['customer_code' => 'C-' . str_pad((string) $id, 3, '0', STR_PAD_LEFT)]);

            DB::table('customer_addresses')->insert([
                'customer_id'    => $id,
                'type'           => 'Registered Office',
                'address_line'   => $addr,
                'country'        => 'India',
                'state'          => $state,
                'city'           => $city,
                'pin'            => $pin,
                'cp_name'        => $cp,
                'cp_designation' => $desig,
                'cp_contact'     => $this->mobile($i),
                'cp_email'       => $email,
                'cp_whatsapp'    => 'yes',
                'is_primary'     => true,
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);

            $ids[] = $id;
        }

        return $ids;
    }

    /* ───────────────────────── CONSIGNEES ──────────────────────── */
    private function seedConsignees(Carbon $now, array $customerIds): void
    {
        // Indian recipient firms — CFS / port-warehouse / domestic distributor
        // consignees, one per customer. name, segment, classification, risk,
        // city, state, pin.
        $rows = [
            ['JNPT Logistics & Distribution Pvt Ltd', 'Food & Agro', 'A', 'Low', 'Navi Mumbai', 'Maharashtra', '400707'],
            ['Mundra Port Warehousing Co', 'Food & Agro', 'A', 'Low', 'Mundra', 'Gujarat', '370421'],
            ['Chennai CFS & Cargo Pvt Ltd', 'Pharma', 'A', 'Medium', 'Chennai', 'Tamil Nadu', '600001'],
            ['Tughlakabad ICD Distributors', 'Textile', 'A', 'Low', 'New Delhi', 'Delhi', '110044'],
            ['Kandla Free Trade Warehousing', 'Chemicals', 'B', 'Medium', 'Gandhidham', 'Gujarat', '370201'],
            ['Visakha Container Terminal Traders', 'Food & Agro', 'A', 'Medium', 'Visakhapatnam', 'Andhra Pradesh', '530035'],
            ['Cochin Port Distribution Hub', 'Food & Agro', 'A', 'Low', 'Kochi', 'Kerala', '682003'],
            ['Pipavav Cargo Handlers Pvt Ltd', 'Metal & Mining', 'B', 'Medium', 'Rajula', 'Gujarat', '365560'],
            ['Tuticorin Minerals Warehousing', 'Metal & Mining', 'B', 'High', 'Thoothukudi', 'Tamil Nadu', '628004'],
            ['Nhava Sheva Spice Distributors', 'Food & Agro', 'A', 'Low', 'Navi Mumbai', 'Maharashtra', '400707'],
            ['Kolkata Dock Agro Imports', 'Food & Agro', 'A', 'Low', 'Kolkata', 'West Bengal', '700043'],
            ['Hazira Tea & Beverage Hub', 'Food & Agro', 'A', 'Low', 'Surat', 'Gujarat', '394270'],
            ['Indore ICD Soya Distributors', 'Food & Agro', 'B', 'Low', 'Indore', 'Madhya Pradesh', '452015'],
            ['Nagpur Cargo & Cold Storage', 'Food & Agro', 'B', 'Medium', 'Nagpur', 'Maharashtra', '440016'],
            ['Hyderabad Pharma Logistics Pvt Ltd', 'Pharma', 'A', 'Medium', 'Hyderabad', 'Telangana', '500032'],
            ['Tirupur Garment Distribution Co', 'Textile', 'A', 'Low', 'Tirupur', 'Tamil Nadu', '641604'],
            ['Mormugao Cashew Warehousing', 'Food & Agro', 'B', 'Low', 'Vasco da Gama', 'Goa', '403802'],
            ['Jaipur Handicraft Export House', 'Textile', 'B', 'Medium', 'Jaipur', 'Rajasthan', '302013'],
            ['New Mangalore Port Traders', 'Food & Agro', 'B', 'Low', 'Mangalore', 'Karnataka', '575010'],
            ['Kanpur Leather Goods Depot', 'Textile', 'B', 'High', 'Kanpur', 'Uttar Pradesh', '208010'],
        ];

        foreach ($rows as $i => $r) {
            [$name, $segment, $cls, $risk, $city, $state, $pin] = $r;
            $slug  = $this->slug($name);
            $email = 'purchasing@' . $slug . '.com';
            $customerId = $customerIds[$i % count($customerIds)];

            $id = DB::table('consignees')->insertGetId([
                'client_id'      => $this->clientId,
                'branch_id'      => $this->branchId,
                'created_by'     => $this->createdBy,
                'customer_id'    => $customerId,
                'company_name'   => $name,
                'legal_name'     => $name,
                'segment'        => $segment,
                'classification' => $cls,
                'risk_level'     => $risk,
                'website'        => 'https://www.' . $slug . '.com',
                'primary_email'  => $email,
                'status'         => 'Active',
                'same_as_customer' => false,
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);

            DB::table('consignees')->where('id', $id)
                ->update(['consignee_code' => 'CN-' . str_pad((string) $id, 3, '0', STR_PAD_LEFT)]);

            DB::table('consignee_addresses')->insert([
                'consignee_id'   => $id,
                'type'           => 'Delivery Warehouse',
                'address_line'   => 'Import Logistics Hub, Block ' . ($i + 1),
                'country'        => $this->countryFor($city),
                'state'          => $state,
                'city'           => $city,
                'pin'            => $pin,
                'cp_name'        => 'Import Desk',
                'cp_designation' => 'Procurement Officer',
                'cp_contact'     => $this->mobile($i + 20),
                'cp_email'       => $email,
                'cp_whatsapp'    => 'no',
                'is_primary'     => true,
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);
        }
    }

    /* ───────────────────────── PRODUCTS ────────────────────────── */
    private function seedProducts(Carbon $now): void
    {
        // segment_id: 5 Pharma, 6 Chemicals, 7 Food & Agro, 8 Textile, 9 Metal & Mining
        // uom_id:     13 MT, 11 Kg, 16 LTR    | hsn_id: 12 pharma,13 lithium,14 rice,15 cotton,16 copper
        // gst_id:     12=5%, 13=12%, 14=18%, 15=28%
        $rows = [
            // name, generic, brand, seg, uom, hsn, gst, base_price
            ['Basmati Rice 1121 Steam', 'Long Grain Basmati Rice', 'Rajdhani Gold', 7, 13, 14, 12, 92000],
            ['Turmeric Finger Polished', 'Curcuma Longa', 'Konkan Spice', 7, 11, 14, 12, 145],
            ['Green Cardamom 8mm Bold', 'Elettaria Cardamomum', 'Kerala Aroma', 7, 11, 14, 12, 2400],
            ['Black Pepper Malabar Garbled', 'Piper Nigrum', 'Malabar Coast', 7, 11, 14, 12, 580],
            ['Roasted Cashew Kernels W320', 'Anacardium Occidentale', 'Goa Premium', 7, 11, 14, 12, 760],
            ['Paracetamol API BP/IP', 'Acetaminophen', 'Surya Active', 5, 11, 12, 13, 480],
            ['Metformin Hydrochloride IP', 'Metformin HCl', 'Vadodara Bulk', 5, 11, 12, 13, 320],
            ['Azithromycin USP', 'Azithromycin Dihydrate', 'Surya Active', 5, 11, 12, 13, 9800],
            ['Lithium Carbonate Technical', 'Lithium Carbonate', 'Deccan Chem', 6, 11, 13, 14, 1850],
            ['Sodium Lauryl Sulphate', 'SLS Needles', 'Deccan Chem', 6, 11, 13, 14, 210],
            ['Titanium Dioxide Rutile Grade', 'TiO2', 'Anchor Chem', 6, 11, 13, 14, 290],
            ['Combed Cotton Yarn 40s', 'Cotton Yarn Ne 40', 'Crescent Mills', 8, 11, 15, 12, 285],
            ['Grey Cotton Fabric 60x60', 'Woven Cotton Greige', 'Gujarat Weave', 8, 13, 15, 12, 118000],
            ['Denim Fabric 12 oz Indigo', 'Cotton Denim', 'Tirupur Denim', 8, 13, 15, 12, 165000],
            ['Copper Scrap Birch/Cliff', 'Bare Bright Copper', 'Bharat Metals', 9, 13, 16, 14, 720000],
            ['Aluminium Ingots 99.7%', 'Primary Aluminium', 'Polaris Metal', 9, 13, 16, 14, 215000],
            ['Iron Ore Fines Fe 62%', 'Hematite Fines', 'Rajasthan Min', 9, 13, 16, 14, 9500],
            ['Soybean Meal 48% Protein', 'Defatted Soya Meal', 'Indore Soya', 7, 13, 14, 12, 42000],
            ['Dehydrated White Onion Flakes', 'Dried Onion', 'Punjab Agro', 7, 11, 14, 12, 195],
            ['Psyllium Husk 99% Pure', 'Isabgol Bhusi', 'Rajdhani Gold', 7, 11, 14, 13, 240],
        ];

        // Allocate product codes the way ProductController::nextProductCode does.
        $existing = DB::table('products')->where('client_id', $this->clientId)
            ->pluck('product_code');
        $max = 0;
        foreach ($existing as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        foreach ($rows as $r) {
            [$name, $generic, $brand, $seg, $uom, $hsn, $gst, $base] = $r;
            $max++;
            $gstPct = [12 => 5, 13 => 12, 14 => 18, 15 => 28][$gst];
            $gstAmt = round($base * $gstPct / 100, 2);

            DB::table('products')->insert([
                'client_id'    => $this->clientId,
                'branch_id'    => $this->branchId,
                'created_by'   => $this->createdBy,
                'product_code' => 'P-' . str_pad((string) $max, 2, '0', STR_PAD_LEFT),
                'name'         => $name,
                'generic_name' => $generic,
                'brand'        => $brand,
                'description'  => $name . ' — export grade, India origin.',
                'segment_id'   => $seg,
                'haz_type'     => 'Non-Haz',
                'uom_id'       => $uom,
                'hsn_id'       => $hsn,
                'condition_id' => 11,
                'packaging_material_id' => 11,
                'base_price'   => $base,
                'gst_id'       => $gst,
                'gst_amount'   => $gstAmt,
                'total_price'  => $base + $gstAmt,
                'mark_bottom'  => 'Non Bottom',
                'net_weight'   => 25.000,
                'gross_weight' => 25.500,
                'length_cm'    => 60.00,
                'width_cm'     => 40.00,
                'height_cm'    => 20.00,
                'status'       => 'inactive',   // Core+Sales+Quality complete, vendor not yet mapped
                'step_completed' => 3,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        }
    }

    /* ───────────────────────── VENDORS ─────────────────────────── */
    private function seedVendors(Carbon $now): void
    {
        // vendor_type_id 11 Mfr,12 Trader,13 Importer,14 Distributor
        // risk 11 Low,12 Med,13 High | behaviour 11 Reliable,12 Standard,13 Critical
        // compliance 11 Compliant,12 Minor,13 Under Review | segment 5..9
        $rows = [
            ['Shakti Agro Processors Pvt Ltd', 11, 11, 11, 7, 11, 'Karnal', 'Haryana', '06', '132001', 'Balwinder Singh', 'Plant Head'],
            ['Western Spice Mills Pvt Ltd', 11, 11, 11, 7, 11, 'Kochi', 'Kerala', '32', '682024', 'Joseph Mathew', 'Director'],
            ['Aurobindo Bulk Drugs Ltd', 11, 12, 11, 5, 11, 'Hyderabad', 'Telangana', '36', '500038', 'Dr. Srinivas Rao', 'VP Operations'],
            ['Divis Intermediates Pvt Ltd', 11, 12, 12, 5, 12, 'Visakhapatnam', 'Andhra Pradesh', '37', '531021', 'Padmaja Reddy', 'GM Quality'],
            ['Gujarat Fine Chemicals Ltd', 11, 12, 11, 6, 11, 'Vadodara', 'Gujarat', '24', '391760', 'Nirav Mehta', 'Sales Manager'],
            ['Tamil Cotton Spinners Ltd', 11, 11, 11, 8, 11, 'Coimbatore', 'Tamil Nadu', '33', '641407', 'Murugan P', 'Mill Manager'],
            ['Bharat Metal Recyclers Pvt Ltd', 12, 13, 13, 9, 12, 'Jamnagar', 'Gujarat', '24', '361004', 'Ashok Jain', 'Proprietor'],
            ['Hindustan Minerals Corporation', 11, 12, 12, 9, 11, 'Bellary', 'Karnataka', '29', '583101', 'Ramesh Gowda', 'Mine Head'],
            ['Krishna Rice Mills Pvt Ltd', 11, 11, 11, 7, 11, 'Karnal', 'Haryana', '06', '132114', 'Sukhdev Rana', 'Owner'],
            ['Coastal Seafood Suppliers', 12, 12, 12, 7, 12, 'Mangalore', 'Karnataka', '29', '575001', 'Ignatius D Souza', 'Partner'],
            ['Rajdhani Pulses & Grains Co', 12, 11, 11, 7, 11, 'Delhi', 'Delhi', '07', '110007', 'Mohan Lal Gupta', 'Trader'],
            ['Saurashtra Cotton Ginners', 11, 12, 12, 8, 12, 'Rajkot', 'Gujarat', '24', '360003', 'Bharat Patel', 'Manager'],
            ['Indo Pharma Excipients Ltd', 11, 11, 11, 5, 11, 'Ahmedabad', 'Gujarat', '24', '382213', 'Dr. Kiran Desai', 'Tech Director'],
            ['Eastern Tea Estates Pvt Ltd', 11, 11, 11, 7, 11, 'Siliguri', 'West Bengal', '19', '734001', 'Debashish Roy', 'Estate Manager'],
            ['Vidarbha Citrus Growers Co-op', 14, 12, 12, 7, 12, 'Nagpur', 'Maharashtra', '27', '440010', 'Sanjay Patil', 'Secretary'],
            ['Malwa Soya Industries Ltd', 11, 12, 11, 7, 11, 'Indore', 'Madhya Pradesh', '23', '453771', 'Rakesh Jain', 'Plant Manager'],
            ['Konkan Cashew Processors', 11, 11, 11, 7, 11, 'Sindhudurg', 'Maharashtra', '27', '416510', 'Vivek Sawant', 'Owner'],
            ['Marwar Handicraft Makers', 13, 12, 12, 8, 12, 'Jodhpur', 'Rajasthan', '08', '342001', 'Dinesh Soni', 'Karkhana Head'],
            ['Ganga Leather Tanners Pvt Ltd', 11, 13, 13, 8, 13, 'Kanpur', 'Uttar Pradesh', '09', '208010', 'Mohd Aslam', 'Production Head'],
            ['Konkan Alphonso Exporters', 14, 11, 11, 7, 11, 'Ratnagiri', 'Maharashtra', '27', '415612', 'Prakash More', 'Director'],
        ];

        $existing = DB::table('vendors')->where('client_id', $this->clientId)
            ->pluck('vendor_code');
        $max = 0;
        foreach ($existing as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        foreach ($rows as $i => $r) {
            [$name, $vtype, $risk, $behav, $seg, $compl, $city, $state, $stateCode, $pin, $cp, $desig] = $r;
            $max++;
            $slug  = $this->slug($name);
            $email = 'sales@' . $slug . '.co.in';

            $id = DB::table('vendors')->insertGetId([
                'client_id'      => $this->clientId,
                'branch_id'      => $this->branchId,
                'created_by'     => $this->createdBy,
                'vendor_code'    => 'V-' . str_pad((string) $max, 2, '0', STR_PAD_LEFT),
                'company_name'   => $name,
                'legal_name'     => $name,
                'website'        => 'https://www.' . $slug . '.co.in',
                'vendor_type_id' => $vtype,
                'risk_level_id'  => $risk,
                'vendor_behaviour_id' => $behav,
                'segment_id'     => $seg,
                'compliance_behaviour_id' => $compl,
                'primary_email'  => $email,
                'status'         => 'active',
                'step_completed' => 4,
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);

            DB::table('vendor_addresses')->insert([
                'vendor_id'        => $id,
                'address_line'     => 'Industrial Area, Sector ' . ($i + 1) . ', ' . $city,
                'state_code'       => $stateCode,
                'city'             => $city,
                'pincode'          => $pin,
                'contact_name'     => $cp,
                'designation'      => $desig,
                'contact_no'       => $this->mobile($i + 40),
                'email'            => $email,
                'whatsapp_enabled' => true,
                'is_primary'       => true,
                'created_at'       => $now,
                'updated_at'       => $now,
            ]);
        }
    }

    /* ───────────────────────── helpers ─────────────────────────── */
    private function slug(string $s): string
    {
        $s = preg_replace('/\b(pvt|private|ltd|limited|llc|inc|co|company|gmbh|bv|kk|pte|fze|lda|srl|pty|llp|corporation|corp|co-op)\b/i', '', strtolower($s));
        $s = preg_replace('/[^a-z0-9]+/', '', $s);
        return $s !== '' ? $s : 'firm';
    }

    private function slugName(string $s): string
    {
        return preg_replace('/[^a-z]+/', '.', strtolower($s)) ?: 'contact';
    }

    private function mobile(int $i): string
    {
        return '+91 9' . str_pad((string) (800000000 + $i * 137), 9, '0', STR_PAD_LEFT);
    }

    private function countryFor(string $city): string
    {
        return [
            'Dubai' => 'United Arab Emirates', 'Sharjah' => 'United Arab Emirates', 'Abu Dhabi' => 'United Arab Emirates',
            'Singapore' => 'Singapore', 'Hamburg' => 'Germany', 'Frankfurt' => 'Germany',
            'Manchester' => 'United Kingdom', 'London' => 'United Kingdom', 'Boston' => 'United States',
            'Houston' => 'United States', 'New York' => 'United States', 'Toronto' => 'Canada',
            'Tokyo' => 'Japan', 'Rotterdam' => 'Netherlands', 'Milan' => 'Italy',
            'Sydney' => 'Australia', 'Lisbon' => 'Portugal', 'Doha' => 'Qatar',
        ][$city] ?? 'India';
    }
}

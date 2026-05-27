<?php
/**
 * Seed 5 suppliers (vendors) with primary addresses, KYC docs, owners,
 * bank accounts, and GST scrutiny rows. Pairs the 5 customer segments
 * we seeded earlier (Pharma / Food & Agro / Chemicals / Textile /
 * Metal & Mining) so each supplier maps to a real procurement scenario.
 */
require __DIR__ . '/vendor/autoload.php';
$app = require __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$user = App\Models\User::where('client_id', 1)->where('user_type', 'client_admin')->first()
     ?? App\Models\User::where('client_id', 1)->first();
$clientId = 1;
$branchId = $user->branch_id;
$createdBy = $user->id;

$IN = App\Models\Masters\Countries::where('iso_code', 'IN')->value('id');
$CN = App\Models\Masters\Countries::where('iso_code', 'CN')->value('id');
$AU = App\Models\Masters\Countries::where('iso_code', 'AU')->value('id');
$DE = App\Models\Masters\Countries::where('iso_code', 'DE')->value('id');
$TH = App\Models\Masters\Countries::where('iso_code', 'TH')->value('id');

echo "╔════════════════════════════════════════════════════════════════════╗\n";
echo "║  Seeding 5 suppliers + dependent master rows + KYC + banks        ║\n";
echo "╚════════════════════════════════════════════════════════════════════╝\n\n";

// ───────────────────────────────────────────────────────────────
// MASTER DATA — only insert when missing
// ───────────────────────────────────────────────────────────────
echo "┌─ Ensuring vendor-side master data exists ──────────────────────────\n";

$ensureMaster = function (string $modelClass, array $rowKey, array $extra = []) use ($clientId, $createdBy) {
    $row = $modelClass::query();
    foreach ($rowKey as $k => $v) $row->where($k, $v);
    if ($existing = $row->first()) return $existing->id;
    $created = $modelClass::create(array_merge($rowKey, $extra, [
        'client_id'  => $clientId,
        'created_by' => $createdBy,
        'status'     => 'Active',
    ]));
    return $created->id;
};

$vtManufacturer = $ensureMaster(App\Models\Masters\VendorTypes::class, ['name' => 'Manufacturer']);
$vtTrader      = $ensureMaster(App\Models\Masters\VendorTypes::class, ['name' => 'Trader']);
$vtImporter    = $ensureMaster(App\Models\Masters\VendorTypes::class, ['name' => 'Importer']);
$vtDistributor = $ensureMaster(App\Models\Masters\VendorTypes::class, ['name' => 'Distributor']);
echo "  ✓ Vendor types: Manufacturer, Trader, Importer, Distributor\n";

$vbReliable   = $ensureMaster(App\Models\Masters\VendorBehaviour::class, ['name' => 'Reliable']);
$vbStandard   = $ensureMaster(App\Models\Masters\VendorBehaviour::class, ['name' => 'Standard']);
$vbCritical   = $ensureMaster(App\Models\Masters\VendorBehaviour::class, ['name' => 'Critical Watch']);
echo "  ✓ Vendor behaviours: Reliable, Standard, Critical Watch\n";

$cbCompliant  = $ensureMaster(App\Models\Masters\ComplianceBehaviours::class, ['name' => 'Compliant'], ['action_required' => 'None']);
$cbMinor      = $ensureMaster(App\Models\Masters\ComplianceBehaviours::class, ['name' => 'Minor Lapse'], ['action_required' => 'Periodic Audit']);
$cbReview     = $ensureMaster(App\Models\Masters\ComplianceBehaviours::class, ['name' => 'Under Review'], ['action_required' => 'Quarterly Audit']);
echo "  ✓ Compliance behaviours: Compliant, Minor Lapse, Under Review\n";

$riskLow  = App\Models\Masters\RiskLevels::where('client_id', $clientId)->where('name','Low')->value('id');
$riskMed  = App\Models\Masters\RiskLevels::where('client_id', $clientId)->where('name','Medium')->value('id');
$riskHigh = App\Models\Masters\RiskLevels::where('client_id', $clientId)->where('name','High')->value('id');

$segPharma  = App\Models\Masters\Segments::where('client_id', $clientId)->where('name','Pharma')->value('id');
$segChem    = App\Models\Masters\Segments::where('client_id', $clientId)->where('name','Chemicals')->value('id');
$segFood    = App\Models\Masters\Segments::where('client_id', $clientId)->where('name','Food & Agro')->value('id');
$segTextile = App\Models\Masters\Segments::where('client_id', $clientId)->where('name','Textile')->value('id');
$segMetal   = App\Models\Masters\Segments::where('client_id', $clientId)->where('name','Metal & Mining')->value('id');

// ───────────────────────────────────────────────────────────────
// SUPPLIERS — 5 rows, one per segment, with full KYC + banks
// ───────────────────────────────────────────────────────────────
echo "\n┌─ Seeding 5 suppliers ──────────────────────────────────────────────\n";

$supplierData = [
    [
        'company_name' => 'Sinopharm Active Ingredients Co Ltd',
        'legal_name'   => 'Sinopharm Active Ingredients Co Ltd',
        'website'      => 'www.sinopharm-api.cn',
        'primary_email'=> 'export@sinopharm-api.cn',
        'vendor_type_id'         => $vtManufacturer,
        'risk_level_id'          => $riskLow,
        'vendor_behaviour_id'    => $vbReliable,
        'segment_id'             => $segPharma,
        'compliance_behaviour_id'=> $cbCompliant,
        'addr' => [
            'address_line' => 'No. 42, Pudong Pharma Park, Block B',
            'country_id'   => $CN, 'state_id' => null, 'state_code' => 'SH',
            'city' => 'Shanghai', 'pincode' => '200120',
            'contact_name' => 'Li Wei', 'designation' => 'Export Manager',
            'contact_no' => '+862168901234', 'email' => 'liwei@sinopharm-api.cn', 'whatsapp_enabled' => false,
        ],
        'docs' => [
            ['kind'=>'dd', 'document_name'=>'Business License (China)', 'license_number'=>'CN-91310000-71229A',  'issuing_authority'=>'SAMR Shanghai'],
            ['kind'=>'tl', 'document_name'=>'GMP Certificate',          'license_number'=>'GMP-SH-2024-0451',    'issuing_authority'=>'NMPA (CFDA)'],
        ],
        'owners' => [['document_name'=>'Passport', 'document_number'=>'EE9988221', 'issuing_authority'=>'PRC']],
        'bank' => ['bank_name'=>'Bank of China','branch_name'=>'Shanghai Pudong','account_number'=>'8821445566778899','ifsc'=>'BKCHCNBJ','branch_address'=>'Shanghai, China'],
        'gst'  => null, // foreign supplier — no Indian GST
    ],
    [
        'company_name' => 'Aussie Premium Grains Pty Ltd',
        'legal_name'   => 'Aussie Premium Grains Pty Ltd',
        'website'      => 'www.aussiepremiumgrains.au',
        'primary_email'=> 'sales@aussiepremiumgrains.au',
        'vendor_type_id'         => $vtTrader,
        'risk_level_id'          => $riskLow,
        'vendor_behaviour_id'    => $vbReliable,
        'segment_id'             => $segFood,
        'compliance_behaviour_id'=> $cbCompliant,
        'addr' => [
            'address_line' => 'Lot 14, Grain Belt Road',
            'country_id'   => $AU, 'state_id' => null, 'state_code' => 'WA',
            'city' => 'Perth', 'pincode' => '6000',
            'contact_name' => 'James Whitlock', 'designation' => 'Trade Director',
            'contact_no' => '+61891234567', 'email' => 'james@aussiepremiumgrains.au', 'whatsapp_enabled' => true,
        ],
        'docs' => [
            ['kind'=>'dd', 'document_name'=>'ABN Registration', 'license_number'=>'ABN-22-187-554-201',  'issuing_authority'=>'Australian Business Register'],
            ['kind'=>'tl', 'document_name'=>'Export License',   'license_number'=>'DAFF-EXP-2024-1188',  'issuing_authority'=>'Dept of Agriculture (DAFF)'],
        ],
        'owners' => [['document_name'=>'Passport', 'document_number'=>'PA1122334', 'issuing_authority'=>'Australia']],
        'bank' => ['bank_name'=>'NAB','branch_name'=>'Perth CBD','account_number'=>'012-345-67891234','ifsc'=>'NATAAU3303M','branch_address'=>'Perth WA, Australia'],
        'gst'  => null,
    ],
    [
        'company_name' => 'Bharath Chemicals & Specialties Ltd',
        'legal_name'   => 'Bharath Chemicals & Specialties Ltd',
        'website'      => 'www.bharathchem.in',
        'primary_email'=> 'orders@bharathchem.in',
        'vendor_type_id'         => $vtManufacturer,
        'risk_level_id'          => $riskMed,
        'vendor_behaviour_id'    => $vbStandard,
        'segment_id'             => $segChem,
        'compliance_behaviour_id'=> $cbMinor,
        'addr' => [
            'address_line' => 'Plot B-12, GIDC Industrial Estate',
            'country_id'   => $IN, 'state_id' => null, 'state_code' => 'GJ',
            'city' => 'Vadodara', 'pincode' => '390010',
            'contact_name' => 'Sunil Mehta', 'designation' => 'Sales Head',
            'contact_no' => '+919824112233', 'email' => 'sunil@bharathchem.in', 'whatsapp_enabled' => true,
        ],
        'docs' => [
            ['kind'=>'dd', 'document_name'=>'Certificate of Incorporation', 'license_number'=>'L24100GJ1995PLC027654', 'issuing_authority'=>'Registrar of Companies'],
            ['kind'=>'tl', 'document_name'=>'Pollution Control Cert',       'license_number'=>'GPCB-2023-CNS-7782',    'issuing_authority'=>'Gujarat PCB'],
        ],
        'owners' => [['document_name'=>'PAN', 'document_number'=>'AABCB7654L', 'issuing_authority'=>'Income Tax Dept']],
        'bank' => ['bank_name'=>'HDFC Bank','branch_name'=>'Alkapuri','account_number'=>'50100123456789','ifsc'=>'HDFC0000234','branch_address'=>'Vadodara, Gujarat'],
        'gst'  => ['gst_number'=>'24AABCB7654L1ZP'],
    ],
    [
        'company_name' => 'Bangkok Cotton Mills Co Ltd',
        'legal_name'   => 'Bangkok Cotton Mills Co Ltd',
        'website'      => 'www.bangkokcottonmills.th',
        'primary_email'=> 'export@bangkokcottonmills.th',
        'vendor_type_id'         => $vtManufacturer,
        'risk_level_id'          => $riskLow,
        'vendor_behaviour_id'    => $vbReliable,
        'segment_id'             => $segTextile,
        'compliance_behaviour_id'=> $cbCompliant,
        'addr' => [
            'address_line' => '88 Industrial Estate Bang Pa-in',
            'country_id'   => $TH, 'state_id' => null, 'state_code' => 'AY',
            'city' => 'Ayutthaya', 'pincode' => '13160',
            'contact_name' => 'Somchai Tan', 'designation' => 'Export Manager',
            'contact_no' => '+6622334455', 'email' => 'somchai@bangkokcottonmills.th', 'whatsapp_enabled' => true,
        ],
        'docs' => [
            ['kind'=>'dd', 'document_name'=>'DBD Registration', 'license_number'=>'TH-0105556221148',     'issuing_authority'=>'Dept of Business Dev (DBD)'],
            ['kind'=>'tl', 'document_name'=>'BOI Promotion Cert','license_number'=>'BOI-2022-T-3-553',    'issuing_authority'=>'Board of Investment'],
        ],
        'owners' => [['document_name'=>'Director ID', 'document_number'=>'TH-3554881223', 'issuing_authority'=>'Thailand']],
        'bank' => ['bank_name'=>'Kasikorn Bank','branch_name'=>'Bang Pa-in','account_number'=>'732-145566-1','ifsc'=>'KASITHBK','branch_address'=>'Ayutthaya, Thailand'],
        'gst'  => null,
    ],
    [
        'company_name' => 'Rheinland Metals GmbH',
        'legal_name'   => 'Rheinland Metals GmbH',
        'website'      => 'www.rheinland-metals.de',
        'primary_email'=> 'einkauf@rheinland-metals.de',
        'vendor_type_id'         => $vtDistributor,
        'risk_level_id'          => $riskHigh,
        'vendor_behaviour_id'    => $vbCritical,
        'segment_id'             => $segMetal,
        'compliance_behaviour_id'=> $cbReview,
        'addr' => [
            'address_line' => 'Industriestraße 88',
            'country_id'   => $DE, 'state_id' => null, 'state_code' => 'NW',
            'city' => 'Duisburg', 'pincode' => '47057',
            'contact_name' => 'Klaus Bauer', 'designation' => 'Trading Manager',
            'contact_no' => '+4920311122', 'email' => 'klaus@rheinland-metals.de', 'whatsapp_enabled' => false,
        ],
        'docs' => [
            ['kind'=>'dd', 'document_name'=>'Handelsregister Excerpt', 'license_number'=>'HRB-DU-115887', 'issuing_authority'=>'Amtsgericht Duisburg'],
            ['kind'=>'tl', 'document_name'=>'EU Customs EORI',         'license_number'=>'DE221334455',   'issuing_authority'=>'EU Customs'],
        ],
        'owners' => [['document_name'=>'Geschäftsführer ID', 'document_number'=>'DE-L29G88H44', 'issuing_authority'=>'Bundesrepublik Deutschland']],
        'bank' => ['bank_name'=>'Deutsche Bank','branch_name'=>'Duisburg','account_number'=>'DE89370400440532013000','ifsc'=>'DEUTDEDBDUI','branch_address'=>'Duisburg, NRW, Germany'],
        'gst'  => null,
    ],
];

$nextVCode = function () use ($clientId) {
    $max = DB::table('vendors')->where('client_id', $clientId)
        ->select(DB::raw("MAX(CAST(SUBSTRING(vendor_code FROM 3) AS INT)) AS maxn"))->value('maxn') ?? 0;
    return 'V-' . str_pad((string) ($max + 1), 2, '0', STR_PAD_LEFT);
};

foreach ($supplierData as $sd) {
    if (App\Models\Vendor::where('client_id', $clientId)->where('primary_email', $sd['primary_email'])->exists()) {
        $existing = App\Models\Vendor::where('client_id', $clientId)->where('primary_email', $sd['primary_email'])->first();
        echo "  ↻ Skip {$sd['company_name']} (exists as {$existing->vendor_code})\n";
        continue;
    }
    $v = DB::transaction(function () use ($sd, $clientId, $branchId, $createdBy, $nextVCode) {
        $vendor = App\Models\Vendor::create([
            'client_id'              => $clientId,
            'branch_id'              => $branchId,
            'vendor_code'            => $nextVCode(),
            'company_name'           => $sd['company_name'],
            'legal_name'             => $sd['legal_name'],
            'website'                => $sd['website'],
            'vendor_type_id'         => $sd['vendor_type_id'],
            'risk_level_id'          => $sd['risk_level_id'],
            'vendor_behaviour_id'    => $sd['vendor_behaviour_id'],
            'segment_id'             => $sd['segment_id'],
            'compliance_behaviour_id'=> $sd['compliance_behaviour_id'],
            'primary_email'          => $sd['primary_email'],
            'status'                 => 'active',
            'step_completed'         => 4,
            'created_by'             => $createdBy,
        ]);

        App\Models\VendorAddress::create(array_merge($sd['addr'], [
            'vendor_id'  => $vendor->id,
            'is_primary' => true,
        ]));

        foreach ($sd['docs'] as $d) {
            App\Models\VendorDocument::create(array_merge($d, [
                'vendor_id'    => $vendor->id,
                'code'         => strtoupper($d['kind']) . '-' . substr(md5(uniqid('', true)), 0, 6),
                'mandatory'    => true,
                'issue_date'   => now()->subYear()->toDateString(),
                'expiry_date'  => now()->addYears(3)->toDateString(),
                'expiry'       => now()->addYears(3)->format('m/Y'),
                'created_by'   => $createdBy,
            ]));
        }
        foreach ($sd['owners'] as $o) {
            App\Models\VendorOwner::create(array_merge($o, [
                'vendor_id'   => $vendor->id,
                'code'        => 'OWN-' . substr(md5(uniqid('', true)), 0, 6),
                'issue_date'  => now()->subYears(3)->toDateString(),
                'expiry'      => now()->addYears(5)->format('m/Y'),
                'status'      => 'Active',
                'created_by'  => $createdBy,
            ]));
        }
        App\Models\VendorBankAccount::create(array_merge($sd['bank'], [
            'vendor_id'  => $vendor->id,
            'created_by' => $createdBy,
        ]));
        if (!empty($sd['gst'])) {
            App\Models\VendorGstScrutiny::create(array_merge($sd['gst'], [
                'vendor_id'  => $vendor->id,
                'status'     => 'Active',
                'last_filing_date' => now()->subMonth()->toDateString(),
                'created_by' => $createdBy,
            ]));
        }

        return $vendor;
    });
    echo "  ✓ Created {$v->vendor_code}  ·  {$v->company_name}  ({$v->primary_email})\n";
}

echo "\n╔════════════════════════════════════════════════════════════════════╗\n";
echo "║  SEED SUMMARY                                                      ║\n";
echo "╚════════════════════════════════════════════════════════════════════╝\n";
echo "  Vendors (after seed):           " . App\Models\Vendor::count() . " total\n";
echo "  Vendor addresses:               " . App\Models\VendorAddress::count() . " total\n";
echo "  Vendor documents (DD + TL):     " . App\Models\VendorDocument::count() . " total\n";
echo "  Vendor owners:                  " . App\Models\VendorOwner::count() . " total\n";
echo "  Vendor bank accounts:           " . App\Models\VendorBankAccount::count() . " total\n";
echo "  Vendor GST scrutiny rows:       " . App\Models\VendorGstScrutiny::count() . " total\n";
echo "\nReload /vendors to see them. Each supplier maps to one of the 5 customer segments.\n";

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Sales Matrix → Customers — API stub
 *
 * No DB yet: this returns the same mock dataset baked into the front-end
 * Customer_Flow.html so the React/iframe shell can be wired against real
 * endpoints before the customers table migration lands. Once that
 * migration exists, swap the static arrays for Eloquent queries — the
 * response shapes here are the contract.
 */
class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $tab = $request->query('tab', 'fresh');
        $q   = strtolower((string) $request->query('q', ''));

        $rows = $tab === 'recurring' ? $this->recurring() : $this->fresh();

        if ($q !== '') {
            $rows = array_values(array_filter($rows, function ($c) use ($q) {
                foreach (['company', 'id', 'contact', 'email', 'segment'] as $k) {
                    if (isset($c[$k]) && str_contains(strtolower((string) $c[$k]), $q)) {
                        return true;
                    }
                }
                return false;
            }));
        }

        return response()->json([
            'tab'   => $tab,
            'count' => count($rows),
            'data'  => $rows,
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $all = array_merge($this->fresh(), $this->recurring());
        foreach ($all as $c) {
            if ($c['id'] === $id) {
                return response()->json(['data' => $c]);
            }
        }
        return response()->json(['message' => 'Customer not found'], 404);
    }

    public function store(Request $request): JsonResponse
    {
        // Stub: validate the shape but don't persist (no table yet).
        $payload = $request->validate([
            'company'        => 'required|string|max:255',
            'legalName'      => 'nullable|string|max:255',
            'type'           => 'nullable|string|max:64',
            'segment'        => 'nullable|string|max:64',
            'classification' => 'nullable|string|max:64',
            'riskLevel'      => 'nullable|string|max:32',
            'country'        => 'nullable|string|max:64',
            'state'          => 'nullable|string|max:64',
            'city'           => 'nullable|string|max:64',
            'pin'            => 'nullable|string|max:16',
            'addr'           => 'nullable|string|max:500',
            'contact'        => 'nullable|string|max:255',
            'cpDesig'        => 'nullable|string|max:128',
            'phone'          => 'nullable|string|max:32',
            'email'          => 'nullable|email|max:255',
            'whatsapp'       => 'nullable|in:Yes,No',
        ]);

        // Fake a generated ID so the front-end can render a success state.
        $payload['id']        = 'C-' . str_pad((string) random_int(900, 9999), 4, '0', STR_PAD_LEFT);
        $payload['consignees'] = 0;

        return response()->json(['data' => $payload, 'stub' => true], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        // Stub: echo back the merged record without persisting.
        return response()->json([
            'data' => array_merge(['id' => $id], $request->all()),
            'stub' => true,
        ]);
    }

    public function destroy(string $id): JsonResponse
    {
        return response()->json(['id' => $id, 'deleted' => true, 'stub' => true]);
    }

    private function fresh(): array
    {
        return [
            ['id'=>'C-001','company'=>'Shree Exports Pvt Ltd','legalName'=>'Shree Exports Private Limited','website'=>'www.shreeexports.com','type'=>'Retailer','segment'=>'Dry Fruits','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Maharashtra','city'=>'Pune','pin'=>'411001','addr'=>'14 Ganesh Nagar, Kothrud','contact'=>'Yash Mote','cpDesig'=>'Managing Director','phone'=>'+91-9011033444','email'=>'yash@shreeexports.com','whatsapp'=>'Yes','consignees'=>3],
            ['id'=>'C-002','company'=>'GreenHarvest Global','legalName'=>'GreenHarvest Global LLP','website'=>'www.greenharvestglobal.com','type'=>'Exporter','segment'=>'Agro','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Gujarat','city'=>'Ahmedabad','pin'=>'380001','addr'=>'B-203 Patel Avenue, CG Road','contact'=>'Ravi Vardhan','cpDesig'=>'CEO','phone'=>'+91-9123456789','email'=>'ravi@greenharvestglobal.com','whatsapp'=>'Yes','consignees'=>5],
            ['id'=>'C-003','company'=>'GreenHarvest Agri-Exports','legalName'=>'GreenHarvest Agri-Exports Pvt Ltd','website'=>'www.ghagriexports.in','type'=>'Exporter','segment'=>'Rice & Grains','classification'=>'Standard','riskLevel'=>'Medium','country'=>'India','state'=>'Punjab','city'=>'Ludhiana','pin'=>'141001','addr'=>'Opp. Bus Stand, Miller Ganj','contact'=>'Ravi Mishra','cpDesig'=>'Director','phone'=>'+91-9898989800','email'=>'ravi@greenharvest.com','whatsapp'=>'No','consignees'=>2],
            ['id'=>'C-004','company'=>'International Buyer LLC','legalName'=>'International Buyer LLC','website'=>'www.intlbuyer.ae','type'=>'Wholesaler','segment'=>'Spices','classification'=>'VIP','riskLevel'=>'Low','country'=>'UAE','state'=>'Dubai','city'=>'Dubai','pin'=>'00000','addr'=>'Office 704, Sultan Business Centre','contact'=>'Ahmed Al-Farsi','cpDesig'=>'Chief Procurement Officer','phone'=>'+971-501234567','email'=>'ahmed@intlbuyer.ae','whatsapp'=>'Yes','consignees'=>4],
            ['id'=>'C-005','company'=>'QuickTrade Resellers','legalName'=>'QuickTrade Resellers India Pvt Ltd','website'=>'www.quicktrade.com','type'=>'Reseller','segment'=>'Pulses','classification'=>'Standard','riskLevel'=>'High','country'=>'India','state'=>'Delhi','city'=>'New Delhi','pin'=>'110001','addr'=>'305 Laxmi Nagar Main Road','contact'=>'Deepak Jain','cpDesig'=>'Procurement Manager','phone'=>'+91-9001122334','email'=>'deepak@quicktrade.com','whatsapp'=>'No','consignees'=>1],
            ['id'=>'C-006','company'=>'Fit Nation Pvt Ltd','legalName'=>'Fit Nation Private Limited','website'=>'www.fitnation.in','type'=>'Wholesaler','segment'=>'Dry Fruits','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Maharashtra','city'=>'Nagpur','pin'=>'440010','addr'=>'Plot 22, MIDC Hingna Road','contact'=>'Durgesh Urkude','cpDesig'=>'General Manager','phone'=>'+91-7218663502','email'=>'durgesh@fitnation.in','whatsapp'=>'Yes','consignees'=>2],
            ['id'=>'C-007','company'=>'Manoj Jacob Foods','legalName'=>'Manoj Jacob Foods & Exports Pvt Ltd','website'=>'www.mjfoods.in','type'=>'Exporter','segment'=>'Coconut Oil','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Kerala','city'=>'Kochi','pin'=>'682001','addr'=>'34 Marine Drive, Ernakulam','contact'=>'Manoj Jacob','cpDesig'=>'Founder & CEO','phone'=>'+91-9876543210','email'=>'manoj@mjfoods.in','whatsapp'=>'No','consignees'=>3],
            ['id'=>'C-008','company'=>'FreshMart Retailers','legalName'=>'FreshMart Retailers LLP','website'=>'www.freshmart.com','type'=>'Retailer','segment'=>'Basmati Rice','classification'=>'Standard','riskLevel'=>'Medium','country'=>'India','state'=>'Haryana','city'=>'Gurugram','pin'=>'122001','addr'=>'SCO 12, Sector 14 Market','contact'=>'Ankit Sharma','cpDesig'=>'Operations Head','phone'=>'+91-9876512345','email'=>'ankit@freshmart.com','whatsapp'=>'Yes','consignees'=>1],
            ['id'=>'C-009','company'=>'Bharat Agro Traders','legalName'=>'Bharat Agro Traders Pvt Ltd','website'=>'www.bharatagro.com','type'=>'Wholesaler','segment'=>'Millets','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Karnataka','city'=>'Bengaluru','pin'=>'560001','addr'=>'No. 8, 2nd Cross, Rajajinagar','contact'=>'Suresh Patil','cpDesig'=>'Director','phone'=>'+91-9765432109','email'=>'suresh@bharatagro.com','whatsapp'=>'Yes','consignees'=>4],
            ['id'=>'C-010','company'=>'Eastern Harvest Co.','legalName'=>'Eastern Harvest Company Pvt Ltd','website'=>'www.easternharvest.in','type'=>'Exporter','segment'=>'Coffee Beans','classification'=>'Premium','riskLevel'=>'Medium','country'=>'India','state'=>'Tamil Nadu','city'=>'Chennai','pin'=>'600001','addr'=>'12 Anna Salai, Triplicane','contact'=>'Priya Nair','cpDesig'=>'Export Manager','phone'=>'+91-9654321098','email'=>'priya@easternharvest.in','whatsapp'=>'No','consignees'=>2],
            ['id'=>'C-011','company'=>'Sun Agri Exports','legalName'=>'Sun Agri Exports Pvt Ltd','website'=>'www.sunagriexports.com','type'=>'Exporter','segment'=>'Turmeric','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Andhra Pradesh','city'=>'Guntur','pin'=>'522001','addr'=>'40-A Brodipet, Main Road','contact'=>'Vikram Desai','cpDesig'=>'MD & CEO','phone'=>'+91-9543210987','email'=>'vikram@sunagri.com','whatsapp'=>'Yes','consignees'=>3],
            ['id'=>'C-012','company'=>'Prime Foods UAE','legalName'=>'Prime Foods UAE LLC','website'=>'www.primefoods.ae','type'=>'Retailer','segment'=>'Spices','classification'=>'VIP','riskLevel'=>'Low','country'=>'UAE','state'=>'Abu Dhabi','city'=>'Abu Dhabi','pin'=>'00000','addr'=>'Floor 3, Al Nahyan Camp Office','contact'=>'Khalid Mansoor','cpDesig'=>'Director Procurement','phone'=>'+971-561234567','email'=>'khalid@primefoods.ae','whatsapp'=>'Yes','consignees'=>2],
            ['id'=>'C-013','company'=>'KM Naturals','legalName'=>'KM Naturals Private Limited','website'=>'www.kmnaturals.in','type'=>'Retailer','segment'=>'Cashew','classification'=>'Standard','riskLevel'=>'Medium','country'=>'India','state'=>'Kerala','city'=>'Thrissur','pin'=>'680001','addr'=>'MG Road, Near SBI, Thrissur','contact'=>'Kavitha Menon','cpDesig'=>'Proprietor','phone'=>'+91-9432109876','email'=>'kavitha@kmnaturals.in','whatsapp'=>'No','consignees'=>1],
            ['id'=>'C-014','company'=>'Horizon Agro Pvt Ltd','legalName'=>'Horizon Agro Private Limited','website'=>'www.horizonagro.com','type'=>'Wholesaler','segment'=>'Rice & Grains','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Uttar Pradesh','city'=>'Lucknow','pin'=>'226001','addr'=>'Sector G, Aliganj Commercial Complex','contact'=>'Rohit Singh','cpDesig'=>'VP Operations','phone'=>'+91-9321098765','email'=>'rohit@horizonagro.com','whatsapp'=>'Yes','consignees'=>5],
            ['id'=>'C-015','company'=>'NatureFirst Exports','legalName'=>'NatureFirst Exports LLP','website'=>'www.naturefirst.com','type'=>'Exporter','segment'=>'Organic Spices','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Maharashtra','city'=>'Mumbai','pin'=>'400001','addr'=>'1201 Nariman Point Tower B','contact'=>'Sneha Kulkarni','cpDesig'=>'International Sales Head','phone'=>'+91-9210987654','email'=>'sneha@naturefirst.com','whatsapp'=>'Yes','consignees'=>3],
        ];
    }

    private function recurring(): array
    {
        return [
            ['id'=>'C-016','company'=>'Apex Food Processors','legalName'=>'Apex Food Processors Pvt Ltd','website'=>'www.apexfoods.in','type'=>'Reseller','segment'=>'Spices','classification'=>'Standard','riskLevel'=>'Medium','country'=>'India','state'=>'Rajasthan','city'=>'Jaipur','pin'=>'302001','addr'=>'F-12 RIICO Industrial Area, Mansarovar','contact'=>'Rajesh Varma','cpDesig'=>'Procurement Head','phone'=>'+91-9825012345','email'=>'procurement@apexfoods.in','whatsapp'=>'No','consignees'=>6],
            ['id'=>'C-017','company'=>'Spice Route Traders','legalName'=>'Spice Route Traders Pvt Ltd','website'=>'www.spiceroutetraders.com','type'=>'Exporter','segment'=>'Spices','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Kerala','city'=>'Kozhikode','pin'=>'673001','addr'=>'Beach Road, Calicut Business Park','contact'=>'Meena Iyer','cpDesig'=>'Director Exports','phone'=>'+91-9123456780','email'=>'meena@spiceroute.com','whatsapp'=>'Yes','consignees'=>8],
            ['id'=>'C-018','company'=>'Delta Agro Exports','legalName'=>'Delta Agro Exports LLP','website'=>'www.deltaagro.in','type'=>'Wholesaler','segment'=>'Pulses','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Madhya Pradesh','city'=>'Indore','pin'=>'452001','addr'=>'C-21, Vijay Nagar Square','contact'=>'Ramesh Kulkarni','cpDesig'=>'Managing Partner','phone'=>'+91-9234567891','email'=>'ramesh@deltaagro.in','whatsapp'=>'No','consignees'=>4],
            ['id'=>'C-019','company'=>'Sunrise Foods International','legalName'=>'Sunrise Foods International Pvt Ltd','website'=>'www.sunrisefoods.com','type'=>'Retailer','segment'=>'Coconut Oil','classification'=>'VIP','riskLevel'=>'Low','country'=>'India','state'=>'Karnataka','city'=>'Mysuru','pin'=>'570001','addr'=>'KRS Road, Metagalli Industrial Area','contact'=>'Kavitha Nair','cpDesig'=>'CEO','phone'=>'+91-9345678902','email'=>'kavitha@sunrisefoods.com','whatsapp'=>'Yes','consignees'=>7],
            ['id'=>'C-020','company'=>'Global Grain Co.','legalName'=>'Global Grain Company Pvt Ltd','website'=>'www.globalgrainco.com','type'=>'Exporter','segment'=>'Rice & Grains','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'West Bengal','city'=>'Kolkata','pin'=>'700001','addr'=>'7 Park Street, 3rd Floor','contact'=>'Arjun Pillai','cpDesig'=>'Export Director','phone'=>'+91-9456789013','email'=>'arjun@globalgrains.com','whatsapp'=>'No','consignees'=>5],
            ['id'=>'C-021','company'=>'Pacific Traders FZE','legalName'=>'Pacific Traders FZE','website'=>'www.pacifictraders.cn','type'=>'Wholesaler','segment'=>'Agro','classification'=>'VIP','riskLevel'=>'Medium','country'=>'China','state'=>'Shanghai','city'=>'Shanghai','pin'=>'200001','addr'=>'No.1 Lujiazui Ring Road, Pudong','contact'=>'Zhang Wei','cpDesig'=>'Director','phone'=>'+86-1381234567','email'=>'zhang@pacifictraders.cn','whatsapp'=>'Yes','consignees'=>9],
            ['id'=>'C-022','company'=>'Al-Hassan Foods LLC','legalName'=>'Al-Hassan Foods LLC','website'=>'www.alhassanfoods.ae','type'=>'Exporter','segment'=>'Dry Fruits','classification'=>'VIP','riskLevel'=>'Low','country'=>'UAE','state'=>'Sharjah','city'=>'Sharjah','pin'=>'00000','addr'=>'Al Wahda Complex, King Faisal Street','contact'=>'Fatima Al-Hassan','cpDesig'=>'CEO','phone'=>'+971-551234567','email'=>'fatima@alhassanfoods.ae','whatsapp'=>'Yes','consignees'=>6],
            ['id'=>'C-023','company'=>'Raza Exports','legalName'=>'Raza Exports Private Limited','website'=>'www.razaexports.com','type'=>'Exporter','segment'=>'Basmati Rice','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Uttar Pradesh','city'=>'Agra','pin'=>'282001','addr'=>'Sanjay Place Commercial Complex','contact'=>'Ayesha Raza','cpDesig'=>'Founder & Director','phone'=>'+91-9567890124','email'=>'ayesha@razaexports.com','whatsapp'=>'Yes','consignees'=>4],
            ['id'=>'C-024','company'=>'Bianchi Imports','legalName'=>'Bianchi Imports S.r.l.','website'=>'www.bianchiimports.it','type'=>'Wholesaler','segment'=>'Coffee Beans','classification'=>'Premium','riskLevel'=>'Medium','country'=>'Italy','state'=>'Lombardy','city'=>'Milan','pin'=>'20121','addr'=>'Via Monte Napoleone 12','contact'=>'Luca Bianchi','cpDesig'=>'CEO','phone'=>'+39-0212345678','email'=>'luca@bianchiimports.it','whatsapp'=>'No','consignees'=>3],
            ['id'=>'C-025','company'=>'Wei Imports Shanghai','legalName'=>'Wei Imports Shanghai Co. Ltd','website'=>'www.weiimports.cn','type'=>'Retailer','segment'=>'Spices','classification'=>'Standard','riskLevel'=>'Medium','country'=>'China','state'=>'Shanghai','city'=>'Shanghai','pin'=>'200002','addr'=>'Rm 2001 Raffles City Tower','contact'=>'Wei Xiaoming','cpDesig'=>'General Manager','phone'=>'+86-2112345678','email'=>'wei@weiimports.cn','whatsapp'=>'Yes','consignees'=>5],
            ['id'=>'C-026','company'=>'Martinez Trading Co.','legalName'=>'Martinez Trading Company S.L.','website'=>'www.martineztrading.es','type'=>'Exporter','segment'=>'Mango Pulp','classification'=>'Standard','riskLevel'=>'Low','country'=>'Spain','state'=>'Madrid','city'=>'Madrid','pin'=>'28001','addr'=>'Calle Gran Via 45, Planta 6','contact'=>'Jose Martinez','cpDesig'=>'Managing Director','phone'=>'+34-911234567','email'=>'jose@martineztrading.es','whatsapp'=>'No','consignees'=>2],
            ['id'=>'C-027','company'=>'Agro Fresh Ltd','legalName'=>'Agro Fresh Limited','website'=>'www.agrofresh.in','type'=>'Retailer','segment'=>'Organic Spices','classification'=>'Standard','riskLevel'=>'Low','country'=>'India','state'=>'Tamil Nadu','city'=>'Coimbatore','pin'=>'641001','addr'=>'RS Puram, 5th Street','contact'=>'Priya Sharma','cpDesig'=>'Director','phone'=>'+91-9678901235','email'=>'priya@agrofresh.in','whatsapp'=>'Yes','consignees'=>7],
            ['id'=>'C-028','company'=>'Gulf Food Traders LLC','legalName'=>'Gulf Food Traders LLC','website'=>'www.gulffoodtraders.ae','type'=>'Wholesaler','segment'=>'Dry Fruits','classification'=>'VIP','riskLevel'=>'Low','country'=>'UAE','state'=>'Dubai','city'=>'Dubai','pin'=>'00000','addr'=>'Office 12B, Dubai Gold & Diamond Park','contact'=>'Omar Al-Rashid','cpDesig'=>'Procurement Director','phone'=>'+971-571234567','email'=>'omar@gulffood.ae','whatsapp'=>'Yes','consignees'=>8],
            ['id'=>'C-029','company'=>'Nwosu Agro Industries','legalName'=>'Nwosu Agro Industries Ltd','website'=>'www.nwosuagro.ng','type'=>'Exporter','segment'=>'Cashew','classification'=>'Standard','riskLevel'=>'High','country'=>'Nigeria','state'=>'Lagos','city'=>'Lagos','pin'=>'100001','addr'=>'Plot 16, Apapa-Oshodi Expressway','contact'=>'Amara Nwosu','cpDesig'=>'CEO','phone'=>'+234-8012345678','email'=>'amara@nwosuagro.ng','whatsapp'=>'No','consignees'=>3],
            ['id'=>'C-030','company'=>'BrightHarvest Global','legalName'=>'BrightHarvest Global Exports Pvt Ltd','website'=>'www.brightharvest.com','type'=>'Exporter','segment'=>'Turmeric','classification'=>'Premium','riskLevel'=>'Low','country'=>'India','state'=>'Telangana','city'=>'Hyderabad','pin'=>'500001','addr'=>'Plot 11, Hitech City Main Road','contact'=>'Carlos Rivera','cpDesig'=>'VP International Sales','phone'=>'+91-9789012346','email'=>'carlos@brightharvest.com','whatsapp'=>'Yes','consignees'=>6],
        ];
    }
}

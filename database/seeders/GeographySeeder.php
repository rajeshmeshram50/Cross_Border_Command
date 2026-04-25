<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the master_countries and master_states tables with real ISO 3166
 * data: all 249 countries plus subdivisions (states/provinces/regions)
 * for the major trade partners.
 *
 * Idempotent: deletes previously admin-seeded global rows (created_by =
 * super admin AND client_id IS NULL AND branch_id IS NULL) and re-inserts.
 *
 * Run: php artisan db:seed --class=Database\\Seeders\\GeographySeeder
 */
class GeographySeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::where('user_type', 'super_admin')->first();
        if (! $admin) {
            $this->command->warn('No super_admin user found — run DatabaseSeeder first.');
            return;
        }
        $adminId = $admin->id;
        $now = now();

        // ── COUNTRIES ──
        DB::table('master_countries')
            ->where('created_by', $adminId)
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->delete();

        $countries = $this->countries();
        $countryRows = array_map(fn ($c) => [
            'name'       => $c[0],
            'iso_code'   => $c[1],
            'status'     => 'Active',
            'client_id'  => null,
            'branch_id'  => null,
            'created_by' => $adminId,
            'created_at' => $now,
            'updated_at' => $now,
        ], $countries);

        DB::table('master_countries')->insert($countryRows);
        $this->command->info(sprintf('insert %-28s +%d rows', 'countries', count($countryRows)));

        // Build iso_code -> id map for fast state insert
        $isoToId = DB::table('master_countries')
            ->where('created_by', $adminId)
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->pluck('id', 'iso_code')
            ->all();

        // ── STATES ──
        DB::table('master_states')
            ->where('created_by', $adminId)
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->delete();

        $stateRows = [];
        foreach ($this->statesByIso() as $iso => $names) {
            $countryId = $isoToId[$iso] ?? null;
            if (! $countryId) continue;
            foreach ($names as $name) {
                $stateRows[] = [
                    'country_id' => (string) $countryId,
                    'name'       => $name,
                    'status'     => 'Active',
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_by' => $adminId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        // Insert in chunks to stay well under MySQL placeholder limits
        foreach (array_chunk($stateRows, 200) as $chunk) {
            DB::table('master_states')->insert($chunk);
        }
        $this->command->info(sprintf('insert %-28s +%d rows', 'states', count($stateRows)));
    }

    /**
     * All 249 ISO 3166-1 countries as [name, alpha-2 iso_code] pairs.
     * Definitions split across helper methods so the file stays readable.
     */
    private function countries(): array
    {
        return array_merge(
            $this->countriesA(),
            $this->countriesB(),
            $this->countriesC(),
            $this->countriesD(),
        );
    }

    private function countriesA(): array
    {
        return [
            ['Afghanistan', 'AF'], ['Aland Islands', 'AX'], ['Albania', 'AL'], ['Algeria', 'DZ'],
            ['American Samoa', 'AS'], ['Andorra', 'AD'], ['Angola', 'AO'], ['Anguilla', 'AI'],
            ['Antarctica', 'AQ'], ['Antigua and Barbuda', 'AG'], ['Argentina', 'AR'], ['Armenia', 'AM'],
            ['Aruba', 'AW'], ['Australia', 'AU'], ['Austria', 'AT'], ['Azerbaijan', 'AZ'],
            ['Bahamas', 'BS'], ['Bahrain', 'BH'], ['Bangladesh', 'BD'], ['Barbados', 'BB'],
            ['Belarus', 'BY'], ['Belgium', 'BE'], ['Belize', 'BZ'], ['Benin', 'BJ'],
            ['Bermuda', 'BM'], ['Bhutan', 'BT'], ['Bolivia', 'BO'], ['Bonaire, Sint Eustatius and Saba', 'BQ'],
            ['Bosnia and Herzegovina', 'BA'], ['Botswana', 'BW'], ['Bouvet Island', 'BV'], ['Brazil', 'BR'],
            ['British Indian Ocean Territory', 'IO'], ['Brunei Darussalam', 'BN'], ['Bulgaria', 'BG'],
            ['Burkina Faso', 'BF'], ['Burundi', 'BI'],
            ['Cabo Verde', 'CV'], ['Cambodia', 'KH'], ['Cameroon', 'CM'], ['Canada', 'CA'],
            ['Cayman Islands', 'KY'], ['Central African Republic', 'CF'], ['Chad', 'TD'], ['Chile', 'CL'],
            ['China', 'CN'], ['Christmas Island', 'CX'], ['Cocos (Keeling) Islands', 'CC'], ['Colombia', 'CO'],
            ['Comoros', 'KM'], ['Congo', 'CG'], ['Congo, Democratic Republic of the', 'CD'], ['Cook Islands', 'CK'],
            ['Costa Rica', 'CR'], ['Cote d\'Ivoire', 'CI'], ['Croatia', 'HR'], ['Cuba', 'CU'],
            ['Curacao', 'CW'], ['Cyprus', 'CY'], ['Czechia', 'CZ'],
        ];
    }
    private function countriesB(): array
    {
        return [
            ['Denmark', 'DK'], ['Djibouti', 'DJ'], ['Dominica', 'DM'], ['Dominican Republic', 'DO'],
            ['Ecuador', 'EC'], ['Egypt', 'EG'], ['El Salvador', 'SV'], ['Equatorial Guinea', 'GQ'],
            ['Eritrea', 'ER'], ['Estonia', 'EE'], ['Eswatini', 'SZ'], ['Ethiopia', 'ET'],
            ['Falkland Islands', 'FK'], ['Faroe Islands', 'FO'], ['Fiji', 'FJ'], ['Finland', 'FI'],
            ['France', 'FR'], ['French Guiana', 'GF'], ['French Polynesia', 'PF'], ['French Southern Territories', 'TF'],
            ['Gabon', 'GA'], ['Gambia', 'GM'], ['Georgia', 'GE'], ['Germany', 'DE'],
            ['Ghana', 'GH'], ['Gibraltar', 'GI'], ['Greece', 'GR'], ['Greenland', 'GL'],
            ['Grenada', 'GD'], ['Guadeloupe', 'GP'], ['Guam', 'GU'], ['Guatemala', 'GT'],
            ['Guernsey', 'GG'], ['Guinea', 'GN'], ['Guinea-Bissau', 'GW'], ['Guyana', 'GY'],
            ['Haiti', 'HT'], ['Heard Island and McDonald Islands', 'HM'], ['Holy See', 'VA'], ['Honduras', 'HN'],
            ['Hong Kong', 'HK'], ['Hungary', 'HU'],
            ['Iceland', 'IS'], ['India', 'IN'], ['Indonesia', 'ID'], ['Iran', 'IR'],
            ['Iraq', 'IQ'], ['Ireland', 'IE'], ['Isle of Man', 'IM'], ['Israel', 'IL'],
            ['Italy', 'IT'], ['Jamaica', 'JM'], ['Japan', 'JP'], ['Jersey', 'JE'],
            ['Jordan', 'JO'], ['Kazakhstan', 'KZ'], ['Kenya', 'KE'], ['Kiribati', 'KI'],
            ['Korea, North', 'KP'], ['Korea, South', 'KR'], ['Kuwait', 'KW'], ['Kyrgyzstan', 'KG'],
        ];
    }
    private function countriesC(): array
    {
        return [
            ['Laos', 'LA'], ['Latvia', 'LV'], ['Lebanon', 'LB'], ['Lesotho', 'LS'],
            ['Liberia', 'LR'], ['Libya', 'LY'], ['Liechtenstein', 'LI'], ['Lithuania', 'LT'],
            ['Luxembourg', 'LU'], ['Macao', 'MO'], ['Madagascar', 'MG'], ['Malawi', 'MW'],
            ['Malaysia', 'MY'], ['Maldives', 'MV'], ['Mali', 'ML'], ['Malta', 'MT'],
            ['Marshall Islands', 'MH'], ['Martinique', 'MQ'], ['Mauritania', 'MR'], ['Mauritius', 'MU'],
            ['Mayotte', 'YT'], ['Mexico', 'MX'], ['Micronesia', 'FM'], ['Moldova', 'MD'],
            ['Monaco', 'MC'], ['Mongolia', 'MN'], ['Montenegro', 'ME'], ['Montserrat', 'MS'],
            ['Morocco', 'MA'], ['Mozambique', 'MZ'], ['Myanmar', 'MM'],
            ['Namibia', 'NA'], ['Nauru', 'NR'], ['Nepal', 'NP'], ['Netherlands', 'NL'],
            ['New Caledonia', 'NC'], ['New Zealand', 'NZ'], ['Nicaragua', 'NI'], ['Niger', 'NE'],
            ['Nigeria', 'NG'], ['Niue', 'NU'], ['Norfolk Island', 'NF'], ['North Macedonia', 'MK'],
            ['Northern Mariana Islands', 'MP'], ['Norway', 'NO'],
            ['Oman', 'OM'], ['Pakistan', 'PK'], ['Palau', 'PW'], ['Palestine, State of', 'PS'],
            ['Panama', 'PA'], ['Papua New Guinea', 'PG'], ['Paraguay', 'PY'], ['Peru', 'PE'],
            ['Philippines', 'PH'], ['Pitcairn', 'PN'], ['Poland', 'PL'], ['Portugal', 'PT'],
            ['Puerto Rico', 'PR'], ['Qatar', 'QA'], ['Reunion', 'RE'], ['Romania', 'RO'],
            ['Russian Federation', 'RU'], ['Rwanda', 'RW'],
        ];
    }
    private function countriesD(): array
    {
        return [
            ['Saint Barthelemy', 'BL'], ['Saint Helena', 'SH'], ['Saint Kitts and Nevis', 'KN'],
            ['Saint Lucia', 'LC'], ['Saint Martin (French part)', 'MF'], ['Saint Pierre and Miquelon', 'PM'],
            ['Saint Vincent and the Grenadines', 'VC'], ['Samoa', 'WS'], ['San Marino', 'SM'],
            ['Sao Tome and Principe', 'ST'], ['Saudi Arabia', 'SA'], ['Senegal', 'SN'],
            ['Serbia', 'RS'], ['Seychelles', 'SC'], ['Sierra Leone', 'SL'], ['Singapore', 'SG'],
            ['Sint Maarten (Dutch part)', 'SX'], ['Slovakia', 'SK'], ['Slovenia', 'SI'],
            ['Solomon Islands', 'SB'], ['Somalia', 'SO'], ['South Africa', 'ZA'],
            ['South Georgia and the South Sandwich Islands', 'GS'], ['South Sudan', 'SS'],
            ['Spain', 'ES'], ['Sri Lanka', 'LK'], ['Sudan', 'SD'], ['Suriname', 'SR'],
            ['Svalbard and Jan Mayen', 'SJ'], ['Sweden', 'SE'], ['Switzerland', 'CH'],
            ['Syrian Arab Republic', 'SY'], ['Taiwan', 'TW'], ['Tajikistan', 'TJ'],
            ['Tanzania', 'TZ'], ['Thailand', 'TH'], ['Timor-Leste', 'TL'], ['Togo', 'TG'],
            ['Tokelau', 'TK'], ['Tonga', 'TO'], ['Trinidad and Tobago', 'TT'], ['Tunisia', 'TN'],
            ['Turkey', 'TR'], ['Turkmenistan', 'TM'], ['Turks and Caicos Islands', 'TC'],
            ['Tuvalu', 'TV'], ['Uganda', 'UG'], ['Ukraine', 'UA'], ['United Arab Emirates', 'AE'],
            ['United Kingdom', 'GB'], ['United States', 'US'],
            ['United States Minor Outlying Islands', 'UM'], ['Uruguay', 'UY'], ['Uzbekistan', 'UZ'],
            ['Vanuatu', 'VU'], ['Venezuela', 'VE'], ['Viet Nam', 'VN'],
            ['Virgin Islands (British)', 'VG'], ['Virgin Islands (U.S.)', 'VI'],
            ['Wallis and Futuna', 'WF'], ['Western Sahara', 'EH'], ['Yemen', 'YE'],
            ['Zambia', 'ZM'], ['Zimbabwe', 'ZW'],
        ];
    }

    /**
     * State / province / region data per country (keyed by ISO alpha-2).
     * Comprehensive for major trade partners; skipped for tiny territories
     * with no real political subdivisions.
     */
    private function statesByIso(): array
    {
        return array_merge(
            $this->statesAsia(),
            $this->statesAsiaEast(),
            $this->statesAsiaSouthEast(),
            $this->statesAsiaWest(),
            $this->statesEurope(),
            $this->statesEurope2(),
            $this->statesAmericas(),
            $this->statesAmericas2(),
            $this->statesAfricaOceania(),
        );
    }

    private function statesAsia(): array
    {
        return [
            // India — 28 states + 8 union territories
            'IN' => [
                'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
                'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
                'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
                'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
                'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
                'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
                'Andaman and Nicobar Islands', 'Chandigarh',
                'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
                'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
            ],
            // Pakistan — 4 provinces + 4 territories
            'PK' => [
                'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan',
                'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu and Kashmir',
            ],
            // Bangladesh — 8 divisions
            'BD' => [
                'Barisal', 'Chittagong', 'Dhaka', 'Khulna',
                'Mymensingh', 'Rajshahi', 'Rangpur', 'Sylhet',
            ],
            // Sri Lanka — 9 provinces
            'LK' => [
                'Central', 'Eastern', 'Northern', 'North Central', 'North Western',
                'Sabaragamuwa', 'Southern', 'Uva', 'Western',
            ],
            // Nepal — 7 provinces
            'NP' => [
                'Province No. 1', 'Madhesh', 'Bagmati', 'Gandaki',
                'Lumbini', 'Karnali', 'Sudurpashchim',
            ],
            // Bhutan — 20 dzongkhags
            'BT' => [
                'Bumthang', 'Chukha', 'Dagana', 'Gasa', 'Haa', 'Lhuntse', 'Mongar',
                'Paro', 'Pemagatshel', 'Punakha', 'Samdrup Jongkhar', 'Samtse',
                'Sarpang', 'Thimphu', 'Trashigang', 'Trashiyangtse', 'Trongsa',
                'Tsirang', 'Wangdue Phodrang', 'Zhemgang',
            ],
            // Myanmar — 14 states/regions
            'MM' => [
                'Ayeyarwady', 'Bago', 'Magway', 'Mandalay', 'Sagaing', 'Tanintharyi',
                'Yangon', 'Chin', 'Kachin', 'Kayah', 'Kayin', 'Mon', 'Rakhine', 'Shan',
            ],
        ];
    }
    private function statesAsiaEast(): array
    {
        return [
            // China — 34 provincial-level divisions
            'CN' => [
                'Anhui', 'Beijing', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong',
                'Guangxi', 'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan',
                'Hong Kong', 'Hubei', 'Hunan', 'Inner Mongolia', 'Jiangsu', 'Jiangxi',
                'Jilin', 'Liaoning', 'Macau', 'Ningxia', 'Qinghai', 'Shaanxi',
                'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Taiwan', 'Tianjin',
                'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang',
            ],
            // Japan — 47 prefectures
            'JP' => [
                'Aichi', 'Akita', 'Aomori', 'Chiba', 'Ehime', 'Fukui', 'Fukuoka',
                'Fukushima', 'Gifu', 'Gunma', 'Hiroshima', 'Hokkaido', 'Hyogo',
                'Ibaraki', 'Ishikawa', 'Iwate', 'Kagawa', 'Kagoshima', 'Kanagawa',
                'Kochi', 'Kumamoto', 'Kyoto', 'Mie', 'Miyagi', 'Miyazaki', 'Nagano',
                'Nagasaki', 'Nara', 'Niigata', 'Oita', 'Okayama', 'Okinawa', 'Osaka',
                'Saga', 'Saitama', 'Shiga', 'Shimane', 'Shizuoka', 'Tochigi',
                'Tokushima', 'Tokyo', 'Tottori', 'Toyama', 'Wakayama', 'Yamagata',
                'Yamaguchi', 'Yamanashi',
            ],
            // South Korea — 17 administrative divisions
            'KR' => [
                'Seoul', 'Busan', 'Daegu', 'Incheon', 'Gwangju', 'Daejeon', 'Ulsan',
                'Sejong', 'Gyeonggi', 'Gangwon', 'North Chungcheong', 'South Chungcheong',
                'North Jeolla', 'South Jeolla', 'North Gyeongsang', 'South Gyeongsang', 'Jeju',
            ],
            // Taiwan — 22 administrative divisions
            'TW' => [
                'Changhua', 'Chiayi City', 'Chiayi County', 'Hsinchu City', 'Hsinchu County',
                'Hualien', 'Kaohsiung', 'Keelung', 'Kinmen', 'Lienchiang', 'Miaoli',
                'Nantou', 'New Taipei', 'Penghu', 'Pingtung', 'Taichung', 'Tainan',
                'Taipei', 'Taitung', 'Taoyuan', 'Yilan', 'Yunlin',
            ],
            // Mongolia — 21 provinces + capital
            'MN' => [
                'Arkhangai', 'Bayan-Olgii', 'Bayankhongor', 'Bulgan', 'Darkhan-Uul',
                'Dornod', 'Dornogovi', 'Dundgovi', 'Govi-Altai', 'Govisumber',
                'Khentii', 'Khovd', 'Khuvsgul', 'Omnogovi', 'Orkhon', 'Selenge',
                'Sukhbaatar', 'Tuv', 'Ulaanbaatar', 'Uvs', 'Uvurkhangai', 'Zavkhan',
            ],
        ];
    }
    private function statesAsiaSouthEast(): array
    {
        return array_merge(
            $this->seThailand(),
            $this->seVietnam(),
            $this->seMalaysia(),
            $this->seIndonesia(),
            $this->sePhilippines(),
            $this->seOthers(),
        );
    }

    private function seThailand(): array
    {
        return [
            'TH' => [
                'Bangkok', 'Amnat Charoen', 'Ang Thong', 'Bueng Kan', 'Buriram',
                'Chachoengsao', 'Chai Nat', 'Chaiyaphum', 'Chanthaburi', 'Chiang Mai',
                'Chiang Rai', 'Chonburi', 'Chumphon', 'Kalasin', 'Kamphaeng Phet',
                'Kanchanaburi', 'Khon Kaen', 'Krabi', 'Lampang', 'Lamphun',
                'Loei', 'Lopburi', 'Mae Hong Son', 'Maha Sarakham', 'Mukdahan',
                'Nakhon Nayok', 'Nakhon Pathom', 'Nakhon Phanom', 'Nakhon Ratchasima',
                'Nakhon Sawan', 'Nakhon Si Thammarat', 'Nan', 'Narathiwat',
                'Nong Bua Lamphu', 'Nong Khai', 'Nonthaburi', 'Pathum Thani',
                'Pattani', 'Phang Nga', 'Phatthalung', 'Phayao', 'Phetchabun',
                'Phetchaburi', 'Phichit', 'Phitsanulok', 'Phra Nakhon Si Ayutthaya',
                'Phrae', 'Phuket', 'Prachinburi', 'Prachuap Khiri Khan', 'Ranong',
                'Ratchaburi', 'Rayong', 'Roi Et', 'Sa Kaeo', 'Sakon Nakhon',
                'Samut Prakan', 'Samut Sakhon', 'Samut Songkhram', 'Saraburi',
                'Satun', 'Sing Buri', 'Sisaket', 'Songkhla', 'Sukhothai',
                'Suphan Buri', 'Surat Thani', 'Surin', 'Tak', 'Trang', 'Trat',
                'Ubon Ratchathani', 'Udon Thani', 'Uthai Thani', 'Uttaradit',
                'Yala', 'Yasothon',
            ],
        ];
    }
    private function seVietnam(): array
    {
        return [
            'VN' => [
                'An Giang', 'Ba Ria-Vung Tau', 'Bac Giang', 'Bac Kan', 'Bac Lieu',
                'Bac Ninh', 'Ben Tre', 'Binh Dinh', 'Binh Duong', 'Binh Phuoc',
                'Binh Thuan', 'Ca Mau', 'Can Tho', 'Cao Bang', 'Da Nang',
                'Dak Lak', 'Dak Nong', 'Dien Bien', 'Dong Nai', 'Dong Thap',
                'Gia Lai', 'Ha Giang', 'Ha Nam', 'Ha Tinh', 'Hai Duong',
                'Hai Phong', 'Hanoi', 'Hau Giang', 'Ho Chi Minh', 'Hoa Binh',
                'Hung Yen', 'Khanh Hoa', 'Kien Giang', 'Kon Tum', 'Lai Chau',
                'Lam Dong', 'Lang Son', 'Lao Cai', 'Long An', 'Nam Dinh',
                'Nghe An', 'Ninh Binh', 'Ninh Thuan', 'Phu Tho', 'Phu Yen',
                'Quang Binh', 'Quang Nam', 'Quang Ngai', 'Quang Ninh', 'Quang Tri',
                'Soc Trang', 'Son La', 'Tay Ninh', 'Thai Binh', 'Thai Nguyen',
                'Thanh Hoa', 'Thua Thien Hue', 'Tien Giang', 'Tra Vinh',
                'Tuyen Quang', 'Vinh Long', 'Vinh Phuc', 'Yen Bai',
            ],
        ];
    }
    private function seMalaysia(): array
    {
        return [
            'MY' => [
                'Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan',
                'Malacca', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak',
                'Perlis', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu',
            ],
            'SG' => ['Central', 'East', 'North', 'North-East', 'West'],
            'BN' => ['Belait', 'Brunei-Muara', 'Temburong', 'Tutong'],
            'KH' => [
                'Banteay Meanchey', 'Battambang', 'Kampong Cham', 'Kampong Chhnang',
                'Kampong Speu', 'Kampong Thom', 'Kampot', 'Kandal', 'Kep', 'Koh Kong',
                'Kratie', 'Mondulkiri', 'Oddar Meanchey', 'Pailin', 'Phnom Penh',
                'Preah Sihanouk', 'Preah Vihear', 'Prey Veng', 'Pursat', 'Ratanakiri',
                'Siem Reap', 'Stung Treng', 'Svay Rieng', 'Takeo', 'Tboung Khmum',
            ],
            'LA' => [
                'Attapeu', 'Bokeo', 'Bolikhamsai', 'Champasak', 'Houaphanh',
                'Khammouane', 'Luang Namtha', 'Luang Prabang', 'Oudomxay', 'Phongsaly',
                'Salavan', 'Savannakhet', 'Sekong', 'Vientiane Capital', 'Vientiane',
                'Xaisomboun', 'Xayaburi', 'Xieng Khouang',
            ],
        ];
    }
    private function seIndonesia(): array
    {
        return [
            'ID' => [
                'Aceh', 'Bali', 'Bangka Belitung Islands', 'Banten', 'Bengkulu',
                'Central Java', 'Central Kalimantan', 'Central Sulawesi', 'East Java',
                'East Kalimantan', 'East Nusa Tenggara', 'Gorontalo', 'Jakarta', 'Jambi',
                'Lampung', 'Maluku', 'North Kalimantan', 'North Maluku', 'North Sulawesi',
                'North Sumatra', 'Papua', 'Central Papua', 'Highland Papua', 'South Papua',
                'Southwest Papua', 'West Papua', 'Riau', 'Riau Islands', 'South Kalimantan',
                'South Sulawesi', 'South Sumatra', 'Southeast Sulawesi', 'Special Region of Yogyakarta',
                'West Java', 'West Kalimantan', 'West Nusa Tenggara', 'West Sulawesi', 'West Sumatra',
            ],
        ];
    }
    private function sePhilippines(): array
    {
        return [
            'PH' => [
                'Ilocos Region', 'Cagayan Valley', 'Central Luzon', 'Calabarzon', 'Mimaropa',
                'Bicol Region', 'Western Visayas', 'Central Visayas', 'Eastern Visayas',
                'Zamboanga Peninsula', 'Northern Mindanao', 'Davao Region', 'Soccsksargen',
                'Caraga', 'Bangsamoro', 'National Capital Region', 'Cordillera Administrative Region',
            ],
        ];
    }
    private function seOthers(): array
    {
        return [
            'TL' => [
                'Aileu', 'Ainaro', 'Baucau', 'Bobonaro', 'Cova Lima', 'Dili', 'Ermera',
                'Lautem', 'Liquica', 'Manatuto', 'Manufahi', 'Oecusse', 'Viqueque',
            ],
        ];
    }
    private function statesAsiaWest(): array
    {
        return [
            // UAE — 7 emirates
            'AE' => [
                'Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah',
                'Ras Al Khaimah', 'Sharjah', 'Umm Al Quwain',
            ],
            // Saudi Arabia — 13 regions
            'SA' => [
                'Riyadh', 'Makkah', 'Madinah', 'Eastern Province', 'Asir',
                'Tabuk', 'Hail', 'Northern Borders', 'Jazan', 'Najran',
                'Al Bahah', 'Al Jouf', 'Qassim',
            ],
            // Qatar — 8 municipalities
            'QA' => [
                'Ad Dawhah', 'Al Khor', 'Al Rayyan', 'Al Shamal', 'Al Wakrah',
                'Az Zaayin', 'Umm Salal', 'Al Daayen',
            ],
            // Kuwait — 6 governorates
            'KW' => [
                'Al Ahmadi', 'Al Asimah', 'Al Farwaniyah', 'Al Jahra',
                'Hawalli', 'Mubarak Al-Kabeer',
            ],
            // Bahrain — 4 governorates
            'BH' => ['Capital', 'Muharraq', 'Northern', 'Southern'],
            // Oman — 11 governorates
            'OM' => [
                'Ad Dakhiliyah', 'Ad Dhahirah', 'Al Batinah North', 'Al Batinah South',
                'Al Buraimi', 'Al Wusta', 'Ash Sharqiyah North', 'Ash Sharqiyah South',
                'Dhofar', 'Muscat', 'Musandam',
            ],
            // Jordan — 12 governorates
            'JO' => [
                'Ajloun', 'Amman', 'Aqaba', 'Balqa', 'Irbid', 'Jerash', 'Karak',
                'Maan', 'Madaba', 'Mafraq', 'Tafilah', 'Zarqa',
            ],
            // Lebanon — 8 governorates
            'LB' => [
                'Akkar', 'Baalbek-Hermel', 'Beirut', 'Bekaa', 'Mount Lebanon',
                'Nabatieh', 'North Lebanon', 'South Lebanon',
            ],
            // Israel — 6 districts
            'IL' => ['Central', 'Haifa', 'Jerusalem', 'Northern', 'Southern', 'Tel Aviv'],
            // Iraq — 19 governorates
            'IQ' => [
                'Al Anbar', 'Babil', 'Baghdad', 'Basrah', 'Dhi Qar', 'Diyala',
                'Dohuk', 'Erbil', 'Karbala', 'Kirkuk', 'Maysan', 'Muthanna',
                'Najaf', 'Nineveh', 'Qadisiyyah', 'Salah ad Din', 'Sulaymaniyah',
                'Wasit', 'Halabja',
            ],
            // Iran — 31 provinces
            'IR' => [
                'Alborz', 'Ardabil', 'Bushehr', 'Chaharmahal and Bakhtiari',
                'East Azerbaijan', 'Fars', 'Gilan', 'Golestan', 'Hamadan',
                'Hormozgan', 'Ilam', 'Isfahan', 'Kerman', 'Kermanshah',
                'Khuzestan', 'Kohgiluyeh and Boyer-Ahmad', 'Kurdistan', 'Lorestan',
                'Markazi', 'Mazandaran', 'North Khorasan', 'Qazvin', 'Qom',
                'Razavi Khorasan', 'Semnan', 'Sistan and Baluchestan', 'South Khorasan',
                'Tehran', 'West Azerbaijan', 'Yazd', 'Zanjan',
            ],
        ];
    }
    private function statesEurope(): array
    {
        return [
            // United Kingdom — 4 nations
            'GB' => ['England', 'Scotland', 'Wales', 'Northern Ireland'],
            // Germany — 16 Bundeslander
            'DE' => [
                'Baden-Wurttemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen',
                'Hamburg', 'Hesse', 'Lower Saxony', 'Mecklenburg-Vorpommern',
                'North Rhine-Westphalia', 'Rhineland-Palatinate', 'Saarland', 'Saxony',
                'Saxony-Anhalt', 'Schleswig-Holstein', 'Thuringia',
            ],
            // France — 18 regions
            'FR' => [
                'Auvergne-Rhone-Alpes', 'Bourgogne-Franche-Comte', 'Brittany',
                'Centre-Val de Loire', 'Corsica', 'Grand Est', 'Hauts-de-France',
                'Ile-de-France', 'Normandy', 'Nouvelle-Aquitaine', 'Occitanie',
                'Pays de la Loire', 'Provence-Alpes-Cote d\'Azur', 'Guadeloupe',
                'Martinique', 'French Guiana', 'Reunion', 'Mayotte',
            ],
            // Italy — 20 regions
            'IT' => [
                'Abruzzo', 'Aosta Valley', 'Apulia', 'Basilicata', 'Calabria',
                'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio',
                'Liguria', 'Lombardy', 'Marche', 'Molise', 'Piedmont', 'Sardinia',
                'Sicily', 'Trentino-South Tyrol', 'Tuscany', 'Umbria', 'Veneto',
            ],
            // Spain — 17 autonomous communities + 2 cities
            'ES' => [
                'Andalusia', 'Aragon', 'Asturias', 'Balearic Islands', 'Basque Country',
                'Canary Islands', 'Cantabria', 'Castile and Leon', 'Castilla-La Mancha',
                'Catalonia', 'Extremadura', 'Galicia', 'La Rioja', 'Madrid',
                'Murcia', 'Navarre', 'Valencia', 'Ceuta', 'Melilla',
            ],
            // Netherlands — 12 provinces
            'NL' => [
                'Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen',
                'Limburg', 'North Brabant', 'North Holland', 'Overijssel',
                'South Holland', 'Utrecht', 'Zeeland',
            ],
            // Belgium — 11 provinces (incl. Brussels)
            'BE' => [
                'Antwerp', 'Brussels', 'East Flanders', 'Flemish Brabant',
                'Hainaut', 'Liege', 'Limburg', 'Luxembourg', 'Namur',
                'Walloon Brabant', 'West Flanders',
            ],
            // Switzerland — 26 cantons
            'CH' => [
                'Aargau', 'Appenzell Ausserrhoden', 'Appenzell Innerrhoden', 'Basel-Landschaft',
                'Basel-Stadt', 'Bern', 'Fribourg', 'Geneva', 'Glarus', 'Grisons',
                'Jura', 'Lucerne', 'Neuchatel', 'Nidwalden', 'Obwalden', 'Schaffhausen',
                'Schwyz', 'Solothurn', 'St. Gallen', 'Thurgau', 'Ticino', 'Uri',
                'Valais', 'Vaud', 'Zug', 'Zurich',
            ],
            // Austria — 9 states
            'AT' => [
                'Burgenland', 'Carinthia', 'Lower Austria', 'Salzburg', 'Styria',
                'Tyrol', 'Upper Austria', 'Vienna', 'Vorarlberg',
            ],
            // Portugal — 18 districts + 2 autonomous regions
            'PT' => [
                'Aveiro', 'Beja', 'Braga', 'Braganca', 'Castelo Branco', 'Coimbra',
                'Evora', 'Faro', 'Guarda', 'Leiria', 'Lisbon', 'Portalegre',
                'Porto', 'Santarem', 'Setubal', 'Viana do Castelo', 'Vila Real',
                'Viseu', 'Azores', 'Madeira',
            ],
            // Ireland — 26 counties
            'IE' => [
                'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin',
                'Galway', 'Kerry', 'Kildare', 'Kilkenny', 'Laois', 'Leitrim',
                'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan',
                'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Waterford',
                'Westmeath', 'Wexford', 'Wicklow',
            ],
        ];
    }
    private function statesEurope2(): array
    {
        return [
            // Sweden — 21 counties
            'SE' => [
                'Blekinge', 'Dalarna', 'Gavleborg', 'Gotland', 'Halland', 'Jamtland',
                'Jonkoping', 'Kalmar', 'Kronoberg', 'Norrbotten', 'Orebro', 'Ostergotland',
                'Skane', 'Sodermanland', 'Stockholm', 'Uppsala', 'Varmland',
                'Vasterbotten', 'Vasternorrland', 'Vastmanland', 'Vastra Gotaland',
            ],
            // Norway — 11 counties
            'NO' => [
                'Agder', 'Innlandet', 'More og Romsdal', 'Nordland', 'Oslo',
                'Rogaland', 'Troms og Finnmark', 'Trondelag', 'Vestfold og Telemark',
                'Vestland', 'Viken',
            ],
            // Finland — 19 regions
            'FI' => [
                'Aland Islands', 'Central Finland', 'Central Ostrobothnia', 'Kainuu',
                'Kanta-Hame', 'Kymenlaakso', 'Lapland', 'North Karelia', 'North Ostrobothnia',
                'North Savo', 'Ostrobothnia', 'Paijat-Hame', 'Pirkanmaa', 'Satakunta',
                'South Karelia', 'South Ostrobothnia', 'South Savo', 'Southwest Finland',
                'Uusimaa',
            ],
            // Denmark — 5 regions
            'DK' => [
                'Capital Region', 'Central Denmark', 'North Denmark',
                'Region Zealand', 'Southern Denmark',
            ],
            // Iceland — 8 regions
            'IS' => [
                'Capital', 'Eastern', 'Northeastern', 'Northwestern', 'Southern',
                'Southern Peninsula', 'Western', 'Westfjords',
            ],
            // Poland — 16 voivodeships
            'PL' => [
                'Greater Poland', 'Kuyavian-Pomeranian', 'Lesser Poland', 'Lodz',
                'Lower Silesian', 'Lublin', 'Lubusz', 'Masovian', 'Opole', 'Podlaskie',
                'Pomeranian', 'Silesian', 'Subcarpathian', 'Holy Cross',
                'Warmian-Masurian', 'West Pomeranian',
            ],
            // Czechia — 14 regions
            'CZ' => [
                'Prague', 'Central Bohemian', 'South Bohemian', 'Plzen', 'Karlovy Vary',
                'Usti nad Labem', 'Liberec', 'Hradec Kralove', 'Pardubice', 'Vysocina',
                'South Moravian', 'Olomouc', 'Zlin', 'Moravian-Silesian',
            ],
            // Slovakia — 8 regions
            'SK' => [
                'Bratislava', 'Trnava', 'Trencin', 'Nitra', 'Zilina',
                'Banska Bystrica', 'Presov', 'Kosice',
            ],
            // Hungary — 19 counties + capital
            'HU' => [
                'Bacs-Kiskun', 'Baranya', 'Bekes', 'Borsod-Abauj-Zemplen', 'Budapest',
                'Csongrad-Csanad', 'Fejer', 'Gyor-Moson-Sopron', 'Hajdu-Bihar', 'Heves',
                'Jasz-Nagykun-Szolnok', 'Komarom-Esztergom', 'Nograd', 'Pest', 'Somogy',
                'Szabolcs-Szatmar-Bereg', 'Tolna', 'Vas', 'Veszprem', 'Zala',
            ],
            // Romania — 41 counties + Bucharest
            'RO' => [
                'Alba', 'Arad', 'Arges', 'Bacau', 'Bihor', 'Bistrita-Nasaud', 'Botosani',
                'Brasov', 'Braila', 'Bucharest', 'Buzau', 'Caras-Severin', 'Calarasi',
                'Cluj', 'Constanta', 'Covasna', 'Dambovita', 'Dolj', 'Galati', 'Giurgiu',
                'Gorj', 'Harghita', 'Hunedoara', 'Ialomita', 'Iasi', 'Ilfov', 'Maramures',
                'Mehedinti', 'Mures', 'Neamt', 'Olt', 'Prahova', 'Satu Mare', 'Salaj',
                'Sibiu', 'Suceava', 'Teleorman', 'Timis', 'Tulcea', 'Vaslui', 'Valcea',
                'Vrancea',
            ],
            // Bulgaria — 28 provinces
            'BG' => [
                'Blagoevgrad', 'Burgas', 'Dobrich', 'Gabrovo', 'Haskovo', 'Kardzhali',
                'Kyustendil', 'Lovech', 'Montana', 'Pazardzhik', 'Pernik', 'Pleven',
                'Plovdiv', 'Razgrad', 'Ruse', 'Shumen', 'Silistra', 'Sliven',
                'Smolyan', 'Sofia', 'Sofia City', 'Stara Zagora', 'Targovishte',
                'Varna', 'Veliko Tarnovo', 'Vidin', 'Vratsa', 'Yambol',
            ],
            // Greece — 13 regions
            'GR' => [
                'Attica', 'Central Greece', 'Central Macedonia', 'Crete',
                'Eastern Macedonia and Thrace', 'Epirus', 'Ionian Islands',
                'North Aegean', 'Peloponnese', 'South Aegean', 'Thessaly',
                'Western Greece', 'Western Macedonia',
            ],
            // Russia — major federal subjects
            'RU' => [
                'Moscow', 'Saint Petersburg', 'Moscow Oblast', 'Krasnodar Krai',
                'Sverdlovsk Oblast', 'Rostov Oblast', 'Tatarstan', 'Bashkortostan',
                'Chelyabinsk Oblast', 'Nizhny Novgorod Oblast', 'Samara Oblast',
                'Krasnoyarsk Krai', 'Novosibirsk Oblast', 'Voronezh Oblast',
                'Perm Krai', 'Volgograd Oblast', 'Saratov Oblast', 'Stavropol Krai',
                'Tyumen Oblast', 'Irkutsk Oblast', 'Altai Krai', 'Belgorod Oblast',
                'Kemerovo Oblast', 'Tula Oblast', 'Leningrad Oblast', 'Vladimir Oblast',
                'Yaroslavl Oblast', 'Kaliningrad Oblast', 'Khabarovsk Krai',
                'Primorsky Krai', 'Sakha Republic', 'Sakhalin Oblast',
            ],
            // Turkey — 81 provinces
            'TR' => [
                'Adana', 'Adiyaman', 'Afyonkarahisar', 'Agri', 'Aksaray', 'Amasya',
                'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydin', 'Balikesir',
                'Bartin', 'Batman', 'Bayburt', 'Bilecik', 'Bingol', 'Bitlis',
                'Bolu', 'Burdur', 'Bursa', 'Canakkale', 'Cankiri', 'Corum',
                'Denizli', 'Diyarbakir', 'Duzce', 'Edirne', 'Elazig', 'Erzincan',
                'Erzurum', 'Eskisehir', 'Gaziantep', 'Giresun', 'Gumushane',
                'Hakkari', 'Hatay', 'Igdir', 'Isparta', 'Istanbul', 'Izmir',
                'Kahramanmaras', 'Karabuk', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri',
                'Kilis', 'Kirikkale', 'Kirklareli', 'Kirsehir', 'Kocaeli', 'Konya',
                'Kutahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Mugla',
                'Mus', 'Nevsehir', 'Nigde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya',
                'Samsun', 'Sanliurfa', 'Siirt', 'Sinop', 'Sirnak', 'Sivas',
                'Tekirdag', 'Tokat', 'Trabzon', 'Tunceli', 'Usak', 'Van',
                'Yalova', 'Yozgat', 'Zonguldak',
            ],
            // Ukraine — 24 oblasts + Kyiv + Crimea
            'UA' => [
                'Cherkasy', 'Chernihiv', 'Chernivtsi', 'Crimea', 'Dnipropetrovsk',
                'Donetsk', 'Ivano-Frankivsk', 'Kharkiv', 'Kherson', 'Khmelnytskyi',
                'Kirovohrad', 'Kyiv', 'Kyiv City', 'Luhansk', 'Lviv', 'Mykolaiv',
                'Odesa', 'Poltava', 'Rivne', 'Sumy', 'Ternopil', 'Vinnytsia',
                'Volyn', 'Zakarpattia', 'Zaporizhzhia', 'Zhytomyr',
            ],
        ];
    }
    private function statesAmericas(): array
    {
        return [
            // USA — 50 states + DC
            'US' => [
                'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
                'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
                'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
                'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
                'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
                'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
                'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
                'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas',
                'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
                'Wisconsin', 'Wyoming',
            ],
            // Canada — 10 provinces + 3 territories
            'CA' => [
                'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
                'Newfoundland and Labrador', 'Nova Scotia', 'Ontario',
                'Prince Edward Island', 'Quebec', 'Saskatchewan',
                'Northwest Territories', 'Nunavut', 'Yukon',
            ],
            // Mexico — 31 states + Mexico City
            'MX' => [
                'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
                'Chiapas', 'Chihuahua', 'Coahuila', 'Colima', 'Durango', 'Guanajuato',
                'Guerrero', 'Hidalgo', 'Jalisco', 'Mexico City', 'Mexico State',
                'Michoacan', 'Morelos', 'Nayarit', 'Nuevo Leon', 'Oaxaca', 'Puebla',
                'Queretaro', 'Quintana Roo', 'San Luis Potosi', 'Sinaloa', 'Sonora',
                'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatan', 'Zacatecas',
            ],
        ];
    }
    private function statesAmericas2(): array
    {
        return [
            // Brazil — 26 states + Federal District
            'BR' => [
                'Acre', 'Alagoas', 'Amapa', 'Amazonas', 'Bahia', 'Ceara',
                'Distrito Federal', 'Espirito Santo', 'Goias', 'Maranhao',
                'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Para',
                'Paraiba', 'Parana', 'Pernambuco', 'Piaui', 'Rio de Janeiro',
                'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondonia', 'Roraima',
                'Santa Catarina', 'Sao Paulo', 'Sergipe', 'Tocantins',
            ],
            // Argentina — 23 provinces + Buenos Aires
            'AR' => [
                'Buenos Aires', 'Buenos Aires City', 'Catamarca', 'Chaco', 'Chubut',
                'Cordoba', 'Corrientes', 'Entre Rios', 'Formosa', 'Jujuy', 'La Pampa',
                'La Rioja', 'Mendoza', 'Misiones', 'Neuquen', 'Rio Negro', 'Salta',
                'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero',
                'Tierra del Fuego', 'Tucuman',
            ],
            // Chile — 16 regions
            'CL' => [
                'Arica y Parinacota', 'Tarapaca', 'Antofagasta', 'Atacama', 'Coquimbo',
                'Valparaiso', 'Metropolitana de Santiago', 'O\'Higgins', 'Maule',
                'Nuble', 'Biobio', 'La Araucania', 'Los Rios', 'Los Lagos',
                'Aysen', 'Magallanes',
            ],
            // Colombia — 32 departments + capital district
            'CO' => [
                'Amazonas', 'Antioquia', 'Arauca', 'Atlantico', 'Bogota', 'Bolivar',
                'Boyaca', 'Caldas', 'Caqueta', 'Casanare', 'Cauca', 'Cesar', 'Choco',
                'Cordoba', 'Cundinamarca', 'Guainia', 'Guaviare', 'Huila', 'La Guajira',
                'Magdalena', 'Meta', 'Narino', 'Norte de Santander', 'Putumayo',
                'Quindio', 'Risaralda', 'San Andres y Providencia', 'Santander',
                'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupes', 'Vichada',
            ],
            // Peru — 25 regions + Lima
            'PE' => [
                'Amazonas', 'Ancash', 'Apurimac', 'Arequipa', 'Ayacucho', 'Cajamarca',
                'Callao', 'Cusco', 'Huancavelica', 'Huanuco', 'Ica', 'Junin',
                'La Libertad', 'Lambayeque', 'Lima', 'Lima Province', 'Loreto',
                'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martin',
                'Tacna', 'Tumbes', 'Ucayali',
            ],
            // Venezuela — 23 states + Capital District
            'VE' => [
                'Amazonas', 'Anzoategui', 'Apure', 'Aragua', 'Barinas', 'Bolivar',
                'Carabobo', 'Cojedes', 'Delta Amacuro', 'Capital District', 'Falcon',
                'Guarico', 'Lara', 'Merida', 'Miranda', 'Monagas', 'Nueva Esparta',
                'Portuguesa', 'Sucre', 'Tachira', 'Trujillo', 'La Guaira', 'Yaracuy',
                'Zulia',
            ],
            // Ecuador — 24 provinces
            'EC' => [
                'Azuay', 'Bolivar', 'Canar', 'Carchi', 'Chimborazo', 'Cotopaxi',
                'El Oro', 'Esmeraldas', 'Galapagos', 'Guayas', 'Imbabura', 'Loja',
                'Los Rios', 'Manabi', 'Morona Santiago', 'Napo', 'Orellana', 'Pastaza',
                'Pichincha', 'Santa Elena', 'Santo Domingo de los Tsachilas',
                'Sucumbios', 'Tungurahua', 'Zamora Chinchipe',
            ],
            // Bolivia — 9 departments
            'BO' => [
                'Beni', 'Chuquisaca', 'Cochabamba', 'La Paz', 'Oruro', 'Pando',
                'Potosi', 'Santa Cruz', 'Tarija',
            ],
            // Uruguay — 19 departments
            'UY' => [
                'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores',
                'Florida', 'Lavalleja', 'Maldonado', 'Montevideo', 'Paysandu',
                'Rio Negro', 'Rivera', 'Rocha', 'Salto', 'San Jose', 'Soriano',
                'Tacuarembo', 'Treinta y Tres',
            ],
            // Paraguay — 17 departments + capital
            'PY' => [
                'Alto Paraguay', 'Alto Parana', 'Amambay', 'Asuncion', 'Boqueron',
                'Caaguazu', 'Caazapa', 'Canindeyu', 'Central', 'Concepcion',
                'Cordillera', 'Guaira', 'Itapua', 'Misiones', 'Neembucu', 'Paraguari',
                'Presidente Hayes', 'San Pedro',
            ],
        ];
    }
    private function statesAfricaOceania(): array
    {
        return [
            // South Africa — 9 provinces
            'ZA' => [
                'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
                'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape',
            ],
            // Egypt — 27 governorates
            'EG' => [
                'Alexandria', 'Aswan', 'Asyut', 'Beheira', 'Beni Suef', 'Cairo',
                'Dakahlia', 'Damietta', 'Faiyum', 'Gharbia', 'Giza', 'Ismailia',
                'Kafr El Sheikh', 'Luxor', 'Matrouh', 'Minya', 'Monufia',
                'New Valley', 'North Sinai', 'Port Said', 'Qalyubia', 'Qena',
                'Red Sea', 'Sharqia', 'Sohag', 'South Sinai', 'Suez',
            ],
            // Nigeria — 36 states + FCT
            'NG' => [
                'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
                'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
                'Ekiti', 'Enugu', 'Federal Capital Territory', 'Gombe', 'Imo',
                'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
                'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
                'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
            ],
            // Kenya — 47 counties
            'KE' => [
                'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu',
                'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho',
                'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui',
                'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera',
                'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Murang\'a', 'Nairobi',
                'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri',
                'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi',
                'Trans-Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
            ],
            // Morocco — 12 regions
            'MA' => [
                'Beni Mellal-Khenifra', 'Casablanca-Settat', 'Draa-Tafilalet',
                'Fes-Meknes', 'Guelmim-Oued Noun', 'Laayoune-Sakia El Hamra',
                'Marrakesh-Safi', 'Oriental', 'Rabat-Sale-Kenitra', 'Souss-Massa',
                'Tanger-Tetouan-Al Hoceima', 'Dakhla-Oued Ed-Dahab',
            ],
            // Algeria — 58 provinces (top ones)
            'DZ' => [
                'Adrar', 'Algiers', 'Annaba', 'Batna', 'Bechar', 'Bejaia', 'Biskra',
                'Blida', 'Bordj Bou Arreridj', 'Bouira', 'Boumerdes', 'Chlef',
                'Constantine', 'Djelfa', 'El Bayadh', 'El Oued', 'El Tarf', 'Ghardaia',
                'Guelma', 'Illizi', 'Jijel', 'Khenchela', 'Laghouat', 'M\'Sila',
                'Mascara', 'Medea', 'Mila', 'Mostaganem', 'Naama', 'Oran', 'Ouargla',
                'Oum El Bouaghi', 'Relizane', 'Saida', 'Setif', 'Sidi Bel Abbes',
                'Skikda', 'Souk Ahras', 'Tamanrasset', 'Tebessa', 'Tiaret', 'Tindouf',
                'Tipaza', 'Tissemsilt', 'Tizi Ouzou', 'Tlemcen',
            ],
            // Tunisia — 24 governorates
            'TN' => [
                'Ariana', 'Beja', 'Ben Arous', 'Bizerte', 'Gabes', 'Gafsa',
                'Jendouba', 'Kairouan', 'Kasserine', 'Kebili', 'Kef', 'Mahdia',
                'Manouba', 'Medenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid',
                'Siliana', 'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan',
            ],
            // Ghana — 16 regions
            'GH' => [
                'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern',
                'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah',
                'Upper East', 'Upper West', 'Volta', 'Western', 'Western North',
            ],
            // Ethiopia — 11 regions + 2 chartered cities
            'ET' => [
                'Addis Ababa', 'Afar', 'Amhara', 'Benishangul-Gumuz', 'Dire Dawa',
                'Gambela', 'Harari', 'Oromia', 'Sidama', 'Somali',
                'South West Ethiopia', 'Southern Nations', 'Tigray',
            ],
            // Tanzania — 31 regions
            'TZ' => [
                'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera',
                'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara',
                'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pemba North',
                'Pemba South', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu',
                'Singida', 'Songwe', 'Tabora', 'Tanga', 'Zanzibar North',
                'Zanzibar South', 'Zanzibar Urban',
            ],
            // Australia — 6 states + 2 territories
            'AU' => [
                'New South Wales', 'Victoria', 'Queensland', 'Western Australia',
                'South Australia', 'Tasmania', 'Australian Capital Territory',
                'Northern Territory',
            ],
            // New Zealand — 16 regions
            'NZ' => [
                'Auckland', 'Bay of Plenty', 'Canterbury', 'Gisborne', 'Hawke\'s Bay',
                'Manawatu-Whanganui', 'Marlborough', 'Nelson', 'Northland', 'Otago',
                'Southland', 'Taranaki', 'Tasman', 'Waikato', 'Wellington', 'West Coast',
            ],
            // Fiji — 4 divisions
            'FJ' => ['Central', 'Eastern', 'Northern', 'Western'],
            // Papua New Guinea — 22 provinces
            'PG' => [
                'Bougainville', 'Central', 'Chimbu', 'East New Britain', 'East Sepik',
                'Eastern Highlands', 'Enga', 'Gulf', 'Hela', 'Jiwaka', 'Madang',
                'Manus', 'Milne Bay', 'Morobe', 'National Capital District',
                'New Ireland', 'Northern', 'Southern Highlands', 'West New Britain',
                'West Sepik', 'Western', 'Western Highlands',
            ],
        ];
    }
}

<?php

namespace Database\Seeders;

use App\Models\OrganizationType;
use Illuminate\Database\Seeder;

class OrganizationTypeSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            ['name' => 'Business',   'icon' => 'ri-briefcase-line',      'description' => 'Commercial or trading organizations'],
            ['name' => 'Sports',     'icon' => 'ri-basketball-line',     'description' => 'Sports clubs, academies, federations'],
            ['name' => 'Education',  'icon' => 'ri-graduation-cap-line', 'description' => 'Schools, colleges, training institutes'],
            ['name' => 'Healthcare', 'icon' => 'ri-hospital-line',       'description' => 'Hospitals, clinics, medical facilities'],
            ['name' => 'Government', 'icon' => 'ri-government-line',     'description' => 'Government bodies and agencies'],
            ['name' => 'NGO',        'icon' => 'ri-heart-line',          'description' => 'Non-governmental or non-profit organizations'],
            ['name' => 'Other',      'icon' => 'ri-building-line',       'description' => 'Any other organization type'],
        ];

        foreach ($types as $index => $t) {
            OrganizationType::updateOrCreate(
                ['slug' => strtolower(str_replace(' ', '-', $t['name']))],
                [
                    'name'        => $t['name'],
                    'icon'        => $t['icon'],
                    'description' => $t['description'],
                    'status'      => 'active',
                    'sort_order'  => $index + 1,
                ]
            );
        }
    }
}

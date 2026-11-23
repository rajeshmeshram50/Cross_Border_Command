<?php

namespace Database\Seeders;

use App\Models\ClmTncCategory;
use Illuminate\Database\Seeder;

class ClmTncCategorySeeder extends Seeder
{
    private const CATEGORIES = [
        'International Proforma Invoice' => 'IPI',
        'Domestic Proforma Invoice'     => 'DPI',
    ];

    public function run(): void
    {
        $standardNames = array_map('mb_strtolower', array_keys(self::CATEGORIES));

        $dupes = ClmTncCategory::whereNotNull('client_id')->get()
            ->filter(fn ($c) => in_array(mb_strtolower((string) $c->name), $standardNames, true));
        $removed = $dupes->count();
        $dupes->each->delete();

        $next = 0;
        foreach (ClmTncCategory::whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $created = 0;
        foreach (self::CATEGORIES as $name => $short) {
            $exists = ClmTncCategory::whereNull('client_id')
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($exists) {
                continue;
            }

            $next++;
            ClmTncCategory::create([
                'client_id'  => null,
                'code'       => sprintf('DC-%03d', $next),
                'short_code' => $short,
                'name'       => $name,
                'status'     => 'active',
            ]);
            $created++;
        }

        $this->command?->info("ClmTncCategorySeeder: created {$created} global category row(s); removed {$removed} per-client duplicate(s).");
    }
}

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const MERGE = [
        'international quotation' => 'International Proforma Invoice',
        'domestic quotation'     => 'Domestic Proforma Invoice',
    ];

    public function up(): void
    {
        foreach (self::MERGE as $fromLc => $to) {
            DB::table('clm_tnc_library')
                ->whereRaw('LOWER(category) = ?', [$fromLc])
                ->update(['category' => $to, 'updated_at' => now()]);
        }

        DB::table('clm_tnc_categories')
            ->where(function ($q) {
                foreach (array_keys(self::MERGE) as $lc) {
                    $q->orWhereRaw('LOWER(name) = ?', [$lc]);
                }
            })
            ->delete();
    }

    public function down(): void
    {
        $names = ['International Quotation' => 'IQ', 'Domestic Quotation' => 'DQ'];

        $next = 0;
        foreach (DB::table('clm_tnc_categories')->whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $now = now();
        foreach ($names as $name => $short) {
            $exists = DB::table('clm_tnc_categories')
                ->whereNull('client_id')
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($exists) {
                continue;
            }
            $next++;
            DB::table('clm_tnc_categories')->insert([
                'client_id'  => null,
                'code'       => sprintf('DC-%03d', $next),
                'short_code' => $short,
                'name'       => $name,
                'status'     => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
};

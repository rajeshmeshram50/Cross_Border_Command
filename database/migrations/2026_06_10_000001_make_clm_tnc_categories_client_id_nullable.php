<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const CATEGORIES = [
        'International Quotation'        => 'IQ',
        'Domestic Quotation'            => 'DQ',
        'International Proforma Invoice' => 'IPI',
        'Domestic Proforma Invoice'     => 'DPI',
    ];

    public function up(): void
    {
        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
        });

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable()->change();
            $table->foreign('client_id')->references('id')->on('clients')->cascadeOnDelete();
        });

        $names = array_keys(self::CATEGORIES);

        DB::table('clm_tnc_categories')
            ->whereNotNull('client_id')
            ->where(function ($q) use ($names) {
                foreach ($names as $name) {
                    $q->orWhereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
                }
            })
            ->delete();

        $next = 0;
        foreach (DB::table('clm_tnc_categories')->whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $now = now();
        foreach (self::CATEGORIES as $name => $short) {
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

    public function down(): void
    {
        DB::table('clm_tnc_categories')->whereNull('client_id')->delete();

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
        });

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable(false)->change();
            $table->foreign('client_id')->references('id')->on('clients')->cascadeOnDelete();
        });
    }
};

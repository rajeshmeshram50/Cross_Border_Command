<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_customer_types', function (Blueprint $table) {
            if (!Schema::hasColumn('master_customer_types', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        $fixed = [
            ['name' => 'Retailer',   'gst_applicable' => 'Yes'],
            ['name' => 'Wholesaler', 'gst_applicable' => 'Yes'],
        ];
        foreach ($fixed as $row) {
            $existing = DB::table('master_customer_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($row['name'])])
                ->first();

            $payload = [
                'name'           => $row['name'],
                'gst_applicable' => $row['gst_applicable'],
                'status'         => 'Active',
                'is_system'      => true,
                'updated_at'     => now(),
            ];

            if ($existing) {
                DB::table('master_customer_types')
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('master_customer_types')->insert(array_merge($payload, [
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_at' => now(),
                ]));
            }
        }

        DB::table('master_customer_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        DB::table('master_customer_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['retailer', 'wholesaler'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        Schema::table('master_customer_types', function (Blueprint $table) {
            if (Schema::hasColumn('master_customer_types', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};

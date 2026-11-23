<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const FIXED = [
        'Material/ Goods'       => ['material',  null,                null],
        'FFD/ Transporter'      => ['logistics', null,                null],
        'Soft Service Provider' => ['services',  'soft_digital',      null],
        'Trackable Services'    => ['services',  'self_consumable',   'trackable'],
        'Consumable Services'   => ['services',  'self_consumable',   'consumable'],
        'Professional Services' => ['services',  'other_operational', 'professional'],
        'Utility Services'      => ['services',  'other_operational', 'utility'],
        'Facility Services'     => ['services',  'other_operational', 'facility'],
        'Maintenance Services'  => ['services',  'other_operational', 'maintenance'],
        'Outsourcing Services'  => ['services',  'other_operational', 'outsourcing'],
    ];

    public function up(): void
    {
        Schema::table('master_vendor_types', function (Blueprint $table) {
            if (!Schema::hasColumn('master_vendor_types', 'kind')) {
                $table->string('kind', 16)->nullable()->after('name');
            }
            if (!Schema::hasColumn('master_vendor_types', 'service_type')) {
                $table->string('service_type', 32)->nullable()->after('kind');
            }
            if (!Schema::hasColumn('master_vendor_types', 'classification')) {
                $table->string('classification', 32)->nullable()->after('service_type');
            }
            if (!Schema::hasColumn('master_vendor_types', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        Schema::table('master_vendor_types', function (Blueprint $table) {
            $table->index(['kind'], 'master_vendor_types_kind_index');
        });

        foreach (self::FIXED as $name => [$kind, $serviceType, $classification]) {
            $existing = DB::table('master_vendor_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->first();

            $payload = [
                'name'           => $name,
                'kind'           => $kind,
                'service_type'   => $serviceType,
                'classification' => $classification,
                'status'         => 'Active',
                'is_system'      => true,
                'updated_at'     => now(),
            ];

            if ($existing) {
                DB::table('master_vendor_types')->where('id', $existing->id)->update($payload);
            } else {
                DB::table('master_vendor_types')->insert($payload + [
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_at' => now(),
                ]);
            }
        }

        DB::table('master_vendor_types')->whereNull('kind')
            ->where(function ($w) {
                foreach (['logist', 'transport', 'ffd', 'freight'] as $t) {
                    $w->orWhereRaw('LOWER(name) LIKE ?', ["%{$t}%"]);
                }
            })
            ->update(['kind' => 'logistics', 'updated_at' => now()]);

        DB::table('master_vendor_types')->whereNull('kind')
            ->whereRaw('LOWER(name) LIKE ?', ['%service%'])
            ->update(['kind' => 'services', 'updated_at' => now()]);

        DB::table('master_vendor_types')->whereNull('kind')
            ->update(['kind' => 'material', 'updated_at' => now()]);
    }

    public function down(): void
    {
        DB::table('master_vendor_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->update(['is_system' => false, 'updated_at' => now()]);

        Schema::table('master_vendor_types', function (Blueprint $table) {
            $table->dropIndex('master_vendor_types_kind_index');
            foreach (['kind', 'service_type', 'classification', 'is_system'] as $c) {
                if (Schema::hasColumn('master_vendor_types', $c)) {
                    $table->dropColumn($c);
                }
            }
        });
    }
};

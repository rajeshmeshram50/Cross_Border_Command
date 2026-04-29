<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_assets', function (Blueprint $table) {
            if (!Schema::hasColumn('master_assets', 'code')) {
                $table->string('code', 32)->nullable()->after('asset_name');
            }
            if (!Schema::hasColumn('master_assets', 'description')) {
                $table->text('description')->nullable()->after('asset_type_id');
            }
            if (!Schema::hasColumn('master_assets', 'vendor_id')) {
                $table->unsignedBigInteger('vendor_id')->nullable()->after('description')->index();
            }
            if (!Schema::hasColumn('master_assets', 'purchase_date')) {
                $table->date('purchase_date')->nullable()->after('vendor_id');
            }
            if (!Schema::hasColumn('master_assets', 'warranty_expiry_date')) {
                $table->date('warranty_expiry_date')->nullable()->after('purchase_date');
            }
            if (!Schema::hasColumn('master_assets', 'invoice_file_path')) {
                $table->string('invoice_file_path', 512)->nullable()->after('warranty_expiry_date');
            }
            if (!Schema::hasColumn('master_assets', 'warranty_card_file_path')) {
                $table->string('warranty_card_file_path', 512)->nullable()->after('invoice_file_path');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_assets', function (Blueprint $table) {
            $table->dropColumn([
                'code',
                'description',
                'vendor_id',
                'purchase_date',
                'warranty_expiry_date',
                'invoice_file_path',
                'warranty_card_file_path',
            ]);
        });
    }
};

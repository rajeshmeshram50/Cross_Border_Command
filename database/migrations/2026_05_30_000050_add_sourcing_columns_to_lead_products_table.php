<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lead_products', function (Blueprint $table) {
            $table->enum('sourcing_status', ['required', 'not_required'])
                ->nullable()
                ->after('notes');
            $table->boolean('procurement_done')
                ->default(false)
                ->after('sourcing_status');
        });
    }

    public function down(): void
    {
        Schema::table('lead_products', function (Blueprint $table) {
            $table->dropColumn(['sourcing_status', 'procurement_done']);
        });
    }
};

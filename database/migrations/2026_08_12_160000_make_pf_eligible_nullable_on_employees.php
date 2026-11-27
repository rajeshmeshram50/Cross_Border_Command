<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->boolean('pf_eligible')->nullable()->default(null)->change();
        });
    }

    public function down(): void
    {
        DB::table('employees')->whereNull('pf_eligible')->update(['pf_eligible' => false]);

        Schema::table('employees', function (Blueprint $table) {
            $table->boolean('pf_eligible')->nullable(false)->default(false)->change();
        });
    }
};

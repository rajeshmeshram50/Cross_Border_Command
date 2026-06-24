<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            if (Schema::hasColumn('ctc_contracts', 'termination_notice')) {
                $table->dropColumn('termination_notice');
            }
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            if (! Schema::hasColumn('ctc_contracts', 'termination_notice')) {
                $table->unsignedSmallInteger('termination_notice')->nullable();
            }
        });
    }
};

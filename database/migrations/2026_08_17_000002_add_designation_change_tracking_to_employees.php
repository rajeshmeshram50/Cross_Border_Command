<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedBigInteger('previous_designation_id')->nullable()->after('designation_id');

            $table->timestamp('designation_changed_at')->nullable()->after('previous_designation_id');

            $table->index('previous_designation_id');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['previous_designation_id']);
            $table->dropColumn(['previous_designation_id', 'designation_changed_at']);
        });
    }
};

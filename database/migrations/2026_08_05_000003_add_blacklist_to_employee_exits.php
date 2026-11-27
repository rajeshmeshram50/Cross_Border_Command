<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->string('blacklisted', 3)->nullable()->after('hr_sign_off');
            $table->string('blacklist_reason', 500)->nullable()->after('blacklisted');
            $table->index('blacklisted');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['blacklisted']);
            $table->dropColumn(['blacklisted', 'blacklist_reason']);
        });
    }
};

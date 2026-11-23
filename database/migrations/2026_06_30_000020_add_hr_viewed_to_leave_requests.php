<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->timestamp('hr_viewed_at')->nullable()->after('approver_comment');
            $table->unsignedBigInteger('hr_viewed_by')->nullable()->after('hr_viewed_at');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn(['hr_viewed_at', 'hr_viewed_by']);
        });
    }
};

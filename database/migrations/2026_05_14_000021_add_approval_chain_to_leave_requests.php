<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->json('approval_chain')->nullable()->after('approver_comment');
            $table->unsignedSmallInteger('current_approval_level')->default(1)->after('approval_chain');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn(['approval_chain', 'current_approval_level']);
        });
    }
};

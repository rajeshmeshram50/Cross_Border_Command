<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->string('settle_approval_status', 12)->nullable()->after('employee_settled_at');
            $table->unsignedBigInteger('settle_approved_by')->nullable()->after('settle_approval_status');
            $table->timestamp('settle_approved_at')->nullable()->after('settle_approved_by');
            $table->string('settle_approval_comment', 500)->nullable()->after('settle_approved_at');
        });

        DB::table('advance_requests')
            ->whereNotNull('employee_settled_at')
            ->whereNull('settle_approval_status')
            ->update(['settle_approval_status' => 'approved']);
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn([
                'settle_approval_status',
                'settle_approved_by',
                'settle_approved_at',
                'settle_approval_comment',
            ]);
        });
    }
};

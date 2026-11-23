<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->boolean('sandwich_waived')->default(false)->after('days');
            $table->unsignedBigInteger('sandwich_waived_by')->nullable()->after('sandwich_waived');
            $table->timestamp('sandwich_waived_at')->nullable()->after('sandwich_waived_by');
            $table->string('sandwich_waiver_reason', 255)->nullable()->after('sandwich_waived_at');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn([
                'sandwich_waived',
                'sandwich_waived_by',
                'sandwich_waived_at',
                'sandwich_waiver_reason',
            ]);
        });
    }
};

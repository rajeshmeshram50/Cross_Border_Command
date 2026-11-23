<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->boolean('documents_released')->default(false)->after('handover_notes');
            $table->timestamp('documents_released_at')->nullable()->after('documents_released');
            $table->unsignedBigInteger('documents_released_by')->nullable()->after('documents_released_at');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropColumn(['documents_released', 'documents_released_at', 'documents_released_by']);
        });
    }
};

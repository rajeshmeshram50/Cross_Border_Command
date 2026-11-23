<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scan_devices', function (Blueprint $table) {
            $table->unsignedBigInteger('enrolled_by')->nullable()->after('created_by');
            $table->timestamp('enrolled_at')->nullable()->after('enrolled_by');
            $table->index('enrolled_by');
        });
    }

    public function down(): void
    {
        Schema::table('scan_devices', function (Blueprint $table) {
            $table->dropIndex(['enrolled_by']);
            $table->dropColumn(['enrolled_by', 'enrolled_at']);
        });
    }
};

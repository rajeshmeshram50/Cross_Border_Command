<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            $table->unsignedBigInteger('hiring_request_id')->nullable()->after('client_id');
            $table->index('hiring_request_id', 'recruitments_hiring_request_idx');
        });
    }

    public function down(): void
    {
        Schema::table('recruitments', function (Blueprint $table) {
            $table->dropIndex('recruitments_hiring_request_idx');
            $table->dropColumn('hiring_request_id');
        });
    }
};

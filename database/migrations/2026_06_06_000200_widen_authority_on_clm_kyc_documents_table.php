<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_kyc_documents', function (Blueprint $table) {
            $table->text('authority')->change();
        });
    }

    public function down(): void
    {
        Schema::table('clm_kyc_documents', function (Blueprint $table) {
            $table->string('authority', 255)->change();
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Due Diligence documents can now map to MULTIPLE issuing authorities.
 * The names are stored comma-joined in the existing `authority` column,
 * which can outgrow the original 255-char limit — widen it to TEXT.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_dd_documents', function (Blueprint $table) {
            $table->text('authority')->change();
        });
    }

    public function down(): void
    {
        Schema::table('clm_dd_documents', function (Blueprint $table) {
            $table->string('authority', 255)->change();
        });
    }
};

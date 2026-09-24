<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Document codes (KYC-012, TL-023, …) used to be allocated from the highest
 * code still in the table, so deleting the last row handed its code straight to
 * the next document created. Segment rules and segment doc uploads reference a
 * document BY CODE, so the new document silently inherited the old one's links
 * and came out of an import already "in use" and undeletable.
 *
 * This counter keeps the high-water mark per client + branch + prefix, so a
 * number is never issued twice even after the row that held it is gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_doc_code_counters', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id');
            // 0 stands for "no branch" — a NULL would not be caught by the
            // unique index on Postgres, which is what keeps one row per scope.
            $table->unsignedBigInteger('branch_key')->default(0);
            $table->string('prefix', 16);
            $table->unsignedInteger('last_n')->default(0);
            $table->timestamps();

            $table->unique(['client_id', 'branch_key', 'prefix'], 'clm_doc_code_counters_scope_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_doc_code_counters');
    }
};

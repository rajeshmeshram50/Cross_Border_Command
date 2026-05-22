<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Trade Document Names master (Trade Docs · List tab).
 *
 * Lightweight catalogue of trade-document categories (Self Declaration,
 * Undertaking Letter, …). Pure code+name; the heavier metadata lives on
 * the library row (`clm_trade_doc_library`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_trade_doc_names', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // TDN-001
            $table->string('name', 255);

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_trade_doc_names');
    }
};

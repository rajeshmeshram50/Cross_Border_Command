<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Trade Document Library (Trade Docs · Library tab).
 *
 * Reusable trade-document templates — one row per concrete draft (e.g.
 * "Supplier Self Declaration Form"). Each row points at a Trade Document
 * Name from `clm_trade_doc_names` via `name_code` (the prototype's TDN-NNN
 * key) but storing the string keeps the row resilient if a name is renamed.
 *
 * `party` is a comma-separated list ("Buyer, Supplier, …") — the prototype
 * displayed it as a string and never split it client-side.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_trade_doc_library', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // TD-001
            $table->string('name', 255);         // Self Declaration (mirrors the TDN it descended from)
            $table->string('title', 255);        // "Supplier Self Declaration Form"
            $table->string('doc_type', 64);      // Declaration | Undertaking | Authorization | Bond | …
            $table->string('purpose', 500);
            $table->string('party', 255);        // CSV of parties
            $table->string('file_path', 500)->nullable();    // Storage-relative; nullable until uploaded

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'doc_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_trade_doc_library');
    }
};

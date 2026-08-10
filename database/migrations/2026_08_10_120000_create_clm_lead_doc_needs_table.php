<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-DEAL decision on whether a segment-applicable document is actually needed.
 *
 * Until now the popup's REQ / OPT pill came from the SEGMENT's regulatory tier
 * (ClmAgreementController: `$seg->regulatory_status === 'highly' ? 'M' : 'O'`),
 * so every document under one segment carried the same label and nothing on the
 * screen said which ones this particular deal should send. The decision had
 * nowhere to live.
 *
 * Keyed by the library row rather than by a copy of it: the catalogue keeps
 * owning the document, and this table only records the deal's answer about it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('clm_lead_doc_needs')) return;

        Schema::create('clm_lead_doc_needs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->index();
            $table->unsignedBigInteger('lead_id')->index();
            // 'trade_doc' | 'agreement' — the two catalogues the popup lists.
            $table->string('doc_kind', 16);
            // clm_trade_doc_library.id or clm_agreement_library.id. Deliberately
            // no FK: the libraries are soft-deleted/edited independently, and a
            // retired document must not take the deal's history with it.
            $table->unsignedBigInteger('doc_id');
            $table->boolean('needed')->default(true);
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->timestamps();

            // One answer per document per deal — the UI toggles, never appends.
            $table->unique(['lead_id', 'doc_kind', 'doc_id'], 'clm_lead_doc_needs_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_lead_doc_needs');
    }
};

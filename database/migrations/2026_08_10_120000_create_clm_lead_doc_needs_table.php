<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('clm_lead_doc_needs')) return;

        Schema::create('clm_lead_doc_needs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->index();
            $table->unsignedBigInteger('lead_id')->index();
            $table->string('doc_kind', 16);
            $table->unsignedBigInteger('doc_id');
            $table->boolean('needed')->default(true);
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->timestamps();

            $table->unique(['lead_id', 'doc_kind', 'doc_id'], 'clm_lead_doc_needs_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_lead_doc_needs');
    }
};

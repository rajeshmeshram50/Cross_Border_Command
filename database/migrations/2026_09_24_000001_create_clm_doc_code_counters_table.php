<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_doc_code_counters', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id');
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

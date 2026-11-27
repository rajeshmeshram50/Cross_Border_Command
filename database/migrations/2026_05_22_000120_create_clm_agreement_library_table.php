<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_agreement_library', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);
            $table->string('agreement_type', 255);
            $table->string('title', 255);
            $table->string('party', 255);
            $table->string('regulatory', 16)->default('less');
            $table->boolean('signing')->default(true);
            $table->string('segment', 64)->nullable();
            $table->string('agr_status', 32)->default('Active');

            $table->text('content')->nullable();

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'agreement_type']);
            $table->index(['client_id', 'regulatory']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_agreement_library');
    }
};

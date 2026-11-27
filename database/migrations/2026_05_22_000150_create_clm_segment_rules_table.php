<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_segment_rules', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('segment_id')->nullable()->constrained('clm_segments')->nullOnDelete();
            $table->string('segment_code', 16);

            $table->string('rule_code', 16);
            $table->string('regulatory_status', 16);
            $table->json('auths_json')->nullable();
            $table->json('doc_selections');

            $table->unsignedInteger('mandatory_count')->default(0);
            $table->unsignedInteger('optional_count')->default(0);

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'rule_code']);
            $table->index(['client_id', 'segment_id']);
            $table->index(['client_id', 'regulatory_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_segment_rules');
    }
};

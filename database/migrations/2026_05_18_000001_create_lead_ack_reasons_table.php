<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_ack_reasons', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('opportunity_type', 24);

            $table->string('reason', 500);

            $table->string('status', 16)->default('active');

            $table->string('dq_status', 16)->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->index(['client_id', 'opportunity_type', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_ack_reasons');
    }
};

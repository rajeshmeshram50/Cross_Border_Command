<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_task_managers', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();

            $table->decimal('order_value', 15, 2)->nullable();
            $table->date('buying_plan')->nullable();

            $table->string('name', 255);
            $table->string('mobile_no', 32);
            $table->string('email', 255);

            $table->string('attachment', 500)->nullable();
            $table->string('attachment_original', 255)->nullable();

            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'lead_id'], 'lead_task_managers_tenant_lead_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_task_managers');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();

            // Branch Info
            $table->string('name', 255)->nullable();
            $table->string('code', 50)->nullable(); // branch code for reference
            $table->string('email', 255)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('contact_person', 255)->nullable();

            // Address
            $table->text('address')->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state', 100)->nullable();
            $table->string('pincode', 10)->nullable();
            $table->string('country', 100)->nullable()->default('India');

            // Hierarchy
            $table->boolean('is_main')->nullable()->default(false); // main branch sees ALL branches data

            // Status
            $table->string('status', 20)->nullable()->default('active'); // active, inactive

            // Meta
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // Indexes
            $table->index('client_id');
            $table->index('is_main');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branches');
    }
};

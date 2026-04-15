<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clients', function (Blueprint $table) {
            $table->id();

            // Organization Info
            $table->string('org_name', 255)->nullable();
            $table->string('unique_number', 50)->unique()->nullable(); // Auto: EA + timestamp
            $table->string('email', 255)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('website', 500)->nullable();

            // Address
            $table->text('address')->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state', 100)->nullable();
            $table->string('district', 100)->nullable();
            $table->string('taluka', 100)->nullable();
            $table->string('pincode', 10)->nullable();
            $table->string('country', 100)->nullable()->default('India');

            // Classification
            $table->string('org_type', 50)->nullable(); // Business, Sports, Education
            $table->string('sports', 100)->nullable();
            $table->string('industry', 100)->nullable(); // future: industry classification
            $table->string('gst_number', 20)->nullable();
            $table->string('pan_number', 20)->nullable();

            // Plan & Billing
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->string('plan_type', 20)->nullable()->default('free'); // free, paid
            $table->string('status', 20)->nullable()->default('inactive'); // inactive, active, suspended
            $table->date('plan_expires_at')->nullable();

            // Branding (White Label)
            $table->string('primary_color', 7)->nullable()->default('#4F46E5');
            $table->string('secondary_color', 7)->nullable()->default('#10B981');
            $table->string('logo', 500)->nullable();
            $table->string('favicon', 500)->nullable();

            // Meta
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // Indexes
            $table->index('status');
            $table->index('plan_type');
            $table->index('org_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clients');
    }
};

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

            $table->string('name', 255)->nullable();
            $table->string('code', 50)->nullable();
            $table->string('email', 255)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('contact_person', 255)->nullable();

            $table->text('address')->nullable();
            $table->string('city', 100)->nullable();
            $table->string('state', 100)->nullable();
            $table->string('pincode', 10)->nullable();
            $table->string('country', 100)->nullable()->default('India');

            $table->boolean('is_main')->nullable()->default(false);

            $table->string('status', 20)->nullable()->default('active');

            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

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

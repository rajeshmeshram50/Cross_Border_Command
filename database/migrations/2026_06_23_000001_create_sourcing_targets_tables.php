<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sourcing_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('code', 32);
            $table->string('source', 16)->default('master');
            $table->date('start_date');
            $table->date('due_date');

            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'code']);
            $table->index('branch_id');
            $table->index('assignee_id');
        });

        Schema::create('sourcing_target_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sourcing_target_id')->constrained('sourcing_targets')->cascadeOnDelete();

            $table->string('source', 16)->default('master');
            $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_code', 64)->nullable();
            $table->string('product_name', 500);
            $table->string('segment', 255)->nullable();
            $table->string('hsn_code', 32)->nullable();
            $table->decimal('target_price', 15, 2)->nullable();

            $table->string('clarity_type', 8)->nullable();
            $table->text('clarity_value')->nullable();
            $table->string('clarity_path', 500)->nullable();

            $table->boolean('is_completed')->default(false);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('sourcing_target_id');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sourcing_target_products');
        Schema::dropIfExists('sourcing_targets');
    }
};

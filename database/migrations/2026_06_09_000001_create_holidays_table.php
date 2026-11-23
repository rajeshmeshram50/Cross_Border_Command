<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('holidays', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            $table->string('code', 20)->nullable()->index();

            $table->string('name', 191);
            $table->date('date');
            $table->string('type', 30)->default('Public');
            $table->boolean('is_recurring')->default(false);
            $table->text('description')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'date'], 'holidays_tenant_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('holidays');
    }
};

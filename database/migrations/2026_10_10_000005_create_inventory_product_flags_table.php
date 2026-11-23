<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_product_flags', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('flag_name', 120)->nullable();
            $t->string('purpose', 255)->nullable();

            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['client_id', 'status'], 'inv_flag_client_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_product_flags');
    }
};

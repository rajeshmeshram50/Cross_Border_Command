<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_warehouses', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('wh_name', 180)->nullable();
            $t->enum('wh_type', ['own', 'tpl'])->nullable();
            $t->decimal('area_sqft', 14, 2)->nullable();

            $t->text('address')->nullable();
            $t->string('country', 100)->nullable();
            $t->string('state', 100)->nullable();
            $t->string('city', 100)->nullable();
            $t->string('pincode', 20)->nullable();
            $t->string('map_url', 500)->nullable();

            $t->string('contact_person', 150)->nullable();
            $t->string('contact_dial', 8)->nullable();
            $t->string('contact_mobile', 20)->nullable();
            $t->string('contact_email', 120)->nullable();
            $t->string('card_path', 500)->nullable();
            $t->string('card_name', 255)->nullable();

            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['client_id', 'status'], 'inv_wh_client_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_warehouses');
    }
};

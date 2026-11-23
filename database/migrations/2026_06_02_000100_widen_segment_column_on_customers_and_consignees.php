<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('segment', 1024)->nullable()->change();
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->string('segment', 1024)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('segment', 64)->nullable()->change();
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->string('segment', 64)->nullable()->change();
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique('leads_client_opp_code_unique');
            $table->unique(['client_id', 'branch_id', 'opp_code'], 'leads_client_branch_opp_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique('leads_client_branch_opp_code_unique');
            $table->unique(['client_id', 'opp_code'], 'leads_client_opp_code_unique');
        });
    }
};

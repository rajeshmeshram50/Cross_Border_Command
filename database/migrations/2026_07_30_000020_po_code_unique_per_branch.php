<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PO numbering is now a SEPARATE sequence per branch (QA #20): each branch
 * restarts at PO/{FY}/001, so the same code can legitimately repeat across
 * branches within one client. Relax the uniqueness from (client_id, code) to
 * (client_id, branch_id, code) so those per-branch duplicates are allowed while
 * a code still can't repeat within the same branch.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropUnique(['client_id', 'code']);
            $table->unique(['client_id', 'branch_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropUnique(['client_id', 'branch_id', 'code']);
            $table->unique(['client_id', 'code']);
        });
    }
};

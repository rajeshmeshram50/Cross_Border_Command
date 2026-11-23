<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->string('status', 16)->default('pending')->after('destination');
            $t->timestamp('assigned_at')->nullable()->after('status');
            $t->unsignedBigInteger('assigned_by')->nullable()->after('assigned_at');
        });

        DB::statement(
            "alter table p2p_spi_putaways add constraint p2p_spi_putaways_status_check
             check (status in ('pending','draft','awaiting_scan','placed'))"
        );

        DB::table('p2p_spi_putaways')->whereNotNull('confirmed_at')->update(['status' => 'placed']);
        DB::table('p2p_spi_putaways')->whereNull('confirmed_at')
            ->where(fn ($q) => $q->whereNotNull('shelf_id')->orWhereNotNull('zone_id'))
            ->update(['status' => 'draft']);

        DB::statement(
            "create index idx_putaway_open_branch on p2p_spi_putaways (branch_id, status)
             where status <> 'placed' and deleted_at is null"
        );
        DB::statement(
            "create index idx_putaway_open_spi on p2p_spi_putaways (supplier_invoice_id, status)
             where status <> 'placed' and deleted_at is null"
        );
    }

    public function down(): void
    {
        DB::statement('drop index if exists idx_putaway_open_branch');
        DB::statement('drop index if exists idx_putaway_open_spi');
        DB::statement('alter table p2p_spi_putaways drop constraint if exists p2p_spi_putaways_status_check');

        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->dropColumn(['status', 'assigned_at', 'assigned_by']);
        });
    }
};

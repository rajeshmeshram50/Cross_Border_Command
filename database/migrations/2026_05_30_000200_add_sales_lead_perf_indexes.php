<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P4 + P5 + P8 — Composite indexes that speed up the Sales Lead worksheet.
 *
 * - The worksheet list + tab counters scope by (client_id, qualified,
 *   disqualified) and sort by `id DESC`. Without a covering index every
 *   page load scans the full leads table for the client; with one we
 *   serve the page from an index.
 *
 * - The same screen filters by lead_stage_id, platform, query_type and
 *   does a created_at-desc default sort. (client_id, lead_stage_id,
 *   created_at) covers the stage tabs in the future + the default order.
 *
 * - The shared-price endpoint we just locked down (B1) reads by
 *   (client_id, lead_id, shared_at DESC). A small composite there pays
 *   for itself once lead_product_shared_prices grows past a few thousand
 *   rows.
 *
 * Names are explicit so a future down() / drop is unambiguous and we
 * don't accidentally collide with Postgres' implicit FK indexes.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $t) {
            // (client_id, qualified, disqualified, id DESC) — worksheet
            // tab counters + default listing order all benefit.
            if (!$this->indexExists('leads', 'leads_tab_counters_idx')) {
                $t->index(['client_id', 'qualified', 'disqualified', 'id'], 'leads_tab_counters_idx');
            }
            // (client_id, lead_stage_id, created_at) — stage-pill filters
            // + dashboard tiles that aggregate by stage.
            if (!$this->indexExists('leads', 'leads_stage_created_idx')) {
                $t->index(['client_id', 'lead_stage_id', 'created_at'], 'leads_stage_created_idx');
            }
            // Search hot-columns. We can't make a true full-text index
            // for the LIKE %x% queries the agent flagged, but a btree
            // on (client_id, sender_email) speeds the equality-prefix
            // path (`sender_email ILIKE 'foo%'`) which is the worksheet
            // search bar's actual behaviour.
            if (!$this->indexExists('leads', 'leads_sender_email_idx')) {
                $t->index(['client_id', 'sender_email'], 'leads_sender_email_idx');
            }
            if (!$this->indexExists('leads', 'leads_sender_company_idx')) {
                $t->index(['client_id', 'sender_company'], 'leads_sender_company_idx');
            }
        });

        if (Schema::hasTable('lead_product_shared_prices')) {
            Schema::table('lead_product_shared_prices', function (Blueprint $t) {
                if (!$this->indexExists('lead_product_shared_prices', 'lpsp_client_lead_shared_idx')) {
                    $t->index(['client_id', 'lead_id', 'shared_at'], 'lpsp_client_lead_shared_idx');
                }
            });
        }
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $t) {
            foreach (['leads_tab_counters_idx', 'leads_stage_created_idx', 'leads_sender_email_idx', 'leads_sender_company_idx'] as $idx) {
                if ($this->indexExists('leads', $idx)) {
                    $t->dropIndex($idx);
                }
            }
        });
        if (Schema::hasTable('lead_product_shared_prices')) {
            Schema::table('lead_product_shared_prices', function (Blueprint $t) {
                if ($this->indexExists('lead_product_shared_prices', 'lpsp_client_lead_shared_idx')) {
                    $t->dropIndex('lpsp_client_lead_shared_idx');
                }
            });
        }
    }

    /** Cross-driver index probe — Postgres uses pg_indexes, MySQL uses
     *  SHOW INDEX. Skips silently on unknown drivers. */
    private function indexExists(string $table, string $name): bool
    {
        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'pgsql') {
            return collect(\DB::select(
                'SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?',
                [$table, $name]
            ))->isNotEmpty();
        }
        if ($driver === 'mysql') {
            return collect(\DB::select(
                "SHOW INDEX FROM `{$table}` WHERE Key_name = ?",
                [$name]
            ))->isNotEmpty();
        }
        return false;
    }
};

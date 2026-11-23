<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $t) {
            if (!$this->indexExists('leads', 'leads_tab_counters_idx')) {
                $t->index(['client_id', 'qualified', 'disqualified', 'id'], 'leads_tab_counters_idx');
            }
            if (!$this->indexExists('leads', 'leads_stage_created_idx')) {
                $t->index(['client_id', 'lead_stage_id', 'created_at'], 'leads_stage_created_idx');
            }
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

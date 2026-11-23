<?php

use App\Models\ClmSegmentRule;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        ClmSegmentRule::query()->chunkById(200, function ($rules) {
            foreach ($rules as $rule) {
                $sel = $rule->doc_selections;
                if (!is_array($sel) || !array_key_exists('td', $sel)) {
                    continue;
                }

                unset($sel['td']);

                $mand = 0;
                $opt  = 0;
                foreach (['kyc', 'dd', 'tl', 'qc'] as $cat) {
                    foreach (($sel[$cat] ?? []) as $v) {
                        if ($v === 'M') {
                            $mand++;
                        } elseif ($v === 'O') {
                            $opt++;
                        }
                    }
                }

                $rule->doc_selections  = $sel;
                $rule->mandatory_count = $mand;
                $rule->optional_count  = $opt;
                $rule->saveQuietly();
            }
        });
    }

    public function down(): void
    {
    }
};

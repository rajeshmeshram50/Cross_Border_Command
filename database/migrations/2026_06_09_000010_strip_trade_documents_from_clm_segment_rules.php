<?php

use App\Models\ClmSegmentRule;
use Illuminate\Database\Migrations\Migration;

/**
 * Trade Documents (the `td` category) were removed from the Document Control
 * Panel. This one-time cleanup strips the leftover `td` key out of every
 * segment rule's `doc_selections` JSON and recomputes the mandatory / optional
 * counts so they no longer include trade-document selections.
 *
 * Irreversible — the original `td` selections are dropped (down() is a no-op).
 */
return new class extends Migration
{
    public function up(): void
    {
        ClmSegmentRule::query()->chunkById(200, function ($rules) {
            foreach ($rules as $rule) {
                $sel = $rule->doc_selections;
                if (!is_array($sel) || !array_key_exists('td', $sel)) {
                    continue;   // nothing to strip
                }

                unset($sel['td']);

                // Recompute counts across the remaining categories — mirrors
                // ClmSegmentRuleController::countSelections (which no longer
                // counts 'td').
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
                $rule->saveQuietly();   // skip model events; pure data fix
            }
        });
    }

    public function down(): void
    {
        // Irreversible — the removed `td` selections cannot be restored.
    }
};

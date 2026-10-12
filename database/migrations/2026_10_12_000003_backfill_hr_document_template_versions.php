<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * HR · Give every existing template the version it is already on. (#34)
 *
 * Snapshots only begin the first time a template is saved, so the 70-odd
 * templates that predate this feature opened their history on an empty panel
 * — and a history that starts empty reads as broken, not as new.
 *
 * Each one is filed at the version it currently carries (v1 for almost all of
 * them) using the content it currently holds, which IS that version: nothing
 * has overwritten it. So the backfill is not a guess, it is the row that
 * should always have been there.
 *
 * Templates that already have a snapshot are skipped. One of those is a
 * template edited between the feature shipping and this backfill: its v1 body
 * was overwritten while nothing was keeping it, and no migration can bring
 * back content that was never stored.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        DB::table('hr_document_templates')
            ->whereNotExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('hr_document_template_versions as v')
                    ->whereColumn('v.template_id', 'hr_document_templates.id');
            })
            // Chunked by id: the table is small today, but a backfill that
            // loads every template's content_html at once is the kind of thing
            // that only fails on the one install with thousands of them.
            ->orderBy('id')
            ->chunkById(200, function ($templates) use ($now) {
                $rows = [];

                foreach ($templates as $t) {
                    $rows[] = [
                        'client_id'          => $t->client_id,
                        'branch_id'          => $t->branch_id,
                        'template_id'        => $t->id,
                        'version'            => $t->version ?: 'v1',
                        'code'               => $t->code,
                        'name'               => $t->name,
                        'status'             => $t->status,
                        'editor_mode'        => $t->editor_mode,
                        'content_html'       => $t->content_html,
                        'header_config'      => $t->header_config,
                        'footer_config'      => $t->footer_config,
                        'docx_path'          => $t->docx_path,
                        'docx_original_name' => $t->docx_original_name,
                        'created_by'         => $t->created_by,
                        'created_at'         => $t->updated_at ?: $now,
                        'updated_at'         => $now,
                    ];
                }

                if ($rows) {
                    DB::table('hr_document_template_versions')->insert($rows);
                }
            });
    }

    public function down(): void
    {
        // Nothing to undo selectively — a backfilled row is indistinguishable
        // from one filed by a save, and dropping the wrong ones would lose
        // real history. The table's own migration drops all of it.
    }
};

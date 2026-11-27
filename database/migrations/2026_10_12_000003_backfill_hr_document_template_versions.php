<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
    }
};

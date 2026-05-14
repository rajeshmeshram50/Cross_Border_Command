<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Registers the HR > Document & Evidence > "Custom Fields" module
 * (slug: hr.custom_fields) and back-fills permission rows from a donor
 * (hr.doc_templates — its sibling under the same parent, so anyone who can
 * manage templates can manage the variables those templates reference).
 *
 * Mirrors 2026_05_14_000004_seed_hr_doc_templates_module.php in every step.
 */
return new class extends Migration
{
    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'hr.documents')->value('id');
        if (!$parentId) return;

        $slug = 'hr.custom_fields';
        $existing = DB::table('modules')->where('slug', $slug)->value('id');

        $moduleId = $existing ?: DB::table('modules')->insertGetId([
            'parent_id'    => $parentId,
            'name'         => 'Custom Fields',
            'slug'         => $slug,
            'icon'         => 'Star',
            'description'  => 'Custom variables used in document templates — filled manually at generation time',
            'route_name'   => null,
            'route_prefix' => null,
            'sort_order'   => 99,
            'is_active'    => true,
            'is_default'   => false,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $donorId = DB::table('modules')->where('slug', 'hr.doc_templates')->value('id');
        if (!$donorId) return;

        $donorRows = DB::table('permissions')->where('module_id', $donorId)->get();
        if ($donorRows->isEmpty()) return;

        $existingUserIds = DB::table('permissions')
            ->where('module_id', $moduleId)
            ->pluck('user_id')
            ->all();
        $skip = array_flip($existingUserIds);

        $now = now();
        $insert = [];
        foreach ($donorRows as $r) {
            if (isset($skip[$r->user_id])) continue;
            $insert[] = [
                'user_id'     => $r->user_id,
                'client_id'   => $r->client_id,
                'branch_id'   => $r->branch_id,
                'role'        => $r->role,
                'module_id'   => $moduleId,
                'can_view'    => $r->can_view,
                'can_add'     => $r->can_add,
                'can_edit'    => $r->can_edit,
                'can_delete'  => $r->can_delete,
                'can_export'  => $r->can_export,
                'can_import'  => $r->can_import,
                'can_approve' => $r->can_approve,
                'granted_by'  => $r->granted_by,
                'created_at'  => $now,
                'updated_at'  => $now,
            ];
        }
        foreach (array_chunk($insert, 500) as $chunk) {
            DB::table('permissions')->insert($chunk);
        }
    }

    public function down(): void
    {
        $id = DB::table('modules')->where('slug', 'hr.custom_fields')->value('id');
        if ($id) {
            DB::table('permissions')->where('module_id', $id)->delete();
            DB::table('modules')->where('id', $id)->delete();
        }
    }
};

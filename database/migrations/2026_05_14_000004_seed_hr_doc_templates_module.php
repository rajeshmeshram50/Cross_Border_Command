<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Registers the HR > Document & Evidence > "Document Templates" module
 * (slug: hr.doc_templates) and back-fills permission rows from a donor
 * (hr.broadcast — another HR document-and-evidence leaf with full ACL).
 */
return new class extends Migration
{
    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'hr.documents')->value('id');
        if (!$parentId) return;

        $slug = 'hr.doc_templates';
        $existing = DB::table('modules')->where('slug', $slug)->value('id');

        $moduleId = $existing ?: DB::table('modules')->insertGetId([
            'parent_id'    => $parentId,
            'name'         => 'Document Templates',
            'slug'         => $slug,
            'icon'         => 'FileText',
            'description'  => 'Role-based document templates with versions, variables & approval flows',
            'route_name'   => null,
            'route_prefix' => null,
            'sort_order'   => 98,
            'is_active'    => true,
            'is_default'   => false,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $donorId = DB::table('modules')->where('slug', 'hr.broadcast')->value('id');
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
        $id = DB::table('modules')->where('slug', 'hr.doc_templates')->value('id');
        if ($id) {
            DB::table('permissions')->where('module_id', $id)->delete();
            DB::table('modules')->where('id', $id)->delete();
        }
    }
};

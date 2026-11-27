<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const SLUG = 'p2p.payment_request';

    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'p2p.purchase')->value('id');
        $poId = DB::table('modules')->where('slug', 'p2p.po')->value('id');
        if (!$parentId) {
            return;
        }

        $moduleId = DB::table('modules')->where('slug', self::SLUG)->value('id');
        if (!$moduleId) {
            $moduleId = DB::table('modules')->insertGetId([
                'parent_id'    => $parentId,
                'name'         => 'Payment Request Management',
                'slug'         => self::SLUG,
                'icon'         => 'IndianRupee',
                'description'  => 'Review, approve or decline payment requests raised on POs and SPIs',
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => 5,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }
        if (!$poId) {
            return;
        }

        $flags = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

        $have = DB::table('permissions')->where('module_id', $moduleId)->pluck('user_id')->flip();
        $rows = [];
        foreach (DB::table('permissions')->where('module_id', $poId)->get() as $p) {
            if ($p->user_id === null || isset($have[$p->user_id])) continue;
            $have[$p->user_id] = true;
            $rows[] = [
                'user_id' => $p->user_id, 'client_id' => $p->client_id, 'branch_id' => $p->branch_id,
                'role' => $p->role, 'module_id' => $moduleId, 'granted_by' => $p->granted_by,
                'created_at' => now(), 'updated_at' => now(),
            ] + array_combine($flags, array_map(fn ($f) => (bool) $p->$f, $flags));
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('permissions')->insert($chunk);
        }

        $rows = [];
        foreach (DB::table('department_permissions')->where('module_id', $poId)->get() as $d) {
            $exists = DB::table('department_permissions')
                ->where('client_id', $d->client_id)->where('department_id', $d->department_id)
                ->where('module_id', $moduleId)->exists();
            if ($exists) continue;
            $rows[] = [
                'client_id' => $d->client_id, 'department_id' => $d->department_id,
                'module_id' => $moduleId, 'granted_by' => $d->granted_by,
                'created_at' => now(), 'updated_at' => now(),
            ] + array_combine($flags, array_map(fn ($f) => (bool) $d->$f, $flags));
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('department_permissions')->insert($chunk);
        }

        $planHave = DB::table('plan_modules')->where('module_id', $moduleId)->pluck('plan_id')->flip();
        foreach (DB::table('plan_modules')->where('module_id', $poId)->get() as $pm) {
            if ($pm->plan_id === null || isset($planHave[$pm->plan_id])) continue;
            DB::table('plan_modules')->insert([
                'plan_id' => $pm->plan_id, 'module_id' => $moduleId,
                'access_level' => $pm->access_level, 'usage_limit' => $pm->usage_limit, 'notes' => null,
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('modules')->where('slug', self::SLUG)->delete();
    }
};

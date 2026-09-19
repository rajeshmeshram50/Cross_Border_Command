<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Gives Payment Request Management (p2p.payment_request) its own row in the
 * permission tree, under P2P → Purchase Management.
 *
 * Until now the page had no module row and rode on the Purchase Order grant.
 * So that nobody loses the access they have today, every existing p2p.po
 * grant is copied onto the new module with the same flags — per user, per
 * department template and per plan. From here on the two are granted apart.
 *
 * Idempotent: rows that already exist are left untouched.
 */
return new class extends Migration
{
    private const SLUG = 'p2p.payment_request';

    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'p2p.purchase')->value('id');
        $poId = DB::table('modules')->where('slug', 'p2p.po')->value('id');
        if (!$parentId) {
            return; // P2P tree not seeded on this install; ModuleSeeder adds it.
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

        // Per-user grants.
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

        // Department (HOD) permission templates.
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

        // Plans that sell Purchase Order also sell this page.
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
        // Grants cascade off the module row.
        DB::table('modules')->where('slug', self::SLUG)->delete();
    }
};

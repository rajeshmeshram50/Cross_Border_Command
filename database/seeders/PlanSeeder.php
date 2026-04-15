<?php

namespace Database\Seeders;

use App\Models\Module;
use App\Models\Plan;
use App\Models\PlanModule;
use Illuminate\Database\Seeder;

class PlanSeeder extends Seeder
{
    public function run(): void
    {
        $mods = Module::pluck('id', 'slug');

        // Starter (Free)
        $p1 = Plan::updateOrCreate(['slug' => 'starter'], [
            'name' => 'Starter', 'price' => 0, 'period' => 'month',
            'max_branches' => 1, 'max_users' => 3, 'storage_limit' => '1GB', 'support_level' => 'Email',
            'status' => 'active', 'best_for' => 'Trying out the platform', 'sort_order' => 1,
        ]);
        foreach (['branches', 'employees'] as $s) {
            PlanModule::updateOrCreate(['plan_id' => $p1->id, 'module_id' => $mods[$s]], ['access_level' => 'limited']);
        }

        // Basic
        $p2 = Plan::updateOrCreate(['slug' => 'basic'], [
            'name' => 'Basic', 'price' => 1999, 'period' => 'month',
            'max_branches' => 5, 'max_users' => 15, 'storage_limit' => '5GB', 'support_level' => 'Email + Chat',
            'status' => 'active', 'best_for' => 'Small teams & startups', 'sort_order' => 2, 'trial_days' => 7,
        ]);
        foreach (['branches', 'employees', 'permissions'] as $s) {
            PlanModule::updateOrCreate(['plan_id' => $p2->id, 'module_id' => $mods[$s]], ['access_level' => $s === 'permissions' ? 'limited' : 'full']);
        }

        // Pro
        $p3 = Plan::updateOrCreate(['slug' => 'pro'], [
            'name' => 'Pro', 'price' => 4999, 'period' => 'month',
            'max_branches' => 25, 'max_users' => 50, 'storage_limit' => '25GB', 'support_level' => 'Priority',
            'status' => 'active', 'best_for' => 'Growing businesses', 'sort_order' => 3,
            'is_featured' => true, 'badge' => 'Most Popular', 'yearly_discount' => 20, 'trial_days' => 14,
        ]);
        foreach (['branches', 'employees', 'permissions', 'settings'] as $s) {
            PlanModule::updateOrCreate(['plan_id' => $p3->id, 'module_id' => $mods[$s]], ['access_level' => 'full']);
        }

        // Business
        $p4 = Plan::updateOrCreate(['slug' => 'business'], [
            'name' => 'Business', 'price' => 9999, 'period' => 'month',
            'max_branches' => 50, 'max_users' => 100, 'storage_limit' => '100GB', 'support_level' => 'Dedicated',
            'status' => 'active', 'best_for' => 'Large organizations', 'sort_order' => 4, 'yearly_discount' => 25,
        ]);
        foreach ($mods as $slug => $id) {
            if (!in_array($slug, ['dashboard', 'profile', 'clients', 'plans', 'payments'])) {
                PlanModule::updateOrCreate(['plan_id' => $p4->id, 'module_id' => $id], ['access_level' => 'full']);
            }
        }

        // Enterprise
        $p5 = Plan::updateOrCreate(['slug' => 'enterprise'], [
            'name' => 'Enterprise', 'price' => 14999, 'period' => 'month',
            'max_branches' => 0, 'max_users' => 0, 'storage_limit' => '500GB+', 'support_level' => 'Enterprise SLA',
            'status' => 'active', 'best_for' => 'Enterprise & conglomerates', 'sort_order' => 5,
            'yearly_discount' => 30, 'is_custom' => true,
        ]);
        foreach ($mods as $slug => $id) {
            if (!in_array($slug, ['dashboard', 'profile', 'clients', 'plans', 'payments'])) {
                PlanModule::updateOrCreate(['plan_id' => $p5->id, 'module_id' => $id], ['access_level' => 'full']);
            }
        }
    }
}

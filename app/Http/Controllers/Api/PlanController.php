<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\PlanModule;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanController extends Controller
{
    public function index(Request $request)
    {
        $query = Plan::withCount('clients')
            ->with(['modules:id,name,slug,icon'])
            ->orderBy('sort_order');

        if ($search = $request->query('search')) {
            $query->where('name', 'ilike', "%{$search}%");
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:100',
            'price' => 'required|numeric|min:0',
            'period' => 'required|in:month,quarter,year',
            'max_branches' => 'nullable|integer|min:0',
            'max_users' => 'nullable|integer|min:0',
            'storage_limit' => 'nullable|string|max:20',
            'support_level' => 'nullable|string|max:50',
            'is_featured' => 'boolean',
            'badge' => 'nullable|string|max:50',
            'color' => 'nullable|string|max:7',
            'description' => 'nullable|string',
            'best_for' => 'nullable|string|max:255',
            'status' => 'required|in:active,inactive',
            'trial_days' => 'nullable|integer|min:0',
            'yearly_discount' => 'nullable|numeric|min:0|max:100',
            'is_custom' => 'boolean',
            'modules' => 'nullable|array',
            'modules.*.module_id' => 'required|exists:modules,id',
            'modules.*.access_level' => 'required|in:full,limited,addon,not_included',
        ]);

        $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $request->name));

        $plan = DB::transaction(function () use ($request, $slug) {
            $plan = Plan::create([
                'name' => $request->name,
                'slug' => $slug,
                'price' => $request->price,
                'period' => $request->period,
                'max_branches' => $request->max_branches,
                'max_users' => $request->max_users,
                'storage_limit' => $request->storage_limit,
                'support_level' => $request->support_level,
                'is_featured' => $request->boolean('is_featured'),
                'badge' => $request->badge,
                'color' => $request->color,
                'description' => $request->description,
                'best_for' => $request->best_for,
                'status' => $request->status,
                'sort_order' => Plan::max('sort_order') + 1,
                'trial_days' => $request->trial_days,
                'yearly_discount' => $request->yearly_discount,
                'is_custom' => $request->boolean('is_custom'),
            ]);

            // Save modules
            if ($request->modules) {
                foreach ($request->modules as $mod) {
                    if ($mod['access_level'] === 'not_included') continue;
                    PlanModule::create([
                        'plan_id' => $plan->id,
                        'module_id' => $mod['module_id'],
                        'access_level' => $mod['access_level'],
                    ]);
                }
            }

            return $plan;
        });

        $plan->load('modules:id,name,slug,icon');

        return response()->json(['message' => 'Plan created successfully', 'plan' => $plan], 201);
    }

    public function show(Plan $plan)
    {
        $plan->loadCount('clients');
        $plan->load(['modules:id,name,slug,icon', 'planModules']);

        return response()->json($plan);
    }

    public function update(Request $request, Plan $plan)
    {
        $request->validate([
            'name' => 'required|string|max:100',
            'price' => 'required|numeric|min:0',
            'period' => 'required|in:month,quarter,year',
            'max_branches' => 'nullable|integer|min:0',
            'max_users' => 'nullable|integer|min:0',
            'storage_limit' => 'nullable|string|max:20',
            'support_level' => 'nullable|string|max:50',
            'is_featured' => 'boolean',
            'badge' => 'nullable|string|max:50',
            'color' => 'nullable|string|max:7',
            'description' => 'nullable|string',
            'best_for' => 'nullable|string|max:255',
            'status' => 'required|in:active,inactive',
            'trial_days' => 'nullable|integer|min:0',
            'yearly_discount' => 'nullable|numeric|min:0|max:100',
            'is_custom' => 'boolean',
            'modules' => 'nullable|array',
            'modules.*.module_id' => 'required|exists:modules,id',
            'modules.*.access_level' => 'required|in:full,limited,addon,not_included',
        ]);

        DB::transaction(function () use ($request, $plan) {
            $plan->update([
                'name' => $request->name,
                'price' => $request->price,
                'period' => $request->period,
                'max_branches' => $request->max_branches,
                'max_users' => $request->max_users,
                'storage_limit' => $request->storage_limit,
                'support_level' => $request->support_level,
                'is_featured' => $request->boolean('is_featured'),
                'badge' => $request->badge,
                'color' => $request->color,
                'description' => $request->description,
                'best_for' => $request->best_for,
                'status' => $request->status,
                'trial_days' => $request->trial_days,
                'yearly_discount' => $request->yearly_discount,
                'is_custom' => $request->boolean('is_custom'),
            ]);

            // Replace modules
            PlanModule::where('plan_id', $plan->id)->delete();
            if ($request->modules) {
                foreach ($request->modules as $mod) {
                    if ($mod['access_level'] === 'not_included') continue;
                    PlanModule::create([
                        'plan_id' => $plan->id,
                        'module_id' => $mod['module_id'],
                        'access_level' => $mod['access_level'],
                    ]);
                }
            }
        });

        $plan->load('modules:id,name,slug,icon');

        return response()->json(['message' => 'Plan updated successfully', 'plan' => $plan]);
    }

    public function destroy(Plan $plan)
    {
        if ($plan->clients()->exists()) {
            return response()->json(['message' => 'Cannot delete plan with active clients. Reassign clients first.'], 422);
        }

        DB::transaction(function () use ($plan) {
            PlanModule::where('plan_id', $plan->id)->delete();
            $plan->delete();
        });

        return response()->json(['message' => 'Plan deleted successfully']);
    }
}

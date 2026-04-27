<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function adminStats()
    {
        // Core counts
        $totalClients = Client::count();
        $activeClients = Client::where('status', 'active')->count();
        $inactiveClients = Client::where('status', '!=', 'active')->count();
        $totalUsers = User::count();
        $totalBranches = Branch::count();

        // Revenue
        $totalRevenue = (float) Payment::where('status', 'success')->sum('total');
        $monthlyRevenue = (float) Payment::where('status', 'success')
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('total');

        // Payments
        $totalPayments = Payment::count();
        $successPayments = Payment::where('status', 'success')->count();
        $pendingPayments = Payment::where('status', 'pending')->count();
        $failedPayments = Payment::where('status', 'failed')->count();

        // Plan distribution
        $planDistribution = Client::select('plan_type', DB::raw('count(*) as count'))
            ->groupBy('plan_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->plan_type => $item->count])
            ->toArray();

        // Plan breakdown by name
        $planBreakdown = Client::leftJoin('plans', 'clients.plan_id', '=', 'plans.id')
            ->select(DB::raw("COALESCE(plans.name, 'Free') as plan_name"), DB::raw('count(*) as count'))
            ->groupBy('plan_name')
            ->orderByDesc('count')
            ->get()
            ->toArray();

        // Monthly revenue trend (last 6 months)
        $revenueTrend = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $revenue = (float) Payment::where('status', 'success')
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->sum('total');
            $count = Payment::where('status', 'success')
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
            $revenueTrend[] = [
                'month' => $month->format('M Y'),
                'short' => $month->format('M'),
                'revenue' => $revenue,
                'count' => $count,
            ];
        }

        // Client growth (last 6 months)
        $clientGrowth = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $count = Client::whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
            $clientGrowth[] = [
                'month' => $month->format('M'),
                'clients' => $count,
            ];
        }

        // User type distribution
        $userTypes = User::select('user_type', DB::raw('count(*) as count'))
            ->groupBy('user_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->user_type => $item->count])
            ->toArray();

        // Recent clients (top 5)
        $recentClients = Client::with('plan:id,name')
            ->withCount(['branches', 'users'])
            ->orderByDesc('created_at')
            ->limit(5)
            ->get(['id', 'org_name', 'email', 'status', 'plan_id', 'plan_type', 'created_at']);

        // Recent payments (top 5)
        $recentPayments = Payment::with(['client:id,org_name', 'plan:id,name'])
            ->orderByDesc('created_at')
            ->limit(5)
            ->get(['id', 'client_id', 'plan_id', 'total', 'status', 'method', 'invoice_number', 'created_at']);

        // Top clients by revenue
        $topClients = Payment::where('status', 'success')
            ->select('client_id', DB::raw('SUM(total) as total_revenue'), DB::raw('COUNT(*) as payments_count'))
            ->groupBy('client_id')
            ->orderByDesc('total_revenue')
            ->limit(5)
            ->with('client:id,org_name')
            ->get();

        // Org type distribution
        $orgTypes = Client::select('org_type', DB::raw('count(*) as count'))
            ->groupBy('org_type')
            ->orderByDesc('count')
            ->get()
            ->toArray();

        return response()->json([
            'plan_distribution' => $planDistribution,
            'counts' => [
                'total_clients' => $totalClients,
                'active_clients' => $activeClients,
                'inactive_clients' => $inactiveClients,
                'total_users' => $totalUsers,
                'total_branches' => $totalBranches,
                'total_payments' => $totalPayments,
                'success_payments' => $successPayments,
                'pending_payments' => $pendingPayments,
                'failed_payments' => $failedPayments,
            ],
            'revenue' => [
                'total' => $totalRevenue,
                'monthly' => $monthlyRevenue,
            ],
            'plan_distribution' => $planDistribution,
            'plan_breakdown' => $planBreakdown,
            'revenue_trend' => $revenueTrend,
            'client_growth' => $clientGrowth,
            'user_types' => $userTypes,
            'org_types' => $orgTypes,
            'recent_clients' => $recentClients,
            'recent_payments' => $recentPayments,
            'top_clients' => $topClients,
        ]);
    }

    public function clientStats(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId) {
            return response()->json(['message' => 'No client associated'], 422);
        }

        // Resolve & validate branch_id filter (always scoped within this user's client)
        $branchId = $request->integer('branch_id') ?: null;
        if ($branchId && !Branch::where('client_id', $clientId)->where('id', $branchId)->exists()) {
            $branchId = null; // ignore stale / cross-client ids
        }
        // Sub-branch users (non-main) are always locked to their own branch
        if ($user->user_type === 'branch_user') {
            $userBranch = Branch::find($user->branch_id);
            if ($userBranch && !$userBranch->is_main) {
                $branchId = $user->branch_id;
            }
        }

        $client = Client::with('plan')->find($clientId);

        // Branches
        $totalBranches = $branchId ? 1 : Branch::where('client_id', $clientId)->count();
        $activeBranches = $branchId
            ? Branch::where('client_id', $clientId)->where('id', $branchId)->where('status', 'active')->count()
            : Branch::where('client_id', $clientId)->where('status', 'active')->count();

        // Users — scoped by branch when filter active
        $usersBase = fn() => User::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId));
        $totalUsers = $usersBase()->count();
        $activeUsers = $usersBase()->where('status', 'active')->count();

        // Payments are subscription-level (per client, not per branch). Show client-level
        // counts even when filtering, so a branch user still sees plan/payment status.
        $totalPayments = Payment::where('client_id', $clientId)->count();
        $successPayments = Payment::where('client_id', $clientId)->where('status', 'success')->count();
        $pendingPayments = Payment::where('client_id', $clientId)->where('status', 'pending')->count();
        $totalPaid = (float) Payment::where('client_id', $clientId)->where('status', 'success')->sum('total');

        // Plan info
        $planName = $client?->plan?->name ?? 'Free';
        $planExpiry = $client?->plan_expires_at;
        $daysRemaining = $planExpiry ? max(0, (int) now()->diffInDays($planExpiry, false)) : null;
        $planStatus = $planExpiry ? ($planExpiry->isPast() ? 'expired' : 'active') : 'no_plan';

        // Recent payments
        $recentPayments = Payment::with('plan:id,name')
            ->where('client_id', $clientId)
            ->orderByDesc('created_at')
            ->limit(5)
            ->get(['id', 'plan_id', 'total', 'status', 'method', 'invoice_number', 'valid_from', 'valid_until', 'created_at']);

        // Branches list — full list when no filter, single-branch when filtered
        $branches = Branch::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('id', $branchId))
            ->withCount('users')
            ->orderByDesc('is_main')
            ->orderBy('name')
            ->get(['id', 'name', 'code', 'status', 'is_main', 'city', 'state', 'email', 'phone']);

        // Payment trend (last 6 months)
        $paymentTrend = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $amount = (float) Payment::where('client_id', $clientId)
                ->where('status', 'success')
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->sum('total');
            $paymentTrend[] = [
                'month' => $month->format('M'),
                'amount' => $amount,
            ];
        }

        // User role breakdown — scoped to branch when filtered
        $userRoles = User::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->select('user_type', DB::raw('count(*) as count'))
            ->groupBy('user_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->user_type => $item->count])
            ->toArray();

        return response()->json([
            'client' => [
                'org_name' => $client?->org_name,
                'logo' => $client?->logo,
                'primary_color' => $client?->primary_color,
                'status' => $client?->status,
            ],
            'plan' => [
                'name' => $planName,
                'status' => $planStatus,
                'expires_at' => $planExpiry?->format('Y-m-d'),
                'days_remaining' => $daysRemaining,
                'price' => $client?->plan?->price ?? 0,
            ],
            'counts' => [
                'total_branches' => $totalBranches,
                'active_branches' => $activeBranches,
                'total_users' => $totalUsers,
                'active_users' => $activeUsers,
                'total_payments' => $totalPayments,
                'success_payments' => $successPayments,
                'pending_payments' => $pendingPayments,
                'total_paid' => $totalPaid,
            ],
            'branches' => $branches,
            'recent_payments' => $recentPayments,
            'payment_trend' => $paymentTrend,
            'user_roles' => $userRoles,
            'filter' => [
                'branch_id' => $branchId,
            ],
        ]);
    }
}

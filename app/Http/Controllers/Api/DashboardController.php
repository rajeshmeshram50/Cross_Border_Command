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
}

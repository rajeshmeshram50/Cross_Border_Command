<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class RecruitmentBundleController extends Controller
{
    public function overview(Request $request)
    {
        $sub = function (array $query) use ($request): Request {
            $r = Request::create($request->getPathInfo(), 'GET', $query);
            $r->setUserResolver($request->getUserResolver());
            return $r;
        };
        $json = fn ($response) => $response instanceof \Illuminate\Http\JsonResponse
            ? $response->getData(true)
            : json_decode($response->getContent(), true);

        $search  = trim((string) $request->query('search', ''));
        $status  = (string) $request->query('status', '');
        $page    = max(1, (int) $request->integer('page'));
        $perPage = (int) $request->integer('per_page') ?: 10;

        $listQuery = ['page' => $page, 'per_page' => $perPage];
        if ($status !== '') $listQuery['status'] = $status;
        if ($search !== '') $listQuery['search'] = $search;

        $recruitment = new RecruitmentController();

        $safe = function (callable $fn, $fallback) {
            try { return $fn(); } catch (\Throwable $e) { return $fallback; }
        };

        return response()->json([
            'recruitments'     => $safe(fn () => $json($recruitment->index($sub($listQuery))), ['data' => [], 'total' => 0]),
            'recruitment_stats'=> $safe(fn () => $json($recruitment->stats($sub($search !== '' ? ['search' => $search] : []))), null),
            'candidate_stats'  => $safe(fn () => $json((new CandidateController())->stats($sub([]))), null),
            'hiring_requests'  => $safe(fn () => $json((new HiringRequestController())->index($sub([]))), []),
        ]);
    }
}

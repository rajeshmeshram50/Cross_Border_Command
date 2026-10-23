<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

/**
 * The Recruitment screen's four reads, in ONE request.
 *
 * Measured on the server, those four cost about the same no matter what they
 * return:
 *
 *   recruitments?page=1&per_page=10   0.6 kB   2.07 s
 *   recruitments/stats                0.5 kB   1.45 s
 *   candidates/stats                  0.5 kB   1.45 s
 *   hiring-requests                   5.0 kB   2.18 s
 *
 * 6.6 kB of data for four round trips. What is being paid for is the trip, not
 * the query — and they go through HTTP/1.1's six-connection cap alongside the
 * app shell's own calls, so the screen runs in two waves. This block also
 * re-fires on every tab switch, page change and search, so it is the hottest
 * path on the page, not just its first load.
 *
 * The four controllers are CALLED, not reimplemented: each is a plain
 * (Request) method returning JsonResponse, so this hands each the query string
 * it expects and decodes the reply. Payloads are therefore identical to the
 * separate endpoints by construction, and a later change to any of them is
 * picked up here with no second copy to keep in step. The separate routes stay
 * — the modals and other screens use them.
 */
class RecruitmentBundleController extends Controller
{
    public function overview(Request $request)
    {
        /* A fresh Request per call, carrying only what that endpoint reads.
           Reusing $request would hand each controller the others' parameters —
           harmless today, but it is the coupling that breaks quietly when one
           of them grows a new filter. */
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

        /* Each one is guarded on its own. A bundle that 500s because one of
           four panels failed would be worse than the four separate calls it
           replaces — the frontend already treats three of these as optional
           (.catch(() => zero)), so keep that contract. */
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

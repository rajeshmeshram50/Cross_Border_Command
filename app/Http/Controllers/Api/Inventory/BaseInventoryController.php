<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Http\Controllers\Controller;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * Shared plumbing for the five Inventory master controllers.
 *
 * All five screens are the same screen: three tabs that count All / Active /
 * Inactive, a search box, a ten-row page, and a toggle that flips status
 * rather than deleting. Keeping that here means a fix to the paging or the
 * counts lands on every master at once.
 *
 * Responses are built in the controllers themselves — a failure is an
 * abort() with its own HTTP status, never a value passed back up.
 */
abstract class BaseInventoryController extends Controller
{
    /** Every write needs a tenant; a super admin has no client to file under. */
    protected function tenantUser(Request $request)
    {
        $user = $request->user();

        if (!$user?->client_id) {
            abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        }

        return $user;
    }

    /**
     * All / Active / Inactive, counted in one query off a query that the tab
     * and the search have NOT yet narrowed — typing in the search box must not
     * make the "All" tab fall to 3.
     */
    protected function tabCounts(Builder $base): array
    {
        $row = $base->toBase()
            ->selectRaw('COUNT(*) AS all_count')
            ->selectRaw('COUNT(*) FILTER (WHERE status = 1) AS active_count')
            ->first();

        $all    = (int) ($row->all_count ?? 0);
        $active = (int) ($row->active_count ?? 0);

        return ['all' => $all, 'active' => $active, 'inactive' => $all - $active];
    }

    /** The 'all' tab is no filter at all, which is why it is not in the match. */
    protected function applyTab(Builder $q, ?string $tab): void
    {
        match ($tab) {
            'active'   => $q->where('status', 1),
            'inactive' => $q->where('status', 0),
            default    => null,
        };
    }

    /** @param string[] $columns */
    protected function applySearch(Builder $q, ?string $term, array $columns): void
    {
        $term = trim((string) $term);
        if ($term === '') return;

        $q->where(function ($w) use ($term, $columns) {
            foreach ($columns as $c) {
                $w->orWhere($c, 'ilike', '%' . $term . '%');
            }
        });
    }

    /**
     * The body every list returns. per_page defaults to 10 and is capped — a
     * master with 4,000 rows must not be fetchable in one call.
     */
    protected function listBody(Builder $q, Request $request, array $tabs, callable $row): array
    {
        $page = $q->paginate(min((int) $request->input('per_page', 10), 100));

        return [
            'status' => true,
            'data'   => collect($page->items())->map($row)->all(),
            'tabs'   => $tabs,
            'meta'   => [
                'page'      => $page->currentPage(),
                'per_page'  => $page->perPage(),
                'total'     => $page->total(),
                'last_page' => $page->lastPage(),
            ],
        ];
    }

    /** The filters every list accepts, so the five validate() calls agree. */
    protected function listRules(): array
    {
        return [
            'tab'      => ['nullable', 'in:all,active,inactive'],
            'q'        => ['nullable', 'string', 'max:120'],
            'page'     => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ];
    }
}

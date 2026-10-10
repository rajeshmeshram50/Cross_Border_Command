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
     * The branch these five masters are scoped to.
     *
     * A warehouse belongs to the office that runs it, so the masters below it
     * are branch-wise, not client-wise. Resolution, in order:
     *
     *   branch user   its own branch, always — asking for another in the query
     *                 string must not reach it
     *   client admin  the branch the switcher is on (Axios sends branch_id on
     *                 every GET), or null for the whole company when it is not
     *
     * Null therefore means "all branches of this client", which only a user
     * without a branch of their own can ever get.
     */
    protected function branchScope(Request $request, $user): ?int
    {
        if ($user->branch_id) return (int) $user->branch_id;

        return $request->integer('branch_id') ?: null;
    }

    /**
     * The tenancy columns a write takes from the authenticated user.
     *
     * Set explicitly rather than left to the model's creating hook: that hook
     * only fires while TenantContext is active, and it is NOT active for a
     * super admin — so a row created by one would keep a null client_id, which
     * the read scope treats as global and shows it to every tenant.
     */
    protected function tenantColumns($user, ?int $branchId = null): array
    {
        return [
            'client_id' => $user->client_id,
            'branch_id' => $user->branch_id ?: $branchId,
        ];
    }

    /**
     * This client's rows, in this branch — the backup filter the
     * BelongsToTenant scope expects controllers to keep, and the one that still
     * holds if the tenant middleware is ever missing from a route.
     *
     * Deliberately narrower than the global scope: it does NOT return rows with
     * a null client_id, because these five masters have no shared defaults.
     * A null branch_id row IS returned — that is a client-wide master row, and
     * every branch can see it.
     */
    protected function scopeTenant(Builder $q, $user, ?int $branchId = null): Builder
    {
        $table = $q->getModel()->getTable();

        $q->where("$table.client_id", $user->client_id);

        if ($branchId !== null) {
            $q->where(fn ($w) => $w->whereNull("$table.branch_id")->orWhere("$table.branch_id", $branchId));
        }

        return $q;
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
     * A dropdown is the same query as the list with the detail taken off:
     * active rows only, ordered by name, no tabs, no paging, no counts.
     *
     * Not paginated on purpose — a <select> cannot ask for page 2. If a master
     * ever grows past a few hundred rows the picker needs a typeahead against
     * the list endpoint instead, not a page here.
     */
    protected function optionsBody(Builder $q, string $orderBy, callable $row): array
    {
        return [
            'status' => true,
            'data'   => $q->where('status', 1)->orderBy($orderBy)->get()->map($row)->values()->all(),
        ];
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
            // Axios sends this on every GET from the branch switcher; declared
            // so it validates rather than being silently ignored. branchScope()
            // decides whether it is honoured.
            'branch_id' => ['nullable', 'integer'],
            // 'options' asks the same endpoint for the dropdown shape.
            'view'      => ['nullable', 'in:list,options'],
        ];
    }

    /** True when the caller wants the dropdown shape rather than the grid. */
    protected function wantsOptions(Request $request): bool
    {
        return $request->input('view') === 'options';
    }
}

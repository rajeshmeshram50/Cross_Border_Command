<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Inventory\LocationOccupancy;
use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Services\Inventory\StickerKey;
use Barryvdh\DomPDF\Facade\Pdf;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

abstract class BaseInventoryController extends Controller
{
    protected function tenantUser(Request $request)
    {
        $user = $request->user();

        if (!$user?->client_id) {
            abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
        }

        return $user;
    }

    protected function branchScope(Request $request, $user): ?int
    {
        if ($user->branch_id) return (int) $user->branch_id;

        return $request->integer('branch_id') ?: null;
    }

    protected function tenantColumns($user, ?int $branchId = null): array
    {
        return [
            'client_id' => $user->client_id,
            'branch_id' => $user->branch_id ?: $branchId,
        ];
    }

    protected function scopeTenant(Builder $q, $user, ?int $branchId = null, bool $includePlatform = false): Builder
    {
        $table = $q->getModel()->getTable();

        $includePlatform
            ? $q->where(fn ($w) => $w->whereNull("$table.client_id")->orWhere("$table.client_id", $user->client_id))
            : $q->where("$table.client_id", $user->client_id);

        if ($branchId !== null) {
            $q->where(fn ($w) => $w->whereNull("$table.branch_id")->orWhere("$table.branch_id", $branchId));
        }

        return $q;
    }

    protected function ownedQuery(Builder $q, $user): Builder
    {
        return $this->scopeTenant($q, $user, $user->branch_id ? (int) $user->branch_id : null);
    }

    protected function writeBranch(Request $request, $user): int
    {
        $branch = $user->branch_id ?: $request->integer('branch_id');

        if (!$branch) {
            $this->reject('Pick a branch in the branch switcher before adding a warehouse.', 'branch_id');
        }

        $owned = Branch::where('id', $branch)->where('client_id', $user->client_id)->exists();
        if (!$owned) {
            $this->reject('That branch does not belong to your company.', 'branch_id', 403);
        }

        return (int) $branch;
    }

    protected function reject(string $message, ?string $field = null, int $status = 422): never
    {
        abort(response()->json(array_filter([
            'status'  => false,
            'message' => $message,
            'errors'  => $field ? [$field => [$message]] : null,
        ], fn ($v) => $v !== null), $status));
    }

    protected function nameTaken(Builder $q, string $column, string $name, ?int $exceptId = null): bool
    {
        return $q->whereRaw("lower(trim({$column})) = lower(trim(?))", [$name])
            ->when($exceptId, fn ($w) => $w->where('id', '!=', $exceptId))
            ->exists();
    }

    protected function referencedBy(string $column, int $id): ?string
    {
        foreach ([
            'inventory_location_occupancy' => 'stock records',
            'p2p_spi_putaway_tasks'        => 'put-away tasks',
            'p2p_spi_putaways'             => 'put-aways',
            'p2p_supplier_invoices'        => 'supplier invoices',
        ] as $table => $label) {
            if (!Schema::hasColumn($table, $column)) continue;
            if (DB::table($table)->where($column, $id)->exists()) return $label;
        }

        return null;
    }

    protected function holdsStock(string $column, int $id): bool
    {
        if (Schema::hasTable('inventory_location_occupancy')
            && DB::table('inventory_location_occupancy')->where($column, $id)
                ->whereIn('status', LocationOccupancy::LIVE)->exists()) {
            return true;
        }

        $shelves = $column === 'rack_id'
            ? Shelf::where('rack_id', $id)
            : Shelf::whereIn('rack_id', Rack::where($column, $id)->select('id'));

        return $shelves->where('boxes_count', '>', 0)->exists();
    }

    protected function num(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2), '0'), '.');
    }

    protected function refuseIfPlatformRow(Builder $q, $user, int $id, string $what): void
    {
        $exists = (clone $q)->newModelInstance()->newQuery()
            ->whereKey($id)->whereNull('client_id')->exists();

        if ($exists) {
            abort(response()->json([
                'status'  => false,
                'message' => "This {$what} is a shared default and cannot be changed. Create your own to use different settings.",
            ], 403));
        }
    }

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

    protected function applyTab(Builder $q, ?string $tab): void
    {
        match ($tab) {
            'active'   => $q->where('status', 1),
            'inactive' => $q->where('status', 0),
            default    => null,
        };
    }

    protected function applySearch(Builder $q, ?string $term, array $columns, ?callable $also = null): void
    {
        $term = trim((string) $term);
        if ($term === '') return;

        $q->where(function ($w) use ($term, $columns, $also) {
            foreach ($columns as $c) {
                $w->orWhere($c, 'ilike', '%' . $term . '%');
            }
            if ($also) $also($w, $term);
        });
    }

    protected function optionsBody(Builder $q, string $orderBy, callable $row): array
    {
        return [
            'status' => true,
            'data'   => $q->where('status', 1)->orderBy($orderBy)->get()->map($row)->values()->all(),
        ];
    }

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

    protected function labelPdf(array $data, string $filename)
    {
        $payload = $this->stickerPayload($data);

        $pdf = Pdf::loadView('pdf.inventory-label', $data + [
            'qr'        => $this->qr($payload),
            'qrUrl'     => str_starts_with($payload, 'http') ? $payload : null,
            'printedOn' => now()->format('d M Y H:i'),
        ])
            ->setPaper('a4', 'portrait');

        return $pdf->download($filename . '.pdf');
    }

    protected function scanValue(string $kind, int $id): string
    {
        $short = strtoupper($kind) . ':' . $id;

        return StickerKey::fromShort($short, auth()->user()?->client_id) ?: $short;
    }

    protected function stickerPayload(array $data): string
    {
        return (string) ($data['scan'] ?? $data['code']);
    }

    protected function qrPng(string $code, int $scale = 10, ?string $filename = null)
    {
        $png = (new QRCode(new QROptions([
            'eccLevel'    => 3,
            'scale'       => max(1, min($scale, 20)),
            'imageBase64' => false,
            'outputType'  => 'png',
        ])))->render($code);

        return response($png, 200, [
            'Content-Type'        => 'image/png',
            'Content-Disposition' => 'inline; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '-', $filename ?: $code) . '.png"',
            'Cache-Control'       => 'private, max-age=86400',
        ]);
    }

    protected function qr(?string $value): ?string
    {
        if (!$value) return null;

        try {
            return (new QRCode(new QROptions([
                'eccLevel'    => 3,
                'scale'       => 6,
                'imageBase64' => true,
                'outputType'  => 'png',
            ])))->render($value);
        } catch (\Throwable) {
            return null;
        }
    }

    protected function flag(bool $on, string $text, string $tone): ?array
    {
        return $on ? ['text' => $text, 'tone' => $tone] : null;
    }

    protected function listRules(): array
    {
        return [
            'tab'      => ['nullable', 'in:all,active,inactive'],
            'q'        => ['nullable', 'string', 'max:120'],
            'page'     => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'branch_id' => ['nullable', 'integer'],
            'view'      => ['nullable', 'in:list,options'],
        ];
    }

    protected function wantsOptions(Request $request): bool
    {
        return $request->input('view') === 'options';
    }
}

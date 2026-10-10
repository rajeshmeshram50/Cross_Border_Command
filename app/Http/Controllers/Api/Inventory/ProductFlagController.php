<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\ProductFlag;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · Product Flags Master. /api/inventory/product-flags
 *
 * The flattest of the five: a name, why it exists, and whether it is in use.
 * It names the handling labels an SPI box item carries in its json flags
 * column — it does not own the assignment, so nothing cascades from here.
 */
class ProductFlagController extends BaseInventoryController
{
    /** GET /inventory/product-flags */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $f = $request->validate($this->listRules());

            $base = ProductFlag::query();
            $tabs = $this->tabCounts(clone $base);

            $q = $base->orderByDesc('id');
            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['flag_name', 'purpose']);

            $body = $this->listBody($q, $request, $tabs, fn (ProductFlag $p) => $this->row($p));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/product-flags/options — the picker on the box-item form. */
    public function options(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $rows = ProductFlag::where('status', 1)
                ->orderBy('flag_name')
                ->get(['id', 'flag_name', 'purpose'])
                ->map(fn (ProductFlag $p) => [
                    'id'        => $p->id,
                    'flag_code' => $p->flag_code,
                    'flag_name' => $p->flag_name,
                    'purpose'   => $p->purpose,
                ]);

            DB::commit();

            return response()->json(['status' => true, 'data' => $rows], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/product-flags/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $flag = ProductFlag::findOrFail($id);

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** POST /inventory/product-flags */
    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $request->validate($this->rules());

            if ($this->nameTaken($data['flag_name'], null)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'A product flag with this name already exists.',
                ], 422));
            }

            $flag = new ProductFlag($data);
            $flag->created_by = $user->id;
            $flag->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/product-flags/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $flag = ProductFlag::findOrFail($id);
            $data = $request->validate($this->rules());

            if ($this->nameTaken($data['flag_name'], $flag->id)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'A product flag with this name already exists.',
                ], 422));
            }

            $flag->fill($data);
            $flag->updated_by = $user->id;
            $flag->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/product-flags/{id}/status */
    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $flag = ProductFlag::findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            $flag->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** DELETE /inventory/product-flags/{id} */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            ProductFlag::findOrFail($id)->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function rules(): array
    {
        return [
            'flag_name' => ['required', 'string', 'max:120'],
            'purpose'   => ['required', 'string', 'max:255'],
            'status'    => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /** Two flags called "Fragile" would be indistinguishable on the box form. */
    private function nameTaken(string $name, ?int $exceptId): bool
    {
        return ProductFlag::where('flag_name', 'ilike', $name)
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    private function row(ProductFlag $p): array
    {
        return [
            'id'         => $p->id,
            'flag_code'  => $p->flag_code,
            'flag_name'  => $p->flag_name,
            'purpose'    => $p->purpose,
            'status'     => (int) $p->status,
            'created_at' => $p->created_at?->toDateString(),
            'updated_at' => $p->updated_at?->toDateTimeString(),
        ];
    }
}

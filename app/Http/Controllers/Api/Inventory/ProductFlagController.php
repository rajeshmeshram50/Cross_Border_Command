<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\ProductFlag;
use App\Services\Inventory\InventoryCodeAllocator;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductFlagController extends BaseInventoryController
{
    public function __construct(private InventoryCodeAllocator $codes) {}

    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $f      = $request->validate($this->listRules());

            $base = $this->scopeTenant(ProductFlag::query(), $user, $branch, true);
            $tabs = $this->tabCounts(clone $base);

            if ($this->wantsOptions($request)) {
                $body = $this->optionsBody($base, 'flag_name', fn (ProductFlag $p) => $this->optionRow($p));

                DB::commit();

                return response()->json($body, 200);
            }

            $q = $base->orderByDesc('id');
            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['code', 'flag_name', 'purpose']);

            $body = $this->listBody($q, $request, $tabs, fn(ProductFlag $p) => $this->row($p));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    public function nextCode(Request $request)
    {
        $user = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->codes->peek(
                'inventory_product_flags',
                $user->client_id,
                $this->branchScope($request, $user),
            ),
            'preview'   => true,
        ]], 200);
    }

    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $flag = $this->scopeTenant(ProductFlag::query(), $user, $branch, true)->findOrFail($id);

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $data = $request->validate($this->rules());

            if ($this->flagNameTaken($user, $branch, $data['flag_name'], null)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'A product flag with this name already exists.',
                ], 422));
            }

            $flag = new ProductFlag($data + $this->tenantColumns($user, $branch));
            $flag->created_by = $user->id;
            $flag->code = $this->codes->next(
                'inventory_product_flags',
                $flag->client_id,
                $flag->branch_id,
            );
            $flag->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $this->refuseIfPlatformRow(ProductFlag::query(), $user, $id, 'flag');
            $flag = $this->scopeTenant(ProductFlag::query(), $user, $branch)->findOrFail($id);
            $data = $request->validate($this->rules());

            if ($this->flagNameTaken($user, $branch, $data['flag_name'], $flag->id)) {
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

    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $this->refuseIfPlatformRow(ProductFlag::query(), $user, $id, 'flag');
            $flag = $this->scopeTenant(ProductFlag::query(), $user, $branch)->findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            $flag->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($flag)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $this->refuseIfPlatformRow(ProductFlag::query(), $user, $id, 'flag');
            $this->scopeTenant(ProductFlag::query(), $user, $branch)->findOrFail($id)->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    private function rules(): array
    {
        return [
            'flag_name' => ['required', 'string', 'max:120'],
            'purpose'   => ['required', 'string', 'max:255'],
            'status'    => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    private function flagNameTaken($user, ?int $branchId, string $name, ?int $exceptId): bool
    {
        return $this->scopeTenant(ProductFlag::query(), $user, $branchId, true)->where('flag_name', 'ilike', $name)
            ->when($exceptId, fn($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    private function optionRow(ProductFlag $p): array
    {
        return [
            'id'         => $p->id,
            'flag_code'  => $p->flag_code,
            'flag_name'  => $p->flag_name,
            'purpose'    => $p->purpose,
            'is_default' => $p->client_id === null,
        ];
    }

    private function row(ProductFlag $p): array
    {
        return [
            'id'         => $p->id,
            'flag_code'  => $p->flag_code,
            'flag_name'  => $p->flag_name,
            'purpose'    => $p->purpose,
            'is_default' => $p->client_id === null,
            'status'     => (int) $p->status,
            'created_at' => $p->created_at?->toDateString(),
            'updated_at' => $p->updated_at?->toDateTimeString(),
        ];
    }
}

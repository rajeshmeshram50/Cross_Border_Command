<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\ProductFlag;
use App\Services\Inventory\InventoryCodeAllocator;
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
    public function __construct(private InventoryCodeAllocator $codes) {}

    /** GET /inventory/product-flags */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $f      = $request->validate($this->listRules());

            // Reads include the platform defaults (Hazardous, Cold Chain, Fragile):
            // the packing screen resolves its built-in chips against this list.
            $base = $this->scopeTenant(ProductFlag::query(), $user, $branch, true);
            $tabs = $this->tabCounts(clone $base);

            // The dropdown leaves before the tabs, the counts and the paging.
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

    /**
     * GET /inventory/product-flags/options - the picker on the SPI box-item
     * form. Same method as the list, in the dropdown shape.
     */
    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    /**
     * GET /inventory/product-flags/next-code — what the form shows before saving.
     *
     * A preview, not a reservation: two people opening the form see the same
     * number and the second one to save gets the next. Nothing is locked, so
     * the figure the screen shows is only true until somebody else commits.
     */
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

    /** GET /inventory/product-flags/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            // A read, so a platform default is visible like any other flag.
            $flag = $this->scopeTenant(ProductFlag::query(), $user, $branch, true)->findOrFail($id);

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

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $data = $request->validate($this->rules());

            if ($this->nameTaken($user, $branch, $data['flag_name'], null)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'A product flag with this name already exists.',
                ], 422));
            }

            $flag = new ProductFlag($data + $this->tenantColumns($user, $branch));
            $flag->created_by = $user->id;
            // Per branch, under a lock, inside this transaction — and counted
            // on from the platform defaults, which every branch can see.
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

    /** PUT /inventory/product-flags/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);
            $this->refuseIfPlatformRow(ProductFlag::query(), $user, $id, 'flag');
            $flag = $this->scopeTenant(ProductFlag::query(), $user, $branch)->findOrFail($id);
            $data = $request->validate($this->rules());

            if ($this->nameTaken($user, $branch, $data['flag_name'], $flag->id)) {
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

    /** DELETE /inventory/product-flags/{id} */
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

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function rules(): array
    {
        return [
            'flag_name' => ['required', 'string', 'max:120'],
            'purpose'   => ['required', 'string', 'max:255'],
            'status'    => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /**
     * Two flags called "Fragile" would be indistinguishable on the box form.
     * Asked within the branch only: another branch having the name is no
     * clash, because the two never appear on the same picker.
     *
     * Platform defaults are counted, because they DO appear on that picker. A
     * tenant adding a second "Cold Chain" beside the shared one would leave the
     * packing screen — which resolves its built-in chip by name — choosing
     * between two rows, and the box would carry whichever it happened to find.
     */
    private function nameTaken($user, ?int $branchId, string $name, ?int $exceptId): bool
    {
        return $this->scopeTenant(ProductFlag::query(), $user, $branchId, true)->where('flag_name', 'ilike', $name)
            ->when($exceptId, fn($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    /** The dropdown shape: the label and why it exists, nothing more. */
    private function optionRow(ProductFlag $p): array
    {
        return [
            'id'        => $p->id,
            'flag_code' => $p->flag_code,
            'flag_name' => $p->flag_name,
            'purpose'   => $p->purpose,
        ];
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

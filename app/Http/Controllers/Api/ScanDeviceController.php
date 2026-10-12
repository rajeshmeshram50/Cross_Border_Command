<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ScanDevice;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Sticker-scanning handheld allow-list (Inventory → Scan Devices).
 *
 * Admin endpoints are tenant-scoped by the caller's client_id. `check` is the
 * one public endpoint: the handheld's browser presents its credential (no user
 * session needed — the sticker landing page is public) and learns whether it
 * may scan. Anything without a valid, active credential is refused, which is
 * what keeps a personal phone that photographs a sticker out.
 */
class ScanDeviceController extends Controller
{
    public function index(Request $request)
    {
        $clientId = $this->clientId($request);

        $rows = ScanDevice::where('client_id', $clientId)
            ->orderByRaw("CASE status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END")
            ->orderBy('label')
            ->get()
            ->map->toClient();

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        $clientId = $this->clientId($request);

        $data = $request->validate([
            'serial' => ['required', 'string', 'max:64', Rule::unique('scan_devices', 'serial')->where('client_id', $clientId)],
            'label'  => 'required|string|max:120',
            'model'  => 'nullable|string|max:40',
            'branch' => 'nullable|string|max:120',
        ], [
            'serial.unique' => 'This serial is already enrolled.',
        ]);

        [$plain, $hash] = ScanDevice::issueToken();

        $device = ScanDevice::create([
            'client_id'  => $clientId,
            'serial'     => trim($data['serial']),
            'label'      => trim($data['label']),
            'model'      => trim($data['model'] ?? '') ?: 'TC27',
            'location'   => isset($data['branch']) ? trim($data['branch']) : null,
            'status'     => 'active',
            'token_hash' => $hash,
            'created_by' => $request->user()->id,
        ]);

        // The plaintext credential is returned exactly once, here.
        return response()->json(['data' => $device->toClient(), 'token' => $plain], 201);
    }

    public function update(Request $request, int $id)
    {
        $device = $this->scopedFind($request, $id);

        $data = $request->validate([
            'status' => 'sometimes|in:active,suspended,retired',
            'label'  => 'sometimes|string|max:120',
            'branch' => 'sometimes|nullable|string|max:120',
        ]);

        $device->update(array_filter([
            'status'   => $data['status'] ?? null,
            'label'    => $data['label'] ?? null,
            'location' => array_key_exists('branch', $data) ? $data['branch'] : null,
        ], fn ($v) => $v !== null));

        return response()->json(['data' => $device->fresh()->toClient()]);
    }

    /** New credential; the old one stops working immediately. */
    public function rotate(Request $request, int $id)
    {
        $device = $this->scopedFind($request, $id);
        [$plain, $hash] = ScanDevice::issueToken();
        $device->update(['token_hash' => $hash]);

        return response()->json(['data' => $device->toClient(), 'token' => $plain]);
    }

    public function destroy(Request $request, int $id)
    {
        $this->scopedFind($request, $id)->delete();
        return response()->json(['message' => 'Device removed.']);
    }

    /**
     * PUBLIC. Body: { token }. Always 200 so the SPA's 401 → logout interceptor
     * never fires on a handheld; the verdict is in `authorized`.
     */
    public function check(Request $request)
    {
        $device = ScanDevice::findByToken((string) $request->input('token', ''));

        if (!$device) {
            return response()->json(['authorized' => false, 'code' => 'rejected_unauthorized_device', 'device' => null]);
        }

        if ($device->status === 'active') {
            $device->forceFill(['last_seen_at' => now()])->save();
        }

        return response()->json([
            'authorized' => $device->status === 'active',
            'code'       => match ($device->status) {
                'active'    => 'device_ok',
                'suspended' => 'rejected_suspended_device',
                default     => 'rejected_unauthorized_device',
            },
            'device'     => $device->toClient(),
        ]);
    }

    private function clientId(Request $request): int
    {
        $clientId = $request->user()->client_id;
        abort_if(!$clientId, 422, 'Scan devices belong to a client; log in as a client user.');
        return (int) $clientId;
    }

    private function scopedFind(Request $request, int $id): ScanDevice
    {
        return ScanDevice::where('client_id', $this->clientId($request))->findOrFail($id);
    }
}

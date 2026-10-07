<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HrDocumentSignature;
use Illuminate\Http\Request;


class NotificationController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $limit = max(1, min(50, (int) $request->integer('limit', 20)));
        $rows = $user->notifications()
            ->latest()
            ->limit($limit)
            ->get(['id', 'type', 'data', 'read_at', 'created_at']);
        return response()->json(['data' => $this->withLiveSignatureState($rows)]);
    }

    /**
     * A signature notification is written once and never again, so by the time
     * it is read the document has usually moved on — the employee has signed and
     * it is the manager's turn, or the run is finished. The frozen payload then
     * says something untrue: "pending: self" to a signer who already signed.
     *
     * The pending signer is therefore read from the run itself at display time.
     * One query for the page, no writes.
     */
    private function withLiveSignatureState($rows)
    {
        $ids = $rows
            ->filter(fn ($n) => in_array(($n->data['kind'] ?? ''), ['hr_signature_request', 'hr_signature_reminder'], true))
            ->map(fn ($n) => $n->data['document_id'] ?? null)
            ->filter()->unique()->values();
        if ($ids->isEmpty()) return $rows;

        $runs = HrDocumentSignature::whereIn('id', $ids)->get(['id', 'status', 'signers'])->keyBy('id');

        return $rows->map(function ($n) use ($runs) {
            $docId = $n->data['document_id'] ?? null;
            $run = $docId ? $runs->get((int) $docId) : null;
            if (!$run) return $n;

            $signers = collect(is_array($run->signers) ? $run->signers : []);
            $settled = fn ($x) => in_array($x['status'] ?? 'Pending', ['Done', 'Skipped', 'Rejected'], true);
            $waiting = $signers->first(fn ($x) => !$settled($x));

            $data = $n->data;
            $data['run_status']      = $run->status;
            $data['signed_count']    = $signers->filter($settled)->count();
            $data['signers_total']   = $signers->count();
            $data['pending_role']    = $waiting['role_name'] ?? null;
            $data['pending_name']    = $waiting['name'] ?? null;
            $data['pending_user_id'] = isset($waiting['user_id']) ? (int) $waiting['user_id'] : null;
            $n->data = $data;
            return $n;
        });
    }

    public function unreadCount(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        return response()->json(['data' => ['count' => $user->unreadNotifications()->count()]]);
    }

    public function markRead(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $n = $user->notifications()->where('id', $id)->first();
        if (!$n) abort(404);
        if (!$n->read_at) $n->markAsRead();
        return response()->json(['data' => $n]);
    }

    public function markAllRead(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $user->unreadNotifications->markAsRead();
        return response()->json(['data' => ['marked' => true]]);
    }
}

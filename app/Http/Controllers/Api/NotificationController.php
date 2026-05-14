<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

/**
 * Generic in-app notifications endpoint backed by the Laravel
 * notifications table. Drives the bell-icon dropdown in the topbar:
 *   GET    /api/notifications                  — recent rows for the user
 *   GET    /api/notifications/unread-count     — small int for the badge
 *   POST   /api/notifications/{id}/read        — flip one to read
 *   POST   /api/notifications/read-all         — flip every unread to read
 *
 * Notifications are scoped to the signed-in user automatically because
 * each row stores `notifiable_id` + `notifiable_type` and we filter by
 * the auth()->user() relationship.
 */
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
        return response()->json(['data' => $rows]);
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

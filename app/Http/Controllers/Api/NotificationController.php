<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

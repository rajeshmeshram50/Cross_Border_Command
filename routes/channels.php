<?php

use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
*/

// Tenant-scoped approver channel — a user may only listen on their own
// client's channel, so one tenant's approval events never reach another's.
Broadcast::channel('clm.approvals.{clientId}', function ($user, $clientId) {
    return (int) $user->client_id === (int) $clientId;
});

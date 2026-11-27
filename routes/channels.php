<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('clm.approvals.{clientId}', function ($user, $clientId) {
    return (int) $user->client_id === (int) $clientId;
});

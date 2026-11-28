<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\User;
use Symfony\Component\Mime\Email;

/**
 * Resolves the "From" display name for an outgoing email to the sending
 * tenant's identity — Client name, then Branch name — instead of the single
 * static MAIL_FROM_NAME shared by every tenant.
 *
 * Tenant resolution order:
 *   1. The authenticated actor (unless super_admin) — their client + branch.
 *   2. Fallback: the primary recipient's own tenant (employee row, then user
 *      row), so tenant-scoped mails sent by a super_admin or with no auth
 *      context (e.g. welcome / OTP) still carry the right identity.
 *
 * Returns null when no tenant can be resolved, so the caller keeps the
 * configured default name.
 */
class TenantMailFrom
{
    public static function resolve(Email $message): ?string
    {
        [$clientId, $branchId] = self::resolveTenant($message);
        if ($clientId === null && $branchId === null) {
            return null;
        }

        $clientName = $clientId ? Client::whereKey($clientId)->value('org_name') : null;
        $branchName = $branchId ? Branch::whereKey($branchId)->value('name') : null;

        $parts = array_values(array_filter(
            [$clientName, $branchName],
            fn ($v) => is_string($v) && trim($v) !== ''
        ));

        return $parts ? implode(' - ', array_map('trim', $parts)) : null;
    }

    /** @return array{0:?int,1:?int} [clientId, branchId] */
    private static function resolveTenant(Email $message): array
    {
        $actor = auth()->user();
        if ($actor && $actor->user_type !== 'super_admin' && $actor->client_id) {
            return [$actor->client_id, $actor->branch_id];
        }

        $to = $message->getTo()[0] ?? null;
        $email = $to?->getAddress();
        if (!$email) {
            return [null, null];
        }
        $lc = mb_strtolower($email);

        $emp = Employee::query()
            ->whereRaw('LOWER(email) = ?', [$lc])
            ->first(['client_id', 'branch_id']);
        if ($emp && $emp->client_id) {
            return [$emp->client_id, $emp->branch_id];
        }

        $u = User::query()
            ->whereRaw('LOWER(email) = ?', [$lc])
            ->first(['client_id', 'branch_id']);
        if ($u && $u->client_id) {
            return [$u->client_id, $u->branch_id];
        }

        return [null, null];
    }
}

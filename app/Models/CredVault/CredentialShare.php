<?php

namespace App\Models\CredVault;

use App\Models\Masters\Departments;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * CredVault · a share of one credential with a person or a team.
 * Never deleted — a revoke stamps revoked_at, an expiry is just a date.
 */
class CredentialShare extends Model
{
    protected $table = 'credvault_shares';

    public const RECIPIENTS  = ['user', 'team'];
    /** Ordered weakest first: each level can do everything the one before it can. */
    public const PERMISSIONS = ['use', 'view', 'copy', 'full'];

    protected $fillable = [
        'client_id', 'credential_id', 'shared_by', 'recipient_type', 'recipient_user_id',
        'recipient_department_id', 'permission', 'reason', 'expires_at', 'revoked_at', 'revoked_by',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /** Not revoked and not past its end date. */
    public function scopeLive(Builder $q): Builder
    {
        return $q->whereNull('revoked_at')
            ->where(fn ($w) => $w->whereNull('expires_at')->orWhere('expires_at', '>', now()));
    }

    /** active | soon (under 3 days left) | expired | revoked — the Shared By Me status. */
    public function state(): string
    {
        if ($this->revoked_at) return 'revoked';
        if (!$this->expires_at) return 'active';
        if ($this->expires_at->isPast()) return 'expired';
        return $this->expires_at->lt(now()->addDays(3)) ? 'soon' : 'active';
    }

    public static function rank(?string $perm): int
    {
        $i = array_search($perm, self::PERMISSIONS, true);
        return $i === false ? -1 : $i;
    }

    public function credential(): BelongsTo
    {
        return $this->belongsTo(Credential::class, 'credential_id')->withTrashed();
    }

    public function recipientUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_user_id');
    }

    public function recipientDepartment(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'recipient_department_id');
    }

    public function sharer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'shared_by');
    }
}

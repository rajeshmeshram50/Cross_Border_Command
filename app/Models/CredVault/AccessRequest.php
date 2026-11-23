<?php

namespace App\Models\CredVault;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccessRequest extends Model
{
    protected $table = 'credvault_access_requests';

    public const OPEN     = ['pending', 'approved', 'unlocked'];
    public const STATUSES = ['pending', 'approved', 'unlocked', 'locked', 'rejected', 'cancelled'];
    public const DURATIONS = [5, 15, 30, 60];
    public const MAX_OTP_ATTEMPTS = 3;
    public const DEFAULT_MINUTES = 5;

    protected $fillable = [
        'client_id', 'code', 'credential_id', 'requester_id', 'reason', 'duration_minutes',
        'admin_required', 'admin_user_id', 'admin_status', 'admin_decided_by', 'admin_decided_at', 'admin_note',
        'manager_required', 'manager_user_id', 'manager_status', 'manager_decided_by', 'manager_decided_at', 'manager_note',
        'otp_required', 'otp_verified_at', 'otp_attempts',
        'status', 'unlocked_at', 'expires_at', 'locked_at', 'locked_reason',
    ];

    protected $casts = [
        'admin_required'     => 'boolean',
        'manager_required'   => 'boolean',
        'otp_required'       => 'boolean',
        'otp_attempts'       => 'integer',
        'duration_minutes'   => 'integer',
        'admin_decided_at'   => 'datetime',
        'manager_decided_at' => 'datetime',
        'otp_verified_at'    => 'datetime',
        'unlocked_at'        => 'datetime',
        'expires_at'         => 'datetime',
        'locked_at'          => 'datetime',
    ];

    public function currentStage(): ?string
    {
        if (!in_array($this->status, ['pending', 'approved'], true)) return null;
        if ($this->admin_required && $this->admin_status !== 'approved') return 'admin';
        if ($this->manager_required && $this->manager_status !== 'approved') return 'manager';
        if ($this->otp_required && !$this->otp_verified_at) return 'otp';
        return null;
    }

    public function isLive(): bool
    {
        return $this->status === 'unlocked' && $this->expires_at && $this->expires_at->isFuture();
    }

    public function credential(): BelongsTo
    {
        return $this->belongsTo(Credential::class, 'credential_id')->withTrashed();
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function adminUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'admin_user_id');
    }

    public function managerUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_user_id');
    }

    public function adminDecider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'admin_decided_by');
    }

    public function managerDecider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_decided_by');
    }
}

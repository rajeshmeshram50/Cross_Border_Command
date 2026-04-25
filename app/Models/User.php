<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $fillable = [
        'name',
        'email',
        'password',
        'phone',
        'user_type',
        'client_id',
        'branch_id',
        'department_id',
        'status',
        'avatar',
        'designation',
        'employee_code',
        'last_login_at',
        'last_login_ip',
        'login_count',
        'device_token',
        'login_source',
        'google_id',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'device_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'last_login_at' => 'datetime',
            'login_count' => 'integer',
        ];
    }

    // ── Relationships ──

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function details(): HasOne
    {
        return $this->hasOne(UserDetail::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(Permission::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function approvalSubmissions(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class, 'submitted_by');
    }

    public function approvalReviews(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class, 'approved_by');
    }

    // ── Helpers ──

    public function isSuperAdmin(): bool
    {
        return $this->user_type === 'super_admin';
    }

    public function isClientAdmin(): bool
    {
        return $this->user_type === 'client_admin';
    }

    public function isClientUser(): bool
    {
        return $this->user_type === 'client_user';
    }

    public function isBranchUser(): bool
    {
        return $this->user_type === 'branch_user';
    }

    public function isMainBranchUser(): bool
    {
        return $this->isBranchUser() && $this->branch?->is_main;
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}

<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Candidate extends Model
{
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'candidate';
    protected static array  $emailColumns = ['email'];

    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'recruitment_id',

        'name', 'email', 'mobile', 'current_address', 'qualification',
        'experience_years', 'mode_of_transport', 'distance_km',

        'current_salary_lpa', 'expected_salary_lpa', 'notice_period',

        'source', 'referred_by_id', 'referred_by_name',
        'cv_path', 'cv_original_name',

        'status', 'rejection_reason', 'status_notes',
    ];

    protected $casts = [
        'experience_years'    => 'decimal:2',
        'distance_km'         => 'decimal:2',
        'current_salary_lpa'  => 'decimal:2',
        'expected_salary_lpa' => 'decimal:2',
    ];

    public function setEmailAttribute($value): void
    {
        $trimmed = trim((string) $value);

        $this->attributes['email'] = $trimmed === ''
            ? $value
            : mb_strtolower($trimmed);
    }

    protected $appends = ['cv_url', 'initials', 'accent'];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function recruitment(): BelongsTo
    {
        return $this->belongsTo(Recruitment::class);
    }

    public function referrer(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'referred_by_id');
    }

    public function getCvUrlAttribute(): ?string
    {
        if (empty($this->cv_path) || empty($this->id)) return null;
        return url("/api/candidates/{$this->id}/cv");
    }

    public function getInitialsAttribute(): string
    {
        $name = trim((string) ($this->name ?? ''));
        if ($name === '') return '–';
        $parts = preg_split('/\s+/', $name) ?: [];
        $letters = array_map(fn ($p) => mb_substr($p, 0, 1), array_slice($parts, 0, 2));
        return mb_strtoupper(implode('', $letters));
    }

    public function getAccentAttribute(): string
    {
        $palette = ['#7c5cfc', '#0ab39c', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#f97316', '#ec4899', '#06b6d4'];
        $seed = (string) ($this->id ?? $this->name ?? '');
        $hash = 0;
        for ($i = 0, $n = strlen($seed); $i < $n; $i++) {
            $hash = ($hash * 31 + ord($seed[$i])) & 0xffffffff;
        }
        return $palette[$hash % count($palette)];
    }
}

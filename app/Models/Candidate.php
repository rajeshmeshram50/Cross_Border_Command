<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

class Candidate extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'recruitment_id',

        'name', 'email', 'mobile', 'current_address', 'qualification',
        'experience_years', 'mode_of_transport', 'distance_km',

        'current_salary_lpa', 'expected_salary_lpa', 'notice_period',

        'source',
        'cv_path', 'cv_original_name',

        'status', 'rejection_reason', 'status_notes',
    ];

    protected $casts = [
        'experience_years'    => 'decimal:2',
        'distance_km'         => 'decimal:2',
        'current_salary_lpa'  => 'decimal:2',
        'expected_salary_lpa' => 'decimal:2',
    ];

    /**
     * Append the computed CV URL + initials/accent helpers to every JSON
     * payload. The frontend's CandidateRow shape relies on these.
     */
    protected $appends = ['cv_url', 'initials', 'accent'];

    // ── Relationships ───────────────────────────────────────────────────

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

    // ── Computed accessors ──────────────────────────────────────────────

    /**
     * Public URL the frontend uses for the green "CV" download chip.
     * Returns null when no CV was uploaded so the table renders an em-dash.
     */
    public function getCvUrlAttribute(): ?string
    {
        if (empty($this->cv_path)) return null;
        // Honour the storage symlink — assumes the file lives on the public
        // disk (Storage::disk('public')->url(...) prefixes /storage/).
        return Storage::disk('public')->url($this->cv_path);
    }

    /** Two-letter initials for the avatar bubble in the candidate table. */
    public function getInitialsAttribute(): string
    {
        $name = trim((string) ($this->name ?? ''));
        if ($name === '') return '–';
        $parts = preg_split('/\s+/', $name) ?: [];
        $letters = array_map(fn ($p) => mb_substr($p, 0, 1), array_slice($parts, 0, 2));
        return mb_strtoupper(implode('', $letters));
    }

    /**
     * Deterministic accent colour seeded by id+name so the same candidate
     * always renders with the same avatar tone. Matches the palette used by
     * the recruitment / hiring-request rows.
     */
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

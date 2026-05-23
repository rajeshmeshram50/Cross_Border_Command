<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

/**
 * "Segments" master — backed by the unified `clm_segments` table.
 *
 * Previously this model wrote to a separate `master_segments` table with a
 * different shape (id, title, status only). The May-2026 consolidation
 * migration collapsed both stores into `clm_segments`, so this model now
 * surfaces `clm_segments` rows through the legacy `title`/`status` API the
 * Customer / Consignee / Vendor / Product forms (and the master CRUD UI)
 * still use.
 *
 * Compatibility shims:
 *   • `title` is aliased to `name` so existing API consumers keep working.
 *   • `code` is auto-generated per client (S-001, S-002, …) on insert.
 *   • `regulatory_status` and `buyer_consignee` default to safe values so a
 *     simple "title + status" form can save without supplying them — the
 *     CLM Segment page is where they get edited in detail.
 */
class Segments extends Model
{
    protected $table = 'clm_segments';

    protected $fillable = [
        'client_id',
        'branch_id',
        'code',
        'name',
        'title',
        'regulatory_status',
        'buyer_consignee',
        'status',
        'created_by',
        'updated_by',
    ];

    /** Surface `title` on every JSON response so the existing frontends
     *  (which read row.title) keep working without changes. */
    protected $appends = ['title'];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /** Eager-loaded by MasterController so the ownership chip in the
     *  master CRUD UI can show which branch a row belongs to. */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** title ↔ name accessor pair — read-and-write so mass-assign of
     *  `['title' => '...']` lands on the `name` column. */
    public function getTitleAttribute(): ?string
    {
        return $this->attributes['name'] ?? null;
    }

    public function setTitleAttribute(?string $value): void
    {
        $this->attributes['name'] = $value;
    }

    /** Auto-fill the required clm_segments columns that the legacy
     *  master CRUD form doesn't supply: code (S-NNN per client),
     *  regulatory_status, buyer_consignee, and normalise status. */
    protected static function booted(): void
    {
        static::creating(function (Segments $row) {
            if (empty($row->code)) {
                $row->code = self::nextCode($row->client_id);
            }
            if (empty($row->regulatory_status)) {
                $row->regulatory_status = 'less';
            }
            if (empty($row->buyer_consignee)) {
                $row->buyer_consignee = 'allowed';
            }
            // Status normalisation — accept both 'Active'/'active' for
            // backward compatibility with the master form.
            if (!empty($row->status)) {
                $row->status = strtolower((string) $row->status);
                if (!in_array($row->status, ['active', 'inactive'], true)) {
                    $row->status = 'active';
                }
            } else {
                $row->status = 'active';
            }
        });
    }

    /** Per-client S-NNN sequence — mirrors the logic in ClmSegmentController
     *  so codes produced by either entry point share a single counter. */
    private static function nextCode(?int $clientId): string
    {
        $count = static::query()
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->count();
        return sprintf('S-%03d', $count + 1);
    }
}

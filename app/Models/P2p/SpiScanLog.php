<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Every put-away scan ATTEMPT, success and failure.
 *
 * SpiPutaway holds the outcome; this holds the attempts. A rejected scan —
 * wrong box, out of order, unreadable barcode — never touches the put-away
 * table, so without a row here it is invisible. This is what turns "the
 * scanner isn't working" into an answerable question.
 *
 * Grows per TAP, not per document: the fastest-growing table in the module.
 * Pruning old successes loses no business state, because the outcome lives in
 * SpiPutaway.
 */
class SpiScanLog extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_scan_logs';

    /** Append-only, and the timestamp is `scanned_at`. */
    public $timestamps = false;

    public const SCAN_TYPES = ['box', 'location', 'rack', 'shelf'];

    public const RESULT_SUCCESS = 'success';
    public const RESULT_FAILED  = 'failed';

    public const FAILURE_REASONS = [
        'unknown_code', 'wrong_spi', 'out_of_order', 'shelf_not_on_rack',
        'already_placed', 'inactive_location', 'duplicate_scan', 'no_spi_context',
    ];

    protected $fillable = [
        'client_id', 'branch_id',
        'supplier_invoice_id', 'putaway_id', 'box_id',
        'scan_type', 'scanned_value', 'resolved_id',
        'result', 'failure_reason', 'message', 'expected_scan',
        'device_id', 'device_serial', 'scanned_by', 'latency_ms',
        'scanned_at',
    ];

    protected $casts = [
        'latency_ms' => 'integer',
        'scanned_at' => 'datetime',
    ];

    public function invoice(): BelongsTo   { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function putaway(): BelongsTo   { return $this->belongsTo(SpiPutaway::class, 'putaway_id'); }
    public function box(): BelongsTo       { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function scannedBy(): BelongsTo { return $this->belongsTo(User::class, 'scanned_by'); }

    public function failed(): bool
    {
        return $this->result === self::RESULT_FAILED;
    }

    /** Only failures are ever queried in bulk, and they carry the partial index. */
    public function scopeFailures($query)
    {
        return $query->where('result', self::RESULT_FAILED);
    }
}

<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SpiActivity extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_activities';

    public $timestamps = false;

    public const EVENTS = [
        'created', 'stage1_saved', 'invoice_uploaded', 'eway_uploaded',
        'item_added', 'item_updated', 'item_removed',
        'box_created', 'box_updated', 'box_deleted', 'box_scenario_changed', 'packed', 'unpacked', 'sticker_printed',
        'storage_type_set', 'box_scanned', 'rack_scanned', 'shelf_scanned', 'putaway_confirmed',
        'submitted', 'cancelled', 'zoho_synced', 'zoho_failed',
    ];

    protected $fillable = [
        'client_id', 'branch_id',
        'supplier_invoice_id', 'supplier_invoice_item_id', 'box_id', 'stage',
        'event', 'field', 'old_value', 'new_value', 'quantity', 'note',
        'performed_by', 'performed_at',
    ];

    protected $casts = [
        'stage'        => 'integer',
        'quantity'     => 'decimal:3',
        'performed_at' => 'datetime',
    ];

    public function invoice(): BelongsTo     { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function invoiceItem(): BelongsTo { return $this->belongsTo(SupplierInvoiceItem::class, 'supplier_invoice_item_id'); }
    public function box(): BelongsTo         { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function performedBy(): BelongsTo { return $this->belongsTo(User::class, 'performed_by'); }

    public function isFieldChange(): bool
    {
        return $this->field !== null;
    }
}

<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Masters\WarehouseMaster;
use App\Models\User;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Supplier Purchase Invoice — the header.
 * Tenant-scoped through BelongsToTenant (client + branch from the request).
 *
 * Four flavours, and the two splits are independent: with / without PO, each
 * with / without a shipment. Everything conditional keys off
 * `purchase_order_id IS NULL` — there is no separate "standalone" flag, because
 * a second column saying the same thing is a second thing to keep in step.
 *
 * The lead, shipment and procurement chips the list prints are NOT stored here.
 * They are read through the purchase order, which already holds all three.
 */
class SupplierInvoice extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_supplier_invoices';

    public const STATUS_DRAFT       = 'draft';
    public const STATUS_MAPPED      = 'mapped';
    public const STATUS_GRN_PENDING = 'grn_pending';
    public const STATUS_CLOSED      = 'closed';
    public const STATUS_CANCELLED   = 'cancelled';

    public const STATUSES  = ['draft', 'mapped', 'grn_pending', 'closed', 'cancelled'];
    public const DOC_TYPES = ['domestic', 'international'];

    /** What the list prints for each status — also what the search matches on. */
    public const STATUS_LABELS = [
        'draft'       => 'Draft',
        'mapped'      => 'Mapped',
        'grn_pending' => 'GRN Pending',
        'closed'      => 'Closed',
        'cancelled'   => 'Cancelled',
    ];

    protected $fillable = [
        'client_id',
        'branch_id',
        'code',
        'purchase_order_id',
        'vendor_id',
        'invoice_no',
        'invoice_date',
        'invoice_file_path',
        'invoice_file_name',
        'eway_no',
        'eway_file_path',
        'eway_file_name',
        'taxable_total',
        'total_cgst',
        'total_sgst',
        'total_igst',
        'grand_total',
        'document_type',
        'currency_code',
        'exchange_rate',
        'stage_completed',
        'status',
        'warehouse_id',
        'zoho_bill_id',
        'zoho_bill_number',
        'zoho_status',
        'zoho_error',
        'zoho_synced_at',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'invoice_date'    => 'date',
        'taxable_total'   => 'decimal:2',
        'total_cgst'      => 'decimal:2',
        'total_sgst'      => 'decimal:2',
        'total_igst'      => 'decimal:2',
        'grand_total'     => 'decimal:2',
        'exchange_rate'   => 'decimal:6',
        'stage_completed' => 'integer',
        'zoho_synced_at'  => 'datetime',
    ];

    /* ── Relationships ───────────────────────────────────────────────── */

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id');
    }
    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(WarehouseMaster::class, 'warehouse_id');
    }
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function items(): HasMany
    {
        return $this->hasMany(SupplierInvoiceItem::class, 'supplier_invoice_id');
    }
    public function boxes(): HasMany
    {
        return $this->hasMany(SpiBox::class, 'supplier_invoice_id');
    }
    public function putaways(): HasMany
    {
        return $this->hasMany(SpiPutaway::class, 'supplier_invoice_id');
    }
    public function fulfilments(): HasMany
    {
        return $this->hasMany(SpiPoFulfilment::class, 'supplier_invoice_id');
    }
    public function activities(): HasMany
    {
        return $this->hasMany(SpiActivity::class, 'supplier_invoice_id');
    }

    /** Payment requests raised against this invoice. The money still moves on the PO. */
    public function paymentRequests(): HasMany
    {
        return $this->hasMany(PoPaymentRequest::class, 'supplier_invoice_id');
    }

    /* ── State ───────────────────────────────────────────────────────── */

    /** No purchase order behind it: the supplier was picked directly. */
    public function isStandalone(): bool
    {
        return $this->purchase_order_id === null;
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }
    public function isCancelled(): bool
    {
        return $this->status === self::STATUS_CANCELLED;
    }

    /** Editable only while nothing downstream depends on it. */
    public function isEditable(): bool
    {
        return in_array($this->status, [self::STATUS_DRAFT, self::STATUS_MAPPED], true);
    }

    public function isInternational(): bool
    {
        return $this->document_type === 'international';
    }

    /**
     * Only a standalone invoice creates its own Zoho bill. With a PO the bill
     * already exists on the order, and creating a second one would show the
     * supplier's amount twice in Zoho.
     */
    public function ownsZohoBill(): bool
    {
        return $this->isStandalone();
    }
}

<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Inventory\Warehouse;
use App\Models\ShipmentOrder;
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
        /* Direct SPI only. A PO-backed invoice leaves these null and keeps
           reading the order's, which stays the authority while it exists. */
        'shipment_order_id',
        'procurement_request_id',
        'procurement_request_code',
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
        /* Direct SPI is paid on its own, so the deduction and the ledger
           live here. TDS is cut on taxable_total, not grand_total — GST
           is not subject to it. A PO-backed invoice leaves these null
           and keeps deducting from its order. */
        'tds_percentage',
        'tds_amount',
        'tds_updated_by',
        'tds_updated_at',
        'paid_amount',
        'balance_amount',
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
        'tds_percentage'  => 'decimal:2',
        'tds_amount'      => 'decimal:2',
        'tds_updated_at'  => 'datetime',
        'paid_amount'     => 'decimal:2',
        'balance_amount'  => 'decimal:2',
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
    /** GST senior approvals raised against THIS invoice (Direct SPI only —
     *  a PO-backed invoice raises them on its order). */
    public function gstApprovals(): HasMany
    {
        return $this->hasMany(PoGstApproval::class, 'supplier_invoice_id');
    }

    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id');
    }
    /** Direct SPI only — a PO-backed invoice reads its shipment through the order. */
    public function shipmentOrder(): BelongsTo
    {
        return $this->belongsTo(ShipmentOrder::class, 'shipment_order_id');
    }
    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
    /**
     * The Inventory warehouse master — NOT master_warehouse_master.
     *
     * This pointed at the generic Masters table because on 9 Oct, when the SPI
     * was written, that was the only warehouse master there was. The five
     * Inventory masters arrived on 10 Oct with their own tables and the SPI was
     * never switched over, so the Temporary Storage picker listed
     * inventory_warehouses while the invoice read the id back out of
     * master_warehouse_master — two unrelated tables whose ids happen to
     * overlap. Picking WH-001 and reading back a different company's WH-001 is
     * what that cost.
     */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'warehouse_id');
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

<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\ProformaInvoice;
use App\Models\ShipmentOrder;
use App\Models\User;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Create Purchase Order — the PO header.
 * Tenant-scoped through BelongsToTenant (client + branch from the request).
 */
class PurchaseOrder extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_purchase_orders';

    public const STATUS_DRAFT     = 'draft';
    public const STATUS_SUBMITTED = 'submitted';
    public const STATUS_CANCELLED = 'cancelled';

    /** Cancelled with money released: initiated until the refund is recovered, then closed. */
    public const CANCEL_INITIATED = 'initiated';
    public const CANCEL_CLOSED    = 'closed';

    public const PO_TYPES   = ['material_goods', 'services', 'ffd_transporter'];
    public const DOC_TYPES  = ['domestic', 'international'];
    public const YES_NO     = ['yes', 'no'];
    public const LINK_TYPES = ['with_shipment', 'standalone'];
    public const TRANSPORT_MODES = ['Sea', 'Road', 'Air'];
    public const INCO_TERMS = ['CIF', 'C&F', 'EXW', 'FOB'];
    /** PO types that can be raised today; the others are listed but not open yet. */
    public const OPEN_PO_TYPES = ['material_goods'];
    public const PAYMENT_TYPES = ['Advanced Payment', 'Full Payment', 'Letter of Credit'];
    /** The supplier type (master_vendor_types.name) each PO type needs. */
    public const PO_TYPE_SUPPLIER_TYPE = [
        'material_goods'  => 'Material / Goods',
        'ffd_transporter' => 'FFD / Transporter',
    ];

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'po_date', 'status', 'current_step',
        'po_type', 'document_type', 'mode_of_transport', 'expected_delivery_date',
        'delivery_location', 'payment_type', 'physical_inspection',
        'currency_code', 'exchange_rate', 'inco_term', 'port_of_loading', 'port_of_discharge',
        'final_destination', 'country_of_origin',
        'link_type', 'link_procurement', 'procurement_request_id', 'procurement_request_code',
        'shipment_order_id', 'proforma_invoice_id', 'lead_id',
        'vendor_id',
        'home_state_code', 'tax_mode',
        'gst_gate', 'gst_scrutiny_date', 'gst_last_filing_date', 'gst_approval_status',
        'gst_approval_requested_by', 'gst_approval_requested_at', 'gst_approval_by', 'gst_approval_at', 'gst_approval_note',
        'taxable_total', 'total_cgst', 'total_sgst', 'total_igst',
        'shipping_charges', 'packaging_charges', 'other_charges', 'grand_total',
        'terms', 'submitted_at', 'submitted_by',
        'tds_percentage', 'tds_amount', 'tds_updated_by', 'tds_updated_at', 'paid_amount', 'balance_amount',
        'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_stage', 'cancel_closed_at',
        'zoho_status', 'zoho_purchaseorder_id', 'zoho_bill_id', 'zoho_bill_number', 'zoho_synced_at', 'zoho_error',
        'inspection_status', 'inspection_note', 'inspection_note_files', 'inspected_by', 'inspected_at',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'po_date'                   => 'date',
        'expected_delivery_date'    => 'date',
        'gst_scrutiny_date'         => 'date',
        'gst_last_filing_date'      => 'date',
        'gst_approval_requested_at' => 'datetime',
        'gst_approval_at'           => 'datetime',
        'submitted_at'              => 'datetime',
        'cancelled_at'              => 'datetime',
        'cancel_closed_at'          => 'datetime',
        'zoho_synced_at'            => 'datetime',
        'inspected_at'              => 'datetime',
        'inspection_note_files'     => 'array',
        'exchange_rate'             => 'decimal:6',
        'taxable_total'             => 'decimal:2',
        'total_cgst'                => 'decimal:2',
        'total_sgst'                => 'decimal:2',
        'total_igst'                => 'decimal:2',
        'shipping_charges'          => 'decimal:2',
        'packaging_charges'         => 'decimal:2',
        'other_charges'             => 'decimal:2',
        'grand_total'               => 'decimal:2',
        'tds_percentage'            => 'decimal:2',
        'tds_amount'                => 'decimal:2',
        'tds_updated_at'            => 'datetime',
        'paid_amount'               => 'decimal:2',
        'balance_amount'            => 'decimal:2',
        'current_step'              => 'integer',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PurchaseOrderItem::class, 'purchase_order_id')->orderBy('line_no');
    }

    public function qtyHistories(): HasMany
    {
        return $this->hasMany(PoItemQtyHistory::class, 'purchase_order_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(PurchaseOrderDocument::class, 'purchase_order_id');
    }

    public function inspections(): HasMany
    {
        return $this->hasMany(PoPhysicalInspection::class, 'purchase_order_id');
    }

    public function paymentRequests(): HasMany
    {
        return $this->hasMany(PoPaymentRequest::class, 'purchase_order_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(PoPayment::class, 'purchase_order_id');
    }

    public function refundAdjustment(): HasOne
    {
        return $this->hasOne(PoRefundAdjustment::class, 'purchase_order_id');
    }

    public function gstApprovals(): HasMany
    {
        return $this->hasMany(PoGstApproval::class, 'purchase_order_id');
    }

    /** The latest senior-approval request — the one that decides whether the PO may be submitted. */
    public function latestGstApproval(): HasOne
    {
        return $this->hasOne(PoGstApproval::class, 'purchase_order_id')->latestOfMany();
    }

    public function vendor(): BelongsTo        { return $this->belongsTo(Vendor::class)->withTrashed(); }
    public function shipmentOrder(): BelongsTo { return $this->belongsTo(ShipmentOrder::class); }
    public function proformaInvoice(): BelongsTo { return $this->belongsTo(ProformaInvoice::class); }
    public function client(): BelongsTo        { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo        { return $this->belongsTo(Branch::class); }
    public function creator(): BelongsTo       { return $this->belongsTo(User::class, 'created_by'); }

    public function isCancelled(): bool { return $this->status === self::STATUS_CANCELLED; }

    /** Payments have started: a pending / approved payment request, or money paid. The PO is then view-only. */
    public function paymentsStarted(): bool
    {
        return (float) $this->paid_amount > 0
            || $this->paymentRequests()->withoutGlobalScope('tenant')->whereIn('status', [PoPaymentRequest::STATUS_PENDING, PoPaymentRequest::STATUS_APPROVED])->exists();
    }

    /** Sent to a senior for GST approval and not decided yet. Frozen until then —
        the senior must decide on the PO as it was sent; a rejection reopens it. */
    public function awaitingApproval(): bool
    {
        return $this->latestGstApproval()->where('status', PoGstApproval::STATUS_PENDING)->exists();
    }

    /** A document on it has gone out for signature, or come back signed. The
        supplier is signing what was sent, so the PO must not change under it.
        A declined / recalled / expired request puts its documents back to
        pending (PoDocumentService::syncSignatures), which lifts this again. */
    public function signingStarted(): bool
    {
        return $this->documents()->whereIn('status', [PurchaseOrderDocument::STATUS_SENT, PurchaseOrderDocument::STATUS_SIGNED])->exists();
    }

    /** Content is frozen once cancelled or once any document is out for signature / signed. */
    public function isLocked(): bool
    {
        return $this->isCancelled() || $this->signingStarted();
    }
}

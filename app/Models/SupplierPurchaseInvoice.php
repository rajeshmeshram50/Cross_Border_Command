<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SupplierPurchaseInvoice extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'code',
        'invoice_no', 'invoice_date', 'document_type', 'po_type',
        'mode_of_transport', 'payment_type', 'delivery_location', 'expected_delivery_date', 'physical_inspection',
        'currency', 'exchange_rate', 'inco_term', 'port_of_loading', 'port_of_discharge', 'final_destination', 'country_of_origin',
        'purchase_order_id', 'po_code',
        'vendor_id', 'supplier_code', 'supplier_name', 'supplier_type',
        'shipment_order_id', 'shipment_code', 'proforma_invoice_id', 'pi_number',
        'opportunity_id', 'opportunity_code', 'procurement_id', 'procurement_code',
        'customer_name', 'consignee_name',
        'total_po_amount', 'total_product_cost', 'total_cgst', 'total_sgst', 'total_igst',
        'additional_charges', 'net_payable', 'total_paid', 'balance',
        'tds_percentage', 'tds_amount', 'tds_cut',
        'attachment_path', 'zoho_status', 'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'expected_delivery_date' => 'date',
        'physical_inspection' => 'boolean',
        'exchange_rate' => 'decimal:4',
        'total_po_amount' => 'decimal:2',
        'total_product_cost' => 'decimal:2',
        'total_cgst' => 'decimal:2',
        'total_sgst' => 'decimal:2',
        'additional_charges' => 'decimal:2',
        'net_payable' => 'decimal:2',
        'total_paid' => 'decimal:2',
        'balance' => 'decimal:2',
        'tds_percentage' => 'decimal:2',
        'tds_amount' => 'decimal:2',
        'tds_cut' => 'boolean',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function vendor(): BelongsTo { return $this->belongsTo(Vendor::class); }
    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class); }
    public function shipmentOrder(): BelongsTo { return $this->belongsTo(ShipmentOrder::class); }
    public function items(): HasMany { return $this->hasMany(SupplierPurchaseInvoiceItem::class)->orderBy('line_no')->orderBy('id'); }
    public function spiPayments(): HasMany { return $this->hasMany(SpiPayment::class)->orderBy('id'); }
}

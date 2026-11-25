<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\EnforcesSegmentBuyerConsignee;
use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Employee;
use App\Models\Lead;
use App\Models\LeadAckReason;
use App\Models\LeadAcknowledgement;
use App\Models\LeadProduct;
use App\Models\LeadProductSharedPrice;
use App\Models\LeadTaskManager;
use App\Models\ProcurementProduct;
use Barryvdh\DomPDF\Facade\Pdf;
use App\Models\User;
use App\Services\IndiaMartLeadSyncService;
use App\Support\PostalCode;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class SalesLeadController extends Controller
{
    use EnforcesSegmentBuyerConsignee;

    private const ISO_COUNTRY_NAMES = [
        'IN' => 'India',         'US' => 'United States', 'GB' => 'United Kingdom',
        'AU' => 'Australia',     'CA' => 'Canada',        'IT' => 'Italy',
        'PK' => 'Pakistan',      'CN' => 'China',         'SA' => 'Saudi Arabia',
        'AE' => 'United Arab Emirates', 'NG' => 'Nigeria','KE' => 'Kenya',
        'KR' => 'South Korea',   'UG' => 'Uganda',        'YE' => 'Yemen',
        'KZ' => 'Kazakhstan',    'JP' => 'Japan',         'DE' => 'Germany',
        'FR' => 'France',        'ES' => 'Spain',         'BR' => 'Brazil',
        'MX' => 'Mexico',        'RU' => 'Russia',        'ZA' => 'South Africa',
        'EG' => 'Egypt',         'TR' => 'Turkey',        'BD' => 'Bangladesh',
        'LK' => 'Sri Lanka',     'NP' => 'Nepal',         'TH' => 'Thailand',
        'VN' => 'Vietnam',       'MY' => 'Malaysia',      'SG' => 'Singapore',
        'PH' => 'Philippines',   'ID' => 'Indonesia',     'OM' => 'Oman',
        'QA' => 'Qatar',         'KW' => 'Kuwait',        'BH' => 'Bahrain',
        'JO' => 'Jordan',        'LB' => 'Lebanon',       'IQ' => 'Iraq',
        'IR' => 'Iran',          'AF' => 'Afghanistan',   'NZ' => 'New Zealand',
    ];

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::query()
            ->select('leads.*')
            ->addSelect(['currency' => \Illuminate\Support\Facades\DB::table('lead_products')
                ->select('currency')
                ->whereColumn('lead_products.lead_id', 'leads.id')
                ->whereNotNull('currency')
                ->limit(1)])
            ->addSelect(['pi_number' => \Illuminate\Support\Facades\DB::table('proforma_invoices')
                ->select('code')
                ->whereColumn('proforma_invoices.opp_id', 'leads.id')
                ->where('proforma_invoices.status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
                ->orderByDesc('id')
                ->limit(1)])
            ->addSelect(['shipment_id' => \Illuminate\Support\Facades\DB::table('shipment_orders')
                ->select('shipment_code')
                ->whereColumn('shipment_orders.lead_id', 'leads.id')
                ->whereNotNull('shipment_code')
                ->orderByDesc('id')
                ->limit(1)])
            ->with([
                'salesperson' => fn ($r) => $r->select('id', 'name')->withTrashed(),
                'customer'    => fn ($r) => $r->select('id', 'company_name', 'legal_name', 'customer_code', 'primary_email')
                    ->withTrashed()
                    ->with(['primaryAddress' => fn ($a) => $a->select('id', 'customer_id', 'cp_name', 'cp_email', 'cp_contact', 'country', 'state', 'city')]),
                'consignee'   => fn ($r) => $r->select('id', 'company_name')->withTrashed(),
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user, $request->integer('branch_id') ?: null, true);

        $status = $request->query('status');
        if ($status === 'qualified') {
            $q->where('qualified', true)->where('disqualified', false);
        } elseif ($status === 'disqualified') {
            $q->where('disqualified', true);
        } elseif ($status === 'key_opportunity') {
            $q->where('key_opportunity', true);
            $dealState = $request->query('deal_state');
            if ($dealState === 'in_progress') {
                $q->whereNull('won_at');
            } elseif ($dealState === 'won') {
                $q->whereNotNull('won_at');
            }
        }

        $this->applyListFilters($q, $request);

        if ($request->boolean('lead_ack_complete') || $request->boolean('price_shared_complete')) {
            $q->where('leads.qualified', true)
              ->where('leads.disqualified', false)
              ->whereExists(function ($sub) {
                  $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                      ->from('lead_acknowledgements')
                      ->whereColumn('lead_acknowledgements.lead_id', 'leads.id');
              })
              ->whereExists(function ($sub) {
                  $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                      ->from('lead_products')
                      ->whereColumn('lead_products.lead_id', 'leads.id');
              })
              ->whereNotExists(function ($sub) {
                  $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                      ->from('lead_products')
                      ->whereColumn('lead_products.lead_id', 'leads.id')
                      ->whereNotExists(function ($sp) {
                          $sp->select(\Illuminate\Support\Facades\DB::raw(1))
                             ->from('lead_product_shared_prices')
                             ->whereColumn('lead_product_shared_prices.lead_product_id', 'lead_products.id');
                      });
              });
        }

        if ($request->boolean('exclude_with_pi')) {
            $q->whereNotExists(function ($sub) {
                $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                    ->from('proforma_invoices')
                    ->whereColumn('proforma_invoices.opp_id', 'leads.id')
                    ->where('proforma_invoices.status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED);
            });
        }

        $docScope = $request->query('doc_scope');
        if (in_array($docScope, ['Domestic', 'International'], true)) {
            $knownCountry = function ($sub) {
                $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                    ->from('customers')
                    ->join('customer_addresses', function ($j) {
                        $j->on('customer_addresses.customer_id', '=', 'customers.id')
                          ->where('customer_addresses.is_primary', true);
                    })
                    ->whereColumn('customers.id', 'leads.customer_id')
                    ->whereRaw("TRIM(COALESCE(customer_addresses.country, '')) <> ''");
            };
            $q->where(function ($outer) use ($docScope, $knownCountry) {
                $outer
                    ->whereExists(function ($sub) use ($docScope, $knownCountry) {
                        $knownCountry($sub);
                        $sub->whereRaw(
                            $docScope === 'Domestic'
                                ? "LOWER(TRIM(customer_addresses.country)) = 'india'"
                                : "LOWER(TRIM(customer_addresses.country)) <> 'india'"
                        );
                    })
                    ->orWhereNotExists($knownCountry);
            });
        }

        $perPage = min(max((int) $request->query('per_page', 50), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);

        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        foreach ($paginator->items() as $lead) {
            $lead->setAttribute('read_only', \App\Support\SalesVisibility::isReadOnlyLead(
                $user,
                $lead->salesperson_id ? (int) $lead->salesperson_id : null,
            ));
        }

        $addrCountries = collect($paginator->items())
            ->map(fn ($l) => $l->customer?->primaryAddress?->country)
            ->filter(fn ($c) => is_string($c) && trim($c) !== '')
            ->map(fn ($c) => mb_strtolower(trim($c)))
            ->unique()->values();

        $isoByCountry = $addrCountries->isEmpty()
            ? collect()
            : collect(DB::table('master_countries')
                    ->whereIn(DB::raw('LOWER(name)'), $addrCountries->all())
                    ->get(['name', 'iso_code']))
                ->mapWithKeys(fn ($r) => [mb_strtolower(trim($r->name)) => $r->iso_code]);

        foreach ($paginator->items() as $lead) {
            $c   = $lead->customer?->primaryAddress?->country;
            $key = is_string($c) && trim($c) !== '' ? mb_strtolower(trim($c)) : null;
            $lead->setAttribute(
                'effective_country_iso',
                ($key ? $isoByCountry->get($key) : null) ?: $lead->sender_country_iso,
            );
        }

        $counts = null;
        if ((int) $request->query('with_counts', 1) === 1) {
            $countsQ = Lead::query();
            $this->applyScope($countsQ, $user, $request->integer('branch_id') ?: null, true);
            $this->applyListFilters($countsQ, $request);

            $row = $countsQ->selectRaw(
                "COUNT(*) AS c_all,
                 SUM(CASE WHEN qualified = true AND disqualified = false THEN 1 ELSE 0 END) AS c_qual,
                 SUM(CASE WHEN disqualified = true THEN 1 ELSE 0 END) AS c_disq,
                 SUM(CASE WHEN key_opportunity = true THEN 1 ELSE 0 END) AS c_key,
                 SUM(CASE WHEN key_opportunity = true AND won_at IS NULL THEN 1 ELSE 0 END) AS c_key_inprogress,
                 SUM(CASE WHEN key_opportunity = true AND won_at IS NOT NULL THEN 1 ELSE 0 END) AS c_key_won"
            )->first();

            $counts = [
                'all'             => (int) ($row->c_all  ?? 0),
                'qualified'       => (int) ($row->c_qual ?? 0),
                'disqualified'    => (int) ($row->c_disq ?? 0),
                'key_opportunity' => (int) ($row->c_key  ?? 0),
                'key_in_progress' => (int) ($row->c_key_inprogress ?? 0),
                'key_won'         => (int) ($row->c_key_won ?? 0),
            ];
        }

        $response = [
            'status' => true,
            'data'   => $paginator->items(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
            'can_distribute' => \App\Support\SalesVisibility::canDistribute($user),
        ];
        if ($counts !== null) $response['counts'] = $counts;

        return response()->json($response);
    }

    private function applyListFilters($q, Request $request): void
    {
        $applyFacet = function (string $column, string $param) use ($q, $request) {
            $v = $request->query($param);
            if (is_array($v)) {
                $vals = array_values(array_filter($v, fn ($x) => $x !== null && $x !== ''));
                if (count($vals)) $q->whereIn($column, $vals);
            } elseif ($v !== null && $v !== '') {
                $q->where($column, $v);
            }
        };
        $applyFacet('platform',           'platform');
        $applyFacet('query_type',         'query_type');
        $applyFacet('salesperson_id',     'salesperson_id');

        if ($request->filled('assigned')) {
            $assigned = filter_var($request->query('assigned'), FILTER_VALIDATE_BOOLEAN);
            if ($assigned) $q->whereNotNull('salesperson_id');
            else           $q->whereNull('salesperson_id');
        }
        $stageParam = $request->query('lead_stage_id');
        $stageVals  = is_array($stageParam)
            ? array_values(array_filter($stageParam, fn ($x) => $x !== null && $x !== ''))
            : (($stageParam !== null && $stageParam !== '') ? [(string) $stageParam] : []);
        if (count($stageVals)) {
            $stageVals    = array_map('strval', $stageVals);
            $plain        = array_values(array_diff($stageVals, ['6', '8']));
            $wantPiSent   = in_array('6', $stageVals, true);
            $wantShipment = in_array('8', $stageVals, true);
            $q->where(function ($outer) use ($plain, $wantPiSent, $wantShipment) {
                if (count($plain)) {
                    $outer->orWhereIn('lead_stage_id', $plain);
                }
                if ($wantPiSent) {
                    $outer->orWhere(function ($w) {
                        $w->where(function ($p) {
                            $p->whereExists(function ($s) {
                                $s->selectRaw('1')->from('clm_signature_requests')
                                  ->whereColumn('clm_signature_requests.lead_id', 'leads.id')
                                  ->where('clm_signature_requests.document_type', \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE);
                            })->orWhereExists(function ($s) {
                                $s->selectRaw('1')->from('proforma_invoices')
                                  ->whereColumn('proforma_invoices.opp_id', 'leads.id')
                                  ->where('proforma_invoices.status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
                                  ->whereNotNull('proforma_invoices.emailed_at');
                            });
                        })
                        ->whereNotExists(function ($s) {
                            $s->selectRaw('1')->from('shipment_orders')
                              ->whereColumn('shipment_orders.lead_id', 'leads.id');
                        });
                    });
                }
                if ($wantShipment) {
                    $outer->orWhereExists(function ($s) {
                        $s->selectRaw('1')->from('shipment_orders')
                          ->whereColumn('shipment_orders.lead_id', 'leads.id');
                    });
                }
            });
        }
        $applyFacet('sender_country_iso', 'sender_country_iso');
        $applyFacet('customer_id',        'customer_id');

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $q->whereBetween('query_time', [
                $request->query('start_date') . ' 00:00:00',
                $request->query('end_date')   . ' 23:59:59',
            ]);
        }

        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%' . mb_strtolower($search) . '%';
            $cols = [
                'opp_code', 'unique_query_id', 'query_type', 'platform',
                'source_account', 'sender_name', 'sender_mobile',
                'sender_mobile_alt', 'sender_email', 'sender_email_alt',
                'sender_company', 'sender_address', 'sender_city',
                'sender_state', 'sender_pincode', 'sender_country_iso',
                'sender_country_name', 'query_product_name', 'query_mcat_name',
                'query_message', 'remark', 'whatsapp_status',
            ];
            $q->where(function ($w) use ($cols, $like, $search) {
                foreach ($cols as $col) {
                    $w->orWhereRaw('LOWER(' . $col . ') LIKE ?', [$like]);
                }
                $w->orWhereHas('salesperson', function ($s) use ($like) {
                    $s->whereRaw('LOWER(name) LIKE ?', [$like])
                      ->orWhereRaw('LOWER(email) LIKE ?', [$like]);
                })
                ->orWhereHas('customer', function ($c) use ($like) {
                    $c->whereRaw('LOWER(company_name) LIKE ?', [$like])
                      ->orWhereRaw('LOWER(legal_name) LIKE ?', [$like])
                      ->orWhereRaw('LOWER(customer_code) LIKE ?', [$like])
                      ->orWhereRaw('LOWER(primary_email) LIKE ?', [$like]);
                })
                ->orWhereHas('customer.primaryAddress', fn ($a) => $a->whereRaw('LOWER(country) LIKE ?', [$like]))
                ->orWhereExists(fn ($e) => $e->selectRaw('1')->from('proforma_invoices')
                    ->whereColumn('proforma_invoices.opp_id', 'leads.id')
                    ->where('proforma_invoices.status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
                    ->whereRaw('LOWER(proforma_invoices.code) LIKE ?', [$like]))
                ->orWhereExists(fn ($e) => $e->selectRaw('1')->from('shipment_orders')
                    ->whereColumn('shipment_orders.lead_id', 'leads.id')
                    ->whereRaw('LOWER(shipment_orders.shipment_code) LIKE ?', [$like]));

                $dateExpr = 'COALESCE(leads.query_time, leads.created_at)';
                $driver = $w->getConnection()->getDriverName();
                [$display, $iso] = match ($driver) {
                    'pgsql'  => ["LOWER(TO_CHAR($dateExpr, 'DD-Mon-YYYY'))", "TO_CHAR($dateExpr, 'YYYY-MM-DD')"],
                    'mysql', 'mariadb' => ["LOWER(DATE_FORMAT($dateExpr, '%d-%b-%Y'))", "DATE_FORMAT($dateExpr, '%Y-%m-%d')"],
                    default  => [null, "strftime('%Y-%m-%d', $dateExpr)"],
                };
                if ($display) $w->orWhereRaw("$display LIKE ?", [$like]);
                $isoNeedle = preg_match('#^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$#', $search, $m)
                    ? sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1])
                    : (preg_match('#^\d{4}-\d{2}(-\d{2})?$#', $search) ? $search : null);
                if ($isoNeedle) $w->orWhereRaw("$iso LIKE ?", [$isoNeedle . '%']);

                if (ctype_digit($search)) {
                    $w->orWhere('product_quantity', (int) $search);
                }
            });
        }
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $data = $request->validate([
            'sender_name'         => 'required|string|max:255',
            'sender_mobile'       => 'nullable|string|max:32',
            'sender_email'        => 'nullable|email|max:255',
            'sender_company'      => 'nullable|string|max:255',
            'sender_address'      => 'nullable|string|max:1000',
            'sender_city'         => 'nullable|string|max:128',
            'sender_state'        => 'nullable|string|max:128',
            'sender_country_iso'  => 'nullable|string|max:8',
            'sender_country_name' => 'nullable|string|max:128',
            'sender_pincode'      => [
                'nullable', 'string', 'max:32',
                PostalCode::rule(fn () => $request->input('sender_country_name')),
            ],
            'customer_id'         => 'nullable|integer|exists:customers,id',
            'consignee_id'        => 'nullable|integer|exists:consignees,id',
            'query_message'       => 'nullable|string|max:10000',
            'product_quantity'    => 'nullable|string|max:64',
            'query_product_name'  => 'nullable|string|max:255',
        ]);
        if (!empty($data['sender_email'])) $data['sender_email'] = mb_strtolower(trim($data['sender_email']));

        if (empty($data['sender_country_iso']) && !empty($data['sender_country_name'])) {
            $iso = \App\Models\Masters\Countries::query()
                ->whereRaw('LOWER(name) = ?', [strtolower(trim($data['sender_country_name']))])
                ->value('iso_code');
            if ($iso) {
                $data['sender_country_iso'] = strtoupper($iso);
            }
        }

        $lead = DB::transaction(function () use ($data, $user) {
            \App\Models\Customer::markMappedToLead(
                isset($data['customer_id']) ? (int) $data['customer_id'] : null,
            );

            return Lead::create(array_merge($data, [
                'client_id'       => $user->client_id,
                'branch_id'       => $user->branch_id,
                'salesperson_id'  => (($user->user_type ?? null) === 'super_admin') ? null : $user->id,
                'opp_code'        => $this->nextOppCode($user->client_id, $user->branch_id),
                'unique_query_id' => (string) mt_rand(100000000, 999999999),
                'platform'        => 'Offline',
                'query_type'      => 'Manual',
                'query_time'      => now(),
                'lead_stage_id'   => 1,
                'qualified'       => true,
                'disqualified'    => false,
                'key_opportunity' => false,
                'has_whatsapp'    => false,
                'whatsapp_status' => 'pending',
                'created_by'      => $user->id,
            ]));
        });

        $lead->load(['salesperson:id,name', 'customer:id,company_name,customer_code']);

        \App\Support\LeadActivity::log(
            $user,
            $lead,
            \App\Support\LeadActivity::ACTION_GENERATED,
            'Lead generated (' . ($lead->query_type ?: 'Manual') . ' · ' . ($lead->platform ?: 'Offline') . ')',
            null,
            [
                'opp_code'         => $lead->opp_code,
                'salesperson_id'   => $lead->salesperson_id ? (int) $lead->salesperson_id : null,
                'salesperson_name' => $lead->salesperson?->name,
            ],
        );

        return response()->json(['status' => true, 'data' => $lead], 201);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::with([
            'salesperson' => fn ($r) => $r->withTrashed(),
            'customer'  => fn ($r) => $r->withTrashed()->with([
                'primaryAddress' => fn ($a) => $a->select('id', 'customer_id', 'cp_contact', 'country'),
            ]),
            'consignee' => fn ($r) => $r->withTrashed(),
            'ackReason',
            'taskManager',
            'acknowledgements',
        ]);
        $this->applyScope($q, $user, null, true);
        $lead = $q->findOrFail($id);

        $lead->setAttribute('read_only', \App\Support\SalesVisibility::isReadOnlyLead(
            $user,
            $lead->salesperson_id ? (int) $lead->salesperson_id : null,
        ));

        $lead->setAttribute('whatsapp_screenshot_url', file_url($lead->whatsapp_screenshot));

        $lead->setAttribute('downstream_work', $this->downstreamWork($lead));

        if ($lead->taskManager) {
            $lead->taskManager->setAttribute('attachment_url', file_url($lead->taskManager->attachment));
        }

        $piSignedAt = \App\Models\ClmSignatureRequest::query()
            ->where('lead_id', $lead->id)
            ->where('document_type', \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE)
            ->where('status', 'completed')
            ->orderByDesc('completed_at')
            ->value('completed_at');
        $lead->setAttribute('pi_signed_at', $piSignedAt ? \Illuminate\Support\Carbon::parse($piSignedAt)->toIso8601String() : null);

        $piSentRow = \App\Models\ClmSignatureRequest::query()
            ->where('lead_id', $lead->id)
            ->where('document_type', \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE)
            ->whereIn('status', ['inprogress', 'completed'])
            ->orderBy('created_at')
            ->first();
        $piSentAt = $piSentRow
            ? ($piSentRow->created_at ?? $piSentRow->updated_at ?? $lead->updated_at)
            : null;
        $lead->setAttribute('pi_sent_for_signature_at', $piSentAt ? \Illuminate\Support\Carbon::parse($piSentAt)->toIso8601String() : null);

        $oppDate = $lead->query_time ?? $lead->created_at;
        $lead->setAttribute('opportunity_date_iso', $oppDate ? \Illuminate\Support\Carbon::parse($oppDate)->toIso8601String() : null);

        $piSentAt = \App\Models\ClmSignatureRequest::query()
            ->where('lead_id', $lead->id)
            ->where('document_type', \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE)
            ->orderByDesc('created_at')
            ->value('created_at');
        if (!$piSentAt) {
            $pi = \App\Models\ProformaInvoice::where('client_id', $lead->client_id)
                ->where('opp_id', $lead->id)
                ->where('status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
                ->orderByDesc('id')
                ->first(['id', 'emailed_at', 'created_at']);
            $piSentAt = $pi?->emailed_at ?? $pi?->created_at;
        }
        $lead->setAttribute('pi_sent_at', $piSentAt ? \Illuminate\Support\Carbon::parse($piSentAt)->toIso8601String() : null);

        $lead->setAttribute('locked_currency', LeadProduct::where('lead_id', $lead->id)
            ->whereNotNull('currency')
            ->value('currency'));

        return response()->json(['status' => true, 'data' => $lead]);
    }

    private function currencyCustomerMismatchResponse(int $clientId, ?string $currency, ?int $customerId): ?\Illuminate\Http\JsonResponse
    {
        if (!$currency || !$customerId) return null;
        $customer = Customer::where('client_id', $clientId)
            ->with('primaryAddress:id,customer_id,country')
            ->find($customerId);
        if (!$customer) return null;
        $country = mb_strtolower(trim((string) optional($customer->primaryAddress)->country));
        $isIndia = in_array($country, ['india', 'in', 'ind'], true);
        $isInr   = strtoupper(trim($currency)) === 'INR';
        if ($isInr && !$isIndia) {
            return response()->json([
                'status'  => false,
                'message' => "This opportunity's products are priced in INR (a domestic sale), so only a domestic (Indian) customer can be mapped. Map an Indian customer, or remove the INR products first.",
            ], 422);
        }
        if (!$isInr && $isIndia) {
            return response()->json([
                'status'  => false,
                'message' => "This opportunity's products are priced in {$currency} (an export sale), so only an international (non-Indian) customer can be mapped. Map a foreign customer, or change the products' currency first.",
            ], 422);
        }
        return null;
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $id, 'edit it');

        $data = $request->validate([
            'sender_name'        => 'sometimes|required|string|max:255',
            'sender_mobile'      => 'nullable|string|max:32',
            'sender_email'       => 'nullable|email|max:255',
            'sender_company'     => 'nullable|string|max:255',
            'sender_address'     => 'nullable|string|max:1000',
            'sender_city'        => 'nullable|string|max:128',
            'sender_state'       => 'nullable|string|max:128',
            'sender_pincode'     => [
                'nullable', 'string', 'max:32',
                PostalCode::rule(fn () => $request->input('sender_country_name')),
            ],
            'sender_country_iso' => 'nullable|string|max:8',
            'qualified'          => 'nullable|boolean',
            'disqualified'       => 'nullable|boolean',
            'lead_stage_id'      => 'nullable|integer|between:1,6',
            'salesperson_id'     => ['nullable', 'integer', \Illuminate\Validation\Rule::exists('users', 'id')->whereNull('deleted_at')],
            'key_opportunity'    => 'nullable|boolean',
            'remark'             => 'nullable|string|max:5000',
            'price'              => 'nullable|string|max:64',
            'lead_ack_reason_id' => ['nullable', 'integer', \Illuminate\Validation\Rule::exists('lead_ack_reasons', 'id')->where(fn ($w) => $w->where('status', 'active'))],
            'customer_id'        => 'nullable|integer|exists:customers,id',
            'consignee_id'       => 'nullable|integer|exists:consignees,id',
            'has_whatsapp'       => 'nullable|boolean',
            'whatsapp_status'    => 'nullable|string|in:connected,pending,not_connected,opted_out',
            'whatsapp_reason'    => 'nullable|string|max:1000',
        ]);
        if (!empty($data['sender_email'])) $data['sender_email'] = mb_strtolower(trim($data['sender_email']));

        if (!empty($data['qualified']) && !empty($data['disqualified'])) {
            return response()->json([
                'status'  => false,
                'message' => 'A lead cannot be both Qualified and Disqualified at the same time.',
            ], 422);
        }

        $losesQualification = (array_key_exists('disqualified', $data) && !empty($data['disqualified']) && !$lead->disqualified)
            || (array_key_exists('qualified', $data) && empty($data['qualified']) && $lead->qualified);
        if ($losesQualification) {
            $blocked = $this->blockUnqualifyWithWork(
                $lead,
                !empty($data['disqualified']) ? 'Disqualified' : 'not Qualified',
            );
            if ($blocked) return $blocked;
        }

        if (isset($data['lead_stage_id'])
            && (int) $data['lead_stage_id'] === 6
            && (int) ($lead->lead_stage_id ?? 0) < 6
        ) {
            $pi = \App\Models\ProformaInvoice::where('client_id', $user->client_id)
                ->where('opp_id', $lead->id)
                ->where('status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
                ->orderByDesc('id')
                ->first();
            if (!$pi) {
                return response()->json([
                    'status'  => false,
                    'message' => 'Create a Proforma Invoice on this opportunity before moving to Victory (Stage 6).',
                ], 422);
            }
            if (!\App\Models\ClmSignatureRequest::hasSentForDoc(
                $user->client_id,
                \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE,
                $pi->id,
            )) {
                return response()->json([
                    'status'  => false,
                    'message' => "Send the Proforma Invoice {$pi->code} for signature before moving to Victory (Stage 6).",
                ], 422);
            }
        }

        if (isset($data['lead_stage_id']) && (int) $data['lead_stage_id'] === 6 && $lead->won_at === null) {
            $data['won_at'] = now();
        }
        if (isset($data['lead_stage_id']) && (int) $data['lead_stage_id'] < 6 && $lead->won_at !== null) {
            $data['won_at'] = null;
        }

        if (array_key_exists('consignee_id', $data) && $data['consignee_id']) {
            $leadProductIds = LeadProduct::where('lead_id', $lead->id)
                ->pluck('product_id')
                ->all();
            if ($block = $this->segmentPartyBlockResponse(
                (int) $user->client_id,
                $leadProductIds,
                (int) $data['consignee_id'],
            )) {
                return $block;
            }
        }

        if (array_key_exists('customer_id', $data) && $data['customer_id']) {
            $leadProductIds = LeadProduct::where('lead_id', $lead->id)
                ->pluck('product_id')
                ->all();
            if ($block = $this->segmentCustomerProductMismatchResponse(
                (int) $user->client_id,
                $leadProductIds,
                (int) $data['customer_id'],
            )) {
                return $block;
            }
            $leadCurrency = LeadProduct::where('lead_id', $lead->id)
                ->whereNotNull('currency')
                ->value('currency');
            if ($block = $this->currencyCustomerMismatchResponse(
                (int) $user->client_id,
                $leadCurrency,
                (int) $data['customer_id'],
            )) {
                return $block;
            }
        }

        $prevSalesId = $lead->salesperson_id ? (int) $lead->salesperson_id : null;

        if (array_key_exists('salesperson_id', $data)) {
            $incomingSalesId = $data['salesperson_id'] ? (int) $data['salesperson_id'] : null;
            if ($incomingSalesId !== $prevSalesId) {
                $piOut = \App\Models\ClmSignatureRequest::query()
                    ->where('lead_id', $lead->id)
                    ->where('document_type', \App\Models\ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                    ->whereIn('status', ['inprogress', 'completed'])
                    ->exists();
                if ($piOut) {
                    return response()->json([
                        'message' => 'The Proforma Invoice has been sent for signature, so this opportunity cannot be reassigned. Recall the PI first if the owner has to change.',
                        'errors'  => ['salesperson_id' => ['Owner is fixed once the PI is sent for signature.']],
                    ], 422);
                }
            }
        }

        $lead->update($data);

        if (!empty($data['customer_id'])) {
            \App\Models\Customer::markMappedToLead((int) $data['customer_id']);
        }

        if (array_key_exists('salesperson_id', $data)) {
            $newSalesId = $data['salesperson_id'] ? (int) $data['salesperson_id'] : null;
            if ($newSalesId !== $prevSalesId && $newSalesId !== null) {
                $names = \App\Models\User::query()
                    ->whereIn('id', array_filter([$prevSalesId, $newSalesId]))
                    ->pluck('name', 'id');
                $newName  = $names[$newSalesId] ?? ('User #' . $newSalesId);
                $prevName = $prevSalesId ? ($names[$prevSalesId] ?? ('User #' . $prevSalesId)) : null;

                \App\Support\LeadActivity::log(
                    $user,
                    $lead,
                    $prevSalesId ? \App\Support\LeadActivity::ACTION_REASSIGNED : \App\Support\LeadActivity::ACTION_ASSIGNED,
                    $prevSalesId ? "Reassigned from {$prevName} to {$newName}" : "Assigned to {$newName}",
                    $prevSalesId ? ['salesperson_id' => $prevSalesId, 'salesperson_name' => $prevName] : null,
                    ['salesperson_id' => $newSalesId, 'salesperson_name' => $newName],
                );
            }
        }

        return response()->json(['status' => true, 'data' => $lead->fresh(['salesperson:id,name'])]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $id, 'delete it');
        $lead->delete();

        return response()->json(['status' => true, 'message' => 'Lead deleted']);
    }

    public function syncFromCrm(Request $request, IndiaMartLeadSyncService $service)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $gateError = $this->checkSyncTenantGate($user);
        if ($gateError) {
            return response()->json(['status' => false, 'message' => $gateError], 403);
        }

        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }
        $client = $user->client;
        if (!$client) {
            return response()->json(['status' => false, 'message' => 'Client not loaded'], 422);
        }

        $result = $service->syncForClient($client, $user);

        return response()->json(array_merge(['status' => true], $result));
    }

    public function syncConfig(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $keys    = (array) config('lead_sync.indiamart.keys', []);
        $enabled = $this->checkSyncTenantGate($user) === null && !empty($keys);

        return response()->json([
            'enabled' => $enabled,
            'labels'  => array_column($keys, 'label'),
        ]);
    }

    public function assign(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'lead_ids'        => 'required|array|min:1',
            'lead_ids.*'      => 'integer',
            'salesperson_id'  => 'required|integer|exists:users,id',
        ]);

        $assignable = \App\Support\SalesVisibility::assignableUserIds($user);
        if ($assignable !== null && !in_array((int) $data['salesperson_id'], $assignable, true)) {
            return response()->json([
                'status'  => false,
                'message' => 'You can only assign leads to your reporting manager or your own team members.',
            ], 403);
        }

        if (!empty(\App\Support\SalesVisibility::salesDepartmentIds())) {
            $salesUserIds = \App\Support\SalesVisibility::salesDepartmentUserIds($user, $user->branch_id ?: null);
            if (!in_array((int) $data['salesperson_id'], $salesUserIds, true)) {
                return response()->json([
                    'status'  => false,
                    'message' => 'You can only assign leads to Sales-department members in this branch.',
                ], 403);
            }
        }

        $q = Lead::query()->whereIn('id', $data['lead_ids']);
        $this->applyScope($q, $user, null, true);
        $leads = $q->get(['id', 'client_id', 'branch_id', 'salesperson_id']);

        $shipped = \App\Models\ShipmentOrder::query()
            ->whereIn('lead_id', $leads->pluck('id'))
            ->pluck('lead_id')
            ->map(fn ($v) => (int) $v)
            ->unique();
        if ($shipped->isNotEmpty()) {
            $codes = Lead::query()->whereIn('id', $shipped)->pluck('opp_code', 'id')
                ->map(fn ($c, $id) => $c ?: ('OPP-' . $id))->values()->all();
            return response()->json([
                'status'  => false,
                'message' => count($codes) === 1
                    ? "{$codes[0]} already has a shipment - the owner can no longer be changed."
                    : 'These already have a shipment and can no longer be reassigned: ' . implode(', ', $codes),
            ], 422);
        }

        $targetId   = (int) $data['salesperson_id'];
        $targetName = \App\Models\User::query()->whereKey($targetId)->value('name') ?: ('User #' . $targetId);

        $prevIds   = $leads->pluck('salesperson_id')->filter()->map(fn ($v) => (int) $v)->unique()->all();
        $prevNames = !empty($prevIds)
            ? \App\Models\User::query()->whereIn('id', $prevIds)->pluck('name', 'id')->all()
            : [];

        $newCount       = 0;
        $reassignCount  = 0;
        $skippedCount   = count($data['lead_ids']) - $leads->count();
        $touchedIds     = [];
        $activity       = [];

        foreach ($leads as $lead) {
            $prevId = $lead->salesperson_id ? (int) $lead->salesperson_id : null;

            if ($prevId === $targetId) {
                continue;
            }

            if ($prevId) {
                $reassignCount++;
                $activity[] = [$lead, \App\Support\LeadActivity::ACTION_REASSIGNED, $prevId];
            } else {
                $newCount++;
                $activity[] = [$lead, \App\Support\LeadActivity::ACTION_ASSIGNED, null];
            }
            $touchedIds[] = $lead->id;
        }

        if (!empty($touchedIds)) {
            Lead::whereIn('id', $touchedIds)->update([
                'salesperson_id' => $targetId,
            ]);

            foreach ($activity as [$lead, $action, $prevId]) {
                $prevName = $prevId ? ($prevNames[$prevId] ?? ('User #' . $prevId)) : null;
                $desc = $prevId
                    ? "Reassigned from {$prevName} to {$targetName}"
                    : "Assigned to {$targetName}";

                \App\Support\LeadActivity::log(
                    $user,
                    $lead,
                    $action,
                    $desc,
                    $prevId ? ['salesperson_id' => $prevId, 'salesperson_name' => $prevName] : null,
                    ['salesperson_id' => $targetId, 'salesperson_name' => $targetName],
                );
            }
        }

        return response()->json([
            'status'           => true,
            'message'          => 'Leads assigned',
            'new_assigned'     => $newCount,
            'reassigned'       => $reassignCount,
            'skipped_no_scope' => $skippedCount,
        ]);
    }

    public function activity(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::query()->whereKey($id);
        $this->applyScope($q, $user, null, true);
        $lead = $q->first(['id', 'opp_code']);

        if (!$lead) {
            return response()->json([
                'status'  => false,
                'message' => 'Opportunity not found, or it is outside your access.',
            ], 404);
        }

        return response()->json([
            'status'   => true,
            'opp_code' => $lead->opp_code,
            'data'     => \App\Support\LeadActivity::feed((int) $lead->id),
        ]);
    }

    public function convertToQualified(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'lead_ids'   => 'required|array|min:1',
            'lead_ids.*' => 'integer',
        ]);

        $q = Lead::query()->whereIn('id', $data['lead_ids']);
        $this->applyScope($q, $user);

        $touched = $q->update([
            'qualified'    => true,
            'disqualified' => false,
            'lead_ack_reason_id' => null,
        ]);

        return response()->json([
            'status'    => true,
            'message'   => "$touched lead(s) converted to Qualified",
            'converted' => $touched,
        ]);
    }

    public function storeTaskManager(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $lead = $this->findLeadForWrite($user, $leadId, 'add tasks to it');

        $data = $request->validate([
            'name'        => ['required', 'string', 'max:150', "regex:/^[A-Za-z][A-Za-z .'\-]*$/"],
            'mobile_no'   => ['required', 'string', 'regex:/^\d{6,15}$/'],
            'email'       => [
                'required',
                'email:rfc',
                'max:191',
                'regex:/^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/',
                'not_regex:/\.\./',
            ],
            'order_value' => 'nullable|numeric|min:0',
            'buying_plan' => 'nullable|date_format:Y-m-d',
            'attachment'  => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:5120',
        ], [
            'mobile_no.regex' => 'Mobile number must be 6–15 digits',
            'name.regex'      => 'Name can contain only letters, spaces, dots, hyphens and apostrophes',
            'email.regex'     => 'Please enter a valid email address',
            'email.not_regex' => 'Please enter a valid email address',
        ]);

        $existing = LeadTaskManager::where('client_id', $user->client_id)
            ->where('lead_id', $lead->id)
            ->first();

        $attachmentPath = $existing?->attachment;
        $attachmentName = $existing?->attachment_original;
        if ($request->hasFile('attachment')) {
            if ($existing?->attachment && Storage::disk('public')->exists($existing->attachment)) {
                Storage::disk('public')->delete($existing->attachment);
            }
            $file           = $request->file('attachment');
            $attachmentName = $file->getClientOriginalName();
            $attachmentPath = $file->store(
                "leads/task-manager/{$user->client_id}",
                'public',
            );
        }

        $payload = [
            'client_id'           => $user->client_id,
            'lead_id'             => $lead->id,
            'name'                => $data['name'],
            'mobile_no'           => $data['mobile_no'],
            'email'               => $data['email'],
            'order_value'         => $data['order_value'] ?? null,
            'buying_plan'         => $data['buying_plan'] ?? null,
            'attachment'          => $attachmentPath,
            'attachment_original' => $attachmentName,
            'updated_by'          => $user->id,
        ];

        $row = $existing
            ? tap($existing)->update($payload)
            : LeadTaskManager::create($payload);

        $fresh = $row->fresh();
        $fresh->setAttribute('attachment_url', file_url($fresh->attachment));

        return response()->json([
            'status'  => true,
            'message' => $existing ? 'Task manager updated' : 'Task manager saved',
            'data'    => $fresh,
        ], $existing ? 200 : 201);
    }

    public function updateWhatsApp(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $lead = $this->findLeadForWrite($user, $leadId, 'change its WhatsApp details');

        $data = $request->validate([
            'whatsapp_status' => 'required|string|in:connected,pending,not_connected,opted_out',
            'whatsapp_reason' => 'nullable|string|min:5|max:250',
            'screenshot'      => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:5120',
        ]);

        $screenshotPath = $lead->whatsapp_screenshot;
        if ($request->hasFile('screenshot')) {
            if ($lead->whatsapp_screenshot && Storage::disk('public')->exists($lead->whatsapp_screenshot)) {
                Storage::disk('public')->delete($lead->whatsapp_screenshot);
            }
            $screenshotPath = $request->file('screenshot')->store(
                "leads/whatsapp/{$user->client_id}",
                'public',
            );
        }

        $lead->update([
            'whatsapp_status'     => $data['whatsapp_status'],
            'whatsapp_reason'     => $data['whatsapp_reason'] ?? null,
            'whatsapp_screenshot' => $screenshotPath,
            'has_whatsapp'        => $data['whatsapp_status'] === 'connected',
        ]);

        $fresh = $lead->fresh();
        return response()->json([
            'status' => true,
            'data'   => $fresh->only([
                'id', 'has_whatsapp', 'whatsapp_status', 'whatsapp_reason', 'whatsapp_screenshot',
            ]) + ['whatsapp_screenshot_url' => file_url($fresh->whatsapp_screenshot)],
        ]);
    }

    public function listLeadProducts(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user, null, true);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadProduct::with([
                'product:id,product_code,name,status,segment_id',
                'product.segment:id,name,regulatory_status',
            ])
            ->where('lead_id', $lead->id)
            ->orderByDesc('id')
            ->get();

        $procByLeadProduct = ProcurementProduct::query()
            ->whereIn('lead_product_id', $rows->pluck('id'))
            ->orderByDesc('id')
            ->get()
            ->groupBy('lead_product_id')
            ->map(fn ($g) => $g->first()->procurement_id);

        $vendorCountByProduct = \App\Models\ProductVendorMap::query()
            ->whereIn('product_id', $rows->pluck('product_id')->filter()->unique()->values())
            ->selectRaw('product_id, COUNT(*) as c')
            ->groupBy('product_id')
            ->pluck('c', 'product_id');

        $docsByProduct = $this->documentCodesByProduct(
            $lead->id,
            $rows->pluck('product_id')->filter()->unique()->values()->all(),
        );

        $sharedPriceIds = LeadProductSharedPrice::query()
            ->whereIn('lead_product_id', $rows->pluck('id'))
            ->distinct()
            ->pluck('lead_product_id')
            ->flip();

        $mapped = $rows->map(fn ($r) => [
            'id'               => $r->id,
            'product_id'       => $r->product_id,
            'used_in_documents' => array_values($docsByProduct[$r->product_id] ?? []),
            'product_code'     => $r->product?->product_code,
            'product_name'     => $r->product?->name,
            'product_status'   => $r->product?->status,
            'product_category' => $r->product?->segment?->name,
            'currency'         => $r->currency,
            'quantity'         => $r->quantity,
            'target_price'     => $r->target_price,
            'notes'            => $r->notes,
            'sourcing_status'  => $r->sourcing_status,
            'procurement_done' => (bool) $r->procurement_done,
            'procurement_id'   => $procByLeadProduct[$r->id] ?? null,
            'vendor_count'     => (int) ($vendorCountByProduct[$r->product_id] ?? 0),
            'has_shared_price' => $sharedPriceIds->has($r->id),
            'created_at'       => $r->created_at,
        ]);

        return response()->json(['status' => true, 'data' => $mapped]);
    }

    public function updateLeadProductSourcingStatus(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $leadId, 'change its sourcing status');

        $blocked = $this->blockSourcingUnlessQualified($lead);
        if ($blocked) return $blocked;

        $row = LeadProduct::with('product:id,status')
            ->where('lead_id', $lead->id)
            ->findOrFail($mappingId);

        $data = $request->validate([
            'sourcing_status' => 'required|in:required,not_required',
        ]);

        $productStatus = strtolower((string) ($row->product?->status ?? ''));
        if (in_array($productStatus, ['inactive', 'draft'], true)
            && $data['sourcing_status'] !== 'required'
        ) {
            return response()->json([
                'status'  => false,
                'message' => 'Inactive or draft products must be marked Sourcing Required',
            ], 422);
        }

        $row->update([
            'sourcing_status'  => $data['sourcing_status'],
            'procurement_done' => $data['sourcing_status'] === 'required'
                ? $row->procurement_done
                : false,
        ]);

        return response()->json(['status' => true, 'data' => [
            'id'               => $row->id,
            'sourcing_status'  => $row->sourcing_status,
            'procurement_done' => (bool) $row->procurement_done,
        ]]);
    }

    public function markLeadProductSourced(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $leadId, 'mark its products sourced');

        $blocked = $this->blockSourcingUnlessQualified($lead);
        if ($blocked) return $blocked;

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        if ($row->sourcing_status !== 'required') {
            return response()->json([
                'status'  => false,
                'message' => 'Only Sourcing Required products can be marked sourced',
            ], 422);
        }

        if ($row->procurement_done) {
            return response()->json([
                'status'  => false,
                'message' => 'This product is already marked sourced.',
                'data'    => [
                    'id'               => $row->id,
                    'sourcing_status'  => $row->sourcing_status,
                    'procurement_done' => true,
                ],
            ], 409);
        }

        $hasProcurement = ProcurementProduct::where('lead_product_id', $row->id)->exists();
        if (!$hasProcurement) {
            return response()->json([
                'status'  => false,
                'message' => 'Create a procurement for this product before marking it sourced',
            ], 422);
        }

        $row->update(['procurement_done' => true]);

        return response()->json(['status' => true, 'data' => [
            'id'               => $row->id,
            'sourcing_status'  => $row->sourcing_status,
            'procurement_done' => true,
        ]]);
    }

    public function storeSharedPrice(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $lead = $this->findLeadForWrite($user, $leadId, 'share prices on it');

        $blocked = $this->blockSourcingUnlessQualified($lead);
        if ($blocked) return $blocked;

        $row = LeadProduct::with('product:id,status')
            ->where('lead_id', $lead->id)
            ->findOrFail($mappingId);

        $productStatus = strtolower((string) ($row->product?->status ?? ''));
        if (in_array($productStatus, ['draft', 'inactive', 'pending'], true)) {
            return response()->json([
                'status'  => false,
                'message' => 'Cannot share a price for an incomplete product. Activate it on the Product Master first.',
            ], 422);
        }

        if (empty($row->sourcing_status)) {
            return response()->json([
                'status'  => false,
                'message' => 'Set a sourcing status (Sourcing Required / Not Required) for this product before sharing a price.',
            ], 422);
        }

        $data = $request->validate([
            'quoted_price' => 'required|numeric|gt:0',
        ]);

        $entry = LeadProductSharedPrice::create([
            'client_id'       => $user->client_id,
            'lead_id'         => $lead->id,
            'lead_product_id' => $row->id,
            'quoted_price'    => $data['quoted_price'],
            'shared_at'       => now(),
            'created_by'      => $user->id,
        ]);

        return response()->json([
            'status' => true,
            'data'   => $entry->load('creator:id,name'),
        ], 201);
    }

    public function listSharedPrices(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user, null, true);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadProductSharedPrice::with([
            'leadProduct:id,product_id,currency,quantity,target_price',
            'leadProduct.product:id,product_code,name,status,segment_id',
            'leadProduct.product.segment:id,name,regulatory_status',
        ])
            ->where('lead_id', $lead->id)
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('shared_at')
            ->get()
            ->map(fn ($e) => [
                'id'               => $e->id,
                'lead_product_id'  => $e->lead_product_id,
                'product_id'       => $e->leadProduct?->product_id,
                'product_code'     => $e->leadProduct?->product?->product_code,
                'product_name'     => $e->leadProduct?->product?->name,
                'product_status'   => $e->leadProduct?->product?->status,
                'product_category' => $e->leadProduct?->product?->segment?->name,
                'currency'         => $e->leadProduct?->currency,
                'quantity'         => $e->leadProduct?->quantity,
                'target_price'     => $e->leadProduct?->target_price,
                'quoted_price'     => $e->quoted_price,
                'shared_at'        => $e->shared_at,
            ]);

        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function listSharedPricesByProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user, null, true);
        $lead = $leadQ->findOrFail($leadId);

        $product = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        $rows = LeadProductSharedPrice::where('lead_id', $lead->id)
            ->where('lead_product_id', $product->id)
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('shared_at')
            ->get()
            ->map(fn ($e) => [
                'id'           => $e->id,
                'quoted_price' => $e->quoted_price,
                'shared_at'    => $e->shared_at,
            ]);

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'product' => [
                'lead_product_id' => $product->id,
                'currency'        => $product->currency,
                'quantity'        => $product->quantity,
                'target_price'    => $product->target_price,
            ],
        ]);
    }

    public function sharedPricePdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $entry = LeadProductSharedPrice::with([
            'lead:id,opp_code,unique_query_id,sender_name,sender_email,sender_mobile',
            'lead.customer:id,company_name,customer_code',
            'leadProduct:id,product_id,currency,quantity,target_price',
            'leadProduct.product:id,product_code,name',
            'creator:id,name',
        ])
            ->where('client_id', $user->client_id)
            ->findOrFail($id);

        $client = \App\Models\Client::find($entry->client_id);

        $quoteCode = 'Q-' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT);
        $barcodeHtml = '';
        try {
            $generator = new \Milon\Barcode\DNS1D();
            $barcodeHtml = $generator->getBarcodeHTML($quoteCode, 'C128', 1.4, 30);
        } catch (\Throwable $e) {
            $barcodeHtml = '';
        }

        $pdf = Pdf::loadView('pdf.shared_price_quotation', [
            'entry'       => $entry,
            'client'      => $client,
            'quoteCode'   => $quoteCode,
            'barcodeHtml' => $barcodeHtml,
            'inline'      => $request->boolean('inline'),
        ])->setPaper('a4');

        $filename = 'quotation_' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT) . '.pdf';

        return $request->boolean('inline')
            ? $pdf->stream($filename)
            : $pdf->download($filename);
    }

    public function storeLeadProduct(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $lead = $this->findLeadForWrite($user, $leadId, 'add products to it');

        $blocked = $this->blockSourcingUnlessQualified($lead);
        if ($blocked) return $blocked;

        $data = $request->validate([
            'product_id'   => 'required|integer|exists:products,id',
            'currency'     => 'nullable|string',
            'quantity'     => 'nullable|numeric|min:0',
            'target_price' => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string|max:1000',
        ]);

        $dupe = LeadProduct::where('lead_id', $lead->id)
            ->where('product_id', $data['product_id'])
            ->exists();
        if ($dupe) {
            return response()->json([
                'status'  => false,
                'message' => 'This product is already mapped to the lead — edit the existing row instead',
            ], 422);
        }

        if ($block = $this->segmentPartyBlockResponse(
            (int) $user->client_id,
            [$data['product_id']],
            $lead->consignee_id,
        )) {
            return $block;
        }

        if ($block = $this->segmentCustomerProductMismatchResponse(
            (int) $user->client_id,
            [$data['product_id']],
            $lead->customer_id,
        )) {
            return $block;
        }

        $lockedCurrency = LeadProduct::where('lead_id', $lead->id)
            ->whereNotNull('currency')
            ->value('currency');
        $picked = $data['currency'] ?? null;
        if ($lockedCurrency && $picked && strtoupper($picked) !== strtoupper($lockedCurrency)) {
            return response()->json([
                'status'  => false,
                'message' => "This opportunity is already using {$lockedCurrency}. All products on a lead must share one currency — remove the existing rows first if you want to switch.",
                'locked_currency' => $lockedCurrency,
            ], 422);
        }
        $effectiveCurrency = $picked ?? $lockedCurrency ?? 'USD';

        if ($lead->customer_id && $block = $this->currencyCustomerMismatchResponse(
            (int) $user->client_id,
            $effectiveCurrency,
            (int) $lead->customer_id,
        )) {
            return $block;
        }

        $row = LeadProduct::create([
            'client_id'    => $user->client_id,
            'lead_id'      => $lead->id,
            'product_id'   => $data['product_id'],
            'currency'     => $effectiveCurrency,
            'quantity'     => $data['quantity']     ?? null,
            'target_price' => $data['target_price'] ?? null,
            'notes'        => $data['notes']        ?? null,
            'created_by'   => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh([
            'product:id,product_code,name,status,segment_id',
            'product.segment:id,name,regulatory_status',
        ])], 201);
    }

    public function updateLeadProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $leadId, 'change its products');

        $blocked = $this->blockSourcingUnlessQualified($lead);
        if ($blocked) return $blocked;

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        $data = $request->validate([
            'currency'     => 'nullable|string',
            'quantity'     => 'nullable|numeric|min:0',
            'target_price' => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string|max:1000',
            'cascade_currency' => 'sometimes|boolean',
        ]);
        $cascade = (bool) ($data['cascade_currency'] ?? false);
        unset($data['cascade_currency']);

        $cascadeTo = null;
        if (array_key_exists('currency', $data) && $data['currency'] !== null && $data['currency'] !== '') {
            $picked = strtoupper($data['currency']);
            $others = LeadProduct::where('lead_id', $lead->id)
                ->where('id', '!=', $row->id)
                ->whereNotNull('currency')
                ->pluck('currency')
                ->map(fn ($c) => strtoupper((string) $c))
                ->unique()
                ->values();
            if ($others->isNotEmpty() && !$others->contains($picked)) {
                if (!$cascade) {
                    return response()->json([
                        'status'  => false,
                        'message' => "This opportunity already uses {$others->first()}. All products on a lead must share one currency — confirm the switch to re-price every product in {$picked}.",
                        'locked_currency' => $others->first(),
                        'cascade_available' => true,
                    ], 422);
                }
                $cascadeTo = $picked;
            }
            $data['currency'] = $picked;
        }

        $cascaded = 0;
        \Illuminate\Support\Facades\DB::transaction(function () use ($row, $data, $cascadeTo, $lead, &$cascaded) {
            $row->update($data);
            if ($cascadeTo !== null) {
                $cascaded = LeadProduct::where('lead_id', $lead->id)
                    ->where('id', '!=', $row->id)
                    ->update(['currency' => $cascadeTo]);
            }
        });

        return response()->json([
            'status' => true,
            'data'   => $row->fresh(['product:id,product_code,name']),
            'cascaded_count' => $cascaded,
        ]);
    }

    public function destroyLeadProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $lead = $this->findLeadForWrite($user, $leadId, 'remove its products');

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        $usedIn = $this->documentCodesByProduct($lead->id, [$row->product_id])[$row->product_id] ?? [];
        if (!empty($usedIn)) {
            return response()->json([
                'status'  => false,
                'message' => "You can't unmap this product — it's still on " . implode(', ', $usedIn)
                    . '. Remove the product from ' . (count($usedIn) > 1 ? 'those documents' : 'that document')
                    . ' first, then unmap it.',
                'used_in' => $usedIn,
            ], 422);
        }

        if (!empty($row->sourcing_status)) {
            return response()->json([
                'status'  => false,
                'message' => "You can't unmap this product — a sourcing decision has been set for it. "
                    . 'Unmapping is only allowed before the product is sent for sourcing.',
            ], 422);
        }

        if (LeadProductSharedPrice::where('lead_product_id', $row->id)->exists()) {
            return response()->json([
                'status'  => false,
                'message' => "You can't unmap this product — a price has already been shared for it.",
            ], 422);
        }

        DB::transaction(function () use ($row) {
            LeadProductSharedPrice::where('lead_product_id', $row->id)->delete();
            ProcurementProduct::where('lead_product_id', $row->id)->update(['lead_product_id' => null]);
            $row->delete();
        });

        return response()->json(['status' => true, 'message' => 'Product unmapped']);
    }

    private function documentCodesByProduct(int $leadId, array $productIds): array
    {
        $ids = array_values(array_filter($productIds, fn ($v) => !empty($v)));
        if (empty($ids)) return [];

        $quoted = DB::table('quotation_items as qi')
            ->join('quotations as q', 'q.id', '=', 'qi.quotation_id')
            ->where('q.opp_id', $leadId)
            ->where('q.status', '!=', \App\Models\Quotation::STATUS_CANCELLED)
            ->whereIn('qi.product_id', $ids)
            ->select('qi.product_id', 'q.code')
            ->distinct()
            ->get();

        $invoiced = DB::table('proforma_invoice_items as pii')
            ->join('proforma_invoices as p', 'p.id', '=', 'pii.proforma_invoice_id')
            ->where('p.opp_id', $leadId)
            ->where('p.status', '!=', \App\Models\ProformaInvoice::STATUS_CANCELLED)
            ->whereIn('pii.product_id', $ids)
            ->select('pii.product_id', 'p.code')
            ->distinct()
            ->get();

        $out = [];
        foreach ($quoted->concat($invoiced) as $r) {
            $pid = (int) $r->product_id;
            $code = $r->code ?: '(untitled document)';
            if (!in_array($code, $out[$pid] ?? [], true)) $out[$pid][] = $code;
        }

        return $out;
    }

    public function listAcknowledgements(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user, null, true);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadAcknowledgement::where('lead_id', $lead->id)
            ->orderByDesc('id')
            ->get();

        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function storeAcknowledgements(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $lead = $this->findLeadForWrite($user, $leadId, 'record an acknowledgement on it');

        $data = $request->validate([
            'reason_ids'   => 'required|array|min:1',
            'reason_ids.*' => 'integer',
        ]);

        $reasons = LeadAckReason::where('client_id', $user->client_id)
            ->whereIn('id', $data['reason_ids'])
            ->get();

        if ($reasons->count() !== count($data['reason_ids'])) {
            return response()->json([
                'status'  => false,
                'message' => 'One or more reasons are unavailable for this tenant',
            ], 422);
        }

        $types = $reasons->pluck('opportunity_type')->unique();
        if ($types->count() !== 1) {
            return response()->json([
                'status'  => false,
                'message' => 'All picked reasons must belong to the same opportunity bucket',
            ], 422);
        }
        $type = $types->first();

        if ($type !== LeadAckReason::TYPE_QUALIFIED) {
            $blocked = $this->blockUnqualifyWithWork(
                $lead,
                $type === LeadAckReason::TYPE_DISQUALIFIED ? 'Disqualified' : 'Clarity Pending',
            );
            if ($blocked) return $blocked;
        }

        $created = DB::transaction(function () use ($lead, $reasons, $type, $user) {
            $rows = [];
            foreach ($reasons as $r) {
                $rows[] = LeadAcknowledgement::create([
                    'client_id'         => $user->client_id,
                    'lead_id'           => $lead->id,
                    'lead_ack_reason_id'=> $r->id,
                    'opportunity_type'  => $r->opportunity_type,
                    'dq_status'         => $r->dq_status,
                    'reason_snapshot'   => $r->reason,
                    'created_by'        => $user->id,
                ]);
            }

            $lead->update([
                'qualified'          => $type === LeadAckReason::TYPE_QUALIFIED,
                'disqualified'       => $type === LeadAckReason::TYPE_DISQUALIFIED,
                'lead_ack_reason_id' => $reasons->first()->id,
            ]);

            return $rows;
        });

        return response()->json([
            'status'        => true,
            'message'       => 'Acknowledgement(s) recorded',
            'created_count' => count($created),
            'data'          => array_map(fn ($r) => $r->fresh(), $created),
            'lead'          => $lead->fresh()->only(['id', 'qualified', 'disqualified', 'lead_stage_id', 'lead_ack_reason_id']),
        ], 201);
    }

    public function salespersonSummary(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $branchFilter = $request->integer('branch_id') ?: null;

        $countsQ = Lead::query()
            ->whereNotNull('salesperson_id')
            ->selectRaw('salesperson_id, platform, COUNT(*) AS cnt')
            ->groupBy('salesperson_id', 'platform');
        $this->applyScope($countsQ, $user, $branchFilter);
        $countRows = $countsQ->get();

        $platforms = $countRows->pluck('platform')->filter()->unique()->sort()->values()->all();

        $perUser = [];
        foreach ($countRows as $r) {
            $uid = (int) $r->salesperson_id;
            if (!isset($perUser[$uid])) {
                $perUser[$uid] = ['platform_counts' => array_fill_keys($platforms, 0), 'total' => 0];
            }
            $platform = $r->platform ?? 'Unknown';
            $perUser[$uid]['platform_counts'][$platform] = (int) $r->cnt;
            $perUser[$uid]['total']                     += (int) $r->cnt;
        }

        $totalsQ = Lead::query();
        $this->applyScope($totalsQ, $user, $branchFilter);
        $totalsRow = $totalsQ->selectRaw(
            "COUNT(*) AS total_all,
             SUM(CASE WHEN salesperson_id IS NOT NULL THEN 1 ELSE 0 END) AS total_assigned,
             SUM(CASE WHEN salesperson_id IS NULL THEN 1 ELSE 0 END) AS total_unassigned"
        )->first();

        $holdsLeads = array_keys($perUser);

        $usersQ = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user', 'employee'])
            ->where(function ($w) use ($holdsLeads) {
                $w->where('status', 'active');
                if (!empty($holdsLeads)) $w->orWhereIn('id', $holdsLeads);
            });

        if ($user->user_type !== 'super_admin') {
            $usersQ->where('client_id', $user->client_id);
            if (\App\Support\SalesVisibility::pinnedToOwnBranch($user)) {
                $usersQ->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }

        $users = $usersQ->orderBy('name')->get(['id', 'name', 'designation', 'user_type', 'email', 'status']);

        $userIds = $users->pluck('id')->all();
        $employees = Employee::whereIn('user_id', $userIds)
            ->with([
                'department:id,name',
                'designation:id,name',
                'primaryRole:id,name',
                'ancillaryRole:id,name',
                'reportingManager:id,first_name,last_name,display_name',
            ])
            ->get()
            ->keyBy('user_id');

        $data = [];
        foreach ($users as $u) {
            $emp     = $employees->get($u->id);
            $counts  = $perUser[$u->id]['platform_counts'] ?? array_fill_keys($platforms, 0);
            $total   = $perUser[$u->id]['total']           ?? 0;

            $mgr = $emp?->reportingManager;
            $mgrName = $mgr
                ? trim($mgr->display_name ?: trim(($mgr->first_name ?? '') . ' ' . ($mgr->last_name ?? '')))
                : null;

            $data[] = [
                'salesperson_id'        => $u->id,
                'salesperson_name'      => $emp
                    ? trim($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
                    : ($u->name ?: '—'),
                'salesperson_code'      => $emp?->emp_code ?: ('EMP-' . str_pad((string) $u->id, 3, '0', STR_PAD_LEFT)),
                'department'            => $emp?->department?->name,
                'designation'           => $emp?->designation?->name ?: ($u->designation ?: null),
                'primary_role'          => $emp?->primaryRole?->name,
                'ancillary_role'        => $emp?->ancillaryRole?->name,
                'reporting_manager'     => $mgrName,
                'email'                 => $u->email,
                'is_active'             => $u->status === 'active',
                'platform_counts'       => $counts,
                'total_assigned_leads'  => $total,
            ];
        }

        $data = array_values(array_filter($data, function ($r) {
            if (($r['total_assigned_leads'] ?? 0) > 0) return true;
            $dept = $r['department'] ?? null;
            return $dept !== null && str_contains(mb_strtolower($dept), 'sales');
        }));

        usort($data, function ($a, $b) {
            $diff = $b['total_assigned_leads'] - $a['total_assigned_leads'];
            return $diff !== 0 ? $diff : strcmp($a['salesperson_name'], $b['salesperson_name']);
        });

        return response()->json([
            'status'    => true,
            'summary'   => [
                'total_sales_persons' => count($data),
                'total_leads'         => (int) ($totalsRow->total_all        ?? 0),
                'assigned_leads'      => (int) ($totalsRow->total_assigned   ?? 0),
                'unassigned_leads'    => (int) ($totalsRow->total_unassigned ?? 0),
            ],
            'platforms' => $platforms,
            'data'      => $data,
        ]);
    }

    public function salespeople(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $emps = \App\Models\Employee::query()
            ->whereNotNull('user_id')
            ->with(['designation:id,name', 'department:id,name'])
            ->get(['id', 'user_id', 'emp_code', 'designation_id', 'department_id'])
            ->keyBy('user_id');

        $branchId = (int) ($request->query('branch_id') ?: $user->branch_id ?: 0);

        $q = User::query()
            ->where('status', 'active');

        if ($user->user_type !== 'super_admin') {
            $q->where('client_id', $user->client_id);
        }
        if ($branchId) {
            $q->where('branch_id', $branchId);
        }

        $assignable = \App\Support\SalesVisibility::assignableUserIds($user);
        if ($assignable !== null) {
            $q->whereIn('id', $assignable ?: [-1]);
        }

        if (!empty(\App\Support\SalesVisibility::salesDepartmentIds())) {
            $salesUserIds = \App\Support\SalesVisibility::salesDepartmentUserIds($user, $branchId ?: null);
            $q->whereIn('id', $salesUserIds ?: [-1]);
        }

        $blockedUserIds = \App\Models\Employee::withTrashed()
            ->whereNotNull('user_id')
            ->where(function ($w) {
                $w->whereNotNull('deleted_at')
                  ->orWhere('status', '!=', 'Active')
                  ->orWhereNull('onboarding_stage_completed')
                  ->orWhere('onboarding_stage_completed', '<', 6);
            })
            ->pluck('user_id')
            ->all();
        if ($blockedUserIds) {
            $q->whereNotIn('id', $blockedUserIds);
        }

        $rows = $q->select(['id', 'name', 'user_type', 'email'])
                  ->orderBy('name')
                  ->get();

        return response()->json([
            'status' => true,
            'data'   => $rows->map(function ($u) use ($emps) {
                $emp  = $emps->get($u->id);
                $desg = $emp?->designation?->name;
                $dept = $emp?->department?->name;
                return [
                    'id'        => $u->id,
                    'name'      => $u->name,
                    'code'      => $emp?->emp_code ?: ('EMP-' . str_pad((string) $u->id, 3, '0', STR_PAD_LEFT)),
                    'role'      => $desg ?: $u->user_type,
                    'subtitle'  => trim(implode(' · ', array_filter([$desg, $dept]))) ?: ucfirst(str_replace('_', ' ', (string) $u->user_type)),
                ];
            })->values(),
        ]);
    }

    public function filterOptions(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $base = Lead::query();
        $this->applyScope($base, $user, $request->integer('branch_id') ?: null);

        $platforms = (clone $base)
            ->select('platform')->whereNotNull('platform')
            ->distinct()->orderBy('platform')->pluck('platform')->values();

        $queryTypes = (clone $base)
            ->select('query_type')->whereNotNull('query_type')
            ->distinct()->orderBy('query_type')->pluck('query_type')->values();

        $isoCodes = (clone $base)
            ->select('sender_country_iso')
            ->whereNotNull('sender_country_iso')
            ->groupBy('sender_country_iso')
            ->orderBy('sender_country_iso')
            ->pluck('sender_country_iso');

        $nameByIso = (clone $base)
            ->whereIn('sender_country_iso', $isoCodes)
            ->whereNotNull('sender_country_name')
            ->select('sender_country_iso', 'sender_country_name')
            ->groupBy('sender_country_iso', 'sender_country_name')
            ->pluck('sender_country_name', 'sender_country_iso')
            ->all();

        $countries = $isoCodes
            ->map(function ($iso) use ($nameByIso) {
                $name = $nameByIso[$iso] ?? self::ISO_COUNTRY_NAMES[$iso] ?? $iso;
                return ['value' => $iso, 'label' => $name];
            })
            ->sortBy('label')
            ->values();

        $cq = Customer::query()->forUser($user, $request->integer('branch_id') ?: null);
        $customers = $cq->select(['id', 'company_name', 'customer_code'])
                        ->orderBy('company_name')
                        ->limit(500)
                        ->get()
                        ->map(fn ($c) => [
                            'value' => (string) $c->id,
                            'label' => $c->company_name ?: ('Customer #' . $c->id),
                            'code'  => $c->customer_code,
                        ])
                        ->values();

        return response()->json([
            'status'      => true,
            'platforms'   => $platforms,
            'query_types' => $queryTypes,
            'countries'   => $countries,
            'customers'   => $customers,
            'stages'      => [
                ['value' => '1', 'label' => 'Inquiry Required'],
                ['value' => '2', 'label' => 'Lead Acknowledgement'],
                ['value' => '3', 'label' => 'Product Sourcing'],
                ['value' => '4', 'label' => 'Price Shared'],
                ['value' => '6', 'label' => 'Quotation vs PI'],
                ['value' => '8', 'label' => 'Victory'],
            ],
        ]);
    }

    private function downstreamWork(Lead $lead): array
    {
        $bits = [];

        $products = LeadProduct::where('lead_id', $lead->id)->count();
        if ($products) {
            $bits[] = $products . ' mapped product' . ($products === 1 ? '' : 's');
        }

        $quotations = \App\Models\Quotation::where('opp_id', $lead->id)->count();
        if ($quotations) {
            $bits[] = $quotations . ' quotation' . ($quotations === 1 ? '' : 's');
        }

        $pis = \App\Models\ProformaInvoice::where('opp_id', $lead->id)->count();
        if ($pis) {
            $bits[] = $pis . ' proforma invoice' . ($pis === 1 ? '' : 's');
        }

        return $bits;
    }

    private function blockUnqualifyWithWork(Lead $lead, string $verdict)
    {
        $work = $this->downstreamWork($lead);
        if (!$work) return null;

        return response()->json([
            'status'  => false,
            'message' => 'This opportunity already carries ' . implode(' and ', $work)
                . '. Remove that work from Stage 3 onwards before marking the lead '
                . $verdict . '.',
            'errors'  => ['reason_ids' => ['Downstream work must be cleared first.']],
        ], 422);
    }

    private function blockSourcingUnlessQualified(Lead $lead)
    {
        if ($lead->qualified && !$lead->disqualified) return null;

        return response()->json([
            'status'  => false,
            'message' => $lead->disqualified
                ? 'This lead is Disqualified — mark it Qualified in Lead Acknowledgement before changing its products or pricing.'
                : 'This lead is not Qualified yet — acknowledge it as Qualified before changing its products or pricing.',
        ], 422);
    }

    private function findLeadForWrite($user, int $leadId, string $action = 'change it'): Lead
    {
        $writeQ = Lead::query();
        $this->applyScope($writeQ, $user);
        $lead = $writeQ->find($leadId);
        if ($lead) return $lead;

        $readQ = Lead::query();
        $this->applyScope($readQ, $user, null, true);
        if ($readQ->whereKey($leadId)->exists()) {
            abort(response()->json([
                'status'  => false,
                'message' => "This lead is view-only for you — it is assigned to another user, so you cannot {$action}.",
            ], 403));
        }

        abort(response()->json([
            'status'  => false,
            'message' => 'This lead no longer exists, or it is not one you have access to.',
        ], 404));
    }

    private function applyScope($q, $user, ?int $branchFilter = null, bool $includeFormerOwned = false): void
    {
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if ($user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        $applyVisibility = function ($qq) use ($user, $includeFormerOwned) {
            $includeFormerOwned
                ? \App\Support\SalesVisibility::applyToLeadsIncludingFormerOwned($qq, $user)
                : \App\Support\SalesVisibility::applyToLeads($qq, $user);
        };

        if (\App\Support\SalesVisibility::pinnedToOwnBranch($user)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
            });
            $applyVisibility($q);
            return;
        }

        $this->applySwitcherBranchFilter($q, $user, $branchFilter);
        $applyVisibility($q);
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = \App\Models\Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private function checkSyncTenantGate($user): ?string
    {
        if ($user->user_type === 'super_admin') return null;

        $branch    = config('lead_sync.branch');
        $userBr    = (int) $user->branch_id;

        if ($branch === null) {
            return 'Lead sync is not configured. Set LEAD_SYNC_BRANCH_ID in .env.';
        }
        if ($branch === 'all') {
            return null;
        }
        if (is_array($branch)) {
            return in_array($userBr, $branch, true)
                ? null
                : 'Lead sync is configured for a different branch.';
        }
        return $userBr === (int) $branch
            ? null
            : 'Lead sync is configured for a different branch.';
    }

    public function nextOppCode(int $clientId, ?int $branchId = null): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $max = Lead::withTrashed()
            ->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'))
            ->selectRaw("COALESCE(MAX(CAST(NULLIF(regexp_replace(COALESCE(opp_code, ''), '\\D', '', 'g'), '') AS INTEGER)), 0) AS max_code")
            ->value('max_code');
        return sprintf('OPP-%04d', ((int) $max) + 1);
    }
}

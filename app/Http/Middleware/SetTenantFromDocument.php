<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Public signed PDF links have no user — the tenant comes from the document itself.
 * Usage: ->middleware(['signed', 'tenant.document:proforma_invoices'])
 */
class SetTenantFromDocument
{
    private const TABLES = ['quotations', 'proforma_invoices', 'purchase_orders', 'debit_notes'];

    public function handle(Request $request, Closure $next, string $table): Response
    {
        TenantContext::clear();
        if (in_array($table, self::TABLES, true)) {
            $doc = DB::table($table)->where('id', (int) $request->route('id'))->first(['client_id', 'branch_id']);
            if ($doc && $doc->client_id) TenantContext::set((int) $doc->client_id, $doc->branch_id ? (int) $doc->branch_id : null);
        }
        try {
            return $next($request);
        } finally {
            TenantContext::clear();
        }
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

/**
 * The Exit Documents stage, in ONE request instead of four.
 *
 * Measured on the server, that screen's four document calls each cost about
 * the same no matter what they do:
 *
 *   hr-document-templates/match        0.5 kB   2.06 s
 *   hr-document-signatures             2.4 kB   2.69 s
 *   onboarding-doc-set?kind=exit       0.5 kB   2.12 s
 *   hr-generated-documents             0.4 kB   2.09 s
 *
 * 3.8 kB of data, four round trips. The work inside them is 12-57ms locally,
 * so what is being paid for is the trip, not the query — and the browser only
 * opens six connections at once, so nine requests on this screen means two
 * waves. Collapsing four into one removes a wave.
 *
 * The four controllers are CALLED, not reimplemented: each is a plain
 * (Request) method returning JsonResponse, so this hands each one the query
 * string it expects and decodes the reply. The payloads are therefore
 * identical to the separate endpoints by construction, and a later change to
 * any of them is picked up here with no second copy to keep in step. The
 * separate routes stay — other screens use them.
 */
class ExitDocumentBundleController extends Controller
{
    /**
     * The exit RECORD's four reads, in one trip.
     *
     * Same reasoning as show() below, and the same four numbers off the server:
     * fnf-summary 4.29s, exit-stats 2.75s, and the exit record and notice
     * payment around 2s each — for payloads of 0.4 to 2.0 kB. The browser opens
     * six connections, so trimming the screen's request count is the only thing
     * that moves a load dominated by per-request cost.
     *
     * direct_reports is asked with count_only, which is what the screen reads;
     * the full list is 29 kB and nothing here displays it. (QA #13)
     */
    public function overview(Request $request, int $employee)
    {
        $sub = function (array $query) use ($request): Request {
            $r = Request::create($request->getPathInfo(), 'GET', $query);
            $r->setUserResolver($request->getUserResolver());
            return $r;
        };
        $json = fn ($response) => json_decode($response->getContent(), true);

        $exit = new ExitController();

        return response()->json([
            'exit'           => $json($exit->show($sub([]), $employee)),
            'fnf_summary'    => $json($exit->fnfSummary($sub([]), $employee)),
            'direct_reports' => $json($exit->directReports($sub(['count_only' => 1]), $employee)),
            'notice_payment' => $json((new ExitNoticePaymentController())->summary($sub([]), $employee)),
        ]);
    }

    public function show(Request $request, int $employee)
    {
        $keyword = trim((string) $request->query('trigger_keyword', 'exit'));

        /* A fresh Request per call, carrying only what that endpoint reads.
           Reusing $request would hand each controller the others' parameters —
           harmless today, but it is the kind of coupling that breaks quietly
           when one of them grows a new filter. */
        $sub = function (array $query) use ($request): Request {
            $r = Request::create($request->getPathInfo(), 'GET', $query);
            $r->setUserResolver($request->getUserResolver());
            return $r;
        };

        $json = fn ($response) => json_decode($response->getContent(), true);

        return response()->json([
            'match' => $json((new HrDocumentTemplateController())->matchForEmployee(
                $sub(['employee_id' => $employee, 'trigger_keyword' => $keyword])
            )),
            'runs' => $json((new HrDocumentSignatureController())->index(
                $sub(['employee_id' => $employee])
            )),
            'doc_set' => $json((new HrOnboardingDocSetController())->show(
                $sub(['kind' => $keyword]), $employee
            )),
            'generated' => $json((new HrGeneratedDocumentController())->index(
                $sub(['employee_id' => $employee])
            )),
        ]);
    }
}

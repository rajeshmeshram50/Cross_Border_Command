<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

class ExitDocumentBundleController extends Controller
{
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

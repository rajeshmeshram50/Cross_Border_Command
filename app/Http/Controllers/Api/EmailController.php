<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Listeners\LogSentEmail;
use App\Mail\ComposedEmail;
use App\Models\Branch;
use App\Models\Customer;
use App\Models\EmailLog;
use App\Models\Employee;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class EmailController extends Controller
{
    private const WITH = [
        'client:id,org_name',
        'branch:id,name',
        'sender:id,name,user_type',
        'employee:id,first_name,last_name,display_name,emp_code',
    ];

    private const LIST_COLUMNS = [
        'id', 'client_id', 'branch_id', 'user_id', 'employee_id',
        'direction', 'category', 'from_email', 'from_name',
        'to_email', 'to_name', 'subject', 'has_attachments',
        'status', 'is_read', 'is_starred', 'sent_at', 'created_at',
    ];

    private function guard(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->user_type === 'employee') {
            abort(403, 'The Gmail module is not available for employee accounts.');
        }
        return $user;
    }

    public function index(Request $request)
    {
        $user = $this->guard($request);

        $q = EmailLog::query()->with(self::WITH);

        $folder = $request->query('folder', $request->query('tab', 'all'));
        if ($folder === 'trash') {
            $q->onlyTrashed();
        }
        $this->applyScope($q, $user, $request->integer('branch_id') ?: null);

        switch ($folder) {
            case 'employee':
                $q->whereNotNull('employee_id');
                break;
            case 'branch':
                $q->whereNotNull('branch_id');
                break;
            case 'composed':
                $q->where('category', 'composed');
                break;
            case 'sent':
                $q->where('user_id', $user->id);
                break;
            case 'starred':
                $q->where('is_starred', true);
                break;
        }

        if ($request->boolean('unread')) $q->where('is_read', false);
        if ($cat = $request->query('category')) $q->where('category', $cat);
        if ($status = $request->query('status')) $q->where('status', $status);
        if ($empId = $request->integer('employee_id')) $q->where('employee_id', $empId);

        if ($search = trim((string) $request->query('search'))) {
            $q->where(function ($w) use ($search) {
                $w->where('subject', 'ilike', "%{$search}%")
                  ->orWhere('to_email', 'ilike', "%{$search}%")
                  ->orWhere('to_name', 'ilike', "%{$search}%")
                  ->orWhere('from_email', 'ilike', "%{$search}%");
            });
        }

        $perPage = max(5, min(100, (int) $request->integer('per_page', 25)));
        $page = $q->select(self::LIST_COLUMNS)
            ->selectRaw("LEFT(COALESCE(body_text, ''), 160) AS snippet")
            ->orderByDesc('id')
            ->paginate($perPage);

        return response()->json([
            'data' => $page->items(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ]);
    }

    public function show(Request $request, $id)
    {
        $user = $this->guard($request);

        $q = EmailLog::query()->withTrashed()->with(self::WITH);
        $this->applyScope($q, $user);
        $row = $q->findOrFail((int) $id);

        if (!$row->is_read) {
            $row->forceFill(['is_read' => true])->save();
        }

        return response()->json(['data' => $row]);
    }

    public function stats(Request $request)
    {
        $user = $this->guard($request);

        $base = fn () => tap(EmailLog::query(), fn ($q) => $this->applyScope($q, $user, $request->integer('branch_id') ?: null));
        $trash = fn () => tap(EmailLog::onlyTrashed(), fn ($q) => $this->applyScope($q, $user, $request->integer('branch_id') ?: null));

        return response()->json([
            'data' => [
                'total'     => $base()->count(),
                'unread'    => $base()->where('is_read', false)->count(),
                'sent'      => $base()->where('status', 'sent')->count(),
                'failed'    => $base()->where('status', 'failed')->count(),
                'branch'    => $base()->whereNotNull('branch_id')->count(),
                'employee'  => $base()->whereNotNull('employee_id')->count(),
                'composed'  => $base()->where('category', 'composed')->count(),
                'mine'      => $base()->where('user_id', $user->id)->count(),
                'starred'   => $base()->where('is_starred', true)->count(),
                'trash'     => $trash()->count(),
            ],
        ]);
    }

    public function bulk(Request $request)
    {
        $user = $this->guard($request);

        $data = $request->validate([
            'ids'    => ['required', 'array', 'min:1', 'max:500'],
            'ids.*'  => ['integer'],
            'action' => ['required', Rule::in(['read', 'unread', 'star', 'unstar', 'trash', 'restore', 'delete'])],
        ]);

        $q = EmailLog::query()->withTrashed()->whereIn('id', $data['ids']);
        $this->applyScope($q, $user);
        $rows = $q->get();

        $affected = 0;
        foreach ($rows as $row) {
            switch ($data['action']) {
                case 'read':    $row->forceFill(['is_read' => true])->save();  break;
                case 'unread':  $row->forceFill(['is_read' => false])->save(); break;
                case 'star':    $row->forceFill(['is_starred' => true])->save();  break;
                case 'unstar':  $row->forceFill(['is_starred' => false])->save(); break;
                case 'trash':   if (!$row->trashed()) $row->delete();   break;
                case 'restore': if ($row->trashed())  $row->restore();  break;
                case 'delete':  $row->forceDelete();  break;
            }
            $affected++;
        }

        return response()->json(['data' => ['affected' => $affected, 'action' => $data['action']]]);
    }

    public function recipients(Request $request)
    {
        $user = $this->guard($request);
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $empQ = Employee::query()
            ->whereNotNull('email')
            ->select(['id', 'first_name', 'last_name', 'display_name', 'emp_code', 'email', 'branch_id']);
        if ($clientId !== null) $empQ->where('client_id', $clientId);
        if ($branchId !== null) {
            $empQ->where('branch_id', $branchId);
        }
        $employees = $empQ->orderBy('first_name')->limit(1000)->get()->map(fn ($e) => [
            'id'    => $e->id,
            'name'  => $e->display_name ?: trim("{$e->first_name} {$e->last_name}") ?: $e->email,
            'email' => $e->email,
            'code'  => $e->emp_code,
        ]);

        $branchQ = Branch::query()->whereNotNull('email')->select(['id', 'name', 'email']);
        if ($clientId !== null) $branchQ->where('client_id', $clientId);
        if ($branchId !== null) $branchQ->where('id', $branchId);
        $branches = $branchQ->orderBy('name')->get()->map(fn ($b) => [
            'id'    => $b->id,
            'name'  => $b->name,
            'email' => $b->email,
        ]);

        $custQ = Customer::query()
            ->whereNotNull('primary_email')->where('primary_email', '!=', '')
            ->select(['id', 'company_name', 'customer_code', 'primary_email', 'branch_id']);
        if ($clientId !== null) $custQ->where('client_id', $clientId);
        if ($branchId !== null) {
            $custQ->where('branch_id', $branchId);
        }
        $customers = $custQ->orderBy('company_name')->limit(1000)->get()->map(fn ($c) => [
            'id'    => $c->id,
            'name'  => $c->company_name ?: $c->primary_email,
            'email' => $c->primary_email,
            'code'  => $c->customer_code,
        ]);

        return response()->json(['data' => [
            'employees' => $employees,
            'branches'  => $branches,
            'customers' => $customers,
        ]]);
    }

    public function store(Request $request)
    {
        $user = $this->guard($request);

        $data = $request->validate([
            'to'      => ['required', 'array', 'min:1', 'max:50'],
            'to.*'    => ['required', 'email'],
            'cc'      => ['nullable', 'array', 'max:50'],
            'cc.*'    => ['email'],
            'subject' => ['required', 'string', 'max:255'],
            'body'    => ['required', 'string', 'max:50000'],
            'attachments'   => ['nullable', 'array', 'max:10'],
            'attachments.*' => [
                'file', 'max:8192',
                'mimes:jpg,jpeg,png,gif,webp,bmp,pdf,doc,docx,xls,xlsx,csv,ppt,pptx,txt,zip',
            ],
        ]);

        if (!Settings::shouldSendMail()) {
            return response()->json([
                'message' => 'Email sending is currently disabled in Settings → Notifications.',
            ], 422);
        }

        $uploads = array_values(array_filter(
            $request->file('attachments', []),
            fn ($f) => $f && $f->isValid()
        ));

        $totalBytes = array_sum(array_map(fn ($f) => (int) $f->getSize(), $uploads));
        if ($totalBytes > 20 * 1024 * 1024) {
            return response()->json(['message' => 'Attachments exceed the 20 MB total limit.'], 422);
        }

        $mailFiles = [];
        $attachmentMeta = [];
        foreach ($uploads as $file) {
            $display  = $file->getClientOriginalName() ?: 'attachment';
            $ext      = strtolower($file->getClientOriginalExtension());
            $diskName = (Str::slug(pathinfo($display, PATHINFO_FILENAME)) ?: 'file') . ($ext ? ".{$ext}" : '');
            $dir      = 'email-attachments/' . date('Y/m') . '/' . Str::random(24);
            $stored   = $file->storeAs($dir, $diskName, 'public');
            $mime     = $file->getClientMimeType() ?: 'application/octet-stream';

            $mailFiles[]      = ['path' => Storage::disk('public')->path($stored), 'name' => $display, 'mime' => $mime];
            $attachmentMeta[] = ['name' => $display, 'size' => (int) $file->getSize(), 'mime' => $mime, 'path' => '/storage/' . $stored];
        }

        $orgName = $user->client?->org_name ?: config('mail.from.name', 'Cross Border Command');
        $senderName = $user->name ?: '';
        $bodyHtml = str_contains($data['body'], '<') ? $data['body'] : nl2br(e($data['body']));

        LogSentEmail::$composedAttachments = $attachmentMeta ?: null;

        $sent = 0;
        $failed = [];
        try {
            $ccAttached = false;
            foreach ($data['to'] as $email) {
                $name = $this->resolveRecipientName($email);
                try {
                    $mail = Mail::to($email);
                    if (!empty($data['cc']) && !$ccAttached) {
                        $mail->cc($data['cc']);
                        $ccAttached = true;
                    }
                    $mail->send(new ComposedEmail($data['subject'], $bodyHtml, $name, $orgName, $senderName, $mailFiles));
                    $sent++;
                } catch (\Throwable $e) {
                    $failed[] = ['email' => $email, 'error' => $e->getMessage()];
                }
            }
        } finally {
            LogSentEmail::$composedAttachments = null;
        }

        return response()->json([
            'message' => $sent > 0
                ? "Sent to {$sent} recipient" . ($sent === 1 ? '' : 's') . '.'
                : 'Could not send the email.',
            'data' => ['sent' => $sent, 'failed' => $failed],
        ], $sent > 0 ? 201 : 422);
    }

    private function resolveRecipientName(string $email): string
    {
        $emp = Employee::whereRaw('LOWER(email) = ?', [mb_strtolower($email)])
            ->first(['first_name', 'last_name', 'display_name']);
        if ($emp) {
            return $emp->display_name ?: trim("{$emp->first_name} {$emp->last_name}") ?: 'there';
        }
        $u = User::whereRaw('LOWER(email) = ?', [mb_strtolower($email)])->value('name');
        return $u ?: 'there';
    }

    private function resolveOwnership(User $user): array
    {
        if ($user->user_type === 'super_admin') return [null, null];
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) return [$user->client_id, null];
        if (in_array($user->user_type, ['branch_user', 'employee'], true)) return [$user->client_id, $user->branch_id];
        return [null, null];
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;

            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId) {
                      $ww->where('client_id', $clientId)->where(function ($wb) use ($branchId) {
                          $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                      });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }
}

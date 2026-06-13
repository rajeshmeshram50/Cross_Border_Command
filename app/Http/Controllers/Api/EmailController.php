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

/**
 * Backs the "Gmail" menu — a tenant-scoped history of every outbound email plus
 * a compose/send box. The history rows are written automatically by
 * App\Listeners\LogSentEmail; this controller only reads them (scoped to the
 * caller's tenant exactly like AnnouncementController) and lets the user send a
 * new message, which flows back through the same logging path.
 */
class EmailController extends Controller
{
    private const WITH = [
        'client:id,org_name',
        'branch:id,name,is_main',
        'sender:id,name,user_type',
        'employee:id,first_name,last_name,display_name,emp_code',
    ];

    /** Columns returned to the list (body excluded — pulled on show()). */
    private const LIST_COLUMNS = [
        'id', 'client_id', 'branch_id', 'user_id', 'employee_id',
        'direction', 'category', 'from_email', 'from_name',
        'to_email', 'to_name', 'subject', 'has_attachments',
        'status', 'is_read', 'is_starred', 'sent_at', 'created_at',
    ];

    /**
     * The Gmail module is oversight of tenant correspondence — credential /
     * onboarding mails for the whole branch flow through it — so it is closed
     * to the `employee` tier (which can only see its own work). The sidebar /
     * profile menu already hides it for employees; this is the matching
     * server-side guard so the API can't be hit directly.
     */
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

        // Folders. "trash" reads the soft-deleted rows; everything else reads
        // live rows (SoftDeletes scopes them out by default).
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
                // "Sent" is everything the signed-in user actually dispatched —
                // composed mail AND announcements / docs they triggered — not just
                // the compose box. System mail (OTP, etc.) has no actor (user_id
                // null) so it correctly stays out of the sender's Sent box.
                $q->where('user_id', $user->id);
                break;
            case 'starred':
                $q->where('is_starred', true);
                break;
            // 'all' / 'trash' — no extra category filter.
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
        // Exclude the heavy body columns from the list — show() pulls the full
        // record. FK ids are kept in LIST_COLUMNS so the eager loads still work.
        // A short snippet of the text body is added for the Gmail-style preview.
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

        // Opening an email marks it read (Gmail behaviour).
        if (!$row->is_read) {
            $row->forceFill(['is_read' => true])->save();
        }

        return response()->json(['data' => $row]);
    }

    /** KPI strip + category breakdown for the page header. */
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
                // Drives the "Sent" folder count — mail the signed-in user sent.
                'mine'      => $base()->where('user_id', $user->id)->count(),
                'starred'   => $base()->where('is_starred', true)->count(),
                'trash'     => $trash()->count(),
            ],
        ]);
    }

    /**
     * Bulk action over a set of email ids — the Gmail toolbar (mark read /
     * unread, star / unstar, trash / restore). All ids are re-scoped to the
     * caller's tenant before any change, so you can only act on your own mail.
     */
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
                case 'delete':  $row->forceDelete();  break;   // permanent — empty-trash
            }
            $affected++;
        }

        return response()->json(['data' => ['affected' => $affected, 'action' => $data['action']]]);
    }

    /** Recipient picker for the compose box — branches + employees in scope. */
    public function recipients(Request $request)
    {
        $user = $this->guard($request);
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $empQ = Employee::query()
            ->whereNotNull('email')
            ->select(['id', 'first_name', 'last_name', 'display_name', 'emp_code', 'email', 'branch_id']);
        if ($clientId !== null) $empQ->where('client_id', $clientId);
        // Sub-branch user → only their own branch's staff. Main-branch / client
        // admin / super_admin see the whole client.
        if ($branchId !== null && !($user->branch?->is_main ?? false)) {
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
        if ($branchId !== null && !($user->branch?->is_main ?? false)) $branchQ->where('id', $branchId);
        $branches = $branchQ->orderBy('name')->get()->map(fn ($b) => [
            'id'    => $b->id,
            'name'  => $b->name,
            'email' => $b->email,
        ]);

        // Customers — sales contacts the branch corresponds with. Same tenant
        // scoping as employees/branches.
        $custQ = Customer::query()
            ->whereNotNull('primary_email')->where('primary_email', '!=', '')
            ->select(['id', 'company_name', 'customer_code', 'primary_email', 'branch_id']);
        if ($clientId !== null) $custQ->where('client_id', $clientId);
        if ($branchId !== null && !($user->branch?->is_main ?? false)) {
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

    /** Compose + send a new email. Logged automatically by LogSentEmail. */
    public function store(Request $request)
    {
        $user = $this->guard($request);

        $data = $request->validate([
            // Cap the blast radius — a compose box shouldn't be a bulk mailer.
            'to'      => ['required', 'array', 'min:1', 'max:50'],
            'to.*'    => ['required', 'email'],
            'cc'      => ['nullable', 'array', 'max:50'],
            'cc.*'    => ['email'],
            'subject' => ['required', 'string', 'max:255'],
            'body'    => ['required', 'string', 'max:50000'],
            // Attachments — documents / images, Gmail-style. Per-file 8 MB,
            // up to 10 files; office docs, PDFs, images, csv/txt, zip only
            // (no executables/scripts).
            'attachments'   => ['nullable', 'array', 'max:10'],
            'attachments.*' => [
                'file', 'max:8192',
                // No svg — it can carry inline script and would run from our origin.
                'mimes:jpg,jpeg,png,gif,webp,bmp,pdf,doc,docx,xls,xlsx,csv,ppt,pptx,txt,zip',
            ],
        ]);

        if (!Settings::shouldSendMail()) {
            return response()->json([
                'message' => 'Email sending is currently disabled in Settings → Notifications.',
            ], 422);
        }

        // Persist any attachments once (shared by every recipient row). Each file
        // lands under an unguessable random folder on the public disk; we keep
        // two views: $mailFiles (absolute paths for the mailable to attach) and
        // $attachmentMeta (name/size/mime + /storage URL for the reading pane).
        $uploads = array_values(array_filter(
            $request->file('attachments', []),
            fn ($f) => $f && $f->isValid()
        ));

        // Enforce the total-size cap BEFORE writing anything, so an over-limit
        // batch never leaves half its files orphaned on disk.
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
            $stored   = $file->storeAs($dir, $diskName, 'public');   // e.g. email-attachments/2026/06/<rand>/file.pdf
            $mime     = $file->getClientMimeType() ?: 'application/octet-stream';

            $mailFiles[]      = ['path' => Storage::disk('public')->path($stored), 'name' => $display, 'mime' => $mime];
            $attachmentMeta[] = ['name' => $display, 'size' => (int) $file->getSize(), 'mime' => $mime, 'path' => '/storage/' . $stored];
        }

        $orgName = $user->client?->org_name ?: config('mail.from.name', 'Cross Border Command');
        $senderName = $user->name ?: '';
        // Normalise plain-text line breaks to <br> so a typed message keeps its
        // shape; if the user pasted HTML it passes through untouched.
        $bodyHtml = str_contains($data['body'], '<') ? $data['body'] : nl2br(e($data['body']));

        // Hand the attachment metadata to the send-logger so each logged row
        // records the file list (for the reading-pane download chips). Cleared
        // in finally so it never bleeds into the next send.
        LogSentEmail::$composedAttachments = $attachmentMeta ?: null;

        $sent = 0;
        $failed = [];
        try {
            // One personalised send per recipient (each gets a "Hi {their name}").
            // Cc is attached only to the FIRST send so cc'd people don't receive a
            // duplicate copy for every To address.
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

    // ── Tenant scoping (mirrors AnnouncementController) ──────────────────────

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
            $isMain   = $user->branch?->is_main ?? false;

            if ($isMain) {
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                $this->applySwitcherBranchFilter($q, $user, $branchFilter);
                return;
            }

            $mainBranchId = Branch::where('client_id', $clientId)->where('is_main', true)->value('id');
            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)->where(function ($wb) use ($branchId, $mainBranchId) {
                          $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                          if ($mainBranchId) $wb->orWhere('branch_id', $mainBranchId);
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

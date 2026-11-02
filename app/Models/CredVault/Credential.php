<?php

namespace App\Models\CredVault;

use App\Models\Masters\Departments;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * CredVault · one stored credential. A soft-deleted row is in the Recycle Bin.
 *
 * secret, fields, notes and totp_secret are encrypted casts — they are never
 * serialised: $hidden keeps them out of every toArray(), and the only way a
 * value leaves the server is the reveal endpoint, which logs it.
 */
class Credential extends Model
{
    use SoftDeletes;

    protected $table = 'credvault_credentials';

    public const SCOPES = ['personal', 'team'];
    public const RISKS  = ['low', 'medium', 'high', 'critical'];
    public const TWOFA  = ['yes', 'no', 'na'];
    public const ROTATIONS = [30, 60, 90, 180];

    public const STRENGTH_LABELS = [0 => '', 1 => 'Weak', 2 => 'Fair', 3 => 'Good', 4 => 'Strong'];

    public const GROUPS = [
        'Logins & Access', 'Finance & Banking', 'Development & IT',
        'Identity & Documents', 'Personal & Lifestyle',
    ];

    /**
     * The 25 credential types — copied from the prototype's CRD_TYPES, field
     * for field, so the picker, the form and the server agree on every label.
     *
     *   [label, group, default risk, twofa, id, sec, isNew, description, fields]
     *
     *   twofa  the Security section shows a "2FA" switch for this type, and that
     *          switch is also the authenticator lock (see the controller)
     *   id     the field shown as Username in lists
     *   sec    THE secret: strength, reuse, rotation and reveal all read it
     *
     * A field is [key, label, kind, required, placeholder, icon, extra].
     *   kind   text url email tel number date select textarea password secret file toggle
     *   extra  span (1–3 grid columns), max, upper, mono, secret (a textarea that is masked)
     * For a select, the placeholder holds the options, "|"-separated — as in the prototype.
     */
    public const TYPES = [
        'login' => ['Login', 'Logins & Access', 'medium', true, 'username', 'password', false, 'Website URL, username & password', [
            ['url', 'Website / URL', 'url', true, 'https://app.example.com', 'globe', ['span' => 2]],
            ['username', 'Username', 'text', true, 'e.g. admin@inorbvict.com', 'user'],
            ['password', 'Password', 'password', true, 'Enter or generate', 'lock', ['span' => 2]],
        ]],
        'password' => ['Password', 'Logins & Access', 'medium', false, 'username', 'password', false, 'One password for any account', [
            ['url', 'Website / URL', 'url', false, 'https://app.example.com', 'globe'],
            ['username', 'Username', 'text', true, 'e.g. admin@inorbvict.com', 'user'],
            ['password', 'Password', 'password', true, 'Enter or generate', 'lock'],
            ['twofa', '2FA', 'toggle', false, 'Two-factor authentication', 'shield'],
        ]],
        'email' => ['Email', 'Logins & Access', 'high', true, 'email', 'password', false, 'Address, provider & recovery', [
            ['email', 'Email Address', 'email', true, 'name@inorbvict.com', 'mail'],
            ['provider', 'Provider', 'select', true, 'Google Workspace|Microsoft 365|Zoho Mail|Other', 'mail'],
            ['password', 'Password', 'password', true, 'Enter or generate', 'lock'],
            ['recovery', 'Recovery Email / Phone', 'text', false, 'Optional', 'phone', ['span' => 3]],
        ]],
        'passkey' => ['Passkey', 'Logins & Access', 'medium', true, 'username', null, true, 'Site & where it is stored', [
            ['url', 'Website / App', 'url', true, 'https://accounts.example.com', 'globe', ['span' => 2]],
            ['username', 'Username', 'text', true, 'Account the passkey signs in to', 'user'],
            ['device', 'Stored On', 'select', true, 'Security key (YubiKey)|Windows Hello|iCloud Keychain|Google Password Manager|Android device|Other', 'phone'],
            ['created', 'Created On', 'date', false, '', 'cal'],
        ]],
        'totp' => ['TOTP / 2FA Seed', 'Logins & Access', 'high', false, 'account', 'seed', true, 'Authenticator secret & backups', [
            ['service', 'Service', 'text', true, 'e.g. AWS Console', 'globe'],
            ['account', 'Account', 'text', true, 'e.g. admin@inorbvict.com', 'user'],
            ['seed', 'Secret Key', 'secret', true, 'Base32 secret from the QR setup', 'key', ['span' => 2, 'upper' => true]],
            ['digits', 'Code Length', 'select', false, '6 digits|8 digits', 'hash'],
            ['period', 'Refresh Period', 'select', false, '30 seconds|60 seconds', 'timer'],
            ['backup', 'Backup Codes', 'textarea', false, 'One code per line', 'note', ['span' => 3, 'secret' => true]],
        ]],
        'card' => ['Credit Card', 'Finance & Banking', 'critical', false, 'holder', 'cardno', false, 'Card no., expiry, CVV & PIN', [
            ['holder', 'Cardholder Name', 'text', true, 'Name as printed on card', 'user'],
            ['cardno', 'Card Number', 'secret', true, 'XXXX XXXX XXXX XXXX', 'card', ['max' => 19]],
            ['issuer', 'Issuing Bank', 'text', false, 'e.g. HDFC Bank', 'bank'],
            ['exp', 'Expiry (MM/YY)', 'text', true, 'MM/YY', 'cal', ['max' => 5]],
            ['cvv', 'CVV', 'secret', true, '3 or 4 digits', 'lock', ['max' => 4]],
            ['pin', 'Card PIN', 'secret', false, 'Optional', 'lock', ['max' => 6]],
        ]],
        'bank' => ['Bank Account', 'Finance & Banking', 'critical', true, 'acno', 'nbpass', false, 'Account no., IFSC & net-banking', [
            ['bank', 'Bank Name', 'text', true, 'e.g. ICICI Bank', 'bank'],
            ['holder', 'Account Holder', 'text', true, 'Name on the account', 'user'],
            ['acno', 'Account Number', 'secret', true, 'Account number', 'hash'],
            ['ifsc', 'IFSC Code', 'text', true, 'e.g. ICIC0001234', 'hash', ['max' => 11, 'upper' => true]],
            ['nbuser', 'Net-Banking User ID', 'text', false, 'Optional', 'user'],
            ['nbpass', 'Net-Banking Password', 'password', false, 'Optional', 'lock'],
        ]],
        'crypto' => ['Crypto Wallet', 'Finance & Banking', 'critical', true, 'wallet', 'seed', false, 'Address & recovery phrase', [
            ['wallet', 'Wallet / Exchange', 'text', true, 'e.g. Ledger, WazirX', 'folder'],
            ['address', 'Wallet Address', 'text', true, 'Public address', 'hash', ['span' => 2]],
            ['seed', 'Recovery Phrase', 'secret', true, '12 or 24 words', 'key', ['span' => 2]],
            ['wpass', 'Wallet Password', 'password', false, 'Optional', 'lock'],
        ]],
        'rewards' => ['Rewards', 'Finance & Banking', 'low', false, 'member', 'password', false, 'Programme & member ID', [
            ['program', 'Program Name', 'text', true, 'e.g. Air India Maharaja Club', 'gift'],
            ['member', 'Member ID', 'text', true, 'Membership number', 'hash'],
            ['password', 'Password', 'password', false, 'Optional', 'lock'],
        ]],
        'api' => ['API Credentials', 'Development & IT', 'high', false, 'service', 'apikey', false, 'API key, secret & endpoint', [
            ['service', 'Service / Platform', 'text', true, 'e.g. Zoho Books API', 'code'],
            ['endpoint', 'Endpoint URL', 'url', false, 'https://api.example.com', 'link', ['span' => 2]],
            ['apikey', 'API Key / Client ID', 'secret', true, 'API key', 'key', ['span' => 2]],
            ['secret', 'API Secret', 'secret', true, 'Client secret / token', 'lock'],
            ['expiry', 'Expires On', 'date', false, '', 'cal'],
        ]],
        'ssh' => ['SSH Key', 'Development & IT', 'high', false, 'host', 'privkey', false, 'Host, user & private key', [
            ['host', 'Host', 'text', true, 'e.g. 10.0.1.25 or prod.example.com', 'server'],
            ['username', 'Username', 'text', true, 'e.g. ubuntu', 'user'],
            ['passphrase', 'Passphrase', 'password', false, 'Optional', 'lock'],
            ['privkey', 'Private Key', 'textarea', true, '-----BEGIN OPENSSH PRIVATE KEY-----', 'key', ['span' => 3, 'mono' => true, 'secret' => true]],
        ]],
        'database' => ['Database', 'Development & IT', 'high', false, 'username', 'password', false, 'Engine, host, port & DB user', [
            ['engine', 'Database Type', 'select', true, 'MySQL|PostgreSQL|SQL Server|MongoDB|Oracle|Other', 'db'],
            ['host', 'Host', 'text', true, 'e.g. db.internal.example.com', 'server'],
            ['port', 'Port', 'number', true, 'e.g. 5432', 'hash'],
            ['dbname', 'Database Name', 'text', true, 'e.g. erp_prod', 'db'],
            ['username', 'Username', 'text', true, 'e.g. app_user', 'user'],
            ['password', 'Password', 'password', true, 'Enter or generate', 'lock'],
        ]],
        'server' => ['Server', 'Development & IT', 'high', false, 'username', 'password', false, 'Host, OS & admin login', [
            ['host', 'Hostname / IP', 'text', true, 'e.g. 192.168.1.10', 'server'],
            ['os', 'Operating System', 'select', false, 'Linux|Windows Server|macOS|Other', 'server'],
            ['port', 'Port', 'number', false, 'e.g. 22 or 3389', 'hash'],
            ['username', 'Username', 'text', true, 'e.g. administrator', 'user'],
            ['password', 'Password', 'password', true, 'Enter or generate', 'lock', ['span' => 2]],
        ]],
        'cert' => ['Certificate', 'Development & IT', 'high', false, 'domain', 'kpass', true, 'Domain, validity & cert file', [
            ['domain', 'Domain / Common Name', 'text', true, 'e.g. *.inorbvict.com', 'globe'],
            ['issuer', 'Issued By', 'text', false, "e.g. Let's Encrypt", 'shield'],
            ['expiry', 'Valid Till', 'date', true, '', 'cal'],
            ['file', 'Certificate File', 'file', true, '.pem, .crt, .pfx · up to 10 MB', 'up', ['span' => 2]],
            ['kpass', 'Private Key Password', 'password', false, 'Optional', 'lock'],
        ]],
        'license' => ['Software License', 'Development & IT', 'medium', false, 'product', 'lkey', false, 'License key, seats & renewal', [
            ['product', 'Software', 'text', true, 'e.g. Microsoft 365 Business', 'license'],
            ['lkey', 'License Key', 'secret', true, 'XXXXX-XXXXX-XXXXX', 'key', ['span' => 2]],
            ['licto', 'Licensed To', 'text', false, 'Person or company', 'user'],
            ['seats', 'Seats', 'number', false, 'e.g. 25', 'hash'],
            ['expiry', 'Renewal Date', 'date', false, '', 'cal'],
        ]],
        'wifi' => ['Wireless Router', 'Development & IT', 'medium', false, 'ssid', 'password', false, 'SSID, Wi-Fi & router admin', [
            ['ssid', 'Network Name (SSID)', 'text', true, 'e.g. Inorbvict-Office', 'wifi'],
            ['security', 'Security', 'select', true, 'WPA3|WPA2|WPA2/WPA3|WEP|Open', 'shield'],
            ['password', 'Wi-Fi Password', 'password', true, 'Enter or generate', 'lock'],
            ['admin', 'Router Admin URL', 'url', false, 'http://192.168.0.1', 'link'],
            ['apass', 'Router Admin Password', 'password', false, 'Optional', 'lock', ['span' => 2]],
        ]],
        'identity' => ['Identity', 'Identity & Documents', 'medium', false, 'fullname', null, false, 'Name, DOB & contact details', [
            ['fullname', 'Full Name', 'text', true, 'As on official documents', 'user'],
            ['dob', 'Date of Birth', 'date', false, '', 'cal'],
            ['phone', 'Phone', 'tel', false, '+91 98xxx xxxxx', 'phone'],
            ['email', 'Email', 'email', false, 'name@example.com', 'mail'],
            ['address', 'Address', 'text', false, 'Residential address', 'pin', ['span' => 2]],
        ]],
        'passport' => ['Passport', 'Identity & Documents', 'high', false, 'number', 'number', false, 'Number, validity & scan', [
            ['fullname', 'Name on Passport', 'text', true, 'As printed', 'user'],
            ['number', 'Passport Number', 'secret', true, 'e.g. N1234567', 'hash', ['upper' => true, 'max' => 9]],
            ['nationality', 'Nationality', 'text', false, 'e.g. Indian', 'globe'],
            ['issue', 'Date of Issue', 'date', false, '', 'cal'],
            ['expiry', 'Date of Expiry', 'date', true, '', 'cal'],
            ['file', 'Passport Scan', 'file', false, 'PDF, JPG or PNG · up to 10 MB', 'up'],
        ]],
        'driver' => ['Driver License', 'Identity & Documents', 'medium', false, 'number', 'number', false, 'Number, state & validity', [
            ['fullname', 'Name on License', 'text', true, 'As printed', 'user'],
            ['number', 'License Number', 'secret', true, 'e.g. MH12 20110012345', 'hash', ['upper' => true]],
            ['state', 'Issuing State', 'text', false, 'e.g. Maharashtra', 'pin'],
            ['expiry', 'Valid Till', 'date', true, '', 'cal'],
            ['file', 'License Scan', 'file', false, 'PDF, JPG or PNG · up to 10 MB', 'up', ['span' => 2]],
        ]],
        'govid' => ['SSN / Aadhaar / PAN', 'Identity & Documents', 'critical', false, 'name', 'number', false, 'Aadhaar, PAN or SSN number', [
            ['idtype', 'ID Type', 'select', true, 'Aadhaar|PAN|SSN|Voter ID', 'idcard'],
            ['number', 'ID Number', 'secret', true, 'ID number', 'hash', ['upper' => true]],
            ['name', 'Name on ID', 'text', true, 'As printed', 'user'],
            ['file', 'ID Scan', 'file', false, 'PDF, JPG or PNG · up to 10 MB', 'up', ['span' => 3]],
        ]],
        'document' => ['Document', 'Identity & Documents', 'medium', false, 'docno', null, false, 'Agreement or file with validity', [
            ['docno', 'Document Number', 'text', false, 'e.g. AGR-2026-014', 'hash'],
            ['issued', 'Issued By', 'text', false, 'Issuing authority / party', 'user'],
            ['expiry', 'Valid Till', 'date', false, '', 'cal'],
            ['file', 'Attachment', 'file', true, 'PDF, JPG or PNG · up to 10 MB', 'up', ['span' => 3]],
        ]],
        'note' => ['Secure Note', 'Personal & Lifestyle', 'low', false, null, 'note', false, 'Private text, encrypted', [
            ['note', 'Secure Note', 'textarea', true, 'Write the information you want to keep private…', 'note', ['span' => 3]],
        ]],
        'membership' => ['Membership', 'Personal & Lifestyle', 'low', false, 'member', 'password', false, 'Organisation & member ID', [
            ['org', 'Organisation', 'text', true, 'e.g. CII, FICCI, Club', 'ticket'],
            ['member', 'Member ID', 'text', true, 'Membership number', 'hash'],
            ['expiry', 'Valid Till', 'date', false, '', 'cal'],
            ['password', 'Portal Password', 'password', false, 'Optional', 'lock', ['span' => 3]],
        ]],
        'medical' => ['Medical Record', 'Personal & Lifestyle', 'high', false, 'patient', 'policy', false, 'Patient & record / policy no.', [
            ['patient', 'Patient Name', 'text', true, 'Full name', 'user'],
            ['provider', 'Hospital / Insurer', 'text', false, 'e.g. Apollo Hospitals', 'med'],
            ['policy', 'Record / Policy No.', 'secret', true, 'Record or policy number', 'hash'],
            ['file', 'Report / Policy File', 'file', false, 'PDF, JPG or PNG · up to 10 MB', 'up', ['span' => 3]],
        ]],
        'outdoor' => ['Outdoor License', 'Personal & Lifestyle', 'low', false, 'number', 'number', false, 'Permit type, number & validity', [
            ['ltype', 'License Type', 'text', true, 'e.g. Arms, Fishing, Trekking permit', 'tree'],
            ['number', 'License Number', 'text', true, 'License number', 'hash'],
            ['issued', 'Issued By', 'text', false, 'Issuing authority', 'shield'],
            ['expiry', 'Valid Till', 'date', true, '', 'cal'],
        ]],
    ];

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'type', 'category_group', 'name', 'scope', 'owner_id', 'department_id',
        'url', 'username', 'secret', 'secret_hash', 'fields', 'notes', 'attachments',
        'risk', 'strength', 'has_password', 'twofa', 'rotation_days', 'password_changed_at',
        'lock_admin', 'lock_manager', 'lock_otp', 'lock_admin_user_id', 'lock_manager_user_id',
        'totp_secret', 'totp_linked_at',
        'created_by', 'updated_by', 'deleted_by',
    ];

    /** Never serialised. The only way a secret leaves the server is the reveal endpoint, which logs it. */
    protected $hidden = ['secret', 'secret_hash', 'fields', 'notes', 'totp_secret'];

    protected $casts = [
        'secret'              => 'encrypted',
        'fields'              => 'encrypted:array',
        'notes'               => 'encrypted',
        'totp_secret'         => 'encrypted',
        'attachments'         => 'array',
        'strength'            => 'integer',
        'has_password'        => 'boolean',
        'rotation_days'       => 'integer',
        'lock_admin'          => 'boolean',
        'lock_manager'        => 'boolean',
        'lock_otp'            => 'boolean',
        'password_changed_at' => 'datetime',
        'totp_linked_at'      => 'datetime',
    ];

    /** Each type's tile icon — the prototype's `ico` per CRD_TYPES entry (names of its CRD_I set). */
    public const TYPE_ICONS = [
        'login' => 'globe', 'password' => 'key', 'email' => 'mail', 'passkey' => 'passkey', 'totp' => 'timer',
        'card' => 'card', 'bank' => 'bank', 'crypto' => 'btc', 'rewards' => 'gift',
        'api' => 'code', 'ssh' => 'term', 'database' => 'db', 'server' => 'server', 'cert' => 'cert', 'license' => 'license', 'wifi' => 'wifi',
        'identity' => 'idcard', 'passport' => 'passport', 'driver' => 'car', 'govid' => 'idcard', 'document' => 'doc',
        'note' => 'note', 'membership' => 'ticket', 'medical' => 'med', 'outdoor' => 'tree',
    ];

    /** Picker groups: description and icon, as the prototype's CRD_GRP_DESC / CRD_GRP_ICO. */
    public const GROUP_INFO = [
        'Logins & Access'      => ['Sign-ins, passwords, mailboxes and second factors', 'key'],
        'Finance & Banking'    => ['Cards, bank accounts, crypto wallets and rewards', 'bank'],
        'Development & IT'     => ['Keys, servers, databases, certificates and licenses', 'code'],
        'Identity & Documents' => ['Identity proofs and important documents', 'idcard'],
        'Personal & Lifestyle' => ['Private notes, memberships, health records and permits', 'user'],
    ];

    /**
     * Recovery & Proof extras per type (CRD_XT_CONTACT / CRD_XT_KEY):
     * registered email, registered phone, a recovery key. Attachments are
     * offered to every type that has no file field of its own.
     */
    private const XT_CONTACT = ['login' => 'both', 'password' => 'both', 'passkey' => 'both', 'totp' => 'both', 'email' => 'phone',
        'card' => 'both', 'bank' => 'both', 'crypto' => 'both', 'rewards' => 'both', 'membership' => 'both', 'api' => 'both',
        'license' => 'both', 'cert' => 'both', 'medical' => 'both', 'govid' => 'both'];
    private const XT_KEY = ['login', 'password', 'email', 'passkey', 'bank', 'rewards', 'membership'];

    public static function typeDef(string $type): ?array
    {
        $t = self::TYPES[$type] ?? null;
        if (!$t) return null;

        $fields = array_map(function ($f) use ($t) {
            $x = $f[6] ?? [];
            return [
                'key'         => $f[0],
                'label'       => $f[1],
                'kind'        => $f[2],
                'required'    => $f[3],
                'placeholder' => $f[2] === 'select' ? null : ($f[4] ?? ''),
                'options'     => $f[2] === 'select' ? explode('|', $f[4]) : null,
                'icon'        => $f[5] ?? null,
                'span'        => $x['span'] ?? 1,
                'max'         => $x['max'] ?? null,
                'upper'       => (bool) ($x['upper'] ?? false),
                'mono'        => (bool) ($x['mono'] ?? false),
                // Masked in every response, revealed only through /reveal.
                'secret'      => in_array($f[2], ['password', 'secret'], true) || !empty($x['secret']) || $f[0] === $t[5],
            ];
        }, $t[8]);
        $contact = self::XT_CONTACT[$type] ?? '';

        return [
            'key' => $type, 'label' => $t[0], 'icon' => self::TYPE_ICONS[$type] ?? 'lock', 'group' => $t[1], 'risk' => $t[2], 'twofa' => $t[3],
            'id' => $t[4], 'sec' => $t[5], 'is_new' => $t[6], 'description' => $t[7],
            'field_count' => count($fields),
            'extras' => [
                'reg_email'    => $contact === 'both',
                'reg_phone'    => $contact !== '',
                'recovery_key' => in_array($type, self::XT_KEY, true),
                'attachments'  => !collect($fields)->contains('kind', 'file'),
            ],
            'fields' => $fields,
        ];
    }

    /** Whether the type's main secret is a password (rotation and strength apply to it). */
    public static function secretIsPassword(string $type): bool
    {
        $def = self::typeDef($type);
        if (!$def || !$def['sec']) return false;
        foreach ($def['fields'] as $f) {
            if ($f['key'] === $def['sec']) return $f['kind'] === 'password';
        }
        return false;
    }

    /** The type has a 2FA switch — in the Security section (twofa) or as a toggle field (password). */
    public static function hasTwofaSwitch(string $type): bool
    {
        $def = self::typeDef($type);
        return $def && ($def['twofa'] || collect($def['fields'])->contains(fn ($f) => $f['key'] === 'twofa' && $f['kind'] === 'toggle'));
    }

    /**
     * The prototype's meter, so the server and the form agree on a score.
     * A point each for length ≥8, length ≥12, mixed case, a digit, a symbol;
     * under 8 characters is always Weak.
     */
    public static function strengthOf(?string $pw): int
    {
        $pw = (string) $pw;
        if ($pw === '') return 0;
        if (mb_strlen($pw) < 8) return 1;

        $s = 1 + (mb_strlen($pw) >= 12 ? 1 : 0)
            + (preg_match('/[a-z]/', $pw) && preg_match('/[A-Z]/', $pw) ? 1 : 0)
            + (preg_match('/\d/', $pw) ? 1 : 0)
            + (preg_match('/[^A-Za-z0-9]/', $pw) ? 1 : 0);

        return match (true) { $s <= 2 => 1, $s === 3 => 2, $s === 4 => 3, default => 4 };
    }

    /** HMAC under the app key: equal secrets match, the hash alone reveals nothing. */
    public static function hashSecret(?string $secret): ?string
    {
        if ($secret === null || $secret === '') return null;
        return hash_hmac('sha256', $secret, (string) config('app.key'));
    }

    /**
     * The unlock steps in force, in their fixed order — the credential's own
     * switches, each gated by the tenant policy, as the prototype's cpLock().
     * The admin and manager steps exist only on a critical credential; the
     * authenticator step is the policy's cp_otp on a critical one, and the
     * credential's own 2FA lock on any other.
     *
     * @return string[] subset of ['admin', 'manager', 'otp']
     */
    public function lockSteps(): array
    {
        $p = Policy::for((int) $this->client_id);
        $critical = $this->risk === 'critical';

        return array_keys(array_filter([
            'admin'   => $critical && $p['cp_admin'] && $this->lock_admin,
            'manager' => $critical && $p['cp_manager'] && $this->lock_manager,
            'otp'     => $this->lock_otp && (!$critical || $p['cp_otp']),
        ]));
    }

    /** Whether any unlock step guards this credential right now. */
    public function isProtected(): bool
    {
        return $this->lockSteps() !== [];
    }

    /** The critical-vault display id, CCRD-0012 for CRD-0012 — stable, unlike the prototype's position count. */
    public function criticalCode(): ?string
    {
        return $this->risk === 'critical' && $this->code ? 'C' . $this->code : null;
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }

    public function shares(): HasMany
    {
        return $this->hasMany(CredentialShare::class, 'credential_id');
    }

    public function accessRequests(): HasMany
    {
        return $this->hasMany(AccessRequest::class, 'credential_id');
    }
}

<?php

namespace App\Http\Controllers\Api\CredVault\CriticalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Services\CredVault\EmailOtp;
use App\Services\CredVault\Totp;
use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Output\QRMarkupSVG;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use Illuminate\Http\Request;

class TwoStepController extends CredVaultController
{
    public function googleNew(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'label'         => ['nullable', 'string', 'max:100'],
            'credential_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $secret = Totp::newSecret();

        $credential = !empty($d['credential_id'])
            ? \App\Models\CredVault\Credential::where('client_id', $u->client_id)->find($d['credential_id'], ['id', 'code', 'name'])
            : null;
        $label = $d['label'] ?? ($credential ? trim("{$credential->code} · {$credential->name}") : 'CredVault');
        $uri   = Totp::uri($secret, $label);

        return response()->json(['status' => true, 'data' => [
            'method'          => 'google',
            'credential_id'   => $credential?->id ?? ($d['credential_id'] ?? null),
            'credential_code' => $credential?->code,
            'label'           => $label,
            'secret'          => $secret,
            'secret_display'  => trim(chunk_split($secret, 4, ' ')),
            'otpauth_uri'     => $uri,
            'qr_image'        => (new QRCode(new QROptions([
                'outputInterface' => QRMarkupSVG::class,
                'outputBase64'    => true,
                'eccLevel'        => EccLevel::M,
                'quietzoneSize'   => 2,
            ])))->render($uri),
            'digits'          => 6,
            'period'          => 30,
            'works_with'      => 'Google Authenticator, Microsoft Authenticator, Authy and any TOTP app',
        ]], 200);
    }

    public function googleVerify(Request $request)
    {
        $this->tenantUser($request);
        $d = $request->validate([
            'secret' => ['required', 'string', 'regex:/^[A-Z2-7]{16,128}$/'],
            'code'   => ['required', 'regex:/^\d{6}$/'],
        ], [
            'secret.regex' => 'The setup key is not valid — get a new one and scan it again.',
            'code.regex'   => 'Enter the 6-digit code shown in your authenticator app.',
        ]);
        if (!Totp::verify($d['secret'], $d['code'])) {
            $this->reject('That code is incorrect or expired. Check your app and try again.', 'code');
        }

        return response()->json(['status' => true, 'message' => 'Code verified — save the credential to link the app.',
            'data' => ['method' => 'google', 'verified' => true]], 200);
    }

    public function emailSend(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'email' => ['nullable', 'email:rfc', 'max:191'],
            'label' => ['nullable', 'string', 'max:150'],
        ]);
        $sent = EmailOtp::sendSetup($u, $d['email'] ?? EmailOtp::defaultInbox(), $d['label'] ?? null);

        return response()->json(['status' => true, 'message' => "Code sent to {$sent['sent_to']}.",
            'data' => ['method' => 'email'] + $sent], 200);
    }

    public function emailVerify(Request $request)
    {
        $u = $this->tenantUser($request);
        $d = $request->validate([
            'token' => ['required', 'string', 'size:40'],
            'code'  => ['required', 'regex:/^\d{6}$/'],
        ], ['code.regex' => 'Enter the 6-digit code from the email.']);
        $ok = EmailOtp::verifySetup($u, $d['token'], $d['code']);

        return response()->json(['status' => true, 'message' => 'Email verified — save the credential to link it.',
            'data' => ['method' => 'email', 'verified' => true, 'token' => $d['token'], 'email' => $ok['email'], 'sent_to' => $ok['sent_to']]], 200);
    }
}

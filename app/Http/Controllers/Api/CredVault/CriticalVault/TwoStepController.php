<?php

namespace App\Http\Controllers\Api\CredVault\CriticalVault;

use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Services\CredVault\EmailOtp;
use App\Services\CredVault\Totp;
use Illuminate\Http\Request;

/**
 * CredVault · Critical Vault 2-step setup — /api/credvault/critical-vault/two-step/*
 *
 * The form's "2-step verification" box, before the credential is saved. Two methods:
 *
 *   google  POST google/new → QR + setup key; POST google/verify checks one code
 *           from the app; the save sends totp_secret + totp_code and verifies it again.
 *   email   POST email/send mails a 6-digit code to the inbox (php@inhpl.com by
 *           default); POST email/verify checks it and returns the token the save
 *           sends as email_otp_token. The token works once, for that inbox.
 *
 * Nothing is stored on a credential here; the save stores the method only when
 * its code matched. In the Normal Vault 2-step is only a yes/no and never comes here.
 */
class TwoStepController extends CredVaultController
{
    /**
     * POST /critical-vault/two-step/google/new { label? } — a fresh authenticator
     * secret: QR (otpauth URI) and setup key. Asking again simply gives a new one.
     */
    public function googleNew(Request $request)
    {
        $this->tenantUser($request);
        $d = $request->validate(['label' => ['nullable', 'string', 'max:100']]);
        $secret = Totp::newSecret();

        return response()->json(['status' => true, 'data' => [
            'method'         => 'google',
            'secret'         => $secret,
            'secret_display' => trim(chunk_split($secret, 4, ' ')),
            'otpauth_uri'    => Totp::uri($secret, $d['label'] ?? 'CredVault'),
            'digits'         => 6,
            'period'         => 30,
            'works_with'     => 'Google Authenticator, Microsoft Authenticator, Authy and any TOTP app',
        ]], 200);
    }

    /** POST /critical-vault/two-step/google/verify { secret, code } — does the app show the right code? Stores nothing. */
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

    /**
     * POST /critical-vault/two-step/email/send { email?, label? } — mails a code.
     * email defaults to the CredVault 2-step inbox (php@inhpl.com). One send per
     * 30 s per inbox, ten an hour per person.
     */
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

    /** POST /critical-vault/two-step/email/verify { token, code } — five tries per code. */
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

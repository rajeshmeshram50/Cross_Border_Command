<?php

namespace App\Services;

use Razorpay\Api\Api;
use Razorpay\Api\Errors\SignatureVerificationError;

class RazorpayService
{
    private Api $api;

    public function __construct()
    {
        $key = config('services.razorpay.key');
        $secret = config('services.razorpay.secret');

        if (empty($key) || empty($secret)) {
            throw new \RuntimeException('Razorpay credentials are not configured. Set RAZORPAY_KEY and RAZORPAY_SECRET in .env');
        }

        $this->api = new Api($key, $secret);
    }

    public function key(): string
    {
        return config('services.razorpay.key');
    }

    /**
     * Create a Razorpay order. Amount must be in rupees; converted to paise here.
     */
    public function createOrder(float $amountRupees, string $receipt, array $notes = []): array
    {
        $order = $this->api->order->create([
            'receipt' => $receipt,
            'amount' => (int) round($amountRupees * 100),
            'currency' => 'INR',
            'payment_capture' => 1,
            'notes' => $notes,
        ]);

        return $order->toArray();
    }

    /**
     * Verify the signature returned by Razorpay checkout after successful payment.
     */
    public function verifyPaymentSignature(string $razorpayOrderId, string $razorpayPaymentId, string $razorpaySignature): bool
    {
        try {
            $this->api->utility->verifyPaymentSignature([
                'razorpay_order_id' => $razorpayOrderId,
                'razorpay_payment_id' => $razorpayPaymentId,
                'razorpay_signature' => $razorpaySignature,
            ]);
            return true;
        } catch (SignatureVerificationError $e) {
            return false;
        }
    }

    /**
     * Verify a webhook payload using the configured webhook secret.
     */
    public function verifyWebhookSignature(string $payload, string $signature): bool
    {
        $secret = config('services.razorpay.webhook_secret');
        if (empty($secret)) {
            return false;
        }

        try {
            $this->api->utility->verifyWebhookSignature($payload, $signature, $secret);
            return true;
        } catch (SignatureVerificationError $e) {
            return false;
        }
    }

    /**
     * Fetch a payment from Razorpay (used for webhook reconciliation).
     */
    public function fetchPayment(string $razorpayPaymentId): array
    {
        return $this->api->payment->fetch($razorpayPaymentId)->toArray();
    }
}

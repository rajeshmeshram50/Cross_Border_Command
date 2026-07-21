<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use App\Services\ZohoBooksService;
$s = new ZohoBooksService();
$get = new ReflectionMethod($s, 'get'); $get->setAccessible(true);
foreach ([['4. PO Payment','3981724000000089002'],['5. SPI Payment','3981724000000090002']] as [$label,$id]) {
    try {
        $r = $get->invoke($s, "vendorpayments/{$id}");
        $p = $r['vendorpayment'] ?? $r['payment'] ?? null;
        if (!$p) { echo "MISSING  {$label}\n"; continue; }
        echo "FOUND    {$label}  ref=".($p['reference_number']??'?')."  date=".($p['date']??'?')."  amount=".($p['amount']??'?')."  unused=".($p['unused_amount']??'?')."\n";
    } catch (\Throwable $e) { echo "ERROR    {$label}  ".$e->getMessage()."\n"; }
}

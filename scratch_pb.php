<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use App\Models\ClmTradeDocLibrary;
use Barryvdh\DomPDF\Facade\Pdf;

$row = ClmTradeDocLibrary::find(14);
$fill = str_repeat('test ', 60);   // ~half-page filler in a cell
$bigCell = str_repeat('test ', 300);

// Mimic: first table pushes content ~60% down, then a tall-row table starts.
$html = '<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px" border="1">'
  .'<tbody>'
  .'<tr><td style="border:1px solid #cbd5e1;padding:6px 8px">'.$fill.$fill.$fill.'</td>'
  .'<td style="border:1px solid #cbd5e1;padding:6px 8px">x</td></tr>'
  .'</tbody></table>'
  .'<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px" border="1">'
  .'<tbody>'
  .'<tr><td style="background-color:#0d9488;border:1px solid #cbd5e1;padding:6px 8px"><span style="color:#fff"><b>H1</b></span></td>'
  .'<td style="background-color:#0d9488;border:1px solid #cbd5e1;padding:6px 8px"><span style="color:#fff"><b>H2</b></span></td></tr>'
  .'<tr><td style="border:1px solid #cbd5e1;padding:6px 8px">'.$bigCell.'END1</td>'
  .'<td style="border:1px solid #cbd5e1;padding:6px 8px">y</td></tr>'
  .'</tbody></table>';

$pdf = Pdf::loadView('pdf.clm-signature-document', [
  'document'=>$row,'modelName'=>'Trade Document','processedHtml'=>$html,
  'generatedDate'=>'31/07/2026','requestId'=>'PB','signers'=>[],
  'client'=>null,'headerConfig'=>[],'footerConfig'=>[],'headerLogoBase64'=>null,
])->setPaper('a4','portrait')->setOption('isPhpEnabled', true);
$out=getenv('USERPROFILE').'\\Downloads\\PB_TEST.pdf';
file_put_contents($out, $pdf->output());
$pages=preg_match_all('/\/Type\s*\/Page[^s]/',file_get_contents($out));
echo "WROTE: $out\npages: $pages\n";

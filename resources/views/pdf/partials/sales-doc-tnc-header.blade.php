{{-- Page header for the Terms & Conditions page of a Quotation / Proforma
     Invoice PDF: logo on the left; the document title with No + Date below
     it and the barcode beside them on the right. Inherits the parent view's
     variables ($logoData, $logoFallbackHtml, $pdf_title, $doc_label_short,
     $quotation, $barcodeData, $barcodeText, $companyDetails). --}}
<table class="full-w" style="width:100%; border-collapse:collapse; margin-bottom:10px;">
    <tr>
        <td style="width:45%; vertical-align:top; padding:0;">
            @if($logoData)
                <img src="{{ $logoData }}" alt="Logo" width="200" height="80" style="width:200px; height:auto; max-width:200px; max-height:90px; display:block; object-fit:contain;">
            @else
                {!! $logoFallbackHtml !!}
            @endif
        </td>
        <td style="width:55%; vertical-align:top;">
            @if (Str::wordCount($pdf_title) > 3)
                <h4 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; font-family: Helvetica, 'DejaVu Sans', sans-serif;">{{ strtoupper($pdf_title) }}</h4>
            @else
                <h3 style="margin:0; padding:0; font-weight:bold; font-size:20px; line-height:1; color:#777777; letter-spacing:-0.3px; white-space:nowrap; font-family: Helvetica, 'DejaVu Sans', sans-serif;">{{ strtoupper($pdf_title) }}</h3>
            @endif
            <table style="width:100%; border-collapse:collapse; margin-top:5px;">
                <tr>
                    <td style="width:55%; font-size:9px; vertical-align:top;">
                        <div><strong>{{ $doc_label_short ?? 'PI' }} No :</strong> {{ $quotation->pi_number }}</div>
                        <div><strong>{{ $doc_label_short ?? 'PI' }} Date :</strong> {{ date('d/m/Y', strtotime($quotation->pi_date)) }}</div>
                    </td>
                    <td style="width:45%; text-align:right; vertical-align:top;">
                        @if(!empty($barcodeData))
                            <img src="{{ $barcodeData }}" alt="Barcode" width="130" height="30" style="width:130px; height:30px; display:block; margin-left:auto;">
                            <div style="font-size:7.5px; color:#333; text-align:center; word-break:break-all; line-height:9px; margin-top:2px; max-width:140px; margin-left:auto;">{{ $barcodeText ?? ($companyDetails->website ?? '') }}</div>
                        @endif
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
<div style="border-bottom:2px solid {{ $companyDetails->primary_color ?? '#7CB342' }}; margin-bottom:12px;"></div>

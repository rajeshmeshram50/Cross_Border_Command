    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="utf-8">
        <style>
            @php
                $__face = function (string $roboto, string $deja) {
                    $r = public_path('fonts/' . $roboto);
                    return is_file($r) ? $r : public_path('fonts/' . $deja);
                };
                $__faceReg   = $__face('RobotoCondensed-Regular.ttf',   'DejaVuSans.ttf');
                $__faceBold  = $__face('RobotoCondensed-Bold.ttf',      'DejaVuSans-Bold.ttf');
                $__faceXBold = $__face('RobotoCondensed-ExtraBold.ttf', 'DejaVuSans-Bold.ttf');
            @endphp
            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 400;
                src: url("{{ $__faceReg }}") format('truetype');
            }

            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 700;
                src: url("{{ $__faceBold }}") format('truetype');
            }

            @font-face {
                font-family: 'Roboto Condensed';
                font-weight: 800;
                src: url("{{ $__faceXBold }}") format('truetype');
            }

            @page {
                margin: 8px;
            }

            body {
                margin: 0;
                padding: 0;
                font-family: 'Roboto Condensed', 'DejaVu Sans', sans-serif;
                color: #000;
                font-size: 16px;
                border: 4px solid #000;
                border-radius: 13.3333px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            td {
                vertical-align: top;
            }

            .head td {
                padding: 17.3333px 20.8px 12px;
            }

            .head .title {
                font-size: 24px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.2px;
            }

            .head .chipcell {
                text-align: right;
                width: 42%;
            }

            .head .chip {
                display: inline-block;
                background: #000;
                color: #fff;
                font-size: 17.3333px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.3px;
                padding: 14px 32px;
                border-radius: 10.6667px;
            }

.bar {
                margin: 0.5px;
            }

            .bar td {
                background: #ebebeb;
                color: #000;
                border-left: 8px solid #000;
                font-size: 18px;
                font-weight: bold;
                letter-spacing: 0.2px;
                line-height: 1.15;
                padding: 3px 20.8px;
            }

            .grid td {
                padding: 2px 11.4667px 2px 30.1333px;
            }

            .grid .k {
                font-size: 16px;
                line-height: 1.15;
                letter-spacing: 0;
                color: #000000;
            }

            .grid .v {
                font-size: 20px;
                line-height: 1.15;
                font-weight: bold;
                letter-spacing: 0;
            }

            .grid .v--sm {
                font-size: 18px;
            }

            .grid .dt {
                font-size: 16px;
                line-height: 1.2;
                letter-spacing: 0;
                color: #000000;
            }

.qrblock td {
                padding: 1.3333px 20.8px 2px;
            }

            .qrblock .qrcell {
                text-align: left;
                padding-left: 10px;
                vertical-align: top;
            }

            .qrblock .rightcol {
                vertical-align: bottom;
                text-align: right;
                padding-left: 5.3333px;
            }

            .qrblock .codebig {
                font-size: 30px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.2px;
                text-align: right;
                white-space: nowrap;
                padding: 10.6667px 2.6667px 0 0;
            }

            .qrblock .pictos {
                width: auto;
            }

            .qrblock .picto {
                text-align: center;
                padding: 0 5.3333px;
            }

            .picto-t {
                font-size: 12px;
                line-height: 1.1;
                font-weight: bold;
                letter-spacing: 0.5333px;
                padding-top: 6.6667px;
                height: 26.6667px;
            }

            .picto-s {
                font-size: 12px;
                line-height: 1.1;
                letter-spacing: 0.4px;
                color: #3a3a3a;
                height: 22.6667px;
            }
        </style>
    </head>

    <body>
        @php
            $or = fn($v) => filled($v) ? $v : '—';
        @endphp

        <table class="head">
            <tr>
                <td class="title">TEMPORARY PUTAWAY BOX</td>
                <td class="chipcell"><span class="chip">{{ strtoupper($conditionLabel) }}</span></td>
            </tr>
        </table>

        <table class="bar">
            <tr>
                <td>BUSINESS REFERENCE</td>
            </tr>
        </table>

        <table class="grid">
            <tr>
                @foreach (['shp' => 'SHIPMENT ID', 'opp' => 'OPPORTUNITY ID', 'proc' => 'PROCUREMENT ID'] as $k => $label)
                    <td width="33%">
                        <div class="k">{{ $label }}</div>
                        <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                        <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
                    </td>
                @endforeach
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                @foreach (['pi' => 'PROFORMA INVOICE', 'po' => 'PURCHASE ORDER', 'spi' => 'SUPPLIER INVOICE'] as $k => $label)
                    <td width="33%">
                        <div class="k">{{ $label }}</div>
                        <div class="v v--sm">{{ $or($refs[$k]['code']) }}</div>
                        <div class="dt">DT: {{ $or($refs[$k]['date']) }}</div>
                    </td>
                @endforeach
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">CUSTOMER</div>
                    <div class="v v--sm">{{ $or($parties['customer']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">CONSIGNEE</div>
                    <div class="v v--sm">{{ $or($parties['consignee']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">SUPPLIER</div>
                    <div class="v v--sm">{{ $or($parties['supplier']) }}</div>
                </td>
            </tr>
        </table>

        <table class="bar">
            <tr>
                <td>BOX CONDITION &amp; PRODUCT FLAGS</td>
            </tr>
        </table>

        <table class="grid">
            <tr>
                <td width="33%">
                    <div class="k">PUTAWAY BOX ID</div>
                    <div class="v">{{ $putawayCode }}</div>
                </td>
                <td width="34%">
                    <div class="k">BOX PACKING SCENARIO</div>
                    <div class="v v--sm">{{ $scenarioLabel }}</div>
                </td>
                <td width="33%">
                    <div class="k">BOX QTY</div>
                    <div class="v">{{ $boxQty }}</div>
                </td>
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">DIMENSIONS L&times;W&times;H (CM)</div>
                    <div class="v v--sm">{{ $or($dims) }}</div>
                </td>
                <td width="34%">
                    <div class="k">NET WT. / GROSS WT.</div>
                    <div class="v v--sm">{{ $or($netWeight) }} / {{ $or($grossWeight) }}</div>
                </td>
                <td width="33%">
                    <div class="k">BOX CONDITION</div>
                    <div class="v v--sm">{{ $conditionLabel }}</div>
                </td>
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">COLD CHAIN</div>
                    <div class="v v--sm">{{ $coldChain }}</div>
                </td>
                <td width="34%">
                    <div class="k">HAZARDOUS</div>
                    <div class="v v--sm">{{ $hazardLabel }}</div>
                </td>
                <td width="33%">
                    <div class="k">STACKING</div>
                    <div class="v v--sm">{{ $flags['stacking'] }}</div>
                </td>
            </tr>
        </table>

        <table class="bar">
            <tr>
                <td>BOX LOCATION DETAILS</td>
            </tr>
        </table>

        <table class="grid">
            <tr>
                <td width="33%">
                    <div class="k">WAREHOUSE (ID / NAME)</div>
                    <div class="v v--sm">{{ $or($place['warehouse']) }} / {{ $or($place['whName']) }}</div>
                </td>
                <td width="34%">
                    <div class="k">PUTAWAY LOCATION</div>
                    <div class="v v--sm">{{ $or($place['path']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">ALLOCATED DATE</div>
                    <div class="v v--sm">{{ $or($place['allocatedOn']) }}</div>
                </td>
            </tr>
        </table>

        <table class="grid grid--rule">
            <tr>
                <td width="33%">
                    <div class="k">WH TYPE</div>
                    <div class="v v--sm">{{ $or($place['whType']) }}</div>
                </td>
                <td width="34%">
                    <div class="k">ZONE</div>
                    <div class="v v--sm">{{ $or($place['zone']) }}</div>
                </td>
                <td width="33%">
                    <div class="k">RACK</div>
                    <div class="v v--sm">{{ $or($place['rack']) }}</div>
                </td>
            </tr>
        </table>

        @php
            $rightCol = match (count($pictos)) {
                0 => '200px',
                1, 2 => '253.3333px',
                default => '150px',
            };
            $qrSize = match (count($pictos)) {
                0 => 390,
                1, 2 => 384,
                default => 365,
            };
            $pictoRows = array_chunk($pictos, count($pictos) > 2 ? 2 : max(1, count($pictos)));
        @endphp
        <table class="qrblock">
            <tr>
                <td class="qrcell">
                    @if ($qr)
                        <img src="{{ $qr }}" alt="{{ $box->box_code }}" width="{{ $qrSize }}" height="{{ $qrSize }}">
                    @endif
                </td>
                <td class="rightcol" width="{{ $rightCol }}">
                    @if (count($pictos))
                        <table class="pictos" align="right">
                            @foreach ($pictoRows as $row)
                                <tr>
                                    @foreach ($row as $p)
                                        <td class="picto">
                                            <img src="{{ $p['svg'] }}" alt="{{ $p['title'] }}" width="68" height="68">
                                            <div class="picto-t">{{ $p['title'] }}</div>
                                        </td>
                                    @endforeach
                                </tr>
                            @endforeach
                        </table>
                    @endif
                    <div class="codebig">{{ $putawayCode }}</div>
                </td>
            </tr>
        </table>

    </body>

    </html>
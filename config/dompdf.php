<?php

return [
    'show_warnings' => false,

    'public_path' => null,

    'convert_entities' => true,

    'options' => [
        'font_dir' => storage_path('fonts/'),
        'font_cache' => storage_path('fonts/'),
        'temp_dir' => sys_get_temp_dir(),
        'chroot' => realpath(base_path()),
        'allowed_protocols' => [
            'data://' => ['rules' => []],
            'file://' => ['rules' => []],
            'http://' => ['rules' => []],
            'https://' => ['rules' => []],
        ],
        'artifactPathValidation' => null,
        'log_output_file' => null,
        /*
         * Embed only the glyphs a document actually uses, not the whole
         * font file. (#4)
         *
         * This was the package default, and it made every generated PDF
         * carry a complete copy of each DejaVu face it touched. A live
         * template preview of two paragraphs came out at 911 KB, of which
         * ~880 KB was font: the browser had to download that and pdf.js had
         * to parse it before anything appeared, on every debounced keystroke.
         * With subsetting the same preview is 49 KB — 18x smaller.
         *
         * Safe for the base-14 families (Helvetica, Times, Courier) because
         * those are never embedded at all; it only affects the DejaVu faces
         * the PDF blades fall back to for Unicode. Verified that the subset
         * still carries the non-ASCII glyphs those templates use.
         */
        'enable_font_subsetting' => true,
        'pdf_backend' => 'CPDF',
        'default_media_type' => 'screen',
        'default_paper_size' => 'a4',
        'default_paper_orientation' => 'portrait',
        'default_font' => 'serif',
        'dpi' => 96,
        'enable_php' => false,
        'enable_javascript' => true,
        'enable_remote' => true,
        'allowed_remote_hosts' => null,
        /*
         * Socket timeout for the remote fetches 'enable_remote' permits.
         *
         * Unset, dompdf falls back to php's default_socket_timeout (60s) PER
         * remote asset. One <img> pointing at a slow or unreachable host --
         * an off-site logo, an image pasted into a template from the web --
         * therefore stalled the whole render for up to a minute, which is the
         * live PDF preview sitting on "Rendering preview...". Five seconds is
         * far longer than any asset we legitimately fetch needs, and a miss
         * now degrades to a missing image instead of a hung request.
         */
        'http_context' => [
            'http' => ['timeout' => 5, 'follow_location' => false],
        ],
        'font_height_ratio' => 1.1,
        'enable_html5_parser' => true,
    ],
];

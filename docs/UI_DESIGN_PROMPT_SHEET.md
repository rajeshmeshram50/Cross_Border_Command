# Cross_Border_Command — UI Design Structure & Prompt Sheet

> Built from a full read of the React frontend (`resources/js`). It covers the app shell, shared components, and all modules: Masters, Sales Matrix, P2P/SPI, Inventory, HRMS, Payroll, CLM, auth and public pages.
> **Colour is deliberately left out.** The sheet describes structure, layout, sizes, states and behaviour only. Use it as a prompt (Part A) or as a reference spec (Parts B–F).
> Surveyed 2026-10-26.

---

## PART A — Master prompt (copy-paste)

```
You are designing/building a screen for "Cross_Border_Command", a multi-tenant
export/import ERP (React 19 + TypeScript, reactstrap/Bootstrap 5 grid, Tailwind
utilities, Remix Icon set, Recharts, TipTap). Follow this design structure
exactly. Do NOT invent colours — use the existing theme tokens only.

GLOBAL FEEL
- Dense, professional enterprise UI. Base font DM Sans 13px, line-height 1.5,
  slight negative tracking; monospace (DM Mono) for IDs and codes.
- 8px spacing rhythm (page padding 8, section gap 8, row gutters 8).
- Radius scale: 8 chips/small buttons · 10–12 inputs/icon tiles/action buttons
  · 16 cards/tables/toasts · 18 popovers/mega-menus · 22 confirm dialogs
  · 999 pills.
- Soft layered shadows, no hard borders on cards. Icons always sit inside a
  rounded square "icon tile" (30–46px, radius 8–12).
- Type scale: 9.5px uppercase table headers · 10.5px badges/KPI labels ·
  11.5px table cells/subtitles · 12.5px tabs/inputs · 13px body/buttons ·
  15px modal titles · 18px/800 page titles · 24px/700 KPI values.

EVERY PAGE = this vertical stack
1. Header strip card: left accent bar · 46px icon tile · title (18/800) +
   one-line subtitle · optional inline meta pills · actions on the right as
   42px pill buttons (primary action last, Export outlined, Back pill far right).
2. Optional collapsible "What We Are Doing Here" brief: a row of 3–5 numbered
   step cards (icon, "Step 01", title, one-line description).
3. Optional KPI row: 4–6 equal tiles (uppercase label, big number with
   count-up animation, sub-text, icon tile on the right, accent rail on the left).
4. Main content card (usually the DataTable).

LIST PAGES use the DataTable pattern:
- Toolbar: segmented tab rail (icon + label + count chip) · search (left icon,
  clear ×, 300ms debounce) · Filter button with active-count badge ·
  toolbar actions on the right.
- Removable filter-chip bar under the toolbar ("Filters: key: value × … Clear all").
- Sticky uppercase header, sortable columns, Sr No serial column first,
  zebra rows, single-line cells with ellipsis + tooltip only when clipped.
- ID cells = monospace chip (+ date underneath). Status = pill with leading dot.
  Money right-aligned. Progress cells = % + bar + "paid · due" meta.
- Actions column, centred: icon-only 30px square buttons, each with a tooltip;
  disabled actions stay visible with a reason tooltip (never hidden).
- Footer pager: "Showing x–y of N" left; rows-per-page (10/25/50), "n / N",
  ‹ › on the right.
- Loading = shimmer rows. Empty = icon + a sentence saying WHY it is empty
  (+ "clear filters" link if filtered).
- Table fits the viewport; rows auto-fit; below 768px rows collapse to
  label/value cards.

FORMS
- Label above input; required = asterisk in label; footer note
  "Fields marked with * are required".
- Field grid: 3-up by default, 2-up for paired fields, full width for textarea.
- Sections: card with icon + UPPERCASE title + subtitle, then the grid.
- Searchable custom dropdown for every select (option badges, deselect,
  infinite scroll); custom date/time pickers; file field shows saved/staged
  filename with Replace / View / Remove inline.
- Errors: inline under the field with a warning icon; on submit, scroll to the
  first error and show a toast "N fields need attention". Server 422
  {errors:{field:[msg]}} maps to the same inline errors.
- Auto-generated codes show an "AUTO" tag; locked fields show "LOCKED".

MODALS & WIZARDS
- Modal: header (icon tile, title, subtitle, close) · scrolling body ·
  footer (note left; secondary + primary right). Static backdrop: no
  outside-click close. Size by field count (≤4 → narrow 1-col,
  5–9 → large 2-col, 10+ → XL 3-col).
- While saving: disable the whole form and show a veil + spinner;
  the primary button shows a spinner + "Saving…" and keeps its width.
- Wizard: stepper of step cards ("Step 01", big numeral, title, subtitle,
  state badge Active/Done/Pending, connectors; locked future steps with a
  tooltip "Complete the current stage to unlock"). A collapsible
  "What you did in previous stages" recap. Footer: ← Previous · Save & Next →
  · final "Submit/Update X".
- Confirm dialog: 380px centred card, 56px round icon, title, message,
  Cancel + action; danger/warning/info variants; async confirm shows busy state.
- Toasts: top-right, 380px, title + one sentence, auto-dismiss 4s, de-duplicated.

Now build: <DESCRIBE THE SCREEN — e.g. "a Warehouse Transfer list page with tabs
All / In Transit / Received, columns …, row actions View/Edit/Cancel, and an
Add Transfer 2-step wizard">.
```

---

## PART B — Design tokens (structure only)

| Token | Value |
|---|---|
| Font body | DM Sans, 13px, lh 1.5, letter-spacing −0.02em |
| Font mono | DM Mono (IDs, codes, numerals) |
| Weights | 400 · 500 · 600 · 700 · 800 |
| Type scale | 8–9.5 (menu/table headers, uppercase, wide tracking) · 10–10.5 (badges, KPI labels) · 11.5 (cells, sub-links, subtitles) · 12–12.5 (tabs, nav, inputs) · 13 (body, buttons) · 15 (modal title) · 17–18 (page title, 800) · 19 (drawer title) · 24 (KPI value) · 26 (error page title) |
| Spacing | 8px base; card padding 12–18; table cell 7×9; modal body 20; header group gap 12 |
| Radius | 7–9 chip/small btn · 10–12 input/icon tile/action btn · 16 card · 18 popover · 22 dialog · 999 pill |
| Control heights | inputs 38–40 · tabs 34 · filter btn 37 · nav btn 36 · strip buttons 42 · back btn 44 |
| Shell heights | Horizontal header 110 (2 rows) · vertical topbar 70 · footer 40 (auto-hide) |
| Sidebar widths | 250 full · 180 compact · 70 icon rail · two-column = 70 rail + 220 panel |
| Breakpoints | sm 576 · md 768 · lg 992 · xl 1200 · xxl 1400 (plus header steps at 1280 / 1024 / 640 / 380) |
| Motion | dropdowns .18–.24s cubic-bezier(.22,1,.36,1); spring "pop"; respects prefers-reduced-motion |
| Shadows | soft layered (inset top highlight + 0 8px 28px + 0 2px 8px); popovers 0 12–24px 34–70px |
| Icons | Remix Icon (primary, `ri-*`); lucide only inside some legacy Tailwind components |

---

## PART C — App shell

### C1. Layout modes (user-switchable in the Theme Customizer)
- **Horizontal (default):** a sticky two-row header, then one scrolling `.main-content`, then the footer.
- **Vertical:** topbar plus a left sidebar (250 / 180 / 70 / hover).
- **Two-column:** a 70px icon rail plus a 220px sub-menu panel.
- **Semibox:** a boxed variant.
- Other options: fluid or boxed width (1300px), fixed or scrollable position, light or dark mode, a Brand/Default tenant-theme toggle, and 11 variant presets.

### C2. Horizontal header (110px)
- **Row 1, left to right:**
  1. Tenant logo (52px), then a divider.
  2. Module search: 440×40, with a ⌘K hint and a clear button. The results dropdown shows at most 12 results.
  3. Right cluster:
     - Brand/Default toggle.
     - 36px icon buttons: network stop/resume, dark mode, fullscreen, Clock-in (employees) or Gmail (others), notifications bell with a count badge, logout.
     - Separator, then a 42px avatar with a ring and an online dot.
- **Row 2:** module nav buttons, 36px tall, icon + label, with an animated underline for hover, open and current states.
  - Overflow goes into a **"More"** menu, sized with a ResizeObserver.
- **Mega-menu:** a centred fixed panel up to 1060px wide (1320 for P2P, 1480 for HR/CLM), radius 18, inner scroll.
  - Columns are separated by hairlines. Section labels are 8px uppercase.
  - Each leaf is an icon tile + title + 10px description. The first column uses large tiles; the rest use small ones.
  - **Locked leaves stay visible:** dimmed, with a lock glyph.
  - A blurred backdrop sits behind the menu, and the page scroll is locked while it is open.
- **Profile panel:** 290px wide, radius 18. It shows the identity header (avatar, name, role badge, branch line), then menu rows with 34px icon tiles: Profile, My Team, Settings, Documentation, Theme Customizer, Logout.
- **Responsive:**
  - At ≤1280 the search narrows to 300px.
  - At ≤1024 there is a single bar plus a hamburger that opens an accordion panel (module › group › leaf).
  - At ≤640 search, brand toggle and fullscreen are hidden.

### C3. Sidebar (vertical mode)
- **Order:** brand box, then a scroll area, then section titles (MANAGEMENT / OPERATIONS / BILLING).
- **Levels:** module, then group, then leaf.
  - Top-level icon chips are 30×30.
  - Leaf tiles have a 30px icon and an 11.5px/600 title. A description is shown only in two-column mode.
- **Open/close:**
  - Only one top-level module is open at a time; sibling groups are also mutually exclusive.
  - Clicking outside closes everything.
  - Module triggers only toggle; they do not navigate.
- **Active state** is matched by path prefix.
- **Responsive:** forced to the icon rail between 768 and 1024px; an off-canvas drawer with an overlay below 768px.

### C4. Footer
40px tall. It auto-hides and slides in on scroll or when the pointer is within 28px of the bottom. It has two columns: copyright and credit.

### C5. Routing and guards (UX consequences)
- **Public routes:** onboarding token form, scan landing, handheld putaway scan.
- **Auth routes** use a split-screen card layout.
- **Plan expired:**
  - Branch users and employees go to `/plan-blocked`.
  - Client admins go to `/my-plan`.
- **Denied route:** an **Access Denied** page *inside* the shell (104px circle icon, 26px title, button).
- **Lazy pages:** each page has a shimmer route fallback. After login a 2.4s splash loader plays.
- **Per-action permissions** (view/add/edit/delete/export/import/approve):
  - Buttons stay visible but disabled, with a reason tooltip.
  - `guard()` raises a toast when a denied action is attempted.

---

## PART D — Component library (build/reuse these)

| # | Component | Structure / behaviour |
|---|---|---|
| 1 | **Header Strip** (`.frm-cstrip`) | Min-height 70, padding 12×18, radius 16. Left: 4px accent bar, then a 46px icon tile (22px glyph). Title 18/800 + subtitle 12/400 + optional meta pills. Right: 42px pill buttons. Back pill 44px. Compact variant: 52px with a 38px icon. |
| 2 | **Brief Box** ("What We Are Doing Here") | Collapsible with a chevron. Header: icon, label, separator, title, sub. Body: a horizontal row of 3–5 step cards (icon, "Step 01", title, one-line description). |
| 3 | **KPI Tile** | Equal-width row (`g-1`/`g-2`). Left accent rail, uppercase 10.5px label, 24/700 value (count-up), optional trend chip (arrow + delta) and sub-text, 36–38px icon tile on the right. Hover: lift + shine sweep. |
| 4 | **DataTable** | See Part A list rules. Props: tabs, search (can be portalled into a card header), filter button + chips, toolbar slots, serial, leading checkbox column, server pagination, fit-to-viewport, auto-fit rows, row click, empty message, `belowRows`. Cell helpers: TruncCell, ChipCell, IdCell, PillCell, ActionCell. |
| 5 | **Segmented Tab Rail** | Rail radius 11, padding 3. Tab 34px, radius 8, 12.5/700, icon + label + count bubble. Sub-tab row allowed under it. |
| 6 | **Filter UI** | Standard: a Filter button that opens a **two-pane filter modal** (facet list on the left, options on the right), plus a removable chip bar. Alternatives in use: popover (Suppliers), right drawer (Products). |
| 7 | **Bulk-action bar** | Appears when rows are checked: "N selected" badge, divider, primary bulk action, secondary actions, Clear. |
| 8 | **Worklist Pager** | "Showing x–y of N" · rows-per-page dropdown (opens upward) · "n / N" · ‹ ›. Hides navigation when there is a single page. |
| 9 | **MasterSelect** | Searchable dropdown. Options have label, full label, badges, disabled + reason. Supports deselect, infinite scroll, loading, invalid state. Multi variant: chip field (min-height 38), 320px menu. |
| 10 | **Date / Time pickers** | Custom portal popups. Support min/max and future-only. Opening one closes the others. Time picker has a minute step and a "Now" button. |
| 11 | **File field** | Hidden native input. Shows the saved/staged filename + Replace / View / Download / Cancel on one line. Hint "accept · Max N MB". Dropzone variant for receipts/CVs that turns into a file card. Camera "Take photo" option on mobile flows. |
| 12 | **Inline Sublist** | Repeatable child records shown as cards. Editing opens an **inline editor panel below** the cards, never a modal-on-modal. |
| 13 | **Form Section** | Card head: icon + UPPERCASE title + subtitle; then a field grid. Alternative: lettered section badge A/B/C for long full-page forms. |
| 14 | **Field** | Label on top, `*` when required. Input with an optional leading icon. Error under the input with a warning icon. Tags: AUTO, LOCKED, MANDATORY/OPTIONAL. A "+" next to the label quick-adds a master record. |
| 15 | **Modal** | Header band (icon tile, title, subtitle, round ✕ — omitted for simple masters and confirms). Scroll body. Sticky footer. Static backdrop. Busy veil while saving. Widths: 300 / 500 / 620 / 800 / 1140. |
| 16 | **Full-screen Wizard Shell** | Top card: icon, title, subtitle, **head meta pills** separated by dots (e.g. PO NUMBER · SHIPMENT ID · PI NUMBER), close. Then a step strip, collapsible sections (icon + "Label \| Title" + sub, 4-column grid), and a sticky footer ("Step n · name" on the left; Back / Save / Next on the right). A view-only banner with a lock icon when read-only. |
| 17 | **Stepper** | Step cards with "Step 0n", a big numeral, title, subtitle and a faint ghost numeral. State badges: Active (pulse dot), Done (check), Pending, Locked. Horizontal (chevron arrows on wide screens, a 3-column grid at ≤1200) or a **vertical side rail** with a % per stage plus an overall % bar (onboarding, exit). |
| 18 | **Previous-stage recap** | Collapsible "What you did in previous stages": read-only label/value grids per completed step. |
| 19 | **Confirm dialog** | 380px card, 56px round icon, centred title + message, Cancel + action button. Variants danger / warning / info / success. Async busy label. Reject flows require a comment. |
| 20 | **Delete confirm** | 360px. Item name cut at 40 chars, sub-message. No ✕ — Cancel is the only exit. Button reads "Deleting…" while working. |
| 21 | **Toast** | Top-right, 380px wide, radius 16, 6px side rail, 36px icon tile, title + message, 4s auto-dismiss, de-duplicated. |
| 22 | **Shimmer skeletons** | One preset per layout: table rows, form, cards, stat cards, chart, hero, profile, settings, permissions, dashboard. Card radius 16. Use these instead of spinners. |
| 23 | **Busy Overlay** | A veil + spinner over a pane while it reloads, so the content does not jump. |
| 24 | **Tooltip** | Themed pill tooltip. **All** native `title` attributes are redrawn as this tooltip. Shown on truncated text only when the text is actually clipped. |
| 25 | **Badge / Pill / Status** | Pill radius 999, 10.5/700, optional dot or icon. Soft and outline appearances. Status vocab examples: Draft · Submitted · Pending · Approved · Rejected · Sent · Signed · Declined · Recalled · Expired. |
| 26 | **ID / Code chip** | Monospace chip. In tables, shown as an ID chip with the date underneath. |
| 27 | **Progress cell / bar** | % label + bar + "paid · due" meta. Segmented 3-part bar with a legend for multi-state progress. |
| 28 | **Ring / Donut / Gauge** | Conic ring with the % in the centre (profile, onboarding completion). Mini donut gauge for dashboards. 140px donut for leave balances. |
| 29 | **Timeline (vertical)** | Dot/icon column + connector line. Each card: title, description, by/date, state pill, attachments. Used for activity, signing and agreement history. |
| 30 | **Timeline (horizontal)** | Icon nodes joined by lines, each with a title and date. An "Overall progress" bar below. Punch timeline: 44px circles with time, label, method and a map pill. |
| 31 | **Approval chain** | Horizontal row of equal cards (number or check/✕ circle, role, name, date). The current level gets a thick ring, with a "Currently waiting on level N" caption. |
| 32 | **Drawer** | Right slide-over, 420px (max 92vw). Head (title, switch, ✕), underline tabs, a list grouped by Today / Yesterday / date, an empty state, a footer link. |
| 33 | **Evidence Vault** | Tabbed document repository (e.g. DD / KYC / Trade Licence / Trade Docs). Table of docs with View / Download / status chips. Preview lightbox: top bar (filename, open-in-new-tab, download, close) + iframe. |
| 34 | **PDF / signature placement** | Two columns: a pdf.js canvas preview (one page at a time) with a draggable, resizable "Sign here" box, and a 320px right rail (page select, X/Y nudge, W/H, reset, signer card, expiry days, notes). Send veil while sending. |
| 35 | **Rich-text editor workspace** | Toolbar groups: block/size · B I U S sup sub · highlight · align · lists/indent · link/HR/slots · undo/redo/clear. Placeholder sidebar (240px: search, collapsible groups, `{{token}}` pills — click to insert, icon to copy) **or** a 2-pane placeholder modal. Page shell with header/footer zones in A4 view. Optional live PDF preview to the side. Full-screen mode. Web/Word mode switch. |
| 36 | **Line-item grid editor** | Committed rows render as plain text with a trash icon. The **last row is an input row** (product select, qty, rate, computed cells, "+ Add"). Tax columns change with the case (international: Tax% / Tax amt; intra-state: CGST + SGST; inter-state: IGST). Totals footer two-up: Terms textarea with a counter on the left; Summary box (Sub Total, taxes, editable shipping, GRAND TOTAL row) on the right. |
| 37 | **Permission matrix** | Tree of modules (34% column) · tri-state "All" checkbox · 7 rights columns (View, Add, Edit, Delete, Export, Import, Approve) with icon headers · Select/Deselect All · expand/collapse · granted counter. Locked cells carry a reason ("Required by N modules", plan-gated). Any right auto-ticks View. |
| 38 | **Calendar month grid** | Header ‹ Month Year ›. A row of status KPI tiles that doubles as the legend. Weekday header, 7-column grid of day cells (day number + status pill; split cell for half-day). Click a day to open a portalled details panel with an action. |
| 39 | **OTP input** | 6 separate boxes (52×56) with auto-advance and paste support. Resend countdown, then a Resend link. |
| 40 | **Password strength** | Strength bar + label, plus a live checklist: 8+ characters, uppercase, lowercase, number. |
| 41 | **Coming-soon / Stub** | Single card: icon tile, crumb (group name), title, "Coming soon" pill with a dot, paragraph, bullet list. |
| 42 | **QR / Sticker modal** | Centred QR, ID, name, address, note. Footer: Close + Print/Download. Sticker face: strip of IDs, product name, QR row. Print sheet hides chrome with a no-print class. |

---

## PART E — Page archetypes (pick one per new screen)

### E1. Master list (generic CRUD)
- **Stack:** Header strip, then an optional KPI row, then a DataTable.
- **Columns:** the first column is bold and cut at 20 chars, followed by an ownership group (Client · Branch badge · Created By pill), then Created Date (DD-Mon-YYYY), then Actions (View / Edit / Delete / Audit History).
- **Add {Singular}:** a pill, the last item at the right of the toolbar. When the master is locked it shows a lock icon and a reason tooltip.
- **Add/Edit/View:** one shared modal; its size depends on the number of fields. Sections are uppercase titles with rules.
- **No view permission:** a centred Access Denied card.
- **Driven by config:** field `name/label/type/required/options/ref/cascadeFrom/section/autogen/accept/maxMb/showWhen/min/max/pattern`.

### E2. Party master (Customer / Consignee / Supplier)
- **List page:**
  - Header strip with Add.
  - Brief box.
  - Tabs: All / Fresh / Recurring, or Domestic / International.
  - Filter (two-pane modal) with a chip bar, then the table.
  - Row actions: Edit · Map related · Evidence Vault.
- **Add flow:** optional scope gate first (Domestic / International), then a **full-screen wizard**:
  - **Stepper:** 2 stages, Legal Identity then KYC / Due Diligence.
  - **Stage 1 sub-tabs:** Identification, then Address & Contact. The second tab is blocked until the first one validates.
  - **Stage 2 sub-tabs:** Company DD · Owner KYC · Trade Licence. Each tab is a card with search, a count, a table and an Add sub-modal.
  - **Footer:** required note · Previous · Save & Next · Submit.
  - **Saving:** each Save & Next persists the stage. On a 422 the wizard jumps to the stage and field that failed.

### E3. Product master
- **Toolbar:** status tabs with counts, search, and Filter, which opens a **right drawer**. A chip strip with group labels sits underneath.
- **Views:** a **Grid / List toggle** (product cards or rows). The empty state has an illustration and a call to action.
- **Detail (hero, then gallery and tiles, then tabs):**
  - Hero: "code | name" with Edit, Mapped Suppliers and Back.
  - Below it, two columns: image gallery + status chip on one side, highlight tiles (HSN, Segment, Hazard, UOM, Condition, Packaging) on the other.
  - Tabs: Description / Specs / Confidential / QC / Suppliers.

### E4. Full-page form (Client / Branch / Plan / Settings)
- **Form layout:** Header strip with Back, then lettered sections (A, B, C…) in a `Row g-2` grid (3-up by default), then a sticky footer: Cancel · Create/Update X.
- **Preview variant (Plan):** form on 8 columns, live preview on 4.
- **Settings:**
  - The left column (3/12) is a category list of icon + label + description cards, with an arrow on the active one.
  - The right column (9/12) is a tab pane. Each section header has its own Save Changes button.
  - Toggle rows: icon, label, description, switch.

### E5. Detail / profile (full-screen overlay)
- **Hero:**
  - Square avatar.
  - Name, code + role pills + status dot, meta cells (icon, label, value).
  - Completion rings on the right.
  - ✕ to close.
- **Tab bar:** tabs with icon chips, sitting inside the bottom edge of the hero.
- **Content pane:**
  - Section cards hold label/value grids (4-up `md3`). Use side-by-side cards for pairs (e.g. Current | Permanent address).
  - The bottom row has 3 equal cards.
  - Sensitive values are masked.

### E6. Pipeline / stage workspace (Sales Matrix pattern)
1. **Context banner**
   - Left: avatar + name + entity tag.
   - Right: a meta strip of icon + uppercase label + value blocks separated by dotted dividers, then a Back button.
2. **Stepper card**
   - **Row A:** chevron stages (6), each showing done/active/idle/locked state.
   - **Row B:** a scrolling toolbar of icon+label pill buttons in groups separated by dividers. Locked buttons get a veil and raise a toast when clicked.
3. **Three-column body:** `20% | 1fr | 30%` (`18 | 1fr | 25` on medium screens).
   - **Left:** a context panel, e.g. compliance docs. Its rows show tone icon, title, "x of y documents", progress bar and %, and an open ↗ button.
   - **Centre:** a stage card that scrolls on its own.
     - Head: icon, "Stage n: Title", subtitle, status badge.
     - Body.
     - Foot: "⚠ Note" on the left; ← Previous and Save & Next → on the right.
     - When the record is locked, a veil covers the card with a badge such as "🔒 signed — read-only".
   - **Right:** a decision/task panel holding a 2-column form and a full-width Save.
   - **Both side panels** collapse to a 44px rail with a rotated label and an expand chevron.
- **Stage content patterns:** read-only striped label/value cards · status pills with a reason-picker modal (two columns: negative / positive reasons) · activity table · tabbed product tables with a progress footer and CTA · inline quoted-price input with a history view swap · document table with a split create button and a "more" popover · a celebration/won stage (hero, KPI strip, deal summary, shipment cards).

### E7. Transaction wizard (PO / SPI / Quotation / PI)
- **Shell:** the full-screen wizard shell (D16) with a 4-step strip and head meta pills.
- **Sections:** collapsible sections with 4-column grids, plus line-item grids (D36) or **grouped-header match tables**: two-tier headers with sticky left columns, e.g. a 3-way match of PI / PO / SPI quantities and costs.
- **Totals:** a charges grid (Shipping / Packaging / Other, each with a currency prefix) next to a totals box.
- **Notice modals** appear before risky actions (GST, currency, missing docs).

### E8. Operational list (PO / SPI / Payments)
- **Rows:** a row can span several invoice lines. Stacked mini document cards (SPI / GRN / QA, each with an "n of N" sequence, money and paid/due).
- **Cells:** a sync-status cell with a dot and sync button, an inspection button or done pill, a payment progress cell with Manage + count, a risk badge.
- **Row actions:** Edit · Evidence Vault · Timeline · Cancel. Terminal states replace the buttons.
- **Phone:** the table switches to a **card list** (head with ID + tags; supplier | amounts split; More).

### E9. Payment / approval detail
- **Header:** title + status badge, document sub-line, reference chips, and the actions Evidence Vault, Approve and Decline.
- **Body:**
  - Two column cards, each a key/value grid.
  - **Sticky transaction tabs:** Current | History (with count).
  - Sub-tab row, each sub-tab opening its own panel.
- **Footer:** an info line and Back.

### E10. Master-detail split (HR Attendance)
- **Header strip:** a date navigator on the right (‹ · picker capped at today · › · Today).
- **Left list (`xl3`):**
  - Filter tabs with counts and a search box.
  - Rows: avatar initials, name, "code · dept", state pills, and a status pill + time on the right.
- **Right detail (`xl9`, wrapped in BusyOverlay):**
  - Identity bar with chips, then a 3-tile KPI row.
  - Two cards (`7 | 5`): a visual hour bar + donut, and a punch timeline.
  - A full-width Log | Calendar toggle card, then an approvals queue.

### E11. Self-service capture (Clock-In)
- **Left (`lg7`):**
  - Activity label chip toggles.
  - Camera viewport (4:3, max 480, mirrored, dashed circular face guide, status overlays).
  - Full-width capture button with an "Analysing…" state.
  - A location strip with states requesting / granted / denied / timeout and a Refresh button.
- **Right (`lg5`):** a summary card (3 mini stats, then key/value rows).
- **Full width:** a horizontal punch timeline.

### E12. Approval queue / inbox
- **Top:** header strip and New | Updated tabs with counts.
- **Section cards:** stacked, one per request type (head: icon chip, title, sub, count chip).
- **Rows:** avatar, name/meta, type pill, dates, reason quote, then an inline **remark input + Approve / Reject**.
- **Decision safeguards:** decisions that need it ask for a mandatory consent checkbox; Reject requires a comment.
- **Empty state:** "You're all caught up".

### E13. Payroll run
- **Cycle strip:** a horizontal strip of month chips with ‹ ›. Each chip shows the month (lock icon if locked), date range, status pill and a micro note.
- **Below the strip:** a KPI row, then a tab rail (Processing | Inputs | Report | Setup).
- **Run modal:**
  - 3 KPI tiles (Total / Blocked / At-Risk).
  - A progress strip Found → Remaining → All clear.
  - **BLOCKING** and **WARNINGS** sections, each listing per-employee issue cards with toggles and fix links.
  - The primary action stays disabled while blockers remain.
- **Payslip viewer:**
  - Sidebar: year/month filter and a list of payslips.
  - Preview, top to bottom: company hero, identity strip, KPI strip, Earnings | Deductions tables, a Net Pay banner, footer.

### E14. Document template / contract builder
- **Step 1:** pick cards (category 3-up, role 6-up), then two columns: basic info | settings toggles.
- **Step 2:** a summary card next to a lifecycle card, then a signing workflow (signer rows with Add Signer, and a preview of the flow as chips).
- **Step 3:** the editor workspace (D35).
- **Contract workspace (alternative):** three panels.
  - Left: parties with compliance rings; collapses to a 48px rail.
  - Middle: an inner stepper plus the editor and live preview.
  - Right: a summary / approval panel with a signer tracker (avatar, name, Signed / Declined / Awaiting).

### E15. Rule matrix (DCP)
- **Above the table:** tab rail (All / Highly / Less regulated), search, and Filter with a count.
- **Matrix table:** category columns (KYC / DD / TL / QC) hold counts or ticks; an authority badges column.
- **Edit modal:**
  - A 2-tile stage strip.
  - Radio cards.
  - Category tabs over a checkbox table with requirement toggles.

### E16. Hierarchical master (Warehouse → Zone → Rack → Shelf)
- **List layout:**
  - A flat table per level, with the parent shown as a column.
  - Add modals stack parent context cards (Warehouse Details → Zone Details → Flags).
  - The child level (shelves) opens in a modal from the parent row: KPI strip, then the child table.
- **Location picker (tree form):**
  - A KPI row, then a nested accordion Zone › Rack › shelf tiles. Each shelf tile shows a radio, a capacity meter (used / this item / free) and a locked state.
  - A "System Recommended" card alongside: match ring, path chips, capacity block, parameter checks, and a "Use recommended" button.

### E17. Handheld scan screen (no app shell)
- **Layout:** a single column.
- **Top of the screen:** header (dot + code), prompt line, alerts, a pending queue, and a **focused scan input** (hardware scanner types into it, Enter submits).
- **Below the input:** an idle countdown, slot tiles (Box / Rack / Shelf), a box details grid, a products list (tap opens a bottom sheet), location info with a validity tag, and assigned-box tabs.
- **Primary action:** one big button.
- **State cards:** done, blocked and complete each have their own card.

### E18. Dashboard
- **Section pattern:**
  - A section heading row: 36px icon tile, title + subtitle, optional status pill on the right.
  - A KPI row (4 per row: `md3 / sm6 / xs6`).
  - Chart rows (`5/4/3` or `4/4/4` or `7/5`).
  - List rows (recent items, top-N with a relative bar).
- **Charts:** Recharts bar (vertical and horizontal), area, pie/donut, mini gauge. Gridlines are dashed and axis lines are off. A custom tooltip and ResponsiveContainer are used throughout.
- **Lists:** list bodies scroll inside the card, capped at about 340px.
- **Collapsing:** heavy sections can be collapsed behind "Show details".

### E19. Auth (split screen)
- **Left (≥1024px only):**
  - Wordmark, uppercase tagline, rule, a 2-line h1, a lead paragraph.
  - A **module tile grid** (icon, title, 2-line sub).
  - A footer strip of 4 keywords.
- **Right:** a glass card with logo, title and sub, the form body, and a foot tagline. The whole layout scales with a viewport unit.
- **Login:**
  - Icon-led floating-label fields, with an eye toggle on the password.
  - A row with Remember Me on the left and Forgot? on the right.
  - A full-width submit pill (shimmer while loading).
  - An "OR CONTINUE WITH" divider, then two social pills side by side (Google, Face).
  - An **organisation picker** modal when the email belongs to several tenants.
- **Forgot / OTP / Reset:** D39 and D40, plus a success modal.

### E20. Public multi-step form (onboarding link)
- **Container:** a centred 2-pane card.
- **Left rail:** brand at the top, a vertical step list (numbers/checks joined by connectors, earlier steps clickable), a footer.
- **Right pane:**
  - Welcome banner, step title and sub, a tab strip, and an "Approx time" chip.
  - **Horizontal label | input rows.**
  - Footer: progress track and "x% complete" on the left; Previous / Next / Submit on the right.

### E21. Mail client layout (Gmail-style)
- **Left rail:** Compose, then folders (icon, label, count), then an Unread-only toggle.
- **Main column:**
  - Toolbar: select-all, refresh, a bulk group when rows are selected, and a pager on the right.
  - Rows: checkbox, star, avatar, sender, "subject — snippet", category chip, date.
  - Opening a row shows the reading view in the same column.
- **Compose:** a floating dock at the bottom-right.

---

## PART F — Module blueprints (what each module needs)

| Module | Screens → archetype |
|---|---|
| **Masters** (~55) | Master Control Center: search in the header, stat cards, collapsible category groups of leaf cards (`xl3/lg4/md6`) → E1 list → modal |
| **Sales — Core masters** | Customers, Consignees → E2. Lead Ack reasons → E1 |
| **Sales — Pipeline** | Lead Worksheet = table with tabs (Qualified / Disqualified / All / Key Opportunity) + bulk bar + filter modal + Export dropdown + Sync. Matrix detail → E6 (6 stages: Inquiry · Acknowledgement · Sourcing · Price Shared · Quotation vs PI · Victory). QPI list + Quotation/PI 2-step wizard → E7 with D36. Send for signature → D34. Sign tracker → D29/D30 |
| **Sales — Productivity** | Reminders / Meetings: tabs + List/Calendar toggle + table with TODAY pill. Performance: stat/target cards + tabs (Overview / Targets / Leaderboard / Activity) |
| **P2P — Masters** | Suppliers → E2 (scope gate Domestic/International, 4-step brief). Products → E3 |
| **P2P — Purchase** | PO list → E8. Create PO → E7 (Link Supplier · Product Details · Terms · Documents). Physical inspection modal (hero + summary cards + table with proof chips, camera capture). GST approval → E9 |
| **P2P — SPI** | List → E8. Wizard → E7 (Supplier · Invoice & 3-way match · Box packaging · Putaway allocation). Box packaging: scenario cards + stat pills + selection bar + table. Putaway: "Pick a Box" grouped list next to a box-journey stepper + location picker (E16) |
| **P2P — Payments** | Payment requests → E8/E9. Advance refund: tabs + table + recovery modals |
| **P2P — Sourcing** | Bulk sourcing table with a 3-segment progress bar, clickable counts that open modals, an assign modal |
| **Inventory** | Warehouse / Zone / Rack masters + shelves modal + QR modals → E16. Scan desk: sub-nav (Put-Away / Stickers / Devices / Log). Handheld → E17. Sticker sheet print |
| **HRMS — People** | Employees list (E1-style with 5 KPI tiles; Add = 4-step wizard: Basic · Job · Work · Compensation). Profile → E5 (tabs: Profile, Job, Attendance, Evidence Vault, Payroll, Expense, Leave, Holidays, Hiring). Permissions → D37 |
| **HRMS — Time** | Clock-In → E11. HR Attendance → E10 + D38 + regularization queue. Leave: list + bulk approve + approval chain (D31) + leave balance donuts + request drawer/modal (type, dates, duration Full/First Half/Second Half/Custom, note) |
| **HRMS — Money** | Expenses: module toggle (Claims / Advances) + spend chart + table → settlement modal (hero, KPI strip, distribution table, progress, adjustments ±, payment history, recovery schedule). Claim form = 2 columns (fields \| receipt dropzone + approval-flow chain) |
| **HRMS — Lifecycle** | Recruitment (6 KPIs, status tabs, hiring requests). Candidates = tabs not kanban, forward-only stage picker. Onboarding = 6-stage vertical rail wizard (Setup · Docs · Provision · Payroll · Policies · Verify). Exit = vertical rail wizard ending in an F&F ledger + finance approval. Public onboarding → E20 |
| **Payroll** | → E13 |
| **HR Documents** | Templates list (role tabs, Version history, Deprecate) → E14 builder. Generate Document = 3-step (Select employees · Fill variables grid · Preview & generate) |
| **CLM** | Every page: CLM header + brief box + pill group + tab rail + table. Catalogues (KYC / DD / TL / QC / Segments / Authorities) = simple table + modal with an **auto-code banner**. Agreements / T&C / Trade docs = 2-step wizard (Basic · Draft content) → D35. Clause library = Types \| Library. DCP → E15. Case-to-case → E14 three-panel workspace with a 4-stage flow bar. Agreements sent = table + vertical agreement timeline. Stubs → D41 |
| **Comms** | Broadcast centre: 4 KPIs + 4-step announcement wizard (Basic · Audience · Notifications · Review). Inbox → E12. Notifications → D32. Gmail → E21 |
| **Tenancy / Billing** | Clients / Branches: header strip with Export + Add, KPI cards, DataTable, view = hero + info-card grid; forms → E4. Plans = carousel of plan cards; Add Plan = form + live preview. Users = table + pager |
| **Dashboards** | → E18 (Sales · Procurement · CLM & Compliance · Workforce sections; branch adds payment trend) |
| **Auth / Profile** | → E19. My Profile: hero, 4/8 rows of cards, branding card, permissions grid |

---

## PART G — Rules to standardise (current inconsistencies; new work should follow the left column)

| Use this (standard) | Instead of (legacy / divergent) |
|---|---|
| `components/ui/DataTable` | velzon `TableContainer`, hand-written `<table>` + pager |
| Toolbar order: tabs → search → Filter → actions | Filter-before-search (Customers) |
| Add button in the **header strip** for primary entities; in the table toolbar for masters | mixing both on one page |
| Filter button + two-pane modal + chip bar | popover / drawer / inline-select variants (only where screen space demands it) |
| `useConfirm` / `DeleteConfirmModal` | SweetAlert2 |
| One `.frm-cstrip` header strip | `.mp-/.ms-/.cl-/.br-/.pl-cstrip`, `PageHeader`, Velzon `page-title-box` breadcrumb |
| One shared `Field` component | three copied wizard `Field`s (customer / supplier / product) |
| `ActionCell` + one edit icon | local `ActionBtn`s, mixed edit icons |
| Export (xlsx) on every list where the export permission exists | export on only some lists (Masters compute the permission but never show the button) |
| A shared Stepper component | page-local steppers in each wizard |
| Shimmer skeletons | bare spinners |
| Disabled + reason tooltip | hiding actions the user can't perform |

Dead or legacy files to **ignore** as pattern sources: `pages/vendors/Vendors.tsx`, `components/ui/Modal.tsx`, `ui/Table.tsx`, `ui/Loader.tsx`, `components/StatCard.tsx`, `ui/VelzonCard.tsx`, `layouts/AppLayout.tsx` (with its Sidebar, Topbar and TopNav), `LoginLegacy.tsx`, Velzon `BreadCrumb.tsx`.

---

## PART H — Short prompt templates

**New list page**
> Build a `<Entity>` list page following the Cross_Border_Command structure. Use a header strip (icon, title "<Title>", subtitle "<one line>", actions: Export (outlined) and "+ Add <Entity>"), then a collapsible brief with steps <1..4>, then a KPI row (<metrics>), then a DataTable with tabs <A/B/C with counts>, search, a Filter button with a two-pane filter modal and a chip bar, and columns <Sr No, ID chip + date, …, Status pill, Actions (View/Edit/Delete icon buttons with tooltips)>. Include a pager, shimmer loading, and an empty state that explains why the list is empty. No new colours.

**New wizard**
> Build a full-screen `<N>`-step wizard for `<Entity>`. The top card has an icon, title, subtitle and head meta pills `<IDs>`. Add a step strip ("Step 0n", numeral, title, subtitle, Active/Done/Locked). Each step contains collapsible sections with 4-column field grids (label on top, * for required, inline errors, AUTO/LOCKED tags). Show a "What you did in previous stages" recap from step 2 onward. The sticky footer reads "Step n · name" on the left and Back / Save / Save & Next on the right, with the final step reading "Submit <Entity>". Map a 422 response to field errors and jump to the step with the first error. Disable the whole form with a veil while saving.

**New detail workspace**
> Build a `<Entity>` workspace: a context banner (avatar, name, meta strip), a stepper card with stages `<…>` and a grouped pill toolbar, and a three-column body (collapsible left context panel | scrolling stage card with head/body/foot | collapsible right decision panel). Locked stages show a tooltip; read-only state shows a veil with a badge.

**New dashboard section**
> Add a `<Domain>` dashboard section: a heading row (icon tile, title, subtitle), 4 KPI tiles (count-up, trend chip), a chart row (`<bar/area/pie>` in xl `<5/4/3>`) with dashed grids and a custom tooltip, and a list row (recent items with ID chip + status pill; top-N with a relative bar). Lists scroll inside the card at about 340px.

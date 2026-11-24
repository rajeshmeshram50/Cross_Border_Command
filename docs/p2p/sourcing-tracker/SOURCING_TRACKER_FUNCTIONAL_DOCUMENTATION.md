# P2P SOURCING MANAGEMENT TRACKER

## Functional Documentation & User Guide

**Module:** P2P Sourcing Management Tracker  
**Menu Path:** Procure to Pay (P2P) → Procurement Management → Sourcing Management Tracker  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**Document Type:** Functional Documentation & User Guide  

---

## CONTENTS

1. Overview
2. Key Terms
3. Who Can Do What
4. Screen Map
5. Sourcing Target List
6. Assign / Edit a Sourcing Target
7. Sourcing Target Report
8. Map a Supplier
9. Mapped Suppliers
10. Convert to Supplier
11. Statuses, Progress and TAT
12. Business Rules

- Appendix A — Validation Reference
- Appendix B — Known Gaps
- Appendix C — Change Log

---

## 1. OVERVIEW

This document explains what the module does, who can do what, every screen, every rule and message, and the known gaps, in plain business language. It is written for business users, QA and new team members. The page opens at the URL /p2p/sourcing-tracker. Code-level detail is in the companion Technical Documentation, API Documentation and Code Walkthrough.

The Sourcing Management Tracker is where a buyer asks a colleague to **find suppliers for a list of products by a date**.

The creator raises a **Sourcing Target** (for example ST-001). It holds the products, a target price for each, an optional clarity note, link or document per product, a turnaround date (**Sourcing TAT**) and the colleague it is **assigned to**.

The assignee (or the creator) then works on the target's **Sourcing Target Report**. For each product they **map suppliers** with a quote (price, plus GST or currency and exchange rate). The first supplier mapped to a product marks that product **Completed**. When every product is completed, the target is **Completed**.

Main capabilities:

- Create a sourcing target with products from the Product Master or typed in by hand.
- Add a target price and an optional clarity (text, link or file) per product.
- Assign the target to a colleague (or to yourself) with a due date.
- Track progress, due dates and overdue targets on one list.
- Map suppliers to each product — an existing **Supplier Master** supplier or a **New Supplier** found in the market.
- Review and edit every supplier quote for a product.
- **Convert** a New Supplier into a full Supplier Master record without retyping it.

**Not built yet:** the RFQ (Request for Quotation) part of the screen. The **Create RFQ** button and the RFQ tab are disabled.

---

## 2. KEY TERMS

| Term | Meaning |
|---|---|
| Sourcing Target | A request to find suppliers for a list of products by a date. Its code is ST- plus a number (ST-001), per company |
| Target Price | The price the creator hopes to source each product at, in ₹ |
| Clarity | An optional note, link or file (PDF or image) that explains a product to the person sourcing it |
| Sourcing TAT | The turnaround date — the date by which the target should be complete |
| Start Date | The day the target was created. Set by the system and locked |
| Creator | The person who raised the target |
| Assignee | The colleague the target is assigned to. Fixed after the target is created |
| Product Master | The company's list of products. Products picked from it carry a code, segment and HSN code |
| Manual Entry | A product typed in by hand (name and target price only) |
| Supplier Master | The company's list of full supplier records (with a code such as S-017), kept in Supplier Management |
| New Supplier | A supplier found in the market who is not in the Supplier Master yet. Stored in the company's New Supplier directory |
| Domestic supplier | A supplier in India, priced in ₹ with GST |
| International supplier | A supplier outside India, priced in its own currency, with no GST |
| Mapping | A supplier linked to one product of a target, with its quote |
| Convert | Turning a New Supplier into a Supplier Master record through the shared Add Supplier form |
| Converted | A green badge on a Master card whose supplier was created by converting a New Supplier |
| Completed | A product with at least one supplier mapped; or a target whose products are all completed |
| In Progress | A product with no supplier yet (called **Pending** in the Report); or a target not yet complete |
| Overdue | A target that isn't complete and whose due date has fully passed |
| At risk | A target that isn't complete and has 7 days or fewer left |
| On track | Any other target, and always a completed one |

---

## 3. WHO CAN DO WHAT

| Action | Who can do it | What others see |
|---|---|---|
| Open the page | **Branch users and employees** who have the View right on the permission p2p.sourcing_tracker | Super admin and client admin can't open the page |
| See a target in the list | Its **creator** and its **assignee** | Other people don't see it — **All Sourcing Targets** is not every target in the company |
| Open a target, its Report or Mapped Suppliers | Creator, assignee, client admin, super admin (but client admin and super admin can't open the page itself) | *"Only the creator, the assignee or the client admin can open this sourcing target."* |
| Create a target | Anyone who can open the page | — |
| Edit a target | **The creator only**, and only while the assignee is active | The Edit pencil is disabled with the tooltip *"Only the creator can edit this target"*. The server answers *"Only the creator can edit this sourcing target."* |
| View-only target | When the **assignee is inactive or has exited**, the target opens view-only for everyone | The form shows a **View Only** tag and only a **Close** button |
| Delete a target | Nobody — there is no delete button and no delete function | — |
| Map or edit suppliers | **Creator or assignee** (super admin can also do it through the API) | **Map Supplier Directory** and **Add Supplier** are disabled with the tooltip *"Only the creator or the assignee maps suppliers to this target"*. The Edit icon on supplier cards is hidden |
| Convert a New Supplier | **Anyone** who can open the Report — there is no creator / assignee check | — |
| Be assigned | Active users of the same branch who are onboarded employees of **any department**, branch users, or **the creator** (self-assign is allowed). On save, the server accepts any active user of the company who is not a super admin | People not in the list can't be picked |

---

## 4. SCREEN MAP

1. **P2P → Procurement Management → Sourcing Management Tracker** — the list (section 5).
   1. **Assign Sourcing Target** button → the target form in Add mode (section 6). Anyone.
   2. On a row:
      1. **Total Products** → **Product List** popup, read-only (section 5).
      2. **Edit** (pencil) → the target form in Edit mode (section 6). Creator only.
      3. **Sourcing Target Report** button, or the **Mapped Suppliers** count → **Sourcing Target Report** (section 7).
         1. On a product → **Map Supplier Directory** (section 8). Creator or assignee.
            1. **Supplier Master** → **Domestic** or **International** → Supplier Master form.
               1. **"+"** → the full **Add Supplier** form.
            2. **New Supplier** → **Domestic** or **International** → New Supplier form.
         2. On a product → **Supplier Count** → **Mapped Suppliers** (section 9).
            1. **Edit price** (Master card) or **Edit supplier & quote** (New Supplier card).
            2. **Convert to Supplier** → the **Add Supplier** form (section 10). A **Converted** badge shows once the supplier is in the Supplier Master.
            3. **Add Supplier** → **Map Supplier Directory**.
         3. On a product → clarity chip → **Product Clarity** viewer.

---

## 5. SOURCING TARGET LIST

### 5.1 Purpose

Shows the sourcing targets you created or are assigned to, with their due date, products, mapped suppliers and progress. It is the starting point for every other screen.

### 5.2 Who Can Do It

Branch users and employees who can open the page. Each person sees only targets they created or are assigned to.

### 5.3 Steps

1. Open **P2P → Procurement Management → Sourcing Management Tracker**. The header reads **Sourcing Management Tracker** — *"Manage Requests for Quotation (RFQ) and sourcing targets — in one place."*
2. Pick a sub-tab to filter the list (see the tabs table below).
3. Type in the search box to narrow the list.
4. Use a row's buttons:
   - **Total Products** → the Product List popup.
   - **Mapped Suppliers** count (if more than 0) → the Report.
   - **Edit** (pencil) → the target form.
   - **Sourcing Target Report** → the Report.
5. To create a target, click **Assign Sourcing Target** (section 6).

The **Create RFQ** button is disabled, with the tooltip *"RFQ Management — coming soon"*.

### 5.4 Fields and Rules

**Tabs**

| Tab | What it shows |
|---|---|
| **Sourcing Target Management** (main tab) | This module, with the count of All |
| **Request for Quotation (RFQ) Management** (main tab) | Disabled — not built |
| **All Sourcing Targets** | Targets **you created or are assigned to** — not every target in the company |
| **Sourcing Target Created by Me** | Targets you created |
| **Sourcing Target Assigned to Me** | Targets assigned to you |

**Search and paging**

| Field | Required | Rules | Message shown |
|---|---|---|---|
| Search — *"Search by ID, product, person, TAT date or status..."* | No | Runs on the server 300 ms after you stop typing. Case-insensitive "contains" match. Has a clear (×) button. Up to 100 characters (the box doesn't stop you typing more). A search for just 0 is ignored | Over 100 characters: *"Couldn't load sourcing targets"* |
| Rows per page | No | 10, 25 or 50. Until one is picked, the list fits the screen (at least 4 rows) | — |

The search matches:

- the target code, the source labels, and the creator's and assignee's names;
- every product name;
- the status words **In Progress**, **Completed**, and **overdue** (for overdue targets);
- the **due date** (not the start date) as yyyy-mm-dd **or** dd/mm/yyyy. Part of a date works too, for example 11/2026.

**Columns**

| No. | Column | What it shows |
|---|---|---|
| 1 | **Sr No** | Row number |
| 2 | **Sourcing Target ID** | Code pill (ST-001) with the start date (dd/mm/yyyy) under it |
| 3 | **I Want to Source To** | Chips **Product Master** and / or **Manual Entry** |
| 4 | **Sourcing TAT** | The due date, coloured: **teal** on track, **amber** at risk, **red** overdue (with an **OVERDUE** pill) |
| 5 | **Created By** | Initials and name |
| 6 | **Assigned To** | Initials and name |
| 7 | **Total Products** | First product name and **+N**. Click → Product List |
| 8 | **Mapped Suppliers** | Total suppliers across all products. Click (if more than 0) → the Report |
| 9 | **Sourcing Progress Status** | **In Progress** / **Completed** pill, %, a bar, and *"X done · Y pending"* |
| 10 | **Action** | **Edit** (pencil — creator only; others see it disabled with *"Only the creator can edit this target"*) and **Sourcing Target Report** (icon-only on tablet and phone) |

**Product List popup (read-only)**

| Part | What it shows |
|---|---|
| Header | **Product List — ST-001**, a status pill, and *"Source: … · Due: dd/mm/yyyy"* |
| Tiles | Total · Completed · Pending · Overall Progress |
| Tabs | **Product Master** / **Manual Entry**. Opens on Master unless it is empty. The table is as tall as the tab being viewed (up to 5 rows, then it scrolls) — not the height of the longer tab |
| Columns | Sr No · Product Code · Product Name · Segment · HSN Code (these three on Master only; blanks show "N/A") · Target Price (one line, see section 7) · Sourcing Status (**Completed** / **In Progress**) |
| Footer chips | Total · Completed · Pending |
| States | Loading; an error with **Retry**; an empty tab: *"No … products — Switch tab to see other products"* |

**Screen sizes and dark mode**

| Screen width | What changes |
|---|---|
| Any | **Dark mode** is fully styled on every screen and popup. The selected main tab (**Sourcing Target Management**) is deep teal with white text, icon and count |
| Wide screens | The list keeps its columns, with a minimum width of 1516 px |
| 1600 px or less | Minimum width 1264 px |
| 1100 px or less | Only the search wraps — it moves to its own line under the main tabs |
| 768 px or less | Minimum width 1116 px. The header strip stacks, the main tabs wrap onto several lines, the sub-tabs scroll sideways, and the report button in a row becomes icon-only |
| 480 px | The two header buttons stack full-width |

When the table area is narrower than the minimum width, the table **scrolls sideways**, with the **Action** column pinned on the right.

The popups have their own breakpoints, where fields stack into fewer columns as the screen narrows:

| Popup | Breakpoints |
|---|---|
| Report | 1100 / 700 px |
| Target form | 900 / 700 px |
| Supplier Master form | 760 / 480 px |
| Mapped Suppliers | 680 / 600 px |
| Product List, Map Supplier, attach menu | 640 / 480 px |

### 5.5 What Happens After Saving

The list has nothing to save. After you create a target, the list switches to **Sourcing Target Created by Me**.

### 5.6 Good to Know

- Tab counts come from the server (0 until loaded).
- Switching tab clears the search and goes back to page 1.
- While loading, shimmer rows show. When only the number of rows per page changes while rows are already showing (the auto-fit right after the first load, or a new page size picked on page 1), the rows stay and are replaced in place — no shimmer blink.
- Empty and error states:
  - *"No sourcing targets yet — Use "Assign Sourcing Target" to create the first one."*
  - *"No results found — Try a different search term."*
  - *"Couldn't load sourcing targets — Check your connection and try again."* with **Retry**.

---

## 6. ASSIGN / EDIT A SOURCING TARGET

### 6.1 Purpose

Create a sourcing target (products, target prices, clarity, due date and assignee), or update one you created.

| Mode | Title | Who |
|---|---|---|
| Add | **Assign Sourcing Target** — *"Create a sourcing target across products."* | Anyone who can open the page |
| Edit | **Edit Sourcing Target — ST-001** — *"Update sourcing details and product list."* | **The creator only** |
| View only | Same form, with the tag **View Only** and only **Close** | When the **assignee is inactive or has exited** — *"View only — This sourcing target's assignee is inactive or exited, so it can't be edited."* |

### 6.2 Who Can Do It

- Add: anyone who can open the page.
- Edit: the creator only, while the assignee is active.
- There is **no way to delete a sourcing target**.

### 6.3 Steps

1. Click **Assign Sourcing Target** on the list (or the **Edit** pencil on a row you created).
2. **Section 1 — Sourcing Details:** pick the **Sourcing TAT** and (Add only) the **Assign To** person.
3. **Section 2 — Product Details:** choose **I want to source from** — **From Product Master** or **Manual Product Entry** — and add products:
   - **Product Master:** *"Select Products (choose one or more, then click Add)"*. Pick one or more products, then click **Add**.
   - **Manual:** type the **Product Name** and **Target Price (₹)**, then click **Add to List** (or press Enter).
4. **Section 3 — Product List:** check each product on the **Masters (n)** / **Manual (n)** tabs. Enter a **Target Price (₹)** for every product.
5. Optionally click **Add clarity** on a product to open **Product Clarity**, and add a Text, Link or PDF clarity.
6. Click **Assign Target** (Add) or **Update Target** (Edit).

**The Assign To list, step by step**

1. Click **Assign To**. The list opens, sorted by name.
2. Each row shows the person's **employee code** as a small chip (for example EMP-001) when they have one, then *"Name · Role"*. The role is the employee's designation; if none, the designation on the user's own record; if none, the user type (for example *Branch User*, *Employee*). Your own row reads *"Name (You) · Role"*.
3. A violet **department badge** sits beside each name (only in the open list): the employee's department (*Purchase*, *Sales*, *HR*, …), or *Branch Admin* for a branch user who isn't an employee. Someone with neither (for example you, if your onboarding isn't finished) has no badge.
4. Nobody is greyed out — anyone listed can be picked, including you.
5. After picking, the field shows *"EMP-001 · Name"* (or just the name).

A search box appears when more than 6 people are listed. If nobody is listed, the box says *"No team members available"*.

Who is listed — active users of the **same branch** (not super admin) who are one of:

- an employee of **any department** who has finished onboarding (stage 6) and whose employee record is active — the badge shows their department;
- a **branch user** — the badge shows *Branch Admin* when they have no employee department;
- **you** (the creator) — self-assign is allowed; your row is marked *"(You)"*.

Who is **not** listed: inactive users; people of another branch; super admins; employees who haven't finished onboarding or whose employee record is inactive (unless they are a branch user, or you).

### 6.4 Fields and Rules

**Section 1 — Sourcing Details**

| Field | Required | Rules | Message shown |
|---|---|---|---|
| **Sourcing Target ID** | Auto | Add: a preview of the next code (ST- plus a number). The real code is given on save, so it can differ if two people create targets at the same moment; the success toast shows the real one | — |
| **Start Date** | Auto | Locked: shows **Today** on Add and **Locked** on Edit. Set by the server | — |
| **Sourcing TAT** | Yes | Date picker. Add: today or later. Edit: on or after the start date. Hint: *"{N} days turnaround from start"* | *"Pick the target completion date"* · *"The Sourcing TAT cannot be in the past"* · *"TAT cannot be before the start date"* |
| **Assign To** | Yes (Add) | Add only. The list shows *"Name · Role"* with a department badge. On Edit the field is **Fixed**. On save, the server only checks that the person is an **active user of your company** (not super admin) | *"Assign this target to a team member"* · *"Pick an active team member of your company to assign this sourcing target."* |

Server errors on the TAT or the assignee appear **under those fields**.

**Section 2 — Product Details**

| Field | Required | Rules | Message shown |
|---|---|---|---|
| **I want to source from** | Yes | **From Product Master** or **Manual Product Entry**. Can also be switched on Edit | — |
| Product Master picker | — | Search matches code, name or segment. Shows products of your branch. Products already on the list show *"(added)"*. Picks show as one chip and **+N** (click for the list). **Add** is disabled until something is picked | *"No products found"* · *"No products in the Product Master"* |
| **Product Name** (manual) | Yes | Up to 255 characters. Must not already be a manual product on the target (ignoring case) | Missing: the field turns red. Duplicate: *"Already in the list — "X" is already a manual product on this target."* |
| **Target Price (₹)** (manual) | Yes | Only digits and one point can be typed, **at most 10 digits before the point and 2 after** (largest ₹9,99,99,99,999.99) | Missing or 0: the field turns red |

**Section 3 — Product List**

The tabs are **Masters (n)** / **Manual (n)**. The table scrolls after 4 rows.

| Field | Required | Rules | Message shown |
|---|---|---|---|
| Sr · Product Code · Product Name · Segment · HSN Code | — | Code, Segment and HSN on the Masters tab only | — |
| Product Name (manual, Edit) | Yes | On Edit a manual product can be **renamed**, even with suppliers mapped. A rename is **not** checked for duplicates | Empty: the field turns red |
| **Target Price (₹)** | Yes | **More than 0** and **up to ₹9,99,99,99,999.99** (the supplier price ceiling), plain digits with **up to 2 decimals**. Typing is capped (CS-2308): letters, commas and a second point are dropped, and no more than **10 digits before the point and 2 after** can be typed — so 1.234 or a 70-digit number can't be entered. A value that is still bad (for example .5, 5., 0, empty, or an over-long value saved on an older target and shown on Edit) turns the row's field **red** on save, puts the cursor in it, and nothing is sent. A price the server refuses is also marked on its row (the tab switches to it and the cursor goes into it) until it is edited | Hover: *"Enter a price more than 0 and up to ₹9,99,99,99,999.99, with at most 2 decimals"* |
| **Clarity** | No | See Product Clarity below | — |
| **Action** | — | Remove (trash). Shows a **lock** instead when suppliers are already mapped | *"Suppliers are mapped to this product — it can't be removed"* |
| The list as a whole | Yes | At least one product | *"Add at least one product"* (after trying to save) |

Empty-tab texts: *"No master products added yet…"* · *"No manual products added yet…"*.

**Product Clarity**

**Add clarity** opens **Product Clarity** with three tabs.

| Field | Required | Rules | Message shown |
|---|---|---|---|
| **Text** | No | Free notes. Saving an empty note removes the clarity | — |
| **Link** | No | Must start with http:// or https:// **and** have a dotted domain (for example https://example.com/spec). An empty link removes the clarity. Enter in the field does nothing | *"Enter a valid link starting with http:// or https://"* |
| **PDF** | No | **Upload file** / **Take photo** (or drag and drop). PDF, JPG, PNG or WEBP, up to **5 MB**. **One file** per product; a new one replaces it; no file removes the clarity. The attached file shows **View** and **Remove** | *"Upload a PDF, JPG, PNG or WEBP file up to 5 MB."* |

Esc closes the clarity dialog only when nothing changed.

### 6.5 What Happens After Saving

- The buttons read *"Assigning…"* / *"Updating…"* while saving.
- If anything is wrong, the form scrolls to the first bad field (switching the product tab if needed).
- Success:
  - Add: *"ST-001 created — N product(s) assigned to <name>."* The list switches to **Created by Me**.
  - Edit: *"ST-001 updated — N product(s) on this target."*
- Failure: *"Assign failed"* / *"Update failed"*.
- Clarity files are **uploaded when the target is saved**, not when the clarity dialog is saved.
- After saving, the clarity cell shows a chip — **Text note** (opens a viewer with **Edit Clarity**), **Open link**, **View PDF** (or **View file** for an image) — and a pencil **Edit clarity**.
- On Edit, new products can be added. Removing a product that has **no** suppliers deletes it on save.

### 6.6 Good to Know

- Only one save runs at a time. While saving, the form is locked and ×, Cancel and Esc do nothing.
- **Closing:** a click outside does nothing. × and Cancel close **without asking**. Esc closes only if nothing was changed.
- Edit shows a shimmer while the target loads.
- Loading problems show *"Products not loaded"*, *"Team not loaded"* or *"Couldn't open the target"*.
- **View only** (assignee inactive or exited): the TAT picker is disabled, the product adders are hidden, target prices are read-only, the clarity and remove buttons are disabled, and the Text-clarity viewer has no **Edit Clarity** button.

---

## 7. SOURCING TARGET REPORT

### 7.1 Purpose

Shows every product of one target with its target price, clarity, sourcing status and number of mapped suppliers. It is where suppliers are mapped.

### 7.2 Who Can Do It

- Open: the creator, the assignee, client admin and super admin (client admin and super admin can't open the page itself).
- Map suppliers from it: the creator and the assignee only.

### 7.3 Steps

1. On the list, click **Sourcing Target Report** on a row, or the **Mapped Suppliers** count.
2. Switch between **Product Master (n)** and **Manual Product Entry (n)**.
3. On a product:
   - click a clarity chip to view the clarity;
   - click **Supplier Count** (if more than 0) to open **Mapped Suppliers** (section 9);
   - click **Map Supplier Directory** to map a supplier (section 8).

### 7.4 Fields and Rules

| Part | What it shows |
|---|---|
| Header | **Sourcing Target Report**, a code chip, Completed / In Progress, *"Business Reference · Generated <today>"* |
| Tiles | Sourcing Target ID · Source Type · Start Date · Due Date (red when overdue) · Created By · Assigned To |
| Stats | Total Products · Completed · Pending · Overall Progress (% and bar) |
| Tabs | **Product Master (n)** / **Manual Product Entry (n)**. The table is as tall as the tab being viewed, up to 5 rows, then it scrolls. Names over 25 characters are cut, with a tooltip |

| Column | What it shows |
|---|---|
| Sr No · Product Code · Product Name · Segment · HSN Code | Code, Segment (coloured) and HSN on the Master tab only |
| Target Price ₹ | The target price (format below) |
| **Product Clarity** | **✓ Text** (opens the note) · **✓ Link** (opens in a new tab; a link that isn't http or https is shown but can't be clicked) · **✓ Pdf** (×N for older multi-file clarity; opens the first file) · "—" |
| **Sourcing Status** | **Completed** / **Pending** |
| **Supplier Count** | Click (if more than 0) → Mapped Suppliers |
| **Action** | **Map Supplier Directory** — creator and assignee only. Others see it disabled: *"Only the creator or the assignee maps suppliers to this target"* |

**How target prices are shown** (the same everywhere: Report, Product List, Map Supplier header, Mapped Suppliers):

- ₹ with Indian grouping and two decimals, for example ₹18,500.00 or ₹1,23,45,678.00, on **one line**.
- The grouping is done on the text, so even a very long value keeps every digit.
- A value too long for its cell (older targets) ends in "…" with the full value in the tooltip.
- An empty or non-numeric price shows "—".

### 7.5 What Happens After Saving

The Report reloads after every supplier map or edit.

### 7.6 Good to Know

- States: *"Loading the products…"* · *"Couldn't load the products."* (with **Retry**) · *"No Product Master products on this sourcing target."* · *"No manually entered products on this sourcing target."*
- A pending product reads **Pending** here but **In Progress** in the Product List — same meaning, two labels.

---

## 8. MAP A SUPPLIER

### 8.1 Purpose

Link a supplier and its quote to one product of a target — either an existing Supplier Master supplier or a New Supplier found in the market.

### 8.2 Who Can Do It

The creator or the assignee of the target (super admin through the API). Others see **Map Supplier Directory** disabled.

### 8.3 Steps

1. In the Report, click **Map Supplier Directory** on the product row. The header shows **Map Supplier Directory** with the product's name, code, segment, target price and how many suppliers are already mapped.
2. **Step 1 — where the supplier comes from:** click **Supplier Master** or **New Supplier**.
3. **Step 2 — Domestic or International:** click **Domestic Supplier** or **International Supplier**.
4. Fill in the form (Supplier Master form or New Supplier form, section 8.4) and save.

Clicking a card goes straight on. **Back** and **Cancel** are available on the step screens.

| Step 1 card | Means |
|---|---|
| **Supplier Master** — *Select from your pre-verified supplier database* | An existing supplier |
| **New Supplier** — *Register a new supplier with full details & documents* | Someone not in the Supplier Master yet |

| Step 2 card | Means |
|---|---|
| **Domestic Supplier** — *based in India — price in ₹ with GST applied* | INR · GST % · State |
| **International Supplier** — *Overseas supplier — price in its currency, no GST charged* | Currency · Exchange Rate · No GST |

For Supplier Master, each Step 2 card shows *"{n} available"* — all Supplier Master suppliers of that origin you can see, including ones already mapped to this product. For New Supplier it says *"New"*.

#### 8.3.1 Choose Supplier Master or New Supplier

| Step | Supplier Master | New Supplier |
|---|---|---|
| Use it when | The supplier is **already** in Supplier Management (a full supplier record with a code, for example S-017) | You found a supplier in the market who is **not** in the Supplier Master yet |
| 1 | **Map Supplier Directory** on the product row | Same |
| 2 | Click **Supplier Master** | Click **New Supplier** |
| 3 | Pick **Domestic** (in India, ₹ + GST) or **International** (abroad, its currency, no GST) | Same |
| 4 | Pick the supplier from the list — code, state, contact and so on fill in by themselves. Not there? **"+"** opens the full Add Supplier form and selects the new supplier afterwards | Type the company, contact, mobile, segment, email and address, and optionally attach a business card |
| 5 | Type only the **price** (Domestic: plus GST %; International: plus currency and exchange rate) | Type the price and its GST % and GST type (Domestic), or currency and exchange rate (International), and optionally a *Price Valid Till* date |
| 6 | **Save** | **Save Supplier** |
| What is saved | A mapping that points at the Supplier Master record, with a **copy** of its name, segment, contact, mobile, email, country, state and city as they are today, and the price worked out by the server | A New Supplier entry in the company's **New Supplier directory** (reused if one with the same name already exists) and a mapping with every detail **as you typed it**, plus the price |
| Card in Mapped Suppliers | Tag **Master**; Edit = **Edit price** only | Tag **New Supplier**; Edit = **Edit supplier & quote**; a **Convert to Supplier** button |
| GST type (Domestic) | Decided by the server: *intra-state* when the supplier's state is your branch's state, else *inter-state* | Chosen on the form (it suggests the same rule from the state you pick) — what you leave there is saved |

Either way, the **first** supplier mapped to a product marks the product **Completed**.

### 8.4 Fields and Rules

#### 8.4.1 Supplier Master Form

| Field | Required | Rules | Message shown |
|---|---|---|---|
| **Supplier Name** | Yes | A searchable list of Supplier Master suppliers **of the chosen origin** (*Search supplier code, name*). Each row shows the code and a coloured type badge (violet material; green transport / FFD / logistics; grey service). International rows read *"name · country"*. The open list is **exactly as wide as the field** and keeps that width while loading, empty or scrolled (CS-2308). A long name ends in "…" with the full name in the row's tooltip. A supplier already mapped to this product (as Master) is greyed out and can't be picked, but still reacts to the mouse | *"This field is required"* · Loading: *"Loading suppliers…"* · No suppliers: *"No Domestic suppliers in the Supplier Master"* (or International) · Hover on a greyed row: *"<name> — already mapped to this product"* · Click on it: toast *"Already mapped — <name> is already mapped to this product."* (the list stays open) |
| **"+"** | — | Opens the full **Add Supplier** form for the same origin | See section 8.5 |
| Supplier Code, Supplier Type, Contact Person | Auto | Both origins | — |
| State, GST State Code | Auto | Domestic only | — |
| Country, City / Region | Auto | International only | — |
| **Price (₹)** | Yes (Domestic) | More than 0. Typing capped at **10 digits before the point and 2 after** (largest ₹9,99,99,99,999.99) | *"This field is required"* |
| **GST %** | Yes (Domestic) | From the GST master, default 18 | — |
| GST Amount, Total Amount | Auto (Domestic) | A preview — the server's rounded figures are saved | — |
| GST Type | Not on this form | The server decides intra / inter from the supplier's state against **your** branch's state | — |
| **Currency** | Yes (International) | Defaults to the supplier's currency as the server reports it (its country's currency for a short list of countries, else **USD** — for example an Australian supplier defaults to USD). If that currency isn't in the Currency master, the rate starts empty | — |
| **Price ({cur})** | Yes (International) | More than 0. Typing capped at 10 + 2 digits | *"This field is required"* |
| **Exchange Rate (₹ per {cur})** | Yes (International) | More than 0. Defaults from the Currency master. Typing capped at **5 digits before the point and 4 after** (largest 99,999.9999) | *"This field is required"* |
| Total Amount ({cur}) | Auto (International) | Equals the price | — |
| Total value (International) | — | Price × exchange rate must not be above ₹9,99,99,99,99,999.99 | *"The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate."* (under the price) |
| Price Valid Till | Not on this form | — | — |

Buttons: **Back** (to the Domestic / International step), **Cancel**, **Save** (*Saving…*).

The target price pill in the header is capped at 200 px; a long price ends in "…" with the full value in the tooltip.

#### 8.4.2 New Supplier Form

| Field | Required | Rules | Message shown |
|---|---|---|---|
| **Supplier Company Name** | Yes | Not blank | *"Enter the supplier company name"* |
| **Contact Person** | Yes | Not blank | *"Enter the contact person"* |
| **Email ID** | Yes | Must look like a@b.c. Must not already be used anywhere in the system | *"Enter a valid email ID"* · Duplicate: *"This email address is already used by … in the system. Please use a different address."* (the field turns red) |
| **Segment** | Yes | Picked from the list | *"Select a segment"* |
| **Mobile** — Domestic | Yes | 10 digits | *"Enter a 10-digit mobile number"* |
| **Mobile** — International | Yes | Optional leading +, then 7–18 **characters** that start with a digit and may contain digits, spaces or dashes (spaces and dashes count toward the length). At most 20 characters can be typed. A country code is asked for but not enforced | *"Enter the mobile number with its country code"* |
| Google Location Link | No | — | — |
| **Street Address** | Yes | Not blank | *"Enter the street address"* |
| **City** | Yes | Not blank | *"Enter the city"* |
| **Country** — Domestic | Yes | Shown as text (default *India*), but **always saved as India** — whatever is typed is ignored | *"Enter the country"* |
| **Country** — International | Yes | A list of countries outside India. Picking one suggests a currency | *"Select a country"* |
| **State** — Domestic | Yes | Indian states. Fills State Code and the GST type | *"Select a state"* |
| **State / Province** — International | No | — | — |
| State Code (Domestic) | No | Up to 3 characters | — |
| **Unit Price** | Yes | Domestic: excluding GST. International: in the chosen currency. More than 0. Typing capped at **10 digits before the point and 2 after** | *"Enter the unit price…"* |
| **GST Rate** (Domestic) | Yes | Default 18% | — |
| **GST Type** (Domestic) | Yes | *CGST + SGST (Intra-state)* when the state is your branch's, else *IGST (Inter-state)*. Can be changed, and **what is shown is saved** | — |
| **Currency** (International) | Yes | Default USD. Picking a country suggests its currency (when that currency is in the master) and its rate | — |
| **Exchange Rate** (International) | Yes | More than 0. Defaults from the Currency master. Typing capped at **5 digits before the point and 4 after** | *"Enter the exchange rate"* |
| Price Valid Till | No | Today or later | *"Price Valid Till cannot be in the past."* |
| **Business Card** | No | PDF, JPG or PNG, up to **5 MB**. Upload or take a photo (no drag and drop); then View / Remove / click to replace | *"PDF, JPG or PNG up to 5 MB."* |

All six dropdowns (Segment, Country, State, Currency, GST Rate, GST Type) open **exactly as wide as their field** (CS-2308). A long segment name no longer pushes the list past the popup's edge; it ends in "…" with the full name in the row's tooltip.

**Summary tiles** (a very long amount wraps inside the tile):

| Origin | Tiles |
|---|---|
| Domestic | Taxable Value · GST Amount (CGST / SGST or IGST split) · Price incl. GST · **vs Target Price** (*"x% below — Saves ₹…"*, *"At target"*, *"x% above"*) |
| International | Total Amount · No GST · **INR Equivalent** (*"@ ₹{rate} / {cur}"*) |

Buttons: **Back** (to the Domestic / International step; on Edit it closes the popup) and **Save Supplier** (*Saving…*).

**Server messages on this form:**

- *"Enter the supplier company name."*
- *"Enter a valid supplier email address."*
- *"Price Valid Till cannot be in the past."* and *"The unit price must be more than 0."* — these two wordings are for a **new** mapping. On **Edit supplier & quote** the server uses the system's standard wording, for example *"The valid till field must be a date after or equal to today."*
- *""X" is already in the Supplier Master — map it from Supplier Master."*
- *""X" is already mapped to this product."*
- *"Product not found in this sourcing target."* (the product was removed meanwhile)
- The server's country messages — *"Please select the supplier's country (outside India)."* and *"A Domestic supplier must be in India — choose International for an overseas supplier."* — can't be reached from this form, because Domestic always sends India and International lists only other countries.

### 8.5 What Happens After Saving

- The mapping is saved. If it is the product's first supplier, the product becomes **Completed**. The Report reloads.
- Toasts: *"Supplier mapped — X mapped to <product>."* · *"Supplier updated — X on <product> is updated."* · Failure: *"Supplier not mapped"* / *"Supplier not updated"*.
- After **"+"** on the Supplier Master form:
  - *"<name> added to Supplier Master — It is now selected in this form."*, or
  - if the new supplier is of the other origin: *"<name> saved — It is not an International / Domestic supplier, so it is not in this list."*
- New Supplier with the **same company name** as an entry already in the directory (ignoring case): that entry is **reused**. The details just typed are kept on this mapping only.

### 8.6 Good to Know

- **Duplicate on Supplier Master (CS-2308):** the server refuses the supplier with *""X" is already mapped to this product."* when it is already mapped as a Supplier Master row, **or** when the product already has a New Supplier row that was converted into this same supplier. The list greys out only Master rows, so the second case is caught by the server, as an error toast.
- On the Supplier Master form, server messages appear under the price, currency and rate fields. Origin and Valid Till errors appear only in the toast.
- If the supplier list fails to load: *"Suppliers not loaded"*.
- **Closing the map popup:** Esc works only until something is picked or typed. × always closes.

---

## 9. MAPPED SUPPLIERS

### 9.1 Purpose

Shows every supplier mapped to one product, with its quote. From here you can edit a quote, add another supplier, or convert a New Supplier.

### 9.2 Who Can Do It

- View: anyone who can open the Report.
- Edit and **Add Supplier**: the creator or the assignee only. Others see no Edit icon at all, and **Add Supplier** is disabled with the creator / assignee tooltip.
- **Convert to Supplier**: anyone who can open the Report (section 10).

### 9.3 Steps

1. In the Report, click a product's **Supplier Count** (you can also reach it from the list's Mapped Suppliers count, through the Report).
2. Read the cards (newest first).
3. To change a quote, click the Edit icon on a card:
   - New Supplier card → **Edit supplier & quote**;
   - Master card (including a **Converted** one) → **Edit price**.
4. To add another supplier, click **Add Supplier** (this closes Mapped Suppliers and opens Map Supplier).
5. To finish, click **Close**.

### 9.4 Fields and Rules

| Part | What it shows |
|---|---|
| Header | **Mapped Suppliers**, a code pill, *"Sourcing Reference · <source> · Generated <today>"* |
| Tiles | Sourcing ID · Product Code · Product Name · Segment · Target Price · Suppliers Mapped. A long value ends in "…" with a tooltip. The Segment tile shows only when the product has a segment |
| Card | Name; tags (**Domestic** / **International**, segment — the product's segment when the supplier has none, **Master** / **New Supplier**); contact person, mobile, email |
| Card buttons | One group on the card's right edge, 8 px apart: the Edit icon, then **Convert to Supplier** (New Supplier cards not yet converted) or a green **Converted** badge (*"This New Supplier is now in the Supplier Master"*) on a Master card whose supplier was created by converting a New Supplier |
| Footer | *"N suppliers mapped to <product>"*, **Close**, **Add Supplier** |

**Price row**

| Item | Domestic | International |
|---|---|---|
| Shows | Unit Price · GST % (CGST + SGST or IGST) · GST Amount · Price incl. GST · Valid Till | Origin and country · Unit Price (in its currency) · Exchange Rate · No GST · INR Equivalent |
| vs target | Compared on the unit price | Compared on the INR equivalent |

No price saved: *"Price & GST not mapped for this supplier"*.

**Editing**

| Card | Button | Opens |
|---|---|---|
| New Supplier | **Edit supplier & quote** | The New Supplier form, filled in. A domestic **0 % GST reopens as 18 %**. A **domestic** mobile shows its **last 10 digits**; an international one shows as typed. **Back** closes the popup |
| Master (including a **Converted** one) | **Edit price** | The Supplier Master form, titled **Edit Supplier Master** — supplier **Locked**, price fields only, no Back. The saved *Valid Till* is kept |

### 9.5 What Happens After Saving

- The Mapped Suppliers popup **stays open behind** the Edit popup and re-reads its cards after the save. The Report also reloads.
- **Edit supplier & quote** also updates the New Supplier directory entry.

### 9.6 Good to Know

- There is **no unmap** — a mapped supplier can't be removed here.
- Loading, and an error with **Retry**, show while the cards load.

---

## 10. CONVERT TO SUPPLIER

### 10.1 Purpose

Turn a New Supplier into a full Supplier Master record, using the shared **Add Supplier** form, without retyping its details. All of its mappings then become Master mappings.

### 10.2 Who Can Do It

- The **Convert to Supplier** button shows only on **New Supplier** cards that haven't been converted.
- It is shown to **anyone who can open the Report** — not only the creator / assignee. The server (both at the Contacts step and the final link) only checks that the New Supplier belongs to your company.
- The supplier it is linked to may be in **any branch** of your company.

### 10.3 Steps

1. In **Mapped Suppliers**, click **Convert to Supplier** on a New Supplier card. Mapped Suppliers and the Report close, and a message shows: *"Opening Add Supplier — loading <name>'s details…"*.
2. The shared **Add Supplier** form (Supplier Management) opens for the same origin (Domestic / International), already filled in (see the table below). Its **Map Product / Service** button is hidden. Fill in what is still missing.
3. **Identification → Save & Next** creates the supplier in the Supplier Master. It gets its code, for example S-031.
4. **Contact Person Details → Save & Next.** **This is where the link happens:** the New Supplier is linked to the supplier just created.
   - **Every** mapping of that New Supplier, on every sourcing target, becomes a **Master** mapping.
   - If a product already has this supplier as Master, it keeps one row — the New one is removed.
   - The New Supplier is marked converted.
   - Its own email is not treated as a duplicate here.
5. Complete the KYC steps and save the whole form: *"Supplier saved — S-031 — <name> completed and saved."*
6. The link is confirmed and the business card is copied to the supplier's primary contact (only if that contact has no attachment yet): *"Converted to Supplier — <name> is now in the Supplier Master as S-031."* The Report reopens. Open the product's Mapped Suppliers again to see the card as **Master** with the green **Converted** badge.

**If you cancel:**

- **Before** the Contacts step was saved — it stays a New Supplier and the Report reopens. A supplier already created at the first step stays in the Supplier Master, unlinked.
- **After** the Contacts step was saved — it is **already converted**. The Report reopens showing it as Master with the **Converted** badge, but the business card is not copied.

### 10.4 Fields and Rules

| Field | Required | Rules | Message shown |
|---|---|---|---|
| Company Name and Legal Name | Prefilled | Both equal the New Supplier's name | — |
| Segment, Country, State | Prefilled | A name that doesn't match a master entry is left empty for you to pick | — |
| GST Applicable | Prefilled | *No* for an International supplier | — |
| Registered Office | Prefilled | The New Supplier's street address | — |
| State Code | Prefilled | The form applies its own rule: a Domestic **State Code must be 1–2 digits** | — |
| City, Google Location | Prefilled | — | — |
| Contact Person Name, Contact No, Email | Prefilled | The contact email must not belong to another supplier or New Supplier anywhere in the system (the New Supplier's own email is allowed) | *"Save failed"* with *"This email address is already used by another vendor or supplier in the system. Please use a different address."* |
| Supplier Type, Website, GSTIN / TIN, Risk Level, Supplier Behaviour, Pincode | User enters | As per the Add Supplier form | — |
| Contact **Designation** | Yes — user enters | — | — |
| KYC steps | User enters | At least one **bank account**, and a **GST Scrutiny** row when GST Applicable is *Yes* | — |
| Business card | Not prefilled | Copied in step 6 | — |

The Add Supplier form's own field rules (State Code, contact number, email, bank account, GST scrutiny…) are in the Supplier Management documents.

**Messages**

| Case | Message |
|---|---|
| Already converted | *"<name> is already in the Supplier Master — Its mappings show it as Master."* |
| The wizard's Contacts step is refused (the New Supplier isn't in your company, or is already converted into a **different** supplier) | The wizard's *"Save failed"* toast with *"This New Supplier cannot be converted into this supplier."* |
| The contact email belongs to another supplier / New Supplier (anywhere in the system) | The wizard's *"Save failed"* toast with *"This email address is already used by another vendor or supplier in the system. Please use a different address."* |
| The prefill can't load | *"Couldn't open Convert to Supplier"* |
| The form didn't return the new supplier's id, or the final link call failed | *"Supplier saved, not linked"* — even though the link may already have been made at the Contacts step |

### 10.5 What Happens After Saving

- The New Supplier's mappings now show as **Master** cards with the **Converted** badge in place of the Convert button.
- The moved mappings show the **supplier's new name**, but keep the contact, email, mobile and card that were typed for the New Supplier.

### 10.6 Good to Know

- A converted New Supplier can't be mapped again as New.
- The Add Supplier form itself is documented in the Supplier Management documents.

---

## 11. STATUSES, PROGRESS AND TAT

**Product and target status**

| Item | Rule |
|---|---|
| Product status | Starts **In Progress**. Becomes **Completed** the moment its **first supplier** is mapped. It never goes back (there is no unmap) |
| Target status | **Completed** when it has products and **all** are Completed; otherwise **In Progress** |
| Progress % | Completed products ÷ all products × 100, rounded |

**TAT (due date) colour on the list**

| State | Rule | Colour |
|---|---|---|
| Overdue | Not complete, and the end of the due date has passed | Red, with an **OVERDUE** pill |
| At risk | Not complete, and **7 days or fewer** left (today counts) | Amber |
| On track | Anything else, and **always** once the target is complete | Teal |

The same pending product reads **In Progress** in the Product List but **Pending** in the Report — same meaning, two labels (see Appendix B).

---

## 12. BUSINESS RULES

These are the rules QA should never see broken.

1. **Only the creator edits** a target. The creator **may assign it to themselves** (self-assign is allowed). The assignee **can't change** after create.
2. **Only the creator or the assignee** maps or edits suppliers.
3. A target whose **assignee is inactive or exited** is **view-only**.
4. A product with suppliers mapped **can't be removed**.
5. The **same supplier can't be mapped twice** to one product (Master or New) — including a Supplier Master supplier whose converted New Supplier is already on the product (CS-2308).
6. The **first mapping completes the product**. Counts, progress and Completed / In Progress agree on the list, the Product List and the Report.
7. Target codes are **ST-NNN**, per company, and **never reused** (a target removed directly in the database still counts; the screens themselves have no delete).
8. **TAT can't be in the past** on create. **Overdue** shows only while the target isn't complete.
9. A **Domestic** supplier is **in India** and priced in ₹ with GST. An **International** one is **outside India**, priced in its currency, with **no GST**. Domestic GST is **intra-state** when the supplier's state is your branch's, otherwise **inter-state**.
10. Uploads: **5 MB**, listed file types only.
11. A **converted** New Supplier can't be mapped again as New. Converting links it at the Add Supplier form's **Contacts** step, and its card then shows **Converted** instead of the Convert button.
12. **All Sourcing Targets** shows only targets you created or are assigned to.

---

## APPENDIX A — VALIDATION REFERENCE

Every check a user can hit, by screen.

- **Where shown:** *field* (under or on the field), *toast*, *tooltip*, or *red only* (the field turns red with no text).
- **Checked by:** *Browser* = checked before anything is sent; *Server* = refused by the server; *Both* = checked in both places.

### A.1 List

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Search | At most 100 characters | *Couldn't load sourcing targets — Check your connection and try again.* (with Retry) | Table | Server |
| Search | A search for just 0 is ignored | — | — | Server |
| Edit pencil | Only the creator | *Only the creator can edit this target* | Tooltip | Browser |
| Any load failure | — | *Couldn't load sourcing targets* | Table | — |

### A.2 Assign / Edit Sourcing Target

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Sourcing TAT | Required | *Pick the target completion date* | Field | Browser |
| Sourcing TAT | Add: not before today | *The Sourcing TAT cannot be in the past* | Field | Browser |
| Sourcing TAT | Not before the start date | *TAT cannot be before the start date* | Field | Browser |
| Sourcing TAT | Required; Add: today or later | *Pick the Sourcing TAT (target completion date).* · *The Sourcing TAT cannot be in the past.* | Field + toast | Server |
| Assign To | Required (Add) | *Assign this target to a team member* | Field | Browser |
| Assign To | Required | *Assign this sourcing target to a team member before saving.* | Field (Add) / toast (Edit) | Server |
| Assign To | An active user of your company, not super admin | *Pick an active team member of your company to assign this sourcing target.* | Field + toast | Server |
| Products | At least one | *Add at least one product* | List | Browser |
| Products | At least one | *Add at least one product to the Product List.* | Toast | Server |
| Manual adder | A name and a price more than 0 | — | Red only | Browser |
| Manual adder | Name not already a manual product | *Already in the list — "X" is already a manual product on this target.* | Toast (warning) | Browser |
| Manual name (Edit) | Not blank | — | Red only | Browser |
| Target price (typing) | Digits and one point; up to 10 digits before, up to 2 after | — (extra characters are not typed) | — | Browser |
| Target price (save) | More than 0, up to ₹9,99,99,99,999.99, up to 2 decimals, up to 64 characters | *Enter a price more than 0 and up to ₹9,99,99,99,999.99, with at most 2 decimals* | Tooltip on the red field | Browser |
| Target price | Digits (commas allowed) with up to 2 decimals; manual products must have one | *The target price must be a number (up to 2 decimals).* · *Enter the target price.* | The row turns red + toast | Server |
| Master product | Must have a code | *Pick a product from the Product Master.* | Toast | Server |
| Manual product | Must have a name | *Enter the product name.* | Toast | Server |
| Remove a product | It has no suppliers | Lock icon with tooltip *Suppliers are mapped to this product — it can't be removed*; server: *"X" has suppliers mapped in the Sourcing Report and can't be removed. Unmap its suppliers first.* | Tooltip / toast | Both |
| Edit | Creator only | *Only the creator can edit this sourcing target.* | Toast | Server |
| Edit | The assignee is active | Info toast *View only — This sourcing target's assignee is inactive or exited, so it can't be edited.*; server: *This sourcing target's assignee is inactive or exited — it is view-only and can't be edited.* | Toast | Both |
| Open the target | Creator, assignee, client admin, super admin | *Couldn't open the target — Only the creator, the assignee or the client admin can open this sourcing target.* | Toast | Server |
| Save failed (any) | — | *Assign failed* / *Update failed* plus the server message | Toast | — |
| Products / Team list | Loaded | *Products not loaded — The Product Master list could not be loaded.* · *Team not loaded — The Assign To list could not be loaded.* | Toast | — |

### A.3 Product Clarity

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Link | Starts with http:// or https:// and has a dotted domain | *Enter a valid link starting with http:// or https://* | Dialog | Browser |
| PDF / image | PDF, JPG, PNG or WEBP, up to 5 MB | *Upload a PDF, JPG, PNG or WEBP file up to 5 MB.* | Dialog | Browser |
| Upload | Extension PDF, JPG, JPEG, PNG or WEBP | *The file must be a PDF, JPG, PNG, or WEBP.* | Toast (*Assign failed* / *Update failed*) | Server |
| Upload | Up to 5 MB | *The file field must not be greater than 5120 kilobytes.* | Toast | Server |
| View a file | A file of your company, still stored | *Couldn't open the document — Please try again.* | Toast | Server |

### A.4 Map Supplier — Supplier Master

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Map Supplier Directory / Add Supplier | Creator or assignee | *Only the creator or the assignee maps suppliers to this target*; server: *Only the creator or the assignee of this sourcing target can map suppliers.* | Tooltip / toast | Both |
| Supplier Name | Picked | *This field is required* | Field | Browser |
| Supplier Name | Not already mapped as Master | Greyed row: *"<name> — already mapped to this product"*; click: *Already mapped — <name> is already mapped to this product.* (International rows read *"<name> · <country>"* in both) | Tooltip / toast | Browser |
| Supplier Name | Not mapped as Master **and** no converted New Supplier row of it on the product | *"<name>" is already mapped to this product.* | Toast | Server |
| Price (typing) | Up to 10 digits before the point, up to 2 after | — | — | Browser |
| Price | More than 0 | *This field is required* | Field | Browser |
| Price | Required, more than 0, up to 9,999,999,999.99 | *Please enter the supplier's unit price.* · *The unit price must be more than 0.* · *The unit price cannot be more than 9,999,999,999.99.* | Field + toast | Server |
| Exchange rate (typing) | Up to 5 digits before the point, up to 4 after | — | — | Browser |
| Exchange rate | More than 0 | *This field is required* | Field | Browser |
| Exchange rate | More than 0, up to 99,999.9999; one must exist | *The exchange rate must be more than 0.* · *The exchange rate cannot be more than 99999.9999.* · *Please enter the exchange rate (₹ per USD).* | Field + toast | Server |
| Currency | Not INR for International | *Pick the supplier's currency — an International price is not in ₹.* | Field + toast | Server |
| Origin | Matches the supplier's country | *This supplier is based in India — map it as a Domestic supplier.* · *This supplier is based in <country> — map it as an International supplier.* | Toast | Server |
| Total | Price × rate up to ₹999,999,999,999.99 | *The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.* | Field + toast | Server |
| Edit price | Valid Till not in the past | *Price Valid Till cannot be in the past.* | Toast | Server |
| Edit price | The supplier is in the list | — (Update does nothing) | — | Browser |
| List load | — | *Suppliers not loaded — The Supplier Master list could not be loaded.* | Toast | — |
| Any failure | — | *Supplier not mapped* / *Supplier not updated* plus the message | Toast | — |

### A.5 Map Supplier — New Supplier

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Supplier Company Name | Not blank | *Enter the supplier company name* · server: *Enter the supplier company name.* | Field | Both |
| Contact Person | Not blank | *Enter the contact person* | Field | Browser |
| Mobile (Domestic) | 10 digits (only digits can be typed, max 10) | *Enter a 10-digit mobile number* | Field | Browser |
| Mobile (International) | Optional +, then 7–18 characters starting with a digit (digits, spaces, dashes; max 20 typed). Pattern: ^\+?\d[\d\s-]{6,17}$ | *Enter the mobile number with its country code* | Field | Browser |
| Segment | Picked | *Select a segment* | Field | Browser |
| Email ID | Looks like a@b.c | *Enter a valid email ID* · server: *Enter a valid supplier email address.* | Field | Both |
| Email ID | Not used by any supplier / New Supplier in the system (checked when a new directory entry is created) | *This email address is already used by another vendor or supplier in the system. Please use a different address.* | Field + toast | Server |
| Street Address | Not blank | *Enter the street address* | Field | Browser |
| Country | Domestic: not blank; International: picked | *Enter the country* · *Select a country* | Field | Browser |
| Country (server) | International outside India; Domestic in India | *Please select the supplier's country (outside India).* · *A Domestic supplier must be in India — choose International for an overseas supplier.* (can't be reached from the form) | Field | Server |
| Country on Edit | Stays on the saved origin | *This is an International supplier — choose a country outside India.* · *This is a Domestic supplier — the country must be India.* | Field | Server |
| State (Domestic) | Picked | *Select a state* | Field | Browser |
| City | Not blank | *Enter the city* | Field | Browser |
| Unit Price | More than 0 (typing capped 10 + 2) | *Enter the unit price (excl. GST)* / *Enter the unit price* | Field | Browser |
| Unit Price (server) | As in A.4 on a **new** mapping; on **Edit** the system's standard wording (for example *The price field must be greater than 0.*) | As in A.4 / standard wording | Field | Server |
| Exchange Rate | More than 0 (typing capped 5 + 4) | *Enter the exchange rate* | Field | Browser |
| Price Valid Till | Today or later | New mapping: *Price Valid Till cannot be in the past.* · Edit: *The valid till field must be a date after or equal to today.* An **expired** date saved earlier is resent on Edit, so the user must change or clear it first | Field | Server |
| Business Card | PDF, JPG or PNG, up to 5 MB | *PDF, JPG or PNG up to 5 MB.* | Under the card | Browser |
| Name already converted | — | *"X" is already in the Supplier Master — map it from Supplier Master.* | Toast | Server |
| Name already on this product | — | *"X" is already mapped to this product.* | Toast | Server |
| Product removed meanwhile | — | *Product not found in this sourcing target.* | Toast | Server |

### A.6 Mapped Suppliers and Convert

| Field / action | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Edit (New) | Only New Supplier rows | *Only new (manual) suppliers can be edited here. Edit master suppliers from the Supplier master.* | Toast | Server |
| Edit | Creator or assignee | Edit icon hidden; server: *…can edit its suppliers.* / *…can change a mapped supplier's price.* | — / toast | Both |
| Mapping gone | — | *Mapped supplier not found for this product.* | Toast | Server |
| Load | — | *Couldn't load the suppliers* (with Retry) | Popup | — |
| Convert — already converted | — | *<name> is already in the Supplier Master — Its mappings show it as Master.* | Toast (info) | Server |
| Convert — prefill fails | — | *Couldn't open Convert to Supplier* plus the message | Toast | Server |
| Convert — Contacts step | New Supplier of your company, not converted into another supplier | *Save failed — This New Supplier cannot be converted into this supplier.* | Wizard toast | Server |
| Convert — Contacts step | Email not used by another supplier | *Save failed — This email address is already used by another vendor or supplier in the system. Please use a different address.* | Wizard toast | Server |
| Convert — final link | The form returned the supplier's id | *Supplier saved, not linked — <name> was saved, but its id did not come back. Open Convert to Supplier again to link it.* | Toast | Browser |
| Convert — final link | Supplier of your company; not converted into another | *Supplier saved, not linked — Unknown supplier in the Supplier Master.* / *…"X" is already converted to another supplier in the Supplier Master.* | Toast | Server |

The Add Supplier form's own field rules (State Code, contact number, email, bank account, GST scrutiny…) are in the Supplier Management documents.

---

## APPENDIX B — KNOWN GAPS

These are gaps in the module as built today. The **No.** is the original gap number, kept for reference. Impact is a guide for prioritising: **High** = wrong data or a blocked task; **Medium** = confusing or weaker control; **Low** = cosmetic or wording.

### B.1 List & search

| No. | Gap | Impact |
|---|---|---|
| 1 | The **RFQ** tab shows a fixed count of **129** and is disabled. RFQ isn't built, though the header and menu description mention it | Low |
| 3 | Search matches only *In Progress*, *Completed* and *overdue* — not *at risk* / *on track*. Dates match only as yyyy-mm-dd or dd/mm/yyyy | Low |
| 7 | A pending product is **In Progress** in the Product List but **Pending** in the Report | Low |
| 16 | The list header says **"I Want to Source To"** but the form says **"I want to source from"** | Low |

### B.2 Targets & products

| No. | Gap | Impact |
|---|---|---|
| 4 | The **source** (Master / Manual) can be switched on Edit, though the design intent was for it to be locked | Low |
| 5 | On Edit the TAT may be a **past** date as long as it is after the start date; the server doesn't check it on update | Medium |
| 8 | **No unmap** — a Completed product can never go back to pending | Medium |
| 9 | The clarity upload says *"Click to upload a PDF specification"*, but JPG, PNG and WEBP are accepted too | Low |
| 15 | The Add form's **ID is a preview**; the saved code can differ when two people create at once | Low |
| 23 | The **target's product** segment field still holds only 128 characters, while a Product Master segment name can be up to 255. Saving a target with a master product whose segment name is longer than 128 characters fails with a server error | High |
| 32 | A sourcing target **can't be deleted** — there is no button and no delete function | Medium |
| 38 | Typing caps (CS-2308) stop over-long prices in the forms, but the **server** still accepts a target price of any size up to 64 characters (for example through the API); such values show "…" on the screens | Low |

### B.3 Supplier Master mapping

| No. | Gap | Impact |
|---|---|---|
| 6 | The **Supplier Master** form has no INR equivalent, no *vs Target Price* and no *Price Valid Till*. The New Supplier **International** form has no *vs Target* tile | Low |
| 14 | *"Supplier mapped"* is an **info** toast; every other success is a success toast | Low |
| 30 | The Supplier Master list greys out only suppliers mapped as **Master**. A supplier whose converted New Supplier row is still on the product can be picked, and is then refused by the server (*"already mapped"*) as an error toast | Low |
| 33 | The **Supplier Master** list shows every Supplier Master record you can see, **whatever its status** — an inactive or half-filled supplier can be mapped. Its *"{n} available"* counts also include suppliers already mapped to the product | Medium |

### B.4 New Supplier mapping

| No. | Gap | Impact |
|---|---|---|
| 10 | The business card refuses **WEBP** in the browser; the server would accept it | Low |
| 11 | The Domestic **Country** field can be typed in, but the form always saves **India** — what is typed is ignored | Low |
| 12 | A New Supplier whose **name** matches an existing directory entry reuses it: the newly typed details stay on the mapping only, the duplicate-email check is skipped, and Convert fills from the **old** entry | High |
| 19 | Two **different** New Suppliers with the **same name** end up sharing one directory entry — and one Convert | High |
| 35 | On the New Supplier form the **GST Type** is saved as shown — a user can save *Intra-state* for a supplier in another state | Medium |

### B.5 Editing mappings

| No. | Gap | Impact |
|---|---|---|
| 13 | The Mapped Suppliers empty text (*"Click "Add Supplier"…"*) can't be reached — the popup only opens when the count is above 0 | Low |
| 17 | **Edit price** on a Supplier Master mapping **always fails once its Valid Till date has passed** — the form resends the old date and has no field to change it | High |
| 21 | Editing a domestic New Supplier saved at **0 % GST** reopens the form at **18 %** | Medium |
| 31 | **Edit price** on a Supplier Master mapping does **nothing, with no message**, when that supplier isn't in the form's Supplier Master list. The list holds only suppliers visible to your branch, filtered by the supplier's **current** country (for example a supplier converted in another branch, or one whose country changed between Domestic and International). The locked Supplier Name field is empty and **Update** silently does nothing | Medium |
| 34 | **Edit price** on a Domestic Supplier Master mapping decides CGST + SGST vs IGST again from the **editing person's** branch. If the creator and the assignee are in different branches, the GST type can flip on re-price | Medium |
| 36 | **Edit supplier & quote** saves the details to the New Supplier directory entry **without the duplicate-email check**, and any optional field left empty is cleared on both the mapping and the directory entry | Medium |
| 39 | **Edit supplier & quote** on a New Supplier card fails once its **Price Valid Till** date has passed: the form resends the saved (now past) date and the server refuses it under the Valid Till field (*"The valid till field must be a date after or equal to today."*) until the user changes or clears the date | Medium |
| 40 | **Edit price** can **silently change the GST %**: if the saved rate is no longer an active GST master rate, the form resets it to 18 % (or the first master rate), and Update re-prices at that rate without saying so | High |
| 41 | **Edit supplier & quote** rewrites the **shared** New Supplier directory entry (name included). Every mapping of that New Supplier on every target — and every New Supplier of the same name — shares that entry, so editing one card renames it everywhere and changes what a later **Convert** fills in. The new name is not checked against other entries | High |

### B.6 Convert

| No. | Gap | Impact |
|---|---|---|
| 26 | **Cancel after the Contacts step** of Convert still converts the New Supplier (the link is already made), but its **business card is not copied** — the card is copied only when the whole form is saved | Low |
| 27 | Closing the Convert form **before** the Contacts step leaves the supplier created at the first step in the Supplier Master, **unlinked**. A new Convert attempt starts a fresh Add Supplier form (a second supplier record) | Medium |
| 28 | The **Converted** badge is per supplier, not per card: any Master card of a supplier that was created by converting a New Supplier shows it — even one mapped directly from the Supplier Master | Low |
| 29 | *"Supplier saved, not linked"* can show although the link was already made at the Contacts step (for example when the final link call failed) | Low |
| 37 | The Add Supplier form has its own rules — a typed New Supplier State Code that isn't 1–2 digits, or a state / country / segment name not in the masters, must be corrected there; the contact's Designation must be typed | Low |

### B.7 Access & data

| No. | Gap | Impact |
|---|---|---|
| 2 | **"All Sourcing Targets"** is only your own (created / assigned) targets. Client admin and super admin can't open the page, though the API would let them view (and super admin map) | Medium |
| 18 | Suppliers can still be **mapped and re-priced** on a target whose assignee is inactive (only the target itself is view-only) | Medium |
| 20 | **Anyone in the company** who can open a Report can **Convert** a New Supplier — there is no creator / assignee check on Convert | Medium |

### B.8 Fixed recently

| No. | What was fixed |
|---|---|
| 22 | CS-2211: the target price is now checked in the form and the row is highlighted |
| 23 (part) | A database update widened the New Supplier segment fields to 512 characters, matching the server rule. (The target's product segment field is still open — see B.2) |
| 24 | The Assign To list is no longer limited to Sales / Purchase departments, and self-assign is now allowed |
| 25 | Closing the Add Supplier form after its Contacts step no longer leaves the New Supplier unlinked with the Convert button still showing; the link is now made at the Contacts step |

---

## APPENDIX C — CHANGE LOG

| Date | Change |
|---|---|
| 23-Nov-2026 | Documentation rewritten for readability. Last verified 23-Nov-2026 against the current code |

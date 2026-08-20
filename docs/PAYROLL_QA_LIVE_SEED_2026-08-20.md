# Payroll QA Test Data — Inserted on LIVE

**Tenant:** Client 10 / Branch 27 (Healthcare) · **Months:** June 2026 and July 2026
**Database:** `cross_border_command` @ `cbc-postgres-server.postgres.database.azure.com` (cbc.idims.in)
**Prepared:** 20 Aug 2026 · **Employees covered:** 30 · **Scenarios:** 14

> Payroll was **not** run. No attendance finalized, no payroll run generated, no payslips created.
> Only attendance, punches, leave requests and overtime rows were inserted.

---

## 1. Totals inserted

| Item | Count |
|---|---|
| Attendance rows | 1830 |
| Punch records | 2851 |
| Leave requests (approved) | 78 |
| Overtime adjustments (approved) | 6 |

## 2. Shift windows used

| Shift | Window (IST) | Notes |
|---|---|---|
| Morning Shift | 09:30 – 18:30 | Corrected — previously configured 09:30 → 06:30 |
| General Shift | 09:30 – 18:30 | Newly added — did not exist, 10 employees referenced it |
| Evening Shift | 18:00 – 03:00 | Overnight — check-out lands next day |
| Night Shift | 21:00 – 06:00 | Overnight — check-out lands next day |

Late marks are derived by the payroll engine as **check-in later than shift start + 10 min grace**.
Branch late-mark policy: **3 late marks = 0.5 day LOP**.

---

## 3. Scenario-by-scenario detail

### Scenario 1 — Correct On Time

_Every working day punched exactly at shift start and shift end._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-065 | Gaurav Jagtap | 534 | Morning Shift (09:30–18:30) | Saturday & Sunday | Jun 2026 | 21 | 0 | 0 | 8 | 1 | 44 | 0 | — |
| EMP-065 | Gaurav Jagtap | 534 | Morning Shift (09:30–18:30) | Saturday & Sunday | Jul 2026 | 23 | 0 | 0 | 7 | 1 | 46 | 0 | — |
| EMP-063 | Athrva haldankar | 531 | Morning Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 0 | — |
| EMP-063 | Athrva haldankar | 531 | Morning Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 0 | — |
| EMP-062 | Omkar Kawade | 530 | Morning Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 0 | — |
| EMP-062 | Omkar Kawade | 530 | Morning Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 52 | 0 | — |
| EMP-061 | CHETNA SAHU | 529 | Morning Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 0 | — |
| EMP-061 | CHETNA SAHU | 529 | Morning Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 0 | — |

### Scenario 2 — 4 Days Late 30 min + 30 min Late Out

_Four days in +30 min and out +30 min; all other days on time._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-060 | Himanshu Patil | 528 | Evening Shift (18:00–03:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 4 | — |
| EMP-060 | Himanshu Patil | 528 | Evening Shift (18:00–03:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 4 | — |
| EMP-057 | Vipul Patil | 521 | Evening Shift (18:00–03:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 4 | — |
| EMP-057 | Vipul Patil | 521 | Evening Shift (18:00–03:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 4 | — |
| EMP-055 | Suraj Bangar | 519 | Night Shift (21:00–06:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 51 | 4 | — |
| EMP-055 | Suraj Bangar | 519 | Night Shift (21:00–06:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 4 | — |
| EMP-053 | Pallavi Bhuruk | 517 | Night Shift (21:00–06:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 51 | 4 | — |
| EMP-053 | Pallavi Bhuruk | 517 | Night Shift (21:00–06:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 4 | — |

**Dates:**

- **EMP-060** Jun 2026 late on: 01 Jun, 02 Jun, 03 Jun, 04 Jun
- **EMP-060** Jul 2026 late on: 01 Jul, 02 Jul, 03 Jul, 06 Jul
- **EMP-057** Jun 2026 late on: 01 Jun, 02 Jun, 03 Jun, 04 Jun
- **EMP-057** Jul 2026 late on: 01 Jul, 02 Jul, 03 Jul, 06 Jul
- **EMP-055** Jun 2026 late on: 01 Jun, 02 Jun, 03 Jun, 04 Jun
- **EMP-055** Jul 2026 late on: 01 Jul, 02 Jul, 03 Jul, 06 Jul
- **EMP-053** Jun 2026 late on: 01 Jun, 02 Jun, 03 Jun, 04 Jun
- **EMP-053** Jul 2026 late on: 01 Jul, 02 Jul, 03 Jul, 06 Jul

### Scenario 3 — Every Day Late 30 min + 21:30 Out

_In +30 min every working day, out at 21:30._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-052 | Harshad Wangane | 516 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 25 | — |
| EMP-052 | Harshad Wangane | 516 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 26 | — |
| EMP-050 | Amisha Mahaseth | 514 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 25 | — |
| EMP-050 | Amisha Mahaseth | 514 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 26 | — |
| EMP-049 | Rutuja More | 513 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 25 | — |
| EMP-049 | Rutuja More | 513 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 26 | — |
| EMP-047 | Jaywardhan Pradhan | 510 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 25 | — |
| EMP-047 | Jaywardhan Pradhan | 510 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 52 | 26 | — |

### Scenario 4 — 5 Days Leave

_Five consecutive working days of approved PAID leave._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-046 | Niraj Hiremath | 509 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 20 | 0 | 5 | 4 | 1 | 42 | 0 | — |
| EMP-046 | Niraj Hiremath | 509 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 21 | 0 | 5 | 4 | 1 | 42 | 0 | — |
| EMP-045 | Subhashini Joshi | 507 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 21 | 0 | 5 | 4 | 0 | 44 | 0 | — |
| EMP-045 | Subhashini Joshi | 507 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 22 | 0 | 5 | 4 | 0 | 44 | 0 | — |
| EMP-044 | Omkar Yewale | 506 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 20 | 0 | 5 | 4 | 1 | 42 | 0 | — |
| EMP-044 | Omkar Yewale | 506 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 21 | 0 | 5 | 4 | 1 | 43 | 0 | — |

**Dates:**

- **EMP-046** Jun 2026 leave: 05 Jun (Annual Leave, full); 06 Jun (Annual Leave, full); 08 Jun (Annual Leave, full); 09 Jun (Annual Leave, full); 10 Jun (Annual Leave, full)
- **EMP-046** Jul 2026 leave: 07 Jul (Annual Leave, full); 08 Jul (Annual Leave, full); 09 Jul (Annual Leave, full); 10 Jul (Annual Leave, full); 11 Jul (Annual Leave, full)
- **EMP-045** Jun 2026 leave: 05 Jun (Annual Leave, full); 06 Jun (Annual Leave, full); 08 Jun (Annual Leave, full); 09 Jun (Annual Leave, full); 10 Jun (Annual Leave, full)
- **EMP-045** Jul 2026 leave: 06 Jul (Annual Leave, full); 07 Jul (Annual Leave, full); 08 Jul (Annual Leave, full); 09 Jul (Annual Leave, full); 10 Jul (Annual Leave, full)
- **EMP-044** Jun 2026 leave: 05 Jun (Annual Leave, full); 06 Jun (Annual Leave, full); 08 Jun (Annual Leave, full); 09 Jun (Annual Leave, full); 10 Jun (Annual Leave, full)
- **EMP-044** Jul 2026 leave: 07 Jul (Annual Leave, full); 08 Jul (Annual Leave, full); 09 Jul (Annual Leave, full); 10 Jul (Annual Leave, full); 11 Jul (Annual Leave, full)

### Scenario 5 — Sandwich Leave + Holiday / Saturday / Monday

_Paid leave on a Saturday and the following Monday, bracketing the Sunday._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-043 | trupti patil | 505 | Evening Shift (18:00–03:00) | Sunday Only | Jun 2026 | 23 | 0 | 2 | 4 | 1 | 48 | 0 | — |
| EMP-043 | trupti patil | 505 | Evening Shift (18:00–03:00) | Sunday Only | Jul 2026 | 24 | 0 | 2 | 4 | 1 | 54 | 0 | — |
| EMP-042 | Anjali Patil | 427 | Morning Shift (09:30–18:30) | Sunday Only | Jun 2026 | 23 | 0 | 2 | 4 | 1 | 48 | 0 | — |
| EMP-042 | Anjali Patil | 427 | Morning Shift (09:30–18:30) | Sunday Only | Jul 2026 | 24 | 0 | 2 | 4 | 1 | 49 | 0 | — |
| EMP-037 | Shlok Kangane | 306 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 23 | 0 | 2 | 4 | 1 | 48 | 0 | — |
| EMP-037 | Shlok Kangane | 306 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 24 | 0 | 2 | 4 | 1 | 49 | 0 | — |
| EMP-036 | Keshav Sharma | 304 | General Shift (09:30–18:30) | Sunday Only | Jun 2026 | 23 | 0 | 2 | 4 | 1 | 48 | 0 | — |
| EMP-036 | Keshav Sharma | 304 | General Shift (09:30–18:30) | Sunday Only | Jul 2026 | 24 | 0 | 2 | 4 | 1 | 48 | 0 | — |

**Dates:**

- **EMP-043** Jun 2026 leave: 13 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-043** Jul 2026 leave: 18 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)
- **EMP-042** Jun 2026 leave: 13 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-042** Jul 2026 leave: 18 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)
- **EMP-037** Jun 2026 leave: 13 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-037** Jul 2026 leave: 18 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)
- **EMP-036** Jun 2026 leave: 13 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-036** Jul 2026 leave: 18 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)

### Scenario 6 — Sandwich Leave — Rotational Shift

_Paid leave Friday + Monday around a rotational off Saturday._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-035 | Shreyash Kashid | 167 | Evening Shift (18:00–03:00) | Rotational — 1st & 3rd Saturday | Jun 2026 | 21 | 0 | 2 | 6 | 1 | 44 | 0 | — |
| EMP-035 | Shreyash Kashid | 167 | Evening Shift (18:00–03:00) | Rotational — 1st & 3rd Saturday | Jul 2026 | 23 | 0 | 2 | 5 | 1 | 46 | 0 | — |
| EMP-033 | Amol Rathod | 165 | Evening Shift (18:00–03:00) | Rotational — 1st & 3rd Saturday | Jun 2026 | 21 | 0 | 2 | 6 | 1 | 44 | 0 | — |
| EMP-033 | Amol Rathod | 165 | Evening Shift (18:00–03:00) | Rotational — 1st & 3rd Saturday | Jul 2026 | 23 | 0 | 2 | 5 | 1 | 46 | 0 | — |

**Dates:**

- **EMP-035** Jun 2026 leave: 12 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-035** Jul 2026 leave: 10 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)
- **EMP-033** Jun 2026 leave: 12 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-033** Jul 2026 leave: 10 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)

### Scenario 7 — Sandwich Leave — Saturday + Sunday Policy

_Paid leave Friday + Monday bracketing the Sat/Sun weekend._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-031 | Suraj Randave | 157 | Night Shift (21:00–06:00) | Saturday & Sunday | Jun 2026 | 19 | 0 | 2 | 8 | 1 | 39 | 0 | — |
| EMP-031 | Suraj Randave | 157 | Night Shift (21:00–06:00) | Saturday & Sunday | Jul 2026 | 21 | 0 | 2 | 7 | 1 | 43 | 0 | — |
| EMP-030 | Durgesh urkude | 155 | Night Shift (21:00–06:00) | Saturday & Sunday | Jun 2026 | 19 | 0 | 2 | 8 | 1 | 39 | 0 | — |
| EMP-030 | Durgesh urkude | 155 | Night Shift (21:00–06:00) | Saturday & Sunday | Jul 2026 | 21 | 0 | 2 | 7 | 1 | 43 | 0 | — |

**Dates:**

- **EMP-031** Jun 2026 leave: 12 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-031** Jul 2026 leave: 10 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)
- **EMP-030** Jun 2026 leave: 12 Jun (Annual Leave, full); 15 Jun (Annual Leave, full)
- **EMP-030** Jul 2026 leave: 10 Jul (Annual Leave, full); 20 Jul (Annual Leave, full)

### Scenario 8 — Overtime — Time and a Half (1.5x)

_Five days of +2 h worked, plus 10 approved OT hours._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-029 | Sakshi Kale | 153 | Morning Shift (09:30–18:30) | Rotational — 2nd & 4th Saturday | Jun 2026 | 23 | 0 | 0 | 6 | 1 | 48 | 0 | 10 |
| EMP-029 | Sakshi Kale | 153 | Morning Shift (09:30–18:30) | Rotational — 2nd & 4th Saturday | Jul 2026 | 24 | 0 | 0 | 6 | 1 | 49 | 0 | 10 |

### Scenario 9 — Overtime — Double Time and a Half (2.5x)

_Five days of +2 h worked, plus 10 approved OT hours._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-028 | Bhavika Holkar | 151 | Evening Shift (18:00–03:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 52 | 0 | 10 |
| EMP-028 | Bhavika Holkar | 151 | Evening Shift (18:00–03:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 53 | 0 | 10 |

### Scenario 10 — Overtime — Double Time (2.0x)

_Five days of +2 h worked, plus 10 approved OT hours._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-026 | Yash Kamble | 147 | Night Shift (21:00–06:00) | Sunday Only | Jun 2026 | 25 | 0 | 0 | 4 | 1 | 51 | 0 | 10 |
| EMP-026 | Yash Kamble | 147 | Night Shift (21:00–06:00) | Sunday Only | Jul 2026 | 26 | 0 | 0 | 4 | 1 | 55 | 0 | 10 |

### Scenario 11 — Leave 1 — Paid 1

_One day of approved PAID leave._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-003 | Manav Pimparkar | 123 | Morning Shift (09:30–18:30) | Rotational — 1st & 3rd Saturday | Jun 2026 | 22 | 0 | 1 | 6 | 1 | 46 | 0 | — |
| EMP-003 | Manav Pimparkar | 123 | Morning Shift (09:30–18:30) | Rotational — 1st & 3rd Saturday | Jul 2026 | 24 | 0 | 1 | 5 | 1 | 49 | 0 | — |

**Dates:**

- **EMP-003** Jun 2026 leave: 08 Jun (Annual Leave, full)
- **EMP-003** Jul 2026 leave: 08 Jul (Annual Leave, full)

### Scenario 12 — Leave 3 — Paid 2

_Three leave days: two PAID (Annual) + one UNPAID (Casual)._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-002-D69 | Ritika Umbarje | 122 | Morning Shift (09:30–18:30) | Rotational — 1st & 3rd Saturday | Jun 2026 | 20 | 0 | 3 | 6 | 1 | 42 | 0 | — |
| EMP-002-D69 | Ritika Umbarje | 122 | Morning Shift (09:30–18:30) | Rotational — 1st & 3rd Saturday | Jul 2026 | 22 | 0 | 3 | 5 | 1 | 44 | 0 | — |

**Dates:**

- **EMP-002-D69** Jun 2026 leave: 08 Jun (Annual Leave, full); 09 Jun (Annual Leave, full); 10 Jun (Casual Leave, full)
- **EMP-002-D69** Jul 2026 leave: 08 Jul (Annual Leave, full); 09 Jul (Annual Leave, full); 10 Jul (Casual Leave, full)

### Scenario 13 — Fri + Sat Paid Leave

_Paid leave on a Friday and the following Saturday._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-005 | Bhuvansai Kondalwadi | 125 | Morning Shift (09:30–18:30) | Sunday Only | Jun 2026 | 23 | 0 | 2 | 4 | 1 | 48 | 0 | — |
| EMP-005 | Bhuvansai Kondalwadi | 125 | Morning Shift (09:30–18:30) | Sunday Only | Jul 2026 | 24 | 0 | 2 | 4 | 1 | 51 | 0 | — |

**Dates:**

- **EMP-005** Jun 2026 leave: 12 Jun (Annual Leave, full); 13 Jun (Annual Leave, full)
- **EMP-005** Jul 2026 leave: 10 Jul (Annual Leave, full); 11 Jul (Annual Leave, full)

### Scenario 14 — Half Day x5, 2 Paid

_Five half days; two backed by a paid half-day leave request._

| Employee | Name | User ID | Shift | Weekly Off | Month | Present | Half Day | Leave | Weekly Off | Holiday | Punches | Late Marks | OT Hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP-001-D56 | Atharva Patekar | 105 | General Shift (09:30–18:30) | Saturday & Sunday | Jun 2026 | 16 | 5 | 0 | 8 | 1 | 44 | 0 | — |
| EMP-001-D56 | Atharva Patekar | 105 | General Shift (09:30–18:30) | Saturday & Sunday | Jul 2026 | 18 | 5 | 0 | 7 | 1 | 46 | 0 | — |

**Dates:**

- **EMP-001-D56** Jun 2026 leave: 03 Jun (Annual Leave, first_half); 04 Jun (Annual Leave, first_half)
- **EMP-001-D56** Jun 2026 half days: 03 Jun, 04 Jun, 05 Jun, 08 Jun, 09 Jun
- **EMP-001-D56** Jul 2026 leave: 03 Jul (Annual Leave, first_half); 06 Jul (Annual Leave, first_half)
- **EMP-001-D56** Jul 2026 half days: 03 Jul, 06 Jul, 07 Jul, 08 Jul, 09 Jul

---

## 4. Corrections made to the source sheet

Employee codes are unique **per client only**, so three codes in the sheet matched employees at other companies. Everything was keyed off **User ID**, which resolved all 30 correctly.

| Sheet said | Correct code | Employee |
|---|---|---|
| EMP-058 | **EMP-057** | Vipul Patil (User 521) |
| EMP-022 | **EMP-002-D69** | Ritika Umbarje (User 122) |
| EMP-001 | **EMP-001-D56** | Atharva Patekar (User 105) |

## 5. Configuration fixed before seeding

These were pre-existing data problems on Branch 27 that would have made the scenarios produce meaningless figures.

| # | Change | Scope | Reason |
|---|---|---|---|
| 1 | `date_of_joining` set to 01 Jun 2026 | 23 employees | 20 had joined 28–29 Jul 2026, so June and most of July were before they were hired |
| 2 | Annual Leave marked **Paid** | Leave type 21 | Branch 27 had **no** paid leave type at all — scenarios 4, 5, 6, 7, 11, 12, 13, 14 need one |
| 3 | Shift master rebuilt | Branch 27 | "Mroning Shift" was configured 09:30 → **06:30** (end before start) |
| 4 | "General Shift" added | Branch 27 | Did not exist, yet 10 employees were assigned to it |
| 5 | Shift name normalised | 10 employees | Re-pointed from the misspelled "Mroning Shift" |
| 6 | `weekly_off` → Sunday Only | EMP-005 | Saturday was a weekly off, so "Fri + Sat leave" could not exist |

## 6. Known issues still open (not caused by this seeding)

- The `clients` record for id 10 has an **empty company name** — will render blank on payslips, PDFs and branding.
- **Emergency Leave** and **Half-Day Leave** on Branch 27 have **no paid/unpaid flag** set. The engine treats anything not explicitly `Paid` as unpaid.
- **June 2026 payroll is on an approved run.** It must be reopened (Payroll → Jun 2026 → *Reopen Cycle*) before the new attendance affects payroll.
- **July 2026 has a stale generated run** computed against the old joining dates — re-run it.

## 7. Next steps for QA

1. Open **Payroll → Jun 2026** → **Reopen Cycle**, then **Run Payroll**.
2. Open **Payroll → Jul 2026** → **Run Payroll** (regenerates the stale run).
3. Compare each employee against the expected result for their scenario above.
4. Late-mark check: 3 late marks = 0.5 day LOP, so Scenario 2 (4 lates) = 0.5 day, Scenario 3 (25–26 lates) = 4–4.5 days.


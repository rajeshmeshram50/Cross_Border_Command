/* =====================================================================
 * DSA PRACTICE — 01: ARRAYS
 * =====================================================================
 *
 * HOW TO USE
 *   1. Scroll to "YOUR SOLUTIONS" and fill in the function bodies.
 *   2. Run it:
 *
 *        node dsa-practice/01-arrays.js          # run everything
 *        node dsa-practice/01-arrays.js 3        # run only problem 3
 *        node dsa-practice/01-arrays.js 3 5      # run problems 3 and 5
 *
 *   3. Unsolved problems (still returning `undefined`) are reported as
 *      TODO, not as failures — so you can work through them one at a time.
 *
 * Problems ramp Easy -> Medium. Problem 7 is taken straight out of this
 * repo (the customer tab-pill counts), so you can see the same pattern in
 * production code afterwards.
 * ===================================================================== */


/* =====================================================================
 * YOUR SOLUTIONS  —  write your code below this line
 * ===================================================================== */


/* ---------------------------------------------------------------------
 * 1. TWO SUM                                                     [Easy]
 *
 * Given an array of integers `nums` and an integer `target`, return the
 * indices of the two numbers that add up to `target`.
 *
 * You may assume exactly one valid answer exists, and you may not use
 * the same element twice. Return the pair as an array, e.g. [0, 1].
 *
 *   twoSum([2, 7, 11, 15], 9)  ->  [0, 1]     (2 + 7 === 9)
 *   twoSum([3, 2, 4], 6)       ->  [1, 2]     (2 + 4 === 6)
 *
 * The naive answer is two nested loops: O(n^2).
 * Can you do it in ONE pass, O(n)?
 *
 * HINT: as you walk the array, ask "have I already seen the number that
 * would complete this pair?" What structure answers that question in
 * O(1)?  (Same reason SalesQPI.tsx uses a Map for leadPriceMap.)
 * ------------------------------------------------------------------- */
function twoSum(nums, target) {
  let ans= [];
  let sum = 0;
  for(let i=0;i< nums.length-1; i++){
    for(let j=1; j< nums.length; j++){
      sum = nums[i]+nums[j];

    if(sum == target){
      return ans= [i,j];
    }
    }
      }
  return ans;
}


/* ---------------------------------------------------------------------
 * 2. CONTAINS DUPLICATE                                          [Easy]
 *
 * Return true if any value appears at least twice in the array, and
 * false if every element is distinct.
 *
 *   containsDuplicate([1, 2, 3, 1])     ->  true
 *   containsDuplicate([1, 2, 3, 4])     ->  false
 *   containsDuplicate([])               ->  false
 *
 * HINT: this is the exact job a Set exists for. Compare your solution to
 * how DataTable.tsx dedupes its page-size options.
 * ------------------------------------------------------------------- */
function containsDuplicate(nums) {

  let map = new Map();
  for(let i=0; i<nums.length-1;i++){
    map = nums[i];
     if(map.has(i)) return true;
  }
 

  return false;
  
}


/* ---------------------------------------------------------------------
 * 3. BEST TIME TO BUY AND SELL STOCK                             [Easy]
 *
 * `prices[i]` is the price of a stock on day i. Choose ONE day to buy
 * and a LATER day to sell. Return the maximum profit. If no profit is
 * possible, return 0.
 *
 *   maxProfit([7, 1, 5, 3, 6, 4])  ->  5     (buy at 1, sell at 6)
 *   maxProfit([7, 6, 4, 3, 1])     ->  0     (prices only fall)
 *
 * HINT: you do not need to remember every price. Walking left to right,
 * what are the only TWO numbers you need to keep track of?
 * ------------------------------------------------------------------- */
function maxProfit(prices) {
  let buy = 0; 
  let sell = 0;
  let profit = 0;

  for(let i=0;i<prices.length-1;i++){
    for (let j=1; j<prices.length; j++){
      buy= prices[i];
      sell= prices[j];
      profit = sell-buy;
    }
  }
  
}


/* ---------------------------------------------------------------------
 * 4. MOVE ZEROES                                                 [Easy]
 *
 * Move all 0s to the end of the array while keeping the relative order
 * of the non-zero elements.
 *
 * !! MODIFY THE ARRAY IN PLACE. Do not return a new array. !!
 *
 *   nums = [0, 1, 0, 3, 12]   ->  nums becomes [1, 3, 12, 0, 0]
 *   nums = [0]                ->  nums becomes [0]
 *
 * HINT: two pointers. One scans every element; the other marks "where
 * the next non-zero should land". This is the classic read/write pointer
 * pattern — it shows up everywhere once you know it.
 * ------------------------------------------------------------------- */
function moveZeroes(nums) {
  // your code here (mutate `nums`, return nothing)
}


/* ---------------------------------------------------------------------
 * 5. MAXIMUM SUBARRAY                                          [Medium]
 *
 * Find the contiguous subarray with the largest sum, and return that sum.
 * The array always has at least one element.
 *
 *   maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4])  ->  6   ([4,-1,2,1])
 *   maxSubArray([-1])                             ->  -1
 *   maxSubArray([5, 4, -1, 7, 8])                 ->  23
 *
 * HINT (Kadane's algorithm): at each element ask one question — "is it
 * better to extend the previous subarray, or to start fresh here?"
 * Keep a running best alongside it. One pass, O(n), no extra memory.
 * ------------------------------------------------------------------- */
function maxSubArray(nums) {
  // your code here
}


/* ---------------------------------------------------------------------
 * 6. PRODUCT OF ARRAY EXCEPT SELF                              [Medium]
 *
 * Return an array `out` where out[i] is the product of every element in
 * `nums` EXCEPT nums[i].
 *
 *   productExceptSelf([1, 2, 3, 4])    ->  [24, 12, 8, 6]
 *   productExceptSelf([-1, 1, 0, -3])  ->  [0, 0, 9, 0]
 *
 * CONSTRAINTS: solve it WITHOUT division, in O(n) time.
 * (Division fails anyway the moment a zero appears — see case 2.)
 *
 * HINT: for each index, the answer is
 *       (product of everything to its LEFT) x (product of everything to
 *       its RIGHT).
 * Can you get all the left-products in one pass, then fold the
 * right-products in on a second pass backwards?
 * ------------------------------------------------------------------- */
function productExceptSelf(nums) {
  // your code here
}


/* ---------------------------------------------------------------------
 * 7. TAB COUNTS  (from this codebase)                          [Medium]
 *
 * This is the real problem in CustomerController::index. The customer
 * list shows tab pills: All / Recurring / Fresh. Today the backend runs
 * TWO extra COUNT queries to compute them.
 *
 * Given the rows the API already returned, compute all three counts in a
 * SINGLE pass — no extra queries, no filtering the array three times.
 *
 * Each row looks like: { id: 1, is_recurring: 1 }
 * `is_recurring` is truthy (1) when the customer has at least one lead,
 * and null / 0 / undefined otherwise.
 *
 * Return an object: { all, recurring, fresh }
 *
 *   tabCounts([{id:1, is_recurring:1}, {id:2, is_recurring:null}])
 *     ->  { all: 2, recurring: 1, fresh: 1 }
 *   tabCounts([])
 *     ->  { all: 0, recurring: 0, fresh: 0 }
 *
 * HINT: rows.filter(...).length three times is O(3n) and reads the array
 * three times. One loop with counters is O(n). Also note you only need
 * to COUNT one bucket — the other follows by subtraction, which is
 * exactly the trick the existing PHP already uses.
 * ------------------------------------------------------------------- */
function tabCounts(rows) {
  // your code here
}


/* ---------------------------------------------------------------------
 * 8. MERGE INTERVALS                                           [Medium]
 *
 * Given an array of intervals [start, end], merge all overlapping ones
 * and return the result sorted by start.
 *
 *   mergeIntervals([[1,3], [2,6], [8,10], [15,18]])
 *     ->  [[1,6], [8,10], [15,18]]
 *   mergeIntervals([[1,4], [4,5]])
 *     ->  [[1,5]]        (touching counts as overlapping)
 *
 * HINT: the problem is hard on unsorted input and easy on sorted input.
 * Sort by start first, then sweep left to right keeping ONE "current"
 * interval: either the next one overlaps (stretch the current end) or it
 * doesn't (push current, start a new one).
 *
 * This is the shape of every real date-range-merging feature — leave
 * overlaps, attendance shifts, booking calendars.
 * ------------------------------------------------------------------- */
function mergeIntervals(intervals) {
  // your code here
}


/* =====================================================================
 * TEST HARNESS  —  you don't need to edit anything below this line
 * ===================================================================== */

const PROBLEMS = [
  {
    id: 1,
    title: 'Two Sum',
    difficulty: 'Easy',
    fn: twoSum,
    // pair order doesn't matter, so normalise before comparing
    normalise: (v) => (Array.isArray(v) ? [...v].sort((a, b) => a - b) : v),
    cases: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
      { args: [[3, 2, 4], 6], expected: [1, 2] },
      { args: [[3, 3], 6], expected: [0, 1] },
      { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4] },
      { args: [[0, 4, 3, 0], 0], expected: [0, 3] },
    ],
  },
  {
    id: 2,
    title: 'Contains Duplicate',
    difficulty: 'Easy',
    fn: containsDuplicate,
    cases: [
      { args: [[1, 2, 3, 1]], expected: true },
      { args: [[1, 2, 3, 4]], expected: false },
      { args: [[1, 1, 1, 3, 3, 4, 3, 2, 4, 2]], expected: true },
      { args: [[]], expected: false },
      { args: [[7]], expected: false },
      { args: [[0, -1, 0]], expected: true },
    ],
  },
  {
    id: 3,
    title: 'Best Time to Buy and Sell Stock',
    difficulty: 'Easy',
    fn: maxProfit,
    cases: [
      { args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
      { args: [[7, 6, 4, 3, 1]], expected: 0 },
      { args: [[1, 2]], expected: 1 },
      { args: [[2, 1]], expected: 0 },
      { args: [[3, 3, 3]], expected: 0 },
      { args: [[2, 4, 1, 7]], expected: 6 },
    ],
  },
  {
    id: 4,
    title: 'Move Zeroes',
    difficulty: 'Easy',
    fn: moveZeroes,
    // in-place: ignore the return value, inspect argument 0 afterwards
    inspectArg: 0,
    cases: [
      { args: [[0, 1, 0, 3, 12]], expected: [1, 3, 12, 0, 0] },
      { args: [[0]], expected: [0] },
      { args: [[1, 2, 3]], expected: [1, 2, 3] },
      { args: [[0, 0, 1]], expected: [1, 0, 0] },
      { args: [[4, 0, 5, 0, 0, 6]], expected: [4, 5, 6, 0, 0, 0] },
    ],
  },
  {
    id: 5,
    title: 'Maximum Subarray',
    difficulty: 'Medium',
    fn: maxSubArray,
    cases: [
      { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expected: 6 },
      { args: [[-1]], expected: -1 },
      { args: [[5, 4, -1, 7, 8]], expected: 23 },
      { args: [[-2, -1, -3]], expected: -1 },
      { args: [[1]], expected: 1 },
      { args: [[8, -19, 5, -4, 20]], expected: 21 },
    ],
  },
  {
    id: 6,
    title: 'Product of Array Except Self',
    difficulty: 'Medium',
    fn: productExceptSelf,
    cases: [
      { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6] },
      { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0] },
      { args: [[2, 3]], expected: [3, 2] },
      { args: [[1, 0]], expected: [0, 1] },
      { args: [[0, 0]], expected: [0, 0] },
      { args: [[5, 1, 1, 1]], expected: [1, 5, 5, 5] },
    ],
  },
  {
    id: 7,
    title: 'Tab Counts (from CustomerController)',
    difficulty: 'Medium',
    fn: tabCounts,
    cases: [
      {
        args: [[{ id: 1, is_recurring: 1 }, { id: 2, is_recurring: null }]],
        expected: { all: 2, recurring: 1, fresh: 1 },
      },
      { args: [[]], expected: { all: 0, recurring: 0, fresh: 0 } },
      {
        args: [[{ id: 1, is_recurring: 1 }, { id: 2, is_recurring: 1 }]],
        expected: { all: 2, recurring: 2, fresh: 0 },
      },
      {
        args: [[{ id: 1 }, { id: 2, is_recurring: 0 }, { id: 3, is_recurring: null }]],
        expected: { all: 3, recurring: 0, fresh: 3 },
      },
      {
        args: [[
          { id: 1, is_recurring: 1 }, { id: 2, is_recurring: null },
          { id: 3, is_recurring: 1 }, { id: 4, is_recurring: 0 },
          { id: 5, is_recurring: 1 },
        ]],
        expected: { all: 5, recurring: 3, fresh: 2 },
      },
    ],
  },
  {
    id: 8,
    title: 'Merge Intervals',
    difficulty: 'Medium',
    fn: mergeIntervals,
    cases: [
      { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
      { args: [[[1, 4], [4, 5]]], expected: [[1, 5]] },
      { args: [[[1, 4], [0, 4]]], expected: [[0, 4]] },
      { args: [[[1, 4], [2, 3]]], expected: [[1, 4]] },
      { args: [[[5, 6], [1, 3]]], expected: [[1, 3], [5, 6]] },
      { args: [[[1, 10], [2, 3], [4, 5], [6, 7]]], expected: [[1, 10]] },
      { args: [[[1, 2]]], expected: [[1, 2]] },
    ],
  },
];

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[36m', grey: '\x1b[90m',
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const show = (v) => {
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch { return String(v); }
};

const clone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

function runProblem(p) {
  const label = `${C.bold}${p.id}. ${p.title}${C.reset} ${C.grey}[${p.difficulty}]${C.reset}`;

  // Probe: has the user written anything yet?
  let untouched = false;
  try {
    const probe = clone(p.cases[0].args);
    const out = p.fn(...probe);
    const observed = p.inspectArg !== undefined ? probe[p.inspectArg] : out;
    untouched = p.inspectArg !== undefined
      ? deepEqual(observed, p.cases[0].args[p.inspectArg])
        && !deepEqual(p.cases[0].args[p.inspectArg], p.cases[0].expected)
      : observed === undefined;
  } catch { untouched = false; }

  if (untouched) {
    console.log(`${label}  ${C.yellow}TODO — not implemented yet${C.reset}`);
    return { passed: 0, failed: 0, todo: 1 };
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  p.cases.forEach((tc, i) => {
    const args = clone(tc.args);
    let actual;
    let threw = null;
    try {
      const returned = p.fn(...args);
      actual = p.inspectArg !== undefined ? args[p.inspectArg] : returned;
    } catch (err) {
      threw = err;
    }

    const norm = p.normalise || ((v) => v);
    const ok = !threw && deepEqual(norm(actual), norm(tc.expected));

    if (ok) { passed += 1; return; }
    failed += 1;
    failures.push({ i, tc, actual, threw });
  });

  const badge = failed === 0
    ? `${C.green}PASS${C.reset}`
    : `${C.red}FAIL${C.reset}`;
  console.log(`${label}  ${badge} ${C.grey}(${passed}/${p.cases.length})${C.reset}`);

  failures.forEach(({ i, tc, actual, threw }) => {
    const inputs = tc.args.map(show).join(', ');
    console.log(`   ${C.red}x${C.reset} case ${i + 1}  input: ${C.blue}${inputs}${C.reset}`);
    if (threw) {
      console.log(`      ${C.red}threw:${C.reset} ${threw.message}`);
    } else {
      console.log(`      expected: ${C.green}${show(tc.expected)}${C.reset}`);
      console.log(`      actual:   ${C.red}${show(actual)}${C.reset}`);
    }
  });

  return { passed, failed, todo: 0 };
}

function main() {
  const wanted = process.argv.slice(2)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n));

  const list = wanted.length
    ? PROBLEMS.filter((p) => wanted.includes(p.id))
    : PROBLEMS;

  if (!list.length) {
    console.log(`${C.red}No problem matches ${process.argv.slice(2).join(' ')}.${C.reset}`);
    console.log(`Available: ${PROBLEMS.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}DSA PRACTICE — ARRAYS${C.reset}\n`);

  const total = { passed: 0, failed: 0, todo: 0 };
  list.forEach((p) => {
    const r = runProblem(p);
    total.passed += r.passed;
    total.failed += r.failed;
    total.todo += r.todo;
    console.log('');
  });

  const solved = list.length - total.todo;
  console.log(`${C.bold}Summary${C.reset}`);
  console.log(`  attempted : ${solved}/${list.length}`);
  console.log(`  ${C.green}passing   : ${total.passed}${C.reset}`);
  console.log(`  ${total.failed ? C.red : C.grey}failing   : ${total.failed}${C.reset}`);
  console.log(`  ${total.todo ? C.yellow : C.grey}todo      : ${total.todo}${C.reset}\n`);

  process.exit(total.failed > 0 ? 1 : 0);
}

main();

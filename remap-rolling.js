#!/usr/bin/env node
/**
 * remap-rolling.js — column-aligned, UTC-safe, selectable alignment
 *
 * - Reads a github-painter-style template.sh (2019 dates in echo/commit lines)
 * - Strips nested `git init/remote/pull/cd` so painting happens in the repo root
 * - Maps dates by (week column, weekday row) into the profile’s rolling grid
 * - Uses 53 visible weeks (GitHub’s profile grid width)
 * - Emits all commit dates as 12:00:00 GMT+0000 (UTC) to avoid DST shearing
 * - Alignment: 'left' | 'center' | 'right'  (default 'left', override with --align flag)
 *
 * Usage: node remap-rolling.js [--align=left|center|right] template.sh > paint.sh
 */

const fs = require("fs");

// Full 2019-style date string as produced by github-painter templates
const FULL_2019 =
  /[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s2019\s\d{2}:\d{2}:\d{2}\sGMT[+-]\d{4}\s\([^)]+\)/g;

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function gridStartUTC(year) {
  // Sunday on/before Jan 1
  const jan1 = Date.UTC(year, 0, 1);
  const wd = new Date(jan1).getUTCDay();    // 0=Sun..6=Sat
  return jan1 - wd * 86400000;
}
function weekStartUTC(dayUTCms) {
  const wd = new Date(dayUTCms).getUTCDay();
  return dayUTCms - wd * 86400000;          // Sunday 00:00 UTC of that week
}
function parseFullDayUTC(s) {
  // "Thu Jan 24 2019 00:00:00 GMT-0500 (Eastern Standard Time)" -> 2019-01-24 @ 00:00 UTC
  const m = s.match(/^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) (\d{2}) (\d{4}) /);
  if (!m) throw new Error("Bad date: " + s);
  const monStr = m[2], dd = +m[3], yyyy = +m[4];
  return Date.UTC(yyyy, MON.indexOf(monStr), dd, 0, 0, 0);
}
function fmtUTCNoon(dayUTCms) {
  const d = new Date(dayUTCms + 12 * 3600 * 1000); // noon UTC
  const dow = DOW[d.getUTCDay()];
  const mon = MON[d.getUTCMonth()];
  const dd  = String(d.getUTCDate()).padStart(2, "0");
  const yyyy= d.getUTCFullYear();
  return `${dow} ${mon} ${dd} ${yyyy} 12:00:00 GMT+0000 (UTC)`;
}

const toColRow   = i => ({ col: Math.floor(i / 7), row: i % 7 });
const fromColRow = (c, r) => c * 7 + r;

function parseArgs(argv) {
  const args = { align: "left" };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--align=")) {
      args.align = arg.slice("--align=".length).toLowerCase();
    } else if (!args.template) {
      args.template = arg;
    }
  }
  return args;
}

function main() {
  const { template: path, align } = parseArgs(process.argv);
  if (!path) {
    console.error("Usage: node remap-rolling.js [--align=left|center|right] template.sh > paint.sh");
    process.exit(2);
  }
  if (!["left", "center", "right"].includes(align)) {
    console.error("Align must be one of: left, center, right");
    process.exit(2);
  }

  let input = fs.readFileSync(path, "utf8");

  // --- Sanitize template: paint in repo root (no nested repo/network) ---
  [
    /^mkdir\s+github_painter.*$/gm,
    /^cd\s+github_painter.*$/gm,
    /^git\s+init.*$/gm,
    /^git\s+remote\s+add\s+origin.*$/gm,
    /^git\s+pull\s+origin.*$/gm
  ].forEach(re => (input = input.replace(re, "")));

  // Gather original (2019) message dates as anchor points
  const msgRe = new RegExp(
    String.raw`(?:^|\n)git\s+commit\s+--date='[^']*'\s+-m\s+'(` + FULL_2019.source + String.raw`)'`,
    "gm"
  );
  const msgs = [];
  for (let m; (m = msgRe.exec(input)) !== null; ) msgs.push(m[1]);
  if (!msgs.length) {
    // Nothing to map; pass through
    process.stdout.write(input);
    return;
  }

  // Day indices from the 2019 grid start
  const start2019 = gridStartUTC(2019);
  const idxs = msgs.map(s => Math.floor((parseFullDayUTC(s) - start2019) / 86400000));
  const colRows = idxs.map(toColRow);
  const minCol  = Math.min(...colRows.map(p => p.col));
  const maxCol  = Math.max(...colRows.map(p => p.col));
  const width   = maxCol - minCol + 1; // columns used by drawing

  // --- Profile grid window: 53 visible weeks ---
  const GRID_WEEKS = 53;
  const now = new Date();
  const todayUTC   = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisSunUTC = weekStartUTC(todayUTC);
  const windowStartUTC = thisSunUTC - (GRID_WEEKS - 1) * 7 * 86400000; // leftmost column (Sunday)
  const rightmostCol   = GRID_WEEKS - 1;                                // current week column
  const todayRow       = new Date(todayUTC).getUTCDay();                // 0=Sun..6=Sat

  if (width > GRID_WEEKS) {
    throw new Error(
      `Drawing uses ${width} columns but the rolling window only shows ${GRID_WEEKS}. ` +
      "Trim or shift the template before remapping."
    );
  }

  // ================== ALIGNMENT ==================
  let shiftCols;
  if (align === "left") {
    // Earliest drawing column -> left edge of window
    shiftCols = 0 - minCol;
  } else if (align === "right") {
    // Latest drawing column -> current week column
    shiftCols = rightmostCol - maxCol;
  } else {
    // 'center' — center columns within the 53-week window
    shiftCols = Math.floor((GRID_WEEKS - width) / 2) - minCol;
  }

  // Clamp inside [0 .. rightmostCol]
  shiftCols = Math.max(shiftCols, -minCol);
  shiftCols = Math.min(shiftCols, rightmostCol - maxCol);

  // Avoid placing pixels in *future* days of the current (rightmost) column
  const violatesFuture = p => (p.col + shiftCols === rightmostCol) && (p.row > todayRow);
  while (colRows.some(violatesFuture) && (minCol + shiftCols > 0)) {
    shiftCols -= 1; // nudge left by one column until all rightmost pixels are <= todayRow
  }
  if (colRows.some(violatesFuture)) {
    throw new Error(
      "Cannot align drawing without using future days in the current week. " +
      "Adjust the template to land earlier."
    );
  }

  // Remapper: move by columns/rows; output noon-UTC string
  function remapOne(fullStr) {
    const oldIdx = Math.floor((parseFullDayUTC(fullStr) - start2019) / 86400000);
    const { col, row } = toColRow(oldIdx);
    const newIdxFromWindow = fromColRow(col + shiftCols, row);     // >= 0 by construction
    const newDayUTC = windowStartUTC + newIdxFromWindow * 86400000;
    return fmtUTCNoon(newDayUTC);
  }

  // Replace echo line dates
  input = input.replace(
    /^echo\s+'.*$/gm,
    line => line.replace(FULL_2019, remapOne)
  );

  // Replace both --date and -m using the message date as source of truth
  const commitRe = new RegExp(
    String.raw`(git\s+commit\s+--date=')([^']*)('\s+-m\s+')(` + FULL_2019.source + String.raw`)(')`,
    "g"
  );
  input = input.replace(commitRe, (_, a, anyDate, b, msgDate, e) => {
    const mapped = remapOne(msgDate);
    return a + mapped + b + mapped + e;
  });

  process.stdout.write(input);
}
main();

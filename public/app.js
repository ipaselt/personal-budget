const $ = (id) => document.getElementById(id);
// Escape user-supplied text (CSV descriptions) before it goes into innerHTML.
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Compact dollar label for bar overlays, e.g. 1640 -> "$1.6k", 262 -> "$262".
const shortMoney = (n) => (n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n));
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};
const periodLabel = (t) => {
  if (t === 'overview') return 'Overview';
  if (t === 'all') return 'All Time';
  if (/^\d{4}$/.test(t)) return t; // year
  return monthLabel(t); // month
};

const PIE = [
  { key: 'spending', label: 'Spending', color: '#ff6a6a', cssVar: '--red' },
  { key: 'savings', label: 'Savings', color: '#6d8cff', cssVar: '--accent' },
  { key: 'leftover', label: 'Leftover', color: '#41d68a', cssVar: '--green' },
];
// Keep the chart trend-series colors in sync with the CSS theme variables
// (--red/--accent/--green) so the palette has one source of truth; falls back
// to the literal hex in PIE if a variable is missing.
function syncThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const s of PIE) {
    const v = cs.getPropertyValue(s.cssVar).trim();
    if (v) s.color = v;
  }
}
window.syncThemeColors = syncThemeColors;
// Distinct palette for the per-category breakdown donut (one stable color per bucket).
const CATEGORY_COLORS = [
  '#7c7cf0', '#39d98a', '#f0b429', '#f86a7a', '#a78bfa', '#38bdf8', '#4ade80', '#fb923c',
  '#f472b6', '#a3e635', '#22d3ee', '#c084fc', '#2dd4bf', '#facc15', '#8a8d9c',
];
const PAGE_SIZE = 10;

const txnState = {}; // tbodyId -> { txns, page, pagerId }
let categoryOptions = []; // assignable categories for the per-transaction dropdown
let txnReadOnly = false; // true when viewing an archived month (disables recategorize)
let txnFilter = 'all'; // 'all' | 'uncat' — month transaction-table filter
let txnFilterPeriod = null; // period the filter applies to (reset when you change month)
// A row "needs a category" only while it's still auto-Miscellaneous and untouched.
// Picking any category yourself — even Miscellaneous on purpose — sets user_category
// and counts as reviewed, so the flag clears.
const isUncategorized = (t) => !t.user_category && (t.category || 'Miscellaneous') === 'Miscellaneous';
let active = 'overview'; // 'overview', a year 'YYYY', or a month 'YYYY-MM' (drilled in)
let activeYear = String(new Date().getFullYear()); // the one open year tab
let archivedYears = []; // closed-out years, viewed read-only via the Archive dropdown
const isArchivedYear = (y) => archivedYears.includes(y);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

function showBanner(html, kind = 'info') {
  const b = $('banner');
  b.className = `banner ${kind}`;
  b.innerHTML = html;
  b.hidden = false;
}

// --- Import (CSV / Excel / QFX) --------------------------------------------
async function commitImport(buf, name, flip) {
  showBanner(`Importing ${esc(name)}…`);
  try {
    const r = await api(`/api/import?name=${encodeURIComponent(name)}&flip=${flip ? 1 : 0}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    // Jump to the month we just imported so the new data is immediately visible.
    if (r.latestMonth) active = r.latestMonth;
    await refresh();
    if (r.added) {
      const review = r.uncategorized
        ? `<a href="#" class="banner-link" id="banner-review">${r.uncategorized.toLocaleString()} to categorize →</a>`
        : null;
      const parts = [`Added ${r.added.toLocaleString()} transaction${r.added === 1 ? '' : 's'}`];
      if (r.duplicates) parts.push(`${r.duplicates.toLocaleString()} duplicate${r.duplicates === 1 ? '' : 's'} skipped`);
      if (review) parts.push(review);
      if (r.skipped) parts.push(`${r.skipped.toLocaleString()} row${r.skipped === 1 ? '' : 's'} skipped`);
      showBanner(
        parts.join(' · ') + (r.latestMonth ? ` — showing ${monthLabel(r.latestMonth)}.` : '.'),
        r.uncategorized ? 'warn' : 'info'
      );
      // If some rows need a category, let the banner jump straight to a filtered
      // list of just those; otherwise auto-dismiss after a few seconds.
      const rev = $('banner-review');
      if (rev) {
        rev.onclick = (e) => {
          e.preventDefault();
          if (r.latestMonth) active = r.latestMonth;
          txnFilter = 'uncat';
          txnFilterPeriod = active; // keep the filter through the refresh
          refresh();
        };
      } else {
        setTimeout(() => ($('banner').hidden = true), 6000);
      }
    } else if (r.duplicates) {
      showBanner(
        `No new transactions — all ${r.duplicates.toLocaleString()} row${r.duplicates === 1 ? ' was' : 's were'} already imported.`,
        'info'
      );
      setTimeout(() => ($('banner').hidden = true), 5000);
    } else {
      showBanner(
        `No transactions imported${r.skipped ? ` — ${r.skipped} rows skipped` : ''}. ` +
          `Check that the file has Date, Description, and an amount (or Debit/Credit).`,
        'warn'
      );
    }
  } catch (e) {
    showBanner('Import failed: ' + e.message, 'error');
  }
}

// Step 1 of import: parse on the server (no save) and show a preview so the user
// can confirm the file was read correctly before anything is written. Sends the
// raw bytes so binary formats (Excel) work; the server sniffs CSV/Excel/QFX.
let pendingImport = null; // { buf, name, flip } held between preview and confirm
// flip: null = initial pick (auto-apply the server's card suggestion once); true/false = explicit.
async function previewImport(buf, name, flip = null) {
  showBanner(`Reading ${esc(name)}…`);
  try {
    const useFlip = flip === true;
    const r = await api(`/api/import_preview?name=${encodeURIComponent(name)}&flip=${useFlip ? 1 : 0}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    // On the first look, if the file smells like a credit card, auto-apply the flip once.
    if (flip === null && r.suggestFlip && !r.flip) return previewImport(buf, name, true);
    $('banner').hidden = true;
    pendingImport = { buf, name, flip: useFlip };
    renderImportPreview(r, name);
  } catch (e) {
    showBanner('Could not read file: ' + e.message, 'error');
  }
}

function renderImportPreview(r, name) {
  const d = r.detected;
  const chip = (label, val) => (val ? `<span class="chip"><b>${esc(label)}</b>${esc(val)}</span>` : '');
  $('import-detected').innerHTML =
    chip('Format', r.format) +
    chip('Date', d.date) + chip('Description', d.description) + chip('Amount', d.amount) +
    chip('Balance', d.balance) + chip('Account', d.account);

  const bits = [`<b>${r.newCount.toLocaleString()}</b> new transaction${r.newCount === 1 ? '' : 's'}`];
  if (r.duplicateCount) bits.push(`${r.duplicateCount.toLocaleString()} already imported`);
  if (r.skipped) bits.push(`${r.skipped.toLocaleString()} row${r.skipped === 1 ? '' : 's'} skipped`);
  $('import-stats').innerHTML = `From <b>${esc(name)}</b> — ` + bits.join(' · ') + '.';

  $('import-sample-body').innerHTML = r.samples
    .map(
      (s) =>
        `<tr><td>${esc(s.date)}</td><td title="${esc(s.desc)}">${esc(s.desc)}</td>` +
        `<td class="num ${s.amount < 0 ? 'amt-out' : 'amt-in'}">${money(s.amount)}</td>` +
        `<td>${esc(s.category)}</td></tr>`
    )
    .join('');

  // Credit-card flip toggle: reflect server state + highlight when auto-suggested.
  $('flip-check').checked = !!r.flip;
  $('flip-toggle').classList.toggle('suggested', !!r.suggestFlip);

  $('import-hint').textContent = !r.newCount
    ? 'Nothing new here — every row is already in your data.'
    : r.flip
      ? 'Credit-card mode: purchases now count as spending, payments as transfers. Uncheck if the amounts look wrong.'
      : 'Check the dates, amounts (red = money out, green = money in), and categories look right.';
  $('import-confirm').textContent = r.newCount
    ? `Import ${r.newCount.toLocaleString()} transaction${r.newCount === 1 ? '' : 's'}`
    : 'Import anyway';
  $('import-modal').hidden = false;
}

function closeImportModal() {
  $('import-modal').hidden = true;
  pendingImport = null;
}

$('import-cancel').addEventListener('click', closeImportModal);
$('import-modal').addEventListener('click', (e) => { if (e.target === $('import-modal')) closeImportModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('import-modal').hidden) closeImportModal(); });
// Toggling credit-card mode re-parses the same file with the flip applied.
$('flip-check').addEventListener('change', (e) => {
  if (pendingImport) previewImport(pendingImport.buf, pendingImport.name, e.target.checked);
});
$('import-confirm').addEventListener('click', () => {
  if (!pendingImport) return;
  const { buf, name, flip } = pendingImport;
  $('import-modal').hidden = true;
  pendingImport = null;
  commitImport(buf, name, flip); // step 2: actually save
});

// Recategorize scope choice (see promptCategoryScope).
$('cat-all').addEventListener('click', () => applyCategoryScope('all'));
$('cat-one').addEventListener('click', () => applyCategoryScope('one'));
$('cat-cancel').addEventListener('click', cancelCategoryScope);
$('cat-modal').addEventListener('click', (e) => { if (e.target === $('cat-modal')) cancelCategoryScope(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('cat-modal').hidden) cancelCategoryScope(); });

// --- Donut chart (animated SVG, hover-linked legend + live center) ----------
// Shared core: draws the ring + animated center for any segment list. Returns
// { highlight, reset } so each caller can wire its own legend hover. segments:
// [{label, value, color}] (all value>0). centerDefault: {label, value} (idle center).
function drawDonut(container, segments, centerDefault) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const size = 200, stroke = 22, r = size / 2 - stroke / 2, C = 2 * Math.PI * r;

  let cum = 0;
  const segs = segments.map((s, i) => {
    const frac = s.value / total;
    const seg = { ...s, i, arc: frac * C, offset: (cum / total) * C, pct: frac * 100 };
    cum += s.value;
    return seg;
  });

  container.innerHTML =
    `<svg class="donut-svg" viewBox="0 0 ${size} ${size}">
       <circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"></circle>
       ${segs
         .map(
           (m) =>
             `<circle class="donut-seg" data-i="${m.i}" cx="${size / 2}" cy="${size / 2}" r="${r}"
                fill="none" stroke="${m.color}" stroke-width="${stroke}" stroke-linecap="round"
                stroke-dasharray="${m.arc} ${C}"
                style="stroke-dashoffset:${C}; transition: stroke-dashoffset .9s ease-out ${m.i * 0.08}s, filter .2s ease, transform .2s ease;"></circle>`
         )
         .join('')}
     </svg>
     <div class="donut-center"></div>`;

  const center = container.querySelector('.donut-center');
  const segEls = container.querySelectorAll('.donut-seg');

  const showTotal = () => {
    center.innerHTML =
      `<span class="donut-center-label">${centerDefault.label}</span>` +
      `<span class="donut-center-value">${centerDefault.value}</span>`;
  };
  const showSeg = (m) => {
    center.innerHTML =
      `<span class="donut-center-label">${m.label}</span>` +
      `<span class="donut-center-value">${money(m.value)}</span>` +
      `<span class="donut-center-pct">${Math.round(m.pct)}%</span>`;
  };
  showTotal();

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      segs.forEach((m) => (segEls[m.i].style.strokeDashoffset = `${-m.offset}`));
    })
  );

  const highlight = (idx) => {
    segEls.forEach((el, i) => {
      const on = i === idx;
      el.style.filter = on ? `drop-shadow(0 0 7px ${segs[i].color}) brightness(1.12)` : 'none';
      el.style.transform = on ? 'scale(1.04)' : 'scale(1)';
      el.style.opacity = idx == null || on ? '1' : '0.4';
    });
    if (idx != null) showSeg(segs[idx]);
  };
  const reset = () => {
    segEls.forEach((el) => {
      el.style.filter = 'none';
      el.style.transform = 'scale(1)';
      el.style.opacity = '1';
    });
    showTotal();
  };

  segEls.forEach((el) => el.addEventListener('mouseenter', () => highlight(Number(el.dataset.i))));
  container.addEventListener('mouseleave', reset);
  return { highlight, reset };
}

// Income vs Spending/Savings/Leftover donut (center idles on Income).
function renderDonut(containerId, legendId, totals) {
  const container = $(containerId);
  const legend = $(legendId);

  const present = PIE.map((s) => ({ ...s, value: totals[s.key] || 0 })).filter((s) => s.value > 0);
  if (!present.length) {
    container.innerHTML = '';
    legend.innerHTML = '<li class="muted small">No data yet for this period.</li>';
    return;
  }

  const { highlight, reset } = drawDonut(container, present, { label: 'Income', value: money(totals.income || 0) });
  const keyToIdx = Object.fromEntries(present.map((s, i) => [s.key, i]));

  legend.innerHTML =
    `<li class="legend-total"><span class="legend-name"><span class="dot" style="background:transparent"></span>Income</span><strong>${money(totals.income || 0)}</strong></li>` +
    PIE.map((s) => {
      const idx = keyToIdx[s.key];
      const has = idx != null;
      return (
        `<li class="legend-item${has ? '' : ' is-zero'}"${has ? ` data-i="${idx}"` : ''}>` +
        `<span class="legend-name"><span class="dot" style="background:${s.color}"></span>${s.label}</span>` +
        `<strong>${money(totals[s.key] || 0)}</strong></li>`
      );
    }).join('');
  legend.querySelectorAll('.legend-item[data-i]').forEach((li) => {
    li.addEventListener('mouseenter', () => highlight(Number(li.dataset.i)));
    li.addEventListener('mouseleave', reset);
  });
}

// Per-category spending breakdown donut — what % of money goes to each category.
function renderCategoryDonut(containerId, legendId, categories) {
  const container = $(containerId);
  const legend = $(legendId);

  const present = categories
    .map((c, i) => ({ label: c.category, value: c.spent || 0, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = present.reduce((a, s) => a + s.value, 0);

  if (!present.length) {
    container.innerHTML = '';
    legend.innerHTML = '<li class="muted small">No spending this period.</li>';
    return;
  }

  const { highlight, reset } = drawDonut(container, present, { label: 'Spending', value: money(total) });

  legend.innerHTML = present
    .map(
      (s, i) =>
        `<li class="legend-item" data-i="${i}">` +
        `<span class="legend-name"><span class="dot" style="background:${s.color}"></span>${s.label}</span>` +
        `<strong>${Math.round((s.value / total) * 100)}%</strong></li>`
    )
    .join('');
  legend.querySelectorAll('.legend-item[data-i]').forEach((li) => {
    li.addEventListener('mouseenter', () => highlight(Number(li.dataset.i)));
    li.addEventListener('mouseleave', reset);
  });
}

// --- Month grid (3x4 small-multiples: one mini bar chart per month) ---------
// onSelect (optional): makes cells clickable; clicking calls onSelect(monthKey).
// allCells: when true every month is clickable (e.g. drill-in, so you can open an
// empty month to import); when false only months with data are clickable.
// toggle: when true, clicking the active cell calls onSelect(null) to deselect.
function renderMonthGrid(containerId, monthly, year, onSelect, allCells = false, toggle = false) {
  const el = $(containerId);
  el.className = 'month-grid';
  const byMonth = Object.fromEntries((monthly || []).map((m) => [m.month, m]));
  // Shared scale across THIS year's months only, so bars stay comparable within
  // the year (and don't flatten as bigger months from other years accumulate).
  const yearStr = String(year);
  const thisYear = (monthly || []).filter((m) => m.month.startsWith(yearStr));
  const max = Math.max(1, ...thisYear.flatMap((m) => PIE.map((s) => m[s.key] || 0)));

  const W = 100, barW = 18, gap = 10, topPad = 12, plotH = 46, baseY = topPad + plotH, svgH = baseY + 2;
  const x0 = (W - (barW * PIE.length + gap * (PIE.length - 1))) / 2;

  let cells = '';
  for (let mo = 1; mo <= 12; mo++) {
    const key = `${year}-${String(mo).padStart(2, '0')}`;
    const m = byMonth[key] || { spending: 0, savings: 0, leftover: 0 };
    const has = PIE.some((s) => (m[s.key] || 0) > 0);
    const short = new Date(Number(year), mo - 1, 1).toLocaleString('en-US', { month: 'short' });
    const bars = PIE.map((s, si) => {
      const v = m[s.key] || 0;
      const h = (v / max) * plotH;
      const x = x0 + si * (barW + gap);
      const label = v > 0 ? `<text class="mg-val" x="${x + barW / 2}" y="${baseY - h - 3}" text-anchor="middle">${shortMoney(v)}</text>` : '';
      return `<rect x="${x}" y="${baseY - h}" width="${barW}" height="${h}" rx="2" fill="${s.color}"><title>${s.label}: ${money(v)}</title></rect>${label}`;
    }).join('');
    const clickable = onSelect && (allCells || has) ? ' mg-clickable' : '';
    cells +=
      `<div class="mg-cell${has ? '' : ' mg-empty'}${clickable}" data-month="${key}">` +
      `<div class="mg-label">${short}</div>` +
      `<svg class="mg-svg" viewBox="0 0 ${W} ${svgH}">` +
      `<line class="bar-base" x1="0" y1="${baseY}" x2="${W}" y2="${baseY}"></line>${bars}</svg>` +
      `</div>`;
  }
  el.innerHTML = cells;

  if (onSelect) {
    el.querySelectorAll('.mg-clickable').forEach((cell) =>
      cell.addEventListener('click', () => {
        if (!toggle) return onSelect(cell.dataset.month); // drill-in: just navigate
        const wasActive = cell.classList.contains('mg-active');
        el.querySelectorAll('.mg-cell').forEach((c) => c.classList.remove('mg-active'));
        if (wasActive) onSelect(null);
        else { cell.classList.add('mg-active'); onSelect(cell.dataset.month); }
      })
    );
  }
}

// --- Single-month bar chart (spending/savings/leftover, large) --------------
// p: the period object. If p.prior exists (same month, prior year), each series
// shows two bars — this year (solid) and last year (faded ghost) — for comparison.
function renderSingleBars(containerId, p) {
  const el = $(containerId);
  el.className = 'bars-wrap';
  const prior = p.prior; // {period, spending, savings, leftover} | undefined
  const curYear = p.period.slice(0, 4);
  const priorYear = prior ? prior.period.slice(0, 4) : null;

  const W = 360, topPad = 30, plotH = 140, baseY = topPad + plotH, labelH = 46, svgH = baseY + labelH;
  const all = PIE.flatMap((s) => [p[s.key] || 0, prior ? prior[s.key] || 0 : 0]);
  const max = Math.max(1, ...all);

  // Layout: 3 series; 1 bar each (no prior) or 2 bars each (this year + last year).
  const per = prior ? 2 : 1;
  const barW = prior ? 40 : 74;
  const pairGap = 6;   // gap between this/last-year bars in a series
  const seriesGap = 44;
  const seriesW = barW * per + pairGap * (per - 1);
  const x0 = (W - (seriesW * PIE.length + seriesGap * (PIE.length - 1))) / 2;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = topPad + (plotH * i) / 4;
    grid += `<line class="bar-grid" x1="0" y1="${y}" x2="${W}" y2="${y}"></line>`;
  }

  const valFmt = prior ? shortMoney : money; // compact labels when bars are paired
  let bars = '';
  PIE.forEach((s, i) => {
    const sx = x0 + i * (seriesW + seriesGap);
    // bars within the series: this year first (solid), then last year (ghost)
    const entries = [{ value: p[s.key] || 0, year: curYear, ghost: false }];
    if (prior) entries.push({ value: prior[s.key] || 0, year: priorYear, ghost: true });
    entries.forEach((e, j) => {
      const h = (e.value / max) * plotH;
      const x = sx + j * (barW + pairGap);
      const y = baseY - h;
      const op = e.ghost ? ' opacity="0.4"' : '';
      bars +=
        `<rect class="bar" x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${s.color}"${op} ` +
        `style="transform-box: fill-box; transform-origin: bottom; transform: scaleY(0); transition: transform .7s ease-out ${(i + j) * 0.06}s;">` +
        `<title>${s.label} ${e.year}: ${money(e.value)}</title></rect>` +
        `<text class="bar-val-lg" x="${x + barW / 2}" y="${y - 8}" text-anchor="middle"${op}>${valFmt(e.value)}</text>` +
        (prior ? `<text class="bar-year" x="${x + barW / 2}" y="${baseY + 16}" text-anchor="middle"${op}>${e.year}</text>` : '');
    });
    // series name centered under the (pair of) bars
    bars += `<text class="bar-label" x="${sx + seriesW / 2}" y="${baseY + (prior ? 34 : 24)}" text-anchor="middle">${s.label}</text>`;
  });

  el.innerHTML =
    `<svg class="bars-svg" viewBox="0 0 ${W} ${svgH}" style="width:100%; max-width:460px;">` +
    grid +
    `<line class="bar-base" x1="0" y1="${baseY}" x2="${W}" y2="${baseY}"></line>` +
    bars +
    `</svg>`;

  const rects = el.querySelectorAll('.bar');
  requestAnimationFrame(() => requestAnimationFrame(() => rects.forEach((r) => (r.style.transform = 'scaleY(1)'))));
}

// --- Transactions (paginated, 10/page) -------------------------------------
function txnRowHtml(t) {
  const isIn = t.amount > 0; // credit = money in
  const opts = categoryOptions
    .map((c) => `<option${c === t.effective_category ? ' selected' : ''}>${c}</option>`)
    .join('');
  return `
    <td class="muted">${t.date}</td>
    <td>${esc(t.name)}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
    <td><select class="cat-select" data-txn="${t.transaction_id}" data-name="${esc(t.name)}" data-prev="${esc(t.effective_category)}"${txnReadOnly ? ' disabled' : ''}>${opts}</select></td>
    <td class="num ${isIn ? 'positive' : 'negative'}">${isIn ? '+' : '-'}${money(Math.abs(t.amount))}</td>`;
}

// Recategorizing to Transfer asks whether to apply to every matching row (+ future
// imports) or just this one — so a self-transfer that shares a description with rows you
// want left alone doesn't get learned globally. Every other category keeps the
// merchant-learning default (apply to all) with no prompt.
let pendingCat = null; // { sel, id, category }

function promptCategoryScope(sel) {
  pendingCat = { sel, id: sel.dataset.txn, category: sel.value };
  // Only Transfer opens the choice; anything else applies to all merchant rows silently.
  if (sel.value !== 'Transfer') { applyCategoryScope('all'); return; }
  $('cat-modal-text').innerHTML =
    `Set <b>${esc(sel.dataset.name)}</b> to <b>Transfer</b>.<br><br>` +
    `<b>Apply to all</b> sets every transaction with this description to Transfer, now and on future imports. ` +
    `<b>Just this one</b> changes only this transaction.`;
  $('cat-modal').hidden = false;
  $('cat-all').focus();
}

async function applyCategoryScope(scope) {
  if (!pendingCat) return;
  const { id, category } = pendingCat;
  pendingCat = null;
  $('cat-modal').hidden = true;
  try {
    await api('/api/transaction_category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: id, user_category: category, scope }),
    });
    await refresh();
  } catch (e) {
    showBanner('Could not recategorize: ' + e.message, 'error');
  }
}

// Closing without choosing reverts the dropdown to its saved value (nothing was written).
function cancelCategoryScope() {
  if (pendingCat) pendingCat.sel.value = pendingCat.sel.dataset.prev;
  pendingCat = null;
  $('cat-modal').hidden = true;
}

function renderTransactions(tbodyId, pagerId, txns) {
  txnState[tbodyId] = { txns, page: 1, pagerId };
  if (tbodyId === 'month-txn-body') renderTxnFilter(txns);
  drawTxnPage(tbodyId);
}

function drawTxnPage(tbodyId) {
  const st = txnState[tbodyId];
  // The "Needs category" filter only applies to the editable month table.
  const list =
    tbodyId === 'month-txn-body' && txnFilter === 'uncat' ? st.txns.filter(isUncategorized) : st.txns;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (st.page > pages) st.page = pages;

  const start = (st.page - 1) * PAGE_SIZE;
  const slice = list.slice(start, start + PAGE_SIZE);
  const body = $(tbodyId);
  body.innerHTML = total
    ? slice.map((t) => `<tr class="${isUncategorized(t) ? 'needs-cat' : ''}">${txnRowHtml(t)}</tr>`).join('')
    : `<tr><td colspan="4" class="muted">${
        txnFilter === 'uncat' ? 'Nothing left to categorize — all set. 🎉' : 'No transactions.'
      }</td></tr>`;
  body.querySelectorAll('.cat-select').forEach((sel) =>
    sel.addEventListener('change', () => promptCategoryScope(sel))
  );

  const pager = $(st.pagerId);
  if (!pager) return;
  if (total <= PAGE_SIZE) {
    pager.innerHTML = '';
    return;
  }
  pager.innerHTML =
    `<button class="pg-btn" data-dir="-1" ${st.page <= 1 ? 'disabled' : ''}>‹ Prev</button>` +
    `<span class="muted small">Page ${st.page} of ${pages}</span>` +
    `<button class="pg-btn" data-dir="1" ${st.page >= pages ? 'disabled' : ''}>Next ›</button>`;
  pager.querySelectorAll('.pg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      st.page += Number(b.dataset.dir);
      drawTxnPage(tbodyId);
    })
  );
}

// "All / Needs category" toggle above the month transaction table. Hidden when
// there's nothing to triage (archived view, or no uncategorized rows on 'all').
function renderTxnFilter(txns) {
  const cont = $('txn-filter');
  if (!cont) return;
  const uncat = txns.filter(isUncategorized).length;
  if (txnReadOnly || (uncat === 0 && txnFilter === 'all')) {
    cont.hidden = true;
    cont.innerHTML = '';
    txnFilter = 'all';
    return;
  }
  cont.hidden = false;
  cont.innerHTML =
    `<button class="txn-chip ${txnFilter === 'all' ? 'on' : ''}" data-f="all">All · ${txns.length}</button>` +
    `<button class="txn-chip ${txnFilter === 'uncat' ? 'on' : ''}" data-f="uncat"${uncat === 0 ? ' disabled' : ''}>Needs category · ${uncat}</button>`;
  cont.querySelectorAll('.txn-chip').forEach((b) =>
    b.addEventListener('click', () => {
      txnFilter = b.dataset.f;
      txnState['month-txn-body'].page = 1;
      renderTxnFilter(txns); // reflect the active state
      drawTxnPage('month-txn-body');
    })
  );
}

// --- Overview (all-time) ---------------------------------------------------
async function saveBudget(input) {
  try {
    await api('/api/budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: input.dataset.cat, monthly_limit: input.value }),
    });
    await refresh();
  } catch (e) {
    showBanner('Could not save budget: ' + e.message, 'error');
  }
}

async function addCategory() {
  const input = $('new-cat-input');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/api/category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    input.value = '';
    await refresh();
  } catch (e) {
    showBanner('Could not add category: ' + e.message, 'error');
  }
}

async function deleteCategory(name) {
  if (!confirm(`Delete category "${name}"? Any transactions you put in it will revert to their automatic category.`))
    return;
  try {
    await api('/api/category', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await refresh();
  } catch (e) {
    showBanner('Could not delete category: ' + e.message, 'error');
  }
}

function renderOverview(o) {
  $('view-overview').hidden = false;
  $('view-month').hidden = true;

  // First-run empty state: no transactions yet → show the import call-to-action
  // instead of a wall of $0 KPIs and blank charts.
  const empty = !o.months || o.months.length === 0;
  $('overview-empty').hidden = !empty;
  $('overview-grid').hidden = empty;
  $('recent-panel').hidden = empty;
  if (empty) { $('overview-insight').hidden = true; return; }

  // cur = the active year's totals (summed from the monthly series) — used by the insight line.
  const yearSum = (yr) =>
    o.monthly.reduce(
      (r, m) => {
        if (m.month.startsWith(yr)) { r.income += m.income; r.spending += m.spending; r.savings += m.savings; r.leftover += m.leftover; }
        return r;
      },
      { income: 0, spending: 0, savings: 0, leftover: 0 }
    );
  const cur = yearSum(o.activeYear);

  // Donut defaults to the cumulative all-years total (it grows as you add years);
  // clicking a month in the grid scopes to it, clicking again returns to cumulative.
  const showDonut = (monthKey) => {
    const m = monthKey && o.monthly.find((x) => x.month === monthKey);
    $('overview-chart-title').textContent = m
      ? `Where your income has gone — ${monthLabel(monthKey)}`
      : 'Where your income has gone — all years (cumulative)';
    renderDonut('overview-chart', 'overview-legend', m || o);
  };
  showDonut(null);

  $('overview-bars-title').textContent = `By month — ${o.activeYear}`;
  // Click a month to scope the donut to it (toggle off by clicking again).
  renderMonthGrid('overview-bars', o.monthly, o.activeYear, showDonut, false, true);

  const saved = cur.income ? Math.round(((cur.income - cur.spending) / cur.income) * 100) : 0;

  // --- Plain-English insight line ---
  const insight = $('overview-insight');
  insight.hidden = !(cur.income || cur.spending);
  if (!insight.hidden) {
    const over = o.categories
      .filter((c) => c.yearLimit != null && c.yearLimit > 0 && c.spent > c.yearLimit)
      .sort((a, b) => b.spent - b.yearLimit - (a.spent - a.yearLimit));
    const anyBudget = o.categories.some((c) => c.yearLimit != null && c.yearLimit > 0);
    let budgetMsg;
    if (!anyBudget) budgetMsg = `no budgets are set for ${o.activeYear} yet.`;
    else if (over.length === 0) budgetMsg = `every budget is on track for ${o.activeYear}.`;
    else if (over.length === 1)
      budgetMsg = `<span class="ins-warn">${over[0].category}</span> is over its ${o.activeYear} budget (${money(over[0].spent)} of ${money(over[0].yearLimit)}).`;
    else
      budgetMsg = `<span class="ins-warn">${over.length} budgets</span> are over for ${o.activeYear}: ${over.slice(0, 3).map((c) => c.category).join(', ')}.`;
    insight.innerHTML = `<span class="ins-dot"></span><span>You've kept <span class="ins-good">${saved}%</span> of your income — ${budgetMsg}</span>`;
  }

  // --- Budget-progress rows (this year's spend vs the budget) ---
  $('overview-budget-title').textContent = `Budgets · ${o.activeYear}`;
  $('overview-budget-body').innerHTML = o.categories
    .map((row) => {
      const hasLimit = row.yearLimit != null && row.yearLimit > 0;
      const ratio = hasLimit ? row.spent / row.yearLimit : 0;
      const over = hasLimit && row.spent > row.yearLimit;
      const w = hasLimit ? Math.min(100, Math.round(ratio * 100)) : 0;
      const cls = over ? 'over' : ratio >= 1 ? 'full' : '';
      const val = hasLimit
        ? `<span class="bp-val ${over ? 'over' : ''}">${money(row.spent)} / ${money(row.yearLimit)}</span>`
        : `<span class="bp-val none">${row.spent > 0 ? money(row.spent) + ' spent' : 'no budget'}</span>`;
      return `
      <div class="bp-row">
        <span class="bp-name">${row.category}${row.custom ? ` <button class="del-cat" data-cat="${row.category}" title="Delete category">×</button>` : ''}</span>
        <span class="bp-meta">${val}<input class="bp-input limit-input" type="number" min="0" step="10"
          value="${row.limit ?? ''}" data-cat="${row.category}" placeholder="—" title="Monthly limit" /></span>
        ${hasLimit ? `<span class="bp-track"><span class="bp-fill ${cls}" style="width:${w}%"></span></span>` : ''}
      </div>`;
    })
    .join('');
  const obody = $('overview-budget-body');
  obody.querySelectorAll('.limit-input').forEach((input) => input.addEventListener('change', () => saveBudget(input)));
  obody.querySelectorAll('.del-cat').forEach((b) => b.addEventListener('click', () => deleteCategory(b.dataset.cat)));
  const totalBudget = o.categories.reduce((s, r) => s + (r.limit || 0), 0);
  $('overview-budget-total').textContent = money(totalBudget) + ' / mo';

  // --- Recent activity peek ---
  $('recent-body').innerHTML =
    (o.recent || [])
      .map((r) => {
        const inFlow = r.amount > 0;
        return `
      <div class="rx">
        <div><div class="rx-name">${esc(r.name)}</div><div class="rx-meta">${r.date} · ${esc(r.category)}</div></div>
        <span class="rx-amt ${inFlow ? 'in' : ''}">${inFlow ? '+' : ''}${money(r.amount)}</span>
      </div>`;
      })
      .join('') || '<p class="muted small">No transactions yet.</p>';
}

// --- One period (month / year / all-time) ----------------------------------
function renderPeriod(p) {
  $('view-overview').hidden = true;
  $('view-month').hidden = false;

  categoryOptions = ['Income', 'Transfer', ...p.categories.map((c) => c.category)];

  const label = periodLabel(p.period);
  const span = p.monthCount > 1 ? ` · ${p.monthCount} months` : '';
  $('month-budget-title').textContent = `Budget by category — ${label}${span}`;
  $('month-pie-title').textContent = `${label} breakdown`;

  const incomeRow = `
      <tr class="income-row">
        <td>Income</td>
        <td class="num">—</td>
        <td class="num positive">+${money(p.income)}</td>
      </tr>`;
  $('month-budget-body').innerHTML =
    incomeRow +
    p.categories
      .map((row) => {
        const over = row.limit != null && row.spent > row.limit;
        return `
      <tr>
        <td>${row.category}</td>
        <td class="num">${row.limit != null ? money(row.limit) : '—'}</td>
        <td class="num ${over ? 'over-text' : ''}">${money(row.spent)}</td>
      </tr>`;
      })
      .join('');

  const totalBudget = p.categories.reduce((s, r) => s + (r.limit || 0), 0);
  const totalSpent = p.categories.reduce((s, r) => s + r.spent, 0);
  $('month-budget-foot').innerHTML =
    `<tr class="total-row"><td>Total</td><td class="num">${money(totalBudget)}</td>` +
    `<td class="num">${money(totalSpent)}</td></tr>`;

  renderDonut('month-chart', 'month-legend', p);

  const isMonth = /^\d{4}-\d{2}$/.test(p.period);
  const isYear = /^\d{4}$/.test(p.period);
  const year = p.period.slice(0, 4);
  const archived = isArchivedYear(year);

  // View bar: Back (when drilled into a month), an archived banner, and the
  // Start-new-year button (only on the active, non-archived year).
  $('back-to-year').hidden = !isMonth;
  if (isMonth) {
    $('back-to-year').textContent = `← Back to ${year}`;
    $('back-to-year').onclick = () => { active = year; refresh(); };
  }
  $('start-new-year').hidden = !(isYear && year === activeYear);
  $('start-new-year').onclick = startNewYear;
  $('archived-label').hidden = !archived;
  $('archived-label').textContent = archived ? `Archived ${year} · read-only` : '';
  // Restore (un-archive) is offered whenever you're viewing an archived year/month.
  $('restore-year').hidden = !archived;
  $('restore-year').onclick = () => restoreYear(year);
  // Archive year: offered on a non-active, non-archived past year (e.g. one you just
  // restored, or an older year imported directly and never closed out).
  $('archive-year').hidden = !(isYear && !archived && year !== activeYear);
  $('archive-year').onclick = () => archiveYear(year);

  // Both month and year show the budget panel (left) beside the chart panel (right),
  // so the year view stays a balanced two-column layout instead of a half-empty panel.
  $('month-budget-panel').hidden = false;
  $('month-chart-panel').classList.remove('wide');
  $('month-cat-section').hidden = !isMonth;

  if (isMonth) {
    $('month-bars-title').textContent = p.prior ? `${label} vs ${monthLabel(p.prior.period)}` : `${label} totals`;
    renderSingleBars('month-bars', p);
    renderCategoryDonut('month-cat-chart', 'month-cat-legend', p.categories);
  } else {
    $('month-bars-title').textContent = `By month — ${p.period}`;
    // Click a month to drill in. Active year: every month clickable (so you can
    // open an empty one to import). Archived year: only months with data.
    renderMonthGrid('month-bars', p.monthly, p.period, drillToMonth, !archived, false);
  }

  // Transactions + editing only on month views; everything is read-only when archived.
  $('month-txn-panel').hidden = !isMonth;
  if (isMonth) {
    $('month-txn-title').textContent = `Transactions — ${label}`;
    txnReadOnly = archived; // disables the per-row category dropdowns
    // Reset the filter when the viewed month changes, but keep it across a
    // recategorize-refresh so you can work down the "needs category" list.
    if (p.period !== txnFilterPeriod) { txnFilter = 'all'; txnFilterPeriod = p.period; }
    renderTransactions('month-txn-body', 'month-pager', p.transactions);
    setupMonthForm(p.period);
    $('month-import-btn').hidden = archived;
    $('clear-month-btn').hidden = archived;
    $('add-txn-form').hidden = archived;
  }
}

function drillToMonth(monthKey) {
  active = monthKey;
  refresh();
}

async function restoreYear(year) {
  if (!confirm(`Restore ${year} from the archive? It becomes editable again.`)) return;
  try {
    await api('/api/unarchive_year', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year }),
    });
    active = year; // land on the restored year
    await refresh();
    showBanner(`Restored ${year} — it's editable again.`, 'info');
    setTimeout(() => ($('banner').hidden = true), 4000);
  } catch (e) {
    showBanner('Could not restore year: ' + e.message, 'error');
  }
}

async function archiveYear(year) {
  if (!confirm(`Archive ${year}? It moves under Archive and becomes read-only. You can restore it anytime.`)) return;
  try {
    await api('/api/archive_year', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year }),
    });
    active = 'overview'; // the year leaves the tab bar, so don't sit on a now-hidden tab
    await refresh();
    showBanner(`Archived ${year} — find it under Archive ▾.`, 'info');
    setTimeout(() => ($('banner').hidden = true), 4000);
  } catch (e) {
    showBanner('Could not archive year: ' + e.message, 'error');
  }
}

async function startNewYear() {
  if (!confirm(`Start a new year? This archives ${activeYear} (kept, read-only under Archive) and opens ${Number(activeYear) + 1} fresh.`))
    return;
  try {
    const r = await api('/api/new_year', { method: 'POST' });
    active = r.activeYear;
    await refresh();
    showBanner(`Archived ${r.archived}. ${r.activeYear} is ready — open it and import a month to begin.`, 'info');
    setTimeout(() => ($('banner').hidden = true), 5000);
  } catch (e) {
    showBanner('Could not start new year: ' + e.message, 'error');
  }
}

// --- Manual data entry + clear-a-month -------------------------------------
function setupMonthForm(period) {
  const date = $('txn-date');
  date.value = `${period}-01`; // default to the 1st of the open month
  date.min = `${period}-01`;
  const [py, pm] = period.split('-').map(Number);
  date.max = `${period}-${String(new Date(py, pm, 0).getDate()).padStart(2, '0')}`; // real last day (28-31)
  $('txn-cat').innerHTML = categoryOptions.map((c) => `<option>${c}</option>`).join('');
  // Assign (not addEventListener) so handlers don't stack across re-renders.
  $('add-txn-form').onsubmit = (e) => { e.preventDefault(); addTransaction(period); };
  $('clear-month-btn').onclick = () => clearMonth(period);
}

async function addTransaction(period) {
  const desc = $('txn-desc').value.trim();
  const raw = Math.abs(parseFloat($('txn-amount').value));
  if (!desc || !isFinite(raw) || raw <= 0) return;
  const amount = $('txn-dir').value === 'in' ? raw : -raw; // + in, - out
  try {
    await api('/api/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: $('txn-date').value, name: desc, amount, category: $('txn-cat').value }),
    });
    $('txn-desc').value = '';
    $('txn-amount').value = '';
    await refresh();
  } catch (e) {
    showBanner('Could not add transaction: ' + e.message, 'error');
  }
}

async function clearMonth(period) {
  if (!confirm(`Delete ALL transactions in ${periodLabel(period)}? This can't be undone.`)) return;
  try {
    const r = await api('/api/clear_month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: period }),
    });
    showBanner(`Cleared ${r.deleted} transaction${r.deleted === 1 ? '' : 's'} from ${periodLabel(period)}.`, 'info');
    setTimeout(() => ($('banner').hidden = true), 4000);
    await refresh();
  } catch (e) {
    showBanner('Could not clear month: ' + e.message, 'error');
  }
}

// --- Tabs + boot -----------------------------------------------------------
// Tab bar = Overview · [non-archived years] · Archive ▾. Months aren't tabs — you
// drill into them from a year's grid. Archiving is how you keep the bar uncluttered.
function renderTabs(shownYears) {
  const nav = $('tabs');
  nav.hidden = false;

  let html = `<button class="tab${active === 'overview' ? ' active' : ''}" data-tab="overview">Overview</button>`;
  for (const y of shownYears) {
    const on = active === y || active.startsWith(y + '-'); // highlight when drilled into its month
    html += `<button class="tab tab-period${on ? ' active' : ''}" data-tab="${y}">${y}</button>`;
  }
  if (archivedYears.length) {
    const sel = archivedYears.includes(active.slice(0, 4)) ? active.slice(0, 4) : '';
    html +=
      `<select id="archive-select" class="archive-select" title="View an archived year">` +
      `<option value="">Archive ▾</option>` +
      archivedYears.map((y) => `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`).join('') +
      `</select>`;
  }
  nav.innerHTML = html;

  nav.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => { active = b.dataset.tab; refresh(); })
  );
  const arch = $('archive-select');
  if (arch) arch.addEventListener('change', () => { if (arch.value) { active = arch.value; refresh(); } });
}

async function refresh() {
  const status = await api('/api/status');
  $('env-badge').textContent = 'Local';
  $('env-badge').className = 'badge prod';

  if (status.hasData) {
    $('institutions').textContent =
      `${status.count.toLocaleString()} transactions · ${status.earliest} → ${status.latest}`;
    $('banner').hidden = true;
  } else {
    $('institutions').textContent = '';
    // On the Overview the empty-state panel already prompts to import, so don't
    // double up with a banner; only nudge on the year/month views.
    if (active !== 'overview') {
      showBanner(
        `No data yet — open the <strong>${activeYear}</strong> tab, click a month, then <strong>Import CSV</strong> (or add transactions manually). Your data stays on this machine.`,
        'info'
      );
    } else {
      $('banner').hidden = true;
    }
  }

  const overview = await api('/api/overview');
  activeYear = overview.activeYear;
  archivedYears = overview.archivedYears || [];

  // Year tabs = every year with data, plus the active year, minus archived ones.
  const dataYears = [...new Set(overview.months.map((m) => m.slice(0, 4)))];
  const shownYears = [...new Set([...dataYears, activeYear])].filter((y) => !archivedYears.includes(y)).sort().reverse();

  // Validate the active selection: overview, a shown/archived year, or a month of one.
  const yearOf = active.slice(0, 4);
  const knownYear = shownYears.includes(yearOf) || archivedYears.includes(yearOf);
  const validActive =
    active === 'overview' || shownYears.includes(active) || archivedYears.includes(active) || (/^\d{4}-\d{2}$/.test(active) && knownYear);
  if (!validActive) active = 'overview';

  renderTabs(shownYears);
  updateRail();

  if (active === 'overview') renderOverview(overview);
  else renderPeriod(await api('/api/summary?period=' + active));
}

// Highlight the rail icon for the current view (home / year / archived year).
function updateRail() {
  const yr = /^\d{4}/.test(active) ? active.slice(0, 4) : null;
  const isArch = yr && archivedYears.includes(yr);
  const set = (id, on) => $(id) && $(id).classList.toggle('on', !!on);
  set('ri-home', active === 'overview');
  set('ri-year', !!yr && !isArch);
  set('ri-archive', !!isArch);
}

$('add-cat-btn').addEventListener('click', addCategory);
$('new-cat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCategory();
});
// Icon rail navigation (click + keyboard).
function railGo(target) {
  if (target === 'archive') {
    if (archivedYears.length) { active = archivedYears[0]; refresh(); }
    else { showBanner('No archived years yet — close out a year with “Start new year”.', 'info'); setTimeout(() => ($('banner').hidden = true), 4000); }
  } else if (target === 'import') {
    $('csv-input').click();
  } else { active = target; refresh(); }
}
[['ri-home', 'overview'], ['ri-year', 'year'], ['ri-archive', 'archive'], ['ri-import', 'import']].forEach(([id, t]) => {
  const el = $(id);
  if (!el) return;
  const go = () => railGo(t === 'year' ? activeYear : t);
  el.addEventListener('click', go);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
});

$('month-import-btn').addEventListener('click', () => $('csv-input').click());
$('empty-import-btn').addEventListener('click', () => $('csv-input').click());
$('csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer(); // raw bytes so binary (Excel) survives the round-trip
  e.target.value = ''; // allow re-importing the same file
  previewImport(buf, file.name);
});

syncThemeColors(); // match any saved theme before the first render
refresh().catch((e) => showBanner('Error: ' + e.message, 'error'));

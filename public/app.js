const $ = (id) => document.getElementById(id);
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
  { key: 'spending', label: 'Spending', color: '#ff6a6a' },
  { key: 'savings', label: 'Savings', color: '#6d8cff' },
  { key: 'leftover', label: 'Leftover', color: '#41d68a' },
];
// Distinct palette for the per-category breakdown donut (one stable color per bucket).
const CATEGORY_COLORS = [
  '#ff6a6a', '#6d8cff', '#41d68a', '#e3b341', '#8b7cff', '#4dd0e1', '#ff9f5a', '#f06595',
  '#a3e635', '#38bdf8', '#fb7185', '#c084fc', '#2dd4bf', '#facc15', '#94a3b8',
];
const PAGE_SIZE = 10;

const txnState = {}; // tbodyId -> { txns, page, pagerId }
let categoryOptions = []; // assignable categories for the per-transaction dropdown
let txnReadOnly = false; // true when viewing an archived month (disables recategorize)
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

// --- CSV import ------------------------------------------------------------
async function importCsv(text, name) {
  showBanner(`Importing ${name}…`);
  try {
    const r = await api('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: text,
    });
    // Jump to the month we just imported so the new data is immediately visible.
    if (r.latestMonth) active = r.latestMonth;
    await refresh();
    if (r.imported) {
      showBanner(
        `Imported ${r.imported.toLocaleString()} transaction${r.imported === 1 ? '' : 's'}` +
          (r.skipped ? ` (${r.skipped} rows skipped)` : '') +
          (r.latestMonth ? ` — showing ${monthLabel(r.latestMonth)}.` : '.'),
        'info'
      );
      setTimeout(() => ($('banner').hidden = true), 5000);
    } else {
      showBanner(
        `No transactions imported${r.skipped ? ` — ${r.skipped} rows skipped` : ''}. ` +
          `Check that the CSV has Date, Description, and Debit/Credit (or Amount) columns.`,
        'warn'
      );
    }
  } catch (e) {
    showBanner('Import failed: ' + e.message, 'error');
  }
}

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
  // Shared scale across the year so the months are visually comparable.
  const max = Math.max(1, ...(monthly || []).flatMap((m) => PIE.map((s) => m[s.key] || 0)));

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
    <td>${t.name}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
    <td><select class="cat-select" data-txn="${t.transaction_id}"${txnReadOnly ? ' disabled' : ''}>${opts}</select></td>
    <td class="num ${isIn ? 'positive' : 'negative'}">${isIn ? '+' : '-'}${money(Math.abs(t.amount))}</td>`;
}

async function changeCategory(id, category) {
  try {
    await api('/api/transaction_category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: id, user_category: category }),
    });
    await refresh();
  } catch (e) {
    showBanner('Could not recategorize: ' + e.message, 'error');
  }
}

function renderTransactions(tbodyId, pagerId, txns) {
  txnState[tbodyId] = { txns, page: 1, pagerId };
  drawTxnPage(tbodyId);
}

function drawTxnPage(tbodyId) {
  const st = txnState[tbodyId];
  const total = st.txns.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (st.page > pages) st.page = pages;

  const start = (st.page - 1) * PAGE_SIZE;
  const slice = st.txns.slice(start, start + PAGE_SIZE);
  const body = $(tbodyId);
  body.innerHTML = total
    ? slice.map((t) => `<tr>${txnRowHtml(t)}</tr>`).join('')
    : '<tr><td colspan="4" class="muted">No transactions.</td></tr>';
  body.querySelectorAll('.cat-select').forEach((sel) =>
    sel.addEventListener('change', () => changeCategory(sel.dataset.txn, sel.value))
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

  $('balance-value').textContent = money(o.balance);
  $('balance-sub').textContent = o.accountCount
    ? `across ${o.accountCount} account${o.accountCount === 1 ? '' : 's'}` + (o.latest ? ` · as of ${o.latest}` : '')
    : 'no accounts imported yet';
  // Donut shows all-time by default; clicking a month in the grid below scopes it
  // to that month (click again to return to all-time).
  const showDonut = (monthKey) => {
    const m = monthKey && o.monthly.find((x) => x.month === monthKey);
    $('overview-chart-title').textContent = m
      ? `Where your income has gone — ${monthLabel(monthKey)}`
      : 'Where your income has gone (all-time)';
    renderDonut('overview-chart', 'overview-legend', m || o);
  };
  showDonut(null);

  $('overview-bars-title').textContent = `By month — ${o.activeYear}`;
  // Click a month to scope the donut to it (toggle off by clicking again).
  renderMonthGrid('overview-bars', o.monthly, o.activeYear, showDonut, false, true);

  // Editable budget table — the single source of truth for budgets.
  $('overview-budget-body').innerHTML = o.categories
    .map(
      (row) => `
      <tr>
        <td>${row.category}${row.custom ? ` <button class="del-cat" data-cat="${row.category}" title="Delete category">×</button>` : ''}</td>
        <td class="num"><input class="limit-input" type="number" min="0" step="10"
          value="${row.limit ?? ''}" data-cat="${row.category}" placeholder="—" /></td>
      </tr>`
    )
    .join('');
  const obody = $('overview-budget-body');
  obody.querySelectorAll('.limit-input').forEach((input) => input.addEventListener('change', () => saveBudget(input)));
  obody.querySelectorAll('.del-cat').forEach((b) => b.addEventListener('click', () => deleteCategory(b.dataset.cat)));

  const totalBudget = o.categories.reduce((s, r) => s + (r.limit || 0), 0);
  $('overview-budget-foot').innerHTML =
    `<tr class="total-row"><td>Total</td><td class="num">${money(totalBudget)}</td></tr>`;
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

  // Year view drops the budget table and widens the chart panel to the month grid.
  $('month-budget-panel').hidden = isYear;
  $('month-chart-panel').classList.toggle('wide', isYear);
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
  date.max = `${period}-28`;
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
    showBanner(
      `No data yet — open the <strong>${activeYear}</strong> tab, click a month, then <strong>Import CSV</strong> (or add transactions manually). Your data stays on this machine.`,
      'info'
    );
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

  if (active === 'overview') renderOverview(overview);
  else renderPeriod(await api('/api/summary?period=' + active));
}

$('add-cat-btn').addEventListener('click', addCategory);
$('new-cat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCategory();
});
$('month-import-btn').addEventListener('click', () => $('csv-input').click());
$('csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = ''; // allow re-importing the same file
  importCsv(text, file.name);
});

refresh().catch((e) => showBanner('Error: ' + e.message, 'error'));

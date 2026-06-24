const $ = (id) => document.getElementById(id);
const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
const PAGE_SIZE = 10;

const txnState = {}; // tbodyId -> { txns, page, pagerId }
let categoryOptions = []; // assignable categories for the per-transaction dropdown
let active = 'overview'; // 'overview' or a 'YYYY-MM' string

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
    await refresh();
    showBanner(
      `Imported ${r.imported.toLocaleString()} transaction${r.imported === 1 ? '' : 's'}` +
        (r.skipped ? ` (${r.skipped} rows skipped)` : '') + '.',
      'info'
    );
    setTimeout(() => ($('banner').hidden = true), 4000);
  } catch (e) {
    showBanner('Import failed: ' + e.message, 'error');
  }
}

// --- Donut chart (animated SVG, hover-linked legend + live center) ----------
function renderDonut(containerId, legendId, totals) {
  const container = $(containerId);
  const legend = $(legendId);

  const present = PIE.map((s) => ({ ...s, value: totals[s.key] || 0 })).filter((s) => s.value > 0);
  const total = present.reduce((a, s) => a + s.value, 0);

  if (!present.length || total <= 0) {
    container.innerHTML = '';
    legend.innerHTML = '<li class="muted small">No data yet for this period.</li>';
    return;
  }

  const size = 200;
  const stroke = 22;
  const r = size / 2 - stroke / 2;
  const C = 2 * Math.PI * r;

  let cum = 0;
  const segs = present.map((s, i) => {
    const frac = s.value / total;
    const seg = { ...s, i, arc: frac * C, offset: (cum / total) * C, pct: frac * 100 };
    cum += s.value;
    return seg;
  });
  const keyToIdx = Object.fromEntries(segs.map((s) => [s.key, s.i]));

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
      `<span class="donut-center-label">Income</span>` +
      `<span class="donut-center-value">${money(totals.income || 0)}</span>`;
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

// --- Transactions (paginated, 10/page) -------------------------------------
function txnRowHtml(t) {
  const isIn = t.amount > 0; // credit = money in
  const opts = categoryOptions
    .map((c) => `<option${c === t.effective_category ? ' selected' : ''}>${c}</option>`)
    .join('');
  return `
    <td class="muted">${t.date}</td>
    <td>${t.name}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
    <td><select class="cat-select" data-txn="${t.transaction_id}">${opts}</select></td>
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
  $('balance-sub').textContent =
    `across ${o.accountCount} account${o.accountCount === 1 ? '' : 's'}` +
    (o.latest ? ` · as of ${o.latest}` : '');
  renderDonut('overview-chart', 'overview-legend', o);

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

  // Transactions show only on month tabs, not year views.
  const isMonth = /^\d{4}-\d{2}$/.test(p.period);
  $('month-txn-panel').hidden = !isMonth;
  if (isMonth) {
    $('month-txn-title').textContent = `Transactions — ${label}`;
    renderTransactions('month-txn-body', 'month-pager', p.transactions);
  }
}

// --- Tabs + boot -----------------------------------------------------------
function renderTabs(months) {
  // Overview · All Time · then each year (newest first) followed by its months.
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const tokens = ['overview'];
  for (const y of years) {
    tokens.push(y);
    for (const m of months) if (m.slice(0, 4) === y) tokens.push(m);
  }

  const nav = $('tabs');
  nav.hidden = false;
  nav.innerHTML = tokens
    .map((t) => {
      const isPeriod = t === 'all' || /^\d{4}$/.test(t);
      const cls = `tab${active === t ? ' active' : ''}${isPeriod ? ' tab-period' : ''}`;
      return `<button class="${cls}" data-tab="${t}">${periodLabel(t)}</button>`;
    })
    .join('');
  nav.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      active = b.dataset.tab;
      refresh();
    })
  );
}

function hideData() {
  $('tabs').hidden = true;
  $('view-overview').hidden = true;
  $('view-month').hidden = true;
}

async function refresh() {
  const status = await api('/api/status');
  $('env-badge').textContent = 'Local';
  $('env-badge').className = 'badge prod';

  if (!status.hasData) {
    hideData();
    $('institutions').textContent = '';
    return showBanner(
      'Import a <strong>CSV export</strong> from your bank to get started — click <strong>Import CSV</strong> above. Your data stays on this machine.',
      'info'
    );
  }

  $('institutions').textContent =
    `${status.count.toLocaleString()} transactions · ${status.earliest} → ${status.latest}`;
  $('banner').hidden = true;

  const overview = await api('/api/overview');
  const valid = new Set([...overview.months, ...overview.months.map((m) => m.slice(0, 4))]);
  if (active !== 'overview' && !valid.has(active)) active = 'overview';
  renderTabs(overview.months);

  if (active === 'overview') renderOverview(overview);
  else renderPeriod(await api('/api/summary?period=' + active));
}

$('add-cat-btn').addEventListener('click', addCategory);
$('new-cat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCategory();
});
$('import-btn').addEventListener('click', () => $('csv-input').click());
$('csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = ''; // allow re-importing the same file
  importCsv(text, file.name);
});

refresh().catch((e) => showBanner('Error: ' + e.message, 'error'));

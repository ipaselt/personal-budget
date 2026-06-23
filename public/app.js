const $ = (id) => document.getElementById(id);
const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const PIE = [
  { key: 'spending', label: 'Spending', color: '#ff6a6a' },
  { key: 'savings', label: 'Savings', color: '#6d8cff' },
  { key: 'leftover', label: 'Leftover', color: '#41d68a' },
];
const PAGE_SIZE = 10;

const txnState = {}; // tbodyId -> { txns, page, pagerId }
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
  return `
    <td class="muted">${t.date}</td>
    <td>${t.name}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
    <td class="muted small">${t.effective_category}</td>
    <td class="num ${isIn ? 'positive' : 'negative'}">${isIn ? '+' : '-'}${money(Math.abs(t.amount))}</td>`;
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
        <td>${row.category}</td>
        <td class="num"><input class="limit-input" type="number" min="0" step="10"
          value="${row.limit ?? ''}" data-cat="${row.category}" placeholder="—" /></td>
      </tr>`
    )
    .join('');
  $('overview-budget-body')
    .querySelectorAll('.limit-input')
    .forEach((input) => input.addEventListener('change', () => saveBudget(input)));

  const totalBudget = o.categories.reduce((s, r) => s + (r.limit || 0), 0);
  $('overview-budget-foot').innerHTML =
    `<tr class="total-row"><td>Total</td><td class="num">${money(totalBudget)}</td></tr>`;
}

// --- One month -------------------------------------------------------------
function renderMonth(m) {
  $('view-overview').hidden = true;
  $('view-month').hidden = false;

  $('month-budget-title').textContent = `Budget by category — ${monthLabel(m.month)}`;
  $('month-pie-title').textContent = `${monthLabel(m.month)} breakdown`;

  const incomeRow = `
      <tr class="income-row">
        <td>Income</td>
        <td class="num">—</td>
        <td class="num positive">+${money(m.income)}</td>
      </tr>`;
  $('month-budget-body').innerHTML =
    incomeRow +
    m.categories
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

  const totalBudget = m.categories.reduce((s, r) => s + (r.limit || 0), 0);
  const totalSpent = m.categories.reduce((s, r) => s + r.spent, 0);
  $('month-budget-foot').innerHTML =
    `<tr class="total-row"><td>Total</td><td class="num">${money(totalBudget)}</td>` +
    `<td class="num">${money(totalSpent)}</td></tr>`;

  renderDonut('month-chart', 'month-legend', m);

  $('month-txn-title').textContent = `Transactions — ${monthLabel(m.month)}`;
  renderTransactions('month-txn-body', 'month-pager', m.transactions);
}

// --- Tabs + boot -----------------------------------------------------------
function renderTabs(months) {
  const nav = $('tabs');
  nav.hidden = false;
  const tab = (id, label) =>
    `<button class="tab ${active === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
  nav.innerHTML = tab('overview', 'Overview') + months.map((m) => tab(m, monthLabel(m))).join('');
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
  if (active !== 'overview' && !overview.months.includes(active)) active = 'overview';
  renderTabs(overview.months);

  if (active === 'overview') renderOverview(overview);
  else renderMonth(await api('/api/summary?month=' + active));
}

$('import-btn').addEventListener('click', () => $('csv-input').click());
$('csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = ''; // allow re-importing the same file
  importCsv(text, file.name);
});

refresh().catch((e) => showBanner('Error: ' + e.message, 'error'));

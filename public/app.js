const $ = (id) => document.getElementById(id);
const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const PIE = [
  { key: 'spending', label: 'Spending', color: '#f85149' },
  { key: 'savings', label: 'Savings', color: '#4f9cf9' },
  { key: 'leftover', label: 'Leftover', color: '#3fb950' },
];
const PAGE_SIZE = 10;

const charts = {};
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

// --- Plaid Link ------------------------------------------------------------
async function connectBank() {
  try {
    const { link_token } = await api('/api/create_link_token', { method: 'POST' });
    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (public_token, metadata) => {
        showBanner('Linking account and pulling transactions…');
        try {
          await api('/api/exchange_public_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token, institution: metadata.institution }),
          });
          $('banner').hidden = true;
          await refresh();
        } catch (e) {
          showBanner('Could not finish linking: ' + e.message, 'error');
        }
      },
    });
    handler.open();
  } catch (e) {
    showBanner('Could not start Plaid Link: ' + e.message, 'error');
  }
}

async function sync() {
  const btn = $('sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    await api('/api/sync', { method: 'POST' });
    await refresh();
  } catch (e) {
    showBanner('Sync failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync';
  }
}

// --- Pie -------------------------------------------------------------------
function renderPie(canvasId, legendId, totals) {
  const slices = PIE.map((s) => ({ ...s, value: totals[s.key] || 0 })).filter((s) => s.value > 0);
  const ctx = $(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();

  const legend = $(legendId);
  if (!slices.length) {
    ctx.style.display = 'none';
    legend.innerHTML = '<li class="muted small">No data yet for this period.</li>';
    return;
  }
  ctx.style.display = 'block';
  charts[canvasId] = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [{ data: slices.map((s) => s.value), backgroundColor: slices.map((s) => s.color) }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)}` } },
      },
    },
  });

  legend.innerHTML =
    `<li class="legend-total"><span class="legend-name"><span class="dot" style="background:transparent"></span>Income</span><strong>${money(totals.income || 0)}</strong></li>` +
    PIE.map(
      (s) =>
        `<li><span class="legend-name"><span class="dot" style="background:${s.color}"></span>${s.label}</span><strong>${money(totals[s.key] || 0)}</strong></li>`
    ).join('');
}

// --- Transactions (paginated, 10/page) -------------------------------------
function txnRowHtml(t) {
  const isIn = t.amount < 0; // money coming in
  return `
    <td class="muted">${t.date}</td>
    <td>${t.merchant_name || t.name}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
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

  $('cash-balance').textContent = money(o.cash);
  $('stash-balance').textContent = money(o.stash);
  renderPie('overview-chart', 'overview-legend', o);

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

  // Income earned this month, then the (read-only) budget rows below it.
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

  renderPie('month-chart', 'month-legend', m);

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

async function refresh() {
  const status = await api('/api/status');
  $('env-badge').textContent = status.env;
  $('env-badge').className = 'badge ' + (status.env === 'production' ? 'prod' : 'sandbox');
  $('connect-btn').hidden = !status.configured;
  $('institutions').textContent = status.institutions.join(' · ');

  if (!status.configured) {
    $('tabs').hidden = true;
    $('view-overview').hidden = true;
    $('view-month').hidden = true;
    return showBanner(
      'Add your Plaid keys to <code>.env</code> (copy from <code>.env.example</code>), then restart the server.',
      'warn'
    );
  }
  if (!status.connected) {
    $('tabs').hidden = true;
    $('view-overview').hidden = true;
    $('view-month').hidden = true;
    return showBanner(
      'Click <strong>Connect a bank</strong> to link an account. In Sandbox, use <code>user_good</code> / <code>pass_good</code>.',
      'info'
    );
  }

  $('banner').hidden = true;
  $('sync-btn').hidden = false;

  const overview = await api('/api/overview');
  if (active !== 'overview' && !overview.months.includes(active)) active = 'overview';
  renderTabs(overview.months);

  if (active === 'overview') renderOverview(overview);
  else renderMonth(await api('/api/summary?month=' + active));
}

$('connect-btn').addEventListener('click', connectBank);
$('sync-btn').addEventListener('click', sync);
refresh().catch((e) => showBanner('Error: ' + e.message, 'error'));

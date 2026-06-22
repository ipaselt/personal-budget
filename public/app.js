const $ = (id) => document.getElementById(id);
const money = (n) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prettyCategory = (c) =>
  (c || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const PIE = [
  { key: 'spending', label: 'Spending', color: '#f85149' },
  { key: 'savings', label: 'Savings', color: '#4f9cf9' },
  { key: 'leftover', label: 'Leftover', color: '#3fb950' },
];

const charts = {};
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

// --- Shared renderers ------------------------------------------------------
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
    options: { plugins: { legend: { display: false } } },
  });

  legend.innerHTML =
    `<li class="legend-total">Income <strong>${money(totals.income || 0)}</strong></li>` +
    PIE.map(
      (s) =>
        `<li><span class="dot" style="background:${s.color}"></span>${s.label}
         <strong>${money(totals[s.key] || 0)}</strong></li>`
    ).join('');
}

function renderTransactions(tbodyId, txns) {
  const body = $(tbodyId);
  body.innerHTML = '';
  if (!txns.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted">No transactions.</td></tr>';
    return;
  }
  for (const t of txns.slice(0, 100)) {
    const tr = document.createElement('tr');
    const isIn = t.amount < 0;
    tr.innerHTML = `
      <td class="muted">${t.date}</td>
      <td>${t.merchant_name || t.name}${t.pending ? ' <span class="pending">pending</span>' : ''}</td>
      <td class="muted small">${t.effective_category}</td>
      <td class="num ${isIn ? 'positive' : ''}">${isIn ? '+' : ''}${money(Math.abs(t.amount))}</td>`;
    body.appendChild(tr);
  }
}

// --- Overview --------------------------------------------------------------
function renderOverview(o) {
  $('view-overview').hidden = false;
  $('view-month').hidden = true;

  $('cash-balance').textContent = money(o.cash);
  $('stash-balance').textContent = money(o.stash);
  renderPie('overview-chart', 'overview-legend', o);

  const ul = $('accounts');
  ul.innerHTML = '';
  if (!o.accounts.length) ul.innerHTML = '<li class="muted">No accounts yet.</li>';
  for (const a of o.accounts) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${a.name}${a.mask ? ` ••${a.mask}` : ''}
        <span class="muted small">${prettyCategory(a.subtype || a.type || '')}</span></span>
      <strong>${money(a.current_balance ?? 0)}</strong>`;
    ul.appendChild(li);
  }

  renderTransactions('overview-txn-body', o.recentTransactions);
}

// --- One month -------------------------------------------------------------
function renderMonth(m) {
  $('view-overview').hidden = true;
  $('view-month').hidden = false;

  $('month-budget-title').textContent = `Budget by category — ${monthLabel(m.month)}`;
  $('month-pie-title').textContent = `${monthLabel(m.month)} breakdown`;

  const body = $('month-budget-body');
  body.innerHTML = '';
  for (const row of m.categories) {
    const tr = document.createElement('tr');
    const over = row.limit != null && row.spent > row.limit;
    tr.innerHTML = `
      <td>${row.category}</td>
      <td><input class="limit-input" type="number" min="0" step="10"
           value="${row.limit ?? ''}" data-cat="${row.category}" placeholder="—" /></td>
      <td class="num ${over ? 'over-text' : ''}">${money(row.spent)}</td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll('.limit-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api('/api/budget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: input.dataset.cat, monthly_limit: input.value }),
        });
        await refresh(); // budgets are recurring → reflect everywhere
      } catch (e) {
        showBanner('Could not save budget: ' + e.message, 'error');
      }
    });
  });

  // Column totals
  const totalBudget = m.categories.reduce((s, r) => s + (r.limit || 0), 0);
  const totalSpent = m.categories.reduce((s, r) => s + r.spent, 0);
  $('month-budget-foot').innerHTML =
    `<tr class="total-row"><td>Total</td><td>${money(totalBudget)}</td>` +
    `<td class="num">${money(totalSpent)}</td></tr>`;

  renderPie('month-chart', 'month-legend', m);

  $('month-txn-title').textContent = `Transactions — ${monthLabel(m.month)}`;
  renderTransactions('month-txn-body', m.transactions);
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

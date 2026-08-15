import { FinanceDB } from './db.js';

const db = new FinanceDB();
const state = {
  snapshot: null,
  valuesHidden: false,
  currentView: 'home',
  transactionFilter: 'all',
  deferredInstallPrompt: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const el = (tag, className = '', html = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
};

const ICONS = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 3 18 18"/><path d="M10.6 5.2A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.1 3.2M6.2 6.2C3.4 8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M15 9 21 3M18 3h3v3"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h15a2 2 0 0 1 2 2v12H4a2 2 0 0 1-2-2V5.5A2.5 2.5 0 0 1 4.5 3H18"/><path d="M16 11h5v4h-5a2 2 0 1 1 0-4Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};

function hydrateIcons() {
  $$('[data-icon]').forEach((node) => { node.innerHTML = ICONS[node.dataset.icon] || ''; });
}

function money(cents, hidden = state.valuesHidden) {
  if (hidden) return 'R$ ••••••';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function parseMoney(raw) {
  let text = String(raw ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!text || text === '-' || text.startsWith('-')) return null;
  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;
  let separator = null;
  if (commaCount && dotCount) separator = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
  else if (commaCount) {
    const fraction = text.length - text.lastIndexOf(',') - 1;
    if (fraction <= 2) separator = ',';
  } else if (dotCount) {
    const fraction = text.length - text.lastIndexOf('.') - 1;
    if (!(dotCount === 1 && fraction === 3 && text.indexOf('.') <= 3) && fraction <= 2) separator = '.';
  }
  let integerDigits, fractionDigits;
  if (separator) {
    const pos = text.lastIndexOf(separator);
    integerDigits = text.slice(0, pos).replace(/[.,]/g, '') || '0';
    fractionDigits = text.slice(pos + 1).replace(/[.,]/g, '');
    if (fractionDigits.length > 2) return null;
  } else {
    integerDigits = text.replace(/[.,]/g, '') || '0';
    fractionDigits = '';
  }
  if (!/^\d+$/.test(integerDigits) || (fractionDigits && !/^\d+$/.test(fractionDigits))) return null;
  const whole = Number(integerDigits);
  const fraction = Number(fractionDigits.padEnd(2, '0') || '0');
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localNoonISO(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Bom dia 👋' : hour < 18 ? 'Boa tarde 👋' : 'Boa noite 👋';
}

async function refresh() {
  state.snapshot = await db.getSnapshot();
  renderAll();
}

function renderAll() {
  $('#greeting').textContent = greeting();
  renderSummary();
  renderDonut();
  renderCashFlow();
  renderBudgets();
  renderGoals();
  renderTransactions();
  renderAccounts();
  renderPrivacyIcon();
}

function renderSummary() {
  const s = state.snapshot;
  const items = [
    ['Saldo consolidado', s.balanceCents, 'Disponível considerando lançamentos até hoje', true],
    ['Entradas do mês', s.monthIncomeCents, 'Receitas registradas neste mês'],
    ['Saídas do mês', s.monthExpenseCents, 'Despesas registradas neste mês'],
    ['Saldo projetado', s.projectedBalanceCents, 'Considerando lançamentos até o fim do mês'],
  ];
  $('#summaryCards').innerHTML = items.map(([label, value, caption, primary]) => `
    <article class="summary-card ${primary ? 'primary' : ''}">
      <span class="summary-label">${label}</span>
      <strong class="summary-value">${money(value)}</strong>
      <span class="summary-caption">${caption}</span>
    </article>`).join('');
}

function renderDonut() {
  const data = state.snapshot.categorySpending;
  const root = $('#donutChart');
  if (!data.length) {
    root.innerHTML = emptyState('Ainda sem gastos', 'Registre uma despesa para ver a distribuição por categoria.');
    return;
  }
  const total = data.reduce((sum, x) => sum + x.amountCents, 0);
  const r = 52, circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = data.map((item, index) => {
    const dash = (item.amountCents / total) * circumference;
    const html = `<circle class="donut-segment" data-index="${index}" cx="70" cy="70" r="${r}" fill="none" stroke="${item.category.color}" stroke-width="16" stroke-linecap="butt" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)" opacity=".9"><title>${escapeHTML(item.category.name)}: ${money(item.amountCents, false)}</title></circle>`;
    offset += dash;
    return html;
  }).join('');
  root.innerHTML = `<div class="donut-layout">
    <svg class="donut-svg" viewBox="0 0 140 140" role="img" aria-label="Gráfico de gastos por categoria">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="#edf2f7" stroke-width="16" />
      ${circles}
      <text x="70" y="66" class="donut-center-label">TOTAL</text>
      <text x="70" y="84" class="donut-center-value">${state.valuesHidden ? '••••' : compactMoney(total)}</text>
    </svg>
    <div class="legend">${data.slice(0, 7).map((item, i) => `<div class="legend-row" data-legend="${i}"><span class="legend-dot" style="background:${item.category.color}"></span><span>${escapeHTML(item.category.name)}</span><strong>${money(item.amountCents)}</strong></div>`).join('')}</div>
  </div>`;
  $$('.donut-segment', root).forEach((segment) => {
    segment.addEventListener('click', () => {
      $$('.donut-segment', root).forEach((s) => s.classList.remove('active'));
      segment.classList.add('active');
      const item = data[Number(segment.dataset.index)];
      showToast(`${item.category.name}: ${money(item.amountCents, false)}`);
    });
  });
}

function compactMoney(cents) {
  const value = cents / 100;
  if (Math.abs(value) >= 1000000) return `R$ ${(value / 1000000).toFixed(1).replace('.', ',')} mi`;
  if (Math.abs(value) >= 1000) return `R$ ${(value / 1000).toFixed(1).replace('.', ',')} mil`;
  return `R$ ${Math.round(value)}`;
}

function renderCashFlow() {
  const data = state.snapshot.cashFlow;
  const max = Math.max(1, ...data.flatMap((x) => [x.incomeCents, x.expenseCents]));
  $('#cashFlowChart').innerHTML = `<div class="bars">${data.map((x) => `
    <div class="bar-month">
      <div class="bar-pair">
        <div class="bar income" style="height:${Math.max(2, x.incomeCents / max * 100)}%" data-tip="Entradas: ${money(x.incomeCents, false)}"></div>
        <div class="bar expense" style="height:${Math.max(2, x.expenseCents / max * 100)}%" data-tip="Saídas: ${money(x.expenseCents, false)}"></div>
      </div>
      <div class="month-label">${x.label}</div>
    </div>`).join('')}</div><div class="chart-legend"><span class="inc">Entradas</span><span class="exp">Saídas</span></div>`;
}

function renderBudgets() {
  const html = state.snapshot.budgets.length ? state.snapshot.budgets.map((b) => {
    const ratio = b.limitCents ? b.spentCents / b.limitCents : 0;
    const pct = Math.round(ratio * 100);
    const level = ratio < .7 ? 'good' : ratio <= .9 ? 'warn' : 'danger';
    return `<article class="budget-item">
      <div class="budget-top"><div class="budget-name"><span class="category-dot" style="background:${b.category.color}"></span>${escapeHTML(b.category.name)}</div><div class="budget-amount"><strong>${money(b.spentCents)}</strong><br>de ${money(b.limitCents)}</div></div>
      <div class="progress-track"><div class="progress-fill ${level}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="goal-meta"><span>${pct}% usado</span><span>${ratio > 1 ? `${money(b.spentCents - b.limitCents)} acima` : `${money(b.limitCents - b.spentCents)} disponível`}</span></div>
      <div class="item-actions"><button class="text-btn danger" data-delete-budget="${b.id}">Excluir</button></div>
    </article>`;
  }).join('') : emptyState('Nenhum teto criado', 'Defina um limite mensal para alguma categoria de despesa.');
  $('#homeBudgets').innerHTML = html;
  $('#planningBudgets').innerHTML = html;
}

function renderGoals() {
  const html = state.snapshot.goals.length ? state.snapshot.goals.map((g) => {
    const ratio = g.targetCents ? g.currentCents / g.targetCents : 0;
    const pct = Math.min(100, Math.round(ratio * 100));
    const missing = Math.max(0, g.targetCents - g.currentCents);
    return `<article class="goal-card">
      <div class="goal-head"><div><strong>${escapeHTML(g.name)}</strong>${g.targetDate ? `<div class="tx-sub">Meta: ${new Date(`${g.targetDate}T12:00:00`).toLocaleDateString('pt-BR')}</div>` : ''}</div><span class="goal-percent">${pct}%</span></div>
      <div class="progress-track"><div class="progress-fill good" style="width:${pct}%"></div></div>
      <div class="goal-meta"><span>${money(g.currentCents)} guardado</span><span>Faltam ${money(missing)}</span></div>
      <div class="item-actions"><button class="text-btn" data-contribute-goal="${g.id}">Adicionar</button><button class="text-btn danger" data-delete-goal="${g.id}">Excluir</button></div>
    </article>`;
  }).join('') : emptyState('Nenhum cofrinho', 'Crie uma meta para acompanhar quanto falta guardar.');
  $('#homeGoals').innerHTML = html;
  $('#planningGoals').innerHTML = html;
}

function transactionTitle(tx) {
  if (tx.type === 'transfer') return `${tx.accountName} → ${tx.destinationAccountName}`;
  return tx.note || tx.category?.name || (tx.type === 'income' ? 'Receita' : 'Despesa');
}
function txSub(tx) {
  const date = new Date(tx.occurredAt).toLocaleDateString('pt-BR');
  const account = tx.type === 'transfer' ? 'Transferência' : `${tx.category?.name || ''} • ${tx.accountName}`;
  const installment = tx.installmentTotal ? ` • ${tx.installmentNumber}/${tx.installmentTotal}` : '';
  const future = new Date(tx.occurredAt) > new Date() ? ' • agendado' : '';
  return `${account}${installment} • ${date}${future}`;
}
function transactionHTML(tx) {
  const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '';
  const symbol = tx.type === 'income' ? '↙' : tx.type === 'expense' ? '↗' : '↔';
  return `<article class="transaction-row">
    <div class="tx-icon ${tx.type}">${symbol}</div>
    <div class="tx-main"><div class="tx-title">${escapeHTML(transactionTitle(tx))}</div><div class="tx-sub">${escapeHTML(txSub(tx))}</div></div>
    <div class="tx-side"><div class="tx-amount ${tx.type}">${sign}${money(tx.amountCents)}</div><button class="tx-delete" data-delete-tx="${tx.id}" aria-label="Excluir lançamento">Excluir</button></div>
  </article>`;
}

function renderTransactions() {
  $('#recentTransactions').innerHTML = state.snapshot.recentTransactions.length ? state.snapshot.recentTransactions.map(transactionHTML).join('') : emptyState('Nenhum lançamento', 'Toque no botão + para registrar sua primeira movimentação.');
  const filtered = state.transactionFilter === 'all' ? state.snapshot.allTransactions : state.snapshot.allTransactions.filter((tx) => tx.type === state.transactionFilter);
  $('#allTransactions').innerHTML = filtered.length ? filtered.map(transactionHTML).join('') : emptyState('Nada por aqui', 'Não há lançamentos neste filtro.');
}

function renderAccounts() {
  $('#accountsList').innerHTML = state.snapshot.accounts.map((a) => `<article class="account-card"><div class="account-name">${escapeHTML(a.name)}</div><div class="account-balance">${money(a.balanceCents)}</div><div class="tx-sub">Saldo inicial: ${money(a.initialBalanceCents)}</div></article>`).join('');
}

function emptyState(title, text) {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong>${escapeHTML(text)}</div>`;
}

function renderPrivacyIcon() {
  const btn = $('#privacyBtn');
  const icon = $('.icon', btn);
  icon.innerHTML = state.valuesHidden ? ICONS.eyeOff : ICONS.eye;
  btn.setAttribute('aria-label', state.valuesHidden ? 'Mostrar valores' : 'Ocultar valores');
  btn.title = btn.getAttribute('aria-label');
}

function navigate(view) {
  state.currentView = view;
  $$('.view').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  $$('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.nav === view));
  $('#mainContent').scrollTo({ top: 0, behavior: 'auto' });
  $('#fab').hidden = view === 'accounts';
}

let previousFocus = null;
function openSheet(title, content) {
  previousFocus = document.activeElement;
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = content;
  $('#sheetBackdrop').hidden = false;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#sheetBody input:not([type=hidden]), #sheetBody select, #sheetBody button')?.focus(), 30);
}
function closeSheet() {
  $('#sheetBackdrop').hidden = true;
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  previousFocus?.focus?.();
}

function newTransactionSheet() {
  const s = state.snapshot;
  if (!s.accounts.length) return showToast('Crie uma conta antes de lançar uma movimentação.');
  openSheet('Novo lançamento', `
    <form id="transactionForm" class="form-grid" novalidate>
      <div class="field"><label>Valor</label><div class="money-input-wrap"><span class="money-prefix">R$</span><input id="txAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Valor" /></div></div>
      <div class="segmented" role="group" aria-label="Tipo"><button type="button" class="active" data-tx-type="expense">Despesa</button><button type="button" data-tx-type="income">Receita</button><button type="button" data-tx-type="transfer">Transferência</button></div>
      <input id="txType" type="hidden" value="expense" />
      <div class="field"><label>Conta</label><select id="txAccount">${s.accounts.map((a) => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('')}</select></div>
      <div id="destinationField" class="field" hidden><label>Conta de destino</label><select id="txDestination"></select></div>
      <div id="categoryField" class="field"><label>Categoria</label><div id="categoryChoices" class="category-grid"></div><input id="txCategory" type="hidden" /></div>
      <div class="field"><label>Data</label><input id="txDate" type="date" value="${localDateInput()}" /></div>
      <div class="field"><label>Descrição (opcional)</label><input id="txNote" maxlength="160" placeholder="Ex.: mercado, salário..." /></div>
      <div class="toggle-row"><div><strong>Fixa mensal</strong><div class="tx-sub">Gera os próximos 12 meses</div></div><label class="switch"><input id="txFixed" type="checkbox"><span></span></label></div>
      <div id="installmentField" class="field"><label>Parcelas</label><select id="txInstallments">${Array.from({length: 60}, (_, i) => `<option value="${i + 1}">${i + 1}${i === 0 ? ' parcela' : ' parcelas'}</option>`).join('')}</select></div>
      <div id="txError" class="error-text"></div>
      <div class="form-actions"><button type="button" class="secondary-btn" data-close-sheet>Cancelar</button><button id="txSubmit" type="submit" class="primary-btn">Salvar lançamento</button></div>
    </form>`);

  const updateForm = () => {
    const type = $('#txType').value;
    $$('.segmented [data-tx-type]').forEach((b) => b.classList.toggle('active', b.dataset.txType === type));
    $('#destinationField').hidden = type !== 'transfer';
    $('#categoryField').hidden = type === 'transfer';
    $('#installmentField').hidden = type === 'transfer';
    const accountId = Number($('#txAccount').value);
    $('#txDestination').innerHTML = s.accounts.filter((a) => a.id !== accountId).map((a) => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
    const categories = s.categories.filter((c) => c.kind === type);
    $('#categoryChoices').innerHTML = categories.map((c, i) => `<button type="button" class="category-choice ${i === 0 ? 'active' : ''}" data-category-id="${c.id}"><span class="cat-symbol">${escapeHTML(c.icon)}</span><span>${escapeHTML(c.name)}</span></button>`).join('');
    $('#txCategory').value = categories[0]?.id || '';
  };
  updateForm();

  $$('.segmented [data-tx-type]').forEach((b) => b.addEventListener('click', () => { $('#txType').value = b.dataset.txType; updateForm(); haptic(); }));
  $('#txAccount').addEventListener('change', updateForm);
  $('#categoryChoices').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category-id]'); if (!button) return;
    $$('.category-choice', $('#categoryChoices')).forEach((b) => b.classList.remove('active'));
    button.classList.add('active'); $('#txCategory').value = button.dataset.categoryId; haptic();
  });
  $('#txFixed').addEventListener('change', () => { $('#txInstallments').disabled = $('#txFixed').checked; });
  $('#transactionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#txSubmit'); submit.disabled = true; $('#txError').textContent = '';
    try {
      const type = $('#txType').value;
      const amountCents = parseMoney($('#txAmount').value);
      await db.addTransaction({
        type,
        amountCents,
        accountId: Number($('#txAccount').value),
        destinationAccountId: type === 'transfer' ? Number($('#txDestination').value) : null,
        categoryId: type === 'transfer' ? null : Number($('#txCategory').value),
        occurredAt: localNoonISO($('#txDate').value),
        note: $('#txNote').value,
        fixedMonthly: $('#txFixed').checked,
        installmentTotal: type === 'transfer' ? 1 : Number($('#txInstallments').value),
      });
      haptic([20]); closeSheet(); await refresh(); showToast('Lançamento salvo.');
    } catch (error) { $('#txError').textContent = error.message || String(error); submit.disabled = false; }
  });
}

function addAccountSheet() {
  openSheet('Nova conta', `<form id="accountForm" class="form-grid" novalidate>
    <div class="field"><label>Nome da conta</label><input id="accountName" maxlength="50" placeholder="Ex.: Carteira, Nubank..." /></div>
    <div class="field"><label>Saldo inicial</label><div class="money-input-wrap"><span class="money-prefix">R$</span><input id="accountBalance" inputmode="decimal" placeholder="0,00" /></div></div>
    <div id="accountError" class="error-text"></div>
    <div class="form-actions"><button type="button" class="secondary-btn" data-close-sheet>Cancelar</button><button class="primary-btn" type="submit">Criar conta</button></div></form>`);
  $('#accountForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#accountError').textContent = '';
    try {
      const raw = $('#accountBalance').value.trim();
      const cents = raw ? parseMoney(raw) : 0;
      if (cents == null) throw new Error('Saldo inicial inválido.');
      await db.addAccount($('#accountName').value, cents); closeSheet(); await refresh(); showToast('Conta criada.');
    } catch (error) { $('#accountError').textContent = error.message; }
  });
}

function addBudgetSheet() {
  const categories = state.snapshot.categories.filter((c) => c.kind === 'expense');
  openSheet('Novo teto de gastos', `<form id="budgetForm" class="form-grid">
    <div class="field"><label>Categoria</label><select id="budgetCategory">${categories.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Limite mensal</label><div class="money-input-wrap"><span class="money-prefix">R$</span><input id="budgetLimit" inputmode="decimal" placeholder="0,00" /></div></div>
    <div id="budgetError" class="error-text"></div>
    <div class="form-actions"><button type="button" class="secondary-btn" data-close-sheet>Cancelar</button><button class="primary-btn" type="submit">Salvar teto</button></div></form>`);
  $('#budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const cents = parseMoney($('#budgetLimit').value); await db.upsertBudget(Number($('#budgetCategory').value), cents); closeSheet(); await refresh(); showToast('Teto atualizado.'); }
    catch (error) { $('#budgetError').textContent = error.message; }
  });
}

function addGoalSheet() {
  openSheet('Novo cofrinho', `<form id="goalForm" class="form-grid">
    <div class="field"><label>Nome da meta</label><input id="goalName" maxlength="60" placeholder="Ex.: Notebook novo" /></div>
    <div class="field"><label>Valor da meta</label><div class="money-input-wrap"><span class="money-prefix">R$</span><input id="goalTarget" inputmode="decimal" placeholder="0,00" /></div></div>
    <div class="field"><label>Data alvo (opcional)</label><input id="goalDate" type="date" /></div>
    <div id="goalError" class="error-text"></div>
    <div class="form-actions"><button type="button" class="secondary-btn" data-close-sheet>Cancelar</button><button class="primary-btn" type="submit">Criar cofrinho</button></div></form>`);
  $('#goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await db.addGoal($('#goalName').value, parseMoney($('#goalTarget').value), $('#goalDate').value || null); closeSheet(); await refresh(); showToast('Cofrinho criado.'); }
    catch (error) { $('#goalError').textContent = error.message; }
  });
}

function contributeGoalSheet(id) {
  const goal = state.snapshot.goals.find((g) => g.id === id); if (!goal) return;
  openSheet(`Adicionar ao cofrinho`, `<form id="contributeForm" class="form-grid"><p class="muted">${escapeHTML(goal.name)} · faltam ${money(Math.max(0, goal.targetCents - goal.currentCents), false)}</p>
    <div class="field"><label>Valor</label><div class="money-input-wrap"><span class="money-prefix">R$</span><input id="contributeAmount" inputmode="decimal" placeholder="0,00" /></div></div>
    <div id="contributeError" class="error-text"></div><div class="form-actions"><button type="button" class="secondary-btn" data-close-sheet>Cancelar</button><button class="primary-btn" type="submit">Adicionar</button></div></form>`);
  $('#contributeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); try { await db.contributeGoal(id, parseMoney($('#contributeAmount').value)); closeSheet(); await refresh(); showToast('Valor adicionado.'); } catch (error) { $('#contributeError').textContent = error.message; }
  });
}

function showToast(text) {
  const toast = $('#toast'); toast.textContent = text; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2300);
}
function haptic(pattern = 8) { if (navigator.vibrate) navigator.vibrate(pattern); }

async function exportBackup() {
  const payload = await db.exportBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `meu-dinheiro-backup-${localDateInput()}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('Backup exportado.');
}

async function importBackup(file) {
  if (!file) return;
  try { const payload = JSON.parse(await file.text()); await db.importBackup(payload); await refresh(); showToast('Backup importado com sucesso.'); }
  catch (error) { alert(`Não foi possível importar o backup.\n\n${error.message}`); }
  finally { $('#importFile').value = ''; }
}

function closeMoreMenu() { $('#moreMenu').hidden = true; $('#menuBackdrop').hidden = true; }
function openMoreMenu() { $('#moreMenu').hidden = false; $('#menuBackdrop').hidden = false; }

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-nav]'); if (nav) navigate(nav.dataset.nav);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'new-transaction') newTransactionSheet();
    if (action === 'add-account') addAccountSheet();
    if (action === 'add-budget') addBudgetSheet();
    if (action === 'add-goal') addGoalSheet();

    if (event.target.closest('[data-close-sheet]')) closeSheet();

    const txButton = event.target.closest('[data-delete-tx]');
    if (txButton) {
      const id = Number(txButton.dataset.deleteTx);
      const tx = state.snapshot.allTransactions.find((x) => x.id === id);
      const deleteGroup = tx?.groupId ? confirm('Este lançamento faz parte de uma sequência.\n\nOK = excluir toda a sequência\nCancelar = escolher apenas este lançamento na próxima pergunta') : false;
      if (!tx?.groupId || deleteGroup || confirm('Excluir somente este lançamento?')) {
        await db.deleteTransaction(id, deleteGroup); await refresh(); showToast(deleteGroup ? 'Sequência excluída.' : 'Lançamento excluído.');
      }
    }
    const budgetBtn = event.target.closest('[data-delete-budget]');
    if (budgetBtn && confirm('Excluir este teto de gastos?')) { await db.deleteBudget(Number(budgetBtn.dataset.deleteBudget)); await refresh(); }
    const goalBtn = event.target.closest('[data-delete-goal]');
    if (goalBtn && confirm('Excluir este cofrinho?')) { await db.deleteGoal(Number(goalBtn.dataset.deleteGoal)); await refresh(); }
    const contribution = event.target.closest('[data-contribute-goal]'); if (contribution) contributeGoalSheet(Number(contribution.dataset.contributeGoal));
  });

  $('#privacyBtn').addEventListener('click', async () => { state.valuesHidden = !state.valuesHidden; await db.setSetting('valuesHidden', state.valuesHidden); haptic(); renderAll(); });
  $('#fab').addEventListener('click', newTransactionSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  $('#moreBtn').addEventListener('click', () => $('#moreMenu').hidden ? openMoreMenu() : closeMoreMenu());
  $('#menuBackdrop').addEventListener('click', closeMoreMenu);
  $('#moreMenu').addEventListener('click', async (event) => {
    const action = event.target.closest('[data-menu-action]')?.dataset.menuAction; if (!action) return; closeMoreMenu();
    if (action === 'add-account') addAccountSheet();
    if (action === 'export') await exportBackup();
    if (action === 'install' && state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt(); await state.deferredInstallPrompt.userChoice; state.deferredInstallPrompt = null; $('#installMenuItem').hidden = true;
    }
  });
  $$('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
    state.transactionFilter = chip.dataset.filter; $$('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip)); renderTransactions();
  }));
  $('#exportBtn').addEventListener('click', exportBackup);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => importBackup(e.target.files?.[0]));
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('Isso apagará todas as suas informações financeiras salvas neste navegador. Continuar?')) return;
    if (!confirm('Tem certeza? Esta ação não pode ser desfeita sem um backup.')) return;
    await db.reset(); state.valuesHidden = false; await refresh(); showToast('Dados apagados.');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.deferredInstallPrompt = event; $('#installMenuItem').hidden = false; });
}

async function start() {
  hydrateIcons(); bindEvents();
  try {
    await db.init();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    state.valuesHidden = await db.getSetting('valuesHidden', false); await refresh();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    console.error(error);
    $('#mainContent').innerHTML = `<section class="panel"><h2>Não foi possível iniciar</h2><p class="muted">${escapeHTML(error.message)}</p><p class="muted">Tente abrir o site em um navegador atualizado e, se estiver testando no computador, use um servidor local em vez de abrir o arquivo diretamente.</p></section>`;
  }
}

start();

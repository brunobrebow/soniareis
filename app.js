// app.js — Sonia Reis CRM

// ── SCROLL LOCK ──
// Prevents iOS Safari from breaking overflow:hidden after keyboard/modal interactions
(function() {
  // Block ALL horizontal scroll at window level
  window.addEventListener('scroll', function() {
    if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
  }, { passive: false });

  // Block body-level scrolling — only .screen should scroll
  document.addEventListener('touchmove', function(e) {
    let target = e.target;
    while (target && target !== document.body) {
      const style = window.getComputedStyle(target);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && target.scrollHeight > target.clientHeight) {
        return; // Allow scroll inside scrollable containers (.screen, .modal-sheet, .detail-overlay)
      }
      target = target.parentElement;
    }
    e.preventDefault();
  }, { passive: false });
})();

function lockScroll() {
  window.scrollTo(0, 0);
  document.body.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.documentElement.scrollTop = 0;
}

const COLORS = ['#F4C0D1','#B5D4F4','#9FE1CB','#FAC775','#F5C4B3','#C0DD97'];
const TEXT_COLORS = ['#72243E','#0C447C','#085041','#633806','#993C1D','#3B6D11'];

let state = {
  tab: 'home',
  contacts: [],
  sales: [],
  payments: [],
  search: '',
  detail: null,
  modal: null,
  modalExtra: null,
  chargeFilter: 'mes',
  financeDetail: null,
  chargeModal: null,
  paidModal: null,
  deleteContactModal: null,
  loading: true,
  error: null
};

// ---------- LOGIN ----------

function renderLogin() {
  const el = document.getElementById('login-screen');
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-logo">💎</div>
        <h1 class="login-title">Sonia Reis CRM</h1>
        <p class="login-sub">Entre com suas credenciais</p>
        <div class="form-group" style="margin-top:28px">
          <label class="form-label">Login</label>
          <input class="form-input" id="l-user" type="text" placeholder="usuário" autocomplete="username" />
        </div>
        <div class="form-group">
          <label class="form-label">Senha</label>
          <input class="form-input" id="l-pass" type="password" placeholder="senha" autocomplete="current-password" />
        </div>
        <div id="l-error" style="color:#A32D2D;font-size:13px;min-height:20px;margin-bottom:4px;text-align:center"></div>
        <button class="btn-primary" onclick="doLogin()">Entrar</button>
      </div>
    </div>`;

  // Allow Enter key to submit
  setTimeout(() => {
    document.getElementById('l-pass').addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
    document.getElementById('l-user').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('l-pass').focus();
    });
  }, 100);
}

function doLogin() {
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (AUTH.login(user, pass)) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    init();
  } else {
    document.getElementById('l-error').textContent = 'Login ou senha incorretos.';
    document.getElementById('l-pass').value = '';
    document.getElementById('l-pass').focus();
  }
}

// ---------- INIT ----------

async function init() {
  try {
    await loadData();
    state.loading = false;
  } catch (e) {
    state.loading = false;
    state.error = 'Erro ao conectar com o banco de dados.';
    console.error(e);
  }
  render();
}

async function loadData() {
  const [contacts, sales, payments] = await Promise.all([
    DB.getContacts(),
    DB.getSales(),
    DB.getPayments()
  ]);
  state.contacts = contacts;
  state.sales = sales;
  state.payments = payments;
}

// ---------- HELPERS ----------

function getContact(id) { return state.contacts.find(c => c.id === id); }

function getInitials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function getColorIndex(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash += id.charCodeAt(i);
  return hash % COLORS.length;
}

function getSaleParcels(sale) {
  const today = new Date();
  const m = today.getMonth();
  const y = today.getFullYear();
  const paymentsByIndex = {};
  state.payments
    .filter(p => p.sale_id === sale.id)
    .forEach(p => { paymentsByIndex[p.parcel_index] = p; });

  const paidCount = Object.values(paymentsByIndex).filter(p => p.paid).length;

  return Array.from({ length: sale.parcels }, (_, i) => {
    const d = new Date(y, m - paidCount + i, sale.start_day);
    const payment = paymentsByIndex[i];
    const paidAmount = payment?.paid_amount || 0;
    const remaining = sale.parcel_value - paidAmount;
    return {
      index: i,
      date: d,
      dateStr: d.toLocaleDateString('pt-BR'),
      paid: payment?.paid || false,
      amount: sale.parcel_value,
      paidAmount,
      remaining
    };
  });
}

function getDueCharges(filter) {
  const today = new Date();
  const todayNum = today.getDate();
  const m = today.getMonth();
  const y = today.getFullYear();
  const result = [];

  state.sales.forEach(sale => {
    const parcels = getSaleParcels(sale);
    parcels.forEach(p => {
      if (p.paid) return;
      const day = p.date.getDate();
      const mo = p.date.getMonth();
      const yr = p.date.getFullYear();
      const isToday = day === todayNum && mo === m && yr === y;
      const isPast = p.date < today && !isToday;
      const isUpcoming = p.date > today && mo === m;
      if (filter === 'hoje' && !isToday) return;
      if (filter === 'atrasado' && !isPast) return;
      if (filter === 'mes' && !(isToday || isUpcoming || isPast)) return;
      result.push({ sale, parcel: p, contact: getContact(sale.contact_id), isPast, isToday });
    });
  });

  result.sort((a, b) => a.parcel.date - b.parcel.date);
  return result;
}

function getWhatsappMsg(contact, parcel, sale) {
  const firstName = contact.name.split(' ')[0];
  return `Olá ${firstName}! Esta é uma mensagem de cobrança referente à parcela que vence hoje, dia ${parcel.dateStr}, no valor de R$ ${parcel.amount},00.\n\nCaso queira pagar por Pix, utilize a chave: ${CONFIG.pix}\n\nApós o pagamento, por favor me envie o comprovante. Obrigada! 💖`;
}

function showToast(msg, color = '#3B6D11') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- ACTIONS ----------

async function addContact() {
  const name = document.getElementById('nc-name').value.trim();
  const local = document.getElementById('nc-local').value.trim();
  const phone = document.getElementById('nc-phone').value.replace(/\D/g, '');
  if (!name || !local || !phone) { showToast('Preencha todos os campos', '#A32D2D'); return; }
  try {
    const newContact = await DB.addContact({ name, local, phone: '55' + phone });
    state.contacts.push(newContact);
    state.contacts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    closeModal();
    showToast('Cliente cadastrada!');
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao salvar. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

async function editContact(id) {
  const name = document.getElementById('ec-name').value.trim();
  const local = document.getElementById('ec-local').value.trim();
  const phone = document.getElementById('ec-phone').value.replace(/\D/g, '');
  if (!name || !local || !phone) { showToast('Preencha todos os campos', '#A32D2D'); return; }
  try {
    const updated = await DB.updateContact(id, { name, local, phone: '55' + phone });
    const idx = state.contacts.findIndex(c => c.id === id);
    if (idx >= 0) state.contacts[idx] = updated;
    state.contacts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    closeModal();
    showToast('Dados atualizados!');
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao atualizar. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

async function addSale() {
  const desc = document.getElementById('ns-desc').value.trim();
  const total = parseFloat(document.getElementById('ns-total').value) || 0;
  const parcels = parseInt(document.getElementById('ns-parcels').value) || 1;
  const day = parseInt(document.getElementById('ns-day').value) || 28;
  const contactId = document.getElementById('ns-contact')?.value || state.modalExtra || state.contacts[0]?.id;
  if (!desc || !total || !contactId) { showToast('Preencha todos os campos', '#A32D2D'); return; }
  try {
    const newSale = await DB.addSale({
      contact_id: contactId,
      description: desc,
      total,
      parcels,
      parcel_value: Math.round(total / parcels),
      start_day: day,
      payment_method: 'pix'
    });
    state.sales.push(newSale);
    const newPayments = await DB.initPayments(newSale.id, parcels);
    state.payments.push(...newPayments);
    closeModal();
    showToast('Venda registrada!');
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao salvar. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

async function markPaid(saleId, parcelIndex) {
  const sale = state.sales.find(s => s.id === saleId);
  const payment = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
  if (!sale || !payment) return;
  const remaining = sale.parcel_value - (payment.paid_amount || 0);
  try {
    const totalPaid = (payment.paid_amount || 0) + remaining;
    await DB.markPaid(saleId, parcelIndex, totalPaid, true);
    payment.paid = true;
    payment.paid_at = new Date().toISOString();
    payment.paid_amount = totalPaid;
    state.paidModal = null;
    showToast('Pagamento registrado!');
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao atualizar. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

async function markPartialPaid(saleId, parcelIndex) {
  const inputEl = document.getElementById('partial-amount');
  const val = parseFloat(inputEl?.value) || 0;
  if (val <= 0) { showToast('Insira um valor válido', '#A32D2D'); return; }
  const sale = state.sales.find(s => s.id === saleId);
  const payment = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
  if (!sale || !payment) return;
  const remaining = sale.parcel_value - (payment.paid_amount || 0);
  const amount = Math.min(val, remaining);
  const totalPaid = (payment.paid_amount || 0) + amount;
  const isFullPayment = totalPaid >= sale.parcel_value;
  try {
    await DB.markPaid(saleId, parcelIndex, totalPaid, isFullPayment);
    payment.paid_amount = totalPaid;
    if (isFullPayment) {
      payment.paid = true;
    }
    payment.paid_at = new Date().toISOString();
    state.paidModal = null;
    showToast(`R$ ${amount.toLocaleString('pt-BR')} registrado!`);
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao atualizar. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

async function confirmDeleteContact() {
  const id = state.deleteContactModal;
  if (!id) return;
  try {
    await DB.deleteContact(id);
    state.contacts = state.contacts.filter(c => c.id !== id);
    const saleIds = state.sales.filter(s => s.contact_id === id).map(s => s.id);
    state.sales = state.sales.filter(s => s.contact_id !== id);
    state.payments = state.payments.filter(p => !saleIds.includes(p.sale_id));
    state.deleteContactModal = null;
    state.detail = null;
    showToast('Cliente excluída.');
    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao excluir. Tente novamente.', '#A32D2D');
    console.error(e);
  }
}

// ---------- NAVIGATION ----------

function switchTab(tab) { state.tab = tab; state.detail = null; state.financeDetail = null; render(); }
function updateSearch(v) {
  state.search = v;
  render();
  const input = document.querySelector('.search-box input');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
function openDetail(id) { state.detail = id; render(); }
function closeDetail() { state.detail = null; render(); }
function openModal(m, extra) { state.modal = m; state.modalExtra = extra || null; render(); }
function closeModal() { state.modal = null; state.chargeModal = null; state.paidModal = null; state.deleteContactModal = null; render(); setTimeout(lockScroll, 100); setTimeout(lockScroll, 300); }
function setChargeFilter(f) { state.chargeFilter = f; render(); }
function toggleFinanceDetail(key) { state.financeDetail = state.financeDetail === key ? null : key; render(); }
function openPaidModal(saleId, parcelIndex) { state.paidModal = { saleId, parcelIndex }; render(); }
function openDeleteContactModal(id) { state.deleteContactModal = id; render(); }
function openWpp(url) { window.open(url, '_blank'); closeModal(); }

// ---------- RENDER ----------

function render() {
  const screen = document.getElementById('screen');
  const nav = document.getElementById('bottomnav');
  if (!screen) return;

  if (state.loading) {
    screen.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:60px 20px;flex-direction:column;gap:16px">
      <div class="spinner"></div>
      <p style="color:#888;font-size:15px">Carregando...</p>
    </div>`;
    if (nav) nav.innerHTML = '';
    return;
  }

  if (state.error) {
    screen.innerHTML = `<div style="padding:40px 20px;text-align:center">
      <p style="color:#A32D2D;font-size:15px;margin-bottom:12px">${state.error}</p>
      <button onclick="init()" style="padding:10px 20px;background:#D4537E;color:white;border:none;border-radius:10px;font-size:14px;cursor:pointer">Tentar novamente</button>
    </div>`;
    if (nav) nav.innerHTML = '';
    return;
  }

  let html = '';
  if (state.tab === 'home') html = renderHome();
  else if (state.tab === 'contatos') html = renderContatos();
  else if (state.tab === 'cobrancas') html = renderCobrancas();
  else html = renderFinanceiro();

  if (state.detail) html += renderDetail(state.detail);
  html += renderModal();
  screen.innerHTML = html;
  renderNav();
  lockScroll();
}

function renderNav() {
  const tabs = [
    { id: 'home', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
    { id: 'contatos', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
    { id: 'cobrancas', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>' },
    { id: 'financeiro', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' }
  ];

  const nav = document.getElementById('bottomnav');
  if (nav) {
    const anyOverlay = state.modal || state.detail || state.chargeModal || state.paidModal || state.deleteContactModal;
    if (anyOverlay) {
      nav.style.display = 'none';
    } else {
      nav.style.display = 'flex';
      nav.innerHTML = tabs.map(t => `
      <div class="nav-item ${state.tab === t.id ? 'active' : ''}" onclick="switchTab('${t.id}')">
        <span class="nav-icon">${t.svg}</span>
      </div>`).join('');
    }
  }

}

// ---------- SCREENS ----------

function renderHome() {
  const today = new Date();
  const diasSemana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const diaSemana = diasSemana[today.getDay()];
  const diaNum = today.getDate();
  const mes = meses[today.getMonth()];

  // Stats
  const totalVendido = state.sales.reduce((a, s) => a + s.total, 0);
  const totalRecebido = state.payments.filter(p => p.paid).reduce((a, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return a + (p.paid_amount || sale?.parcel_value || 0);
  }, 0);
  const totalPendente = state.payments.filter(p => !p.paid).reduce((a, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return a + (sale ? sale.parcel_value - (p.paid_amount || 0) : 0);
  }, 0);
  const lateCharges = getDueCharges('atrasado');
  const todayCharges = getDueCharges('hoje');
  const atrasadoTotal = lateCharges.reduce((a, c) => a + c.parcel.amount, 0);
  const clientesAtivas = state.contacts.filter(c => {
    return state.sales.some(s => s.contact_id === c.id && getSaleParcels(s).some(p => !p.paid));
  }).length;

  // Upcoming 3 charges
  const proximas = getDueCharges('mes').filter(c => !c.isPast).slice(0, 3);

  return `
    <div class="screen-scroll-list" style="padding-bottom:90px">
      <div class="home-header">
        <div class="home-greeting">Olá, Sônia</div>
        <div class="home-date">${diaSemana}, ${diaNum} de ${mes}</div>
      </div>

      <div class="home-card home-card-main">
        <div class="home-card-row">
          <div>
            <div class="home-card-label">Total vendido</div>
            <div class="home-card-big" style="color:#1a1a1a">R$ ${totalVendido.toLocaleString('pt-BR')}</div>
          </div>
          <div style="text-align:right">
            <div class="home-card-label">Recebido</div>
            <div class="home-card-big" style="color:#3B6D11">R$ ${totalRecebido.toLocaleString('pt-BR')}</div>
          </div>
        </div>
        <div class="home-progress-bg">
          <div class="home-progress-fill" style="width:${totalVendido > 0 ? Math.round(totalRecebido / totalVendido * 100) : 0}%"></div>
        </div>
        <div class="home-card-row" style="margin-top:4px">
          <span class="home-card-sub">${totalVendido > 0 ? Math.round(totalRecebido / totalVendido * 100) : 0}% recebido</span>
          <span class="home-card-sub">Falta R$ ${totalPendente.toLocaleString('pt-BR')}</span>
        </div>
      </div>

      <div class="home-stats-row">
        <div class="home-stat-box" onclick="switchTab('cobrancas')">
          <div class="home-stat-num" style="color:#A32D2D">${lateCharges.length}</div>
          <div class="home-stat-label">Atrasadas</div>
          ${atrasadoTotal > 0 ? `<div class="home-stat-sub">R$ ${atrasadoTotal.toLocaleString('pt-BR')}</div>` : ''}
        </div>
        <div class="home-stat-box" onclick="switchTab('cobrancas')">
          <div class="home-stat-num" style="color:#D4537E">${todayCharges.length}</div>
          <div class="home-stat-label">Vencem hoje</div>
        </div>
        <div class="home-stat-box" onclick="switchTab('contatos')">
          <div class="home-stat-num" style="color:#1a1a1a">${state.contacts.length}</div>
          <div class="home-stat-label">Clientes</div>
          <div class="home-stat-sub">${clientesAtivas} ativas</div>
        </div>
      </div>

      ${proximas.length > 0 ? `
        <div class="home-section-title">Próximas cobranças</div>
        ${proximas.map(({ sale, parcel, contact, isToday }) => {
          if (!contact) return '';
          const ci = getColorIndex(contact.id);
          return `
            <div class="home-upcoming-item" onclick="switchTab('cobrancas')">
              <div class="avatar" style="width:36px;height:36px;font-size:12px;background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(contact.name)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;color:#1a1a1a">${contact.name.split(' ').slice(0, 2).join(' ')}</div>
                <div style="font-size:12px;color:#aaa">${sale.description}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:15px;font-weight:600;color:#1a1a1a">R$ ${parcel.amount}</div>
                <div style="font-size:11px;color:${isToday ? '#D4537E' : '#aaa'}">${isToday ? 'Hoje' : parcel.dateStr}</div>
              </div>
            </div>`;
        }).join('')}
      ` : ''}

      <div class="home-section-title">Ações rápidas</div>
      <div class="home-actions">
        <div class="home-action-btn" onclick="switchTab('contatos');setTimeout(()=>openModal('addContact'),100)">
          <span>＋</span> Nova cliente
        </div>
        <div class="home-action-btn" onclick="switchTab('cobrancas');setTimeout(()=>openModal('addSale'),100)">
          <span>＋</span> Nova venda
        </div>
      </div>
    </div>`;
}

function renderContatos() {
  const filtered = state.contacts.filter(c =>
    c.name.toLowerCase().includes(state.search.toLowerCase()) ||
    (c.local || '').toLowerCase().includes(state.search.toLowerCase())
  );
  const pendingByContact = {};
  state.sales.forEach(s => {
    const pending = getSaleParcels(s).filter(p => !p.paid).length;
    if (pending) pendingByContact[s.contact_id] = (pendingByContact[s.contact_id] || 0) + pending;
  });

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Contatos</h2><p>${state.contacts.length} clientes cadastradas</p></div>
          <button class="add-btn" onclick="openModal('addContact')">+</button>
        </div>
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" placeholder="Buscar por nome ou local..." value="${state.search}" oninput="updateSearch(this.value)">
        </div>
      </div>
      <div class="section-label">Todas as clientes</div>
    </div>
    <div class="screen-scroll-list">
      ${filtered.length === 0 ? `<div class="empty-state">Nenhuma cliente encontrada.<br>Toque em + para adicionar.</div>` : ''}
      ${filtered.map(c => {
        const ci = getColorIndex(c.id);
        const pending = pendingByContact[c.id] || 0;
        return `
          <div class="contact-item" onclick="openDetail('${c.id}')">
            <div class="avatar" style="background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(c.name)}</div>
            <div class="contact-info">
              <div class="contact-name">${c.name}</div>
              <div class="contact-sub">${c.local || ''}</div>
            </div>
            ${pending ? `<span class="badge badge-due">${pending} pend.</span>` : '<span class="badge badge-ok">Em dia</span>'}
            <span class="chevron">›</span>
          </div>`;
      }).join('')}
    </div>`;
}

function renderCobrancas() {
  const allCharges = getDueCharges('mes');
  const lateCharges = allCharges.filter(c => c.isPast);
  const lateCount = lateCharges.length;
  const todayCount = allCharges.filter(c => c.isToday).length;

  const filters = [{ id: 'mes', label: 'Este mês' }, { id: 'atrasado', label: 'Atrasado' }, { id: 'hoje', label: 'Hoje' }];

  let charges;
  if (state.chargeFilter === 'atrasado') charges = lateCharges;
  else if (state.chargeFilter === 'hoje') charges = allCharges.filter(c => c.isToday);
  else charges = allCharges;

  // Group by day
  const diasSemana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const groups = [];
  let currentKey = null;
  let currentGroup = null;

  const sorted = [...charges].sort((a, b) => {
    if (a.isPast && !b.isPast) return -1;
    if (!a.isPast && b.isPast) return 1;
    return a.parcel.date - b.parcel.date;
  });

  sorted.forEach(charge => {
    let key, label, isPastGroup;
    if (charge.isPast) {
      const d = charge.parcel.date;
      key = `late-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const diaSemana = diasSemana[d.getDay()];
      label = `${diaSemana}, ${d.getDate()} — Atrasado`;
      isPastGroup = true;
    } else {
      const d = charge.parcel.date;
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const diaSemana = diasSemana[d.getDay()];
      const diaNum = d.getDate();
      label = charge.isToday ? `Hoje, ${diaSemana.toLowerCase()}, ${diaNum}` : `${diaSemana}, ${diaNum}`;
      isPastGroup = false;
    }
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = { label, isPast: isPastGroup, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(charge);
  });

  // Stats for current filter
  const totalValue = charges.reduce((a, c) => a + c.parcel.remaining, 0);
  const lateInView = charges.filter(c => c.isPast).length;
  const todayInView = charges.filter(c => c.isToday).length;

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Cobranças</h2></div>
          <button class="add-btn" onclick="openModal('addSale')">+</button>
        </div>
      </div>
      <div class="filter-tabs">
        ${filters.map(f => `<button class="filter-tab ${state.chargeFilter === f.id ? 'active' : ''}" onclick="setChargeFilter('${f.id}')">${f.label}</button>`).join('')}
      </div>
      <div class="charge-summary">
        <div class="charge-summary-item"><span class="charge-summary-num">${charges.length}</span><span class="charge-summary-label">cobranças</span></div>
        <div class="charge-summary-item"><span class="charge-summary-num" style="color:#D4537E">${todayInView}</span><span class="charge-summary-label">hoje</span></div>
        <div class="charge-summary-item"><span class="charge-summary-num" style="color:#A32D2D">${lateInView}</span><span class="charge-summary-label">atrasadas</span></div>
        <div class="charge-summary-item"><span class="charge-summary-num" style="color:#993556">R$ ${totalValue.toLocaleString('pt-BR')}</span><span class="charge-summary-label">a receber</span></div>
      </div>
    </div>
    <div class="screen-scroll-list">
      ${charges.length === 0 ? `<div class="empty-state">Nenhuma cobrança para este filtro 🎉</div>` : ''}
      ${groups.map(group => `
        <div class="day-header">
          <span class="day-header-text ${group.isPast ? 'day-header-late' : ''}">${group.label}</span>
          <div class="day-header-line ${group.isPast ? 'day-header-line-late' : ''}"></div>
        </div>
        ${group.items.map(({ sale, parcel, contact, isPast, isToday }) => {
          if (!contact) return '';
          const ci = getColorIndex(contact.id);
          const msg = getWhatsappMsg(contact, parcel, sale);
          const wppUrl = `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
          return `
            <div class="charge-item ${isPast ? 'charge-item-late' : ''}">
              <div class="charge-header">
                <div class="avatar" style="width:38px;height:38px;font-size:13px;background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(contact.name)}</div>
                <span class="charge-name">${contact.name.split(' ').slice(0, 2).join(' ')}</span>
                ${isPast ? '<span class="badge badge-late">Atrasado</span>' : ''}
              </div>
              <div class="charge-body">
                <div>
                  <div class="charge-detail">${sale.description}</div>
                  <div class="charge-detail" style="margin-top:2px">Parc. ${parcel.index + 1}/${sale.parcels}</div>
                </div>
                <div class="charge-amount">R$ ${parcel.remaining}${parcel.paidAmount > 0 ? `<div style="font-size:11px;color:#3B6D11;font-weight:400;margin-top:2px">pago: R$ ${parcel.paidAmount}</div>` : ''}</div>
              </div>
              <div class="charge-actions">
                <button class="btn-cobrar" onclick="openWpp('${wppUrl}')">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                  Cobrar
                </button>
                <button class="btn-pago" onclick="openPaidModal('${sale.id}',${parcel.index})">Registrar pgto</button>
              </div>
            </div>`;
        }).join('')}
      `).join('')}
    </div>`;
}

function renderFinanceiro() {
  const recebido = state.payments.filter(p => p.paid).reduce((acc, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return acc + (sale ? sale.parcel_value : 0);
  }, 0);
  const pendente = state.payments.filter(p => !p.paid).reduce((acc, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return acc + (sale ? sale.parcel_value : 0);
  }, 0);
  const atrasado = getDueCharges('atrasado').reduce((a, c) => a + c.parcel.remaining, 0);
  const upcoming = getDueCharges('mes').slice(0, 8);

  // Monthly projection for "A receber"
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  let monthlyData = [];
  if (state.financeDetail === 'a_receber') {
    const monthMap = {};
    state.sales.forEach(sale => {
      const parcels = getSaleParcels(sale);
      parcels.forEach(p => {
        if (p.paid) return;
        const key = `${p.date.getFullYear()}-${String(p.date.getMonth()).padStart(2, '0')}`;
        const label = `${meses[p.date.getMonth()]} ${p.date.getFullYear()}`;
        if (!monthMap[key]) monthMap[key] = { key, label, total: 0, count: 0 };
        monthMap[key].total += p.amount;
        monthMap[key].count++;
      });
    });
    monthlyData = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));
  }

  const isActive = state.financeDetail === 'a_receber';
  const sectionTitle = isActive ? 'Previsão por mês' : 'Próximas cobranças';

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Financeiro</h2><p>Visão geral</p></div>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Recebido</div><div class="metric-value" style="color:#3B6D11">R$ ${recebido.toLocaleString('pt-BR')}</div><div class="metric-sub">parcelas pagas</div></div>
        <div class="metric-card ${isActive ? 'metric-card-active' : ''}" onclick="toggleFinanceDetail('a_receber')" style="cursor:pointer"><div class="metric-label">A receber ${isActive ? '✕' : '›'}</div><div class="metric-value" style="color:#993556">R$ ${pendente.toLocaleString('pt-BR')}</div><div class="metric-sub">toque para ver meses</div></div>
        <div class="metric-card"><div class="metric-label">Em atraso</div><div class="metric-value" style="color:#A32D2D">R$ ${atrasado.toLocaleString('pt-BR')}</div><div class="metric-sub">${getDueCharges('atrasado').length} cobranças</div></div>
        <div class="metric-card"><div class="metric-label">Clientes</div><div class="metric-value">${state.contacts.length}</div><div class="metric-sub">cadastradas</div></div>
      </div>
      <div class="section-label" style="margin-top:8px">${sectionTitle}</div>
    </div>
    <div class="screen-scroll-list">
      ${isActive ? `
        <div class="upcoming-list">
          ${monthlyData.length === 0 ? '<div class="empty-state" style="padding:20px">Nenhuma parcela pendente.</div>' : ''}
          ${monthlyData.map(m => `
            <div class="upcoming-item">
              <div>
                <div class="upcoming-name">${m.label}</div>
                <div class="upcoming-date">${m.count} parcela${m.count > 1 ? 's' : ''}</div>
              </div>
              <div class="upcoming-val">R$ ${m.total.toLocaleString('pt-BR')}</div>
            </div>`).join('')}
        </div>
      ` : `
        <div class="upcoming-list">
          ${upcoming.length === 0 ? '<div class="empty-state" style="padding:20px">Nenhuma cobrança próxima.</div>' : ''}
          ${upcoming.map(({ sale, parcel, contact }) => {
            if (!contact) return '';
            return `
              <div class="upcoming-item">
                <div>
                  <div class="upcoming-name">${contact.name.split(' ').slice(0, 2).join(' ')}</div>
                  <div class="upcoming-date">${sale.description} · ${parcel.dateStr}</div>
                </div>
                <div class="upcoming-val">R$ ${parcel.remaining}</div>
              </div>`;
          }).join('')}
        </div>
      `}
    </div>`;
}

function renderDetail(contactId) {
  const c = getContact(contactId);
  if (!c) return '';
  const ci = getColorIndex(c.id);
  const cSales = state.sales.filter(s => s.contact_id === contactId);
  const totalPending = cSales.reduce((a, s) => {
    return a + getSaleParcels(s).filter(p => !p.paid).reduce((x, p) => x + p.amount, 0);
  }, 0);

  // ── Client stats ──
  const totalSpent = cSales.reduce((a, s) => a + s.total, 0);
  const totalPaid = state.payments.filter(p => {
    const sale = cSales.find(s => s.id === p.sale_id);
    return sale && p.paid;
  }).reduce((a, p) => {
    const sale = cSales.find(s => s.id === p.sale_id);
    return a + (p.paid_amount || sale?.parcel_value || 0);
  }, 0);
  const pendingParcels = state.payments.filter(p => {
    return cSales.some(s => s.id === p.sale_id) && !p.paid;
  }).length;
  const clientSince = c.created_at ? new Date(c.created_at) : null;
  const now = new Date();
  let tempoCliente = '';
  if (clientSince) {
    const diffMs = now - clientSince;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 30) tempoCliente = `${diffDays} dia${diffDays !== 1 ? 's' : ''}`;
    else {
      const diffMonths = Math.floor(diffDays / 30);
      tempoCliente = `${diffMonths} ${diffMonths === 1 ? 'mês' : 'meses'}`;
    }
  }
  const firstSaleDate = cSales.length > 0 ? cSales.reduce((min, s) => {
    const d = new Date(s.created_at);
    return d < min ? d : min;
  }, new Date()) : null;
  let mediaMensal = 0;
  if (firstSaleDate && cSales.length > 0) {
    const months = Math.max(1, Math.ceil((now - firstSaleDate) / (30 * 86400000)));
    mediaMensal = Math.round(totalSpent / months);
  }

  return `
    <div class="detail-overlay">
      <div class="detail-header">
        <button class="back-btn" onclick="closeDetail()">‹</button>
        <div class="detail-avatar" style="background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(c.name)}</div>
        <div>
          <div style="font-size:17px;font-weight:600;color:#1a1a1a">${c.name}</div>
          <div style="font-size:13px;color:#888">${c.local || ''}</div>
        </div>
      </div>
      <div class="detail-section">
        <h3>Informações</h3>
        <div class="info-row"><span class="info-label">WhatsApp</span><span class="info-value" style="color:#25D366">+${c.phone}</span></div>
        <div class="info-row"><span class="info-label">Local</span><span class="info-value">${c.local || '—'}</span></div>
        <div class="info-row"><span class="info-label">Cliente desde</span><span class="info-value">${clientSince ? clientSince.toLocaleDateString('pt-BR') : '—'}</span></div>
        <div class="info-row"><span class="info-label">A receber</span><span class="info-value" style="color:${totalPending > 0 ? '#993556' : '#3B6D11'}">R$ ${totalPending.toLocaleString('pt-BR')}</span></div>
        <button onclick="openModal('editContact','${c.id}')" style="width:100%;padding:10px;background:none;border:1px solid #e0e0e0;border-radius:10px;color:#666;font-size:14px;cursor:pointer;margin-top:12px">✏️ Editar dados</button>
      </div>
      <div class="detail-section">
        <h3>Resumo da cliente</h3>
        <div class="client-stats">
          <div class="client-stat"><div class="client-stat-value">R$ ${totalSpent.toLocaleString('pt-BR')}</div><div class="client-stat-label">total comprado</div></div>
          <div class="client-stat"><div class="client-stat-value">R$ ${totalPaid.toLocaleString('pt-BR')}</div><div class="client-stat-label">total pago</div></div>
          <div class="client-stat"><div class="client-stat-value">R$ ${mediaMensal.toLocaleString('pt-BR')}</div><div class="client-stat-label">média/mês</div></div>
          <div class="client-stat"><div class="client-stat-value">${pendingParcels}</div><div class="client-stat-label">parcelas pendentes</div></div>
          <div class="client-stat"><div class="client-stat-value">${cSales.length}</div><div class="client-stat-label">vendas</div></div>
          <div class="client-stat"><div class="client-stat-value">${tempoCliente || '—'}</div><div class="client-stat-label">como cliente</div></div>
        </div>
      </div>
      <div class="detail-section">
        <h3>Vendas e parcelas</h3>
        ${cSales.length === 0 ? '<div style="color:#aaa;font-size:14px;padding:8px 0">Nenhuma venda registrada.</div>' : ''}
        ${cSales.map(s => {
          const parcels = getSaleParcels(s);
          return `
            <div class="sale-item">
              <div class="sale-desc">${s.description}</div>
              <div class="sale-meta">Total: R$ ${s.total} · ${s.parcels}x R$ ${s.parcel_value} · ${s.payment_method === 'pix' ? 'Pix' : 'Cartão'}</div>
              <div style="margin-top:10px">
                ${parcels.map(p => `
                  <div class="parcel-row">
                    <span class="parcel-num">Parc. ${p.index + 1}</span>
                    <span class="parcel-date">${p.dateStr}</span>
                    <div class="parcel-status">
                      <span class="badge ${p.paid ? 'badge-ok' : 'badge-due'}">${p.paid ? 'Pago' : 'Pendente'}</span>
                      ${!p.paid ? `<button style="background:none;border:none;cursor:pointer;font-size:12px;color:#D4537E;padding:0" onclick="openPaidModal('${s.id}',${p.index})">Registrar</button>` : ''}
                    </div>
                  </div>`).join('')}
              </div>
            </div>`;
        }).join('')}
        <button onclick="openModal('addSale','${contactId}')" style="width:100%;padding:12px;background:none;border:1px solid #D4537E;border-radius:10px;color:#D4537E;font-size:14px;cursor:pointer;margin-top:4px">+ Nova venda</button>
      </div>
      <button class="btn-delete-contact" onclick="openDeleteContactModal('${c.id}')">Excluir cliente</button>
    </div>`;
}

// ---------- MODALS ----------

function renderModal() {
  if (state.chargeModal) {
    const { sale, parcel, contact } = state.chargeModal;
    const msg = getWhatsappMsg(contact, parcel, sale);
    const wppUrl = `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Cobrar via WhatsApp</div>
        <div class="modal-subtitle">Mensagem para ${contact.name.split(' ')[0]}:</div>
        <div class="wpp-msg">${msg.replace(/\n/g, '<br>')}</div>
        <button class="btn-primary" onclick="openWpp('${wppUrl}')">💬 Abrir WhatsApp</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.paidModal) {
    const { saleId, parcelIndex } = state.paidModal;
    const sale = state.sales.find(s => s.id === saleId);
    const payment = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
    const paidSoFar = payment?.paid_amount || 0;
    const remaining = (sale?.parcel_value || 0) - paidSoFar;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Registrar pagamento</div>
        <div class="modal-subtitle">Parcela ${parcelIndex + 1}/${sale?.parcels} · R$ ${sale?.parcel_value}${paidSoFar > 0 ? `<br><span style="color:#3B6D11">Já pago: R$ ${paidSoFar.toLocaleString('pt-BR')}</span> · <span style="color:#993556">Restante: R$ ${remaining.toLocaleString('pt-BR')}</span>` : ''}</div>
        <button class="btn-primary" onclick="markPaid('${saleId}',${parcelIndex})">Pagar valor total — R$ ${remaining.toLocaleString('pt-BR')}</button>
        <div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px"><div style="flex:1;height:1px;background:#e8e8e8"></div><span style="font-size:12px;color:#aaa">ou valor parcial</span><div style="flex:1;height:1px;background:#e8e8e8"></div></div>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="partial-amount" type="number" placeholder="Ex: 80" style="flex:1" inputmode="decimal" />
          <button class="btn-primary" style="width:auto;padding:13px 20px;margin-top:0" onclick="markPartialPaid('${saleId}',${parcelIndex})">Pagar</button>
        </div>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.deleteContactModal) {
    const c = getContact(state.deleteContactModal);
    const salesCount = state.sales.filter(s => s.contact_id === state.deleteContactModal).length;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Excluir cliente</div>
        <div class="modal-subtitle">
          Tem certeza que quer excluir <strong>${c?.name}</strong>?
          ${salesCount > 0 ? `<br><br>⚠️ Isso também vai excluir ${salesCount} venda(s) e todas as parcelas. Não pode ser desfeito.` : '<br><br>Esta ação não pode ser desfeita.'}
        </div>
        <button class="btn-danger" onclick="confirmDeleteContact()">Excluir permanentemente</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'addContact') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Nova cliente</div>
        <div class="form-group"><label class="form-label">Nome completo</label><input class="form-input" id="nc-name" placeholder="Ex: Renata Lima" /></div>
        <div class="form-group"><label class="form-label">Local</label><input class="form-input" id="nc-local" placeholder="Ex: Posto de Saúde 1" /></div>
        <div class="form-group"><label class="form-label">WhatsApp (com DDD)</label><input class="form-input" id="nc-phone" type="tel" placeholder="43 99999-0000" /></div>
        <button class="btn-primary" onclick="addContact()">Cadastrar cliente</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'editContact') {
    const c = getContact(state.modalExtra);
    if (!c) return '';
    const phoneDisplay = c.phone.startsWith('55') ? c.phone.slice(2) : c.phone;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Editar cliente</div>
        <div class="form-group"><label class="form-label">Nome completo</label><input class="form-input" id="ec-name" value="${c.name}" /></div>
        <div class="form-group"><label class="form-label">Local</label><input class="form-input" id="ec-local" value="${c.local || ''}" /></div>
        <div class="form-group"><label class="form-label">WhatsApp (com DDD)</label><input class="form-input" id="ec-phone" type="tel" value="${phoneDisplay}" /></div>
        <button class="btn-primary" onclick="editContact('${c.id}')">Salvar alterações</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'addSale') {
    const contactId = state.modalExtra;
    const contactOptions = state.contacts.map(c =>
      `<option value="${c.id}" ${c.id === contactId ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Nova venda</div>
        <div class="form-group"><label class="form-label">Cliente</label>
          <select class="form-input" id="ns-contact">${contactOptions}</select>
        </div>
        <div class="form-group"><label class="form-label">Descrição da joia</label><input class="form-input" id="ns-desc" placeholder="Ex: Anel Dourado Cristal" /></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Total (R$)</label><input class="form-input" id="ns-total" type="number" placeholder="300" /></div>
          <div class="form-group"><label class="form-label">Parcelas</label><input class="form-input" id="ns-parcels" type="number" placeholder="3" min="1" max="24" /></div>
        </div>
        <div class="form-group"><label class="form-label">Dia de cobrança</label><input class="form-input" id="ns-day" type="number" placeholder="28" min="1" max="31" /></div>
        <button class="btn-primary" onclick="addSale()">Registrar venda</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  return '';
}

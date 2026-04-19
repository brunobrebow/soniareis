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
  tab: 'contatos',
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
  const paidIndexes = state.payments
    .filter(p => p.sale_id === sale.id && p.paid)
    .map(p => p.parcel_index);

  return Array.from({ length: sale.parcels }, (_, i) => {
    const d = new Date(y, m - paidIndexes.length + i, sale.start_day);
    return {
      index: i,
      date: d,
      dateStr: d.toLocaleDateString('pt-BR'),
      paid: paidIndexes.includes(i),
      amount: sale.parcel_value
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
  try {
    await DB.markPaid(saleId, parcelIndex);
    const p = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
    if (p) { p.paid = true; p.paid_at = new Date().toISOString(); }
    state.paidModal = null;
    showToast('Parcela marcada como paga!');
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
  if (state.tab === 'contatos') html = renderContatos();
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
    { id: 'contatos', icon: '👥', label: 'Contatos' },
    { id: 'cobrancas', icon: '💰', label: 'Cobranças' },
    { id: 'financeiro', icon: '📊', label: 'Financeiro' }
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
        <span class="nav-icon">${t.icon}</span>
        <span class="nav-label">${t.label}</span>
      </div>`).join('');
    }
  }

}

// ---------- SCREENS ----------

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
  const upcomingCharges = allCharges.filter(c => !c.isPast);
  const lateCount = lateCharges.length;
  const todayCount = allCharges.filter(c => c.isToday).length;

  const filters = [{ id: 'mes', label: 'Este mês' }, { id: 'atrasado', label: 'Atrasado' }, { id: 'hoje', label: 'Hoje' }];

  // Determine which charges to show based on filter
  let charges;
  if (state.chargeFilter === 'atrasado') charges = lateCharges;
  else if (state.chargeFilter === 'hoje') charges = allCharges.filter(c => c.isToday);
  else charges = allCharges;

  // Group by day
  const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const groups = [];
  let currentKey = null;
  let currentGroup = null;

  // For "mes" filter: show atrasados first, then by day
  const sorted = [...charges].sort((a, b) => {
    if (a.isPast && !b.isPast) return -1;
    if (!a.isPast && b.isPast) return 1;
    return a.parcel.date - b.parcel.date;
  });

  sorted.forEach(charge => {
    let key, label;
    if (charge.isPast) {
      key = 'atrasado';
      label = '⚠️ Atrasado';
    } else {
      const d = charge.parcel.date;
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const diaSemana = diasSemana[d.getDay()];
      const diaNum = d.getDate();
      if (charge.isToday) {
        label = `Hoje, ${diaNum}`;
      } else {
        label = `${diaSemana} ${diaNum}`;
      }
    }
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = { label, isPast: charge.isPast, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(charge);
  });

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Cobranças</h2><p>${todayCount} vencem hoje · ${lateCount} em atraso</p></div>
          <button class="add-btn" onclick="openModal('addSale')">+</button>
        </div>
      </div>
      <div class="filter-tabs">
        ${filters.map(f => `<button class="filter-tab ${state.chargeFilter === f.id ? 'active' : ''}" onclick="setChargeFilter('${f.id}')">${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="screen-scroll-list">
      ${charges.length === 0 ? `<div class="empty-state">Nenhuma cobrança para este filtro 🎉</div>` : ''}
      ${groups.map(group => `
        <div class="section-label" style="padding-top:14px;${group.isPast ? 'color:#A32D2D' : ''}">${group.label}</div>
        ${group.items.map(({ sale, parcel, contact, isPast, isToday }) => {
          if (!contact) return '';
          const ci = getColorIndex(contact.id);
          const msg = getWhatsappMsg(contact, parcel, sale);
          const wppUrl = `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
          return `
            <div class="charge-item">
              <div class="charge-header">
                <div class="avatar" style="width:38px;height:38px;font-size:13px;background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(contact.name)}</div>
                <span class="charge-name">${contact.name.split(' ').slice(0, 2).join(' ')}</span>
                <span class="badge ${isPast ? 'badge-late' : isToday ? 'badge-due' : 'badge-ok'}">${isPast ? 'Atrasado' : isToday ? 'Hoje' : 'Dia ' + parcel.date.getDate()}</span>
              </div>
              <div class="charge-body">
                <div>
                  <div class="charge-detail">${sale.description}</div>
                  <div class="charge-detail" style="margin-top:2px">Parc. ${parcel.index + 1}/${sale.parcels}</div>
                </div>
                <div class="charge-amount">R$ ${parcel.amount}</div>
              </div>
              <div class="charge-actions">
                <button class="btn-cobrar" onclick="openWpp('${wppUrl}')">
                  <span style="font-size:16px">💬</span> Cobrar
                </button>
                <button class="btn-pago" onclick="openPaidModal('${sale.id}',${parcel.index})">Marcar pago</button>
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
  const atrasado = getDueCharges('atrasado').reduce((a, c) => a + c.parcel.amount, 0);
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
                <div class="upcoming-val">R$ ${parcel.amount}</div>
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
        <div class="info-row"><span class="info-label">A receber</span><span class="info-value" style="color:${totalPending > 0 ? '#993556' : '#3B6D11'}">R$ ${totalPending.toLocaleString('pt-BR')}</span></div>
        <button onclick="openModal('editContact','${c.id}')" style="width:100%;padding:10px;background:none;border:1px solid #e0e0e0;border-radius:10px;color:#666;font-size:14px;cursor:pointer;margin-top:12px">✏️ Editar dados</button>
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
                      ${!p.paid ? `<button style="background:none;border:none;cursor:pointer;font-size:12px;color:#D4537E;padding:0" onclick="openPaidModal('${s.id}',${p.index})">✓ pago</button>` : ''}
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
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Confirmar pagamento</div>
        <div class="modal-subtitle">Marcar parcela ${parcelIndex + 1} como paga? (R$ ${sale?.parcel_value})</div>
        <button class="btn-primary" onclick="markPaid('${saleId}',${parcelIndex})">Confirmar pagamento</button>
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

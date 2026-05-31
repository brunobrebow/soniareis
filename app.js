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
  chargeFilter: 'pendente',
  financeDetail: 'recebido',
  financePeriod: 'mes',
  financeCustomMonth: null,
  chargeModal: null,
  paidModal: null,
  deleteContactModal: null,
  loading: true,
  error: null,
  pdvMode: false,
  pdvLocked: false,
  pdvStep: 'cart',
  pdvCart: [],
  pdvResult: null,
  metaMensal: parseFloat(localStorage.getItem('srcrm_meta') || '20000'),
  agendaDate: new Date()
};

// ── DATE MASK ──
function maskDate(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 8);
  if (v.length >= 5) v = v.slice(0,2) + '/' + v.slice(2,4) + '/' + v.slice(4);
  else if (v.length >= 3) v = v.slice(0,2) + '/' + v.slice(2);
  input.value = v;
}
function parseMaskedDate(str) {
  if (!str || str.length < 10) return null;
  const [d, m, y] = str.split('/').map(Number);
  if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  if (date.getDate() !== d || date.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function formatDateToMask(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

// ── CHARGE TRACKING ──
function getCobradas() {
  try { return JSON.parse(localStorage.getItem('srcrm_cobradas') || '{}'); } catch { return {}; }
}
function markCobrada(saleId, parcelIndex, days) {
  const cobradas = getCobradas();
  cobradas[`${saleId}-${parcelIndex}`] = { ts: Date.now(), days: days || 2 };
  localStorage.setItem('srcrm_cobradas', JSON.stringify(cobradas));
}
function isCobrada(saleId, parcelIndex) {
  const cobradas = getCobradas();
  const entry = cobradas[`${saleId}-${parcelIndex}`];
  if (!entry) return false;
  const ts = typeof entry === 'number' ? entry : entry.ts;
  const days = typeof entry === 'number' ? 2 : (entry.days || 2);
  const limit = days * 24 * 60 * 60 * 1000;
  if (Date.now() - ts > limit) {
    delete cobradas[`${saleId}-${parcelIndex}`];
    localStorage.setItem('srcrm_cobradas', JSON.stringify(cobradas));
    return false;
  }
  return true;
}
function markAllCobrada(charges, days) {
  charges.forEach(c => markCobrada(c.sale.id, c.parcel.index, days));
  render();
}
function openWppAndMark(url, saleId, parcelIndex) {
  markCobrada(saleId, parcelIndex, 2);
  window.open(url, '_blank');
  render();
}
function openWppAndMarkAll(url, charges) {
  charges.forEach(c => markCobrada(c.sale.id, c.parcel.index, 2));
  window.open(url, '_blank');
  render();
}

// ── AGENDA STORAGE ──
function getAgendaEvents() {
  try { return JSON.parse(localStorage.getItem('srcrm_agenda') || '[]'); } catch { return []; }
}
function saveAgendaEvent(evt) {
  const events = getAgendaEvents();
  evt.id = Date.now().toString();
  events.push(evt);
  localStorage.setItem('srcrm_agenda', JSON.stringify(events));
  return evt;
}
function deleteAgendaEvent(id) {
  const events = getAgendaEvents().filter(e => e.id !== id);
  localStorage.setItem('srcrm_agenda', JSON.stringify(events));
}
function getAgendaDayEvents(date) {
  const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();
  const events = [];

  // Charges due (only Pix, grouped by contact)
  const chargesByContact = {};
  getDueCharges('mes').forEach(c => {
    if (!c.contact) return;
    if (c.sale.payment_method === 'cartao') return;
    const pd = c.parcel.date;
    if (pd.getDate() === d && pd.getMonth() === m && pd.getFullYear() === y && !c.parcel.paid) {
      const cid = c.contact.id;
      if (!chargesByContact[cid]) chargesByContact[cid] = { contact: c.contact, total: 0, charges: [], allCobrada: true };
      chargesByContact[cid].total += (c.parcel.remaining || c.parcel.amount);
      chargesByContact[cid].charges.push(c);
      if (!isCobrada(c.sale.id, c.parcel.index)) chargesByContact[cid].allCobrada = false;
    }
  });
  Object.values(chargesByContact).forEach(g => {
    events.push({ type: 'cobranca', title: `Cobrar ${g.contact.name.split(' ').slice(0,2).join(' ')}`, sub: `R$ ${Math.round(g.total)} · ${g.charges.length} ${g.charges.length === 1 ? 'parcela' : 'parcelas'}`, color: g.allCobrada ? '#3B6D11' : '#D4537E', done: g.allCobrada, contact: g.contact, charges: g.charges, totalDue: Math.round(g.total) });
  });

  // Birthdays
  state.contacts.forEach(c => {
    if (!c.birthday) return;
    const [by, bm, bd] = c.birthday.split('-').map(Number);
    if (bm === m + 1 && bd === d) {
      const bdayDone = isBdaySent(c.id, y);
      events.push({ type: 'aniversario', title: `🎂 ${c.name}`, sub: `${y - by} anos`, color: bdayDone ? '#3B6D11' : '#E8A317', done: bdayDone, contactId: c.id, phone: c.phone });
    }
  });

  // Manual appointments
  getAgendaEvents().forEach(e => {
    const [ey, em, ed2] = e.date.split('-').map(Number);
    if (ed2 === d && (em - 1) === m && ey === y) {
      events.push({ type: 'compromisso', title: e.title, time: e.time || '', location: e.location || '', id: e.id, color: e.done ? '#3B6D11' : '#5B6ABF', done: e.done || false });
    }
  });

  return events;
}

// Birthday tracking
function isBdaySent(contactId, year) {
  try {
    const sent = JSON.parse(localStorage.getItem('srcrm_bday_sent') || '{}');
    return sent[`${contactId}-${year}`] || false;
  } catch { return false; }
}
function markBdaySent(contactId, year) {
  const sent = JSON.parse(localStorage.getItem('srcrm_bday_sent') || '{}');
  sent[`${contactId}-${year}`] = true;
  localStorage.setItem('srcrm_bday_sent', JSON.stringify(sent));
}
function sendBdayAndMark(contactId, phone) {
  const msg = encodeURIComponent(`Feliz aniversário!! 🎂🎉\nMuitas felicidades, saúde e bençãos pra você! Que esse novo ano seja incrível! 💖`);
  markBdaySent(contactId, new Date().getFullYear());
  window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  render();
}

// Manual event completion
function toggleAgendaDone(eventId) {
  const events = getAgendaEvents();
  const evt = events.find(e => e.id === eventId);
  if (evt) {
    evt.done = !evt.done;
    localStorage.setItem('srcrm_agenda', JSON.stringify(events));
    render();
  }
}

function openAgendaDetail(eventId) {
  state._agendaDetailId = eventId;
  state.modal = 'agendaDetail';
  render();
}

function confirmDeleteAgenda() {
  if (state._agendaDetailId) {
    deleteAgendaEvent(state._agendaDetailId);
    closeModal();
    showToast('Compromisso excluído');
  }
}

function confirmDeleteTransaction(saleIdsStr) {
  state._deleteTransactionIds = saleIdsStr;
  state.modal = 'deleteTransaction';
  render();
}

function openEditTransaction(saleIdsStr) {
  state._editTransactionIds = saleIdsStr;
  state.modal = 'editTransaction';
  render();
}

async function saveEditTransaction() {
  const ids = state._editTransactionIds?.split(',') || [];
  const parcels = parseInt(document.getElementById('et-parcels')?.value) || 1;
  const dayRaw = document.getElementById('et-day')?.value;
  const day = dayRaw === 'aberto' ? 30 : parseInt(dayRaw);
  const method = document.getElementById('et-method')?.value || 'pix';
  const startMonthOffset = parseInt(document.getElementById('et-offset')?.value ?? '1');

  try {
    for (let i = 0; i < ids.length; i++) {
      const sale = state.sales.find(s => s.id === ids[i]);
      if (!sale) continue;
      const desc = document.getElementById('et-desc-' + i)?.value?.trim() || sale.description;
      const total = parseFloat(document.getElementById('et-total-' + i)?.value) || sale.total;
      const parcelValue = Math.floor(total / parcels);

      const updated = await DB.updateSale(ids[i], { description: desc, total, parcels, parcel_value: parcelValue, start_day: day, start_month_offset: startMonthOffset, payment_method: method });
      const idx = state.sales.findIndex(s => s.id === ids[i]);
      if (idx >= 0) state.sales[idx] = updated;
    }
    closeModal();
    showToast('Venda atualizada!');
  } catch (e) {
    showToast('Erro ao salvar.', '#A32D2D');
    console.error(e);
  }
}

async function executeDeleteTransaction() {
  const ids = state._deleteTransactionIds?.split(',');
  if (!ids) return;
  try {
    for (const id of ids) {
      await DB.deleteSale(id);
      state.sales = state.sales.filter(s => s.id !== id);
      state.payments = state.payments.filter(p => p.sale_id !== id);
    }
    closeModal();
    showToast('Venda excluída!');
  } catch (e) {
    showToast('Erro ao excluir.', '#A32D2D');
    console.error(e);
  }
}

function openFullPayment(contactId) {
  const contact = getContact(contactId);
  if (!contact) return;
  const cSales = state.sales.filter(s => s.contact_id === contactId);
  let totalPending = 0;
  const pendingParcels = [];
  // Get ALL pending parcels sorted by date (FIFO)
  cSales.forEach(s => {
    getSaleParcels(s).forEach(p => {
      if (!p.paid) {
        const rem = Math.round(p.remaining || p.amount);
        totalPending += rem;
        pendingParcels.push({ saleId: s.id, parcelIndex: p.index, remaining: rem, date: p.date });
      }
    });
  });
  pendingParcels.sort((a, b) => a.date - b.date);
  if (totalPending <= 0) { showToast('Nenhuma parcela pendente!', '#3B6D11'); return; }
  state._fullPayment = { contactId, contactName: contact.name, totalPending, pendingParcels };
  state.modal = 'fullPayment';
  render();
}

async function confirmFullPayment() {
  const val = parseFloat(document.getElementById('full-pay-amount')?.value) || 0;
  if (val <= 0) { showToast('Insira um valor válido', '#A32D2D'); return; }
  const fp = state._fullPayment;
  if (!fp) return;

  const amount = Math.min(Math.round(val), fp.totalPending);
  const payTimestamp = new Date().toISOString();
  let leftover = amount;

  try {
    // FIFO: pay oldest parcels first
    for (const p of fp.pendingParcels) {
      if (leftover <= 0) break;
      const payment = state.payments.find(pm => pm.sale_id === p.saleId && pm.parcel_index === p.parcelIndex);
      const sale = state.sales.find(s => s.id === p.saleId);
      if (!payment || !sale) continue;

      const pAmt = getParcelAmount(sale, p.parcelIndex);
      const parcelRemaining = Math.round(pAmt - (payment.paid_amount || 0));
      const payAmount = Math.min(leftover, parcelRemaining);
      if (payAmount <= 0) continue;
      leftover -= payAmount;

      const totalPaid = Math.round((payment.paid_amount || 0) + payAmount);
      const isFullParcel = totalPaid >= pAmt;

      await DB.markPaid(p.saleId, p.parcelIndex, totalPaid, isFullParcel);
      payment.paid_amount = totalPaid;
      if (isFullParcel) payment.paid = true;
      payment.paid_at = payTimestamp;
    }

    state.modal = null;
    showToast(`R$ ${amount.toLocaleString('pt-BR')} registrado!`);
    render();
  } catch (e) {
    showToast('Erro ao registrar.', '#A32D2D');
    console.error(e);
  }
}

function getGroupChargeUrl(contact, charges) {
  const total = charges.reduce((a, c) => a + (c.parcel.remaining || c.parcel.amount), 0);
  let msg = `Oiiii😍\nTudo bem?\nEstou enviando o valor do seu pix de hoje!\n\nValor a pagar hoje: R$ ${total}\nVencimento todo dia: ${charges[0]?.sale.start_day || ''}\n\nNome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\nObrigada! 💖`;
  return `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
}

function cobrarGrupo(contactId) {
  const allDueCharges = getDueCharges('mes');
  const contactCharges = allDueCharges.filter(c => c.contact?.id === contactId && (c.isPast || c.isToday) && !isCobrada(c.sale.id, c.parcel.index));
  if (contactCharges.length === 0) return;
  const contact = contactCharges[0].contact;
  const url = getGroupChargeUrl(contact, contactCharges);
  contactCharges.forEach(c => markCobrada(c.sale.id, c.parcel.index, 2));
  window.open(url, '_blank');
  render();
}

function cobrarGrupoRealizada(contactId) {
  const allDueCharges = getDueCharges('mes');
  const contactCharges = allDueCharges.filter(c => c.contact?.id === contactId && (c.isPast || c.isToday) && isCobrada(c.sale.id, c.parcel.index));
  if (contactCharges.length === 0) return;
  const contact = contactCharges[0].contact;
  const url = getGroupChargeUrl(contact, contactCharges);
  contactCharges.forEach(c => markCobrada(c.sale.id, c.parcel.index, 2));
  window.open(url, '_blank');
}

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

function getParcelAmount(sale, parcelIndex) {
  return (parcelIndex === sale.parcels - 1) ? sale.total - sale.parcel_value * (sale.parcels - 1) : sale.parcel_value;
}

function getSaleParcels(sale) {
  const paymentsByIndex = {};
  state.payments
    .filter(p => p.sale_id === sale.id)
    .forEach(p => { paymentsByIndex[p.parcel_index] = p; });

  // First parcel month based on offset (0 = same month, 1 = next month)
  const created = new Date(sale.created_at);
  const offset = sale.start_month_offset !== undefined && sale.start_month_offset !== null ? sale.start_month_offset : 1;
  const startMonth = created.getMonth() + offset;
  const startYear = created.getFullYear();

  return Array.from({ length: sale.parcels }, (_, i) => {
    // Calculate target month/year
    let targetMonth = startMonth + i;
    let targetYear = startYear;
    while (targetMonth > 11) { targetMonth -= 12; targetYear++; }

    // Handle day edge case (e.g. day 31 in a month with 30 days)
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const day = Math.min(sale.start_day, daysInMonth);
    const d = new Date(targetYear, targetMonth, day);

    const payment = paymentsByIndex[i];
    const paidAmount = payment?.paid_amount || 0;
    const parcelAmount = (i === sale.parcels - 1) ? sale.total - sale.parcel_value * (sale.parcels - 1) : sale.parcel_value;
    const remaining = Math.round(parcelAmount - paidAmount);
    return {
      index: i,
      date: d,
      dateStr: d.toLocaleDateString('pt-BR'),
      paid: payment?.paid || false,
      amount: parcelAmount,
      paidAmount,
      paidAt: payment?.paid_at || null,
      remaining
    };
  });
}

function getDueCharges(filter) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const m = today.getMonth();
  const y = today.getFullYear();
  const result = [];

  state.sales.forEach(sale => {
    const parcels = getSaleParcels(sale);
    parcels.forEach(p => {
      if (p.paid) return;
      const pDateStart = new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate());
      const isToday = pDateStart.getTime() === todayStart.getTime();
      const isPast = pDateStart < todayStart;
      const isThisMonth = p.date.getMonth() === m && p.date.getFullYear() === y;
      const isUpcoming = pDateStart > todayStart && isThisMonth;
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
  const remaining = parcel.remaining || parcel.amount;
  const allParcels = getSaleParcels(sale);
  const pendingCount = allParcels.filter(p => !p.paid).length;
  const isAberto = sale.parcels === 1 && allParcels.length === 1;
  const totalPending = allParcels.filter(p => !p.paid).reduce((a, p) => a + (p.remaining || p.amount), 0);

  let msg = `Oiiii😍\nTudo bem?\n`;
  if (isAberto) {
    msg += `Estou enviando o seu total em aberto para o pix de hoje!\n\n`;
    msg += `Valor a pagar hoje: R$ ${totalPending}\n`;
  } else {
    msg += `Estou enviando o valor do seu pix de hoje!\n\n`;
    msg += `Valor a pagar hoje: R$ ${remaining}\n`;
  }
  msg += `Vencimento todo dia: ${sale.start_day}\n\n`;
  msg += `Nome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\n`;
  msg += `Obrigada! 💖`;
  return msg;
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
  const birthday = parseMaskedDate(document.getElementById('nc-birthday')?.value) || null;
  const cpf = document.getElementById('nc-cpf')?.value?.replace(/\D/g, '') || null;
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const newContact = await DB.addContact({ name, local: local || '', phone: '55' + phone, birthday, cpf });
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
  const birthday = parseMaskedDate(document.getElementById('ec-birthday')?.value) || null;
  const cpf = document.getElementById('ec-cpf')?.value?.replace(/\D/g, '') || null;
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const updated = await DB.updateContact(id, { name, local: local || '', phone: '55' + phone, birthday, cpf });
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
      parcel_value: Math.floor(total / parcels),
      start_day: day,
      start_month_offset: 1,
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
  const pAmt = getParcelAmount(sale, parcelIndex);
  const remaining = Math.round(pAmt - (payment.paid_amount || 0));
  try {
    const totalPaid = Math.round((payment.paid_amount || 0) + remaining);
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
  const pAmt = getParcelAmount(sale, parcelIndex);
  const remaining = Math.round(pAmt - (payment.paid_amount || 0));
  const amount = Math.min(val, remaining);
  const totalPaid = Math.round((payment.paid_amount || 0) + amount);
  const isFullPayment = totalPaid >= pAmt;
  try {
    await DB.markPaid(saleId, parcelIndex, totalPaid, isFullPayment);
    payment.paid_amount = totalPaid;
    if (isFullPayment) {
      payment.paid = true;
    }
    payment.paid_at = new Date().toISOString();
    state.paidModal = null;
    showToast(`R$ ${amount.toLocaleString('pt-BR')} registrado!`);

    if (!isFullPayment) {
      const newRemaining = Math.round(pAmt - totalPaid);
      state._reminderSaleId = saleId;
      state._reminderParcelIndex = parcelIndex;
      state._reminderRemaining = newRemaining;
      state.modal = 'reminderDays';
    }

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

// ---------- PDV MODE ----------

const JOIA_PRODUCTS = [
  { name: 'Anel', prices: [50] },
  { name: 'Bracelete', prices: [90] },
  { name: 'Brinco', prices: [30, 50] },
  { name: 'Corrente', prices: [100, 120] },
  { name: 'Pulseira', prices: [60, 80] },
  { name: 'Relógio', prices: [150] },
];

function enterPDV() {
  state.pdvMode = true;
  state.pdvLocked = false;
  state.pdvStep = 'choose';
  state.pdvCart = [];
  state.pdvResult = null;
  state.modal = null;
  state._pdvCatChoice = null;
  state._pdvSelectedContact = null;
  state._pdvTotalDiscount = 0;
  document.querySelector('meta[name="theme-color"]').content = '#111111';
  render();
}

function exitPDV() {
  if (state.pdvLocked) return;
  state.pdvMode = false;
  state.pdvLocked = false;
  document.querySelector('meta[name="theme-color"]').content = '#D4537E';
  render();
}

function togglePDVLock() {
  state.pdvLocked = !state.pdvLocked;
  render();
}

function pdvChooseCategory(cat) {
  state._pdvCatChoice = cat;
  if (cat === 'joia') {
    state.pdvStep = 'joia_select';
  } else {
    state.pdvStep = 'mk_input';
  }
  render();
}

function pdvAddJoia(name, price) {
  state.pdvCart.push({ description: name, category: 'joia', value: price, qty: 1, priceEditable: false });
  state.pdvStep = 'choose';
  state._pdvCatChoice = null;
  render();
}

function pdvAddJoiaWithPrice(name, prices) {
  if (prices.length === 1) {
    pdvAddJoia(name, prices[0]);
  } else {
    state._pdvJoiaName = name;
    state._pdvJoiaPrices = prices;
    state.pdvStep = 'joia_price';
    render();
  }
}

function pdvConfirmJoiaPrice(price) {
  pdvAddJoia(state._pdvJoiaName, price);
}

function pdvAddMaryKay() {
  const name = document.getElementById('pdv-mk-name')?.value?.trim();
  if (!name) { showToast('Digite o nome do produto', '#A32D2D'); return; }
  state.pdvCart.push({ description: name, category: 'marykay', value: 0, qty: 1, priceEditable: true });
  state.pdvStep = 'choose';
  state._pdvCatChoice = null;
  render();
}

function pdvRemoveItem(i) {
  state.pdvCart.splice(i, 1);
  render();
}

function pdvUpdateQty(i, delta) {
  state.pdvCart[i].qty = Math.max(1, (state.pdvCart[i].qty || 1) + delta);
  render();
}

function pdvGoDetails() {
  if (state.pdvCart.length === 0) { showToast('Adicione pelo menos um produto', '#A32D2D'); return; }
  state.pdvStep = 'details';
  render();
}

function pdvDetailsBack() {
  state.pdvStep = 'choose';
  render();
}

function pdvCartTotal() {
  return state.pdvCart.reduce((a, item) => {
    const itemTotal = item.value * (item.qty || 1);
    const disc = (item.discount || 0) * (item.qty || 1);
    return a + Math.max(0, itemTotal - disc);
  }, 0);
}

function pdvOpenDiscount(i) {
  // Save current values first
  for (let j = 0; j < state.pdvCart.length; j++) {
    const valInput = document.getElementById('pdv-val-' + j);
    if (valInput) state.pdvCart[j].value = parseFloat(valInput.value) || 0;
  }
  state._pdvDiscountIdx = i;
  state.modal = 'pdvDiscount';
  render();
}

function pdvApplyDiscount() {
  const i = state._pdvDiscountIdx;
  const val = parseFloat(document.getElementById('pdv-disc-amount')?.value) || 0;
  if (val <= 0) { showToast('Insira o valor do desconto', '#A32D2D'); return; }
  state.pdvCart[i].discount = val;
  state.modal = null;
  render();
}

function pdvGoPayment() {
  // Read edited values
  for (let i = 0; i < state.pdvCart.length; i++) {
    const valInput = document.getElementById('pdv-val-' + i);
    if (valInput) {
      state.pdvCart[i].value = parseFloat(valInput.value) || 0;
    }
    if (state.pdvCart[i].value <= 0) {
      showToast(`Insira o valor do item ${i + 1}`, '#A32D2D'); return;
    }
  }
  state.pdvStep = 'payment';
  render();
}

function pdvPaymentBack() {
  state.pdvStep = 'details';
  render();
}

async function pdvAddContact() {
  const name = document.getElementById('pdv-nc-name')?.value?.trim();
  const local = document.getElementById('pdv-nc-local')?.value?.trim();
  const phone = document.getElementById('pdv-nc-phone')?.value?.replace(/\D/g, '');
  const birthday = parseMaskedDate(document.getElementById('pdv-nc-birthday')?.value) || null;
  const cpf = document.getElementById('pdv-nc-cpf')?.value?.replace(/\D/g, '') || null;
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const nc = await DB.addContact({ name, local: local || '', phone: '55' + phone, birthday, cpf });
    state.contacts.push(nc);
    state.contacts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    state.modal = null;
    showToast('Cliente cadastrada!');
    render();
  } catch (e) { showToast('Erro ao salvar.', '#A32D2D'); }
}

function pdvUpdateDiscountSummary() {
  const disc = parseFloat(document.getElementById('pdv-total-discount')?.value) || 0;
  const afterItemDisc = pdvCartTotal();
  const el = document.getElementById('pdv-disc-summary');
  if (!el) return;
  if (disc > 0) {
    const finalTotal = Math.max(0, afterItemDisc - disc);
    el.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:14px;color:#3B6D11;margin-top:6px"><span>Desc. venda</span><span>- R$ ${disc.toLocaleString('pt-BR')}</span></div><div style="display:flex;justify-content:space-between;font-size:20px;font-weight:700;color:#fff;margin-top:6px;padding-top:6px;border-top:1px solid #333"><span>Total final</span><span>R$ ${finalTotal.toLocaleString('pt-BR')}</span></div>`;
  } else {
    el.innerHTML = '';
  }
}

function pdvUpdatePhone() {
  const sel = document.getElementById('pdv-contact');
  const display = document.getElementById('pdv-phone-display');
  if (sel && display) {
    const c = state.contacts.find(c => c.id === sel.value);
    display.textContent = c ? '+' + c.phone : '';
  }
}

function pdvFilterContacts() {
  const query = (document.getElementById('pdv-contact-search')?.value || '').toLowerCase();
  const sel = document.getElementById('pdv-contact');
  if (!sel) return;
  const currentVal = sel.value;
  const filtered = state.contacts.filter(c =>
    c.name.toLowerCase().includes(query) || (c.local || '').toLowerCase().includes(query)
  );
  sel.innerHTML = `<option value="" disabled>Selecione a cliente</option>` +
    filtered.map(c => `<option value="${c.id}" ${c.id === currentVal ? 'selected' : ''}>${c.name}${c.local ? ' (' + c.local + ')' : ''}</option>`).join('');
  if (filtered.length === 1) {
    sel.value = filtered[0].id;
    state._pdvSelectedContact = filtered[0].id;
    pdvUpdatePhone();
  }
}

function pdvOpenEditContact() {
  const sel = document.getElementById('pdv-contact');
  if (sel && sel.value) state._pdvEditId = sel.value;
  else if (state._pdvSelectedContact) state._pdvEditId = state._pdvSelectedContact;
  state.modal = 'pdvEditContact';
  render();
}

async function pdvSaveEditContact() {
  const id = state._pdvEditId;
  const name = document.getElementById('pdv-ec-name')?.value?.trim();
  const local = document.getElementById('pdv-ec-local')?.value?.trim();
  const phone = document.getElementById('pdv-ec-phone')?.value?.replace(/\D/g, '');
  const birthday = parseMaskedDate(document.getElementById('pdv-ec-birthday')?.value) || null;
  const cpf = document.getElementById('pdv-ec-cpf')?.value?.replace(/\D/g, '') || null;
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const updated = await DB.updateContact(id, { name, local: local || '', phone: '55' + phone, birthday, cpf });
    const idx = state.contacts.findIndex(c => c.id === id);
    if (idx >= 0) state.contacts[idx] = updated;
    state.contacts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    state.modal = null;
    showToast('Contato atualizado!');
    render();
  } catch (e) { showToast('Erro ao atualizar.', '#A32D2D'); }
}

function pdvGoReview() {
  const contactId = document.getElementById('pdv-contact')?.value;
  const parcelsRaw = document.getElementById('pdv-parcels')?.value;
  const dayRaw = document.getElementById('pdv-day')?.value;
  const isDayAberto = dayRaw === 'aberto';
  const day = isDayAberto ? 30 : parseInt(dayRaw);
  const startMonthOffset = parseInt(document.querySelector('input[name="pdv-startmonth"]:checked')?.value || '1');
  const method = document.querySelector('input[name="pdv-method"]:checked')?.value || 'pix';
  const totalDiscount = parseFloat(document.getElementById('pdv-total-discount')?.value) || 0;
  if (!contactId) { showToast('Selecione a cliente', '#A32D2D'); return; }
  if (!parcelsRaw) { showToast('Selecione o número de parcelas', '#A32D2D'); return; }
  if (!dayRaw) { showToast('Selecione o dia de cobrança', '#A32D2D'); return; }

  state._pdvReview = { contactId, parcelsRaw, day, isDayAberto, startMonthOffset, method, totalDiscount };
  state.pdvStep = 'review';
  render();
}

async function pdvSubmit() {
  const { contactId, parcelsRaw, day, startMonthOffset, method, totalDiscount } = state._pdvReview;
  const isAberto = parcelsRaw === 'aberto';
  const parcels = isAberto ? 1 : parseInt(parcelsRaw);

  const contact = getContact(contactId);
  const items = [];
  // Calculate with per-item discounts already applied
  const subtotalAfterItemDiscounts = pdvCartTotal();
  const total = Math.max(0, subtotalAfterItemDiscounts - totalDiscount);
  const subtotalBeforeDiscounts = state.pdvCart.reduce((a, item) => a + item.value * (item.qty || 1), 0);

  try {
    for (const item of state.pdvCart) {
      const itemGross = item.value * (item.qty || 1);
      const itemPerDiscount = (item.discount || 0) * (item.qty || 1);
      const itemAfterPerDiscount = Math.max(0, itemGross - itemPerDiscount);
      // Apply total discount proportionally
      const itemTotalDiscount = subtotalAfterItemDiscounts > 0 ? Math.round(totalDiscount * (itemAfterPerDiscount / subtotalAfterItemDiscounts)) : 0;
      const itemFinal = Math.max(0, itemAfterPerDiscount - itemTotalDiscount);
      const descWithQty = (item.qty || 1) > 1 ? `${item.qty}x ${item.description}` : item.description;
      const newSale = await DB.addSale({
        contact_id: contactId,
        description: descWithQty,
        total: itemFinal,
        parcels,
        parcel_value: Math.floor(itemFinal / parcels),
        start_day: day,
        start_month_offset: startMonthOffset,
        payment_method: method,
        category: item.category
      });
      state.sales.push(newSale);
      const newPayments = await DB.initPayments(newSale.id, parcels);
      state.payments.push(...newPayments);
      items.push({ ...item, total: itemFinal, originalTotal: itemGross, itemDiscount: itemPerDiscount, parcel_value: Math.floor(itemFinal / parcels) });
    }

    state.pdvResult = { items, contact, parcels, day, method, total, discount: totalDiscount, isAberto, isDayAberto: state._pdvReview?.isDayAberto || false };
    state.pdvStep = 'success';
    render();
  } catch (e) {
    showToast('Erro ao salvar.', '#A32D2D');
    console.error(e);
  }
}

function pdvShareWhatsApp() {
  const r = state.pdvResult;
  if (!r) return;
  const parcelVal = Math.round(r.total / r.parcels * 100) / 100;
  const rawSub = r.items.reduce((a, i) => a + i.value * (i.qty || 1), 0);
  const itemDiscTotal = r.items.reduce((a, i) => a + (i.itemDiscount || 0), 0);
  const hasDiscount = itemDiscTotal > 0 || r.discount > 0;
  let msg = `*Resumo da sua compra de hoje*\n\n`;
  r.items.forEach(item => {
    const itemGross = item.value * (item.qty || 1);
    msg += `• ${item.qty > 1 ? item.qty + 'x ' : ''}${item.description} (${item.category === 'joia' ? 'Jóia' : 'Mary Kay'}) — R$ ${itemGross.toLocaleString('pt-BR')}\n`;
    if (item.itemDiscount > 0) {
      msg += `  _Desconto: - R$ ${item.itemDiscount.toLocaleString('pt-BR')}_\n`;
    }
  });
  msg += `\n`;
  if (hasDiscount) {
    msg += `Subtotal: R$ ${rawSub.toLocaleString('pt-BR')}\n`;
    if (itemDiscTotal > 0) msg += `Desc. produtos: - R$ ${itemDiscTotal.toLocaleString('pt-BR')}\n`;
    if (r.discount > 0) msg += `Desc. venda: - R$ ${r.discount.toLocaleString('pt-BR')}\n`;
  }
  msg += `*Total: R$ ${r.total.toLocaleString('pt-BR')}*\n`;
  msg += r.isAberto ? `*Em aberto*\n` : `*${r.parcels}x de R$ ${parcelVal.toLocaleString('pt-BR')}*\n`;
  msg += r.isDayAberto ? `Vencimento: em aberto\n` : `Vencimento: todo dia ${r.day}\n`;
  if (r.method === 'pix') {
    msg += `Pagamento: Pix\n\nNome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\n`;
  } else {
    msg += `Pagamento: Cartão\n\n`;
  }
  msg += `Obrigada pela compra! 💖`;
  const url = `https://wa.me/${r.contact.phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function renderPDV() {
  const lockSvg = state.pdvLocked
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18 10h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v4H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v4z"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2z"/></svg>';

  const cartHtml = state.pdvCart.length > 0 ? `
    <div class="pdv-cart-summary">
      <div class="pdv-cart-count">${state.pdvCart.reduce((a,i)=>a+(i.qty||1),0)} ${state.pdvCart.reduce((a,i)=>a+(i.qty||1),0) === 1 ? 'item' : 'itens'}</div>
      <div class="pdv-cart-items-list">
        ${state.pdvCart.map((item, i) => `
          <div class="pdv-cart-chip">
            <span>${(item.qty||1) > 1 ? item.qty+'x ' : ''}${item.description}</span>
            <button class="pdv-cart-rm" onclick="pdvRemoveItem(${i})">✕</button>
          </div>`).join('')}
      </div>
    </div>` : '';

  const topbar = (backFn, title) => `<div class="pdv-topbar">
    <button class="pdv-close" onclick="${backFn}" ${state.pdvLocked && backFn === 'exitPDV()' ? 'disabled style="opacity:0.3"' : ''}>${backFn === 'exitPDV()' ? '✕' : '‹'}</button>
    <span class="pdv-title">${title}</span>
    <button class="pdv-lock ${state.pdvLocked ? 'pdv-locked' : ''}" onclick="togglePDVLock()" ${state.pdvStep === 'success' ? 'style="visibility:hidden"' : ''}>${lockSvg}</button>
  </div>`;

  // ── STEP: CHOOSE CATEGORY ──
  if (state.pdvStep === 'choose') {
    return `<div class="pdv-overlay">
      ${topbar('exitPDV()', 'Modo Venda')}
      <div class="pdv-choose-body">
        <div class="pdv-choose-label">Selecione a categoria</div>
        <div class="pdv-choose-btns">
          <button class="pdv-cat-big" onclick="pdvChooseCategory('joia')">💎 Jóia</button>
          <button class="pdv-cat-big pdv-cat-mk" onclick="pdvChooseCategory('marykay')">💄 Mary Kay</button>
        </div>
        ${cartHtml}
      </div>
      <div class="pdv-bottom">
        ${state.pdvCart.length > 0 ? `<button class="pdv-btn-next" onclick="pdvGoDetails()">Continuar →</button>` : ''}
      </div>
    </div>`;
  }

  // ── STEP: JOIA SELECT PRODUCT ──
  if (state.pdvStep === 'joia_select') {
    return `<div class="pdv-overlay">
      ${topbar("state.pdvStep='choose';render()", 'Selecionar Jóia')}
      <div class="pdv-product-list">
        ${JOIA_PRODUCTS.map(p => `
          <button class="pdv-product-btn" onclick="pdvAddJoiaWithPrice('${p.name}',${JSON.stringify(p.prices)})">
            <span class="pdv-product-name">${p.name}</span>
            <span class="pdv-product-price">${p.prices.length > 1 ? 'R$ ' + p.prices.join(' ou R$ ') : 'R$ ' + p.prices[0]}</span>
          </button>`).join('')}
      </div>
      ${cartHtml}
    </div>`;
  }

  // ── STEP: JOIA PRICE CHOICE ──
  if (state.pdvStep === 'joia_price') {
    return `<div class="pdv-overlay">
      ${topbar("state.pdvStep='joia_select';render()", state._pdvJoiaName)}
      <div class="pdv-choose-body">
        <div class="pdv-choose-label">Selecione o valor</div>
        <div class="pdv-choose-btns">
          ${state._pdvJoiaPrices.map(p => `
            <button class="pdv-price-opt" onclick="pdvConfirmJoiaPrice(${p})">R$ ${p}</button>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  // ── STEP: MARY KAY INPUT ──
  if (state.pdvStep === 'mk_input') {
    return `<div class="pdv-overlay">
      ${topbar("state.pdvStep='choose';render()", 'Produto Mary Kay')}
      <div class="pdv-choose-body">
        <div class="pdv-form-group" style="padding:0 20px;margin-top:20px">
          <label class="pdv-form-label">Nome do produto</label>
          <input class="form-input" id="pdv-mk-name" placeholder="Ex: Kit Hidratante TimeWise" autofocus />
        </div>
      </div>
      <div class="pdv-bottom">
        <button class="pdv-btn-next" onclick="pdvAddMaryKay()">Adicionar</button>
      </div>
      ${cartHtml}
    </div>`;
  }

  // ── STEP: DETAILS (prices + qty) ──
  if (state.pdvStep === 'details') {
    return `<div class="pdv-overlay">
      ${topbar('pdvDetailsBack()', 'Valores e quantidades')}
      <div class="pdv-form">
        ${state.pdvCart.map((item, i) => `
          <div class="pdv-detail-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div>
                <div class="pdv-detail-name">${item.description}</div>
                <div style="font-size:11px;color:#888;margin-top:2px">${item.category === 'joia' ? 'Jóia' : 'Mary Kay'}</div>
              </div>
              <div class="pdv-qty-control">
                <button class="pdv-qty-btn" onclick="pdvUpdateQty(${i},-1)">−</button>
                <span class="pdv-qty-num">${item.qty || 1}</span>
                <button class="pdv-qty-btn" onclick="pdvUpdateQty(${i},1)">+</button>
              </div>
            </div>
            <div class="pdv-form-group" style="margin-bottom:0">
              <label class="pdv-form-label">Valor unitário</label>
              <input class="form-input ${item.category === 'joia' ? 'pdv-val-locked' : ''}" id="pdv-val-${i}" type="number" inputmode="decimal" value="${item.value || ''}" placeholder="R$" ${item.category === 'joia' ? 'readonly' : ''} />
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
              <button class="pdv-discount-btn" onclick="pdvOpenDiscount(${i})">🏷️ Desconto</button>
              ${item.discount ? `<span style="font-size:12px;color:#3B6D11">- R$ ${item.discount} de desconto</span>` : ''}
            </div>
            ${(item.qty || 1) > 1 || item.discount ? `<div style="font-size:12px;color:#aaa;margin-top:6px;text-align:right">${(item.qty || 1) > 1 ? `${item.qty}x R$ ${item.value} = R$ ${(item.value * (item.qty || 1)).toLocaleString('pt-BR')}` : ''}${item.discount ? ` → desconto - R$ ${(item.discount * (item.qty || 1)).toLocaleString('pt-BR')} = <span style="color:#3B6D11;font-weight:600">R$ ${Math.max(0, item.value * (item.qty || 1) - item.discount * (item.qty || 1)).toLocaleString('pt-BR')}</span>` : ''}</div>` : ''}
          </div>`).join('')}
        <div class="pdv-detail-total">Total: R$ ${pdvCartTotal().toLocaleString('pt-BR')}</div>
      </div>
      <div class="pdv-bottom">
        <button class="pdv-btn-next" onclick="pdvGoPayment()">Continuar →</button>
      </div>
      ${state.modal === 'pdvDiscount' ? `
        <div class="modal-overlay" onclick="state.modal=null;render()">
          <div class="modal-sheet" onclick="event.stopPropagation()">
            <div class="modal-title">Desconto — ${state.pdvCart[state._pdvDiscountIdx]?.description}</div>
            <div class="form-group">
              <label class="form-label">Valor do desconto (R$)</label>
              <input class="form-input" id="pdv-disc-amount" type="number" inputmode="decimal" placeholder="Ex: 10" />
            </div>
            <button class="btn-primary" onclick="pdvApplyDiscount()">Aplicar desconto</button>
            <button class="btn-cancel" onclick="state.modal=null;render()">Cancelar</button>
          </div>
        </div>` : ''}
    </div>`;
  }

  // ── STEP: PAYMENT ──
  if (state.pdvStep === 'payment') {
    const selId = state._pdvSelectedContact || '';
    const opts = `<option value="" disabled ${!selId ? 'selected' : ''}>Selecione a cliente</option>` + state.contacts.map(c => `<option value="${c.id}" ${c.id === selId ? 'selected' : ''}>${c.name}${c.local ? ' (' + c.local + ')' : ''}</option>`).join('');
    const selContact = selId ? state.contacts.find(c => c.id === selId) : null;
    return `<div class="pdv-overlay">
      ${topbar('pdvPaymentBack()', 'Pagamento')}
      <div class="pdv-form">
        <div class="pdv-value-display" id="pdv-payment-summary">
          ${(() => {
            const rawSub = state.pdvCart.reduce((a, i) => a + i.value * (i.qty || 1), 0);
            const itemDisc = state.pdvCart.reduce((a, i) => a + (i.discount || 0) * (i.qty || 1), 0);
            const afterItemDisc = pdvCartTotal();
            if (itemDisc > 0) {
              return `<div style="display:flex;justify-content:space-between;font-size:14px;color:#888"><span>Subtotal</span><span>R$ ${rawSub.toLocaleString('pt-BR')}</span></div>
                <div style="display:flex;justify-content:space-between;font-size:14px;color:#3B6D11;margin-top:4px"><span>Desc. produtos</span><span>- R$ ${itemDisc.toLocaleString('pt-BR')}</span></div>
                <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#fff;margin-top:6px;padding-top:6px;border-top:1px solid #333"><span>Total</span><span>R$ ${afterItemDisc.toLocaleString('pt-BR')}</span></div>`;
            } else {
              return `<div style="font-size:14px;color:#888">Subtotal</div><div style="font-size:22px;font-weight:700;color:#fff">R$ ${afterItemDisc.toLocaleString('pt-BR')}</div>`;
            }
          })()}
          <div id="pdv-disc-summary"></div>
        </div>
        <div class="pdv-form-group">
          <label class="pdv-form-label">Cliente *</label>
          <input class="form-input" id="pdv-contact-search" placeholder="Buscar cliente..." oninput="pdvFilterContacts()" style="margin-bottom:8px" />
          <select class="form-input ${!selId ? 'pdv-field-required' : ''}" id="pdv-contact" onchange="state._pdvSelectedContact=this.value;pdvUpdatePhone();render()">${opts}</select>
          ${selContact ? `<div id="pdv-phone-display" style="font-size:13px;color:#25D366;padding:6px 0">+${selContact.phone}</div>` : ''}
          <div style="display:flex;gap:16px">
            <button class="pdv-new-client" onclick="state.modal='pdvNewContact';render()">+ Nova cliente</button>
            ${selContact ? `<button class="pdv-new-client" onclick="pdvOpenEditContact()">✏️ Editar contato</button>` : ''}
          </div>
        </div>
        <div class="pdv-form-row">
          <div class="pdv-form-group" style="flex:1">
            <label class="pdv-form-label">Parcelas *</label>
            <select class="form-input" id="pdv-parcels">
              <option value="" disabled selected>—</option>
              ${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}x</option>`).join('')}
              <option value="aberto">Em aberto</option>
            </select>
          </div>
          <div class="pdv-form-group" style="flex:1">
            <label class="pdv-form-label">Dia cobrança</label>
            <select class="form-input" id="pdv-day">
              <option value="" disabled selected>—</option>
              ${Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}
              <option value="aberto">Em aberto</option>
            </select>
          </div>
        </div>
        <div class="pdv-form-group">
          <label class="pdv-form-label">Primeira parcela</label>
          <div class="pdv-toggle-row">
            <input type="radio" name="pdv-startmonth" id="pdv-sm-current" value="0" class="pdv-toggle-input" />
            <label for="pdv-sm-current" class="pdv-toggle-btn">Este mês</label>
            <input type="radio" name="pdv-startmonth" id="pdv-sm-next" value="1" checked class="pdv-toggle-input" />
            <label for="pdv-sm-next" class="pdv-toggle-btn">Próximo mês</label>
          </div>
        </div>
        <div class="pdv-form-group">
          <label class="pdv-form-label">Desconto na venda (R$)</label>
          <input class="form-input" id="pdv-total-discount" type="number" inputmode="decimal" placeholder="Valor do desconto" value="${state._pdvTotalDiscount || ''}" oninput="pdvUpdateDiscountSummary()" />
        </div>
        <div class="pdv-form-group">
          <label class="pdv-form-label">Forma de pagamento</label>
          <div class="pdv-toggle-row">
            <input type="radio" name="pdv-method" id="pdv-method-pix" value="pix" checked class="pdv-toggle-input" />
            <label for="pdv-method-pix" class="pdv-toggle-btn">Pix</label>
            <input type="radio" name="pdv-method" id="pdv-method-cartao" value="cartao" class="pdv-toggle-input" />
            <label for="pdv-method-cartao" class="pdv-toggle-btn">Cartão</label>
          </div>
        </div>
      </div>
      <div class="pdv-bottom">
        <button class="pdv-btn-next" onclick="pdvGoReview()">Resumo da venda</button>
      </div>
      ${state.modal === 'pdvNewContact' ? `
        <div class="modal-overlay" onclick="state.modal=null;render()">
          <div class="modal-sheet" onclick="event.stopPropagation()">
            <div class="modal-title">Nova cliente</div>
            <div class="form-group"><label class="form-label">Nome</label><input class="form-input" id="pdv-nc-name" placeholder="Ex: Renata Lima" /></div>
            <div class="form-group"><label class="form-label">Local</label><input class="form-input" id="pdv-nc-local" placeholder="Ex: Posto de Saúde" /></div>
            <div class="form-group"><label class="form-label">WhatsApp (com DDD)</label><input class="form-input" id="pdv-nc-phone" type="tel" placeholder="43 99999-0000" /></div>
            <div class="form-group"><label class="form-label">Data de nascimento</label><input class="form-input" id="pdv-nc-birthday" type="tel" inputmode="numeric" placeholder="DD/MM/AAAA" maxlength="10" oninput="maskDate(this)" /></div>
            <div class="form-group"><label class="form-label">CPF</label><input class="form-input" id="pdv-nc-cpf" type="tel" placeholder="000.000.000-00" inputmode="numeric" /></div>
            <button class="btn-primary" onclick="pdvAddContact()">Cadastrar</button>
            <button class="btn-cancel" onclick="state.modal=null;render()">Cancelar</button>
          </div>
        </div>` : ''}
      ${state.modal === 'pdvEditContact' ? (() => {
        const ec = state.contacts.find(c => c.id === state._pdvEditId);
        if (!ec) return '';
        const ph = ec.phone.startsWith('55') ? ec.phone.slice(2) : ec.phone;
        return `<div class="modal-overlay" onclick="state.modal=null;render()">
          <div class="modal-sheet" onclick="event.stopPropagation()">
            <div class="modal-title">Editar contato</div>
            <div class="form-group"><label class="form-label">Nome</label><input class="form-input" id="pdv-ec-name" value="${ec.name}" /></div>
            <div class="form-group"><label class="form-label">Local</label><input class="form-input" id="pdv-ec-local" value="${ec.local || ''}" /></div>
            <div class="form-group"><label class="form-label">WhatsApp (com DDD)</label><input class="form-input" id="pdv-ec-phone" type="tel" value="${ph}" /></div>
            <div class="form-group"><label class="form-label">Data de nascimento</label><input class="form-input" id="pdv-ec-birthday" type="tel" inputmode="numeric" placeholder="DD/MM/AAAA" maxlength="10" oninput="maskDate(this)" value="${formatDateToMask(ec.birthday)}" /></div>
            <div class="form-group"><label class="form-label">CPF</label><input class="form-input" id="pdv-ec-cpf" type="tel" placeholder="000.000.000-00" inputmode="numeric" value="${ec.cpf || ''}" /></div>
            <button class="btn-primary" onclick="pdvSaveEditContact()">Salvar</button>
            <button class="btn-cancel" onclick="state.modal=null;render()">Cancelar</button>
          </div>
        </div>`;
      })() : ''}
    </div>`;
  }

  // ── STEP: REVIEW ──
  if (state.pdvStep === 'review' && state._pdvReview) {
    const rv = state._pdvReview;
    const contact = getContact(rv.contactId);
    const rawSub = state.pdvCart.reduce((a, i) => a + i.value * (i.qty || 1), 0);
    const itemDiscTotal = state.pdvCart.reduce((a, i) => a + (i.discount || 0) * (i.qty || 1), 0);
    const afterItemDisc = pdvCartTotal();
    const finalTotal = Math.max(0, afterItemDisc - rv.totalDiscount);
    const hasAnyDiscount = itemDiscTotal > 0 || rv.totalDiscount > 0;
    const isAberto = rv.parcelsRaw === 'aberto';
    const parcels = isAberto ? 1 : parseInt(rv.parcelsRaw);
    const pv = Math.round(finalTotal / parcels * 100) / 100;

    return `<div class="pdv-overlay">
      ${topbar("state.pdvStep='payment';render()", 'Resumo da venda')}
      <div class="pdv-review-scroll">
        <div class="pdv-review-section">
          <div class="pdv-review-label">Produtos</div>
          ${state.pdvCart.map(item => `
            <div class="pdv-review-product">
              <div class="pdv-review-product-left">
                <span class="pdv-review-product-name">${(item.qty||1) > 1 ? item.qty + 'x ' : ''}${item.description}</span>
                <span class="pdv-review-product-cat">${item.category === 'joia' ? 'Jóia' : 'Mary Kay'}</span>
              </div>
              <div class="pdv-review-product-price">R$ ${(item.value * (item.qty||1)).toLocaleString('pt-BR')}</div>
            </div>
            ${item.discount ? `<div style="font-size:13px;color:#3B6D11;text-align:right;margin-top:-4px;padding-bottom:8px">desconto - R$ ${((item.discount||0) * (item.qty||1)).toLocaleString('pt-BR')}</div>` : ''}
          `).join('')}
        </div>

        <div class="pdv-review-totals">
          ${hasAnyDiscount ? `
            <div class="pdv-review-row"><span>Subtotal</span><span>R$ ${rawSub.toLocaleString('pt-BR')}</span></div>
            ${itemDiscTotal > 0 ? `<div class="pdv-review-row pdv-review-disc"><span>Desc. produtos</span><span>- R$ ${itemDiscTotal.toLocaleString('pt-BR')}</span></div>` : ''}
            ${rv.totalDiscount > 0 ? `<div class="pdv-review-row pdv-review-disc"><span>Desc. venda</span><span>- R$ ${rv.totalDiscount.toLocaleString('pt-BR')}</span></div>` : ''}
          ` : ''}
          <div class="pdv-review-total-final">
            <span>Total</span>
            <span>R$ ${finalTotal.toLocaleString('pt-BR')}</span>
          </div>
        </div>

        <div class="pdv-review-section">
          <div class="pdv-review-info">
            <div class="pdv-review-info-row">
              <span class="pdv-review-info-label">Cliente</span>
              <span class="pdv-review-info-value">${contact?.name || '—'}</span>
            </div>
            <div class="pdv-review-info-row">
              <span class="pdv-review-info-label">Parcelas</span>
              <span class="pdv-review-info-value">${isAberto ? 'Em aberto' : rv.parcelsRaw + 'x de R$ ' + pv.toLocaleString('pt-BR')}</span>
            </div>
            <div class="pdv-review-info-row">
              <span class="pdv-review-info-label">Dia de cobrança</span>
              <span class="pdv-review-info-value">${rv.isDayAberto ? 'Em aberto' : 'Dia ' + rv.day}</span>
            </div>
            <div class="pdv-review-info-row">
              <span class="pdv-review-info-label">Primeira parcela</span>
              <span class="pdv-review-info-value">${rv.startMonthOffset === 0 ? 'Este mês' : 'Próximo mês'}</span>
            </div>
            <div class="pdv-review-info-row">
              <span class="pdv-review-info-label">Pagamento</span>
              <span class="pdv-review-info-value">${rv.method === 'pix' ? 'Pix' : 'Cartão'}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="pdv-bottom">
        <button class="pdv-btn-next pdv-btn-confirm" onclick="pdvSubmit()">Registrar venda</button>
      </div>
    </div>`;
  }

  // ── STEP: SUCCESS ──
  if (state.pdvStep === 'success' && state.pdvResult) {
    const r = state.pdvResult;
    const pv = Math.round(r.total / r.parcels * 100) / 100;
    return `<div class="pdv-overlay">
      ${topbar('exitPDV()', 'Venda registrada')}
      <div class="pdv-success-scroll">
        <div class="pdv-success-icon">✓</div>
        <div class="pdv-success-title">Venda registrada!</div>
        <div class="pdv-receipt">
          <div class="pdv-receipt-hero">
            <div class="pdv-receipt-day">${r.isDayAberto ? 'Em aberto' : 'Dia ' + r.day}</div>
            <div class="pdv-receipt-parcels">${r.isAberto ? 'Em aberto' : r.parcels + 'x de R$ ' + pv.toLocaleString('pt-BR')}</div>
          </div>
          <div class="pdv-receipt-divider"></div>
          <div class="pdv-receipt-row"><span>Cliente</span><span>${r.contact.name}</span></div>
          <div class="pdv-receipt-row"><span>Pagamento</span><span>${r.method === 'pix' ? 'Pix' : 'Cartão'}</span></div>
          <div class="pdv-receipt-divider"></div>
          ${r.items.map(item => `
            <div class="pdv-receipt-item">
              <span>${(item.qty||1) > 1 ? item.qty + 'x ' : ''}${item.description}</span>
              <span class="pdv-receipt-cat">${item.category === 'joia' ? 'Jóia' : 'Mary Kay'}</span>
              <span>R$ ${item.value.toLocaleString('pt-BR')}</span>
            </div>
            ${item.itemDiscount > 0 ? `<div style="font-size:11px;color:#3B6D11;text-align:right;padding:0 0 4px">desconto - R$ ${item.itemDiscount.toLocaleString('pt-BR')}</div>` : ''}
          `).join('')}
          <div class="pdv-receipt-divider"></div>
          <div class="pdv-receipt-row"><span>Subtotal</span><span>R$ ${r.items.reduce((a,i) => a + i.value * (i.qty||1), 0).toLocaleString('pt-BR')}</span></div>
          ${r.items.some(i => i.itemDiscount > 0) ? `<div class="pdv-receipt-row"><span>Desc. produtos</span><span style="color:#3B6D11">- R$ ${r.items.reduce((a,i) => a + (i.itemDiscount||0), 0).toLocaleString('pt-BR')}</span></div>` : ''}
          ${r.discount > 0 ? `<div class="pdv-receipt-row"><span>Desc. venda</span><span style="color:#3B6D11">- R$ ${r.discount.toLocaleString('pt-BR')}</span></div>` : ''}
          <div class="pdv-receipt-row" style="font-weight:700;font-size:16px"><span>Total</span><span>R$ ${r.total.toLocaleString('pt-BR')}</span></div>
        </div>
      </div>
      <div class="pdv-bottom" style="display:flex;flex-direction:column;gap:8px">
        <button class="pdv-btn-next" style="background:#25D366" onclick="pdvShareWhatsApp()"><svg width="18" height="18" viewBox="0 0 24 24" fill="white" style="vertical-align:middle;margin-right:6px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>Enviar resumo</button>
        <button class="pdv-btn-next" style="background:#333" onclick="state.pdvStep='choose';state.pdvCart=[];state.pdvResult=null;render()">Nova venda</button>
      </div>
    </div>`;
  }

  return '';
}

// ---------- NAVIGATION ----------

function switchTab(tab) { state.tab = tab; state.detail = null; state.financeDetail = 'recebido'; state.financePeriod = 'mes'; state.financeCustomMonth = null; render(); }
function goFinance(card) { state.tab = 'financeiro'; state.detail = null; state.financeDetail = card; state.financePeriod = 'mes'; state.financeCustomMonth = null; render(); }
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

function sendContactResumo(contactId) {
  const c = getContact(contactId);
  if (!c) return;
  const cSales = state.sales.filter(s => s.contact_id === contactId);
  const pendingSales = cSales.filter(s => getSaleParcels(s).some(p => !p.paid));
  if (pendingSales.length === 0) {
    showToast('Nenhuma parcela pendente!', '#3B6D11');
    return;
  }

  // Sum all next pending parcels (what she pays this month)
  let totalMensal = 0;
  const days = new Set();
  pendingSales.forEach(s => {
    const parcels = getSaleParcels(s);
    const nextPending = parcels.find(p => !p.paid);
    if (nextPending) {
      totalMensal += (nextPending.remaining || nextPending.amount);
      days.add(s.start_day);
    }
  });

  let msg = `*Resumo financeiro — ${c.name}*\n\n`;
  msg += `Valor da parcela: *R$ ${totalMensal}*\n`;
  if (days.size === 1) {
    msg += `Vencimento todo dia: *${[...days][0]}*`;
  } else {
    msg += `Vencimentos: dias *${[...days].sort((a,b)=>a-b).join(', ')}*`;
  }

  const url = `https://wa.me/${c.phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function sendContactSummary(contactId) {
  const c = getContact(contactId);
  if (!c) return;
  const cSales = state.sales.filter(s => s.contact_id === contactId);
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  // Calculate totals
  let totalPaid = 0;
  let totalPending = 0;
  let pendingParcels = [];

  const pendingSales = cSales.filter(s => getSaleParcels(s).some(p => !p.paid));
  const paidSales = cSales.filter(s => getSaleParcels(s).every(p => p.paid));

  cSales.forEach(s => {
    getSaleParcels(s).forEach(p => {
      if (p.paid) {
        totalPaid += (p.paidAmount || p.amount);
      } else {
        const remaining = p.remaining || p.amount;
        totalPending += remaining;
        pendingParcels.push({ desc: s.description, amount: remaining, dateStr: p.dateStr, date: p.date, day: s.start_day });
      }
    });
  });

  pendingParcels.sort((a, b) => a.date - b.date);

  // ── SECTION 1: RESUMO FINANCEIRO ──
  let msg = `*Resumo financeiro — ${c.name}*\n\n`;
  msg += `✅ Já pagou: *R$ ${totalPaid.toLocaleString('pt-BR')}*\n`;

  if (totalPending > 0) {
    msg += `⏳ Falta pagar: *R$ ${totalPending.toLocaleString('pt-BR')}*\n`;
    msg += `📋 Parcelas restantes: *${pendingParcels.length}*\n\n`;

    msg += `*Próximos vencimentos:*\n`;
    pendingParcels.slice(0, 6).forEach(p => {
      msg += `• ${p.dateStr} — R$ ${p.amount} (${p.desc})\n`;
    });
    if (pendingParcels.length > 6) {
      msg += `  _+ ${pendingParcels.length - 6} parcelas restantes_\n`;
    }
  } else {
    msg += `\n🎉 *Tudo quitado!*\n`;
  }

  // ── SECTION 2: HISTÓRICO COMPLETO ──
  msg += `\n———————————————\n`;
  msg += `📖 *HISTÓRICO COMPLETO*\n\n`;

  if (pendingSales.length > 0) {
    msg += `📌 *Em andamento*\n\n`;
    pendingSales.forEach(s => {
      const parcels = getSaleParcels(s);
      const dataCompra = new Date(s.created_at);
      const dataStr = `${dataCompra.getDate()}/${meses[dataCompra.getMonth()]}/${dataCompra.getFullYear()}`;
      msg += `*${s.description}*\n`;
      msg += `Compra: ${dataStr} · Total: R$ ${s.total}\n`;
      msg += `${s.parcels}x de R$ ${s.parcel_value} · Dia ${s.start_day}\n`;
      parcels.forEach(p => {
        if (p.paid) {
          const paidDate = p.paidAt ? new Date(p.paidAt) : null;
          const paidStr = paidDate ? `${paidDate.getDate()}/${meses[paidDate.getMonth()]}` : '';
          msg += `  ✅ Parc. ${p.index+1}: R$ ${p.paidAmount || p.amount} pago ${paidStr}\n`;
        } else {
          msg += `  ⏳ Parc. ${p.index+1}: R$ ${p.remaining || p.amount} pendente · ${p.dateStr}\n`;
        }
      });
      msg += `\n`;
    });
  }

  if (paidSales.length > 0) {
    msg += `✅ *Quitadas*\n\n`;
    paidSales.forEach(s => {
      const dataCompra = new Date(s.created_at);
      const dataStr = `${dataCompra.getDate()}/${meses[dataCompra.getMonth()]}/${dataCompra.getFullYear()}`;
      msg += `• ${s.description} — R$ ${s.total} · ${dataStr}\n`;
    });
  }

  const url = `https://wa.me/${c.phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}
function sendTransactionSummary(contactId, saleIdsStr) {
  const c = getContact(contactId);
  if (!c) return;
  const saleIds = saleIdsStr.split(',');
  const txSales = saleIds.map(id => state.sales.find(s => s.id === id)).filter(Boolean);
  if (txSales.length === 0) return;

  const total = txSales.reduce((a, s) => a + s.total, 0);
  const method = txSales[0].payment_method || 'pix';
  const parcelsNum = txSales[0].parcels;
  const day = txSales[0].start_day;
  const parcelVal = Math.round(total / parcelsNum * 100) / 100;

  let msg = `*Resumo da sua compra de hoje*\n\n`;
  txSales.forEach(s => {
    msg += `• ${s.description} (${s.category === 'joia' ? 'Jóia' : 'Mary Kay'}) — R$ ${s.total.toLocaleString('pt-BR')}\n`;
  });
  msg += `\n*Total: R$ ${total.toLocaleString('pt-BR')}*\n`;
  msg += parcelsNum === 1 && txSales[0].parcels === 1 ? `*Em aberto*\n` : `*${parcelsNum}x de R$ ${parcelVal.toLocaleString('pt-BR')}*\n`;
  msg += `Vencimento: ${day === 30 ? 'em aberto' : 'todo dia ' + day}\n`;
  if (method === 'pix') {
    msg += `Pagamento: Pix\n\nNome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\n`;
  } else {
    msg += `Pagamento: Cartão\n\n`;
  }
  msg += `Obrigada pela compra! 💖`;

  const url = `https://wa.me/${c.phone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

function openModal(m, extra) { state.modal = m; state.modalExtra = extra || null; render(); }
function closeModal() { state.modal = null; state.chargeModal = null; state.paidModal = null; state.deleteContactModal = null; render(); setTimeout(lockScroll, 100); setTimeout(lockScroll, 300); }
function setChargeFilter(f) { state.chargeFilter = f; render(); }

function openAdiar(chargeKeys) {
  state._adiarCharges = chargeKeys;
  state.modal = 'adiar';
  render();
}

function openAdiarForContact(contactId) {
  const allDueCharges = getDueCharges('mes');
  const contactCharges = allDueCharges.filter(c => c.contact?.id === contactId && (c.isPast || c.isToday));
  const keys = contactCharges.map(c => c.sale.id + '|' + c.parcel.index);
  openAdiar(keys);
}

function confirmAdiar() {
  const days = parseInt(document.getElementById('adiar-days')?.value) || 7;
  if (state._adiarCharges) {
    state._adiarCharges.forEach(k => {
      const [saleId, idx] = k.split('|');
      markCobrada(saleId, parseInt(idx), days);
    });
  }
  closeModal();
  showToast(`Cobrança adiada por ${days} dia${days > 1 ? 's' : ''}`);
}

function confirmReminder() {
  const days = parseInt(document.getElementById('reminder-days')?.value) || 5;
  if (state._reminderSaleId) {
    markCobrada(state._reminderSaleId, state._reminderParcelIndex, days);
  }
  closeModal();
  showToast(`Lembrete em ${days} dia${days > 1 ? 's' : ''}`);
}

function openGroupPayment(contactId) {
  const contact = getContact(contactId);
  if (!contact) return;
  // Only include parcels that are due today or overdue (matching cobranças view)
  const allDueCharges = getDueCharges('mes');
  const contactCharges = allDueCharges.filter(c => c.contact?.id === contactId && (c.isPast || c.isToday));
  let totalPending = 0;
  const pendingParcels = [];
  contactCharges.forEach(c => {
    const rem = Math.round(c.parcel.remaining || c.parcel.amount);
    totalPending += rem;
    pendingParcels.push({ saleId: c.sale.id, parcelIndex: c.parcel.index, remaining: rem });
  });
  state._groupPayment = { contactId, contactName: contact.name, totalPending, pendingParcels: pendingParcels.sort((a, b) => a.parcelIndex - b.parcelIndex) };
  state.modal = 'groupPayment';
  render();
}

async function confirmGroupPayment() {
  const val = parseFloat(document.getElementById('group-pay-amount')?.value) || 0;
  if (val <= 0) { showToast('Insira um valor válido', '#A32D2D'); return; }
  const gp = state._groupPayment;
  if (!gp) return;

  const amount = Math.min(Math.round(val), gp.totalPending);
  const parcels = [...gp.pendingParcels]; // sorted oldest first from openGroupPayment
  const payTimestamp = new Date().toISOString();

  try {
    // FIFO: pay oldest parcels first until money runs out
    let leftover = amount;

    for (const p of parcels) {
      if (leftover <= 0) break;
      const payment = state.payments.find(pm => pm.sale_id === p.saleId && pm.parcel_index === p.parcelIndex);
      const sale = state.sales.find(s => s.id === p.saleId);
      if (!payment || !sale) continue;

      const pAmt2 = getParcelAmount(sale, p.parcelIndex);
      const parcelRemaining = Math.round(pAmt2 - (payment.paid_amount || 0));
      const payAmount = Math.min(leftover, parcelRemaining);
      if (payAmount <= 0) continue;
      leftover -= payAmount;

      const totalPaid = Math.round((payment.paid_amount || 0) + payAmount);
      const isFullPayment = totalPaid >= pAmt2;

      await DB.markPaid(p.saleId, p.parcelIndex, totalPaid, isFullPayment);
      payment.paid_amount = totalPaid;
      if (isFullPayment) payment.paid = true;
      payment.paid_at = payTimestamp;
    }

    const isFullPayment = amount >= gp.totalPending;
    state.modal = null;
    showToast(`R$ ${amount.toLocaleString('pt-BR')} registrado!`);

    if (!isFullPayment) {
      const newRemaining = Math.round(gp.totalPending - amount);
      state._reminderContactId = gp.contactId;
      state._reminderGroupRemaining = newRemaining;
      state._reminderParcels = parcels.filter(p => {
        const pm = state.payments.find(pm2 => pm2.sale_id === p.saleId && pm2.parcel_index === p.parcelIndex);
        return pm && !pm.paid;
      });
      state.modal = 'groupReminderDays';
    }

    render();
    setTimeout(lockScroll, 100);
    setTimeout(lockScroll, 500);
  } catch (e) {
    showToast('Erro ao registrar.', '#A32D2D');
    console.error(e);
  }
}

function confirmGroupReminder() {
  const days = parseInt(document.getElementById('group-reminder-days')?.value) || 5;
  if (state._reminderParcels) {
    state._reminderParcels.forEach(p => {
      const payment = state.payments.find(pm => pm.sale_id === p.saleId && pm.parcel_index === p.parcelIndex);
      if (payment && !payment.paid) {
        markCobrada(p.saleId, p.parcelIndex, days);
      }
    });
  }
  closeModal();
  showToast(`Lembrete em ${days} dia${days > 1 ? 's' : ''}`);
}

async function undoPayments(paymentIdsStr) {
  const ids = paymentIdsStr.split(',');
  if (!confirm(`Desfazer ${ids.length} pagamento${ids.length > 1 ? 's' : ''}?`)) return;
  try {
    for (const id of ids) {
      await DB.undoPayment(id);
      const pm = state.payments.find(p => p.id === id);
      if (pm) {
        pm.paid = false;
        pm.paid_at = null;
        pm.paid_amount = 0;
      }
    }
    showToast('Pagamento desfeito!');
    render();
  } catch (e) {
    showToast('Erro ao desfazer.', '#A32D2D');
    console.error(e);
  }
}

async function undoParcelPayment(saleId, parcelIndex) {
  if (!confirm('Desfazer este pagamento?')) return;
  const pm = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
  if (!pm) return;
  try {
    await DB.undoPayment(pm.id);
    pm.paid = false;
    pm.paid_at = null;
    pm.paid_amount = 0;
    showToast('Pagamento desfeito!');
    render();
  } catch (e) {
    showToast('Erro ao desfazer.', '#A32D2D');
    console.error(e);
  }
}

async function openTransactionPaidModal(saleIdsStr, parcelIndex) {
  const saleIds = saleIdsStr.split(',');
  let totalAmount = 0;
  const refs = [];
  saleIds.forEach(saleId => {
    const sale = state.sales.find(s => s.id === saleId);
    const pm = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
    if (sale && pm && !pm.paid) {
      const rem = Math.round(getParcelAmount(sale, parcelIndex) - (pm.paid_amount || 0));
      totalAmount += rem;
      refs.push({ saleId, parcelIndex, remaining: rem });
    }
  });
  state._txPaidModal = { saleIds, parcelIndex, totalAmount, refs };
  state.modal = 'txPaid';
  render();
}

async function confirmTransactionPaid() {
  const tp = state._txPaidModal;
  if (!tp) return;
  try {
    for (const ref of tp.refs) {
      const sale = state.sales.find(s => s.id === ref.saleId);
      const pm = state.payments.find(p => p.sale_id === ref.saleId && p.parcel_index === ref.parcelIndex);
      if (!sale || !pm) continue;
      const pAmt = getParcelAmount(sale, ref.parcelIndex);
      const totalPaid = Math.round(pAmt);
      await DB.markPaid(ref.saleId, ref.parcelIndex, totalPaid, true);
      pm.paid = true;
      pm.paid_amount = totalPaid;
      pm.paid_at = new Date().toISOString();
    }
    state.modal = null;
    showToast('Parcela registrada!');
    render();
  } catch (e) {
    showToast('Erro ao registrar.', '#A32D2D');
    console.error(e);
  }
}

async function confirmTransactionPartial() {
  const val = parseFloat(document.getElementById('tx-paid-amount')?.value) || 0;
  const tp = state._txPaidModal;
  if (!tp || val <= 0) { showToast('Insira um valor válido', '#A32D2D'); return; }
  const amount = Math.min(Math.round(val), tp.totalAmount);
  const payTimestamp = new Date().toISOString();
  let leftover = amount;
  try {
    for (const ref of tp.refs) {
      if (leftover <= 0) break;
      const sale = state.sales.find(s => s.id === ref.saleId);
      const pm = state.payments.find(p => p.sale_id === ref.saleId && p.parcel_index === ref.parcelIndex);
      if (!sale || !pm) continue;
      const parcelRem = Math.round(getParcelAmount(sale, ref.parcelIndex) - (pm.paid_amount || 0));
      const payAmt = Math.min(leftover, parcelRem);
      leftover -= payAmt;
      const totalPaid = Math.round((pm.paid_amount || 0) + payAmt);
      const isFull = totalPaid >= getParcelAmount(sale, ref.parcelIndex);
      await DB.markPaid(ref.saleId, ref.parcelIndex, totalPaid, isFull);
      pm.paid_amount = totalPaid;
      if (isFull) pm.paid = true;
      pm.paid_at = payTimestamp;
    }
    const isFullPayment = amount >= tp.totalAmount;
    state.modal = null;
    showToast(`R$ ${amount.toLocaleString('pt-BR')} registrado!`);
    if (!isFullPayment) {
      const newRemaining = Math.round(tp.totalAmount - amount);
      state._reminderSaleId = tp.refs[0]?.saleId;
      state._reminderParcelIndex = tp.parcelIndex;
      state._reminderRemaining = newRemaining;
      state.modal = 'reminderDays';
    }
    render();
  } catch (e) {
    showToast('Erro ao registrar.', '#A32D2D');
    console.error(e);
  }
}

async function undoTransactionParcel(saleIdsStr, parcelIndex) {
  if (!confirm('Desfazer esta parcela?')) return;
  const saleIds = saleIdsStr.split(',');
  try {
    for (const saleId of saleIds) {
      const pm = state.payments.find(p => p.sale_id === saleId && p.parcel_index === parcelIndex);
      if (pm && pm.paid) {
        await DB.undoPayment(pm.id);
        pm.paid = false;
        pm.paid_at = null;
        pm.paid_amount = 0;
      }
    }
    showToast('Parcela desfeita!');
    render();
  } catch (e) {
    showToast('Erro ao desfazer.', '#A32D2D');
    console.error(e);
  }
}
function selectFinanceCard(key) { state.financeDetail = key; render(); }
function setFinancePeriod(p) {
  if (p === 'custom') {
    state.modal = 'financePeriod';
  } else {
    state.financePeriod = p;
    state.financeCustomMonth = null;
  }
  render();
}
function confirmFinancePeriod() {
  const val = document.getElementById('finance-month')?.value;
  if (val) {
    state.financePeriod = 'custom';
    state.financeCustomMonth = val;
    closeModal();
  }
}
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
  else if (state.tab === 'agenda') html = renderAgenda();
  else html = renderFinanceiro();

  if (state.detail) html += renderDetail(state.detail);
  if (state.pdvMode) html += renderPDV();
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
    { id: 'agenda', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
    { id: 'financeiro', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' }
  ];

  const nav = document.getElementById('bottomnav');
  if (nav) {
    const anyOverlay = state.modal || state.detail || state.chargeModal || state.paidModal || state.deleteContactModal || state.pdvMode;
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

function setMeta() {
  state.modal = 'setMeta';
  render();
}

function confirmMeta() {
  const val = parseFloat(document.getElementById('meta-value')?.value);
  if (val && val > 0) {
    state.metaMensal = val;
    localStorage.setItem('srcrm_meta', String(val));
    closeModal();
    showToast('Meta redefinida!');
  } else {
    showToast('Insira um valor válido', '#A32D2D');
  }
}

function renderHome() {
  const today = new Date();
  const diasSemana = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const diaSemana = diasSemana[today.getDay()];
  const diaNum = today.getDate();
  const mes = meses[today.getMonth()];
  const mesAtual = today.getMonth();
  const anoAtual = today.getFullYear();

  // Monthly sales
  const vendasMes = state.sales.filter(s => {
    const d = new Date(s.created_at);
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
  }).reduce((a, s) => a + s.total, 0);

  // Monthly received (paid this month)
  const recebidoMes = state.payments.filter(p => {
    if (!p.paid || !p.paid_at) return false;
    const d = new Date(p.paid_at);
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
  }).reduce((a, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return a + (p.paid_amount || sale?.parcel_value || 0);
  }, 0);

  // Monthly pending (unpaid parcels due this month)
  const mesCharges = getDueCharges('mes');
  const pendentesMes = mesCharges.filter(c => !c.isPast).reduce((a, c) => a + c.parcel.remaining, 0);

  const lateCharges = getDueCharges('atrasado');
  const todayCharges = getDueCharges('hoje');
  const atrasadoTotal = lateCharges.reduce((a, c) => a + c.parcel.remaining, 0);
  const clientesAtivas = state.contacts.filter(c => {
    return state.sales.some(s => s.contact_id === c.id && getSaleParcels(s).some(p => !p.paid));
  }).length;

  return `
    <div class="screen-scroll-list" style="padding-bottom:90px">
      <div class="home-header">
        <div class="home-greeting">Olá, Sônia</div>
        <div class="home-date">${diaSemana}, ${diaNum} de ${mes}</div>
      </div>

      <div class="home-section-title">Resumo mensal</div>

      <div class="home-card home-card-main" style="${(() => { const sp = Math.round(vendasMes / state.metaMensal * 100); const dp = Math.round(diaNum / new Date(anoAtual, mesAtual + 1, 0).getDate() * 100); return sp >= dp ? 'background:rgba(59,109,17,0.07);border:2px solid rgba(59,109,17,0.25)' : 'background:rgba(163,45,45,0.07);border:2px solid rgba(163,45,45,0.25)'; })()}">
        ${(() => {
          const salesPct = Math.round(vendasMes / state.metaMensal * 100);
          const daysInMonth = new Date(anoAtual, mesAtual + 1, 0).getDate();
          const dayPct = Math.round(diaNum / daysInMonth * 100);
          const isAhead = salesPct >= dayPct;
          const barColor = isAhead ? '#3B6D11' : '#A32D2D';
          const numColor = isAhead ? '#3B6D11' : '#A32D2D';
          return `
        <div class="home-card-row">
          <div>
            <div class="home-card-label">Meta mensal</div>
            <div class="home-card-big" style="color:${numColor}">R$ ${vendasMes.toLocaleString('pt-BR')}</div>
          </div>
          <div style="text-align:right">
            <div class="home-card-label">Meta</div>
            <div class="home-card-big" style="color:#888">R$ ${state.metaMensal.toLocaleString('pt-BR')}</div>
          </div>
        </div>
        <div class="home-progress-bg">
          <div class="home-progress-fill" style="width:${Math.min(100, salesPct)}%;background:${barColor}"></div>
        </div>
        <div class="home-progress-bg" style="margin-top:4px">
          <div class="home-progress-fill home-progress-day" style="width:${dayPct}%"></div>
        </div>
        <div class="home-card-row" style="margin-top:4px">
          <span class="home-card-sub">${salesPct}% da meta · dia ${diaNum}/${daysInMonth}</span>
          <span class="home-card-sub home-meta-link" onclick="setMeta()">Redefinir meta</span>
        </div>`;
        })()}
      </div>

      <div class="home-stats-row">
        <div class="home-stat-box" onclick="goFinance('recebido')">
          <div class="home-stat-num" style="color:#3B6D11">R$ ${recebidoMes.toLocaleString('pt-BR')}</div>
          <div class="home-stat-label">Recebido</div>
        </div>
        <div class="home-stat-box" onclick="goFinance('a_receber')">
          <div class="home-stat-num" style="color:#993556">R$ ${pendentesMes.toLocaleString('pt-BR')}</div>
          <div class="home-stat-label">A receber</div>
        </div>
        <div class="home-stat-box" onclick="goFinance('atrasado')">
          <div class="home-stat-num" style="color:#A32D2D">R$ ${atrasadoTotal.toLocaleString('pt-BR')}</div>
          <div class="home-stat-label">Atrasadas (${lateCharges.length})</div>
        </div>
      </div>

      <div class="home-section-title">Resumo do dia</div>
      ${(() => {
        const hoje = new Date();
        const vendasHoje = state.sales.filter(s => {
          const d = new Date(s.created_at);
          return d.getDate() === hoje.getDate() && d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
        });
        const totalHoje = vendasHoje.reduce((a, s) => a + s.total, 0);
        // Group by transaction
        const txKeys = new Set();
        vendasHoje.forEach(s => {
          const t = new Date(s.created_at);
          txKeys.add(`${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`);
        });
        const numVendas = txKeys.size;
        const recebidoHoje = state.payments.filter(p => {
          if (!p.paid || !p.paid_at) return false;
          const d = new Date(p.paid_at);
          return d.getDate() === hoje.getDate() && d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
        }).reduce((a, p) => {
          const sale = state.sales.find(s => s.id === p.sale_id);
          return a + (p.paid_amount || sale?.parcel_value || 0);
        }, 0);

        return `
          <div class="home-day-summary" onclick="state.modal='vendasDia';render()">
            <div class="home-day-stats">
              <div class="home-day-stat">
                <div class="home-day-stat-num">${numVendas}</div>
                <div class="home-day-stat-label">vendas</div>
              </div>
              <div class="home-day-stat">
                <div class="home-day-stat-num" style="color:#3B6D11">R$ ${totalHoje.toLocaleString('pt-BR')}</div>
                <div class="home-day-stat-label">vendido</div>
              </div>
              <div class="home-day-stat">
                <div class="home-day-stat-num" style="color:#3B6D11">R$ ${recebidoHoje.toLocaleString('pt-BR')}</div>
                <div class="home-day-stat-label">recebido</div>
              </div>
            </div>
            <div class="home-day-footer">Toque para ver detalhes</div>
          </div>`;
      })()}

      <div style="padding:0 16px 20px">
        <button class="home-pdv-btn" onclick="enterPDV()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Modo Venda
        </button>
      </div>

      <div class="home-cards-row">
        ${(() => {
          const dueToday = getDueCharges('mes').filter(c => (c.isPast || c.isToday) && !isCobrada(c.sale.id, c.parcel.index));
          const count = dueToday.length;
          if (count > 0) {
            return `<div class="home-mini-card home-mini-alert" onclick="state.chargeFilter='pendente';switchTab('cobrancas')">
              <div class="home-mini-num" style="color:#D4537E">${count}</div>
              <div class="home-mini-label">cobrança${count !== 1 ? 's' : ''}</div>
              <div class="home-mini-sub">pendente${count !== 1 ? 's' : ''}</div>
            </div>`;
          } else {
            return `<div class="home-mini-card home-mini-muted">
              <div class="home-mini-num" style="color:#ddd">0</div>
              <div class="home-mini-label" style="color:#ccc">cobranças</div>
            </div>`;
          }
        })()}
        ${(() => {
          const today = new Date();
          const todayM = today.getMonth() + 1;
          const todayD = today.getDate();
          const bdays = state.contacts.filter(c => {
            if (!c.birthday) return false;
            const [y, m, d] = c.birthday.split('-').map(Number);
            return m === todayM && d === todayD;
          });
          if (bdays.length > 0) {
            return `<div class="home-mini-card home-mini-bday" onclick="state.modal='birthdays';render()">
              <div class="home-mini-num" style="color:#E8A317">🎂 ${bdays.length}</div>
              <div class="home-mini-label">aniversário${bdays.length !== 1 ? 's' : ''}</div>
              <div class="home-mini-sub">hoje</div>
            </div>`;
          } else {
            return `<div class="home-mini-card home-mini-muted" onclick="state.modal='birthdays';render()">
              <div class="home-mini-num" style="color:#ddd">🎂</div>
              <div class="home-mini-label" style="color:#ccc">aniversários</div>
            </div>`;
          }
        })()}
        ${(() => {
          const todayEvents = getAgendaDayEvents(new Date());
          const compromissos = todayEvents.filter(e => e.type === 'compromisso');
          if (compromissos.length > 0) {
            return `<div class="home-mini-card home-mini-agenda" onclick="switchTab('agenda')">
              <div class="home-mini-num" style="color:#5B6ABF">📅 ${compromissos.length}</div>
              <div class="home-mini-label">${compromissos[0].title.slice(0, 12)}${compromissos[0].title.length > 12 ? '…' : ''}</div>
              <div class="home-mini-sub">${compromissos[0].time || 'hoje'}</div>
            </div>`;
          } else {
            return `<div class="home-mini-card home-mini-muted" onclick="switchTab('agenda')">
              <div class="home-mini-num" style="color:#ddd">📅</div>
              <div class="home-mini-label" style="color:#ccc">agenda</div>
            </div>`;
          }
        })()}
      </div>

    </div>`;
}

function renderContatos() {
  const filtered = state.contacts.filter(c =>
    c.name.toLowerCase().includes(state.search.toLowerCase()) ||
    (c.local || '').toLowerCase().includes(state.search.toLowerCase())
  );
  const pendingByContact = {};
  // Group sales by contact + transaction (same minute)
  const txByContact = {};
  state.sales.forEach(s => {
    const t = new Date(s.created_at);
    const txKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`;
    const cKey = s.contact_id;
    if (!txByContact[cKey]) txByContact[cKey] = {};
    if (!txByContact[cKey][txKey]) txByContact[cKey][txKey] = [];
    txByContact[cKey][txKey].push(s);
  });
  Object.entries(txByContact).forEach(([contactId, txs]) => {
    let count = 0;
    Object.values(txs).forEach(sales => {
      // Check if this transaction has ANY unpaid parcel
      const hasAnyPending = sales.some(s => {
        return state.payments.some(p => p.sale_id === s.id && !p.paid);
      });
      if (hasAnyPending) count++;
    });
    if (count > 0) pendingByContact[contactId] = count;
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
  const today = new Date();
  const allDueCharges = getDueCharges('mes');
  const todayAndLate = allDueCharges.filter(c => c.isPast || c.isToday);

  const pendentes = todayAndLate.filter(c => !isCobrada(c.sale.id, c.parcel.index));
  const realizadas = todayAndLate.filter(c => isCobrada(c.sale.id, c.parcel.index));

  const filter = state.chargeFilter || 'pendente';
  const charges = filter === 'pendente' ? pendentes : realizadas;

  // Group by contact
  const contactGroups = {};
  charges.forEach(c => {
    const cid = c.contact?.id;
    if (!cid) return;
    if (!contactGroups[cid]) contactGroups[cid] = { contact: c.contact, charges: [], hasLate: false };
    contactGroups[cid].charges.push(c);
    if (c.isPast) contactGroups[cid].hasLate = true;
  });
  const groups = Object.values(contactGroups).sort((a, b) => {
    if (a.hasLate && !b.hasLate) return -1;
    if (!a.hasLate && b.hasLate) return 1;
    return a.contact.name.localeCompare(b.contact.name, 'pt-BR');
  });

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Cobranças</h2></div>
        </div>
      </div>
      <div class="filter-tabs">
        <button class="filter-tab ${filter === 'pendente' ? 'active' : ''}" onclick="setChargeFilter('pendente')">Cobrança pendente (${pendentes.length})</button>
        <button class="filter-tab ${filter === 'realizada' ? 'active' : ''}" onclick="setChargeFilter('realizada')">Cobrança realizada (${realizadas.length})</button>
      </div>
      <div class="charge-summary">
        <div class="charge-summary-item"><span class="charge-summary-num">${groups.length}</span><span class="charge-summary-label">clientes</span></div>
        <div class="charge-summary-item"><span class="charge-summary-num" style="color:#A32D2D">${charges.filter(c => c.isPast).length}</span><span class="charge-summary-label">atrasadas</span></div>
        <div class="charge-summary-item"><span class="charge-summary-num" style="color:#993556">R$ ${charges.reduce((a, c) => a + (c.parcel.remaining || c.parcel.amount), 0).toLocaleString('pt-BR')}</span><span class="charge-summary-label">total</span></div>
      </div>
    </div>
    <div class="screen-scroll-list">
      ${groups.length === 0 ? '<div class="empty-state">' + (filter === 'pendente' ? 'Nenhuma cobrança pendente 🎉' : 'Nenhuma cobrança realizada') + '</div>' : ''}
      ${groups.map(g => {
        const ci = getColorIndex(g.contact.id);
        const total = g.charges.reduce((a, c) => a + (c.parcel.remaining || c.parcel.amount), 0);
        const isCard = g.charges[0]?.sale.payment_method === 'cartao';
        const wppUrl = getGroupChargeUrl(g.contact, g.charges);

        return '<div class="charge-item ' + (g.hasLate ? 'charge-item-late' : '') + '">' +
          '<div class="charge-header">' +
            '<div class="avatar" style="width:42px;height:42px;font-size:14px;background:' + COLORS[ci] + ';color:' + TEXT_COLORS[ci] + '">' + getInitials(g.contact.name) + '</div>' +
            '<div style="flex:1">' +
              '<span class="charge-name">' + g.contact.name + '</span>' +
              '<div style="font-size:12px;color:#aaa;margin-top:2px">' + g.charges.length + ' parcela' + (g.charges.length > 1 ? 's' : '') + '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div class="charge-amount" style="margin:0">R$ ' + total.toLocaleString('pt-BR') + '</div>' +
              (g.hasLate ? '<span class="badge badge-late" style="margin-top:4px;display:inline-block">Atrasado</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="charge-actions">' +
            (filter === 'realizada' ?
              '<button class="btn-cobrar" onclick="cobrarGrupoRealizada(\'' + g.contact.id + '\')">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>' +
                ' Cobrar</button>' :
              (isCard ?
                '<span class="charge-cartao-tag">💳 Cartão</span>' :
                '<button class="btn-cobrar" onclick="cobrarGrupo(\'' + g.contact.id + '\')">' +
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>' +
                  ' Cobrar</button>')
            ) +
            '<button class="btn-pago" onclick="openAdiarForContact(\'' + g.contact.id + '\')">Adiar</button>' +
            '<button class="btn-pago" onclick="openGroupPayment(\'' + g.contact.id + '\')">Registrar</button>' +
          '</div>' +
        '</div>';
      }).join('')}
    </div>`;
}

function renderAgenda() {
  const today = new Date();
  const sel = state.agendaDate || today;
  const selY = sel.getFullYear(), selM = sel.getMonth();
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const diasSem = ['D','S','T','Q','Q','S','S'];

  const firstDay = new Date(selY, selM, 1).getDay();
  const daysInMonth = new Date(selY, selM + 1, 0).getDate();

  // Build calendar grid
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('');
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (d) => d === today.getDate() && selM === today.getMonth() && selY === today.getFullYear();
  const isSelected = (d) => d === sel.getDate() && selM === sel.getMonth() && selY === sel.getFullYear();

  // Check which days have events
  const daysWithEvents = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const evts = getAgendaDayEvents(new Date(selY, selM, d));
    if (evts.length > 0) daysWithEvents[d] = evts.length;
  }

  // Events for selected day
  const dayEvents = getAgendaDayEvents(sel);

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Agenda</h2></div>
          <button class="add-btn" onclick="state.modal='addAgenda';render()">+</button>
        </div>
      </div>
      <div class="agenda-month-nav">
        <button class="agenda-nav-btn" onclick="agendaNav(-1)">‹</button>
        <span class="agenda-month-label">${meses[selM]} ${selY}</span>
        <button class="agenda-nav-btn" onclick="agendaNav(1)">›</button>
      </div>
      <div class="agenda-cal">
        <div class="agenda-week-header">
          ${diasSem.map(d => `<div class="agenda-week-day">${d}</div>`).join('')}
        </div>
        <div class="agenda-grid">
          ${cells.map(d => {
            if (!d) return '<div class="agenda-cell"></div>';
            const hasEvt = daysWithEvents[d];
            return `<div class="agenda-cell ${isToday(d) ? 'agenda-today' : ''} ${isSelected(d) ? 'agenda-selected' : ''}" onclick="agendaSelectDay(${d})">
              <span>${d}</span>
              ${hasEvt ? '<div class="agenda-dot"></div>' : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="screen-scroll-list">
      <div class="section-label" style="padding-top:12px">${sel.getDate()} de ${meses[selM].toLowerCase()}</div>
      <div style="padding:0 16px">
        ${dayEvents.length === 0 ? '<div style="text-align:center;color:#aaa;font-size:14px;padding:20px 0">Nenhum evento neste dia</div>' : ''}
        ${dayEvents.map(e => `
          <div class="agenda-event ${e.done ? 'agenda-event-done' : ''}" style="border-left:3px solid ${e.color};cursor:pointer" ${e.type === 'cobranca' && e.contact && !e.done ? `onclick="openAgendaChargeGroup('${e.contact?.id}')"` : ''} ${e.type === 'compromisso' && e.id ? `onclick="openAgendaDetail('${e.id}')"` : ''}>
            <div class="agenda-event-header">
              <div style="flex:1">
                <div class="agenda-event-title">${e.done ? '✅ ' : ''}${e.title}</div>
                ${e.sub ? `<div class="agenda-event-sub">${e.sub}</div>` : ''}
                ${e.time ? `<div class="agenda-event-sub">⏰ ${e.time}</div>` : ''}
                ${e.location ? `<div class="agenda-event-sub">📍 ${e.location}</div>` : ''}
              </div>
              ${e.type === 'compromisso' && e.id ? `
                <button class="agenda-check-btn ${e.done ? 'agenda-check-done' : ''}" onclick="event.stopPropagation();toggleAgendaDone('${e.id}')">${e.done ? '✓' : '○'}</button>
              ` : ''}
              ${e.type === 'aniversario' && !e.done ? `
                <button class="agenda-bday-btn" onclick="event.stopPropagation();sendBdayAndMark('${e.contactId}','${e.phone}')">Felicitar 💖</button>
              ` : ''}
              ${e.type === 'cobranca' && !e.done ? '<span style="color:#aaa;font-size:16px">›</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function agendaNav(dir) {
  const d = state.agendaDate || new Date();
  state.agendaDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  render();
}

function agendaSelectDay(day) {
  const d = state.agendaDate || new Date();
  state.agendaDate = new Date(d.getFullYear(), d.getMonth(), day);
  render();
}

function addAgendaEvent() {
  const title = document.getElementById('agenda-title')?.value?.trim();
  const time = document.getElementById('agenda-time')?.value || '';
  const location = document.getElementById('agenda-location')?.value?.trim() || '';
  if (!title) { showToast('Digite o título do compromisso', '#A32D2D'); return; }
  const d = state.agendaDate || new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  saveAgendaEvent({ title, date, time, location });
  closeModal();
  showToast('Compromisso adicionado!');
}

function openAgendaCharge(saleId, contactId) {
  state._agendaChargeData = { saleId, contactId };
  state.modal = 'agendaCharge';
  render();
}

function agendaCobrarAgora(saleId, parcelIndex, wppUrl) {
  markCobrada(saleId, parcelIndex, 2);
  window.open(wppUrl, '_blank');
  closeModal();
}

function openAgendaChargeGroup(contactId) {
  state._agendaChargeData = { contactId };
  state.modal = 'agendaChargeGroup';
  render();
}

function agendaCobrarGrupo(contactId) {
  const contact = getContact(contactId);
  if (!contact) return;
  const sel = state.agendaDate || new Date();
  const dayEvents = getAgendaDayEvents(sel);
  const chargeEvt = dayEvents.find(e => e.type === 'cobranca' && e.contact?.id === contactId);
  if (chargeEvt) {
    chargeEvt.charges.forEach(c => markCobrada(c.sale.id, c.parcel.index, 2));
    const total = chargeEvt.totalDue;
    const day = chargeEvt.charges[0]?.sale.start_day || '';
    const msg = `Oiiii😍\nTudo bem?\nEstou enviando o valor do seu pix de hoje!\n\nValor a pagar hoje: R$ ${total}\nVencimento todo dia: ${day}\n\nNome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\nObrigada! 💖`;
    window.open(`https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`, '_blank');
  }
  closeModal();
}

function renderFinanceiro() {
  const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const today = new Date();
  let filterMonth, filterYear, periodLabel;
  const isCompleto = state.financePeriod === 'completo';

  if (state.financePeriod === 'custom' && state.financeCustomMonth) {
    const [y, m] = state.financeCustomMonth.split('-');
    filterMonth = parseInt(m) - 1;
    filterYear = parseInt(y);
    periodLabel = `${mesesNomes[filterMonth]} ${filterYear}`;
  } else {
    filterMonth = today.getMonth();
    filterYear = today.getFullYear();
    periodLabel = 'Este mês';
  }

  const isInPeriod = (dateStr) => {
    if (isCompleto) return !!dateStr;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  };

  // Recebido no período
  const paidInPeriod = state.payments.filter(p => p.paid && isInPeriod(p.paid_at));
  const recebido = paidInPeriod.reduce((a, p) => {
    const sale = state.sales.find(s => s.id === p.sale_id);
    return a + (p.paid_amount || sale?.parcel_value || 0);
  }, 0);

  // A receber no período (parcelas com vencimento no período, não pagas)
  const aReceberItems = [];
  state.sales.forEach(sale => {
    getSaleParcels(sale).forEach(p => {
      if (!p.paid && (isCompleto || (p.date.getMonth() === filterMonth && p.date.getFullYear() === filterYear))) {
        aReceberItems.push({ sale, parcel: p, contact: getContact(sale.contact_id) });
      }
    });
  });
  const pendente = aReceberItems.reduce((a, item) => a + item.parcel.remaining, 0);

  // Em atraso (vencidas e não pagas, qualquer período)
  const atrasadoItems = [];
  state.sales.forEach(sale => {
    getSaleParcels(sale).forEach(p => {
      if (!p.paid && p.date < today && !(p.date.getDate() === today.getDate() && p.date.getMonth() === today.getMonth())) {
        atrasadoItems.push({ sale, parcel: p, contact: getContact(sale.contact_id) });
      }
    });
  });
  atrasadoItems.sort((a, b) => a.parcel.date - b.parcel.date);
  const atrasado = atrasadoItems.reduce((a, item) => a + item.parcel.remaining, 0);

  const sel = state.financeDetail || 'recebido';

  // Build transaction list based on selected card
  let transactions = [];
  let listTitle = '';

  if (sel === 'recebido') {
    listTitle = 'Pagamentos recebidos';
    // Group payments by contact
    const paymentGroups = {};
    paidInPeriod.forEach(p => {
      const sale = state.sales.find(s => s.id === p.sale_id);
      if (!sale) return;
      const contact = getContact(sale.contact_id);
      const groupKey = sale.contact_id;
      if (!paymentGroups[groupKey]) {
        paymentGroups[groupKey] = { contact, total: 0, payments: [], sales: [] };
      }
      paymentGroups[groupKey].total += Math.round(p.paid_amount || getParcelAmount(sale, p.parcel_index));
      paymentGroups[groupKey].payments.push(p);
      if (!paymentGroups[groupKey].sales.find(s => s.id === sale.id)) {
        paymentGroups[groupKey].sales.push(sale);
      }
    });
    Object.values(paymentGroups).forEach(g => {
      const descs = [...new Set(g.sales.map(s => s.description))];
      transactions.push({
        name: g.contact?.name || '—',
        desc: descs.length <= 2 ? descs.join(', ') : descs.slice(0, 2).join(', ') + ` +${descs.length - 2}`,
        date: `${g.payments.length} pagamento${g.payments.length > 1 ? 's' : ''}`,
        value: g.total,
        color: '#3B6D11',
        prefix: '+',
        sale: g.sales[0], contact: g.contact,
        paymentGroup: g.payments
      });
    });
    transactions.sort((a, b) => b.value - a.value);
  } else if (sel === 'a_receber') {
    listTitle = 'Parcelas a receber';
    aReceberItems.sort((a, b) => a.parcel.date - b.parcel.date);
    aReceberItems.forEach(({ sale, parcel, contact }) => {
      transactions.push({
        name: contact?.name?.split(' ').slice(0, 2).join(' ') || '—',
        desc: `${sale.description} · Parc. ${parcel.index + 1}/${sale.parcels}`,
        date: parcel.dateStr,
        value: parcel.remaining,
        color: '#993556',
        prefix: '',
        sale, parcel, contact, actionable: true
      });
    });
  } else if (sel === 'atrasado') {
    listTitle = 'Parcelas em atraso';
    atrasadoItems.forEach(({ sale, parcel, contact }) => {
      transactions.push({
        name: contact?.name?.split(' ').slice(0, 2).join(' ') || '—',
        desc: `${sale.description} · Parc. ${parcel.index + 1}/${sale.parcels}`,
        date: parcel.dateStr,
        value: parcel.remaining,
        color: '#A32D2D',
        prefix: '',
        sale, parcel, contact, actionable: true
      });
    });
  }

  return `
    <div class="screen-fixed-header">
      <div class="topbar">
        <div class="topbar-row">
          <div><h2>Financeiro</h2></div>
        </div>
      </div>
      <div class="filter-tabs">
        <button class="filter-tab ${state.financePeriod === 'mes' ? 'active' : ''}" onclick="setFinancePeriod('mes')">Este mês</button>
        <button class="filter-tab ${state.financePeriod === 'custom' ? 'active' : ''}" onclick="setFinancePeriod('custom')">${state.financePeriod === 'custom' ? periodLabel : 'Período'}</button>
        <button class="filter-tab ${state.financePeriod === 'completo' ? 'active' : ''}" onclick="setFinancePeriod('completo')">Completo</button>
      </div>
      <div class="metric-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="metric-card ${sel === 'recebido' ? 'metric-card-active' : ''}" onclick="selectFinanceCard('recebido')" style="cursor:pointer">
          <div class="metric-label">Recebido</div>
          <div class="metric-value" style="color:#3B6D11">R$ ${recebido.toLocaleString('pt-BR')}</div>
        </div>
        <div class="metric-card ${sel === 'a_receber' ? 'metric-card-active' : ''}" onclick="selectFinanceCard('a_receber')" style="cursor:pointer">
          <div class="metric-label">A receber</div>
          <div class="metric-value" style="color:#993556">R$ ${pendente.toLocaleString('pt-BR')}</div>
        </div>
        <div class="metric-card ${sel === 'atrasado' ? 'metric-card-active' : ''}" onclick="selectFinanceCard('atrasado')" style="cursor:pointer">
          <div class="metric-label">Em atraso</div>
          <div class="metric-value" style="color:#A32D2D">R$ ${atrasado.toLocaleString('pt-BR')}</div>
        </div>
      </div>
      <div class="section-label" style="margin-top:8px">${listTitle}</div>
    </div>
    <div class="screen-scroll-list">
      <div class="upcoming-list">
        ${transactions.length === 0 ? '<div class="empty-state" style="padding:20px">Nenhuma transação neste período.</div>' : ''}
        ${transactions.map(t => {
          let actionHtml = '';
          if (t.paymentGroup) {
            // Recebido: show undo button
            const pids = t.paymentGroup.map(p => p.id).join(',');
            actionHtml = '<button class="fin-tx-undo" onclick="undoPayments(\'' + pids + '\')">Desfazer</button>';
          } else if (t.actionable && t.contact && t.sale) {
            const isCard = t.sale.payment_method === 'cartao';
            if (!isCard) {
              const msg = getWhatsappMsg(t.contact, t.parcel, t.sale);
              const url = 'https://wa.me/' + t.contact.phone + '?text=' + encodeURIComponent(msg);
              actionHtml = '<button class="fin-tx-cobrar" onclick="openWppAndMark(\'' + url + '\',\'' + t.sale.id + '\',' + t.parcel.index + ')">Cobrar</button>';
            } else {
              actionHtml = '<span style="font-size:11px;color:#aaa">💳</span>';
            }
          }
          return `
            <div class="fin-transaction">
              <div class="fin-tx-left" ${t.sale ? 'onclick="state.modal=\'finDetail\';state.modalExtra=\'' + t.sale.id + '\';render()" style="cursor:pointer"' : ''}>
                <div class="fin-tx-name">${t.name}</div>
                <div class="fin-tx-desc">${t.desc}</div>
              </div>
              <div class="fin-tx-right">
                <div class="fin-tx-value" style="color:${t.color}">${t.prefix}R$ ${t.value.toLocaleString('pt-BR')}</div>
                <div class="fin-tx-date">${t.date}</div>
                ${actionHtml}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderDetail(contactId) {
  const c = getContact(contactId);
  if (!c) return '';
  const ci = getColorIndex(c.id);
  const cSales = state.sales.filter(s => s.contact_id === contactId);
  const totalPending = cSales.reduce((a, s) => {
    return a + getSaleParcels(s).filter(p => !p.paid).reduce((x, p) => x + p.remaining, 0);
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
  const pendingParcels = (() => {
    // Group sales by transaction (same minute)
    const txGroups = {};
    cSales.forEach(s => {
      const t = new Date(s.created_at);
      const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`;
      if (!txGroups[key]) txGroups[key] = [];
      txGroups[key].push(s);
    });
    // Count transactions with ANY unpaid parcel
    let count = 0;
    Object.values(txGroups).forEach(sales => {
      const hasAnyPending = sales.some(s => {
        return state.payments.some(p => p.sale_id === s.id && !p.paid);
      });
      if (hasAnyPending) count++;
    });
    return count;
  })();
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
        <div class="info-row"><span class="info-label">Nascimento</span><span class="info-value">${c.birthday ? new Date(c.birthday + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</span></div>
        <div class="info-row"><span class="info-label">CPF</span><span class="info-value">${c.cpf ? c.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—'}</span></div>
        <div class="info-row"><span class="info-label">Cliente desde</span><span class="info-value">${clientSince ? clientSince.toLocaleDateString('pt-BR') : '—'}</span></div>
        <div class="info-row"><span class="info-label">A receber</span><span class="info-value" style="color:${totalPending > 0 ? '#993556' : '#3B6D11'}">R$ ${totalPending.toLocaleString('pt-BR')}</span></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="sendContactResumo('${c.id}')" style="flex:2;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;background:#25D366;border:none;border-radius:10px;color:white;font-size:14px;font-weight:500;cursor:pointer"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> Enviar resumo</button>
          <button onclick="sendContactSummary('${c.id}')" style="flex:1;padding:11px;background:none;border:1px solid #25D366;border-radius:10px;color:#25D366;font-size:13px;font-weight:500;cursor:pointer">Histórico</button>
        </div>
        <button onclick="openModal('editContact','${c.id}')" style="width:100%;padding:10px;background:none;border:1px solid #e0e0e0;border-radius:10px;color:#666;font-size:14px;cursor:pointer;margin-top:8px">✏️ Editar dados</button>
        <button onclick="openFullPayment('${c.id}')" style="width:100%;padding:12px;background:#D4537E;border:none;border-radius:10px;color:white;font-size:15px;font-weight:600;cursor:pointer;margin-top:8px">Registrar pagamento</button>
      </div>
      <div class="detail-section">
        <h3>Resumo da cliente</h3>
        <div class="client-stats">
          <div class="client-stat"><div class="client-stat-value">R$ ${Math.round(totalSpent).toLocaleString('pt-BR')}</div><div class="client-stat-label">total comprado</div></div>
          <div class="client-stat"><div class="client-stat-value">R$ ${Math.round(totalPaid).toLocaleString('pt-BR')}</div><div class="client-stat-label">total pago</div></div>
          <div class="client-stat"><div class="client-stat-value">R$ ${mediaMensal.toLocaleString('pt-BR')}</div><div class="client-stat-label">média/mês</div></div>
          <div class="client-stat"><div class="client-stat-value">${pendingParcels}</div><div class="client-stat-label">parcelas pendentes</div></div>
          <div class="client-stat"><div class="client-stat-value">${(() => {
            const txKeys = new Set();
            cSales.forEach(s => {
              const t = new Date(s.created_at);
              txKeys.add(`${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`);
            });
            return txKeys.size;
          })()}</div><div class="client-stat-label">vendas</div></div>
          <div class="client-stat"><div class="client-stat-value">${tempoCliente || '—'}</div><div class="client-stat-label">como cliente</div></div>
        </div>
      </div>
      <div class="detail-section">
        <h3>Compras</h3>
        ${cSales.length === 0 ? '<div style="color:#aaa;font-size:14px;padding:8px 0">Nenhuma venda registrada.</div>' : ''}
        ${(() => {
          // Group sales by transaction (same minute)
          const groups = [];
          const sorted = [...cSales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          sorted.forEach(s => {
            const t = new Date(s.created_at);
            const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`;
            let group = groups.find(g => g.key === key);
            if (!group) {
              const mesesAbr = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
              group = { key, date: `${t.getDate()}/${mesesAbr[t.getMonth()]}/${t.getFullYear()}`, sales: [], ids: [] };
              groups.push(group);
            }
            group.sales.push(s);
            group.ids.push(s.id);
          });
          return groups.map(g => {
            const gTotal = g.sales.reduce((a, s) => a + s.total, 0);
            const method = g.sales[0]?.payment_method || 'pix';
            const numParcels = g.sales[0]?.parcels || 1;
            const day = g.sales[0]?.start_day || 1;

            // Build unified parcels across all sales in transaction
            const unifiedParcels = [];
            for (let pi = 0; pi < numParcels; pi++) {
              let totalAmount = 0;
              let totalPaid = 0;
              let isPaid = true;
              let paidAt = null;
              const parcelSaleRefs = [];
              g.sales.forEach(s => {
                const p = getSaleParcels(s).find(pp => pp.index === pi);
                if (p) {
                  totalAmount += p.amount;
                  totalPaid += p.paidAmount;
                  if (!p.paid) isPaid = false;
                  if (p.paidAt && (!paidAt || p.paidAt > paidAt)) paidAt = p.paidAt;
                  parcelSaleRefs.push({ saleId: s.id, parcelIndex: pi });
                }
              });
              const remaining = Math.round(totalAmount - totalPaid);
              const firstSaleParcel = getSaleParcels(g.sales[0]).find(pp => pp.index === pi);
              unifiedParcels.push({
                index: pi, amount: Math.round(totalAmount), paidAmount: Math.round(totalPaid),
                remaining, paid: isPaid, paidAt,
                dateStr: firstSaleParcel?.dateStr || '',
                saleRefs: parcelSaleRefs
              });
            }

            return `
              <div class="transaction-group">
                <div class="transaction-header">
                  <div>
                    <div style="font-size:13px;color:#888">${g.date} · ${g.sales.length} ${g.sales.length === 1 ? 'item' : 'itens'} · ${method === 'pix' ? 'Pix' : 'Cartão'}</div>
                    <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-top:2px">R$ ${gTotal.toLocaleString('pt-BR')} · ${numParcels}x R$ ${Math.round(gTotal / numParcels * 100) / 100} · Dia ${day}</div>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button onclick="sendTransactionSummary('${c.id}','${g.ids.join(',')}')" style="background:#25D366;border:none;border-radius:8px;color:white;font-size:11px;padding:6px 10px;cursor:pointer;white-space:nowrap">📩 Enviar</button>
                    <button onclick="openEditTransaction('${g.ids.join(',')}')" style="background:none;border:1px solid #ddd;border-radius:8px;color:#666;font-size:11px;padding:6px 8px;cursor:pointer">✏️</button>
                  </div>
                </div>
                <div style="padding:8px 0 4px">
                  ${g.sales.map(s => `<div style="font-size:13px;color:#555;padding:2px 0">• ${s.description} — R$ ${s.total}</div>`).join('')}
                </div>
                <div style="margin-top:4px">
                  ${unifiedParcels.map(p => `
                    <div class="parcel-row">
                      <span class="parcel-num">Parc. ${p.index + 1}</span>
                      <span class="parcel-date">${p.dateStr}</span>
                      <div class="parcel-status">
                        <span class="badge ${p.paid ? 'badge-ok' : 'badge-due'}">${p.paid ? 'Pago' : 'R$ ' + p.remaining}</span>
                        ${p.paid ? `<button style="background:none;border:none;cursor:pointer;font-size:11px;color:#A32D2D;padding:0" onclick="undoTransactionParcel('${g.ids.join(',')}',${p.index})">Desfazer</button>` : ''}
                      </div>
                    </div>`).join('')}
                </div>
              </div>`;
          }).join('');
        })()}
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

  if (state.modal === 'editTransaction' && state._editTransactionIds) {
    const ids = state._editTransactionIds.split(',');
    const txSales = ids.map(id => state.sales.find(s => s.id === id)).filter(Boolean);
    if (txSales.length > 0) {
      const first = txSales[0];
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh">
          <div class="modal-title">Editar venda</div>
          ${txSales.map((s, i) => `
            <div style="background:#f9f9f9;border-radius:10px;padding:10px;margin-bottom:8px">
              <div class="form-group" style="margin-bottom:8px"><label class="form-label">Produto ${i + 1}</label><input class="form-input" id="et-desc-${i}" value="${s.description}" /></div>
              <div class="form-group" style="margin-bottom:0"><label class="form-label">Total (R$)</label><input class="form-input" id="et-total-${i}" type="number" inputmode="decimal" value="${s.total}" /></div>
            </div>
          `).join('')}
          <div class="form-group">
            <label class="form-label">Parcelas</label>
            <select class="form-input" id="et-parcels">
              ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1 === first.parcels ? 'selected' : ''}>${i+1}x</option>`).join('')}
              <option value="1" ${first.parcels === 1 ? 'selected' : ''}>Em aberto</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Dia de cobrança</label>
            <select class="form-input" id="et-day">
              ${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${i+1 === first.start_day ? 'selected' : ''}>${i+1}</option>`).join('')}
              <option value="aberto" ${first.start_day === 30 ? '' : ''}>Em aberto</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Forma de pagamento</label>
            <select class="form-input" id="et-method">
              <option value="pix" ${first.payment_method === 'pix' ? 'selected' : ''}>Pix</option>
              <option value="cartao" ${first.payment_method === 'cartao' ? 'selected' : ''}>Cartão</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Primeira parcela</label>
            <select class="form-input" id="et-offset">
              <option value="0" ${first.start_month_offset === 0 ? 'selected' : ''}>Mês da venda</option>
              <option value="1" ${first.start_month_offset !== 0 ? 'selected' : ''}>Mês seguinte</option>
            </select>
          </div>
          <button class="btn-primary" onclick="saveEditTransaction()">Salvar alterações</button>
          <button onclick="confirmDeleteTransaction('${ids.join(',')}')" style="width:100%;padding:12px;background:none;border:1px solid #A32D2D;border-radius:10px;color:#A32D2D;font-size:14px;cursor:pointer;margin-top:8px">Excluir venda</button>
          <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
        </div>
      </div>`;
    }
  }

  if (state.modal === 'deleteTransaction') {
    const ids = state._deleteTransactionIds?.split(',') || [];
    const txSales = ids.map(id => state.sales.find(s => s.id === id)).filter(Boolean);
    const txTotal = txSales.reduce((a, s) => a + s.total, 0);
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Excluir venda?</div>
        <div class="modal-subtitle">${txSales.length} ${txSales.length === 1 ? 'produto' : 'produtos'} · R$ ${txTotal.toLocaleString('pt-BR')}</div>
        <div style="margin:12px 0">
          ${txSales.map(s => `<div style="font-size:13px;color:#555;padding:3px 0">• ${s.description} — R$ ${s.total}</div>`).join('')}
        </div>
        <div style="font-size:13px;color:#A32D2D;text-align:center;padding:8px 0">Esta ação não pode ser desfeita. A venda, parcelas e pagamentos serão removidos permanentemente.</div>
        <button onclick="executeDeleteTransaction()" style="width:100%;padding:12px;background:#A32D2D;border:none;border-radius:10px;color:white;font-size:14px;font-weight:600;cursor:pointer;margin:8px 0">Confirmar exclusão</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'agendaDetail' && state._agendaDetailId) {
    const evt = getAgendaEvents().find(e => e.id === state._agendaDetailId);
    if (evt) {
      const [ey, em, ed] = evt.date.split('-').map(Number);
      const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="modal-title">${evt.title}</div>
          <div style="margin:12px 0;font-size:14px;color:#666">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0"><span>📅 Data</span><span style="color:#1a1a1a">${ed} de ${meses[em-1]} de ${ey}</span></div>
            ${evt.time ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0"><span>⏰ Horário</span><span style="color:#1a1a1a">${evt.time}</span></div>` : ''}
            ${evt.location ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0"><span>📍 Local</span><span style="color:#1a1a1a">${evt.location}</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:8px 0"><span>Status</span><span style="color:${evt.done ? '#3B6D11' : '#D4537E'};font-weight:500">${evt.done ? '✅ Concluído' : '⏳ Pendente'}</span></div>
          </div>
          <button class="btn-primary" onclick="toggleAgendaDone('${evt.id}');closeModal()" style="margin-bottom:8px">${evt.done ? 'Marcar como pendente' : 'Marcar como concluído'}</button>
          <button onclick="state.modal='agendaDeleteConfirm';render()" style="width:100%;padding:12px;background:none;border:1px solid #A32D2D;border-radius:10px;color:#A32D2D;font-size:14px;cursor:pointer;margin-bottom:8px">Excluir compromisso</button>
          <button class="btn-cancel" onclick="closeModal()">Fechar</button>
        </div>
      </div>`;
    }
  }

  if (state.modal === 'agendaDeleteConfirm') {
    return `<div class="modal-overlay" onclick="state.modal='agendaDetail';render()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Excluir compromisso?</div>
        <div class="modal-subtitle">Esta ação não pode ser desfeita.</div>
        <button onclick="confirmDeleteAgenda()" style="width:100%;padding:12px;background:#A32D2D;border:none;border-radius:10px;color:white;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px">Confirmar exclusão</button>
        <button class="btn-cancel" onclick="state.modal='agendaDetail';render()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'agendaChargeGroup' && state._agendaChargeData) {
    const { contactId } = state._agendaChargeData;
    const contact = getContact(contactId);
    if (contact) {
      const sel = state.agendaDate || new Date();
      const dayEvents = getAgendaDayEvents(sel);
      const chargeEvt = dayEvents.find(e => e.type === 'cobranca' && e.contact?.id === contactId);
      if (chargeEvt) {
        const charges = chargeEvt.charges;
        const total = chargeEvt.totalDue;
        const descs = charges.map(c => c.sale.description);
        const uniqueDescs = [...new Set(descs)];
        const day = charges[0]?.sale.start_day || '';
        const msg = `Oiiii😍\nTudo bem?\nEstou enviando o valor do seu pix de hoje!\n\nValor a pagar hoje: R$ ${total}\nVencimento todo dia: ${day}\n\nNome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\nObrigada! 💖`;
        const wppUrl = `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
        return `<div class="modal-overlay" onclick="closeModal()">
          <div class="modal-sheet" onclick="event.stopPropagation()">
            <div class="modal-title">${contact.name}</div>
            <div class="modal-subtitle">${charges.length} parcela${charges.length !== 1 ? 's' : ''} · Dia ${day}</div>
            <div style="margin:8px 0">
              ${uniqueDescs.map(d => `<div style="font-size:14px;color:#555;padding:3px 0">• ${d}</div>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:600;color:#1a1a1a;border-top:1px solid #f0f0f0;margin-top:8px">
              <span>Total hoje</span><span>R$ ${total}</span>
            </div>
            <button onclick="agendaCobrarGrupo('${contactId}')" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;background:#25D366;border:none;border-radius:10px;color:white;font-size:14px;font-weight:500;cursor:pointer;margin:8px 0"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> Cobrar agora</button>
            <button class="btn-cancel" onclick="closeModal()">Fechar</button>
          </div>
        </div>`;
      }
    }
  }

  if (state.modal === 'agendaCharge' && state._agendaChargeData) {
    const { saleId, contactId } = state._agendaChargeData;
    const sale = state.sales.find(s => s.id === saleId);
    const contact = getContact(contactId);
    if (sale && contact) {
      const parcels = getSaleParcels(sale);
      const nextPending = parcels.find(p => !p.paid);
      const mesesAbr = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      const dataCompra = new Date(sale.created_at);
      // Find all sales in same transaction
      const txSales = state.sales.filter(s => {
        const t1 = new Date(sale.created_at), t2 = new Date(s.created_at);
        return s.contact_id === contactId && t1.getFullYear() === t2.getFullYear() && t1.getMonth() === t2.getMonth() && t1.getDate() === t2.getDate() && t1.getHours() === t2.getHours() && t1.getMinutes() === t2.getMinutes();
      });
      const txTotal = txSales.reduce((a, s) => a + s.total, 0);
      const msg = getWhatsappMsg(contact, nextPending || parcels[0], sale);
      const wppUrl = `https://wa.me/${contact.phone}?text=${encodeURIComponent(msg)}`;
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="modal-title">${contact.name}</div>
          <div class="modal-subtitle">${dataCompra.getDate()}/${mesesAbr[dataCompra.getMonth()]}/${dataCompra.getFullYear()} · ${sale.payment_method === 'pix' ? 'Pix' : 'Cartão'}</div>
          <div style="margin:8px 0">
            ${txSales.map(s => `<div style="font-size:14px;color:#555;padding:4px 0">• ${s.description} — R$ ${s.total}</div>`).join('')}
          </div>
          <div style="margin:12px 0;font-size:14px;color:#666">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Total da venda</span><span style="color:#1a1a1a;font-weight:600">R$ ${txTotal}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Parcelas</span><span style="color:#1a1a1a">${sale.parcels}x de R$ ${Math.round(txTotal / sale.parcels * 100) / 100}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Vencimento</span><span style="color:#1a1a1a">Todo dia ${sale.start_day}</span></div>
            ${nextPending ? `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>Próxima parcela</span><span style="color:#D4537E;font-weight:600">R$ ${nextPending.remaining} · ${nextPending.dateStr}</span></div>` : ''}
          </div>
          ${nextPending && sale.payment_method === 'pix' ? `<button onclick="agendaCobrarAgora('${sale.id}',${nextPending.index},'${wppUrl}')" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;background:#25D366;border:none;border-radius:10px;color:white;font-size:14px;font-weight:500;cursor:pointer;margin-bottom:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> Cobrar agora</button>` : ''}
          <button class="btn-cancel" onclick="closeModal()">Fechar</button>
        </div>
      </div>`;
    }
  }

  if (state.modal === 'addAgenda') {
    const d = state.agendaDate || new Date();
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const dateLabel = `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Novo compromisso</div>
        <div class="modal-subtitle">📅 ${dateLabel}</div>
        <div class="form-group"><label class="form-label">Título</label><input class="form-input" id="agenda-title" placeholder="Ex: Visitar cliente" autofocus /></div>
        <div class="form-group"><label class="form-label">Horário (opcional)</label><input class="form-input" id="agenda-time" type="time" /></div>
        <div class="form-group"><label class="form-label">Local (opcional)</label><input class="form-input" id="agenda-location" placeholder="Ex: UBS Central" /></div>
        <button class="btn-primary" onclick="addAgendaEvent()">Adicionar</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'birthdays') {
    const today = new Date();
    const todayM = today.getMonth() + 1;
    const todayD = today.getDate();
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const bdays = state.contacts.filter(c => {
      if (!c.birthday) return false;
      const [y, m, d] = c.birthday.split('-').map(Number);
      return m === todayM && d === todayD;
    });

    // Upcoming birthdays (next 30 days, excluding today)
    const upcoming = state.contacts.filter(c => {
      if (!c.birthday) return false;
      const [y, m, d] = c.birthday.split('-').map(Number);
      if (m === todayM && d === todayD) return false;
      const thisYear = today.getFullYear();
      let next = new Date(thisYear, m - 1, d);
      if (next < today) next = new Date(thisYear + 1, m - 1, d);
      const diff = (next - today) / (1000 * 60 * 60 * 24);
      return diff <= 30 && diff > 0;
    }).map(c => {
      const [y, m, d] = c.birthday.split('-').map(Number);
      const thisYear = today.getFullYear();
      let next = new Date(thisYear, m - 1, d);
      if (next < today) next = new Date(thisYear + 1, m - 1, d);
      return { ...c, nextBday: next, daysUntil: Math.ceil((next - today) / (1000 * 60 * 60 * 24)) };
    }).sort((a, b) => a.daysUntil - b.daysUntil);

    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh">
        <div class="modal-title">🎂 Aniversários</div>
        ${bdays.length > 0 ? `
          <div class="modal-subtitle">Hoje</div>
          ${bdays.map(c => {
            const [y] = c.birthday.split('-');
            const age = today.getFullYear() - parseInt(y);
            const ci = getColorIndex(c.id);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f5f5f5">
              <div class="avatar" style="width:40px;height:40px;font-size:13px;background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(c.name)}</div>
              <div style="flex:1">
                <div style="font-size:15px;font-weight:500;color:#1a1a1a">${c.name}</div>
                <div style="font-size:12px;color:#aaa">${age} anos</div>
              </div>
              <button onclick="sendBdayAndMark('${c.id}','${c.phone}');closeModal()" style="padding:6px 12px;background:#25D366;border:none;border-radius:8px;color:white;font-size:12px;font-weight:500;cursor:pointer">Felicitar 💖</button>
            </div>`;
          }).join('')}
        ` : '<div style="text-align:center;color:#aaa;padding:12px 0;font-size:14px">Nenhum aniversário hoje</div>'}

        ${upcoming.length > 0 ? `
          <div class="modal-subtitle" style="margin-top:16px">Próximos 30 dias</div>
          ${upcoming.map(c => {
            const [y, m, d] = c.birthday.split('-').map(Number);
            const age = today.getFullYear() - parseInt(y) + (c.nextBday.getFullYear() > today.getFullYear() ? 1 : 0);
            const ci = getColorIndex(c.id);
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f5f5f5">
              <div class="avatar" style="width:36px;height:36px;font-size:12px;background:${COLORS[ci]};color:${TEXT_COLORS[ci]}">${getInitials(c.name)}</div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:500;color:#1a1a1a">${c.name}</div>
                <div style="font-size:12px;color:#aaa">${d}/${meses[m-1]} · ${age} anos</div>
              </div>
              <div style="font-size:12px;color:#D4537E;font-weight:500">${c.daysUntil === 1 ? 'Amanhã' : 'em ' + c.daysUntil + ' dias'}</div>
            </div>`;
          }).join('')}
        ` : ''}
        <button class="btn-cancel" onclick="closeModal()">Fechar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'vendasDia') {
    const today = new Date();
    const vendasHoje = state.sales.filter(s => {
      const d = new Date(s.created_at);
      return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });
    const totalHoje = vendasHoje.reduce((a, s) => a + s.total, 0);
    // Group by transaction
    const txGroups = {};
    vendasHoje.forEach(s => {
      const t = new Date(s.created_at);
      const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}`;
      if (!txGroups[key]) txGroups[key] = { sales: [], contact: getContact(s.contact_id) };
      txGroups[key].sales.push(s);
    });
    const txList = Object.values(txGroups);
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh">
        <div class="modal-title">Vendas do dia</div>
        <div class="modal-subtitle">${txList.length} venda${txList.length !== 1 ? 's' : ''} · ${vendasHoje.length} ${vendasHoje.length !== 1 ? 'itens' : 'item'} · Total: R$ ${totalHoje.toLocaleString('pt-BR')}</div>
        ${txList.length === 0 ? '<div style="text-align:center;color:#aaa;padding:24px 0;font-size:14px">Nenhuma venda registrada hoje.</div>' : `
          <div style="margin-top:8px">
            ${txList.map(tx => {
              const txTotal = tx.sales.reduce((a, s) => a + s.total, 0);
              const first = tx.sales[0];
              return `<div style="padding:12px 0;border-bottom:1px solid #f5f5f5">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="font-size:15px;font-weight:500;color:#1a1a1a">${tx.contact?.name || '—'}</div>
                  <div style="font-size:16px;font-weight:600;color:#1a1a1a">R$ ${txTotal.toLocaleString('pt-BR')}</div>
                </div>
                <div style="font-size:12px;color:#888;margin-top:2px">${tx.sales.length} ${tx.sales.length > 1 ? 'itens' : 'item'} · ${first.parcels}x · ${first.payment_method === 'pix' ? 'Pix' : 'Cartão'} · Dia ${first.start_day}</div>
                ${tx.sales.map(s => `<div style="font-size:13px;color:#555;margin-top:4px">• ${s.description} — R$ ${s.total}</div>`).join('')}
              </div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;padding:16px 0 4px;font-size:16px;font-weight:600;color:#1a1a1a;border-top:2px solid #1a1a1a;margin-top:4px">
            <span>Total</span>
            <span>R$ ${totalHoje.toLocaleString('pt-BR')}</span>
          </div>
        `}
        <button class="btn-cancel" onclick="closeModal()">Fechar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'txPaid' && state._txPaidModal) {
    const tp = state._txPaidModal;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Registrar parcela</div>
        <div class="modal-subtitle">Valor da parcela: R$ ${tp.totalAmount.toLocaleString('pt-BR')}</div>
        <button class="btn-primary" onclick="confirmTransactionPaid()">Pagar R$ ${tp.totalAmount} (parcela completa)</button>
        <div style="text-align:center;color:#aaa;font-size:13px;padding:8px 0">ou valor parcial:</div>
        <div class="form-group">
          <input class="form-input" id="tx-paid-amount" type="number" inputmode="decimal" placeholder="Valor pago" />
        </div>
        <button class="btn-primary" style="background:#666" onclick="confirmTransactionPartial()">Registrar valor parcial</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'fullPayment' && state._fullPayment) {
    const fp = state._fullPayment;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Registrar pagamento</div>
        <div class="modal-subtitle">${fp.contactName} · Total pendente: R$ ${fp.totalPending.toLocaleString('pt-BR')}</div>
        <div style="font-size:12px;color:#aaa;margin-bottom:12px">${fp.pendingParcels.length} parcela${fp.pendingParcels.length !== 1 ? 's' : ''} pendente${fp.pendingParcels.length !== 1 ? 's' : ''} · O valor será distribuído nas parcelas mais antigas primeiro.</div>
        <div class="form-group">
          <label class="form-label">Valor pago (R$)</label>
          <input class="form-input" id="full-pay-amount" type="number" inputmode="decimal" placeholder="Ex: 500" autofocus />
        </div>
        <button class="btn-primary" onclick="confirmFullPayment()">Registrar pagamento</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'groupPayment' && state._groupPayment) {
    const gp = state._groupPayment;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Registrar pagamento</div>
        <div class="modal-subtitle">${gp.contactName} · Total pendente: R$ ${gp.totalPending.toLocaleString('pt-BR')}</div>
        <div class="form-group">
          <label class="form-label">Valor pago (R$)</label>
          <input class="form-input" id="group-pay-amount" type="number" inputmode="decimal" placeholder="Ex: 100" autofocus />
        </div>
        <button class="btn-primary" onclick="confirmGroupPayment()">Registrar pagamento</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'groupReminderDays') {
    const rem = state._reminderGroupRemaining || 0;
    return `<div class="modal-overlay">
      <div class="modal-sheet">
        <div class="modal-title">Pagamento parcial registrado</div>
        <div class="modal-subtitle">Ainda faltam R$ ${rem.toLocaleString('pt-BR')}. Em quantos dias deseja ser relembrada?</div>
        <div class="form-group">
          <select class="form-input" id="group-reminder-days">
            <option value="1">1 dia</option>
            <option value="2">2 dias</option>
            <option value="3">3 dias</option>
            <option value="5" selected>5 dias</option>
            <option value="7">7 dias</option>
            <option value="10">10 dias</option>
            <option value="15">15 dias</option>
            <option value="30">30 dias</option>
          </select>
        </div>
        <button class="btn-primary" onclick="confirmGroupReminder()">Confirmar</button>
        <button class="btn-cancel" onclick="closeModal()">Pular</button>
      </div>
    </div>`;
  }

  if (state.modal === 'reminderDays') {
    const rem = state._reminderRemaining || 0;
    return `<div class="modal-overlay">
      <div class="modal-sheet">
        <div class="modal-title">Pagamento parcial registrado</div>
        <div class="modal-subtitle">Ainda faltam R$ ${rem.toLocaleString('pt-BR')} para quitar esta parcela. Em quantos dias deseja ser relembrada de cobrar?</div>
        <div class="form-group">
          <select class="form-input" id="reminder-days">
            <option value="1">1 dia</option>
            <option value="2">2 dias</option>
            <option value="3">3 dias</option>
            <option value="5" selected>5 dias</option>
            <option value="7">7 dias</option>
            <option value="10">10 dias</option>
            <option value="15">15 dias</option>
            <option value="30">30 dias</option>
          </select>
        </div>
        <button class="btn-primary" onclick="confirmReminder()">Confirmar</button>
        <button class="btn-cancel" onclick="closeModal()">Pular</button>
      </div>
    </div>`;
  }

  if (state.modal === 'adiar' && state.modalExtra) {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Adiar cobrança</div>
        <div class="modal-subtitle">Por quantos dias deseja adiar?</div>
        <div class="form-group">
          <select class="form-input" id="adiar-days">
            ${Array.from({length:30},(_,i)=>`<option value="${i+1}">${i+1} dia${i>0?'s':''}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary" onclick="confirmAdiar()">Confirmar</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'finDetail' && state.modalExtra) {
    const sale = state.sales.find(s => s.id === state.modalExtra);
    if (sale) {
      const contact = getContact(sale.contact_id);
      const parcels = getSaleParcels(sale);
      const dataCompra = new Date(sale.created_at);
      const mesesAbr = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      return `<div class="modal-overlay" onclick="closeModal()">
        <div class="modal-sheet" onclick="event.stopPropagation()">
          <div class="modal-title">${contact?.name || '—'}</div>
          <div class="modal-subtitle">${sale.description} · ${sale.category === 'joia' ? 'Jóia' : sale.category === 'marykay' ? 'Mary Kay' : ''}</div>
          <div style="margin:12px 0;font-size:14px;color:#666">
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Data da compra</span><span style="color:#1a1a1a">${dataCompra.getDate()}/${mesesAbr[dataCompra.getMonth()]}/${dataCompra.getFullYear()}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Total</span><span style="color:#1a1a1a;font-weight:600">R$ ${sale.total}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Parcelas</span><span style="color:#1a1a1a">${sale.parcels}x de R$ ${Math.round(sale.total / sale.parcels * 100) / 100}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span>Vencimento</span><span style="color:#1a1a1a">Todo dia ${sale.start_day}</span></div>
            <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Pagamento</span><span style="color:#1a1a1a">${sale.payment_method === 'pix' ? 'Pix' : 'Cartão'}</span></div>
          </div>
          <div style="margin:8px 0;font-size:13px">
            ${parcels.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f5f5f5">
              <span>Parc. ${p.index+1}</span>
              <span>${p.dateStr}</span>
              <span class="badge ${p.paid ? 'badge-ok' : 'badge-due'}">${p.paid ? 'Pago' : 'R$ ' + p.remaining}</span>
            </div>`).join('')}
          </div>
          <button class="btn-cancel" onclick="closeModal()">Fechar</button>
        </div>
      </div>`;
    }
  }

  if (state.modal === 'financePeriod') {
    const today = new Date();
    const defaultVal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Selecionar período</div>
        <div class="form-group">
          <label class="form-label">Mês e ano</label>
          <input class="form-input" id="finance-month" type="month" value="${state.financeCustomMonth || defaultVal}" />
        </div>
        <button class="btn-primary" onclick="confirmFinancePeriod()">Confirmar</button>
        <button class="btn-cancel" onclick="closeModal()">Cancelar</button>
      </div>
    </div>`;
  }

  if (state.modal === 'setMeta') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-title">Redefinir meta mensal</div>
        <div class="modal-subtitle">Quanto você quer vender por mês?</div>
        <div class="form-group">
          <label class="form-label">Valor da meta (R$)</label>
          <input class="form-input" id="meta-value" type="number" inputmode="decimal" placeholder="Ex: 20000" value="${state.metaMensal || ''}" />
        </div>
        <button class="btn-primary" onclick="confirmMeta()">Confirmar</button>
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
        <div class="form-group"><label class="form-label">Data de nascimento</label><input class="form-input" id="nc-birthday" type="tel" inputmode="numeric" placeholder="DD/MM/AAAA" maxlength="10" oninput="maskDate(this)" /></div>
        <div class="form-group"><label class="form-label">CPF</label><input class="form-input" id="nc-cpf" type="tel" placeholder="000.000.000-00" inputmode="numeric" /></div>
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
        <div class="form-group"><label class="form-label">Data de nascimento</label><input class="form-input" id="ec-birthday" type="tel" inputmode="numeric" placeholder="DD/MM/AAAA" maxlength="10" oninput="maskDate(this)" value="${formatDateToMask(c.birthday)}" /></div>
        <div class="form-group"><label class="form-label">CPF</label><input class="form-input" id="ec-cpf" type="tel" placeholder="000.000.000-00" inputmode="numeric" value="${c.cpf || ''}" /></div>
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

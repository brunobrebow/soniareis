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
  metaMensal: parseFloat(localStorage.getItem('srcrm_meta') || '20000')
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
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const nc = await DB.addContact({ name, local: local || '', phone: '55' + phone });
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
  if (!name || !phone) { showToast('Nome e WhatsApp são obrigatórios', '#A32D2D'); return; }
  try {
    const updated = await DB.updateContact(id, { name, local: local || '', phone: '55' + phone });
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
  const day = parseInt(document.getElementById('pdv-day')?.value);
  const method = document.querySelector('input[name="pdv-method"]:checked')?.value || 'pix';
  const totalDiscount = parseFloat(document.getElementById('pdv-total-discount')?.value) || 0;
  if (!contactId) { showToast('Selecione a cliente', '#A32D2D'); return; }
  if (!parcelsRaw) { showToast('Selecione o número de parcelas', '#A32D2D'); return; }
  if (!day) { showToast('Selecione o dia de cobrança', '#A32D2D'); return; }

  state._pdvReview = { contactId, parcelsRaw, day, method, totalDiscount };
  state.pdvStep = 'review';
  render();
}

async function pdvSubmit() {
  const { contactId, parcelsRaw, day, method, totalDiscount } = state._pdvReview;
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
        parcel_value: Math.round(itemFinal / parcels),
        start_day: day,
        payment_method: method,
        category: item.category
      });
      state.sales.push(newSale);
      const newPayments = await DB.initPayments(newSale.id, parcels);
      state.payments.push(...newPayments);
      items.push({ ...item, total: itemFinal, originalTotal: itemGross, itemDiscount: itemPerDiscount, parcel_value: Math.round(itemFinal / parcels) });
    }

    state.pdvResult = { items, contact, parcels, day, method, total, discount: totalDiscount, isAberto };
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
  const parcelVal = Math.round(r.total / r.parcels);
  const rawSub = r.items.reduce((a, i) => a + i.value * (i.qty || 1), 0);
  const itemDiscTotal = r.items.reduce((a, i) => a + (i.itemDiscount || 0), 0);
  const hasDiscount = itemDiscTotal > 0 || r.discount > 0;
  let msg = `*Resumo da compra*\n\n`;
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
  msg += `Vencimento: todo dia ${r.day}\n`;
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
    const opts = `<option value="" disabled ${!selId ? 'selected' : ''}>Selecione a cliente</option>` + state.contacts.map(c => `<option value="${c.id}" ${c.id === selId ? 'selected' : ''}>${c.name}</option>`).join('');
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
            </select>
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
    const pv = Math.round(finalTotal / parcels);

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
              <span class="pdv-review-info-value">Dia ${rv.day}</span>
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
    const pv = Math.round(r.total / r.parcels);
    return `<div class="pdv-overlay">
      ${topbar('exitPDV()', 'Venda registrada')}
      <div class="pdv-success-scroll">
        <div class="pdv-success-icon">✓</div>
        <div class="pdv-success-title">Venda registrada!</div>
        <div class="pdv-receipt">
          <div class="pdv-receipt-hero">
            <div class="pdv-receipt-day">Dia ${r.day}</div>
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

  // Get pending parcels grouped by sale
  const pendingSales = cSales.filter(s => getSaleParcels(s).some(p => !p.paid));
  if (pendingSales.length === 0) {
    showToast('Nenhuma parcela pendente!', '#3B6D11');
    return;
  }

  let msg = `Oiiii😍\nTudo bem?\nSegue o resumo das suas parcelas:\n\n`;

  pendingSales.forEach(s => {
    const parcels = getSaleParcels(s);
    const nextPending = parcels.find(p => !p.paid);
    if (!nextPending) return;
    const remaining = nextPending.remaining || nextPending.amount;
    msg += `📌 Pagar todo dia *${s.start_day}*\nValor da parcela: *R$ ${remaining}*\n\n`;
  });

  msg += `Nome do Pix: ${CONFIG.pixNome}\nChave PIX celular: ${CONFIG.pixChave}\n\n`;
  msg += `Qualquer dúvida é só me chamar! 💖`;

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
  const parcelVal = Math.round(total / parcelsNum);

  let msg = `*Resumo da compra*\n\n`;
  txSales.forEach(s => {
    msg += `• ${s.description} (${s.category === 'joia' ? 'Jóia' : 'Mary Kay'}) — R$ ${s.total.toLocaleString('pt-BR')}\n`;
  });
  msg += `\n*Total: R$ ${total.toLocaleString('pt-BR')}*\n`;
  msg += parcelsNum === 1 && txSales[0].parcels === 1 ? `*Em aberto*\n` : `*${parcelsNum}x de R$ ${parcelVal.toLocaleString('pt-BR')}*\n`;
  msg += `Vencimento: todo dia ${day}\n`;
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
  const pendentesMes = mesCharges.filter(c => !c.isPast).reduce((a, c) => a + c.parcel.amount, 0);

  const lateCharges = getDueCharges('atrasado');
  const todayCharges = getDueCharges('hoje');
  const atrasadoTotal = lateCharges.reduce((a, c) => a + c.parcel.amount, 0);
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

      <div class="home-card home-card-main">
        <div class="home-card-row">
          <div>
            <div class="home-card-label">Meta mensal</div>
            <div class="home-card-big" style="color:#1a1a1a">R$ ${vendasMes.toLocaleString('pt-BR')}</div>
          </div>
          <div style="text-align:right">
            <div class="home-card-label">Meta</div>
            <div class="home-card-big" style="color:#888">R$ ${state.metaMensal.toLocaleString('pt-BR')}</div>
          </div>
        </div>
        <div class="home-progress-bg">
          <div class="home-progress-fill" style="width:${Math.min(100, Math.round(vendasMes / state.metaMensal * 100))}%"></div>
        </div>
        <div class="home-progress-bg" style="margin-top:4px">
          <div class="home-progress-fill home-progress-day" style="width:${Math.round(diaNum / new Date(anoAtual, mesAtual + 1, 0).getDate() * 100)}%"></div>
        </div>
        <div class="home-card-row" style="margin-top:4px">
          <span class="home-card-sub">${Math.round(vendasMes / state.metaMensal * 100)}% da meta · dia ${diaNum}/${new Date(anoAtual, mesAtual + 1, 0).getDate()}</span>
          <span class="home-card-sub home-meta-link" onclick="setMeta()">Redefinir meta</span>
        </div>
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
                <div class="home-day-stat-num">${vendasHoje.length}</div>
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
                ${sale.payment_method === 'cartao' ? `
                  <span class="charge-cartao-tag">💳 Cartão</span>
                ` : `
                  <button class="btn-cobrar" onclick="openWpp('${wppUrl}')">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                    Cobrar
                  </button>
                `}
                <button class="btn-pago" onclick="openPaidModal('${sale.id}',${parcel.index})">Registrar pgto</button>
              </div>
            </div>`;
        }).join('')}
      `).join('')}
    </div>`;
}

function renderFinanceiro() {
  const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const today = new Date();
  let filterMonth, filterYear, periodLabel;

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
      if (!p.paid && p.date.getMonth() === filterMonth && p.date.getFullYear() === filterYear) {
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
    paidInPeriod.forEach(p => {
      const sale = state.sales.find(s => s.id === p.sale_id);
      if (!sale) return;
      const contact = getContact(sale.contact_id);
      transactions.push({
        name: contact?.name?.split(' ').slice(0, 2).join(' ') || '—',
        desc: sale.description,
        date: p.paid_at ? new Date(p.paid_at).toLocaleDateString('pt-BR') : '—',
        value: p.paid_amount || sale.parcel_value,
        color: '#3B6D11',
        prefix: '+'
      });
    });
    transactions.sort((a, b) => new Date(b.date.split('/').reverse().join('-')) - new Date(a.date.split('/').reverse().join('-')));
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
        prefix: ''
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
        prefix: ''
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
        <button class="filter-tab ${state.financePeriod === 'custom' ? 'active' : ''}" onclick="setFinancePeriod('custom')">${state.financePeriod === 'custom' ? periodLabel : 'Selecionar período'}</button>
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
        ${transactions.map(t => `
          <div class="fin-transaction">
            <div class="fin-tx-left">
              <div class="fin-tx-name">${t.name}</div>
              <div class="fin-tx-desc">${t.desc}</div>
            </div>
            <div class="fin-tx-right">
              <div class="fin-tx-value" style="color:${t.color}">${t.prefix}R$ ${t.value.toLocaleString('pt-BR')}</div>
              <div class="fin-tx-date">${t.date}</div>
            </div>
          </div>
        `).join('')}
      </div>
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
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="sendContactResumo('${c.id}')" style="flex:2;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;background:#25D366;border:none;border-radius:10px;color:white;font-size:14px;font-weight:500;cursor:pointer"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.49a.75.75 0 00.914.914l4.456-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.34 0-4.508-.758-6.26-2.04l-.438-.33-3.222 1.08 1.08-3.222-.33-.438A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> Enviar resumo</button>
          <button onclick="sendContactSummary('${c.id}')" style="flex:1;padding:11px;background:none;border:1px solid #25D366;border-radius:10px;color:#25D366;font-size:13px;font-weight:500;cursor:pointer">Histórico</button>
        </div>
        <button onclick="openModal('editContact','${c.id}')" style="width:100%;padding:10px;background:none;border:1px solid #e0e0e0;border-radius:10px;color:#666;font-size:14px;cursor:pointer;margin-top:8px">✏️ Editar dados</button>
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
            return `
              <div class="transaction-group">
                <div class="transaction-header">
                  <div>
                    <div style="font-size:13px;color:#888">${g.date} · ${g.sales.length} ${g.sales.length === 1 ? 'item' : 'itens'}</div>
                    <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-top:2px">R$ ${gTotal.toLocaleString('pt-BR')}</div>
                  </div>
                  <button onclick="sendTransactionSummary('${c.id}','${g.ids.join(',')}')" style="background:#25D366;border:none;border-radius:8px;color:white;font-size:11px;padding:6px 10px;cursor:pointer;white-space:nowrap">📩 Enviar</button>
                </div>
                ${g.sales.map(s => {
                  const parcels = getSaleParcels(s);
                  return `
                    <div class="sale-item" style="margin-top:8px">
                      <div class="sale-desc">${s.description}</div>
                      <div class="sale-meta">R$ ${s.total} · ${s.parcels}x R$ ${s.parcel_value} · ${s.payment_method === 'pix' ? 'Pix' : 'Cartão'}</div>
                      <div style="margin-top:8px">
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

  if (state.modal === 'vendasDia') {
    const today = new Date();
    const vendasHoje = state.sales.filter(s => {
      const d = new Date(s.created_at);
      return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });
    const totalHoje = vendasHoje.reduce((a, s) => a + s.total, 0);
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh">
        <div class="modal-title">Vendas do dia</div>
        <div class="modal-subtitle">${vendasHoje.length} venda${vendasHoje.length !== 1 ? 's' : ''} · Total: R$ ${totalHoje.toLocaleString('pt-BR')}</div>
        ${vendasHoje.length === 0 ? '<div style="text-align:center;color:#aaa;padding:24px 0;font-size:14px">Nenhuma venda registrada hoje.</div>' : `
          <div style="margin-top:8px">
            ${vendasHoje.map(s => {
              const contact = getContact(s.contact_id);
              return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f5f5f5">
                <div style="flex:1;min-width:0">
                  <div style="font-size:15px;font-weight:500;color:#1a1a1a">${s.description}</div>
                  <div style="font-size:13px;color:#888;margin-top:2px">${contact?.name || '—'} · ${s.parcels}x R$ ${s.parcel_value} · ${s.payment_method === 'pix' ? 'Pix' : 'Cartão'}${s.category ? ' · ' + (s.category === 'joia' ? 'Jóia' : 'Mary Kay') : ''}</div>
                </div>
                <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-left:12px">R$ ${s.total.toLocaleString('pt-BR')}</div>
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

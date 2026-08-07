// db.js — toda comunicação com o Supabase fica aqui
// Se um dia trocar de banco, só muda este arquivo.

let _client = null;

function getClient() {
  if (!_client) {
    const { createClient } = window.supabase;
    _client = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
  }
  return _client;
}

const DB = {

  // ---------- CONTACTS ----------

  async getContacts() {
    const { data, error } = await getClient()
      .from('contacts')
      .select('*')
      .order('name');
    if (error) throw error;
    return data;
  },

  async addContact(contact) {
    const { data, error } = await getClient()
      .from('contacts')
      .insert([contact])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateContact(id, updates) {
    const { data, error } = await getClient()
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteContact(id) {
    const { error } = await getClient()
      .from('contacts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ---------- SALES ----------

  async getSales() {
    const { data, error } = await getClient()
      .from('sales')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Postgres 'numeric' columns return as strings — coerce to numbers
    return (data || []).map(s => ({
      ...s,
      total: Number(s.total) || 0,
      parcel_value: Number(s.parcel_value) || 0,
      parcels: Number(s.parcels) || 1,
      start_day: Number(s.start_day) || 1,
      start_month_offset: s.start_month_offset === null || s.start_month_offset === undefined ? null : Number(s.start_month_offset)
    }));
  },

  async addSale(sale) {
    const { data, error } = await getClient()
      .from('sales')
      .insert([sale])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteSale(id) {
    const { error } = await getClient()
      .from('sales')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ---------- PAYMENTS ----------

  async getPayments() {
    const { data, error } = await getClient()
      .from('payments')
      .select('*');
    if (error) throw error;
    // Postgres 'numeric' columns return as strings — coerce to numbers
    return (data || []).map(p => ({
      ...p,
      paid_amount: Number(p.paid_amount) || 0,
      parcel_index: Number(p.parcel_index),
      paid: p.paid === true || p.paid === 'true'
    }));
  },

  async initPayments(saleId, parcels) {
    const rows = Array.from({ length: parcels }, (_, i) => ({
      sale_id: saleId,
      parcel_index: i,
      paid: false
    }));
    const { data, error } = await getClient()
      .from('payments')
      .insert(rows)
      .select();
    if (error) throw error;
    return data;
  },

  async markPaid(saleId, parcelIndex, amount, isFullPayment) {
    const updates = {
      paid: !!isFullPayment,
      paid_at: new Date().toISOString(),
      paid_amount: Number(amount) || 0
    };

    // Find ALL rows for this parcel
    const { data: rows, error: rowsErr } = await getClient()
      .from('payments')
      .select('id')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (rowsErr) throw rowsErr;

    if (rows && rows.length > 1) {
      // DUPLICATES: delete all but the first, then update the survivor
      const keepId = rows[0].id;
      const deleteIds = rows.slice(1).map(r => r.id);
      const { error: delErr } = await getClient().from('payments').delete().in('id', deleteIds);
      if (delErr) throw new Error('Não consegui limpar duplicatas: ' + delErr.message);
      const { error: updErr } = await getClient().from('payments').update(updates).eq('id', keepId);
      if (updErr) throw new Error('UPDATE falhou: ' + updErr.message);
    } else if (rows && rows.length === 1) {
      const { error: updErr } = await getClient().from('payments').update(updates).eq('id', rows[0].id);
      if (updErr) throw new Error('UPDATE falhou: ' + updErr.message);
    } else {
      const { error: insErr } = await getClient()
        .from('payments').insert({ sale_id: saleId, parcel_index: parcelIndex, ...updates });
      if (insErr) throw new Error('INSERT falhou: ' + insErr.message);
    }

    // VERIFY with a FRESH connection (proves the write committed, not just read-your-own-write)
    let freshClient;
    try {
      const { createClient } = window.supabase;
      freshClient = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
    } catch (e) {
      freshClient = getClient();
    }
    // Retry a couple times in case of read-replica lag
    let check = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error: checkErr } = await freshClient
        .from('payments')
        .select('*')
        .eq('sale_id', saleId)
        .eq('parcel_index', parcelIndex);
      if (checkErr) throw checkErr;
      if (data && data.length >= 1 && Math.round(Number(data[0].paid_amount) || 0) === Math.round(Number(amount) || 0)) {
        check = data;
        break;
      }
      check = data;
      if (attempt < 2) await new Promise(r => setTimeout(r, 400));
    }
    if (!check || check.length === 0) {
      throw new Error(`GRAVAÇÃO NÃO COMMITOU: escrevi R$${amount} mas conexão nova não acha a linha. Problema no Supabase.`);
    }
    if (check.length > 1) {
      throw new Error(`Ainda há ${check.length} linhas duplicadas após gravar.`);
    }
    if (Math.round(Number(check[0].paid_amount) || 0) !== Math.round(Number(amount) || 0)) {
      throw new Error(`NÃO PERSISTIU: conexão nova mostra R$${check[0].paid_amount} em vez de R$${amount} (após 3 tentativas).`);
    }
    return check[0];
  },

  async rawPersistTest(saleId, parcelIndex) {
    const client = getClient();
    let log = [];
    // Read current
    const { data: before } = await client.from('payments').select('*').eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    log.push(`ANTES: ${before ? before.length : 0} linha(s), amt=${before && before[0] ? before[0].paid_amount : '?'}`);
    if (!before || before.length === 0) { log.push('Sem linha — pulando'); return log.join('\n'); }
    if (before.length > 1) log.push(`⚠️ ${before.length} DUPLICATAS nesta parcela!`);
    const rowId = before[0].id;

    // UPDATE with value 77
    const { data: updData, error: updErr } = await client
      .from('payments').update({ paid_amount: 77 }).eq('id', rowId).select();
    if (updErr) {
      log.push(`UPDATE ERRO: ${updErr.message}`);
      return log.join('\n');
    }
    log.push(`UPDATE retornou: ${updData ? updData.length : 0} linha(s)${updData && updData[0] ? ', amt=' + updData[0].paid_amount : ' — VAZIO (RLS bloqueou UPDATE silenciosamente!)'}`);

    // Create a BRAND NEW client (simulates closing/reopening the app)
    const { createClient } = window.supabase;
    const freshClient = createClient(CONFIG.supabase.url, CONFIG.supabase.key);
    const { data: freshRead } = await freshClient.from('payments').select('*').eq('id', rowId);
    const freshVal = freshRead && freshRead[0] ? Number(freshRead[0].paid_amount) : null;
    log.push(`\nLEITURA NOVA (conexão nova): amt=${freshVal}`);

    // Verdict
    if (freshVal === 77) {
      log.push(`\n✅ GRAVAÇÃO PERSISTE! O banco está OK. O problema está no app.`);
    } else {
      log.push(`\n❌ NÃO PERSISTE! Escreveu 77 mas leitura nova mostra ${freshVal}. O banco (Supabase RLS) está revertendo. Precisa corrigir permissões.`);
    }

    // Restore original
    const origAmount = Number(before[0].paid_amount) || 0;
    await client.from('payments').update({ paid_amount: origAmount }).eq('id', rowId);
    log.push(`\n(valor original R$${origAmount} restaurado)`);
    return log.join('\n');
  },

  async getPaymentsForSale(saleId) {
    const { data, error } = await getClient()
      .from('payments')
      .select('*')
      .eq('sale_id', saleId)
      .order('parcel_index');
    if (error) throw error;
    return (data || []).map(p => ({
      ...p,
      paid_amount: Number(p.paid_amount) || 0,
      parcel_index: Number(p.parcel_index),
      paid: p.paid === true || p.paid === 'true'
    }));
  },

  async testWrite(saleId, parcelIndex) {
    // Read current, write a test value, read back to verify persistence
    const { data: before } = await getClient()
      .from('payments').select('*').eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    if (!before || before.length === 0) throw new Error('linha não existe no banco');
    const originalAmount = before[0].paid_amount || 0;
    const testValue = 1; // write R$1 as test
    const { error: upErr } = await getClient()
      .from('payments').update({ paid_amount: testValue }).eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    if (upErr) throw new Error('UPDATE bloqueado: ' + upErr.message);
    const { data: after } = await getClient()
      .from('payments').select('*').eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    const persisted = after && after[0] && Math.round(after[0].paid_amount) === testValue;
    // Restore original value
    await getClient().from('payments').update({ paid_amount: originalAmount }).eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    if (!persisted) throw new Error('UPDATE não persistiu (RLS ou permissão). Banco ainda mostra ' + (after && after[0] ? after[0].paid_amount : 'nada'));
    return after[0];
  },

  async ensurePaymentRows(saleId, parcels, existingIndexes) {
    // Re-fetch from DB to get the true current state (avoid duplicates)
    const { data: current, error: e0 } = await getClient()
      .from('payments')
      .select('parcel_index')
      .eq('sale_id', saleId);
    if (e0) throw e0;
    const have = new Set((current || []).map(r => r.parcel_index));
    const missing = [];
    for (let i = 0; i < parcels; i++) {
      if (!have.has(i)) missing.push({ sale_id: saleId, parcel_index: i, paid: false, paid_amount: 0 });
    }
    if (missing.length === 0) return [];
    const { data, error } = await getClient()
      .from('payments')
      .insert(missing)
      .select();
    if (error) throw error;
    return data;
  },

  async dedupePayments(saleId) {
    // Remove duplicate payment rows for a sale, keeping the one with the most paid_amount
    const { data: rows, error } = await getClient()
      .from('payments')
      .select('*')
      .eq('sale_id', saleId);
    if (error) throw error;
    const byIndex = {};
    (rows || []).forEach(r => {
      if (!byIndex[r.parcel_index]) byIndex[r.parcel_index] = [];
      byIndex[r.parcel_index].push(r);
    });
    const toDelete = [];
    Object.values(byIndex).forEach(group => {
      if (group.length > 1) {
        // Keep the row with highest paid_amount (or paid=true), delete the rest
        group.sort((a, b) => (b.paid ? 1 : 0) - (a.paid ? 1 : 0) || (b.paid_amount || 0) - (a.paid_amount || 0));
        for (let i = 1; i < group.length; i++) toDelete.push(group[i].id);
      }
    });
    if (toDelete.length > 0) {
      const { error: delErr } = await getClient().from('payments').delete().in('id', toDelete);
      if (delErr) throw delErr;
    }
    return toDelete.length;
  },

  async undoPayment(paymentId) {
    const { data, error } = await getClient()
      .from('payments')
      .update({ paid: false, paid_at: null, paid_amount: 0 })
      .eq('id', paymentId)
      .select();
    if (error) throw error;
    return data && data[0];
  },

  async undoPaymentByParcel(saleId, parcelIndex) {
    // Delete all rows for this parcel and insert one clean unpaid row
    const { error: delErr } = await getClient()
      .from('payments')
      .delete()
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (delErr) throw delErr;
    const { data, error } = await getClient()
      .from('payments')
      .insert({ sale_id: saleId, parcel_index: parcelIndex, paid: false, paid_amount: 0 })
      .select();
    if (error) throw error;
    return data && data[0];
  },

  async deleteSale(saleId) {
    await getClient().from('payments').delete().eq('sale_id', saleId);
    const { error } = await getClient().from('sales').delete().eq('id', saleId);
    if (error) throw error;
  },

  async updateSale(saleId, updates) {
    const { data, error } = await getClient()
      .from('sales')
      .update(updates)
      .eq('id', saleId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

};

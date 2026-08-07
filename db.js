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
      paid_amount: amount
    };

    // First, clean up any duplicates: keep one row, delete extras
    const { data: rows, error: rowsErr } = await getClient()
      .from('payments')
      .select('id')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (rowsErr) throw rowsErr;

    if (rows && rows.length > 1) {
      // Delete all but the first
      const idsToDelete = rows.slice(1).map(r => r.id);
      await getClient().from('payments').delete().in('id', idsToDelete);
    }

    let saved = null;
    if (rows && rows.length >= 1) {
      // UPDATE the surviving row (UPDATE is proven to work via the write test)
      const keepId = rows[0].id;
      const { data, error } = await getClient()
        .from('payments')
        .update(updates)
        .eq('id', keepId)
        .select();
      if (error) throw new Error('UPDATE falhou: ' + error.message);
      saved = data && data[0];
    } else {
      // No row exists — INSERT one
      const { data, error } = await getClient()
        .from('payments')
        .insert({ sale_id: saleId, parcel_index: parcelIndex, ...updates })
        .select();
      if (error) throw new Error('INSERT falhou: ' + error.message);
      saved = data && data[0];
    }

    // VERIFY persistence by reading back from DB
    const { data: check, error: checkErr } = await getClient()
      .from('payments')
      .select('*')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (checkErr) throw checkErr;
    if (!check || check.length === 0) {
      throw new Error('Pagamento não persistiu (nenhuma linha após gravar). Verifique permissões RLS no Supabase.');
    }
    const persisted = check[0];
    if (Math.round(Number(persisted.paid_amount) || 0) !== Math.round(amount)) {
      throw new Error(`Não persistiu: banco tem R$ ${persisted.paid_amount} em vez de R$ ${amount}. Verifique permissões de UPDATE (RLS) no Supabase.`);
    }
    return persisted;
  },

  async rawPersistTest(saleId, parcelIndex) {
    const client = getClient();
    let log = [];
    // Read current
    const { data: before } = await client.from('payments').select('*').eq('sale_id', saleId).eq('parcel_index', parcelIndex);
    log.push(`Antes: ${before ? before.length : 0} linha(s), amt=${before && before[0] ? before[0].paid_amount : '?'}`);
    if (!before || before.length === 0) { log.push('Sem linha — pulando'); return log.join('\n'); }
    const rowId = before[0].id;

    // Test UPDATE with value 7, capture the returned data AND error
    const { data: updData, error: updErr } = await client
      .from('payments').update({ paid_amount: 7 }).eq('id', rowId).select();
    if (updErr) {
      log.push(`UPDATE erro: ${updErr.message}`);
    } else {
      log.push(`UPDATE retornou: ${updData ? updData.length : 0} linha(s)` + (updData && updData[0] ? `, amt=${updData[0].paid_amount}` : ' (VAZIO = não atualizou!)'));
    }

    // Read back immediately
    const { data: afterUpd } = await client.from('payments').select('*').eq('id', rowId);
    log.push(`Releitura imediata: amt=${afterUpd && afterUpd[0] ? afterUpd[0].paid_amount : '?'}`);

    log.push(`\nGravado R$7. Se a releitura mostra 7 mas sumir ao reabrir = problema de permissão RLS no Supabase.`);
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

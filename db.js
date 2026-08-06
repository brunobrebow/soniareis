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
    return data;
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
    return data;
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
    const newRow = {
      sale_id: saleId,
      parcel_index: parcelIndex,
      paid: !!isFullPayment,
      paid_at: new Date().toISOString(),
      paid_amount: amount
    };
    // Strategy: delete any existing rows for this parcel, then insert one clean row.
    // This avoids UPDATE permission issues and eliminates duplicates atomically.
    const { error: delErr } = await getClient()
      .from('payments')
      .delete()
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (delErr) throw new Error('Não foi possível gravar (delete bloqueado): ' + delErr.message);

    const { data: inserted, error: insErr } = await getClient()
      .from('payments')
      .insert(newRow)
      .select();
    if (insErr) throw new Error('Não foi possível gravar (insert bloqueado): ' + insErr.message);

    // Verify it actually persisted
    const { data: check, error: checkErr } = await getClient()
      .from('payments')
      .select('*')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (checkErr) throw checkErr;
    if (!check || check.length === 0) {
      throw new Error('O pagamento não persistiu no banco. Verifique as permissões (RLS) da tabela payments no Supabase.');
    }
    const saved = check[0];
    if (Math.round(saved.paid_amount || 0) !== Math.round(amount)) {
      throw new Error(`Gravou R$ ${saved.paid_amount} em vez de R$ ${amount}. Verifique permissões de escrita no Supabase.`);
    }
    return saved;
  },

  async getPaymentsForSale(saleId) {
    const { data, error } = await getClient()
      .from('payments')
      .select('*')
      .eq('sale_id', saleId)
      .order('parcel_index');
    if (error) throw error;
    return data || [];
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

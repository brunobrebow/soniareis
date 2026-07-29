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
    const updates = isFullPayment
      ? { paid: true, paid_at: new Date().toISOString(), paid_amount: amount }
      : { paid: false, paid_at: new Date().toISOString(), paid_amount: amount };
    // Check if the payment row exists first
    const { data: existing, error: selErr } = await getClient()
      .from('payments')
      .select('id')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (selErr) throw selErr;
    if (!existing || existing.length === 0) {
      // Row missing — create it
      const { data, error } = await getClient()
        .from('payments')
        .insert({ sale_id: saleId, parcel_index: parcelIndex, ...updates })
        .select();
      if (error) throw error;
      return data && data[0];
    }
    // Update by id (handles duplicates safely, avoids .single() throwing)
    const targetId = existing[0].id;
    const { data, error } = await getClient()
      .from('payments')
      .update(updates)
      .eq('id', targetId)
      .select();
    if (error) throw error;
    return data && data[0];
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
      .select()
      .single();
    if (error) throw error;
    return data;
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

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
    // Paginate to avoid Supabase's 1000-row default limit
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await getClient()
        .from('contacts')
        .select('*')
        .order('name')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return allRows;
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
    // Paginate to avoid Supabase's 1000-row default limit
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await getClient()
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    // Postgres 'numeric' columns return as strings — coerce to numbers
    return allRows.map(s => ({
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
    // Supabase returns max 1000 rows by default. Paginate to get ALL payment rows.
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await getClient()
        .from('payments')
        .select('*')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    // Postgres 'numeric' columns return as strings — coerce to numbers
    return allRows.map(p => ({
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

    // Find rows for this parcel
    const { data: rows, error: rowsErr } = await getClient()
      .from('payments')
      .select('id')
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex);
    if (rowsErr) throw rowsErr;

    if (rows && rows.length > 1) {
      // Collapse any duplicates: keep first, delete the rest, update survivor
      const keepId = rows[0].id;
      const deleteIds = rows.slice(1).map(r => r.id);
      await getClient().from('payments').delete().in('id', deleteIds);
      const { data, error } = await getClient().from('payments').update(updates).eq('id', keepId).select();
      if (error) throw error;
      return data && data[0];
    } else if (rows && rows.length === 1) {
      const { data, error } = await getClient().from('payments').update(updates).eq('id', rows[0].id).select();
      if (error) throw error;
      return data && data[0];
    } else {
      const { data, error } = await getClient()
        .from('payments').insert({ sale_id: saleId, parcel_index: parcelIndex, ...updates }).select();
      if (error) throw error;
      return data && data[0];
    }
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

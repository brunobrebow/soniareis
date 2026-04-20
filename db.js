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
    const { data, error } = await getClient()
      .from('payments')
      .update(updates)
      .eq('sale_id', saleId)
      .eq('parcel_index', parcelIndex)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

};

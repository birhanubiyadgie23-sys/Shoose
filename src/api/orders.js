// LYSTRO order API — service-role credentials remain server-side.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server database configuration is incomplete.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const order = {
    customer_name: clean(body.customer_name, 120),
    phone: clean(body.phone, 30),
    service_type: clean(body.service_type, 80),
    sub_city: clean(body.sub_city, 80),
    woreda: clean(body.woreda, 80),
    address: clean(body.address, 500),
    status: 'pending',
    telegram_notification_status: 'pending'
  };
  const required = ['customer_name', 'phone', 'service_type', 'sub_city', 'woreda', 'address'];
  if (required.some((key) => !order[key])) {
    return res.status(400).json({ error: 'Please complete all required booking fields.' });
  }
  if (!/^[+0-9() -]{7,30}$/.test(order.phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/orders', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(order)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('Supabase order insert failed:', response.status, result?.message || result?.code || 'Unknown error');
      return res.status(502).json({ error: 'Order could not be saved. Please try again later.' });
    }
    return res.status(201).json({ success: true, order: Array.isArray(result) ? result[0] : result });
  } catch (error) {
    console.error('Order API error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'A server error occurred while saving the order.' });
  }
};

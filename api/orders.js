// LYSTRO order API — privileged credentials remain server-side.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\\/+$/, '').replace(/\\/rest\\/v1$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  const customer_name = clean(body.customer_name, 120);
  const phone = clean(body.phone, 30);
  const service_type = clean(body.service_type, 80);
  const sub_city_id = clean(body.sub_city_id, 50);
  const woreda_id = clean(body.woreda_id, 50);
  const address = clean(body.address, 500);
  if (!customer_name || !phone || !service_type || !sub_city_id || !woreda_id || !address) {
    return res.status(400).json({ error: 'Please complete all required booking fields.' });
  }
  if (!/^[+0-9() -]{7,30}$/.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!uuid.test(sub_city_id) || !uuid.test(woreda_id)) {
    return res.status(400).json({ error: 'Please select a valid sub-city and woreda.' });
  }
  try {
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
    const base = SUPABASE_URL + '/rest/v1/';
    const [areaResponse, woredaResponse, serviceResponse] = await Promise.all([
      fetch(base + 'lystro_sub_cities?id=eq.' + sub_city_id + '&is_active=eq.true&select=id,name', { headers }),
      fetch(base + 'lystro_woredas?id=eq.' + woreda_id + '&sub_city_id=eq.' + sub_city_id + '&is_active=eq.true&select=id,name,sub_city_id', { headers }),
      fetch(base + 'lystro_services?name=eq.' + encodeURIComponent(service_type) + '&is_active=eq.true&select=name', { headers })
    ]);
    if (!areaResponse.ok || !woredaResponse.ok || !serviceResponse.ok) {
      console.error('LYSTRO booking reference lookup failed:', areaResponse.status, woredaResponse.status, serviceResponse.status);
      return res.status(502).json({ error: 'Booking options could not be verified. Please try again later.' });
    }
    const [areas, woredas, services] = await Promise.all([areaResponse.json(), woredaResponse.json(), serviceResponse.json()]);
    if (!areas?.length || !woredas?.length || woredas[0].sub_city_id !== sub_city_id) {
      return res.status(400).json({ error: 'The selected woreda does not belong to the selected active sub-city.' });
    }
    if (!services?.length) return res.status(400).json({ error: 'Please select an available service.' });
    const order = {
      customer_name, phone, service_type: services[0].name,
      sub_city: areas[0].name, woreda: woredas[0].name,
      address, status: 'pending', telegram_notification_status: 'pending'
    };
    const response = await fetch(base + 'orders', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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

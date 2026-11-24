// Background Telegram notification endpoint. Booking creation never waits for this request.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (res, status, body) => res.status(status).json(body);
const timedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(8000) });

async function updateStatus(base, headers, id, status) {
  const response = await timedFetch(base + 'orders?id=eq.' + encodeURIComponent(id) + '&telegram_notification_status=eq.sending', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ telegram_notification_status: status })
  });
  if (!response.ok) console.error('LYSTRO Telegram status update failed', { http_status: response.status });
}

async function sendTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return 'not_configured';
  const message = [
    'LYSTRO — New booking',
    'Order: ' + order.id,
    'Customer: ' + order.customer_name,
    'Phone: ' + order.phone,
    'Service: ' + order.service_type,
    'Area: ' + order.sub_city + ' / ' + order.woreda,
    'Pickup: ' + order.pickup_date + ' ' + order.pickup_time,
    'Shoes: ' + order.shoe_count,
    'Total: ETB ' + order.total_amount,
    'Payment: Cash on service (unpaid)'
  ].join('\n');
  const send = () => fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });
  try {
    console.log('LYSTRO Telegram send started');
    let response = await send();
    let result = await response.json().catch(() => null);
    if (response.status === 429 && Number.isInteger(result?.parameters?.retry_after)) {
      const seconds = result.parameters.retry_after;
      console.log('LYSTRO Telegram rate limited; retrying shortly', { retry_after: seconds });
      if (seconds <= 8 && seconds > 0) {
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        response = await send();
        result = await response.json().catch(() => null);
      }
    }
    if (!response.ok || !result?.ok) {
      console.error('LYSTRO Telegram send failed', {
        http_status: response.status,
        telegram_description: result?.description || 'No error description returned'
      });
      return 'failed';
    }
    console.log('LYSTRO Telegram notification sent');
    return 'sent';
  } catch (error) {
    console.error('LYSTRO Telegram request error:', error?.message || 'Unknown error');
    return 'failed';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return reply(res, 500, { error: 'Server configuration is incomplete.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (!uuid.test(id)) return reply(res, 400, { error: 'Invalid order reference.' });

  const base = SUPABASE_URL + '/rest/v1/';
  const headers = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
  try {
    const found = await timedFetch(base + 'orders?id=eq.' + encodeURIComponent(id) +
      '&select=id,customer_name,phone,service_type,sub_city,woreda,pickup_date,pickup_time,shoe_count,total_amount,telegram_notification_status', { headers });
    if (!found.ok) return reply(res, 502, { error: 'Order could not be loaded.' });
    const rows = await found.json();
    if (!Array.isArray(rows) || !rows.length) return reply(res, 404, { error: 'Order not found.' });
    if (rows[0].telegram_notification_status !== 'pending') return reply(res, 200, { success: true, skipped: true });

    // Claim once so repeated client requests cannot create duplicate channel posts.
    const claimed = await timedFetch(base + 'orders?id=eq.' + encodeURIComponent(id) + '&telegram_notification_status=eq.pending', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ telegram_notification_status: 'sending' })
    });
    if (!claimed.ok) return reply(res, 502, { error: 'Notification could not be queued.' });
    const claimedRows = await claimed.json().catch(() => []);
    if (!Array.isArray(claimedRows) || !claimedRows.length) return reply(res, 200, { success: true, skipped: true });

    const status = await sendTelegram(rows[0]);
    await updateStatus(base, headers, id, status);
    return reply(res, 200, { success: status === 'sent', status });
  } catch (error) {
    console.error('LYSTRO Telegram background endpoint error:', error?.message || 'Unknown error');
    return reply(res, 500, { error: 'Notification request failed.' });
  }
};

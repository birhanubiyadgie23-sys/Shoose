// LYSTRO Admin Orders API.
// All privileged database access stays server-side. The caller's Supabase
// access token is verified with Auth before the admin_users role is checked.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J';
const ADMIN_TRANSITIONS = { pending: new Set(['accepted','confirmed','cancelled']), accepted: new Set(['cancelled']), confirmed: new Set(['cancelled']) };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(res, status, body) {
  return res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !PUBLIC_KEY) {
    return reply(res, 500, { error: 'Server database configuration is incomplete.' });
  }

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return reply(res, 401, { error: 'Authentication required.' });
  const accessToken = match[1];

  try {
    const authResponse = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: PUBLIC_KEY, Authorization: 'Bearer ' + accessToken }
    });
    if (!authResponse.ok) return reply(res, 401, { error: 'Your session is invalid or expired. Sign in again.' });
    const user = await authResponse.json();
    if (!user?.id) return reply(res, 401, { error: 'Could not verify your account.' });

    const roleResponse = await fetch(
      SUPABASE_URL + '/rest/v1/admin_users?user_id=eq.' + encodeURIComponent(user.id) + '&select=role&limit=1',
      { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
    );
    if (!roleResponse.ok) {
      const diagnostic = await roleResponse.text().catch(() => '');
      console.error('LYSTRO admin role lookup failed:', roleResponse.status, diagnostic.slice(0, 500));
      return reply(res, 500, { error: 'Could not verify administrator permissions.' });
    }
    const roles = await roleResponse.json();
    const role = Array.isArray(roles) ? roles[0]?.role : null;
    if (!['admin', 'super_admin'].includes(role)) {
      return reply(res, 403, { error: 'Administrator access required.' });
    }

    const headers = {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    };

    if (req.method === 'GET') {
      const response = await fetch(
        SUPABASE_URL + '/rest/v1/orders?select=*&order=created_at.desc&limit=200',
        { headers }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) return reply(res, 502, { error: 'Orders could not be loaded.' });
      return reply(res, 200, { orders: data || [], role });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply(res, 400, { error: 'Invalid request body.' });
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) return reply(res, 400, { error: 'A valid order ID is required.' });

    if (req.method === 'PATCH') {
      if (typeof body.status !== 'string') {
        return reply(res, 400, { error: 'Choose a valid order status.' });
      }
      const currentResponse = await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + encodeURIComponent(id) + '&select=id,status,assigned_professional_id', { headers });
      const currentRows = await currentResponse.json().catch(() => []);
      if (!currentResponse.ok) return reply(res, 502, { error: 'Current order status could not be checked.' });
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (!current) return reply(res, 404, { error: 'Order not found.' });
      const permitted = ADMIN_TRANSITIONS[current.status];
      if (!permitted || !permitted.has(body.status)) {
        return reply(res, 409, { error: 'This status change is not allowed. Assignment and job progress must be completed through the professional workflow.' });
      }
      // Admin may confirm or cancel; assignment and work progress are controlled by their dedicated workflows.
      const response = await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ status: body.status, ...(body.status === 'accepted' ? { accepted_at: new Date().toISOString() } : {}), ...(body.status === 'in_progress' ? { started_at: new Date().toISOString() } : {}), ...(body.status === 'completed' ? { completed_at: new Date().toISOString() } : {}) })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return reply(res, 502, { error: 'Order status could not be updated.' });
      if (!Array.isArray(data) || data.length === 0) return reply(res, 404, { error: 'Order not found.' });
      // Release the assigned professional when the job reaches a terminal state.
      if (['completed', 'cancelled'].includes(body.status) && data[0].assigned_professional_id) {
        const professionalId = encodeURIComponent(data[0].assigned_professional_id);
        const terminal = body.status;
        // Recalculate workload after completion/cancellation; never override an explicit unavailable flag.
        const [remainingResponse, professionalResponse] = await Promise.all([
          fetch(SUPABASE_URL + '/rest/v1/orders?assigned_professional_id=eq.' + professionalId + '&status=in.(assigned,in_progress)&select=id', { headers }),
          fetch(SUPABASE_URL + '/rest/v1/lystro_professionals?id=eq.' + professionalId + '&select=availability,max_active_jobs', { headers })
        ]);
        const remaining = remainingResponse.ok ? await remainingResponse.json().catch(() => []) : [];
        const professionalRows = professionalResponse.ok ? await professionalResponse.json().catch(() => []) : [];
        const professional = professionalRows[0];
        if (professional && professional.availability !== 'unavailable') {
          const capacity = Math.max(1, Math.min(20, Number(professional.max_active_jobs) || 20));
          const nextAvailability = remaining.length >= capacity ? 'busy' : 'available';
          const release = await fetch(SUPABASE_URL + '/rest/v1/lystro_professionals?id=eq.' + professionalId, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ availability: nextAvailability })
          });
          if (!release.ok) console.error('LYSTRO professional workload refresh failed:', release.status);
        }
        const history = await fetch(SUPABASE_URL + '/rest/v1/lystro_assignment_history?order_id=eq.' + encodeURIComponent(id) + '&status=eq.accepted', {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ status: terminal, responded_at: new Date().toISOString() })
        });
        if (!history.ok) console.error('LYSTRO assignment history close failed:', history.status);
      }
      return reply(res, 200, { success: true, order: data[0] });
    }

    if (role !== 'super_admin') {
      return reply(res, 403, { error: 'Only the Super Admin can delete orders.' });
    }
    const response = await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { ...headers, Prefer: 'return=representation' }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return reply(res, 502, { error: 'Order could not be deleted.' });
    if (!Array.isArray(data) || data.length === 0) return reply(res, 404, { error: 'Order not found.' });
    return reply(res, 200, { success: true });
  } catch (error) {
    console.error('LYSTRO admin orders API error:', error?.message || 'Unknown error');
    return reply(res, 500, { error: 'A server error occurred.' });
  }
};

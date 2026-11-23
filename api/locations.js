// Public LYSTRO location options. Only active names and IDs are returned.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Location service is not configured.' });
  }
  try {
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY };
    const [areasResponse, woredasResponse] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/lystro_sub_cities?is_active=eq.true&select=id,name,is_active&order=name.asc', { headers }),
      fetch(SUPABASE_URL + '/rest/v1/lystro_woredas?is_active=eq.true&select=id,name,sub_city_id,is_active&order=name.asc', { headers })
    ]);
    if (!areasResponse.ok || !woredasResponse.ok) {
      console.error('LYSTRO location lookup failed:', areasResponse.status, woredasResponse.status);
      return res.status(502).json({ error: 'Location options could not be loaded.' });
    }
    const [sub_cities, woredas] = await Promise.all([areasResponse.json(), woredasResponse.json()]);
    return res.status(200).json({
      sub_cities: Array.isArray(sub_cities) ? sub_cities : [],
      woredas: Array.isArray(woredas) ? woredas : []
    });
  } catch (error) {
    console.error('LYSTRO locations API error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'Could not load booking locations.' });
  }
};

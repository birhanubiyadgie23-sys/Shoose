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
    const [areasResponse, woredasResponse, servicesResponse] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/lystro_sub_cities?is_active=eq.true&select=id,name,is_active&order=name.asc', { headers }),
      fetch(SUPABASE_URL + '/rest/v1/lystro_woredas?is_active=eq.true&select=id,name,sub_city_id,is_active&order=name.asc', { headers }),
      fetch(SUPABASE_URL + '/rest/v1/lystro_services?is_active=eq.true&select=id,name,price&order=name.asc', { headers })
    ]);
    if (!areasResponse.ok || !woredasResponse.ok || !servicesResponse.ok) {
      console.error('LYSTRO location lookup failed:', areasResponse.status, woredasResponse.status);
      return res.status(502).json({ error: 'Location options could not be loaded.' });
    }
    const [sub_cities, woredas, services] = await Promise.all([areasResponse.json(), woredasResponse.json(), servicesResponse.json()]);
    const activeWoredas = Array.isArray(woredas) ? woredas : [];
    const activeWoredaSubCityIds = new Set(activeWoredas.map(item => item.sub_city_id));
    // Do not expose active sub-cities that have no active woreda: customers
    // cannot complete a booking for those areas until an admin configures them.
    const bookableSubCities = (Array.isArray(sub_cities) ? sub_cities : [])
      .filter(item => activeWoredaSubCityIds.has(item.id));
    return res.status(200).json({
      sub_cities: bookableSubCities,
      woredas: activeWoredas,
      services: Array.isArray(services) ? services : []
    });
  } catch (error) {
    console.error('LYSTRO locations API error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'Could not load booking locations.' });
  }
};

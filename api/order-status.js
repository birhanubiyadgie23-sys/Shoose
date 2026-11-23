// Public order tracking by high-entropy tracking code. Never expose customer PII.
const URL=(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed.'});}
 const code=typeof req.query?.code==='string'?req.query.code.trim():'';
 if(!/^[a-f0-9]{48}$/.test(code))return res.status(400).json({error:'Enter a valid tracking code.'});
 if(!URL||!KEY)return res.status(500).json({error:'Tracking service is not configured.'});
 try{
  const r=await fetch(URL+'/rest/v1/orders?tracking_code=eq.'+encodeURIComponent(code)+'&select=status,service_type,sub_city,woreda,pickup_date,pickup_time,shoe_count,total_amount,cash_payment_status,created_at,assigned_at,started_at,completed_at&limit=1',{headers:{apikey:KEY,Authorization:'Bearer '+KEY}});
  if(!r.ok)return res.status(502).json({error:'Tracking is temporarily unavailable.'});
  const rows=await r.json();if(!rows.length)return res.status(404).json({error:'No order was found for this tracking code.'});
  return res.status(200).json({order:rows[0]});
 }catch(e){console.error('LYSTRO tracking error',e?.message||'unknown');return res.status(500).json({error:'Tracking is temporarily unavailable.'});}
};

// LYSTRO professional self-service portal API.
const URL=(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const PUBLIC=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J';
const reply=(res,n,b)=>res.status(n).json(b);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 if(!URL||!SERVICE||!PUBLIC)return reply(res,500,{error:'Server configuration is incomplete.'});
 if(!['GET','PATCH'].includes(req.method)){res.setHeader('Allow','GET, PATCH');return reply(res,405,{error:'Method not allowed.'});}
 const token=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return reply(res,401,{error:'Please sign in.'});
 try{
  const auth=await fetch(URL+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token}});
  if(!auth.ok)return reply(res,401,{error:'Your session expired. Please sign in again.'});
  const user=await auth.json();if(!user?.id)return reply(res,401,{error:'Could not verify your account.'});
  const headers={apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'};
  const base=URL+'/rest/v1/';
  async function db(path,method='GET',body){
   const r=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
   const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}
   if(!r.ok){console.error('LYSTRO professional DB error',r.status,String(t).slice(0,300));throw new Error(d?.message||'Database request failed.');}
   return d;
  }
  const people=await db('lystro_professionals?auth_user_id=eq.'+encodeURIComponent(user.id)+'&select=id,full_name,email,status,availability,max_active_jobs,sub_city_id,woreda_id&limit=1');
  const professional=people?.[0];
  if(!professional)return reply(res,403,{error:'No professional profile is linked to this account. Contact LYSTRO administration.'});
  if(professional.status!=='approved')return reply(res,403,{error:'Your professional account is not currently approved.'});
  if(req.method==='GET'){
   const orders=await db('orders?assigned_professional_id=eq.'+professional.id+'&status=in.(assigned,in_progress,completed)&select=id,customer_name,phone,service_type,sub_city,woreda,status,created_at,assigned_at,started_at,completed_at&order=created_at.desc&limit=100');
   const active=(orders||[]).filter(o=>['assigned','in_progress'].includes(o.status)).length;
   return reply(res,200,{professional:{id:professional.id,full_name:professional.full_name,availability:professional.availability,max_active_jobs:professional.max_active_jobs||20},orders:orders||[],active_jobs:active});
  }
  let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{body=null}}
  if(!body||!uuid.test(String(body.order_id||''))||!['start','complete'].includes(body.action))return reply(res,400,{error:'A valid order and action are required.'});
  const result=await db('rpc/lystro_professional_update_job','POST',{p_user_id:user.id,p_order_id:body.order_id,p_action:body.action});
  return reply(res,200,result||{success:true});
 }catch(e){
  console.error('LYSTRO professional API error',e?.message||'unknown');
  return reply(res,500,{error:'Could not update your job. Refresh and try again.'});
 }
};

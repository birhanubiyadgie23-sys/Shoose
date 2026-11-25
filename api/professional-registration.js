// Complete a verified professional self-registration. Public signup is handled by Supabase Auth;
// this endpoint only creates the profile after the email address has been confirmed.
const URL=(process.env.SUPABASE_URL||'').replace(/\\/+$/,'').replace(/\\/rest\\/v1$/,'');
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const PUBLIC=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J';
const reply=(res,n,b)=>res.status(n).json(b);
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Method not allowed.'});}
 if(!URL||!SERVICE||!PUBLIC)return reply(res,500,{error:'Registration service is not configured.'});
 const token=(req.headers.authorization||'').match(/^Bearer\\s+(.+)$/i)?.[1];
 if(!token)return reply(res,401,{error:'Please verify your email and sign in first.'});
 try{
  const auth=await fetch(URL+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token}});
  if(!auth.ok)return reply(res,401,{error:'Your session is invalid. Please sign in again.'});
  const user=await auth.json();
  if(!user?.id||!user.email_confirmed_at)return reply(res,403,{error:'Please confirm your email address before completing registration.'});
  const meta=user.user_metadata||{};
  const full_name=clean(meta.full_name,120),phone=clean(meta.phone,30);
  const sub_city_id=clean(meta.sub_city_id,50),woreda_id=clean(meta.woreda_id,50);
  const email=clean(user.email,160).toLowerCase();
  const address=clean(meta.address,400);
  const experience_years=Math.max(0,Math.min(60,Number(meta.experience_years)||0));
  const service_ids=Array.isArray(meta.service_ids)?[...new Set(meta.service_ids.filter(x=>uuid.test(x)))]:[];
  if(!full_name||!/^\\+?[0-9() -]{7,30}$/.test(phone)||!uuid.test(sub_city_id)||!uuid.test(woreda_id)||!service_ids.length||!/^\\S+@\\S+\\.\\S+$/.test(email))
   return reply(res,400,{error:'Registration details are incomplete. Please register again with your name, phone, service area and at least one service.'});
  const headers={apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'};
  async function db(path,method='GET',body,prefer=''){
   const r=await fetch(URL+'/rest/v1/'+path,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   const raw=await r.text();let d;try{d=raw?JSON.parse(raw):null}catch{d=raw}
   if(!r.ok){console.error('LYSTRO registration DB error',r.status,String(raw).slice(0,300));throw new Error(d?.message||'Registration could not be saved.');}
   return d;
  }
  const existing=await db('lystro_professionals?or=(auth_user_id.eq.'+user.id+',email.ilike.'+encodeURIComponent(email)+')&select=id,status,auth_user_id&limit=2');
  if(existing?.length){
   const own=existing.find(x=>x.auth_user_id===user.id);
   if(own)return reply(res,200,{success:true,status:own.status,already_registered:true,message:own.status==='approved'?'Your professional account is approved.':'Your email is verified. Your application is awaiting administrator review.'});
   return reply(res,409,{error:'A professional profile already uses this email address. Please contact LYSTRO administration.'});
  }
  const [areas,woredas,services]=await Promise.all([
   db('lystro_sub_cities?id=eq.'+sub_city_id+'&is_active=eq.true&select=id'),
   db('lystro_woredas?id=eq.'+woreda_id+'&sub_city_id=eq.'+sub_city_id+'&is_active=eq.true&select=id'),
   db('lystro_services?id=in.('+service_ids.join(',')+')&is_active=eq.true&select=id')
  ]);
  if(!areas?.length||!woredas?.length||services?.length!==service_ids.length)
   return reply(res,400,{error:'One selected service area or service is no longer available. Please update your registration.'});
  const created=await db('lystro_professionals','POST',{
   auth_user_id:user.id,full_name,email,phone,sub_city_id,woreda_id,address,
   experience_years,status:'pending_review',availability:'unavailable',max_active_jobs:20
  },'return=representation');
  const profile=created?.[0];if(!profile)return reply(res,502,{error:'Your profile could not be created.'});
  try{
   await db('lystro_professional_services','POST',service_ids.map(service_id=>({professional_id:profile.id,service_id})),'resolution=ignore-duplicates,return=minimal');
  }catch(e){
   await db('lystro_professionals?id=eq.'+profile.id,'DELETE',undefined,'return=minimal').catch(()=>{});
   throw e;
  }
  return reply(res,201,{success:true,status:'pending_review',message:'Email verified. Your application is now waiting for LYSTRO administrator approval.'});
 }catch(e){
  console.error('LYSTRO professional registration error',e?.message||'unknown');
  return reply(res,500,{error:'Registration could not be completed. Please try again later.'});
 }
};

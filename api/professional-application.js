// Public LYSTRO professional application endpoint.
// Applications are inserted as pending_review and cannot access the work portal.
const URL=(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const reply=(res,n,b)=>res.status(n).json(b);
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Method not allowed.'});}
 if(!URL||!SERVICE)return reply(res,500,{error:'Application service is not configured.'});
 let b=req.body;if(typeof b==='string'){try{b=JSON.parse(b)}catch{b=null}}
 if(!b||typeof b!=='object'||Array.isArray(b))return reply(res,400,{error:'Invalid application.'});
 // Honeypot field for basic automated form submissions.
 if(clean(b.website,200))return reply(res,200,{success:true});
 const full_name=clean(b.full_name,120),phone=clean(b.phone,30),email=clean(b.email,160).toLowerCase();
 const sub_city_id=clean(b.sub_city_id,50),woreda_id=clean(b.woreda_id,50);
 const address=clean(b.address,400),notes=clean(b.notes,1000);
 const experience=Number(b.experience_years);
 if(!full_name||!/^\+?[0-9() -]{7,30}$/.test(phone)||!uuid.test(sub_city_id)||!uuid.test(woreda_id))
  return reply(res,400,{error:'Enter your name, a valid phone number, sub-city and woreda.'});
 if(email&&!/^\S+@\S+\.\S+$/.test(email))return reply(res,400,{error:'Enter a valid email address or leave it blank.'});
 if(!Number.isInteger(experience)||experience<0||experience>60)return reply(res,400,{error:'Experience must be from 0 to 60 years.'});
 const ids=Array.isArray(b.service_ids)?[...new Set(b.service_ids.filter(x=>typeof x==='string'&&uuid.test(x)))]:[];
 if(!ids.length||ids.length>30)return reply(res,400,{error:'Select at least one valid service.'});
 const headers={apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'};
 const base=URL+'/rest/v1/';
 async function db(path,method='GET',body,prefer=''){
  const r=await fetch(base+path,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const t=await r.text();let data;try{data=t?JSON.parse(t):null}catch{data=t}
  if(!r.ok){console.error('LYSTRO public application DB error',r.status,String(t).slice(0,350));throw new Error(data?.message||'Database request failed.');}
  return data;
 }
 try{
  const [areas,woredas,services]=await Promise.all([
   db('lystro_sub_cities?id=eq.'+sub_city_id+'&is_active=eq.true&select=id&limit=1'),
   db('lystro_woredas?id=eq.'+woreda_id+'&sub_city_id=eq.'+sub_city_id+'&is_active=eq.true&select=id&limit=1'),
   db('lystro_services?id=in.('+ids.join(',')+')&is_active=eq.true&select=id')
  ]);
  if(!areas?.length||!woredas?.length)return reply(res,400,{error:'Choose an active woreda within the selected sub-city.'});
  if(!Array.isArray(services)||services.length!==ids.length)return reply(res,400,{error:'One or more selected services are unavailable.'});
  // Avoid duplicate applications from the same phone or email.
  const phoneMatch=await db('lystro_professionals?phone=eq.'+encodeURIComponent(phone)+'&select=id,status&limit=1');
  if(phoneMatch?.length)return reply(res,409,{error:'An application already exists for this phone number. Please contact LYSTRO administration.'});
  if(email){
   const emailMatch=await db('lystro_professionals?email=ilike.'+encodeURIComponent(email)+'&select=id,status&limit=1');
   if(emailMatch?.length)return reply(res,409,{error:'An application already exists for this email address. Please contact LYSTRO administration.'});
  }
  const rows=await db('lystro_professionals','POST',{
   full_name,phone,email:email||null,sub_city_id,woreda_id,address,
   experience_years:experience,notes,
   status:'pending_review',availability:'unavailable',max_active_jobs:20,
   auth_user_id:null,created_by:null
  },'return=representation');
  const person=rows?.[0];if(!person?.id)return reply(res,500,{error:'Application could not be saved.'});
  try{
   await db('lystro_professional_services','POST',ids.map(service_id=>({professional_id:person.id,service_id})),'resolution=ignore-duplicates,return=minimal');
  }catch(error){
   await db('lystro_professionals?id=eq.'+person.id,'DELETE',undefined,'return=minimal').catch(()=>{});
   throw error;
  }
  return reply(res,201,{success:true,message:'Application received and pending review.'});
 }catch(error){
  console.error('LYSTRO public professional application error:',error?.message||'unknown');
  return reply(res,500,{error:'The application could not be saved. Please try again later.'});
 }
};

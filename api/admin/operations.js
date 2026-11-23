// LYSTRO operations API. Privileged access is server-side only.
const URL=(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const PUBLIC=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J';
const reply=(res,n,b)=>res.status(n).json(b);
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(!URL||!SERVICE||!PUBLIC)return reply(res,500,{error:'Server database configuration is incomplete.'});
 const m=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i);if(!m)return reply(res,401,{error:'Authentication required.'});
 try{
  const auth=await fetch(URL+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+m[1]}});
  if(!auth.ok)return reply(res,401,{error:'Your session is invalid or expired.'});
  const user=await auth.json();if(!user.id)return reply(res,401,{error:'Could not verify account.'});
  const rr=await fetch(URL+'/rest/v1/admin_users?user_id=eq.'+encodeURIComponent(user.id)+'&select=role&limit=1',{headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE}});
  if(!rr.ok){console.error('LYSTRO operations role lookup failed',rr.status,(await rr.text()).slice(0,300));return reply(res,500,{error:'Could not verify administrator permissions.'});}
  const role=(await rr.json())?.[0]?.role;if(!['admin','super_admin'].includes(role))return reply(res,403,{error:'Administrator access required.'});
  const h={apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'};
  const base=URL+'/rest/v1/';
  async function db(path,method='GET',body,prefer=''){
   const r=await fetch(base+path,{method,headers:{...h,...(prefer?{Prefer:prefer}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const t=await r.text();let data;try{data=t?JSON.parse(t):null}catch{data=t}
   if(!r.ok){console.error('LYSTRO operations DB error',r.status,JSON.stringify(data).slice(0,400));throw new Error(data?.message||'Database operation failed.');}
   return data;
  }
  const resource=clean(req.query?.resource,40);
  if(req.method==='GET'){
   const [areas,woredas,services,professionals,assignments]=await Promise.all([
    db('lystro_sub_cities?select=*&order=name.asc'),db('lystro_woredas?select=*&order=name.asc'),
    db('lystro_services?select=*&order=name.asc'),
    db('lystro_professionals?select=*,lystro_sub_cities(name),lystro_woredas(name),lystro_professional_services(lystro_services(id,name))&order=created_at.desc'),
    db('lystro_assignment_history?select=*&order=created_at.desc&limit=300')
   ]);
   return reply(res,200,{sub_cities:areas,woredas,services,professionals,assignments,role});
  }
  let b=req.body;if(typeof b==='string'){try{b=JSON.parse(b)}catch{b=null}}if(!b||typeof b!=='object'||Array.isArray(b))return reply(res,400,{error:'Invalid request body.'});
  if(req.method==='POST'){
   if(resource==='professional'){
    const full_name=clean(b.full_name,120),phone=clean(b.phone,30),sub_city_id=clean(b.sub_city_id,50),woreda_id=clean(b.woreda_id,50);
    if(!full_name||!phone||!uuid.test(sub_city_id)||!uuid.test(woreda_id))return reply(res,400,{error:'Name, phone, sub-city and woreda are required.'});
    const p=await db('lystro_professionals','POST',{full_name,phone,email:clean(b.email,160)||null,sub_city_id,woreda_id,address:clean(b.address,400),experience_years:Math.max(0,Math.min(60,Number(b.experience_years)||0)),notes:clean(b.notes,1000),created_by:user.id},'return=representation');
    const item=p?.[0];const ids=Array.isArray(b.service_ids)?b.service_ids.filter(x=>uuid.test(x)):[];
    if(ids.length&&item)await db('lystro_professional_services','POST',ids.map(service_id=>({professional_id:item.id,service_id})),'resolution=ignore-duplicates,return=minimal');
    return reply(res,201,{success:true,professional:item});
   }
   if(resource==='sub_city'||resource==='woreda'||resource==='service'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can manage service areas and catalogue.'});
    let path,record;
    if(resource==='sub_city'){record={name:clean(b.name,100)};path='lystro_sub_cities';}
    if(resource==='woreda'){if(!uuid.test(clean(b.sub_city_id,50)))return reply(res,400,{error:'Select a valid sub-city.'});record={name:clean(b.name,100),sub_city_id:b.sub_city_id};path='lystro_woredas';}
    if(resource==='service'){record={name:clean(b.name,100),description:clean(b.description,500),price:Math.max(0,Number(b.price)||0),duration_minutes:Math.max(1,Math.min(1440,Number(b.duration_minutes)||60))};path='lystro_services';}
    if(!record.name)return reply(res,400,{error:'A name is required.'});
    const data=await db(path,'POST',record,'return=representation');return reply(res,201,{success:true,item:data?.[0]});
   }
   if(resource==='assign'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can approve assignments.'});
    if(!uuid.test(clean(b.order_id,50))||!uuid.test(clean(b.professional_id,50)))return reply(res,400,{error:'Valid order and professional are required.'});
    const pro=await db('lystro_professionals?id=eq.'+b.professional_id+'&select=id,status,availability');
    if(!pro?.[0]||pro[0].status!=='approved'||pro[0].availability!=='available')return reply(res,409,{error:'Professional is not approved and available.'});
    const order=await db('orders?id=eq.'+b.order_id+'&select=id,status');
    if(!order?.[0]||!['accepted','confirmed','pending'].includes(order[0].status))return reply(res,409,{error:'Order cannot be assigned in its current status.'});
    await db('orders?id=eq.'+b.order_id,'PATCH',{assigned_professional_id:b.professional_id,status:'assigned',assigned_at:new Date().toISOString()},'return=minimal');
    await db('lystro_assignment_history','POST',{order_id:b.order_id,professional_id:b.professional_id,assigned_by:user.id,status:'assigned',note:clean(b.note,500)},'return=minimal');
    return reply(res,200,{success:true});
   }
   return reply(res,400,{error:'Unknown resource.'});
  }
  if(req.method==='PATCH'){
   const id=clean(b.id,50);if(!uuid.test(id))return reply(res,400,{error:'Valid record ID is required.'});
   if(resource==='professional'){
    const status=clean(b.status,30);if(!['approved','rejected','suspended','pending_review'].includes(status))return reply(res,400,{error:'Invalid professional status.'});
    if(status!=='pending_review'&&role!=='super_admin')return reply(res,403,{error:'Only Super Admin can review professionals.'});
    const d=await db('lystro_professionals?id=eq.'+id,'PATCH',{status,reviewed_by:user.id,reviewed_at:new Date().toISOString(),...(b.availability?{availability:['available','busy','unavailable'].includes(b.availability)?b.availability:'available'}:{})},'return=representation');
    return reply(res,200,{success:true,professional:d?.[0]});
   }
   if(resource==='service'||resource==='sub_city'||resource==='woreda'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can edit master settings.'});
    const table={service:'lystro_services',sub_city:'lystro_sub_cities',woreda:'lystro_woredas'}[resource];
    const allowed=resource==='service'?{name:clean(b.name,100),description:clean(b.description,500),price:Math.max(0,Number(b.price)||0),duration_minutes:Math.max(1,Number(b.duration_minutes)||60),is_active:!!b.is_active}: {name:clean(b.name,100),is_active:!!b.is_active};
    const d=await db(table+'?id=eq.'+id,'PATCH',allowed,'return=representation');return reply(res,200,{success:true,item:d?.[0]});
   }
  }
  if(req.method==='DELETE'){
   if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can delete records.'});
   const id=clean(b.id,50);if(!uuid.test(id))return reply(res,400,{error:'Valid record ID is required.'});
   const table={professional:'lystro_professionals',service:'lystro_services',sub_city:'lystro_sub_cities',woreda:'lystro_woredas'}[resource];
   if(!table)return reply(res,400,{error:'Unknown resource.'});
   await db(table+'?id=eq.'+id,'DELETE',null,'return=minimal');return reply(res,200,{success:true});
  }
  res.setHeader('Allow','GET, POST, PATCH, DELETE');return reply(res,405,{error:'Method not allowed.'});
 }catch(e){console.error('LYSTRO operations API error',e?.message||'unknown');return reply(res,500,{error:'Operations request failed. Check database migration and required permissions.'});}
};

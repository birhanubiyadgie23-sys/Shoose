// LYSTRO operations API. Privileged access stays server-side.
const URL=(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const PUBLIC=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J';
const reply=(res,n,b)=>res.status(n).json(b);
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(!URL||!SERVICE||!PUBLIC)return reply(res,500,{error:'Server database configuration is incomplete.'});
 const token=(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return reply(res,401,{error:'Authentication required.'});
 try{
  const auth=await fetch(URL+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token}});
  if(!auth.ok)return reply(res,401,{error:'Your session is invalid or expired.'});
  const user=await auth.json();if(!user.id)return reply(res,401,{error:'Could not verify account.'});
  const rr=await fetch(URL+'/rest/v1/admin_users?user_id=eq.'+encodeURIComponent(user.id)+'&select=role&limit=1',{headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE}});
  if(!rr.ok){console.error('LYSTRO role lookup failed',rr.status);return reply(res,500,{error:'Could not verify administrator permissions.'});}
  const role=(await rr.json())?.[0]?.role;if(!['admin','super_admin'].includes(role))return reply(res,403,{error:'Administrator access required.'});
  const h={apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json'};
  const base=URL+'/rest/v1/';
  async function db(path,method='GET',body,prefer=''){
   const r=await fetch(base+path,{method,headers:{...h,...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   const t=await r.text();let data;try{data=t?JSON.parse(t):null}catch{data=t}
   if(!r.ok){console.error('LYSTRO operations DB error',r.status,JSON.stringify(data).slice(0,350));throw new Error(data?.message||'Database operation failed.');}
   return data;
  }
  const resource=clean(req.query?.resource,40);
  if(req.method==='GET'){
   const [areas,woredas,services,professionals,assignments]=await Promise.all([
    db('lystro_sub_cities?select=*&order=name.asc'),
    db('lystro_woredas?select=*&order=name.asc'),
    db('lystro_services?select=*&order=name.asc'),
    db('lystro_professionals?select=*,lystro_professional_services(lystro_services(id,name))&order=created_at.desc'),
    db('lystro_assignment_history?select=*&order=created_at.desc&limit=300')
   ]);
   return reply(res,200,{sub_cities:areas,woredas,services,professionals,assignments,role});
  }
  let b=req.body;if(typeof b==='string'){try{b=JSON.parse(b)}catch{b=null}}
  if(!b||typeof b!=='object'||Array.isArray(b))return reply(res,400,{error:'Invalid request body.'});
  if(req.method==='POST'){
   if(resource==='professional'){
    const full_name=clean(b.full_name,120),phone=clean(b.phone,30),sub_city_id=clean(b.sub_city_id,50),woreda_id=clean(b.woreda_id,50);
    if(!full_name||!phone||!/^\+?[0-9() -]{7,30}$/.test(phone)||!uuid.test(sub_city_id)||!uuid.test(woreda_id))return reply(res,400,{error:'Enter a valid name, phone, sub-city and woreda.'});
    const [area,woreda]=await Promise.all([
     db('lystro_sub_cities?id=eq.'+sub_city_id+'&is_active=eq.true&select=id'),
     db('lystro_woredas?id=eq.'+woreda_id+'&sub_city_id=eq.'+sub_city_id+'&is_active=eq.true&select=id')
    ]);
    if(!area?.length||!woreda?.length)return reply(res,400,{error:'The selected woreda must belong to the selected active sub-city.'});
    const ids=Array.isArray(b.service_ids)?[...new Set(b.service_ids.filter(x=>uuid.test(x)))]:[];
    if(!ids.length)return reply(res,400,{error:'Select at least one service.'});
    const active=await db('lystro_services?id=in.('+ids.join(',')+')&is_active=eq.true&select=id');
    if(active.length!==ids.length)return reply(res,400,{error:'One or more selected services are unavailable.'});
    const p=await db('lystro_professionals','POST',{full_name,phone,email:clean(b.email,160)||null,sub_city_id,woreda_id,address:clean(b.address,400),experience_years:Math.max(0,Math.min(60,Number(b.experience_years)||0)),notes:clean(b.notes,1000),created_by:user.id},'return=representation');
    const item=p?.[0];if(!item)return reply(res,500,{error:'Professional registration failed.'});
    try{await db('lystro_professional_services','POST',ids.map(service_id=>({professional_id:item.id,service_id})),'resolution=ignore-duplicates,return=minimal');}
    catch(e){await db('lystro_professionals?id=eq.'+item.id,'DELETE',undefined,'return=minimal').catch(()=>{});throw e;}
    return reply(res,201,{success:true,professional:item});
   }
   if(resource==='woreda'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can manage woredas.'});
    const sub_city_id=clean(b.sub_city_id,50);
    if(!uuid.test(sub_city_id))return reply(res,400,{error:'Select a valid sub-city.'});
    const namesRaw=Array.isArray(b.names)?b.names:(typeof b.names==='string'?b.names.split(/\r?\n/):[b.name]);
    const names=[...new Map(namesRaw.map(v=>clean(v,100)).filter(Boolean).map(name=>[name.toLocaleLowerCase(),name])).values()];
    if(!names.length)return reply(res,400,{error:'Enter at least one woreda name.'});
    if(names.length>250)return reply(res,400,{error:'Add up to 250 woredas per batch. You can submit more batches; there is no overall woreda limit.'});
    const area=await db('lystro_sub_cities?id=eq.'+sub_city_id+'&is_active=eq.true&select=id');
    if(!area?.length)return reply(res,400,{error:'Selected sub-city is not active.'});
    const existing=await db('lystro_woredas?sub_city_id=eq.'+sub_city_id+'&select=name');
    const existingNames=new Set((existing||[]).map(x=>clean(x.name,100).toLocaleLowerCase()));
    const newNames=names.filter(name=>!existingNames.has(name.toLocaleLowerCase()));
    if(!newNames.length)return reply(res,200,{success:true,requested:names.length,inserted:0,duplicates:names.length,items:[]});
    const items=await db('lystro_woredas','POST',newNames.map(name=>({name,sub_city_id})),'return=representation');
    return reply(res,201,{success:true,requested:names.length,inserted:items?.length||0,duplicates:names.length-newNames.length,items:items||[]});
   }
   if(resource==='sub_city'||resource==='service'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can manage service areas and catalogue.'});
    let path,record;
    if(resource==='sub_city'){record={name:clean(b.name,100)};path='lystro_sub_cities';}
    if(resource==='service'){record={name:clean(b.name,100),description:clean(b.description,500),price:Math.max(0,Number(b.price)||0),duration_minutes:Math.max(1,Math.min(1440,Number(b.duration_minutes)||60))};path='lystro_services';}
    if(!record.name)return reply(res,400,{error:'A name is required.'});
    const data=await db(path,'POST',record,'return=representation');return reply(res,201,{success:true,item:data?.[0]});
   }
   if(resource==='assign'){
    if(!uuid.test(clean(b.order_id,50))||!uuid.test(clean(b.professional_id,50)))return reply(res,400,{error:'Valid order and professional are required.'});
    const [pro,order]=await Promise.all([
     db('lystro_professionals?id=eq.'+b.professional_id+'&select=id,status,availability,sub_city_id,woreda_id,lystro_professional_services(lystro_services(name))'),
     db('orders?id=eq.'+b.order_id+'&select=id,status,sub_city,woreda,service_type,assigned_professional_id')
    ]);
    const p=pro?.[0],o=order?.[0];
    if(!p||p.status!=='approved'||p.availability!=='available')return reply(res,409,{error:'Professional is not approved and available.'});
    if(!o||!['accepted','confirmed'].includes(o.status)||o.assigned_professional_id)return reply(res,409,{error:'Order must be accepted or confirmed and not already assigned.'});
    const [area,woreda]=await Promise.all([
     db('lystro_sub_cities?id=eq.'+p.sub_city_id+'&select=name'),
     db('lystro_woredas?id=eq.'+p.woreda_id+'&select=name,sub_city_id')
    ]);
    const serviceNames=(p.lystro_professional_services||[]).map(x=>x.lystro_services?.name).filter(Boolean);
    if(area?.[0]?.name!==o.sub_city||woreda?.[0]?.name!==o.woreda||woreda?.[0]?.sub_city_id!==p.sub_city_id||!serviceNames.includes(o.service_type))return reply(res,409,{error:'Professional must match the order sub-city, woreda and service.'});
    const pending=await db('lystro_assignment_history?order_id=eq.'+o.id+'&status=eq.suggested&select=id');
    if(pending.length)return reply(res,409,{error:'This order already has a pending assignment suggestion.'});
    await db('lystro_assignment_history','POST',{order_id:o.id,professional_id:p.id,assigned_by:user.id,status:'suggested',note:clean(b.note,500)},'return=minimal');
    return reply(res,201,{success:true,message:'Suggestion submitted for Super Admin approval.'});
   }
   return reply(res,400,{error:'Unknown resource.'});
  }
  if(req.method==='PATCH'){
   const id=clean(b.id,50);if(!uuid.test(id))return reply(res,400,{error:'Valid record ID is required.'});
   if(resource==='assignment'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can approve or decline assignments.'});
    const status=clean(b.status,20);if(!['accepted','declined'].includes(status))return reply(res,400,{error:'Choose accepted or declined.'});
    const rows=await db('lystro_assignment_history?id=eq.'+id+'&select=id,order_id,professional_id,status');
    const a=rows?.[0];if(!a||a.status!=='suggested')return reply(res,404,{error:'Pending assignment suggestion not found.'});
    if(status==='declined'){
     await db('lystro_assignment_history?id=eq.'+id+'&status=eq.suggested','PATCH',{status:'declined',responded_at:new Date().toISOString()},'return=minimal');
     return reply(res,200,{success:true});
    }
    const [pro,orders]=await Promise.all([
     db('lystro_professionals?id=eq.'+a.professional_id+'&select=id,status,availability,sub_city_id,woreda_id,lystro_professional_services(lystro_services(name))'),
     db('orders?id=eq.'+a.order_id+'&select=id,status,sub_city,woreda,service_type,assigned_professional_id')
    ]);
    const p=pro?.[0],o=orders?.[0];
    if(!p||p.status!=='approved'||p.availability!=='available')return reply(res,409,{error:'Professional is no longer available.'});
    if(!o||!['accepted','confirmed'].includes(o.status)||o.assigned_professional_id)return reply(res,409,{error:'Order is no longer eligible for assignment.'});
    const [area,woreda]=await Promise.all([
     db('lystro_sub_cities?id=eq.'+p.sub_city_id+'&select=name'),
     db('lystro_woredas?id=eq.'+p.woreda_id+'&select=name,sub_city_id')
    ]);
    const names=(p.lystro_professional_services||[]).map(x=>x.lystro_services?.name).filter(Boolean);
    if(area?.[0]?.name!==o.sub_city||woreda?.[0]?.name!==o.woreda||woreda?.[0]?.sub_city_id!==p.sub_city_id||!names.includes(o.service_type))return reply(res,409,{error:'Professional no longer matches the order location and service.'});
    const claimed=await db('lystro_professionals?id=eq.'+p.id+'&availability=eq.available&status=eq.approved','PATCH',{availability:'busy'},'return=representation');
    if(!claimed?.length)return reply(res,409,{error:'Professional has already been assigned another job.'});
    const assigned=await db('orders?id=eq.'+o.id+'&assigned_professional_id=is.null&status=in.(accepted,confirmed)','PATCH',{assigned_professional_id:p.id,status:'assigned',assigned_at:new Date().toISOString()},'return=representation');
    if(!assigned?.length){await db('lystro_professionals?id=eq.'+p.id,'PATCH',{availability:'available'},'return=minimal').catch(()=>{});return reply(res,409,{error:'Order was changed or assigned by another administrator.'});}
    const updated=await db('lystro_assignment_history?id=eq.'+id+'&status=eq.suggested','PATCH',{status:'accepted',responded_at:new Date().toISOString()},'return=representation');
    if(!updated?.length)return reply(res,409,{error:'Order assigned, but assignment history needs administrator review.'});
    return reply(res,200,{success:true,order:assigned[0]});
   }
   if(resource==='professional'){
    const status=clean(b.status,30);if(!['approved','rejected','suspended','pending_review'].includes(status))return reply(res,400,{error:'Invalid professional status.'});
    if(status!=='pending_review'&&role!=='super_admin')return reply(res,403,{error:'Only Super Admin can review professionals.'});
    const patch={status,reviewed_by:user.id,reviewed_at:new Date().toISOString()};
    if(b.availability!==undefined){if(!['available','busy','unavailable'].includes(b.availability))return reply(res,400,{error:'Invalid availability.'});patch.availability=b.availability;}
    const d=await db('lystro_professionals?id=eq.'+id,'PATCH',patch,'return=representation');return reply(res,200,{success:true,professional:d?.[0]});
   }
   if(resource==='service'||resource==='sub_city'||resource==='woreda'){
    if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can edit master settings.'});
    const table={service:'lystro_services',sub_city:'lystro_sub_cities',woreda:'lystro_woredas'}[resource];
    const allowed=resource==='service'?{name:clean(b.name,100),description:clean(b.description,500),price:Math.max(0,Number(b.price)||0),duration_minutes:Math.max(1,Math.min(1440,Number(b.duration_minutes)||60)),is_active:!!b.is_active}:{name:clean(b.name,100),is_active:!!b.is_active};
    const d=await db(table+'?id=eq.'+id,'PATCH',allowed,'return=representation');return reply(res,200,{success:true,item:d?.[0]});
   }
   return reply(res,400,{error:'Unknown resource.'});
  }
  if(req.method==='DELETE'){
   if(role!=='super_admin')return reply(res,403,{error:'Only Super Admin can delete records.'});
   const id=clean(b.id,50);if(!uuid.test(id))return reply(res,400,{error:'Valid record ID is required.'});
   const table={professional:'lystro_professionals',service:'lystro_services',sub_city:'lystro_sub_cities',woreda:'lystro_woredas'}[resource];
   if(!table)return reply(res,400,{error:'Unknown resource.'});
   await db(table+'?id=eq.'+id,'DELETE',undefined,'return=minimal');return reply(res,200,{success:true});
  }
  res.setHeader('Allow','GET, POST, PATCH, DELETE');return reply(res,405,{error:'Method not allowed.'});
 }catch(e){console.error('LYSTRO operations API error',e?.message||'unknown');return reply(res,500,{error:'Operations request failed. Check database migration and required permissions.'});}
};

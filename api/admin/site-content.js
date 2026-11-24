const { DEFAULT_SITE_CONTENT, cleanSiteContent } = require("../../lib/site-content");
const URL=(process.env.SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const PUBLIC=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_iD4WwybpbfKhj951QntX1A_7ZrIDn7J";
const reply=(res,n,b)=>res.status(n).json(b);
module.exports=async function(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");
  if(!URL||!SERVICE||!PUBLIC)return reply(res,500,{error:"Server database configuration is incomplete."});
  const token=(req.headers.authorization||"").match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return reply(res,401,{error:"Authentication required."});
  try{
    const auth=await fetch(URL+"/auth/v1/user",{headers:{apikey:PUBLIC,Authorization:"Bearer "+token}});
    if(!auth.ok)return reply(res,401,{error:"Your session is invalid or expired."});
    const user=await auth.json();if(!user.id)return reply(res,401,{error:"Could not verify account."});
    const rr=await fetch(URL+"/rest/v1/admin_users?user_id=eq."+encodeURIComponent(user.id)+"&select=role&limit=1",{headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE}});
    if(!rr.ok)return reply(res,500,{error:"Could not verify administrator permissions."});
    const role=(await rr.json())?.[0]?.role;if(!["admin","super_admin"].includes(role))return reply(res,403,{error:"Administrator access required."});
    const endpoint=URL+"/rest/v1/lystro_site_content?id=eq.public";
    const headers={apikey:SERVICE,Authorization:"Bearer "+SERVICE,"Content-Type":"application/json"};
    if(req.method==="GET"){
      const r=await fetch(endpoint+"?select=content&limit=1",{headers});
      if(!r.ok)return reply(res,503,{error:"Website content storage is not ready. Apply the LYSTRO site content migration first."});
      const rows=await r.json();
      return reply(res,200,{content:rows?.[0]?.content?cleanSiteContent(rows[0].content):DEFAULT_SITE_CONTENT,role});
    }
    if(req.method==="PUT"){
      let body=req.body;if(typeof body==="string"){try{body=JSON.parse(body)}catch{body=null}}
      let content;try{content=cleanSiteContent(body?.content)}catch(e){return reply(res,400,{error:e.message});}
      const r=await fetch(endpoint,{method:"POST",headers:{...headers,Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({id:"public",content,updated_by:user.id,updated_at:new Date().toISOString()})});
      if(!r.ok){const t=await r.text();console.error("LYSTRO site content save failed",r.status,t.slice(0,250));return reply(res,503,{error:"Could not save website content. Confirm the site content migration is applied."});}
      return reply(res,200,{success:true,content});
    }
    res.setHeader("Allow","GET, PUT");return reply(res,405,{error:"Method not allowed."});
  }catch(e){console.error("LYSTRO site content API error",e?.message||"unknown");return reply(res,500,{error:"Website content request failed."});}
};

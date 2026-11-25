const { DEFAULT_SITE_CONTENT, cleanSiteContent } = require("../lib/site-content");
const URL=(process.env.SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
module.exports=async function(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed."});}
  if(!URL||!SERVICE)return res.status(200).json({content:DEFAULT_SITE_CONTENT,source:"sample"});
  try{
    const r=await fetch(URL+"/rest/v1/lystro_site_content?id=eq.public&select=content&limit=1",{headers:{apikey:SERVICE,Authorization:"Bearer "+SERVICE}});
    if(!r.ok)throw new Error("Site content table is not ready.");
    const rows=await r.json();
    const content=rows?.[0]?.content?cleanSiteContent(rows[0].content):DEFAULT_SITE_CONTENT;
    return res.status(200).json({content,source:rows?.length?"database":"sample"});
  }catch(e){return res.status(200).json({content:DEFAULT_SITE_CONTENT,source:"sample"});}
};

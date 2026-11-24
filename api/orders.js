// LYSTRO public booking API. Privileged credentials remain server-side.
const crypto = require('crypto');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (res, status, body) => res.status(status).json(body);

async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return 'not_configured';
  const text = [
    'LYSTRO — New booking',
    'Order: ' + order.id,
    'Customer: ' + order.customer_name,
    'Phone: ' + order.phone,
    'Service: ' + order.service_type,
    'Area: ' + order.sub_city + ' / ' + order.woreda,
    'Pickup: ' + order.pickup_date + ' ' + order.pickup_time,
    'Shoes: ' + order.shoe_count,
    'Total: ETB ' + order.total_amount,
    'Payment: Cash on service (unpaid)'
  ].join('\n');
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      console.error('LYSTRO Telegram send failed', {
        http_status: response.status,
        telegram_description: result?.description || 'No error description returned'
      });
      return 'failed';
    }
    console.log('LYSTRO Telegram notification sent');
    return 'sent';
  } catch (error) {
    console.error('LYSTRO Telegram request error:', error?.message || 'Unknown error');
    return 'failed';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return reply(res,405,{error:'Method not allowed.'}); }
  if (!SUPABASE_URL || !SERVICE_KEY) return reply(res,500,{error:'Server database configuration is incomplete.'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{body=null}}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(res,400,{error:'Invalid request body.'});

  const customer_name=clean(body.customer_name,120), phone=clean(body.phone,30);
  const service_type=clean(body.service_type,100), sub_city_id=clean(body.sub_city_id,50);
  const woreda_id=clean(body.woreda_id,50), address=clean(body.address,500);
  const pickup_date=clean(body.pickup_date,10), pickup_time=clean(body.pickup_time,20);
  const shoe_count=Number(body.shoe_count||1);
  const delivery_type=['pickup_and_return','on_site'].includes(body.delivery_type)?body.delivery_type:'pickup_and_return';
  if(!customer_name||!phone||!service_type||!sub_city_id||!woreda_id||!address||!pickup_date||!pickup_time)
    return reply(res,400,{error:'Please complete all required booking fields.'});
  if(!/^[+0-9() -]{7,30}$/.test(phone))return reply(res,400,{error:'Please enter a valid phone number.'});
  if(!uuid.test(sub_city_id)||!uuid.test(woreda_id))return reply(res,400,{error:'Please select a valid sub-city and woreda.'});
  if(!Number.isInteger(shoe_count)||shoe_count<1||shoe_count>30)return reply(res,400,{error:'Shoe quantity must be between 1 and 30.'});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(pickup_date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickup_time))
    return reply(res,400,{error:'Choose a valid pickup date and time.'});
  if(pickup_date < new Date().toISOString().slice(0,10))return reply(res,400,{error:'Pickup date cannot be in the past.'});

  try {
    const headers={apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY};
    const base=SUPABASE_URL+'/rest/v1/';
    const [areasR,woredasR,servicesR]=await Promise.all([
      fetch(base+'lystro_sub_cities?id=eq.'+sub_city_id+'&is_active=eq.true&select=id,name',{headers}),
      fetch(base+'lystro_woredas?id=eq.'+woreda_id+'&sub_city_id=eq.'+sub_city_id+'&is_active=eq.true&select=id,name,sub_city_id',{headers}),
      fetch(base+'lystro_services?name=eq.'+encodeURIComponent(service_type)+'&is_active=eq.true&select=name,price',{headers})
    ]);
    if(!areasR.ok||!woredasR.ok||!servicesR.ok)return reply(res,502,{error:'Booking options could not be verified.'});
    const [areas,woredas,services]=await Promise.all([areasR.json(),woredasR.json(),servicesR.json()]);
    if(!areas?.length||!woredas?.length||woredas[0].sub_city_id!==sub_city_id)return reply(res,400,{error:'The selected woreda does not belong to the selected sub-city.'});
    if(!services?.length)return reply(res,400,{error:'Please select an available service.'});
    const unit_price=Number(services[0].price)||0;
    const total_amount=unit_price*shoe_count;
    const tracking_code=crypto.randomBytes(24).toString('hex');
    const order={
      customer_name,phone,service_type:services[0].name,sub_city:areas[0].name,woreda:woredas[0].name,address,
      pickup_date,pickup_time,shoe_count,unit_price,total_amount,delivery_type,cash_payment_status:'unpaid',
      tracking_code,status:'pending',telegram_notification_status:'pending'
    };
    const saved=await fetch(base+'orders',{
      method:'POST',headers:{...headers,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify(order)
    });
    const data=await saved.json().catch(()=>null);
    if(!saved.ok){console.error('LYSTRO order insert failed',saved.status,data?.code||data?.message||'');return reply(res,502,{error:'Order could not be saved. Please try again.'});}
    const created=Array.isArray(data)?data[0]:data;
    const telegram_status=await notifyTelegram(created);
    const statusUpdate = await fetch(base+'orders?id=eq.'+encodeURIComponent(created.id),{
      method:'PATCH',headers:{...headers,'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({telegram_notification_status:telegram_status})
    });
    if (!statusUpdate.ok) {
      const errorBody = await statusUpdate.text().catch(() => '');
      console.error('LYSTRO Telegram status update failed', {
        http_status: statusUpdate.status,
        response: errorBody.slice(0, 500)
      });
    }
    return reply(res,201,{success:true,order:{id:created.id,tracking_code,service_type:created.service_type,total_amount,cash_payment_status:'unpaid',pickup_date,pickup_time}});
  } catch(error) {
    console.error('LYSTRO order API error:',error?.message||'Unknown error');
    return reply(res,500,{error:'A server error occurred while saving the order.'});
  }
};

'use strict';
const $ = id => document.getElementById(id);
const REGIONS = {
 baghdad:{name:'بغداد',center:[33.315,44.366]},basra:{name:'البصرة',center:[30.508,47.783]},nineveh:{name:'نينوى',center:[36.335,43.118]},erbil:{name:'أربيل',center:[36.191,44.009]},najaf:{name:'النجف',center:[32,44.333]},karbala:{name:'كربلاء',center:[32.616,44.024]},babylon:{name:'بابل',center:[32.483,44.433]},anbar:{name:'الأنبار',center:[33.425,43.3]},diyala:{name:'ديالى',center:[33.745,44.643]},dhiqar:{name:'ذي قار',center:[31.043,46.257]},maysan:{name:'ميسان',center:[31.835,47.144]},muthanna:{name:'المثنى',center:[31.311,45.28]},qadisiyah:{name:'القادسية',center:[31.992,44.925]},wasit:{name:'واسط',center:[32.512,45.818]},saladin:{name:'صلاح الدين',center:[34.607,43.678]},kirkuk:{name:'كركوك',center:[35.468,44.392]},duhok:{name:'دهوك',center:[36.867,42.988]},sulaymaniyah:{name:'السليمانية',center:[35.561,45.436]},halabja:{name:'حلبجة',center:[35.18,45.99]}
};
const STATUS = {pending:'بانتظار سائق',accepted:'السائق بالطريق',arrived:'السائق وصل',ongoing:'الرحلة جارية',completed:'مكتملة',cancelled:'ملغاة'};
const ACTIVE = ['pending','accepted','arrived','ongoing'];
const DEFAULT_FARES = [{service:'economy',label:'اقتصادي',base_fare:2000,per_km:750,minimum_fare:3000},{service:'comfort',label:'مريح',base_fare:3000,per_km:1000,minimum_fare:4000}];
const state = {view:'book',region:'karbala',service:'economy',mapMode:'pickup',pickup:null,destination:null,user:null,profile:null,rides:[],fares:DEFAULT_FARES,stats:null,drivers:[],deletions:[],profiles:[],authMode:'login',requestId:null,booking:false};
let sb = null, channel = null, epoch = 0, refreshing = false, refreshQueued = false;
let customerMap = null, driverMap = null, cPickupMarker = null, cDestMarker = null, cRouteLine = null, cDriverMarker = null, dSelfMarker = null, dPickupMarker = null, dDestMarker = null, dLine = null;
let watchId = null, lastLocationSent = 0, refreshTimer = null, toastTimer = null, latestDriverLocation = null;
const fmt = value => Number(value || 0).toLocaleString('en-US');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digits = value => String(value).replace(/[٠-٩۰-۹]/g,c=>'٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[\s()-]/g,'');
const dateLabel = value => new Date(value).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const currentRide = () => state.rides.find(r=>ACTIVE.includes(r.status)&&(r.customer_id===state.user?.id||r.driver_id===state.user?.id));
const serviceLabel = key => state.fares.find(f=>f.service===key)?.label || key;
function toast(message) { $('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500); }
function errorText(error) {
 if(!navigator.onLine) return 'الاتصال مقطوع. طلبك لا يُعد مرسلًا قبل وصول التأكيد.';
 if(/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(error?.message||''))return 'تعذر الاتصال بالخدمة. حاول التحديث.';
 if(error?.code==='PGRST205'||error?.code==='42P01')return 'الخدمة تحتاج إكمال إعداد قاعدة البيانات.';
 if(/Invalid login credentials/i.test(error?.message||''))return 'البريد أو كلمة المرور غير صحيحة.';
 if(/Email not confirmed/i.test(error?.message||''))return 'افتح رسالة تأكيد البريد أولًا.';
 return error?.message || 'تعذر إكمال العملية.';
}
function connection(text,online=false) {$('connectionBadge').textContent=text;$('connectionBadge').classList.toggle('online',online);}
async function rpc(name,args={}) {if(!sb)throw new Error('الخدمة قيد الإعداد. ربط قاعدة البيانات مطلوب لإرسال الطلبات.');const {data,error}=await sb.rpc(name,args);if(error)throw error;return data;}
async function busy(button,work) {if(button?.disabled)return;const old=button?.textContent;if(button){button.disabled=true;button.textContent='لحظة...';}try{return await work();}catch(error){toast(errorText(error));}finally{if(button){button.disabled=false;button.textContent=old;}}}
function empty(title,detail='',action='') {return `<div class="empty-state"><div class="big">🚕</div><strong>${esc(title)}</strong><div>${esc(detail)}</div>${action}</div>`;}
function fillRegions() {const options=Object.entries(REGIONS).map(([key,r])=>`<option value="${key}">${r.name}</option>`).join('');$('regionSelect').innerHTML=options;document.querySelectorAll('.region-select').forEach(el=>{el.innerHTML=options;el.value='karbala';});$('regionSelect').value=state.region;}
function goScreen(view,push=true) {
 if(!['book','orders','driver','profile','admin'].includes(view))view='book';
 state.view=view;
 document.querySelectorAll('[data-page]').forEach(page=>page.hidden=page.dataset.page!==view);
 document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('selected',button.dataset.view===view));
 if(push&&location.hash!==`#${view}`)history.pushState({view},'',`#${view}`);
 if(view==='profile')renderProfile();
 if(view==='book'){initCustomerMap();setTimeout(()=>{customerMap?.invalidateSize();drawCustomerRoute();},50);}
 if(view==='driver'&&state.profile?.role==='driver'){initDriverMap();setTimeout(()=>{driverMap?.invalidateSize();drawDriverRoute();},50);}
 if(push)window.scrollTo({top:0,behavior:'smooth'});
}
function makeIcon(color,label) {return L.divIcon({className:'',html:`<div class="kokton-marker" style="background:${color}"><span>${esc(label)}</span></div>`,iconSize:[36,36],iconAnchor:[18,36]});}
function addTiles(map) {L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);}
function initCustomerMap() {
 if(customerMap||!window.L)return;
 customerMap=L.map('customerMap',{zoomControl:false}).setView(REGIONS[state.region].center,12);addTiles(customerMap);L.control.zoom({position:'bottomleft'}).addTo(customerMap);
 customerMap.on('click',e=>{if(state.booking||currentRide())return;setPoint(state.mapMode,e.latlng);if(state.mapMode==='pickup')setMapMode('destination');});
}
function initDriverMap() {if(driverMap||!window.L)return;driverMap=L.map('driverMap').setView(REGIONS[state.region].center,12);addTiles(driverMap);}
function inBounds(point) {return Number.isFinite(point?.lat)&&Number.isFinite(point?.lng)&&point.lat>=28&&point.lat<=38&&point.lng>=38&&point.lng<=49;}
function setPoint(type,point) {
 if(!inBounds(point)){toast('حدد نقطة ضمن نطاق الخدمة في العراق.');return;}
 state[type]={lat:point.lat,lng:point.lng};$(type==='pickup'?'pickup':'destination').value=`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;drawCustomerRoute();updatePricePreview();
}
function setMapMode(mode) {state.mapMode=mode;document.querySelectorAll('[data-map-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mapMode===mode));$('mapTip').innerHTML=mode==='pickup'?'<b>A</b> اضغط مكان الانطلاق على الخريطة':'<b>B</b> اضغط وجهتك على الخريطة';}
function clearRoute() {state.pickup=null;state.destination=null;$('pickup').value='';$('destination').value='';setMapMode('pickup');drawCustomerRoute();updatePricePreview();}
function drawCustomerRoute() {
 if(!customerMap)return;
 const ride=currentRide();const pick=ride?{lat:ride.pickup_lat,lng:ride.pickup_lng}:state.pickup;const dest=ride?{lat:ride.destination_lat,lng:ride.destination_lng}:state.destination;
 for(const marker of [cPickupMarker,cDestMarker,cRouteLine,cDriverMarker])if(marker)customerMap.removeLayer(marker);
 cPickupMarker=cDestMarker=cRouteLine=cDriverMarker=null;
 if(pick)cPickupMarker=L.marker(pick,{icon:makeIcon('#137d68','A')}).addTo(customerMap);
 if(dest)cDestMarker=L.marker(dest,{icon:makeIcon('#c5911e','B')}).addTo(customerMap);
 if(pick&&dest)cRouteLine=L.polyline([pick,dest],{color:'#137d68',weight:4,dashArray:'8 8'}).addTo(customerMap);
 if(ride&&latestDriverLocation&&Date.now()-new Date(latestDriverLocation.updated_at).getTime()<120000)cDriverMarker=L.marker([latestDriverLocation.latitude,latestDriverLocation.longitude],{icon:makeIcon('#102c37','🚕')}).addTo(customerMap);
}
function fitRoute() {if(cRouteLine)customerMap.fitBounds(cRouteLine.getBounds(),{padding:[50,70],maxZoom:15});}
function drawDriverRoute() {
 if(!driverMap)return;
 for(const layer of [dSelfMarker,dPickupMarker,dDestMarker,dLine])if(layer)driverMap.removeLayer(layer);
 dSelfMarker=dPickupMarker=dDestMarker=dLine=null;
 const ride=currentRide();
 if(ride){const a=[ride.pickup_lat,ride.pickup_lng],b=[ride.destination_lat,ride.destination_lng];dPickupMarker=L.marker(a,{icon:makeIcon('#137d68','A')}).addTo(driverMap);dDestMarker=L.marker(b,{icon:makeIcon('#c5911e','B')}).addTo(driverMap);dLine=L.polyline([a,b],{color:'#137d68',dashArray:'8 8'}).addTo(driverMap);driverMap.fitBounds(dLine.getBounds(),{padding:[40,40],maxZoom:14});}
 if(latestDriverLocation)dSelfMarker=L.marker([latestDriverLocation.latitude,latestDriverLocation.longitude],{icon:makeIcon('#102c37','🚕')}).addTo(driverMap);
}
function haversine(a,b) {const rad=x=>x*Math.PI/180;const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));}
function updatePricePreview() {
 if(!state.pickup||!state.destination){$('fareValue').innerHTML='— <em>د.ع</em>';$('distanceValue').textContent='حدّد نقطتي الرحلة';return;}
 const km=Math.round(haversine(state.pickup,state.destination)*100)/100;const f=state.fares.find(x=>x.service===state.service)||DEFAULT_FARES[0];const fare=Math.max(f.minimum_fare,Math.ceil((f.base_fare+km*f.per_km)/250)*250);
 $('fareValue').innerHTML=`${fmt(fare)} <em>د.ع</em>`;$('distanceValue').textContent=`${km.toFixed(2)} كم · مسافة مباشرة`;
}
function locateMe() {
 if(!navigator.geolocation){toast('متصفحك لا يدعم تحديد الموقع.');return;}
 navigator.geolocation.getCurrentPosition(pos=>{const point={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!currentRide())setPoint('pickup',point);if(inBounds(point)){customerMap?.setView(point,15);setMapMode('destination');}},()=>toast('تعذر تحديد الموقع. اسمح للموقع أو حدده على الخريطة.'),{enableHighAccuracy:true,timeout:12000});
}
function requireLogin() {if(state.user)return true;openAuth('login');return false;}
async function submitOrder() {
 if(!requireLogin())return;
 if(state.profile?.role!=='customer'){toast('طلب الرحلة يحتاج حساب زبون.');return;}
 if(!state.pickup||!state.destination){toast('حدد الانطلاق والوجهة على الخريطة.');return;}
 if(!navigator.onLine){toast('الاتصال مقطوع. اتصل بالإنترنت حتى ترسل الطلب.');return;}
 if(haversine(state.pickup,state.destination)<0.1){toast('نقطتا الرحلة متقاربتان جدًا.');return;}
 state.booking=true;state.requestId ||= crypto.randomUUID();
 try{
  await rpc('taxi_create_ride',{p_id:state.requestId,p_region:state.region,p_service:state.service,p_pick_lat:state.pickup.lat,p_pick_lng:state.pickup.lng,p_dest_lat:state.destination.lat,p_dest_lng:state.destination.lng,p_pick_text:$('pickup').value.trim()||'نقطة الانطلاق',p_dest_text:$('destination').value.trim()||'الوجهة'});
  state.requestId=null;clearRoute();await refreshData();goScreen('orders');toast('تم تأكيد إرسال طلبك. بانتظار سائق من محافظتك.');
 }catch(error){await refreshData();throw error;}finally{state.booking=false;}
}
const rideSelect='*, customer:taxi_profiles!taxi_rides_customer_id_fkey(full_name,phone), driver:taxi_profiles!taxi_rides_driver_id_fkey(full_name,phone,car_make,plate)';
async function fetchRides() {
 const p=state.profile;let query=sb.from('taxi_rides').select(rideSelect).order('created_at',{ascending:false}).limit(100);
 if(p.role==='customer')query=query.eq('customer_id',p.id);
 if(p.role==='driver')query=query.eq('driver_id',p.id);
 const {data,error}=await query;if(error)throw error;
 if(p.role!=='driver')return data;
 const results=await Promise.all([sb.from('taxi_rides').select(rideSelect).eq('status','pending').eq('governorate',p.governorate).order('created_at',{ascending:false}).limit(50),sb.from('taxi_rides').select(rideSelect).eq('driver_id',p.id).in('status',['accepted','arrived','ongoing'])]);
 for(const result of results)if(result.error)throw result.error;
 return [...new Map([...data,...results[0].data,...results[1].data].map(r=>[r.id,r])).values()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
}
async function refreshData() {
 if(!sb||!state.user||!state.profile)return;
 if(refreshing){refreshQueued=true;return;}
 refreshing=true;const authEpoch=epoch;
 try{
  const [rides,stats,fares]=await Promise.all([fetchRides(),rpc('taxi_statistics'),sb.from('taxi_fares').select('*').order('base_fare')]);
  if(authEpoch!==epoch)return;
  if(fares.error)throw fares.error;state.rides=rides;state.stats=stats;state.fares=fares.data;latestDriverLocation=null;
  const active=currentRide();const driverId=state.profile.role==='driver'?state.user.id:active?.driver_id;
  if(driverId){const {data,error}=await sb.from('taxi_driver_locations').select('*').eq('driver_id',driverId).maybeSingle();if(!error&&authEpoch===epoch)latestDriverLocation=data;}
  if(state.profile.role==='admin'){
   const [drivers,profiles,deletions]=await Promise.all([sb.from('taxi_profiles').select('*').eq('role','driver').order('created_at',{ascending:false}).limit(200),sb.from('taxi_profiles').select('id,full_name,phone').limit(1000),sb.from('taxi_deletion_requests').select('*').order('requested_at')]);
   if(drivers.error||profiles.error||deletions.error)throw drivers.error||profiles.error||deletions.error;
   if(authEpoch!==epoch)return;state.drivers=drivers.data;state.profiles=profiles.data;state.deletions=deletions.data;
  }
  if(authEpoch!==epoch)return;renderAll();connection('متصل بالخدمة',true);
 }catch(error){if(authEpoch===epoch)connection(navigator.onLine?'تعذر تحديث البيانات':'غير متصل');}
 finally{refreshing=false;if(refreshQueued){refreshQueued=false;setTimeout(refreshData,0);}}
}
function renderRide(ride,context='history') {
 const mineCustomer=ride.customer_id===state.user?.id;const mineDriver=ride.driver_id===state.user?.id;const active=ACTIVE.includes(ride.status);let actions='';
 if(context==='available')actions=`<button class="button primary" data-action="accept" data-id="${ride.id}">قبول الطلب</button>`;
 if(mineCustomer&&['pending','accepted'].includes(ride.status))actions+=`<button class="button danger" data-action="cancel" data-id="${ride.id}">إلغاء الطلب</button>`;
 if(mineCustomer&&active)actions+=`<button class="button outline" data-action="track" data-id="${ride.id}">عرض على الخريطة</button>`;
 if(mineDriver&&active){const next={accepted:['arrived','وصلت للزبون'],arrived:['ongoing','بدء الرحلة'],ongoing:['completed','إنهاء الرحلة']}[ride.status];if(next)actions+=`<button class="button primary" data-action="advance" data-id="${ride.id}" data-status="${next[0]}">${next[1]}</button>`;actions+=`<a class="button outline" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/dir/?api=1&destination=${ride.status==='ongoing'?ride.destination_lat:ride.pickup_lat},${ride.status==='ongoing'?ride.destination_lng:ride.pickup_lng}&travelmode=driving">فتح الملاحة ↗</a>`;if(['accepted','arrived'].includes(ride.status))actions+=`<button class="button danger" data-action="cancel" data-id="${ride.id}">إلغاء</button>`;}
 if(state.profile?.role==='admin'&&active)actions+=`<button class="button danger" data-action="cancel" data-id="${ride.id}">إلغاء الطلب</button>`;
 const partner=mineCustomer?ride.driver:mineDriver?ride.customer:null;
 const phone=partner?.phone&&/^\+?[0-9]{8,15}$/.test(partner.phone)?`<a class="phone-link" href="tel:${esc(partner.phone)}">${esc(partner.phone)}</a>`:'';
 return `<article class="ride-card"><div class="ride-head"><strong>${esc(serviceLabel(ride.service))} · #${ride.id.slice(0,8)}</strong><span class="status-badge ${ride.status}">${STATUS[ride.status]||ride.status}</span></div><div class="ride-meta"><div>📍 من <b>${esc(ride.pickup_text)}</b></div><div>🎯 إلى <b>${esc(ride.destination_text)}</b></div><div>${esc(REGIONS[ride.governorate]?.name||ride.governorate)} · ${Number(ride.distance_km).toFixed(2)} كم تقريبًا</div>${partner?`<div>${mineCustomer?'السائق':'الزبون'} <b>${esc(partner.full_name)}</b> ${phone}</div>`:''}${mineCustomer&&ride.driver?`<div>${esc(ride.driver.car_make)} · ${esc(ride.driver.plate)}</div>`:''}</div><div class="ride-price"><span>${fmt(ride.estimated_fare)} د.ع <small>تقديري</small></span><small>${dateLabel(ride.created_at)}</small></div>${actions?`<div class="ride-actions">${actions}</div>`:''}</article>`;
}
function renderCustomerOrders() {
 const p=state.profile;
 if(!state.user){$('customerOrdersList').innerHTML=empty('طلباتك تبدأ من هنا','سجّل دخولك حتى تتابع الرحلات.','<button class="button primary" data-action="account">تسجيل الدخول</button>');return;}
 if(p?.role!=='customer'){$('customerOrdersList').innerHTML=empty('هذه الصفحة لحساب الزبون','رحلات السائق موجودة بلوحة السائق.');return;}
 $('customerOrdersList').innerHTML=state.rides.length?state.rides.map(r=>renderRide(r)).join(''):empty('ما عندك طلبات بعد','اختَر مكانك ووجهتك واطلب أول رحلة.','<button class="button primary" data-view="book">اطلب رحلة</button>');
}
function renderDriver() {
 const p=state.profile;const isDriver=p?.role==='driver';$('driverContent').hidden=!isDriver;$('onlineToggle').hidden=!isDriver;
 $('driverGate').hidden=isDriver&&p.is_approved;
 if(!isDriver){$('driverGate').innerHTML='لوحة السائق تحتاج حساب سائق. <button class="text-button" data-action="register-driver">إنشاء حساب سائق</button>';return;}
 if(!p.is_approved)$('driverGate').textContent='حسابك بانتظار موافقة الإدارة. أكمل بيانات السيارة ورقم اللوحة من ملفك الشخصي.';
 const online=p.is_online&&p.is_approved;$('onlineToggle').textContent=online?'● متصل — إيقاف الاستقبال':'○ غير متصل — تفعيل الاستقبال';$('onlineToggle').classList.toggle('primary',online);$('onlineToggle').disabled=!p.is_approved;
 $('driverRegionLabel').textContent=REGIONS[p.governorate]?.name||p.governorate;
 const ride=currentRide();$('driverCurrentOrder').innerHTML=ride?renderRide(ride,'current'):empty('ما عندك رحلة حالية',online?'اختَر طلب من الطلبات المتاحة.':'فعّل استقبال الطلبات بعد الموافقة.');
 const pending=state.rides.filter(r=>r.status==='pending'&&r.governorate===p.governorate);
 $('driverAvailableOrders').innerHTML=online&&!ride?(pending.length?pending.map(r=>renderRide(r,'available')).join(''):empty('بانتظار مشوار جديد','تظهر طلبات محافظتك هنا عند توفرها.')):empty(ride?'أكمل رحلتك الحالية أولًا':'استقبال الطلبات متوقف');
 const history=state.rides.filter(r=>r.driver_id===p.id&&!ACTIVE.includes(r.status));$('driverHistory').innerHTML=history.length?history.map(r=>renderRide(r)).join(''):empty('السجل فارغ حاليًا');
 $('statTrips').textContent=fmt(state.stats?.completed);$('statToday').textContent=fmt(state.stats?.today)+' د.ع';$('statEarnings').textContent=fmt(state.stats?.earnings)+' د.ع';
 drawDriverRoute();
}
function renderProfile() {
 const p=state.profile;$('profileForm').hidden=!p;$('profileGate').innerHTML=p?'':empty('سجّل الدخول إلى حسابك','','<button class="button primary" data-action="account">تسجيل الدخول</button>');
 if(!p)return;
 const f=$('profileForm');for(const name of ['full_name','phone','governorate','car_make','plate'])f.elements[name].value=p[name]||'';
 $('vehicleFields').hidden=p.role!=='driver';$('profileRole').textContent=p.role==='driver'?(p.is_approved?'سائق معتمد':'سائق بانتظار الموافقة'):p.role==='admin'?'الإدارة':'حساب زبون';
}
function renderAdmin() {
 const admin=state.profile?.role==='admin';$('adminContent').hidden=!admin;$('adminGate').innerHTML=admin?'':empty('هذه الصفحة مخصصة لإدارة الخدمة');if(!admin)return;
 $('adminActive').textContent=fmt(state.stats?.active);$('adminDrivers').textContent=fmt(state.stats?.drivers);$('adminPending').textContent=fmt(state.stats?.pending_drivers);
 $('adminDriversList').innerHTML=state.drivers.map(p=>`<div class="admin-user"><strong>${esc(p.full_name)}</strong> <span class="pill">${p.is_approved?'معتمد':'بانتظار الموافقة'}</span><p>${esc(p.phone)} · ${esc(REGIONS[p.governorate]?.name||p.governorate)}</p><p>${esc(p.car_make)} · ${esc(p.plate)}</p><button class="button ${p.is_approved?'danger':'primary'}" data-action="approve" data-id="${p.id}" data-approved="${!p.is_approved}">${p.is_approved?'إيقاف الاعتماد':'اعتماد السائق'}</button></div>`).join('')||empty('ماكو سائقين مسجلين بعد');
 const focused=document.activeElement?.closest('[data-fare]');
 if(!focused)$('faresEditor').innerHTML=state.fares.map(f=>`<form class="fare-editor" data-fare="${esc(f.service)}"><h3>${esc(f.label)}</h3><div class="fare-inputs"><label class="field">بدء الرحلة<input type="number" name="base" min="0" max="1000000" required value="${f.base_fare}"></label><label class="field">لكل كم<input type="number" name="per_km" min="0" max="100000" required value="${f.per_km}"></label><label class="field">الحد الأدنى<input type="number" name="minimum" min="0" max="1000000" required value="${f.minimum_fare}"></label></div><button class="button outline" type="submit">حفظ التسعيرة</button></form>`).join('');
 $('adminRides').innerHTML=state.rides.map(r=>renderRide(r)).join('')||empty('ماكو طلبات بعد');
 $('deletionRequests').innerHTML=state.deletions.map(r=>{const p=state.profiles.find(p=>p.id===r.user_id);return `<div class="admin-user"><strong>${esc(p?.full_name||r.user_id)}</strong><p>${esc(p?.phone||'')} · ${dateLabel(r.requested_at)}</p><small>رقم الحساب ${esc(r.user_id)} — تتم معالجة الحذف من لوحة قاعدة البيانات.</small></div>`;}).join('')||empty('ماكو طلبات حذف');
}
function renderAll() {
 $('accountButton').textContent=state.profile?.full_name||'دخول / تسجيل';document.querySelectorAll('.admin-only').forEach(b=>b.hidden=state.profile?.role!=='admin');
 renderCustomerOrders();renderDriver();renderAdmin();
 const active=state.profile?.role==='customer'?currentRide():null;
 $('currentRide').hidden=!active;$('bookingFields').hidden=Boolean(active);if(active)$('currentRide').innerHTML='<h2>رحلتك الحالية</h2>'+renderRide(active);
 drawCustomerRoute();updatePricePreview();
}
function openAuth(mode='login') {setAuthMode(mode);if(!$('authDialog').open)$('authDialog').showModal();}
function setAuthMode(mode) {
 state.authMode=mode;const signup=mode==='signup',forgot=mode==='forgot',recovery=mode==='recovery';$('authMessage').textContent='';$('signupFields').hidden=!signup;$('authTabs').hidden=forgot||recovery;$('passwordField').hidden=forgot;$('emailField').hidden=recovery;$('forgotPassword').hidden=signup||forgot||recovery;
 $('authForm').elements.email.required=!recovery;$('authForm').elements.password.required=!forgot;
 for(const key of ['full_name','phone'])$('authForm').elements[key].required=signup;
 $('authTitle').textContent=signup?'نورت تكسي العراق':forgot?'استعادة كلمة المرور':recovery?'كلمة مرور جديدة':'أهلًا برجعتك';$('authSubtitle').textContent=signup?'سجّل بياناتك وابدأ مشوارك.':forgot?'نرسل رابط الاستعادة لبريدك.':recovery?'اختَر كلمة مرور جديدة لحسابك.':'سجّل دخولك حتى تطلب وتتابع الرحلة.';
 $('authSubmit').textContent=signup?'إنشاء الحساب':forgot?'إرسال رابط الاستعادة':recovery?'حفظ كلمة المرور':'دخول';document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
 $('authForm').elements.password.autocomplete=signup||recovery?'new-password':'current-password';
}
async function handleAuth(event) {
 event.preventDefault();await busy($('authSubmit'),async()=>{
  if(!sb)throw new Error('الموقع يحتاج ربط قاعدة البيانات أولًا.');
  const f=event.target;const email=f.elements.email.value.trim(),password=f.elements.password.value;const base=new URL('./',location.href).href;let result;
  if(state.authMode==='forgot') {result=await sb.auth.resetPasswordForEmail(email,{redirectTo:base});if(result.error)throw result.error;$('authMessage').textContent='إذا البريد مسجل، يصلك رابط استعادة كلمة المرور.';return;}
  if(state.authMode==='recovery'){result=await sb.auth.updateUser({password});if(result.error)throw result.error;$('authDialog').close();toast('تم تحديث كلمة المرور.');return;}
  if(state.authMode==='signup'){
   const phone=digits(f.elements.phone.value);if(!/^\+?[0-9]{8,15}$/.test(phone))throw new Error('اكتب رقم هاتف صحيحًا.');
   const role=f.elements.role.value;if(role==='driver'&&(!f.elements.car_make.value.trim()||!f.elements.plate.value.trim()))throw new Error('أكمل نوع السيارة ورقم اللوحة.');
   result=await sb.auth.signUp({email,password,options:{emailRedirectTo:base,data:{requested_role:role,full_name:f.elements.full_name.value.trim(),phone,governorate:f.elements.governorate.value,car_make:f.elements.car_make.value.trim(),plate:f.elements.plate.value.trim()}}});
   if(result.error)throw result.error;if(!result.data.session){$('authMessage').textContent='راجع بريدك لتأكيد التسجيل، ثم سجّل الدخول. حساب السائق يحتاج موافقة الإدارة.';return;}
  }else{result=await sb.auth.signInWithPassword({email,password});if(result.error)throw result.error;}
  $('authDialog').close();f.elements.password.value='';
 });
}
async function hydrateSession(session,event) {
 const authEpoch=++epoch;const oldId=state.user?.id;state.user=session?.user||null;
 if(oldId!==state.user?.id){stopLocation();state.profile=null;state.rides=[];state.stats=null;latestDriverLocation=null;clearRoute();renderAll();if(channel){await sb.removeChannel(channel);channel=null;}}
 if(!state.user){connection(navigator.onLine?'الخدمة جاهزة':'غير متصل',navigator.onLine);renderProfile();return;}
 try{
  const {data,error}=await sb.from('taxi_profiles').select('*').eq('id',state.user.id).single();if(error)throw error;if(authEpoch!==epoch)return;state.profile=data;state.region=REGIONS[data.governorate]?data.governorate:'karbala';$('regionSelect').value=state.region;
  if(!channel){channel=sb.channel('taxi-live-'+state.user.id).on('postgres_changes',{event:'*',schema:'public',table:'taxi_rides'},()=>refreshData()).on('postgres_changes',{event:'*',schema:'public',table:'taxi_profiles'},()=>{setTimeout(()=>hydrateSession({user:state.user},'PROFILE_CHANGED'),0);}).on('postgres_changes',{event:'*',schema:'public',table:'taxi_driver_locations'},()=>refreshData()).subscribe();}
  await refreshData();if(state.view==='profile')renderProfile();if(state.view==='driver'){initDriverMap();setTimeout(()=>driverMap?.invalidateSize(),50);}
  if(event==='SIGNED_IN'&&state.profile.role==='driver'&&state.view==='book')goScreen('driver');
  if(event==='PASSWORD_RECOVERY')openAuth('recovery');
 }catch(error){connection('تعذر تحميل الحساب');toast(errorText(error));}
}
async function logout() {
 stopLocation();if(state.profile?.role==='driver'&&state.profile.is_online)try{await rpc('taxi_set_online',{p_online:false});}catch(error){}
 const {error}=await sb.auth.signOut({scope:'local'});if(error)throw error;goScreen('book');
}
function stopLocation() {if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;}$('shareLocation').checked=false;}
async function toggleLocation(enabled) {
 if(!enabled){stopLocation();await rpc('taxi_share_location',{p_lat:null,p_lng:null});latestDriverLocation=null;drawDriverRoute();return;}
 if(!state.profile?.is_online||!state.profile?.is_approved){$('shareLocation').checked=false;throw new Error('فعّل استقبال الطلبات أولًا.');}
 if(!navigator.geolocation){$('shareLocation').checked=false;throw new Error('متصفحك لا يدعم تحديد الموقع.');}
 watchId=navigator.geolocation.watchPosition(async pos=>{
  if(document.hidden||Date.now()-lastLocationSent<10000)return;
  const point={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!inBounds(point))return;lastLocationSent=Date.now();
  try{await rpc('taxi_share_location',{p_lat:point.lat,p_lng:point.lng});latestDriverLocation={latitude:point.lat,longitude:point.lng,updated_at:new Date().toISOString()};drawDriverRoute();}catch(error){toast(errorText(error));}
 },()=>{stopLocation();toast('تعذر الوصول لموقعك. تأكد من إذن الموقع.');},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
}
async function handleAction(button) {
 const action=button.dataset.action;
 if(action==='account'){if(state.user)goScreen('profile');else openAuth();return;}
 if(action==='close-auth'){$('authDialog').close();return;}
 if(action==='forgot-password'){setAuthMode('forgot');return;}
 if(action==='register-driver'){openAuth('signup');$('authForm').elements.role.value='driver';$('signupVehicle').hidden=false;return;}
 if(action==='locate'){locateMe();return;}
 if(action==='clear-route'){clearRoute();return;}
 if(action==='fit-route'){fitRoute();return;}
 if(action==='track'){goScreen('book');fitRoute();return;}
 if(action==='refresh'){await busy(button,refreshData);return;}
 await busy(button,async()=>{
  if(action==='book'){await submitOrder();return;}
  if(!requireLogin())return;
  if(action==='logout'){await logout();return;}
  if(action==='online'){
   const online=!state.profile.is_online;if(!online)await toggleLocation(false);
   state.profile=await rpc('taxi_set_online',{p_online:online});await refreshData();return;
  }
  if(action==='accept'){await rpc('taxi_accept_ride',{p_id:button.dataset.id});await refreshData();toast('تم قبول الطلب. تواصل مع الزبون لتأكيد التفاصيل.');return;}
  if(action==='advance'){await rpc('taxi_transition_ride',{p_id:button.dataset.id,p_status:button.dataset.status});await refreshData();toast('تم تحديث حالة الرحلة.');return;}
  if(action==='cancel'){if(!confirm('تريد تلغي هذه الرحلة؟'))return;await rpc('taxi_transition_ride',{p_id:button.dataset.id,p_status:'cancelled'});await refreshData();return;}
  if(action==='approve'){await rpc('taxi_approve_driver',{p_id:button.dataset.id,p_approved:button.dataset.approved==='true'});await refreshData();return;}
  if(action==='delete-account'){if(!confirm('تريد إرسال طلب حذف حسابك وبياناتك للإدارة؟'))return;await rpc('taxi_request_deletion');toast('تم إرسال طلب الحذف للإدارة. هذا طلب مراجعة، وسيتم التواصل معك.');}
 });
}
async function boot() {
 fillRegions();initCustomerMap();updatePricePreview();renderAll();
 document.addEventListener('click',event=>{
  const button=event.target.closest('button,a');if(!button)return;
  if(button.dataset.view){event.preventDefault();goScreen(button.dataset.view);return;}
  if(button.dataset.mapMode){setMapMode(button.dataset.mapMode);return;}
  if(button.dataset.service){state.service=button.dataset.service;document.querySelectorAll('[data-service]').forEach(b=>b.classList.toggle('active',b===button));updatePricePreview();return;}
  if(button.dataset.authMode){setAuthMode(button.dataset.authMode);return;}
  if(button.dataset.action){event.preventDefault();handleAction(button).catch(error=>toast(errorText(error)));}
 });
 $('regionSelect').addEventListener('change',event=>{state.region=event.target.value;clearRoute();customerMap?.setView(REGIONS[state.region].center,12);});
 $('authForm').addEventListener('submit',handleAuth);
 $('authForm').elements.role.forEach(input=>input.addEventListener('change',()=>{$('signupVehicle').hidden=$('authForm').elements.role.value!=='driver';}));
 $('profileForm').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{const f=event.target;state.profile=await rpc('taxi_save_profile',{p_name:f.elements.full_name.value.trim(),p_phone:digits(f.elements.phone.value),p_region:f.elements.governorate.value,p_car:f.elements.car_make.value.trim(),p_plate:f.elements.plate.value.trim()});renderProfile();toast('تم حفظ ملفك الشخصي.');});});
 $('faresEditor').addEventListener('submit',event=>{event.preventDefault();busy(event.submitter,async()=>{const f=event.target;await rpc('taxi_save_fare',{p_service:f.dataset.fare,p_base:Number(f.elements.base.value),p_per_km:Number(f.elements.per_km.value),p_minimum:Number(f.elements.minimum.value)});await refreshData();toast('تم حفظ التسعيرة.');});});
 $('shareLocation').addEventListener('change',event=>toggleLocation(event.target.checked).catch(error=>{event.target.checked=false;toast(errorText(error));}));
 window.addEventListener('popstate',()=>goScreen(location.hash.slice(1),false));
 window.addEventListener('offline',()=>connection('غير متصل'));
 window.addEventListener('online',()=>{connection('جاري إعادة الاتصال');refreshData();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshData();heartbeat();}});
 goScreen(location.hash.slice(1),false);
 const cfg=window.TAXI_CONFIG||{};let configured=false;
 try{const u=new URL(cfg.supabaseUrl);configured=u.protocol==='https:'&&Boolean(cfg.publishableKey)&&!cfg.publishableKey.startsWith('sb_secret_');if(cfg.publishableKey?.startsWith('eyJ')){const payload=JSON.parse(atob(cfg.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role==='service_role')configured=false;}}catch(error){}
 $('setupNotice').hidden=configured;
 if(!configured){$('bookButton').disabled=true;$('bookButton').textContent='الطلبات تتفعّل بعد ربط الخدمة';connection('بانتظار الربط');return;}
 try{
  sb=TaxiSupabase.createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'iraq-taxi-auth-v1'}});
  connection('الخدمة جاهزة',true);
  sb.auth.onAuthStateChange((event,session)=>{setTimeout(()=>hydrateSession(session,event),0);});
  const {data,error}=await sb.from('taxi_fares').select('*').order('base_fare');if(error)throw error;if(data?.length){state.fares=data;updatePricePreview();}
  refreshTimer=setInterval(()=>{if(!document.hidden)refreshData();},15000);setInterval(heartbeat,30000);
 }catch(error){connection('تعذر ربط الخدمة');$('setupNotice').hidden=false;toast(errorText(error));}
}
async function heartbeat(){if(!sb||document.hidden||state.profile?.role!=='driver'||!state.profile.is_online)return;try{state.profile=await rpc('taxi_set_online',{p_online:true});}catch(error){stopLocation();state.profile.is_online=false;renderDriver();}}
boot().catch(error=>{console.error(error);toast('تعذر بدء الموقع. جرّب تحديث الصفحة.');});

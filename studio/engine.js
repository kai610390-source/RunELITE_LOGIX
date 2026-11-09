/* SurfaceStride Studio routing helpers. No accounts or proprietary services. */
(function(){
'use strict';
const FOOT='https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
const VAL='https://valhalla1.openstreetmap.de/route';
const MI=1609.344,RAD=Math.PI/180;
const routeCache=new Map(),overlayCache=new Map();
const root=window.SurfaceStrideStudioEngine={};
const d=(a,b)=>{
 const dy=(b[0]-a[0])*RAD,dx=(b[1]-a[1])*RAD;
 const t=Math.sin(dy/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(dx/2)**2;
 return 12742017.6*Math.asin(Math.min(1,Math.sqrt(t)));
};
function withTimeout(url,opt={},milliseconds=16000){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),milliseconds);
 return fetch(url,{...opt,signal:ctrl.signal}).then(async response=>{
  if(!response.ok)throw Error('Routing service returned HTTP '+response.status);
  return response.json();
 }).finally(()=>clearTimeout(timer));
}
function toPoints(points){
 if(points.length<2||points.length>16)throw Error('Please use 2–16 route points.');
 return points.map(p=>p.lon.toFixed(6)+','+p.lat.toFixed(6)).join(';');
}
function readPolyline6(s){
 if(!s)return [];
 const out=[];let i=0,la=0,lo=0;
 const next=()=>{let v=0,shift=0,b;do{
  if(i>=s.length||shift>30)throw Error('Invalid route geometry');
  b=s.charCodeAt(i++)-63;v|=(b&31)<<shift;shift+=5;
 }while(b>=32);return v&1?~(v>>1):v>>1;};
 while(i<s.length){la+=next();lo+=next();out.push([la/1e6,lo/1e6]);}
 return out;
}
function parseValhalla(data){
 if(!data?.trip?.legs?.length)throw Error(data?.error||'No foot route returned');
 const coordinates=[],directions=[];
 for(const leg of data.trip.legs){
  const part=readPolyline6(leg.shape||'');
  for(const m of leg.maneuvers||[]){
   const pt=part[Math.max(0,Math.min(part.length-1,m.begin_shape_index||0))];
   if(pt)directions.push({name:(m.street_names||[]).filter(Boolean).join(', ')||'Unnamed path',
     instruction:m.instruction||'Continue',lat:pt[0],lon:pt[1]});
  }
  if(coordinates.length&&part.length)part.shift();
  coordinates.push(...part);
 }
 return {coordinates,directions,provider:'Valhalla walking'};
}
function parseOSRM(data){
 if(data?.code!=='Ok'||!data.routes?.length)throw Error(data?.code||'No connected walking route found');
 const r=data.routes[0],coords=r.geometry?.coordinates;
 if(!Array.isArray(coords)||coords.length<2)throw Error('Routing returned no line');
 const directions=[];
 for(const leg of r.legs||[])for(const step of leg.steps||[]){
  const name=(step.name||step.ref||'').trim()||'Unnamed path';
  const m=step.maneuver||{};
  if(m.type==='arrive')continue;
  const mod=(m.modifier||'').replace('_',' ');
  let instruction=m.type==='depart'?'Start on '+name:
   m.type==='continue'||m.type==='new name'?'Continue on '+name:
   m.type==='roundabout'?'Enter roundabout toward '+name:
   (mod?'Turn '+mod:'Continue')+' onto '+name;
  if(Number.isFinite(m.location?.[0])&&Number.isFinite(m.location?.[1]))
    directions.push({name,instruction,lat:m.location[1],lon:m.location[0],distance_m:step.distance||0});
 }
 return {coordinates:coords.map(x=>[x[1],x[0]]),directions,provider:'OSRM walking'};
}
function routeObject(raw,mode='point-to-point',label='Custom route'){
 const points=raw.coordinates;
 if(!points?.length||points.length<2)throw Error('Route is empty');
 const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]+d(points[i-1],points[i]));
 const total=distances[distances.length-1];
 if(total<15)throw Error('Route too short');
 const checkpoints=[.16,.34,.52,.70,.87].map(f=>{
  const target=total*f;let ix=1;while(ix<distances.length-1&&distances[ix]<target)ix++;
  const p=points[ix];
  return {lat:p[0],lon:p[1],surface:'unknown',evidence:'unverified',
   name:'Surface inspection point',at_mile:Number((target/MI).toFixed(2))};
 });
 return {id:1,title:label,mode,distance_m:Math.round(total),distance_miles:Number((total/MI).toFixed(2)),
  coordinates:points,spans:[{surface:'unknown',points}],checkpoints,directions:raw.directions||[],
  road_names:[...new Set((raw.directions||[]).map(x=>x.name).filter(x=>x&&x!=='Unnamed path'))],
  surface_percent:{grass:0,dirt:0,gravel:0,paved:0,track:0,unknown:100},
  match_percent:0,tagged_percent:0,inferred_percent:0,unknown_percent:100,
  route_provider:raw.provider,elevation_status:'unavailable',reviewed_sections:0};
}
async function snapRoute(points){
 const key=points.map(p=>p.lat.toFixed(5)+','+p.lon.toFixed(5)).join('|');
 if(routeCache.has(key))return routeCache.get(key);
 let raw,errors=[];
 try{
  const uri=FOOT+toPoints(points)+'?overview=full&geometries=geojson&steps=true&continue_straight=false';
  raw=parseOSRM(await withTimeout(uri,{},16000));
 }catch(err){errors.push('OSRM: '+(err?.message||err));}
 if(!raw)try{
  const params={locations:points.map(p=>({lat:p.lat,lon:p.lon})),costing:'pedestrian',units:'kilometers'};
  const url=VAL+'?json='+encodeURIComponent(JSON.stringify(params));
  raw=parseValhalla(await withTimeout(url,{},17000));
 }catch(err){errors.push('Valhalla: '+(err?.message||err));}
 if(!raw)throw Error('No pedestrian route available. '+errors.join(' · '));
 const result=routeObject(raw,'point-to-point','Custom route');
 routeCache.set(key,result);if(routeCache.size>35)routeCache.delete(routeCache.keys().next().value);
 return result;
}
function directRoute(points){
 const coordinates=points.map(p=>[p.lat,p.lon]);
 return routeObject({coordinates,directions:[],provider:'Manual straight-line sketch'},'point-to-point','Manual route');
}
function parseNative(text){
 let data;
 if(text.trimStart().startsWith('{'))data=JSON.parse(text);
 else if(text.trimStart().startsWith('<')){
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid OSM XML');
  const elements=[];
  for(const node of doc.getElementsByTagName('node'))elements.push({
   type:'node',id:Number(node.getAttribute('id')),lat:Number(node.getAttribute('lat')),lon:Number(node.getAttribute('lon'))});
  for(const w of doc.getElementsByTagName('way')){
   const tags={};for(const t of w.getElementsByTagName('tag'))tags[t.getAttribute('k')]=t.getAttribute('v');
   elements.push({type:'way',id:Number(w.getAttribute('id')),
    nodes:Array.from(w.getElementsByTagName('nd'),n=>Number(n.getAttribute('ref'))),tags});
  }
  data={elements};
 }else throw Error('Unsupported OSM response');
 if(!window.SurfaceStrideSurfaceTags?._test?.parseElements)throw Error('Surface library unavailable');
 return window.SurfaceStrideSurfaceTags._test.parseElements(data);
}
async function nearbyGravel(c){
 const lon=Number.isFinite(c.lon)?c.lon:c.lng;
 if(!Number.isFinite(lon)||!Number.isFinite(c.lat))throw Error('Map location unavailable');
 const meters=470,dy=meters/111195,dx=meters/(111195*Math.max(.15,Math.cos(c.lat*RAD)));
 const box=[lon-dx,c.lat-dy,lon+dx,c.lat+dy].map(n=>n.toFixed(6)).join(',');
 if(overlayCache.has(box))return overlayCache.get(box);
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),17000);
 try{
  const r=await fetch('https://api.openstreetmap.org/api/0.6/map?bbox='+box,{headers:{Accept:'application/json'},signal:ctrl.signal});
  if(!r.ok)throw Error('OSM returned '+r.status);
  const text=await r.text();
  if(text.length>25000000)throw Error('Map extract is too large');
  const all=parseNative(text);
  const out=all.filter(s=>['gravel','grass','dirt','track'].includes(s.surface));
  overlayCache.set(box,out);if(overlayCache.size>12)overlayCache.delete(overlayCache.keys().next().value);
  return out;
 }finally{clearTimeout(timer);}
}
function sample(points,max=65){
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+d(points[i-1],points[i]));
 const total=lengths.at(-1),samples=[];let idx=1;
 for(let i=0;i<max;i++){
  const at=total*i/(max-1);
  while(idx<lengths.length-1&&lengths[idx]<at)idx++;
  const prev=points[idx-1],cur=points[idx],span=lengths[idx]-lengths[idx-1]||1;
  const t=Math.max(0,Math.min(1,(at-lengths[idx-1])/span));
  samples.push({lat:prev[0]+(cur[0]-prev[0])*t,lon:prev[1]+(cur[1]-prev[1])*t,miles:at/MI});
 }
 return samples;
}
async function elevation(route){
 const coords=route.coordinates;if(!coords||coords.length<2)return null;
 const samples=sample(coords,Math.min(85,Math.max(16,Math.ceil(route.distance_miles*4))));
 const lat=samples.map(p=>p.lat.toFixed(5)).join(','),lon=samples.map(p=>p.lon.toFixed(5)).join(',');
 const url='https://api.open-meteo.com/v1/elevation?latitude='+lat+'&longitude='+lon;
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),17000);
 try{
  const response=await fetch(url,{signal:ctrl.signal});
  if(!response.ok)throw Error('Elevation server HTTP '+response.status);
  const data=await response.json();
  if(!Array.isArray(data.elevation)||data.elevation.length!==samples.length)throw Error('Elevation data incomplete');
  const profile=[];let gain=0,loss=0,prev=null;
  for(let i=0;i<samples.length;i++){
   const v=Number(data.elevation[i]);if(!Number.isFinite(v))continue;
   if(prev!==null){if(v>prev)gain+=v-prev;else loss+=prev-v;}prev=v;
   profile.push({mile:samples[i].miles,ft:v*3.28084,meters:v});
  }
  return {profile,gain_ft:Math.round(gain*3.28084),loss_ft:Math.round(loss*3.28084)};
 }finally{clearTimeout(timer);}
}
async function weather(center){
 const lon=Number.isFinite(center.lon)?center.lon:center.lng;
 if(!Number.isFinite(lon)||!Number.isFinite(center.lat))throw Error('Map location unavailable');
 const url='https://api.open-meteo.com/v1/forecast?latitude='+center.lat.toFixed(5)+
  '&longitude='+lon.toFixed(5)+'&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m'+
  '&temperature_unit=fahrenheit&wind_speed_unit=mph';
 const body=await withTimeout(url,{},14000);
 if(!body.current)throw Error('Weather unavailable');
 return body.current;
}
function gpx(route){
 const name='SurfaceStride Studio '+route.distance_miles.toFixed(2)+' mi';
 const escaped=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const track=route.coordinates.map(p=>'<trkpt lat="'+p[0].toFixed(7)+'" lon="'+p[1].toFixed(7)+'"></trkpt>').join('\n');
 return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="SurfaceStride Studio"><metadata><name>'+
  escaped(name)+'</name></metadata><trk><name>'+escaped(name)+'</name><trkseg>\n'+track+'\n</trkseg></trk></gpx>';
}
Object.assign(root,{snapRoute,directRoute,routeObject,nearbyGravel,elevation,weather,gpx,distance:d,
 _test:{parseOSRM,parseValhalla,parseNative,readPolyline6,sample}});
})();
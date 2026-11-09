/* SurfaceStride pedestrian router. Uses public FOSSGIS routing demos.
   A walking route is not a verified gravel route; surface stays UNKNOWN. */
(function(){
'use strict';
const MI=1609.344,DEG=Math.PI/180;
const OSRM='https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
const VALHALLA='https://valhalla1.openstreetmap.de/route';
const cache=new Map();
function destination(p,bearing,meters){
  const c=Math.cos(p.lat*DEG);
  return {lat:p.lat+meters*Math.cos(bearing*DEG)/111195,lon:p.lon+meters*Math.sin(bearing*DEG)/(111195*Math.max(.15,c))};
}
function points(opts,scale=1){
  const start={lat:opts.lat,lon:opts.lon},meters=opts.miles*MI*scale;
  if(opts.mode==='out-and-back')return [start,destination(start,62,meters*.42)];
  const r=meters*.185,shift=(Math.abs(Math.round(opts.lon*1000))%4)*45;
  return [start,destination(start,25+shift,r),destination(start,135+shift,r),
    destination(start,245+shift,r),start];
}
function asCoords(p){return p.lon.toFixed(6)+','+p.lat.toFixed(6)}
function fromOSRM(body,opts){
  if(body?.code!=='Ok'||!body.routes?.length)throw Error(body?.message||body?.code||'No walking route returned');
  const r=body.routes[0],coords=r.geometry?.coordinates;
  if(!Array.isArray(coords)||coords.length<2||!Number.isFinite(r.distance))throw Error('Invalid walking route geometry');
  const points=coords.map(p=>[Number(p[1]),Number(p[0])]);
  if(opts.mode==='out-and-back')points.push(...points.slice(0,-1).reverse());
  return {distance_m:opts.mode==='out-and-back'?r.distance*2:r.distance,coordinates:points,provider:'OSRM pedestrian'};
}
function polyline6(data){
  let lat=0,lon=0,i=0,output=[];
  while(i<data.length){
    const part=()=>{
      let v=0,shift=0,b;
      do{if(i>=data.length)throw Error('Bad route geometry');b=data.charCodeAt(i++)-63;v|=(b&31)<<shift;shift+=5;if(shift>35)throw Error('Bad geometry');}while(b>=32);
      return v&1?~(v>>1):v>>1;
    };
    lat+=part();lon+=part();output.push([lat/1e6,lon/1e6]);
  }
  return output;
}
function fromValhalla(data,opts){
  if(!data?.trip?.legs?.length)throw Error(data?.error||'No walking path returned');
  const coords=[];
  for(const leg of data.trip.legs){
    const part=polyline6(leg.shape||'');
    if(coords.length&&part.length)part.shift();
    coords.push(...part);
  }
  if(coords.length<2)throw Error('Empty walking route');
  if(opts.mode==='out-and-back')coords.push(...coords.slice(0,-1).reverse());
  const meters=Number(data.trip.summary?.length)*1000*(opts.mode==='out-and-back'?2:1);
  return {coordinates:coords,distance_m:meters,provider:'Valhalla pedestrian'};
}
function distance(a,b){
  const dlat=(a[0]-b[0])*DEG,dlon=(a[1]-b[1])*DEG;
  const t=Math.sin(dlat/2)**2+Math.cos(a[0]*DEG)*Math.cos(b[0]*DEG)*Math.sin(dlon/2)**2;
  return 12742017.6*Math.asin(Math.min(1,Math.sqrt(t)));
}
function toRoute(raw,opts){
  const coords=raw.coordinates;
  let sum=0;const running=[0];
  for(let i=1;i<coords.length;i++){sum+=distance(coords[i-1],coords[i]);running.push(sum);}
  let m=Number(raw.distance_m);
  // Prefer geometry length if provider distance is absent or inconsistent.
  if(!Number.isFinite(m)||m<30||Math.abs(m-sum)/Math.max(m,sum)>.25)m=sum;
  const cps=[.16,.34,.52,.7,.87].map(f=>{
    const at=m*f;let idx=1;
    while(idx<running.length-1&&running[idx]/sum*m<at)idx++;
    return {lat:coords[idx][0],lon:coords[idx][1],surface:'unknown',
      evidence:'unverified',name:'Surface inspection point',at_mile:Number((at/MI).toFixed(2))};
  });
  return {id:1,title:'Pedestrian route',mode:opts.mode,distance_m:Math.round(m),
    distance_miles:Number((m/MI).toFixed(2)),distance_to_start_m:0,
    coordinates:coords,spans:[{surface:'unknown',points:coords}],checkpoints:cps,
    surface_percent:{grass:0,dirt:0,gravel:0,paved:0,track:0,unknown:100},
    tagged_percent:0,inferred_percent:0,unknown_percent:100,road_percent:0,
    gravel_sections:0,gravel_miles:0,reviewed_sections:0,reviewed_miles:0,match_percent:0,
    route_source:raw.provider};
}
function withTimeout(url,config={},limit=12500){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),limit);
  return fetch(url,{...config,signal:c.signal}).then(async r=>{
    if(!r.ok)throw Error('HTTP '+r.status);
    return r.json();
  }).finally(()=>clearTimeout(t));
}
async function osrmRoute(opts,scale){
  const coords=points(opts,scale).map(asCoords).join(';');
  const url=OSRM+coords+'?overview=full&geometries=geojson&steps=false&continue_straight=false';
  return fromOSRM(await withTimeout(url,{},13000),opts);
}
async function valhallaRoute(opts,scale){
  const ps=points(opts,scale);
  // GET avoids a browser preflight on restrictive school networks.
  const json=JSON.stringify({locations:ps.map(p=>({lat:p.lat,lon:p.lon})),
    costing:'pedestrian',units:'kilometers',directions_options:{units:'kilometers'}});
  const url=VALHALLA+'?json='+encodeURIComponent(json);
  return fromValhalla(await withTimeout(url,{},13000),opts);
}
async function plan(opts){
  if(!(opts.miles>=1&&opts.miles<=25))throw Error('Choose between 1 and 25 miles.');
  const key=[opts.lat.toFixed(4),opts.lon.toFixed(4),opts.miles,opts.mode].join('|');
  const saved=cache.get(key);if(saved&&Date.now()-saved.time<15*60*1000)return saved.result;
  let raw,provider,errors=[];
  for(const p of ['OSRM','Valhalla']){
    try{raw=p==='OSRM'?await osrmRoute(opts,1):await valhallaRoute(opts,1);provider=p;break;}
    catch(e){errors.push(p+': '+(e.name==='AbortError'?'timed out':e.message));}
  }
  if(!raw)throw Error('Pedestrian routing unavailable. '+errors.join(' | ')+'. Check Walking router in the connection test.');
  // Calibrate once at most, respecting the public router's 1 request/sec limit.
  const ratio=opts.miles*MI/raw.distance_m;
  if(Number.isFinite(ratio)&&(ratio<.74||ratio>1.28)){
    await new Promise(resolve=>setTimeout(resolve,1200));
    try{
      const adjust=Math.max(.55,Math.min(1.65,ratio));
      const next=provider==='OSRM'?await osrmRoute(opts,adjust):await valhallaRoute(opts,adjust);
      if(Math.abs(next.distance_m-opts.miles*MI)<Math.abs(raw.distance_m-opts.miles*MI))raw=next;
    }catch(e){/* Preserve the valid first route on calibration failure. */}
  }
  const route=toRoute(raw,opts),difference=Math.abs(route.distance_miles-opts.miles)/opts.miles;
  const warnings=['Pedestrian routing only: exact surface type is not supplied by this service.',
    'Satellite Scout paths are shown for inspection but are not automatically added to this pedestrian router.'];
  if(difference>.18)warnings.push('Closest calculated distance differs from requested mileage; the displayed miles are actual estimated distance.');
  const result={routes:[route],source:'FOSSGIS '+raw.provider,
    warnings,surface_ways:[],reviewed_connected:0,limited_coverage:false,
    pedestrian_only:true,network_nodes:0,
    requested_start:{lat:opts.lat,lon:opts.lon},
    start:{lat:route.coordinates[0][0],lon:route.coordinates[0][1]},
    route_provider:raw.provider};
  cache.set(key,{time:Date.now(),result});if(cache.size>10)cache.delete(cache.keys().next().value);
  return result;
}
window.SurfaceStrideWalking={plan,_test:{points,fromOSRM,polyline6,fromValhalla,toRoute,destination}};
})();

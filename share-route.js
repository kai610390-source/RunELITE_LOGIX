/* Shareable SurfaceStride route links with encoded coordinates; no server or account. */
(function(){
'use strict';
const MI=1609.344;
function num(n){
  let a=n<0?~(n<<1):(n<<1),out='';
  while(a>=32){out+=String.fromCharCode((32|(a&31))+63);a>>=5;}
  return out+String.fromCharCode(a+63);
}
function read(str,pos){
  let shift=0,v=0;
  while(true){
    if(pos.i>=str.length||shift>30)throw Error('Invalid route link.');
    const b=str.charCodeAt(pos.i++)-63;
    if(b<0||b>63)throw Error('Invalid route link.');
    v|=(b&31)<<shift;shift+=5;
    if(b<32)break;
  }
  return v&1?~(v>>1):v>>1;
}
function encode(points){
  if(!Array.isArray(points)||points.length<2||points.length>15000)throw Error('Route is not shareable.');
  let la=0,lo=0,s='';
  for(const c of points){
    if(!Array.isArray(c)||!Number.isFinite(c[0])||!Number.isFinite(c[1])||
       Math.abs(c[0])>85||Math.abs(c[1])>180)throw Error('Invalid route coordinate.');
    const lat=Math.round(c[0]*1e5),lon=Math.round(c[1]*1e5);
    s+=num(lat-la)+num(lon-lo);la=lat;lo=lon;
  }
  return s;
}
function decode(raw){
  if(!raw||raw.length>65000)throw Error('Oversized or missing route.');
  const p={i:0},points=[];let la=0,lo=0;
  while(p.i<raw.length){
    la+=read(raw,p);lo+=read(raw,p);
    const lat=la/1e5,lon=lo/1e5;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)throw Error('Invalid coordinate.');
    points.push([lat,lon]);if(points.length>15000)throw Error('Too many points.');
  }
  if(points.length<2)throw Error('Incomplete route.');
  return points;
}
function meters(a,b){
  const r=Math.PI/180,dl=(b[0]-a[0])*r,dn=(b[1]-a[1])*r;
  const h=Math.sin(dl/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dn/2)**2;
  return 12742017.6*Math.asin(Math.min(1,Math.sqrt(h)));
}
function link(route,href){
  if(!route?.coordinates?.length)throw Error('Generate a route first.');
  // Link points are down-sampled if needed; full resolution remains in the GPX download.
  const coords=route.coordinates, max=3000,short=coords.length>max?
    Array.from({length:max},(_,i)=>coords[Math.round(i*(coords.length-1)/(max-1))]):coords;
  const u=new URL(href||location.href);u.search='';u.hash='';
  const q=new URLSearchParams();
  q.set('r',encode(short));q.set('m',route.mode==='out-and-back'?'out-and-back':'loop');
  if(route.road_names?.length)q.set('n',route.road_names.slice(0,24).join(' | ').slice(0,600));
  u.hash=q.toString();
  return u.toString();
}
function restore(hash){
  if(typeof hash!=='string'||!hash.startsWith('#r='))return null;
  const query=new URLSearchParams(hash.slice(1)),coordinates=decode(query.get('r')||'');
  let total=0;const distances=[0];
  for(let i=1;i<coordinates.length;i++){total+=meters(coordinates[i-1],coordinates[i]);distances.push(total);}
  if(total<30||total>70000)throw Error('Shared route length is unsupported.');
  const checkpoints=[.16,.34,.52,.7,.87].map(f=>{
    let i=1;while(i<distances.length-1&&distances[i]<total*f)i++;
    return {lat:coordinates[i][0],lon:coordinates[i][1],surface:'unknown',evidence:'unverified',
      name:'Surface inspection point',at_mile:Number((total*f/MI).toFixed(2))};
  });
  const names=(query.get('n')||'').split(' | ').filter(Boolean).slice(0,24);
  const route={id:1,title:'Shared running route',mode:query.get('m')==='out-and-back'?'out-and-back':'loop',
    distance_m:Math.round(total),distance_miles:Number((total/MI).toFixed(2)),distance_to_start_m:0,
    coordinates,spans:[{surface:'unknown',points:coordinates}],checkpoints,
    road_names:names,directions:[],elevation_status:'unavailable',
    surface_percent:{grass:0,dirt:0,gravel:0,paved:0,track:0,unknown:100},
    tagged_percent:0,inferred_percent:0,unknown_percent:100,road_percent:0,
    gravel_sections:0,gravel_miles:0,reviewed_sections:0,reviewed_miles:0,match_percent:0};
  return {routes:[route],source:'Shareable route link',warnings:['Surfaces on a shared link are not verified.'],
    surface_ways:[],reviewed_connected:0,limited_coverage:false,pedestrian_only:true};
}
window.SurfaceStrideShare={link,restore,_test:{encode,decode,meters}};
})();

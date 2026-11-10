/* SurfaceStride random training: prefer actual mapped pedestrian trail geometry.
 * Uses public OpenStreetMap data, excludes restricted ways and sidewalks.
 * Cached per Austin sample zone to avoid repeated per-image requests.
 * A mapped way is NOT proof of surface type or legal access.
 */
(function(){
'use strict';
const RAD=Math.PI/180,RESTRICTIONS=new Set(['no','private','customers','permit']);
const OPEN=new Set(['yes','designated','permissive','official']);
const HIGHWAYS=new Set(['path','footway','track','bridleway']);
const cache=new Map();
let failures=0;
function distance(a,b){
 const lat=(a.lat+b.lat)*RAD/2;
 return Math.hypot((a.lat-b.lat)*111195,(a.lon-b.lon)*111195*Math.cos(lat));
}
function allowed(t){
 if(!HIGHWAYS.has(t.highway)||t.highway==='construction')return false;
 if(RESTRICTIONS.has(t.foot))return false;
 if(RESTRICTIONS.has(t.access)&&!OPEN.has(t.foot))return false;
 if(t.footway==='sidewalk'||t.footway==='crossing'||t.footway==='traffic_island')return false;
 if(t.motor_vehicle==='yes'&&t.highway==='track'&&t.surface==='asphalt')return false;
 return true;
}
function parseElements(elements){
 const nodes=new Map(),segments=[];
 for(const e of elements){
  if(e.type==='node'&&Number.isFinite(Number(e.lat))&&Number.isFinite(Number(e.lon)))
   nodes.set(Number(e.id),{lat:Number(e.lat),lon:Number(e.lon)});
 }
 for(const way of elements)if(way.type==='way'&&Array.isArray(way.nodes)&&allowed(way.tags||{})){
  const t=way.tags||{};
  for(let i=1;i<way.nodes.length;i++){
   const a=nodes.get(Number(way.nodes[i-1])),b=nodes.get(Number(way.nodes[i]));
   if(!a||!b)continue;
   const length=distance(a,b);
   if(length<3||length>300)continue;
   const soft=['gravel','fine_gravel','compacted','dirt','ground','earth','grass','sand','soil'].includes(t.surface);
   const likely=t.highway==='path'||(t.highway==='track'&&t.tracktype!=='grade1');
   const confidence=soft?3:likely?2:1;
   segments.push({a,b,length,confidence,name:t.name||'Unnamed mapped trail',highway:t.highway,
    surface:t.surface||'unknown',wayId:way.id});
  }
 }
 return segments;
}
function fromXML(xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid OSM map XML');
 const nodes=[],ways=[];
 for(const n of doc.getElementsByTagName('node'))
  nodes.push({type:'node',id:Number(n.getAttribute('id')),
   lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))});
 for(const w of doc.getElementsByTagName('way')){
  const tags={},refs=[];
  for(const n of w.getElementsByTagName('nd'))refs.push(Number(n.getAttribute('ref')));
  for(const t of w.getElementsByTagName('tag'))tags[t.getAttribute('k')]=t.getAttribute('v');
  ways.push({type:'way',id:Number(w.getAttribute('id')),nodes:refs,tags});
 }
 return nodes.concat(ways);
}
async function load(zone,{fetcher=fetch,timeout=6500}={}){
 const cacheKey=zone.name||zone.lat.toFixed(3)+':'+zone.lon.toFixed(3);
 if(cache.has(cacheKey)){
  const record=cache.get(cacheKey);
  if(Date.now()-record.time<(record.failed?120000:25*60000))return record.items;
 }
 if(failures>=3)return [];
 const radius=Math.min(430,Math.max(240,Number(zone.r||360)*.48));
 const dy=radius/111195,dx=radius/(111195*Math.max(.15,Math.cos(zone.lat*RAD)));
 const bbox=[zone.lon-dx,zone.lat-dy,zone.lon+dx,zone.lat+dy].map(n=>n.toFixed(6)).join(',');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
 try{
  const res=await fetcher('https://api.openstreetmap.org/api/0.6/map?bbox='+bbox,{
   signal:ctrl.signal,headers:{Accept:'application/json, application/xml'}
  });
  if(!res.ok)throw Error('OSM HTTP '+res.status);
  const raw=await res.text();
  if(raw.length>14000000)throw Error('Map area too large');
  const els=raw.trimStart().startsWith('{')?JSON.parse(raw).elements:fromXML(raw);
  const items=parseElements(Array.isArray(els)?els:[]);
  cache.set(cacheKey,{items,time:Date.now(),failed:false});
  if(cache.size>20)cache.delete(cache.keys().next().value);
  failures=0;return items;
 }catch(err){
  failures++;
  cache.set(cacheKey,{items:[],time:Date.now(),failed:true});
  return [];
 }finally{clearTimeout(timer);}
}
function chooseSegment(items){
 if(!items.length)return null;
 const weights=items.map(s=>Math.max(2,Math.min(s.length,95))*s.confidence);
 const total=weights.reduce((a,b)=>a+b,0);
 let value=Math.random()*total;
 let index=items.length-1;
 for(let i=0;i<items.length;i++){value-=weights[i];if(value<=0){index=i;break;}}
 const seg=items[index],t=.22+Math.random()*.56;
 return {lat:seg.a.lat*(1-t)+seg.b.lat*t,
  lon:seg.a.lon*(1-t)+seg.b.lon*t,
  trailName:seg.name,highway:seg.highway,wayId:seg.wayId,
  surfaceTag:seg.surface,trailAnchor:true,
  direction:{lat:seg.b.lat-seg.a.lat,lon:seg.b.lon-seg.a.lon}};
}
async function randomInZone(zone,opts={}){
 const items=await load(zone,opts);
 const choice=chooseSegment(items);
 return choice?{...choice,zone:zone.name||'Mapped trail'}:null;
}
window.SurfaceStrideMappedTrail={randomInZone,_test:{allowed,parseElements,chooseSegment,load,
 cacheCount:()=>cache.size,clear:()=>{cache.clear();failures=0;}}};
})();
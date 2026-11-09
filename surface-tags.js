/* SurfaceStride surface tagging for pedestrian routes, independent of Overpass.
   Queries small native OpenStreetMap map extracts confirmed accessible in the user's browser.
   Only exact OSM tags are tagged; tracktype and highway guesses are visibly inferred. */
(function(){
'use strict';
const API='https://api.openstreetmap.org/api/0.6/map?bbox=';
const M=111195,MI=1609.344;
const SURFACE={
  asphalt:'paved',concrete:'paved','concrete:plates':'paved',paved:'paved',
  paving_stones:'paved',sett:'paved',cobblestone:'paved',bricks:'paved',
  gravel:'gravel',fine_gravel:'gravel',pebblestone:'gravel',
  compacted:'gravel',crushed_limestone:'gravel',
  ground:'dirt',earth:'dirt',dirt:'dirt',unpaved:'dirt',mud:'dirt',
  soil:'dirt',woodchips:'dirt',sand:'dirt',grass:'grass',grass_paver:'grass',
  rubber:'track',tartan:'track',synthetic:'track',clay:'track',acrylic:'track'
};
const VALID=new Set(['footway','path','pedestrian','track','residential',
  'living_street','service','tertiary','unclassified','cycleway','bridleway','steps',
  'primary','secondary','trunk','primary_link','secondary_link','tertiary_link']);
const ROAD=new Set(['residential','living_street','service','tertiary',
  'unclassified','primary','secondary','trunk','primary_link','secondary_link','tertiary_link']);
const TYPES=['grass','dirt','gravel','paved','track','unknown'];
const cache=new Map();
function rad(x){return x*Math.PI/180;}
function dist(a,b){
  const y=rad(b[0]-a[0]),x=rad(b[1]-a[1]);
  const h=Math.sin(y/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(x/2)**2;
  return 12742017.6*Math.asin(Math.min(1,Math.sqrt(h)));
}
function guess(t){
  const raw=(t.surface||'').trim().toLowerCase();
  if(SURFACE[raw])return {surface:SURFACE[raw],evidence:'tagged',raw};
  if(raw)return {surface:'unknown',evidence:'unknown',raw};
  if(t.tracktype==='grade2')return {surface:'gravel',evidence:'inferred',raw:'tracktype=grade2'};
  if(t.tracktype==='grade4'||t.tracktype==='grade5')return {surface:'dirt',evidence:'inferred',raw:'tracktype='+t.tracktype};
  if(ROAD.has(t.highway))return {surface:'paved',evidence:'inferred',raw:'typical road; not surface-tagged'};
  return {surface:'unknown',evidence:'unknown',raw:''};
}
function xmlToElements(text){
  if(typeof DOMParser==='undefined')throw Error('XML parser unavailable');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid OSM XML');
  const elements=[];
  for(const n of doc.getElementsByTagName('node'))elements.push({type:'node',
    id:Number(n.getAttribute('id')),lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))});
  for(const w of doc.getElementsByTagName('way')){
    const tags={};
    for(const t of w.getElementsByTagName('tag'))tags[t.getAttribute('k')]=t.getAttribute('v');
    if(!VALID.has(tags.highway))continue;
    elements.push({type:'way',id:Number(w.getAttribute('id')),
      nodes:Array.from(w.getElementsByTagName('nd'),n=>Number(n.getAttribute('ref'))),tags});
  }
  return elements;
}
function parseElements(data){
  const elements=Array.isArray(data)?data:data?.elements||[];
  const nodes=new Map();
  for(const v of elements)if(v.type==='node'&&Number.isFinite(v.lat)&&Number.isFinite(v.lon))
    nodes.set(v.id,[v.lat,v.lon]);
  const segments=[];
  for(const way of elements){
    if(way.type!=='way'||!Array.isArray(way.nodes)||!VALID.has(way.tags?.highway))continue;
    const t=way.tags;
    if(['private','no','customers','permit'].includes(t.access)&&!['yes','designated','permissive'].includes(t.foot))continue;
    const sf=guess(t);
    for(let i=1;i<way.nodes.length;i++){
      const a=nodes.get(way.nodes[i-1]),b=nodes.get(way.nodes[i]);
      if(!a||!b||dist(a,b)<.5)continue;
      segments.push({a,b,surface:sf.surface,evidence:sf.evidence,raw:sf.raw,name:t.name||'',id:way.id});
    }
  }
  return segments;
}
function centerAt(route,ratio){
  const target=ratio*route[route.length-1].total;
  let low=1,high=route.length-1;
  while(low<high){const m=(low+high)>>1;if(route[m].total<target)low=m+1;else high=m;}
  const a=route[low-1],b=route[low],t=(target-a.total)/Math.max(.0001,b.total-a.total);
  return [a.lat+(b.lat-a.lat)*t,a.lon+(b.lon-a.lon)*t];
}
function scanCenters(points, max=5){
  const route=[{lat:points[0][0],lon:points[0][1],total:0}];
  for(let i=1;i<points.length;i++)route.push({lat:points[i][0],lon:points[i][1],
    total:route[route.length-1].total+dist(points[i-1],points[i])});
  const total=route[route.length-1].total;
  const count=Math.min(max,Math.max(1,Math.ceil(total/1400))),result=[];
  for(let i=0;i<count;i++){
    const c=centerAt(route,(i+.5)/count);
    if(!result.some(p=>dist(p,c)<400))result.push(c);
  }
  return result;
}
function bbox(c){
  const half=430,dy=half/M,dx=half/(M*Math.max(.15,Math.cos(rad(c[0]))));
  return [c[1]-dx,c[0]-dy,c[1]+dx,c[0]+dy].map(x=>x.toFixed(6)).join(',');
}
async function fetchBox(c,{fetcher=fetch,timeout=11000}={}){
  const box=bbox(c),existing=cache.get(box);
  if(existing&&Date.now()-existing.time<30*60*1000)return existing.segments;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetcher(API+box,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!r.ok)throw Error('OSM HTTP '+r.status);
    const txt=await r.text();
    if(txt.length>18000000)throw Error('OSM response too large');
    const data=txt.trimStart().startsWith('{')?JSON.parse(txt):xmlToElements(txt);
    const segments=parseElements(data);
    cache.set(box,{segments,time:Date.now()});
    if(cache.size>24)cache.delete(cache.keys().next().value);
    return segments;
  }finally{clearTimeout(timer);}
}
function indexSegments(segments,lat){
  const scale=M*Math.cos(rad(lat)),grid=new Map(),cell=70;
  const point=p=>({x:p[1]*scale,y:p[0]*M});
  for(const s of segments){
    const a=point(s.a),b=point(s.b),rec={...s,ax:a.x,ay:a.y,bx:b.x,by:b.y};
    const x1=Math.floor(Math.min(a.x,b.x)/cell),x2=Math.floor(Math.max(a.x,b.x)/cell);
    const y1=Math.floor(Math.min(a.y,b.y)/cell),y2=Math.floor(Math.max(a.y,b.y)/cell);
    if((x2-x1+1)*(y2-y1+1)>150)continue;
    for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++){
      const key=x+':'+y;
      if(!grid.has(key))grid.set(key,[]);
      grid.get(key).push(rec);
    }
  }
  return {grid,scale,cell};
}
function classifyEdge(a,b,index){
  const x=((a[1]+b[1])/2)*index.scale,y=((a[0]+b[0])/2)*M;
  const dx=(b[1]-a[1])*index.scale,dy=(b[0]-a[0])*M,len=Math.hypot(dx,dy);
  if(len<.25)return {surface:'unknown',evidence:'unknown'};
  const cell=index.cell,ix=Math.floor(x/cell),iy=Math.floor(y/cell);
  let best=null,score=Infinity,visited=new Set();
  for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){
    for(const s of index.grid.get((ix+j)+':'+(iy+k))||[]){
      if(visited.has(s))continue;visited.add(s);
      const vx=s.bx-s.ax,vy=s.by-s.ay,denom=vx*vx+vy*vy;
      if(denom<.3)continue;
      const t=Math.max(0,Math.min(1,((x-s.ax)*vx+(y-s.ay)*vy)/denom));
      const distance=Math.hypot(x-s.ax-vx*t,y-s.ay-vy*t);
      if(distance>11)continue;
      const alignment=Math.abs((dx*vx+dy*vy)/(len*Math.sqrt(denom)));
      if(alignment<.53)continue;
      const merit=distance+(1-alignment)*8+(s.evidence==='tagged'?-0.75:0);
      if(merit<score){score=merit;best=s;}
    }
  }
  return best?{surface:best.surface,evidence:best.evidence,name:best.name,raw:best.raw}:
    {surface:'unknown',evidence:'unknown'};
}
function apply(route,segments,pref='soft'){
  if(!route?.coordinates?.length||route.coordinates.length<2)return route;
  const pts=route.coordinates,ix=indexSegments(segments,pts[Math.floor(pts.length/2)][0]);
  const meters=Object.fromEntries(TYPES.map(x=>[x,0]));
  const ev={tagged:0,inferred:0,unknown:0};
  const spans=[];let cur=null,all=0;
  for(let i=1;i<pts.length;i++){
    const m=dist(pts[i-1],pts[i]);if(m<.001)continue;
    const c=classifyEdge(pts[i-1],pts[i],ix);
    meters[c.surface]+=m;ev[c.evidence]+=m;all+=m;
    if(!cur||cur.surface!==c.surface||cur.evidence!==c.evidence){
      cur={surface:c.surface,evidence:c.evidence,points:[pts[i-1],pts[i]]};spans.push(cur);
    }else cur.points.push(pts[i]);
  }
  if(!all)return route;
  const pct=Object.fromEntries(TYPES.map(x=>[x,Number((100*meters[x]/all).toFixed(1))]));
  const tagged=Math.round(100*ev.tagged/all),inferred=Math.round(100*ev.inferred/all);
  const unknown=Math.max(0,100-tagged-inferred);
  const liked=pref==='soft'?['grass','dirt','track']:pref==='mixed'?
    ['grass','dirt','gravel','paved','track']:[pref];
  const share=liked.reduce((sum,x)=>sum+(pct[x]||0),0);
  return {...route,spans,surface_percent:pct,
    tagged_percent:tagged,inferred_percent:inferred,unknown_percent:unknown,
    match_percent:Math.round(Math.min(100,share)),surface_data_status:'scanned'};
}
async function enrich(route,opts={},onProgress){
  if(!route?.coordinates?.length)return route;
  const centers=scanCenters(route.coordinates,route.distance_miles>12?4:5);
  let segments=[],ok=0,errors=[];
  for(let i=0;i<centers.length;i++){
    if(i>0)await new Promise(resolve=>setTimeout(resolve,650));
    try{
      const items=await fetchBox(centers[i],opts);
      segments.push(...items);ok++;
    }catch(e){errors.push(e?.name==='AbortError'?'timeout':String(e?.message||e));}
    if(typeof onProgress==='function')onProgress({done:i+1,total:centers.length,ok});
  }
  if(!ok)return {...route,surface_data_status:'unavailable',surface_check_note:
    'Surface lookup unavailable. Walking route is still available.'};
  const updated=apply(route,segments,opts.preference||'soft');
  return {...updated,surface_scans_ok:ok,surface_scans_attempted:centers.length,
    surface_check_note:updated.tagged_percent+'% explicitly surface-tagged, '+
      updated.inferred_percent+'% inferred, '+updated.unknown_percent+'% unknown. '+
      (ok<centers.length?'Some OpenStreetMap requests failed. ':'')+
      'Coverage sampled in sections; unknown segments stay unknown.'};
}
window.SurfaceStrideSurfaceTags={enrich,_test:{guess,parseElements,scanCenters,bbox,apply,classifyEdge,indexSegments}};
})();
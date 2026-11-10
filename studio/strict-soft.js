/* SurfaceStride confirmed-soft network routing.
 * Build routes from connected OSM non-motorized ways, not walking-router results.
 * A 100% score means 100% of the ROUTE GEOMETRY has qualifying OSM tags
 * or user-reviewed labels, not physical ground-truth verification.
 * No Google Maps imagery, subscription, or third-party optimizer.
 */
(function(){
'use strict';
const R=Math.PI/180,MI=1609.344,API='https://api.openstreetmap.org/api/0.6/map?bbox=';
const TYPES=new Set(['path','footway','track','bridleway','pedestrian','cycleway']);
const HARD_NO=new Set(['private','no','customers','permit']);
const MATERIAL={
 gravel:'gravel',fine_gravel:'gravel',pebblestone:'gravel',compacted:'gravel',
 crushed_limestone:'gravel',grit:'gravel',
 ground:'dirt',earth:'dirt',dirt:'dirt',soil:'dirt',mud:'dirt',sand:'dirt',woodchips:'dirt'
};
let cache={key:null,data:null,time:0};
function meters(a,b){
 const dl=(b.lat-a.lat)*R,dn=(b.lon-a.lon)*R;
 const h=Math.sin(dl/2)**2+Math.cos(a.lat*R)*Math.cos(b.lat*R)*Math.sin(dn/2)**2;
 return 12742017.6*Math.asin(Math.min(1,Math.sqrt(h)));
}
function keyFor(id,a,b){return String(id)+':'+String(Math.min(a,b))+':'+String(Math.max(a,b));}
function access(t){
 if(HARD_NO.has(t.foot))return false;
 if(HARD_NO.has(t.access)&&!['yes','designated','permissive','official'].includes(t.foot))return false;
 if(t.highway==='proposed'||t.highway==='construction')return false;
 return TYPES.has(t.highway);
}
function material(t,review,key){
 const tag=MATERIAL[(t.surface||'').trim().toLowerCase()];
 if(tag)return {type:tag,evidence:'osm'};
 const saved=review?.[key];
 if(saved?.confirmed&&['gravel','dirt'].includes(saved.label))return {type:saved.label,evidence:'reviewed'};
 return null;
}
function graphFromElements(elements,reviews={},preference='both'){
 const nodes=new Map(),adj=new Map(),edges=[],byId=new Map();
 for(const e of elements)if(e.type==='node'){
  const lat=Number(e.lat),lon=Number(e.lon),id=Number(e.id);
  if(Number.isFinite(lat)&&Number.isFinite(lon)&&Number.isFinite(id))
    nodes.set(id,{lat,lon});
 }
 const permitted=preference==='gravel'?new Set(['gravel']):preference==='dirt'?new Set(['dirt']):new Set(['gravel','dirt']);
 const edgeKeys=new Set();
 for(const w of elements)if(w.type==='way'&&Array.isArray(w.nodes)&&access(w.tags||{})){
  const tags=w.tags;
  for(let i=1;i<w.nodes.length;i++){
   const a=Number(w.nodes[i-1]),b=Number(w.nodes[i]),pa=nodes.get(a),pb=nodes.get(b);
   if(!pa||!pb||a===b)continue;
   const id=keyFor(w.id,a,b),classification=material(tags,reviews,id);
   if(!classification||!permitted.has(classification.type))continue;
   const length=meters(pa,pb);
   if(!Number.isFinite(length)||length<.25||length>1600||edgeKeys.has(id))continue;
   edgeKeys.add(id);
   const e={a,b,id,wayId:w.id,material:classification.type,evidence:classification.evidence,
    length,name:tags.name||'Unnamed trail'};
   edges.push(e);byId.set(id,e);
   if(!adj.has(a))adj.set(a,[]);
   if(!adj.has(b))adj.set(b,[]);
   adj.get(a).push({to:b,edge:e});adj.get(b).push({to:a,edge:e});
  }
 }
 return {nodes,adj,edges,byId,material:preference};
}
function components(graph){
 const visited=new Set(),result=[];
 for(const id of graph.adj.keys())if(!visited.has(id)){
  const q=[id],set=[],seenEdges=new Set();visited.add(id);
  let length=0;
  for(let i=0;i<q.length;i++){
   const n=q[i];set.push(n);
   for(const x of graph.adj.get(n)||[]){
    if(!seenEdges.has(x.edge.id)){seenEdges.add(x.edge.id);length+=x.edge.length;}
    if(!visited.has(x.to)){visited.add(x.to);q.push(x.to);}
   }
  }
  result.push({nodes:set,edgeCount:seenEdges.size,totalLength:length});
 }
 return result.sort((a,b)=>b.totalLength-a.totalLength);
}
function pickStart(graph,center,componentsList){
 let best=null,score=Infinity;
 for(const component of componentsList){
  if(component.totalLength<25)continue;
  for(const id of component.nodes){
   const p=graph.nodes.get(id);if(!p)continue;
   const offset=meters(p,center);
   // Prefer nearby connected networks, but don't automatically jump to
   // distant popular trails if the user selected a different part of town.
   if(offset>1800)continue;
   const value=offset*2-Math.min(260,Math.sqrt(component.totalLength)*4);
   if(value<score){score=value;best={id,component,offset};}
  }
 }
 return best;
}
function shortest(graph,start,limit=Infinity){
 const dist=new Map([[start,0]]),parent=new Map(),heap=[];
 function push(n,amount){
  heap.push([amount,n]);let i=heap.length-1;
  while(i>0){let p=(i-1)>>1;if(heap[p][0]<=amount)break;heap[i]=heap[p];i=p;}heap[i]=[amount,n];
 }
 function pop(){
  const first=heap[0],last=heap.pop();
  if(heap.length){let i=0;while(true){let child=i*2+1;if(child>=heap.length)break;
   if(child+1<heap.length&&heap[child+1][0]<heap[child][0])child++;
   if(last[0]<=heap[child][0])break;heap[i]=heap[child];i=child;
  }heap[i]=last;}
  return first;
 }
 push(start,0);
 while(heap.length){
  const [value,u]=pop();
  if(value!==dist.get(u)||value>limit)continue;
  for(const n of graph.adj.get(u)||[]){
   const cand=value+n.edge.length;
   if(cand<(dist.get(n.to)??Infinity)-1e-7){
    dist.set(n.to,cand);parent.set(n.to,{node:u,edge:n.edge});push(n.to,cand);
   }
  }
 }
 return {dist,parent};
}
function pathTo(parent,start,target){
 const list=[target],edges=[];let u=target,safety=0;
 while(u!==start&&safety++<80000){
  const p=parent.get(u);if(!p)return null;
  edges.push(p.edge);u=p.node;list.push(u);
 }
 if(u!==start)return null;
 list.reverse();edges.reverse();return {ids:list,edges};
}
function routeFromWalk(graph,walk,title,shape,targetMeters,stemLength=0){
 const coordinates=[],distances=[],spans=[];
 let total=0,used=0,reviewed=0;const byMaterial={gravel:0,dirt:0};
 for(let i=0;i<walk.ids.length;i++){
  const p=graph.nodes.get(walk.ids[i]);if(!p)throw Error('Broken route geometry');
  coordinates.push([p.lat,p.lon]);
  if(i===0)continue;
  const e=walk.edges[i-1];if(!e)throw Error('Route edge missing');
  total+=e.length;byMaterial[e.material]+=e.length;
  if(e.evidence==='osm')used+=e.length;else reviewed+=e.length;
  const last=spans[spans.length-1];
  if(last&&last.surface===e.material&&last.evidence===e.evidence)last.points.push([p.lat,p.lon]);
  else spans.push({surface:e.material,evidence:e.evidence==='osm'?'tagged':'reviewed',
    points:[coordinates[i-1],[p.lat,p.lon]]});
 }
 if(total<25)throw Error('Not enough connected gravel/dirt path');
 let rawTotal=0;const lengths=[0];
 for(let i=1;i<coordinates.length;i++){
  rawTotal+=meters({lat:coordinates[i-1][0],lon:coordinates[i-1][1]},
    {lat:coordinates[i][0],lon:coordinates[i][1]});
  lengths.push(rawTotal);
 }
 const check=[.16,.34,.52,.70,.87].map(f=>{
  let i=1;while(i<lengths.length-1&&lengths[i]<rawTotal*f)i++;
  const e=walk.edges[Math.min(i-1,walk.edges.length-1)];
  return {lat:coordinates[i][0],lon:coordinates[i][1],
   name:e?.name||'Small trail',surface:e?.material||'unknown',
   evidence:e?.evidence==='osm'?'tagged':'reviewed',
   at_mile:Number((rawTotal*f/MI).toFixed(2))};
 });
 const totalMiles=Number((total/MI).toFixed(2)),pct=label=>Number((byMaterial[label]/total*100).toFixed(1));
 return {id:1,title,mode:shape,distance_m:Math.round(total),
  distance_miles:totalMiles,coordinates,spans,checkpoints:check,
  road_names:[...new Set(walk.edges.map(e=>e.name).filter(e=>e!=='Unnamed trail'))].slice(0,25),
  directions:[],surface_percent:{grass:0,dirt:pct('dirt'),gravel:pct('gravel'),paved:0,track:0,unknown:0},
  tagged_percent:Math.round(used/total*100),reviewed_percent:Math.round(reviewed/total*100),
  inferred_percent:0,unknown_percent:0,match_percent:100,
  strictSoft:true,source:'OSM path tags and locally confirmed segments',
  surface_data_status:'scanned',elevation_status:'unavailable',stem_miles:Number((stemLength/MI).toFixed(2)),
  target_miles:Number((targetMeters/MI).toFixed(2))};
}
function reverseWalk(walk){
 return {ids:walk.ids.slice().reverse(),edges:walk.edges.slice().reverse()};
}
function joinWalk(a,b){
 if(!a)return b;
 if(!b)return a;
 if(a.ids.at(-1)!==b.ids[0])throw Error('Disconnected route parts');
 return {ids:a.ids.concat(b.ids.slice(1)),edges:a.edges.concat(b.edges)};
}
function outBack(graph,start,length,shape){
 const search=shortest(graph,start);
 const half=shape==='out-and-back'?length/2:length;
 let best=null,score=Infinity;
 for(const [n,dist] of search.dist){
  if(dist<15)continue;
  const value=Math.abs(dist-half);
  if(value<score){score=value;best=n;}
 }
 if(best===null)throw Error('Not enough connected gravel/dirt');
 const one=pathTo(search.parent,start,best);
 const walk=shape==='out-and-back'?joinWalk(one,reverseWalk(one)):one;
 return {walk,stem:0,hasCycle:false};
}
function findLoop(graph,start,length){
 // Fundamental cycles of an undirected DFS tree; no artificial paved connector.
 const parent=new Map([[start,null]]),parentEdge=new Map(),depth=new Map([[start,0]]),
  visited=new Set([start]),stack=[{node:start,index:0}],candidates=[];
 const unique=new Set();
 while(stack.length){
  const top=stack[stack.length-1],neighbors=graph.adj.get(top.node)||[];
  if(top.index>=neighbors.length){stack.pop();continue;}
  const next=neighbors[top.index++],v=next.to;
  if(parent.get(top.node)===v)continue;
  if(!visited.has(v)){
   visited.add(v);parent.set(v,top.node);parentEdge.set(v,next.edge);
   depth.set(v,depth.get(top.node)+1);stack.push({node:v,index:0});
  }else if(depth.get(v)<depth.get(top.node)){
   const key=next.edge.id;if(unique.has(key))continue;unique.add(key);
   let u=top.node;const chain=[u],es=[];
   while(u!==v&&chain.length<25000){
    es.push(parentEdge.get(u));u=parent.get(u);chain.push(u);
   }
   if(u!==v)continue;
   chain.reverse();es.reverse();
   const cyc={ids:chain.concat([v]),edges:es.concat([next.edge])};
   const size=cyc.edges.reduce((sum,e)=>sum+e.length,0);
   if(size>=40&&size<length*3+2500)candidates.push({walk:cyc,meters:size,anchor:v});
  }
 }
 if(!candidates.length)return null;
 const search=shortest(graph,start);
 let best=null,score=Infinity;
 for(const item of candidates.slice(0,550)){
  const stem=search.dist.get(item.anchor)||0;
  const total=item.meters+stem*2;
  const difference=Math.abs(length-total);
  const cost=difference+stem*.50;
  if(cost<score){
   const access=pathTo(search.parent,start,item.anchor);
   if(!access)continue;
   const walk=joinWalk(joinWalk(access,item.walk),reverseWalk(access));
   score=cost;best={walk,stem,hasCycle:true};
  }
 }
 return best;
}
async function load(center,miles,{fetcher=fetch,timeout=19500}={}){
 const radius=Math.min(1250,Math.max(550,Math.sqrt(Math.max(1,miles))*410));
 const dy=radius/111195,dx=radius/(111195*Math.max(.15,Math.cos(center.lat*R)));
 const box=[center.lon-dx,center.lat-dy,center.lon+dx,center.lat+dy].map(v=>v.toFixed(6)).join(',');
 if(cache.key===box&&cache.data&&Date.now()-cache.time<20*60000)return cache.data;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetcher(API+box,{signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('OpenStreetMap data request failed (HTTP '+response.status+').');
  const body=await response.text();
  if(body.length>30000000)throw Error('Map extract too large; zoom in and try a shorter route.');
  let data;
  if(body.trimStart().startsWith('{'))data=JSON.parse(body);
  else if(body.trimStart().startsWith('<')){
   const doc=new DOMParser().parseFromString(body,'application/xml');
   if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid OSM XML');
   const elements=[];
   for(const n of doc.getElementsByTagName('node'))
    elements.push({type:'node',id:Number(n.getAttribute('id')),lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))});
   for(const way of doc.getElementsByTagName('way')){
    const tags={};
    for(const t of way.getElementsByTagName('tag'))tags[t.getAttribute('k')]=t.getAttribute('v');
    elements.push({type:'way',id:Number(way.getAttribute('id')),
     nodes:Array.from(way.getElementsByTagName('nd'),n=>Number(n.getAttribute('ref'))),tags});
   }
   data={elements};
  }else throw Error('OSM server sent an unexpected response.');
  if(!Array.isArray(data.elements)||data.elements.length<20)throw Error('No mapped trails in this area.');
  cache={key:box,data:data.elements,time:Date.now()};
  return data.elements;
 }finally{clearTimeout(timer);}
}
function buildFromData(elements,options,reviews={}){
 const {center,material:preferred='both',miles=5,shape='loop'}=options;
 const graph=graphFromElements(elements,reviews,preferred);
 const comps=components(graph);
 const picked=pickStart(graph,center,comps);
 if(!picked)throw Error('No connected, access-permitted gravel/dirt paths near the map center. Try another location or label a missing trail section in the Surface Trainer.');
 const target=MI*miles;
 let chosen;
 if(shape==='loop')chosen=findLoop(graph,picked.id,target)||outBack(graph,picked.id,target,'out-and-back');
 else chosen=outBack(graph,picked.id,target,shape);
 const actualShape=shape==='loop'&&!chosen.hasCycle?'out-and-back':shape;
 const name=chosen.hasCycle?'Connected gravel/dirt loop':
  actualShape==='out-and-back'?'Connected gravel/dirt out & back':'Connected gravel/dirt route';
 const route=routeFromWalk(graph,chosen.walk,name,actualShape,target,chosen.stem);
 const measured=route.distance_miles,shortfall=Math.abs(measured-miles)/Math.max(1,miles);
 let note=(route.reviewed_percent?
  route.reviewed_percent+'% of route length is based on user-reviewed surface labels. ':'')+
  (chosen.hasCycle&&chosen.stem?'Loop includes '+route.stem_miles.toFixed(2)+' mi of repeated connecting trail. ':'');
 if(shape==='loop'&&!chosen.hasCycle)note+='No closed gravel/dirt circuit found; showing a real out-and-back instead. ';
 if(shortfall>.18)note+='Target is '+miles.toFixed(1)+' mi; only '+measured.toFixed(2)+
  ' mi was found in this connected local map extract. No paved gap was added. ';
 note+='Route materials come from OSM tags or your reviews, not ground-truth measurements.';
 return {route,note,graph,components:comps,edges:graph.edges.length,
  tagged:graph.edges.filter(e=>e.evidence==='osm').length,
  reviewed:graph.edges.filter(e=>e.evidence==='reviewed').length};
}
async function plan(options,{fetcher=fetch,reviews={}}={}){
 const {lat,lon,miles,material:preferred='both'}=options;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(miles)||
    miles<.2||miles>25)throw Error('Pick a valid map area and route distance.');
 const elements=await load({lat,lon},miles,{fetcher});
 return buildFromData(elements,{center:{lat,lon},material:preferred,miles,shape:options.shape},reviews);
}
window.SurfaceStrideStrictSoft={plan,buildFromData,_test:{
  graphFromElements,components,shortest,pathTo,findLoop,outBack,material,keyFor,routeFromWalk,load,access
}};
})();
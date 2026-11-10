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
 const saved=review?.[key];
 // A verified local correction can exclude a mislabeled OSM track.
 if(saved?.confirmed){
  if(['gravel','dirt'].includes(saved.label))return {type:saved.label,evidence:'reviewed'};
  return null;
 }
 const tag=MATERIAL[(t.surface||'').trim().toLowerCase()];
 return tag?{type:tag,evidence:'osm'}:null;
}
function graphFromElements(elements,reviews={},preference='both',connectors=[]){
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
 // Add only trail sketches the user explicitly confirmed as gravel/dirt and accessible.
 // Endpoint snapping to eligible OSM trail nodes is small (8 m); this does NOT
 // bridge separate paved roads or automatically certify paths seen in images.
 let manualNode=-1000000000;
 function nearest(point){
  let best=null,delta=8;
  for(const id of adj.keys()){
   const p=nodes.get(id);if(!p)continue;
   const dist=meters(point,p);
   if(dist<delta){delta=dist;best=id;}
  }
  return best;
 }
 function ensureNode(point,isEnd){
  if(isEnd){const existing=nearest(point);if(existing!==null)return existing;}
  const id=manualNode--;nodes.set(id,{lat:point.lat,lon:point.lon});
  if(!adj.has(id))adj.set(id,[]);return id;
 }
 for(const item of (Array.isArray(connectors)?connectors:[]).slice(0,100)){
  if(!item?.confirmed||!item.accessReviewed||!permitted.has(item.label))continue;
  if(!Array.isArray(item.points)||item.points.length<2||item.points.length>100)continue;
  const points=item.points.map(p=>({lat:Number(p[0]),lon:Number(p[1])}));
  if(!points.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=85&&Math.abs(p.lon)<=180))continue;
  let total=0;for(let i=1;i<points.length;i++)total+=meters(points[i-1],points[i]);
  if(total<5||total>2000)continue;
  const ids=points.map((p,i)=>ensureNode(p,i===0||i===points.length-1));
  for(let i=1;i<ids.length;i++){
   if(ids[i-1]===ids[i])continue;
   const a=ids[i-1],b=ids[i],pa=nodes.get(a),pb=nodes.get(b),length=meters(pa,pb);
   if(length<.5||length>350)continue;
   const e={a,b,id:'manual:'+item.id+':'+i,wayId:item.id,
    material:item.label,evidence:'reviewed',length,name:'User-confirmed trail connection'};
   edges.push(e);byId.set(e.id,e);
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
// The visible map (or a drawn route zone), not a center pin, now defines
// which separate footpaths and connected trail networks are considered.
const visibleCache=new Map();
function scanRegion(center,miles,bounds=null){
 const lat=center.lat,lon=center.lon,scale=111195*Math.max(.15,Math.cos(lat*R));
 const valid=bounds&&['south','north','west','east'].every(x=>Number.isFinite(bounds[x]))&&
  bounds.north>bounds.south&&bounds.east>bounds.west;
 const minSide=Math.max(1900,Math.min(4000,Math.sqrt(miles)*780));
 const viewWidth=valid?(bounds.east-bounds.west)*scale:0;
 const viewHeight=valid?(bounds.north-bounds.south)*111195:0;
 // A very wide view is split into at most 3x3 OSM extracts. Large views are
 // clipped explicitly rather than making huge/rate-limited API requests.
 const width=Math.min(7500,Math.max(minSide,viewWidth*1.1));
 const height=Math.min(7500,Math.max(minSide,viewHeight*1.1));
 const midLat=valid?(bounds.north+bounds.south)/2:lat;
 const midLon=valid?(bounds.east+bounds.west)/2:lon;
 const box={south:midLat-height/2/111195,north:midLat+height/2/111195,
  west:midLon-width/2/scale,east:midLon+width/2/scale};
 const cols=Math.min(3,Math.max(1,Math.ceil(width/2500)));
 const rows=Math.min(3,Math.max(1,Math.ceil(height/2500)));
 const cells=[];
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const west=box.west+(box.east-box.west)*col/cols,
   east=box.west+(box.east-box.west)*(col+1)/cols,
   south=box.south+(box.north-box.south)*row/rows,
   north=box.south+(box.north-box.south)*(row+1)/rows;
  // Tiny tile overlaps retain shared segment geometry at grid seams.
  const pad=0.000015;
  cells.push([west-pad,south-pad,east+pad,north+pad].map(v=>v.toFixed(6)).join(','));
 }
 return {bounds:box,cells,clipped:valid&&(viewWidth>7500||viewHeight>7500),
  widthMeters:Math.round(width),heightMeters:Math.round(height),requestedBounds:valid?bounds:null};
}
function parseNativeArea(raw){
 let body;
 if(raw.trimStart().startsWith('{'))body=JSON.parse(raw);
 else if(raw.trimStart().startsWith('<')){
  const doc=new DOMParser().parseFromString(raw,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid OSM XML');
  const elements=[];
  for(const n of doc.getElementsByTagName('node'))
   elements.push({type:'node',id:Number(n.getAttribute('id')),
    lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))});
  for(const w of doc.getElementsByTagName('way')){
   const tags={};
   for(const t of w.getElementsByTagName('tag'))tags[t.getAttribute('k')]=t.getAttribute('v');
   elements.push({type:'way',id:Number(w.getAttribute('id')),
    nodes:Array.from(w.getElementsByTagName('nd'),n=>Number(n.getAttribute('ref'))),tags});
  }
  body={elements};
 }else throw Error('Unexpected OSM response');
 if(!Array.isArray(body.elements))throw Error('Invalid OSM elements');
 return body.elements;
}
async function loadVisible(center,miles,{bounds=null,fetcher=fetch,timeout=14500,onProgress=null}={}){
 const region=scanRegion(center,miles,bounds),success=[],failed=[];
 const total=region.cells.length;
 async function cell(box){
  const memo=visibleCache.get(box);
  if(memo&&Date.now()-memo.time<(memo.failed?60000:18*60000)){
   if(memo.failed)throw Error('Recently unavailable map tile');
   return memo.elements;
  }
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
   const response=await fetcher(API+box,{
    signal:ctrl.signal,headers:{Accept:'application/json, application/xml'}
   });
   if(!response.ok)throw Error('Map HTTP '+response.status);
   const raw=await response.text();
   if(raw.length>25000000)throw Error('Map extract too large');
   const elements=parseNativeArea(raw);
   visibleCache.set(box,{elements,time:Date.now(),failed:false});
   if(visibleCache.size>50)visibleCache.delete(visibleCache.keys().next().value);
   return elements;
  }catch(e){
   visibleCache.set(box,{time:Date.now(),failed:true});
   throw e;
  }finally{clearTimeout(timer);}
 }
 for(let i=0;i<region.cells.length;i+=3){
  const cells=region.cells.slice(i,i+3);
  const batch=await Promise.all(cells.map(async box=>{
   try{return {elements:await cell(box),error:null};}
   catch(error){return {elements:null,error:error?.message||String(error)};}
  }));
  for(const b of batch){if(b.elements)success.push(b.elements);else failed.push(b.error);}
  if(typeof onProgress==='function')onProgress({
   completed:Math.min(i+3,total),total,loaded:success.length,failed:failed.length
  });
 }
 if(!success.length)throw Error('Could not load trail map data from any visible-area tile. The OSM map service might be blocked.');
 const allNodes=new Map(),allWays=new Map();
 for(const rows of success)for(const item of rows){
  if(item.type==='node')allNodes.set(item.id,item);
  else if(item.type==='way'){
   const prev=allWays.get(item.id);
   if(!prev||((item.nodes||[]).length>(prev.nodes||[]).length))allWays.set(item.id,item);
  }
 }
 const elements=[...allNodes.values(),...allWays.values()];
 if(elements.length<4)throw Error('No usable mapped path data in the visible area.');
 return {elements,region,loaded:success.length,missing:failed.length,total};
}
function chooseNetworkWalk(graph,networks,center,target,shape,variant=0){
 const candidates=[];
 for(const comp of networks){
  if(comp.totalLength<25)continue;
  let closest=null,closestDist=Infinity;
  let farthest=null,farthestDist=-1;
  for(const id of comp.nodes){
   const p=graph.nodes.get(id),distance=meters(center,p);
   if(distance<closestDist){closestDist=distance;closest=id;}
   if(distance>farthestDist){farthestDist=distance;farthest=id;}
  }
  if(closest!==null)candidates.push({component:comp,start:closest,distance:closestDist});
  if(farthest!==null&&farthest!==closest&&comp.totalLength>target*.45)
   candidates.push({component:comp,start:farthest,distance:farthestDist});
 }
 if(!candidates.length)return null;
 // Sample major separate networks even when they are not near map center.
 // Keep a few smaller local components in the pool for short distances.
 candidates.sort((a,b)=>{
  const ka=Math.min(a.component.totalLength,target*1.8),kb=Math.min(b.component.totalLength,target*1.8);
  return (kb-b.distance*.13)-(ka-a.distance*.13);
 });
 const shortlist=candidates.slice(0,12);
 const alternatives=[];
 for(let i=0;i<shortlist.length;i++){
  const entry=shortlist[(i+(variant%shortlist.length))%shortlist.length];
  const possible=[];
  try{
   if(shape==='loop'){
    const loop=findLoop(graph,entry.start,target);
    if(loop)possible.push({walk:loop.walk,stem:loop.stem,hasCycle:true,shape:'loop'});
   }
   const basic=outBack(graph,entry.start,target,shape==='loop'?'out-and-back':shape);
   possible.push({...basic,shape:shape==='loop'?'out-and-back':shape});
  }catch(e){/* Try another connected trail network. */}
  for(const choice of possible){
   if(!choice.walk?.edges?.length)continue;
   const actual=choice.walk.edges.reduce((acc,e)=>acc+e.length,0);
   const error=Math.abs(actual-target)/Math.max(target,1);
   const mismatch=shape==='loop'&&!choice.hasCycle?.20:0;
   const offsetPenalty=entry.distance/30000;
   const score=error+mismatch+offsetPenalty;
   alternatives.push({...choice,score,start:entry.start,
    component:entry.component,offset:entry.distance,actual});
  }
 }
 if(!alternatives.length)return null;
 alternatives.sort((a,b)=>a.score-b.score);
 const best=alternatives[0];
 const nearBest=alternatives.filter(c=>c.score<=best.score+.32);
 return nearBest[(Math.max(0,Math.floor(variant))%Math.min(4,nearBest.length))]||best;
}
function buildFromData(elements,options,reviews={},connectors=[]){
 const {center,material:preferred='both',miles=5,shape='loop',
  variant=0,scanMeta=null}=options;
 const graph=graphFromElements(elements,reviews,preferred,connectors);
 const comps=components(graph),target=MI*miles;
 const chosen=chooseNetworkWalk(graph,comps,center,target,shape,variant);
 if(!chosen)throw Error('No connected, access-permitted gravel/dirt paths in the scanned map area. Try moving or zooming out, or manually reviewing missing trail connections.');
 const actualShape=chosen.shape;
 const name=chosen.hasCycle?'Connected gravel/dirt loop':
  actualShape==='out-and-back'?'Connected gravel/dirt out & back':'Connected gravel/dirt route';
 const route=routeFromWalk(graph,chosen.walk,name,actualShape,target,chosen.stem);
 const measured=route.distance_miles,shortfall=Math.abs(measured-miles)/Math.max(1,miles);
 const waysUsed=new Set(chosen.walk.edges.map(e=>String(e.wayId))).size;
 const qualifyingNetworks=comps.filter(c=>c.totalLength>=25).length;
 route.trail_ways_count=waysUsed;route.trail_segments_count=chosen.walk.edges.length;
 route.networks_found=qualifyingNetworks;
 route.scanned_tiles=scanMeta?.loaded||1;
 const notes=[];
 notes.push('Searched '+(scanMeta?.total||1)+' map region(s); found '+qualifyingNetworks+
  ' separate gravel/dirt trail network(s). This route connects '+waysUsed+
  ' mapped or reviewed trail section(s) in one continuous network.');
 if(qualifyingNetworks>1)notes.push('Other trail networks were not joined unless a confirmed gravel/dirt connector exists.');
 if(route.reviewed_percent)notes.push(route.reviewed_percent+
  '% of the route is based on your confirmed surface labels.');
 if(chosen.hasCycle&&chosen.stem)notes.push('Loop includes '+route.stem_miles.toFixed(2)+' mi of repeated approach trail.');
 if(shape==='loop'&&!chosen.hasCycle)notes.push('No suitable closed soft-surface circuit was found; using a connected out-and-back instead.');
 if(shortfall>.18)notes.push('Requested '+miles.toFixed(1)+' mi; found '+measured.toFixed(2)+
  ' mi without adding paved roads.');
 if(scanMeta?.missing)notes.push(scanMeta.missing+' of '+scanMeta.total+
  ' trail map regions did not load; the route search is incomplete.');
 if(scanMeta?.region?.clipped)notes.push('The map is zoomed out beyond the 7.5-km scan limit. Only the central part was searched; zoom in or move the map to search another part.');
 notes.push('Surfaces come from OSM tags or your reviews, not ground-truth measurements.');
 const note=notes.join(' ');
 return {route,note,graph,components:comps,edges:graph.edges.length,
  tagged:graph.edges.filter(e=>e.evidence==='osm').length,
  reviewed:graph.edges.filter(e=>e.evidence==='reviewed').length,
  qualifyingNetworks,scan:scanMeta};
}
function routeBetweenData(elements,waypoints,{material:preferred='both',reviews={},connectors=[]}={}){
 if(!Array.isArray(waypoints)||waypoints.length<2||waypoints.length>16)throw Error('Use 2–16 map points.');
 const graph=graphFromElements(elements,reviews,preferred,connectors);
 if(!graph.edges.length)throw Error('No qualified gravel/dirt paths in this map area.');
 const snapped=[];
 for(const point of waypoints){
  let best=null,closest=Infinity;
  for(const id of graph.adj.keys()){
   const p=graph.nodes.get(id),delta=meters(p,point);
   if(delta<closest){closest=delta;best=id;}
  }
  if(best===null||closest>40)throw Error('A waypoint is more than 40 m from a qualifying gravel/dirt trail. Move it onto the colored soft-surface overlay.');
  snapped.push(best);
 }
 let walk=null;
 for(let i=1;i<snapped.length;i++){
  const a=snapped[i-1],b=snapped[i];
  if(a===b)continue;
  const search=shortest(graph,a);
  const path=pathTo(search.parent,a,b);
  if(!path)throw Error('These trail waypoints are not connected by qualifying gravel/dirt paths. No paved connector was inserted.');
  walk=joinWalk(walk,path);
 }
 if(!walk)throw Error('Waypoints overlap; move them farther apart.');
 const total=walk.edges.reduce((sum,e)=>sum+e.length,0);
 const route=routeFromWalk(graph,walk,'Gravel/dirt waypoint route','point-to-point',total);
 return {route,graph,note:'Waypoints were snapped only to connected, mapped gravel/dirt or user-confirmed trail sections. No paved connector was inserted.'};
}
async function planBetween(points,{material='both',reviews={},connectors=[],fetcher=fetch}={}){
 const lat=points.reduce((sum,p)=>sum+p.lat,0)/points.length;
 const lon=points.reduce((sum,p)=>sum+p.lon,0)/points.length;
 let length=0;
 for(let i=1;i<points.length;i++)length+=meters(points[i-1],points[i]);
 const elements=await load({lat,lon},Math.min(25,Math.max(1,length/MI)),{fetcher});
 return routeBetweenData(elements,points,{material,reviews,connectors});
}
async function plan(options,{fetcher=fetch,reviews={},connectors=[],onProgress=null}={}){
 const {lat,lon,miles,material:preferred='both'}=options;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(miles)||
    miles<.2||miles>25)throw Error('Pick a valid map area and route distance.');
 const scan=await loadVisible({lat,lon},miles,{
  bounds:options.bounds||null,fetcher,onProgress
 });
 return buildFromData(scan.elements,{
  center:{lat,lon},material:preferred,miles,shape:options.shape,
  variant:options.variant||0,scanMeta:scan
 },reviews,connectors);
}
window.SurfaceStrideStrictSoft={plan,planBetween,buildFromData,_test:{scanRegion,loadVisible,chooseNetworkWalk,routeBetweenData,
  graphFromElements,components,shortest,pathTo,findLoop,outBack,material,keyFor,routeFromWalk,load,access
}};
})();
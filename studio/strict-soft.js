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
// Missing OSM surface tags are common on small natural paths. Never infer
// surface where the mapper explicitly tagged hard paving or access limits.
const PAVED_TAGS=new Set(['paved','asphalt','concrete','concrete:plates','concrete:lanes','paving_stones','sett','cobblestone','metal','wood','rubber','artificial_turf']);
const PRIVATE_FOOTWAYS=new Set(['sidewalk','crossing','traffic_island']);
function likelyNatural(t){
 if(!t||PAVED_TAGS.has((t.surface||'').toLowerCase()))return null;
 if(t.surface&&t.surface!=='unknown'&&t.surface!=='unclassified')return null;
 if(t.paved==='yes'||t.foot==='no'||t.access==='private')return null;
 if(t.footway&&PRIVATE_FOOTWAYS.has(t.footway))return null;
 // Strong unpaved indicators, even without an explicit surface tag.
 if(['grade3','grade4','grade5'].includes(t.tracktype)&&t.highway==='track')
  return {type:'dirt',evidence:'inferred',confidence:.84,reason:'track grade suggests natural ground'};
 if(t.highway==='path'&&(
   t.trail_visibility||t.sac_scale||t.mtb_scale||
   t.informal==='yes'||t.path==='trail'||t.hiking==='yes'))
  return {type:'dirt',evidence:'inferred',confidence:.76,reason:'mapped informal/hiking trail'};
 if(t.highway==='path'&&!t.lit&&!t.bicycle&&!t.designation&&!t.footway)
  return {type:'dirt',evidence:'inferred',confidence:.52,reason:'untagged mapped path'};
 if(t.highway==='track'&&['grade2'].includes(t.tracktype))
  return {type:'gravel',evidence:'inferred',confidence:.70,reason:'track grade suggests compacted gravel'};
 // Do not infer road-adjacent walkways or general bike/pedestrian facilities.
 return null;
}
function graphFromElements(elements,reviews={},preference='both',connectors=[],{includeLikely=false}={}){
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
   const id=keyFor(w.id,a,b),classification=material(tags,reviews,id)||
    (includeLikely&&!reviews?.[id]?.confirmed?likelyNatural(tags):null);
   if(!classification||!permitted.has(classification.type))continue;
   const length=meters(pa,pb);
   if(!Number.isFinite(length)||length<.25||length>1600||edgeKeys.has(id))continue;
   edgeKeys.add(id);
   const e={a,b,id,wayId:w.id,material:classification.type,evidence:classification.evidence,
    confidence:classification.confidence??1,
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
// Only mapped walkable road/footway links can connect distinct soft networks.
// Road connectors are compressed into bounded edges: no paved routing detours.
function bridgeNetworks(graph,elements,{maxRoadMeters=240,maxConnections=110}={}){
 const base=components(graph),membership=new Map(),nodes=graph.nodes;
 for(let c=0;c<base.length;c++)for(const id of base[c].nodes)membership.set(id,c);
 const roadAdj=new Map();
 const pavedTypes=new Set(['asphalt','concrete','concrete:plates','paving_stones','sett','cobblestone']);
 const roads=new Set(['residential','living_street','service','pedestrian','footway','cycleway','path','track']);
 let roadEdges=0;
 for(const way of elements)if(way.type==='way'&&Array.isArray(way.nodes)){
  const t=way.tags||{};
  if(!roads.has(t.highway)||HARD_NO.has(t.foot)||t.foot==='use_sidepath'||
   (HARD_NO.has(t.access)&&!['yes','designated','permissive','official'].includes(t.foot))||
   ['driveway','parking_aisle','alley'].includes(t.service)||
   t.highway==='cycleway'&&t.foot==='no')continue;
  if(MATERIAL[(t.surface||'').toLowerCase()])continue;
  for(let i=1;i<way.nodes.length;i++){
   const a=Number(way.nodes[i-1]),b=Number(way.nodes[i]);
   const pa=nodes.get(a),pb=nodes.get(b);if(!pa||!pb||a===b)continue;
   const length=meters(pa,pb);
   if(length<.3||length>maxRoadMeters)continue;
   const surface=pavedTypes.has((t.surface||'').toLowerCase())?'paved':'unknown';
   const e={a,b,length,surface,name:t.name||'Mapped pedestrian road link'};
   if(!roadAdj.has(a))roadAdj.set(a,[]);
   if(!roadAdj.has(b))roadAdj.set(b,[]);
   roadAdj.get(a).push({to:b,edge:e});
   roadAdj.get(b).push({to:a,edge:e});
   roadEdges++;
  }
 }
 const seeds=[...roadAdj.keys()].filter(id=>membership.has(id));
 const potentials=[];
 const lengthLimit=Math.max(20,Math.min(300,Number(maxRoadMeters)||240));
 // Each road search is bounded, and matches ONLY another soft component.
 // Geometric proximity alone never creates a connector.
 for(const origin of seeds.slice(0,140)){
  const startGroup=membership.get(origin);
  const dist=new Map([[origin,0]]),parent=new Map(),queue=[[0,origin]];
  while(queue.length){
   queue.sort((a,b)=>a[0]-b[0]);
   const [d,u]=queue.shift();
   if(d>lengthLimit||d!==dist.get(u))continue;
   const otherGroup=membership.get(u);
   if(u!==origin&&otherGroup!==undefined&&otherGroup!==startGroup){
    const path=[u],road=[];let cursor=u,safety=0;
    while(cursor!==origin&&safety++<200){
     const step=parent.get(cursor);if(!step)break;
     road.push(step.edge);cursor=step.from;path.push(cursor);
    }
    if(cursor!==origin)continue;
    path.reverse();road.reverse();
    const material=road.every(x=>x.surface==='paved')?'paved':'unknown';
    potentials.push({a:origin,b:u,length:d,coords:path.map(id=>{
     const n=nodes.get(id);return [n.lat,n.lon];
    }),material,roadNames:road.map(x=>x.name),
     groups:[Math.min(startGroup,otherGroup),Math.max(startGroup,otherGroup)]});
    // Stop at the first connected trail to avoid extending through it.
    continue;
   }
   for(const leg of roadAdj.get(u)||[]){
    const next=d+leg.edge.length;
    if(next>lengthLimit||next>=(dist.get(leg.to)??Infinity)-1e-8)continue;
    dist.set(leg.to,next);parent.set(leg.to,{from:u,edge:leg.edge});
    queue.push([next,leg.to]);
   }
  }
 }
 potentials.sort((a,b)=>a.length-b.length);
 const added=[],used=new Set();
 for(const p of potentials){
  if(added.length>=maxConnections)break;
  const signature=p.groups.join(':');
  const near=added.filter(x=>x.groupKey===signature);
  if(near.length>=3||near.some(x=>{
   const direct=meters(nodes.get(x.a),nodes.get(p.a))<40&&
    meters(nodes.get(x.b),nodes.get(p.b))<40;
   const reversed=meters(nodes.get(x.a),nodes.get(p.b))<40&&
    meters(nodes.get(x.b),nodes.get(p.a))<40;
   return direct||reversed;
  }))continue;
  const id='road-bridge:'+added.length+':'+p.a+':'+p.b;
  if(used.has(id))continue;
  used.add(id);
  const e={a:p.a,b:p.b,id,wayId:id,material:p.material,evidence:'road',
   length:p.length,coords:p.coords,name:'Short mapped road connection',
   roadNames:[...new Set(p.roadNames)],groupKey:signature};
  graph.edges.push(e);graph.byId.set(id,e);
  graph.adj.get(p.a).push({to:p.b,edge:e});
  graph.adj.get(p.b).push({to:p.a,edge:e});
  added.push(e);
 }
 graph.roadConnectors=added.length;graph.softNetworks=base.length;
 graph.roadNetworkEdges=roadEdges;
 return graph;
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
 if(!walk.ids?.length||!walk.edges?.length)throw Error('No route geometry');
 const start=graph.nodes.get(walk.ids[0]);
 if(!start)throw Error('Missing starting node');
 const coordinates=[[start.lat,start.lon]],spans=[],lengths=[0],edgeAt=[];
 const byMaterial={gravel:0,dirt:0,paved:0,unknown:0};
 let total=0,used=0,reviewed=0,inferred=0,road=0,roadSections=0;
 let roadRun=0,maxRoadRun=0;
 const roadNames=new Set(),softWays=new Set();
 for(let i=0;i<walk.edges.length;i++){
  const e=walk.edges[i],from=walk.ids[i],to=walk.ids[i+1];
  if(!e||!graph.nodes.has(to))throw Error('Broken route edge');
  const backward=e.a===to&&e.b===from;
  const path=e.coords?.length?(backward?e.coords.slice().reverse():e.coords):
   [[graph.nodes.get(from).lat,graph.nodes.get(from).lon],
    [graph.nodes.get(to).lat,graph.nodes.get(to).lon]];
  const surface=e.material==='gravel'?'gravel':e.material==='dirt'?'dirt':
   e.material==='paved'?'paved':'unknown';
  byMaterial[surface]+=e.length;total+=e.length;
  if(e.evidence==='osm'){used+=e.length;softWays.add(String(e.wayId));}
  else if(e.evidence==='reviewed'){reviewed+=e.length;softWays.add(String(e.wayId));}
  else if(e.evidence==='inferred'){inferred+=e.length;softWays.add(String(e.wayId));}
  else if(e.evidence==='road'){
   road+=e.length;roadNames.add(e.roadNames?.join(' / ')||e.name);
   if(roadRun===0)roadSections++;roadRun+=e.length;maxRoadRun=Math.max(maxRoadRun,roadRun);
  }
  if(e.evidence!=='road')roadRun=0;
  const evidence=e.evidence==='osm'?'tagged':e.evidence==='road'?'road':
   e.evidence==='inferred'?'inferred':'reviewed';
  let last=spans[spans.length-1];
  if(!last||last.surface!==surface||last.evidence!==evidence){
   last={surface,evidence,points:[coordinates[coordinates.length-1]]};
   spans.push(last);
  }
  for(let j=1;j<path.length;j++){
   const previous=coordinates[coordinates.length-1],point=path[j];
   const segLength=meters({lat:previous[0],lon:previous[1]},{lat:point[0],lon:point[1]});
   if(segLength<.03)continue;
   coordinates.push([point[0],point[1]]);
   lengths.push(lengths[lengths.length-1]+segLength);
   edgeAt.push(e);
   last.points.push([point[0],point[1]]);
  }
 }
 if(total<25||coordinates.length<2)throw Error('Not enough connected gravel/dirt path');
 const pct=type=>Number((byMaterial[type]/total*100).toFixed(1));
 const check=[.16,.34,.52,.70,.87].map(f=>{
  let i=1;while(i<lengths.length-1&&lengths[i]<lengths[lengths.length-1]*f)i++;
  const e=edgeAt[Math.max(0,i-1)];
  return {lat:coordinates[i][0],lon:coordinates[i][1],
   name:e?.name||'Small trail',surface:e?.material||'unknown',
   evidence:e?.evidence==='osm'?'tagged':e?.evidence==='road'?'road':'reviewed',
   at_mile:Number((lengths[i]/MI).toFixed(2))};
 });
 const totalMiles=Number((total/MI).toFixed(2));
 return {id:1,title,mode:shape,distance_m:Math.round(total),
  distance_miles:totalMiles,coordinates,spans,checkpoints:check,
  road_names:[...new Set(walk.edges.map(e=>e.name).filter(e=>e!=='Unnamed trail'))].slice(0,25),
  directions:[],
  surface_percent:{grass:0,dirt:pct('dirt'),gravel:pct('gravel'),
   paved:pct('paved'),track:0,unknown:pct('unknown')},
  soft_percent:Number(((byMaterial.dirt+byMaterial.gravel)/total*100).toFixed(1)),
  tagged_percent:Math.round(used/total*100),reviewed_percent:Math.round(reviewed/total*100),
  inferred_percent:Number((inferred/total*100).toFixed(1)),
  confirmed_soft_percent:Number(((used+reviewed)/total*100).toFixed(1)),
  probable_soft_percent:Number((inferred/total*100).toFixed(1)),
  inferred_miles:Number((inferred/MI).toFixed(2)),
  unknown_percent:pct('unknown'),match_percent:pct('dirt')+pct('gravel'),
  strictSoft:true,allowRoadLinks:road>0,road_meters:Math.round(road),
  road_miles:Number((road/MI).toFixed(2)),road_percent:Number((road/total*100).toFixed(1)),
  road_sections:roadSections,max_road_link_m:Math.round(maxRoadRun),
  trail_ways_count:softWays.size,
  source:road?'OSM soft paths, user reviews, and short mapped pedestrian road links':
   'OSM soft paths and locally confirmed segments',
  surface_data_status:'scanned',elevation_status:'unavailable',
  stem_miles:Number((stemLength/MI).toFixed(2)),
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
function networkWalks(graph,networks,center,target,shape){
 const candidates=[];
 for(const comp of networks){
  if(comp.totalLength<25)continue;
  const members=comp.nodes.slice();
  const points=members.map(id=>({id,p:graph.nodes.get(id)})).filter(x=>x.p);
  if(!points.length)continue;
  const byDist=points.slice().sort((a,b)=>meters(a.p,center)-meters(b.p,center));
  const anchors=[byDist[0],byDist[byDist.length-1]];
  const extrema=[
   points.reduce((a,b)=>a.p.lat<b.p.lat?a:b),
   points.reduce((a,b)=>a.p.lat>b.p.lat?a:b),
   points.reduce((a,b)=>a.p.lon<b.p.lon?a:b),
   points.reduce((a,b)=>a.p.lon>b.p.lon?a:b)
  ];
  anchors.push(...extrema);
  const distinct=new Set();
  for(const anchor of anchors){
   if(!anchor||distinct.has(anchor.id))continue;
   distinct.add(anchor.id);
   const dist=meters(anchor.p,center);
   candidates.push({component:comp,start:anchor.id,distance:dist,
    extent:comp.totalLength});
  }
 }
 if(!candidates.length)return [];
 candidates.sort((a,b)=>{
  const ka=Math.min(a.extent,target*1.8),kb=Math.min(b.extent,target*1.8);
  return (kb-b.distance*.13)-(ka-a.distance*.13);
 });
 // Preserve representation from several distinct soft systems, not just
 // six extreme starts on the biggest network.
 const shortlist=[],fromComponent=new Map();
 for(const entry of candidates){
  if(shortlist.length>=22)break;
  const group=entry.component;
  const used=fromComponent.get(group)||0;
  if(used>=4)continue;
  shortlist.push(entry);fromComponent.set(group,used+1);
 }
 const alternatives=[];
 for(const entry of shortlist){
  try{
   if(shape==='loop'){
    const loop=findLoop(graph,entry.start,target);
    if(loop)alternatives.push({...loop,shape:'loop',start:entry.start,
     component:entry.component,offset:entry.distance});
   }
   const basic=outBack(graph,entry.start,target,shape==='loop'?'out-and-back':shape);
   alternatives.push({...basic,shape:shape==='loop'?'out-and-back':shape,
    start:entry.start,component:entry.component,offset:entry.distance});
  }catch(err){/* A disconnected branch might not provide the requested shape. */}
 }
 for(const item of alternatives){
  item.actual=item.walk.edges.reduce((acc,e)=>acc+e.length,0);
  const error=Math.abs(item.actual-target)/Math.max(target,1);
  item.score=error+(shape==='loop'&&!item.hasCycle?.20:0)+item.offset/30000;
 }
 return alternatives.sort((a,b)=>a.score-b.score);
}
function chooseNetworkWalk(graph,networks,center,target,shape,variant=0){
 const sorted=networkWalks(graph,networks,center,target,shape);
 if(!sorted.length)return null;
 const best=sorted[0];
 const nearBest=sorted.filter(c=>c.score<=best.score+.32);
 return nearBest[Math.max(0,Math.floor(variant))%Math.min(4,nearBest.length)]||best;
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
function buildOptionsFromData(elements,options,reviews={},connectors=[]){
 const {center,material:preferred='both',miles=5,shape='loop',
  allowRoadLinks=true,includeLikely=true,maxRoadMeters=240,maxOptions=4,scanMeta=null}=options;
 const graph=graphFromElements(elements,reviews,preferred,connectors,{includeLikely});
 const originalNetworks=components(graph).filter(c=>c.totalLength>=25).length;
 if(allowRoadLinks)bridgeNetworks(graph,elements,{maxRoadMeters});
 const networks=components(graph);
 const alternatives=networkWalks(graph,networks,center,MI*miles,shape);
 const routes=[];
 for(const choice of alternatives){
  if(routes.length>=Math.min(5,Math.max(1,maxOptions)))break;
  if(!choice.walk?.edges?.length)continue;
  const total=choice.walk.edges.reduce((n,e)=>n+e.length,0);
  const soft=choice.walk.edges.filter(e=>e.material==='gravel'||e.material==='dirt')
   .reduce((n,e)=>n+e.length,0);
  const road=total-soft;
  if(soft<75||road/total>.22||road>Math.min(1050,MI*miles*.23))continue;
  // Avoid routes that repeat the same edge set under a different name.
  const softEdges=new Set(choice.walk.edges.filter(e=>e.evidence!=='road').map(e=>e.id));
  if(routes.some(entry=>{
   let intersection=0;
   for(const key of softEdges)if(entry.edgeKeys.has(key))intersection++;
   const overlap=intersection/Math.max(1,Math.min(softEdges.size,entry.edgeKeys.size));
   return overlap>.79&&Math.abs(total-entry.total)<MI*.65;
  }))continue;
  const route=routeFromWalk(graph,choice.walk,
   choice.hasCycle?'Soft-surface loop':choice.shape==='out-and-back'?
    'Soft-surface out & back':'Soft-surface route',
   choice.shape,MI*miles,choice.stem);
  const softPct=(route.soft_percent||0)/100,roadPct=(route.road_percent||0)/100;
  const deviation=Math.abs(route.distance_miles-miles)/Math.max(1,miles);
  const shapePenalty=shape==='loop'&&!choice.hasCycle?.18:0;
  if(route.max_road_link_m>maxRoadMeters||route.road_sections>4)continue;
  const score=deviation*1.6+roadPct*2.1+
   (route.inferred_percent||0)/100*.32+
   (route.surface_percent.unknown||0)/100*.55+
   shapePenalty+choice.offset/45000;
  route.trail_ways_count=route.trail_ways_count||0;
  route.networks_found=originalNetworks;
  route.road_link_limit_m=Math.min(300,Math.max(20,maxRoadMeters));
  route.scanned_tiles=scanMeta?.loaded||1;
  route.softPriority=true;
  route.requested_miles=miles;
  const note=
   route.soft_percent.toFixed(1)+'% likely gravel/dirt ('+
   route.confirmed_soft_percent.toFixed(1)+'% mapped/reviewed, '+
   route.probable_soft_percent.toFixed(1)+'% inferred from OSM trail type) · '+
   route.road_miles.toFixed(2)+' mi short mapped road/footway connectors'+
   (route.surface_percent.unknown?' (some road surfaces not tagged)':'')+
   '. Unknown-surface trail classifications are estimates from OSM path types; verify access and surfaces before running.'+
   (scanMeta?.missing?' '+scanMeta.missing+' map regions were unavailable.':'')+
   (scanMeta?.region?.clipped?' Search clipped to 7.5 km; zoom in to explore other areas.':'');
  route.strictNote=note;
  routes.push({route,note,edgeKeys:softEdges,total,score});
 }
 routes.sort((a,b)=>a.score-b.score);
 routes.forEach((item,i)=>{
  item.route.title='Option '+(i+1)+' · '+item.route.title;
  item.route.optionIndex=i;
 });
 return {options:routes.map(({route,note,score})=>({route,note,score})),
  graph,originalNetworks,roadConnectors:graph.roadConnectors||0,
  connectedNetworks:networks.filter(c=>c.totalLength>=25).length,scan:scanMeta,
  note:routes.length?routes.length+' distinct soft-surface choices found. '+
   (graph.roadConnectors||0)+' mapped short road connectors considered.':
   'No viable predominantly gravel/dirt route was found here; try zooming out or allowing more mapped connectors.'};
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
async function planOptions(options,{fetcher=fetch,reviews={},connectors=[],onProgress=null}={}){
 const {lat,lon,miles,material:preferred='both'}=options;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(miles)||
  miles<.2||miles>25)throw Error('Pick a valid map location and route length.');
 const scan=await loadVisible({lat,lon},miles,{
  bounds:options.bounds||null,fetcher,onProgress
 });
 return buildOptionsFromData(scan.elements,{
  center:{lat,lon},miles,material:preferred,shape:options.shape,
  allowRoadLinks:options.allowRoadLinks!==false,
  includeLikely:options.includeLikely!==false,
  maxRoadMeters:options.maxRoadMeters||240,
  maxOptions:options.maxOptions||4,scanMeta:scan
 },reviews,connectors);
}
window.SurfaceStrideStrictSoft={plan,planOptions,planBetween,buildFromData,buildOptionsFromData,_test:{likelyNatural,scanRegion,loadVisible,bridgeNetworks,networkWalks,chooseNetworkWalk,routeBetweenData,
  graphFromElements,components,shortest,pathTo,findLoop,outBack,material,keyFor,routeFromWalk,load,access
}};
})();
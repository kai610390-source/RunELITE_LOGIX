/* SurfaceStride Forest Road Finder v18.
 * Overlay mapped tracks even when aerial canopy hides their pixels.
 * OSM geometry != surface accuracy, access permission or physical continuity.
 * No invented geometry is admitted to automatic route generation.
 */
(function(){
'use strict';
const SOFT_GRAVEL=new Set(['gravel','fine_gravel','pebblestone','compacted','crushed_limestone','grit','aggregate','crushed_stone','stabilized']);
const SOFT_DIRT=new Set(['unpaved','unsealed','dirt','ground','earth','soil','mud','sand','grass','grass_paver','woodchips']);
const HARD=new Set(['paved','asphalt','concrete','concrete:plates','concrete:lanes','paving_stones','sett','cobblestone','chipseal','metal','wood','rubber']);
const BAD_ACCESS=new Set(['no','private','customers','permit']);
function accessible(t){
 if(!t||BAD_ACCESS.has(t.foot)||t.foot==='use_sidepath')return false;
 if(BAD_ACCESS.has(t.access)&&!['yes','designated','permissive','official'].includes(t.foot))return false;
 if(['forestry','agricultural','delivery','destination','military'].includes(t.access)&&
   !['yes','designated','permissive','official'].includes(t.foot))return false;
 if(['proposed','construction'].includes(t.highway))return false;
 return true;
}
function classify(t){
 if(!accessible(t))return null;
 const type=(t.highway||'').toLowerCase(),surface=(t.surface||'').toLowerCase().trim();
 if(!['track','path','bridleway','service'].includes(type))return null;
 if(type==='service'&&['driveway','parking_aisle','alley'].includes(t.service))return null;
 if(HARD.has(surface)||t.paved==='yes')return null;
 // Service roads without real unpaved evidence are excluded.
 if(type==='service'&&!SOFT_GRAVEL.has(surface)&&!SOFT_DIRT.has(surface)&&
   !/^grade[2-5]$/.test(t.tracktype||''))return null;
 if(SOFT_GRAVEL.has(surface))
  return {surface:'gravel',evidence:'osm-surface-tag',confidence:.91,
   description:'Mapped '+surface+' surface (unverified on the ground)'};
 if(SOFT_DIRT.has(surface))
  return {surface:'dirt',evidence:'osm-surface-tag',confidence:.82,
   description:'Mapped '+surface+' surface (unverified on the ground)'};
 if(surface&&surface!=='unknown'&&surface!=='unclassified')return null;
 if(type==='track'||type==='service'){
  if(t.tracktype==='grade2')return {surface:'gravel',evidence:'tracktype-estimate',
   confidence:.70,description:'OSM tracktype grade2: gravel-like track likely'};
  if(['grade3','grade4','grade5'].includes(t.tracktype))
   return {surface:'dirt',evidence:'tracktype-estimate',
    confidence:.66,description:'OSM '+t.tracktype+': unpaved dirt/ground likely'};
  if(t.tracktype==='grade1')return null; // Usually paved.
  return {surface:'unknown',evidence:'mapped-track',confidence:.37,
   description:'Mapped track but no surface or tracktype tag'};
 }
 if(type==='path'||type==='bridleway')
  return {surface:'unknown',evidence:'mapped-footpath',confidence:.32,
   description:'Mapped path; surface is unknown'};
 return null;
}
function meters(a,b){
 const dlat=(b.lat-a.lat)*Math.PI/180,dlon=(b.lon-a.lon)*Math.PI/180;
 const t=Math.sin(dlat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dlon/2)**2;
 return 12742017.6*Math.asin(Math.min(1,Math.sqrt(t)));
}
function toLocal(a,b){
 const k=111195*Math.cos(a.lat*Math.PI/180);
 return {x:(b.lon-a.lon)*k,y:(b.lat-a.lat)*111195};
}
function dot(a,b){return a.x*b.x+a.y*b.y;}
function norm(a){return Math.hypot(a.x,a.y);}
function gapCandidates(tracks,{maxGapMeters=85,maxGaps=24}={}){
 const ends=[],degree=new Map();
 for(const t of tracks){
  for(let i=0;i<t.nodeIds.length-1;i++){
   const u=t.nodeIds[i],v=t.nodeIds[i+1];
   degree.set(u,(degree.get(u)||0)+1);
   degree.set(v,(degree.get(v)||0)+1);
  }
 }
 for(const t of tracks){
  if(t.points.length<2)continue;
  for(const end of [0,1]){
   const p=end?t.points[t.points.length-1]:t.points[0],
    inner=end?t.points[t.points.length-2]:t.points[1],
    nodeId=end?t.nodeIds[t.nodeIds.length-1]:t.nodeIds[0];
   if((degree.get(nodeId)||0)!==1||!inner)continue;
   const heading=toLocal(inner,p),length=norm(heading);
   if(length<2)continue;
   ends.push({point:p,nodeId,wayId:t.wayId,heading:{x:heading.x/length,y:heading.y/length},
    track:t,kind:t.surface});
  }
 }
 const ranked=[];
 // Spatial lookup avoids O(n^2) comparisons when a city-sized view
 // contains thousands of disconnected mapped path endpoints.
 const cellSize=Math.max(30,maxGapMeters),grid=new Map();
 const cosine=Math.cos((ends[0]?.point.lat||30)*Math.PI/180);
 const key=(x,y)=>x+':'+y;
 for(let i=0;i<ends.length;i++){
  const a=ends[i];
  const x=a.point.lon*111195*cosine,y=a.point.lat*111195;
  const gx=Math.floor(x/cellSize),gy=Math.floor(y/cellSize);
  for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
   for(const j of grid.get(key(gx+ox,gy+oy))||[]){
    const b=ends[j];
    if(a.wayId===b.wayId||a.nodeId===b.nodeId)continue;
    const delta=toLocal(a.point,b.point),distance=norm(delta);
    if(distance<8||distance>maxGapMeters)continue;
    const forward=dot(a.heading,delta)/distance,
     reverse=-dot(b.heading,delta)/distance;
    if(forward<.68||reverse<.68)continue;
    const score=.52+(forward+reverse)*.15-distance/maxGapMeters*.22;
    ranked.push({kind:'possible-mapped-gap',category:'forest',
     source:'geometry-inference',
     a:a.point,b:b.point,center:{lat:(a.point.lat+b.point.lat)/2,
      lon:(a.point.lon+b.point.lon)/2},
     distanceMeters:Number(distance.toFixed(1)),score,
     description:'Two separately mapped path ends align. The gap may be canopy, missing map data, or an actual dead end. NOT verified or routable.',
     wayIds:[a.wayId,b.wayId]});
   }
  }
  const cell=key(gx,gy);
  if(!grid.has(cell))grid.set(cell,[]);
  grid.get(cell).push(i);
 }
 ranked.sort((a,b)=>b.score-a.score);
 const out=[];
 for(const p of ranked){
  if(out.length>=maxGaps)break;
  if(out.some(q=>meters(p.center,q.center)<18))continue;
  out.push(p);
 }
 return out;
}
function inspect(elements,{maxTracks=320,maxGaps=24}={}){
 const nodes=new Map(),tracks=[];
 for(const e of elements)if(e.type==='node'&&Number.isFinite(Number(e.id))&&
   Number.isFinite(Number(e.lat))&&Number.isFinite(Number(e.lon)))
  nodes.set(Number(e.id),{lat:Number(e.lat),lon:Number(e.lon)});
 for(const way of elements)if(way.type==='way'&&Array.isArray(way.nodes)){
  const tags=way.tags||{},c=classify(tags);
  if(!c)continue;
  let run=[],ids=[];
  const commit=()=>{
   if(run.length<2){run=[];ids=[];return;}
   const total=run.slice(1).reduce((acc,p,i)=>acc+meters(run[i],p),0);
   if(total<8){run=[];ids=[];return;}
   tracks.push({kind:'mapped-forest-track',category:'forest',
    points:run, nodeIds:ids,wayId:way.id,name:tags.name||'Unnamed mapped track',
    surface:c.surface,tracktype:tags.tracktype||null,evidence:c.evidence,
    confidence:c.confidence,score:c.confidence,description:c.description,
    distanceMeters:Math.round(total),
    a:run[0],b:run[run.length-1],center:run[Math.floor(run.length/2)],
    source:'OpenStreetMap geometry (NOT aerial verification)'});
   run=[];ids=[];
  };
  for(const rawId of way.nodes){
   const id=Number(rawId),node=nodes.get(id);
   if(!node){commit();continue;}
   if(run.length&&meters(run[run.length-1],node)>1500){commit();}
   run.push(node);ids.push(id);
  }
  commit();
 }
 tracks.sort((a,b)=>{
  const soft=a.surface==='unknown'?0:1,other=b.surface==='unknown'?0:1;
  return other-soft||b.distanceMeters-a.distanceMeters;
 });
 // Compute gaps before capping tracks so minor parts can join.
 const gaps=gapCandidates(tracks,{maxGaps});
 const selected=tracks.slice(0,Math.max(1,Math.min(800,maxTracks)));
 return {tracks:selected,gaps,counts:{
  mapped:selected.length,probableSoft:selected.filter(t=>t.surface!=='unknown').length,
  unknown:selected.filter(t=>t.surface==='unknown').length,gaps:gaps.length
 }};
}
window.SurfaceStrideForestTracks={inspect,classify,gapCandidates,_test:{meters,accessible}};
})();
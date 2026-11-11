/* SurfaceStride aerial scout V14.
 * Finds multiple plausible narrow corridors across several aerial patches.
 * A visual line is NEVER proof of a trail, ground material or public access.
 * Uses public NAIP imagery through the shared provider fallback module.
 */
(function(){
'use strict';
const R=6378137,MI=111195;
function merc(lon,lat){
 const m=Math.max(-85,Math.min(85,lat))*Math.PI/180;
 return {x:R*lon*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+m/2))};
}
function earth(x,y){
 return {lat:(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI,
  lon:x/R*180/Math.PI};
}
function mapArea(map){
 if(!map?.getBounds)throw Error('Satellite map not available');
 const b=map.getBounds();
 const sw=merc(b.getWest(),b.getSouth()),ne=merc(b.getEast(),b.getNorth());
 if(!Number.isFinite(sw.x)||!Number.isFinite(ne.y)||ne.x<=sw.x||ne.y<=sw.y)
  throw Error('Invalid map bounds');
 const center={x:(sw.x+ne.x)/2,y:(sw.y+ne.y)/2};
 // Native NAIP detail is finite; 0.7 m paths cannot be recovered in a
 // 3 km-wide image. Keep each inspection patch roughly 260-500m wide.
 const actualW=ne.x-sw.x,actualH=ne.y-sw.y;
 const w=Math.min(actualW,1900),h=Math.min(actualH,1900);
 const cols=Math.min(4,Math.max(1,Math.ceil(w/470)));
 const rows=Math.min(4,Math.max(1,Math.ceil(h/470)));
 const cells=[];
 for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++){
  const left=center.x-w/2+w*ix/cols,
   right=center.x-w/2+w*(ix+1)/cols,
   bottom=center.y-h/2+h*iy/rows,
   top=center.y-h/2+h*(iy+1)/rows;
  // Overlap tile boundaries so a trail that crosses a seam is not discarded
  // by the local line detector's margin. Clip to the actual survey bounds.
  const pad=35;
  cells.push({left:Math.max(center.x-w/2,left-pad),
   right:Math.min(center.x+w/2,right+pad),
   bottom:Math.max(center.y-h/2,bottom-pad),
   top:Math.min(center.y+h/2,top+pad)});
 }
 return {cells,clipped:actualW>1900||actualH>1900,
  total:cells.length,width:Math.round(actualW),height:Math.round(actualH),
  inspectedBounds:{left:center.x-w/2,right:center.x+w/2,
   bottom:center.y-h/2,top:center.y+h/2}};
}
function pixelToEarth(x,y,box,size){
 return earth(box.left+(box.right-box.left)*x/size,
  box.top-(box.top-box.bottom)*y/size);
}
function mergeCandidates(items,max=36){
 items.sort((a,b)=>b.score-a.score);
 const accepted=[];
 const meterDistance=(a,b)=>{
  const dl=(a.lat-b.lat)*MI,dx=(a.lon-b.lon)*MI*Math.cos(a.lat*Math.PI/180);
  return Math.hypot(dl,dx);
 };
 for(const item of items){
  if(accepted.length>=max)break;
  // Deduplicate only almost identical positions. Nearby parallel paths can
 // be 3-10 meters apart, and should remain individually reviewable.
 const redundant=accepted.some(other=>
  other.kind===item.kind&&meterDistance(item.center,other.center)<3.5);
  if(!redundant)accepted.push(item);
 }
 return accepted;
}
async function scan(mapOrCenter,{onProgress,maxPatches=16}={}){
 const imagery=window.SurfaceStrideImagery,trail=window.SurfaceStrideTrailFocus;
 const surfaceScout=window.SurfaceStrideSurfaceScout,vision=window.SurfaceStrideVision;
 const segmenter=window.SurfaceStrideTrailSegmentation;
 const forest=window.SurfaceStrideForestTracks;
 const mapLoader=window.SurfaceStrideStrictSoft?._test?.loadVisible;
 if(!imagery?.capture||!trail?.screenCandidates)
  throw Error('Aerial imagery or trail detector unavailable. Refresh the Studio.');
 let area;
 if(mapOrCenter?.getBounds)area=mapArea(mapOrCenter);
 else if(Number.isFinite(mapOrCenter?.lat)){
  const lon=Number.isFinite(mapOrCenter.lon)?mapOrCenter.lon:mapOrCenter.lng;
  const p=merc(lon,mapOrCenter.lat),half=270;
  area={cells:[{left:p.x-half,right:p.x+half,bottom:p.y-half,top:p.y+half}],
   total:1,clipped:false,width:540,height:540};
 }else throw Error('No map location to scan');
 // Map geometry and aerial imagery are independent sources. Mapped woodland
 // tracks remain discoverable even if tree canopy hides them in imagery OR
 // the aerial imagery service is blocked by the browser.
 const mappedTask=(async()=>{
  if(!forest?.inspect||!mapLoader||!mapOrCenter?.getBounds)return null;
  const b=mapOrCenter.getBounds(),center=mapOrCenter.getCenter?.
   call(mapOrCenter)||{lat:(b.getNorth()+b.getSouth())/2,lng:(b.getWest()+b.getEast())/2};
  try{
   const loaded=await mapLoader({lat:center.lat,
    lon:Number.isFinite(center.lng)?center.lng:center.lon},5,{
    bounds:{south:b.getSouth(),north:b.getNorth(),
     west:b.getWest(),east:b.getEast()}
   });
   return {...forest.inspect(loaded.elements),sourceTiles:loaded.total,
    missingTiles:loaded.missing};
  }catch(error){return {tracks:[],gaps:[],error:error?.message||String(error)};}
 })();
 const candidates=[],regions=[],errors=[],size=448;
 let modelLines=0,modelFailures=0;
 const boxes=area.cells.slice(0,Math.max(1,Math.min(16,maxPatches)));
 let completed=0,nextIndex=0;
 const progress=()=>{
  if(typeof onProgress==='function')onProgress({
   done:completed,total:boxes.length,candidates:candidates.length,
   regionCount:regions.length,
   errorCount:errors.length,clipped:area.clipped
  });
 };
 progress();
 async function scanBox(box){
  try{
   const image=await imagery.capture(box,size,{timeoutPerSource:5600});
   // Limit scanning to actual aerial detail instead of interpolating pixels.
   const scale=Math.max(box.right-box.left,box.top-box.bottom)/size;
   if(scale>2.1){errors.push('Pixel scale too low for skinny trails');return;}
   const found=trail.screenCandidates(image.raster,{maxCandidates:32});
   for(const spot of found){
    const center=pixelToEarth(spot.x,spot.y,box,size);
    const step=Math.min(20,Math.max(8,30/Math.max(1,scale)));
    const a=pixelToEarth(spot.x-spot.dx*step,spot.y-spot.dy*step,box,size);
    const b=pixelToEarth(spot.x+spot.dx*step,spot.y+spot.dy*step,box,size);
    candidates.push({a,b,center,score:spot.score,category:'trail',
     kind:'possible trail corridor',source:'Aerial visual suggestion (unverified)',
     imagerySource:image.source,metersPerPixel:scale,
     detection:'two-sided vegetation + continuous narrow line'});
   }
   // An optional trained pixel mask traces continuous candidate paths.
   // It is never used as evidence of public access or verified gravel/dirt.
   if(segmenter?.ready?.()){
    try{
     const result=segmenter.segment(image.raster,{size:128,maxPaths:18,
      high:.74,low:.53});
     const scaleX=size/result.probabilities.width;
     for(const path of result.paths){
      if(path.pixels<13||path.confidence<.63)continue;
      const points=path.points.map(q=>pixelToEarth(q.x*scaleX,q.y*scaleX,box,size));
      if(points.length<2)continue;
      const first=points[0],last=points[points.length-1],
       dx=(first.lon-last.lon)*111195*Math.cos(first.lat*Math.PI/180),
       dy=(first.lat-last.lat)*111195;
      if(Math.hypot(dx,dy)<9)continue;
      const center=points[Math.floor(points.length/2)];
      candidates.push({a:first,b:last,center,points,score:path.confidence+.25,
       kind:'learned connected trail',category:'trail',
       modelConfidence:path.confidence,source:'Local trained pixel-segmentation suggestion (unverified)',
       imagerySource:image.source,metersPerPixel:scale,
       detection:'traced connected probability mask; needs manual verification'});
      modelLines++;
     }
    }catch(err){modelFailures++;}
   }
   if(surfaceScout?.inspect){
    const observations=surfaceScout.inspect(image.raster,{
     maxRegions:16,vision
    });
    for(const p of observations){
     const center=pixelToEarth(p.x,p.y,box,size);
     regions.push({center,kind:p.kind,category:p.kind,
      score:p.score,reason:p.reason,modelGuess:p.modelGuess,
      metersPerPixel:scale,imagerySource:image.source,
      source:'Aerial appearance candidate (unverified)'});
    }
   }
  }catch(error){errors.push(error?.message||String(error));}
  finally{completed++;progress();}
 }
 async function worker(){
  while(nextIndex<boxes.length){
   const index=nextIndex++;
   await scanBox(boxes[index]);
  }
 }
 const workers=Array.from({length:Math.min(3,boxes.length)},()=>worker());
 await Promise.all(workers);
 const mapped=await mappedTask;
 const mappedTracks=mapped?.tracks||[],mappedGaps=mapped?.gaps||[];
 const out=mergeCandidates(candidates,240);
 // Trail candidates are lines; land-cover candidates are point observations.
 // Keep both collections separate so no unverified area becomes a route.
 const cover=mergeCandidates(regions,180);
 const counts=surfaceScout?.tally?surfaceScout.tally(cover):{};
 const stats={found:out.length,regions:cover.length,counts,
  learnedPaths:modelLines,modelFailures,segmentationReady:!!segmenter?.ready?.(),
  mappedTracks:mappedTracks.length,possibleGaps:mappedGaps.length,
  mappedFailure:mapped?.error||null,missingMapTiles:mapped?.missingTiles||0,
  scanned:boxes.length,failed:errors.length,
  clipped:area.clipped,inspectedBounds:area.inspectedBounds||null,
  source:'NAIP/USGS public aerial imagery'};
 if(typeof onProgress==='function')onProgress({done:boxes.length,total:boxes.length,
  candidates:out.length,regionCount:cover.length,
  errorCount:errors.length,clipped:area.clipped});
 if(!out.length&&!mappedTracks.length&&errors.length===boxes.length)
  throw Error('No mapped tracks and all aerial scan patches failed. '+errors[0]+
   (mapped?.error?' Map extract: '+mapped.error:''));

 out.stats=stats;
 out.regions=cover;
 out.mappedTracks=mappedTracks;
 out.mappedGaps=mappedGaps;
 return out;
}
window.SurfaceStrideAerial={scan,_test:{merc,earth,mapArea,pixelToEarth,mergeCandidates}};
})();
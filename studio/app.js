/* SurfaceStride Studio — independent no-subscription route builder. */
(function(){
'use strict';
const E=window.SurfaceStrideStudioEngine;
const TAGS=window.SurfaceStrideSurfaceTags;
const SHARE=window.SurfaceStrideShare;
const WALK=window.SurfaceStrideWalking;
const STRICT=window.SurfaceStrideStrictSoft;
const VISION=window.SurfaceStrideVision;
const $=id=>document.getElementById(id);
const COLORS={grass:'#50d487',dirt:'#b7825a',gravel:'#efb061',paved:'#9db6b0',track:'#d08cbd',unknown:'#c6cbd0',possible:'#f7da74'};
const KM=1.609344,MI=1609.344;
const st={map:null,route:null,routeVersion:0,mode:'auto',shape:'loop',miles:5,preference:'soft',
 terrain:'any',quiet:true,waypoints:[],straight:false,reroll:0,working:false,
 strictSoft:true,softMaterial:'both',trainerSample:null,trainerSegment:null,batchBusy:false,aiSuggestions:new Map(),
 zoneStage:0,zoneStart:null,zone:null,labelsOn:true,gravelOn:false,traceOn:false,
 aerialOn:false,aerialCandidates:[],aerialBusy:false,
 routeLayer:null,markerLayer:null,gravelLayer:null,zoneLayer:null,aerialLayer:null,gravelSegments:[],
 bottomOpen:false,bottomTab:'elevation',saved:[]};
let snackbarTimer=0,manualTimer=0,lastRouteRequest=0;
function message(text,ms=4200){
 const el=$('toast');el.textContent=text;el.hidden=false;
 clearTimeout(snackbarTimer);snackbarTimer=setTimeout(()=>el.hidden=true,ms);
}
function status(text){$('routeMessage').textContent=text;}
function setBusy(on,label){
 st.working=on;$('generateBtn').disabled=on;$('generateBtn').firstElementChild.textContent=on?(label||'Finding routes…'):'Generate route';
}
function markerIcon(index,total){
 const stateClass=index===0?'start':index===total-1?'end':'';
 return L.divIcon({className:'',html:'<div class="route-pin '+stateClass+'"></div>',iconSize:[20,20],iconAnchor:[10,10]});
}
function setupMap(){
 if(typeof L==='undefined'){status('Leaflet did not load. Refresh to retry.');return;}
 const map=L.map('map',{zoomControl:false,preferCanvas:true,doubleClickZoom:true}).setView([30.2849,-97.734],14);
 st.map=map;
 L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
  maxZoom:19,attribution:'&copy; Esri & imagery providers'
 }).addTo(map);
 map.createPane('labels');map.getPane('labels').style.zIndex=390;map.getPane('labels').style.pointerEvents='none';
 st.labels=[
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,pane:'labels',opacity:.96}),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,pane:'labels',opacity:.9})
 ];
 st.labels.forEach(layer=>layer.addTo(map));
 st.routeLayer=L.layerGroup().addTo(map);
 st.markerLayer=L.layerGroup().addTo(map);
 st.gravelLayer=L.layerGroup().addTo(map);
 st.aerialLayer=L.layerGroup().addTo(map);
 st.zoneLayer=L.layerGroup().addTo(map);
 L.control.zoom({position:'bottomright'}).addTo(map);
 map.on('click',onMapClick);
 map.on('mousemove',e=>{
  if(st.zoneStage!==1)return;
  drawZone(st.zoneStart,e.latlng,true);
 });
 map.on('moveend',()=>{
  if(!st.route)$('mapStatus').innerHTML='SATELLITE VIEW <span>·</span> '+(st.mode==='draw'?'Tap to place route points':'Zoom and generate across the visible trails');
 });
 window.addEventListener('resize',()=>setTimeout(()=>map.invalidateSize(),100));
}
function onMapClick(e){
 if(st.zoneStage===1){
  st.zone={sw:L.latLng(Math.min(st.zoneStart.lat,e.latlng.lat),Math.min(st.zoneStart.lng,e.latlng.lng)),
   ne:L.latLng(Math.max(st.zoneStart.lat,e.latlng.lat),Math.max(st.zoneStart.lng,e.latlng.lng))};
  st.zoneStage=0;drawZone(st.zone.sw,st.zone.ne);$('zoneBadge').hidden=false;$('zoneBtn').classList.remove('active');
  status('Route zone ready. Generate a route to start from somewhere inside this area.');
  return;
 }
 if(st.mode!=='draw')return;
 if(st.waypoints.length>=16){message('Use at most 16 control points.');return;}
 st.waypoints.push({lat:e.latlng.lat,lon:e.latlng.lng,
  manualToHere:st.traceOn&&st.waypoints.length>0});
 drawMarkers();
 if(st.traceOn){
  status(st.waypoints.length+' points traced. Confirm Gravel or Dirt in Discover to make this path eligible for strict routing.');
  return;
 }
 if(st.waypoints.length>=2)deferManual();
 else status('First waypoint placed. Click another point to draw a route.');
}
function drawZone(a,b){
 st.zoneLayer.clearLayers();
 if(!a||!b)return;
 L.rectangle(L.latLngBounds(a,b),{color:'#dbf3b7',weight:3,fillColor:'#8ee9af',fillOpacity:.15,dashArray:'6 6'}).addTo(st.zoneLayer);
}
function clearZone(){
 st.zoneStage=0;st.zoneStart=null;st.zone=null;st.zoneLayer.clearLayers();
 $('zoneBadge').hidden=true;$('zoneBtn').classList.remove('active');
}
function armZone(){
 if(st.zoneStage===1){clearZone();return;}
 st.zoneStage=1;st.zoneStart=st.map.getCenter();
 st.zoneLayer.clearLayers();$('zoneBtn').classList.add('active');
 status('Route zone: click a corner on the map. The map center is the first corner.');
 message('Click the map to finish defining your route zone.',4200);
}
function drawMarkers(){
 st.markerLayer.clearLayers();
 for(let i=0;i<st.waypoints.length;i++){
  const p=st.waypoints[i],marker=L.marker([p.lat,p.lon],{draggable:true,icon:markerIcon(i,st.waypoints.length),zIndexOffset:1500}).addTo(st.markerLayer);
  marker.bindTooltip(i===0?'Start':i===st.waypoints.length-1?'End':'Waypoint '+(i+1),{direction:'top',offset:[0,-11]});
  marker.on('dragend',()=>{
   const v=marker.getLatLng();st.waypoints[i]={...st.waypoints[i],lat:v.lat,lon:v.lng};
   drawMarkers();if(!st.traceOn)deferManual();
  });
  marker.on('contextmenu',e=>{
   L.DomEvent.stopPropagation(e);
   if(st.waypoints.length<=2){status('Use Undo or Clear to remove a route endpoint.');return;}
   st.waypoints.splice(i,1);drawMarkers();if(!st.traceOn)deferManual();message('Waypoint removed.');
  });
 }
}
function insertPointAt(latlon){
 if(st.mode!=='draw'){setMode('draw',true);}
 if(st.waypoints.length<2){st.waypoints.push({lat:latlon.lat,lon:latlon.lng});drawMarkers();return;}
 const a=L.latLng(latlon.lat,latlon.lng);
 let best=Infinity,at=st.waypoints.length;
 for(let i=1;i<st.waypoints.length;i++){
  const p=L.latLng(st.waypoints[i-1].lat,st.waypoints[i-1].lon),q=L.latLng(st.waypoints[i].lat,st.waypoints[i].lon);
  const a1=st.map.latLngToLayerPoint(p),b1=st.map.latLngToLayerPoint(q),c=st.map.latLngToLayerPoint(a);
  const dx=b1.x-a1.x,dy=b1.y-a1.y,den=dx*dx+dy*dy;
  const f=den?Math.max(0,Math.min(1,((c.x-a1.x)*dx+(c.y-a1.y)*dy)/den)):0;
  const z=(c.x-a1.x-dx*f)**2+(c.y-a1.y-dy*f)**2;
  if(z<best){best=z;at=i;}
 }
 st.waypoints.splice(at,0,{lat:a.lat,lon:a.lng});
 drawMarkers();deferManual();
}
function setMode(mode,preserveRoute=false){
 st.mode=mode;
 $('autoMode').classList.toggle('active',mode==='auto');$('drawMode').classList.toggle('active',mode==='draw');
 $('autoMode').setAttribute('aria-pressed',mode==='auto');$('drawMode').setAttribute('aria-pressed',mode==='draw');
 if(mode==='draw'){
  $('generateBtn').firstElementChild.textContent='Update drawn route';
  if(!st.waypoints.length&&st.route&&preserveRoute){
   const points=st.route.coordinates,count=Math.min(points.length,5);
   const ids=Array.from({length:count},(_,i)=>Math.round(i*(points.length-1)/(count-1)));
   st.waypoints=ids.map(i=>({lat:points[i][0],lon:points[i][1]}));
   drawMarkers();
  }
  status('Manual mode: click on the satellite map to place route points. Drag to adjust, right-click to remove.');
 }else{
  st.markerLayer.clearLayers();
  $('generateBtn').firstElementChild.textContent='Generate route';
  status('Auto mode: choose a target distance and generate a route around the center of your map.');
 }
 $('mapStatus').innerHTML='SATELLITE VIEW <span>·</span> '+(mode==='draw'?'Click to add waypoints':'Automatic route generation');
}
function clearRoute(clearPoints=true){
 st.routeVersion++;st.route=null;st.routeLayer.clearLayers();
 if(clearPoints){st.waypoints=[];st.markerLayer.clearLayers();}
 $('routeSummary').hidden=true;$('bottomRouteName').textContent='No route selected';
 $('analysisStatus').textContent='Generate a route to see elevation and directions';
 $('elevationSvg').innerHTML='<text x="25" y="55" fill="#8ca39a" font-size="14">Elevation will appear after you generate a route.</text>';
 $('directionsView').innerHTML='<p class="hint">Street names appear here when available.</p>';
 status('Route cleared. Choose Generate or draw new waypoints.');
}
function routePopup(e){
 L.DomEvent.stopPropagation(e);
 const place=e.latlng,wrap=document.createElement('div');
 const heading=document.createElement('strong');heading.textContent='Route at this location';wrap.append(heading);
 const line=document.createElement('div');line.style.marginTop='8px';
 const street=document.createElement('a');
 street.href='https://www.instantstreetview.com/s/'+place.lat.toFixed(6)+','+place.lng.toFixed(6);
 street.target='_blank';street.rel='noopener noreferrer';street.textContent='Inspect in Street View ↗';
 line.append(street);wrap.append(line);
 const add=document.createElement('button');add.type='button';add.textContent='+ Add waypoint here';
 add.style.cssText='margin-top:8px;padding:7px 9px;border:0;border-radius:7px;color:#fff;background:#276d4f;font-size:11px;';
 add.addEventListener('click',()=>{insertPointAt(place);st.map.closePopup();});
 wrap.append(add);
 L.popup().setLatLng(place).setContent(wrap).openOn(st.map);
}
function drawRoute(preserveView=false){
 const r=st.route;if(!r||!st.map)return;
 st.routeLayer.clearLayers();
 const all=L.layerGroup();
 L.polyline(r.coordinates,{color:'#fff',weight:11,opacity:.96,lineJoin:'round',interactive:false}).addTo(all);
 const main=L.polyline(r.coordinates,{color:'#206647',weight:6,opacity:1,lineJoin:'round'});
 main.on('click',routePopup);main.addTo(all);
 for(const span of r.spans||[]){
  const color=COLORS[span.surface];if(!color||span.surface==='unknown')continue;
  L.polyline(span.points,{color,weight:span.evidence==='tagged'?4.7:3.4,
   opacity:span.evidence==='tagged'?1:.83,lineJoin:'round',interactive:false}).addTo(all);
 }
 for(const sec of r.manualSections||[]){
  L.polyline([sec.a,sec.b],{color:'#ffd47b',weight:5,opacity:1,dashArray:'5 7',
   interactive:false}).addTo(all);
 }
 all.addTo(st.routeLayer);
 if(!preserveView){
  const bounds=L.latLngBounds(r.coordinates);
  if(bounds.isValid())st.map.fitBounds(bounds.pad(.18),{animate:true,maxZoom:17});
 }
 $('mapStatus').innerHTML='SATELLITE VIEW <span>·</span> '+r.distance_miles.toFixed(2)+' MI ROUTE';
}
function surfaceSummary(){
 const r=st.route;if(!r)return;
 const p=r.surface_percent||{unknown:100};
 const order=['grass','dirt','gravel','paved','track','unknown'];
 const bar=$('surfaceBar'),breakdown=$('surfaceBreakdown');
 bar.replaceChildren();breakdown.replaceChildren();
 for(const key of order){
  const pct=Number(p[key]||0);
  const seg=document.createElement('i');seg.style.width=pct+'%';seg.style.background=COLORS[key];seg.title=key+' '+pct.toFixed(1)+'%';
  if(pct)bar.append(seg);
  const item=document.createElement('div');const strong=document.createElement('b'),span=document.createElement('span');
  strong.textContent=pct.toFixed(0)+'%';span.textContent=key.charAt(0).toUpperCase()+key.slice(1);
  item.append(strong,span);breakdown.append(item);
 }
 $('surfaceConfidence').textContent=r.strictSoft?
   'NO PAVED CONNECTORS · '+r.tagged_percent+'% OSM-tagged · '+r.reviewed_percent+
     '% human-reviewed · 0% surface unknown':
   ((r.surface_data_status==='scanned'?
    (r.tagged_percent||0)+'% OSM-tagged · '+(r.inferred_percent||0)+'% inferred · '+(r.unknown_percent||0)+'% unknown':
    'Surface lookup pending or unavailable. Unknown does not mean paved.')+
    ((r.manualSections||[]).length?' · Dashed gold = reviewed sketch, not a verified surface.':''));
}
function updateStats(){
 const r=st.route;if(!r)return;
 $('routeSummary').hidden=false;
 $('routeMiles').textContent=r.distance_miles.toFixed(2);
 $('routeGain').textContent=r.elevation_gain_ft===undefined?'—':r.elevation_gain_ft.toLocaleString();
 $('bottomRouteName').textContent=r.title||'Running route';
 surfaceSummary();renderDirections();
 const evidence=$('routeEvidence');
 evidence.hidden=!r.strictSoft;
 if(r.strictSoft){
  evidence.classList.toggle('warning',Math.abs(r.distance_miles-st.miles)>Math.max(.5,st.miles*.18));
  evidence.textContent=r.strictNote||'Connected gravel/dirt segments only. Recorded tags and reviewed labels are not physical ground truth.';
 }
}
function renderDirections(){
 const directions=st.route?.directions||[],box=$('directionsView');box.replaceChildren();
 if(!directions.length){
  const p=document.createElement('p');p.className='hint';
  p.textContent='No street-level turn instructions available. You can still export this route as a GPX track.';
  box.append(p);return;
 }
 for(const [i,step] of directions.slice(0,45).entries()){
  const el=document.createElement('button');el.type='button';el.className='direction-step';
  const name=document.createElement('strong');name.textContent=(i+1)+'. '+(step.name||'Unnamed path');
  const desc=document.createElement('span');desc.textContent=step.instruction||'Continue';
  el.append(name,desc);
  el.addEventListener('click',()=>{
   if(Number.isFinite(step.lat)&&Number.isFinite(step.lon)){
    st.map.setView([step.lat,step.lon],Math.max(st.map.getZoom(),16),{animate:true});
    message(step.instruction||step.name);
   }
  });
  box.append(el);
 }
}
function elevationChart(info){
 const r=st.route;if(!r)return;
 if(!info?.profile?.length){
  $('elevationSvg').innerHTML='<text x="25" y="60" fill="#9ea99c" font-size="12">Elevation unavailable. GPX route remains usable.</text>';
  $('elevationSummary').textContent='Elevation unavailable';return;
 }
 r.elevation_gain_ft=info.gain_ft;r.elevation_loss_ft=info.loss_ft;r.elevation_profile=info.profile;
 const p=info.profile,min=Math.min(...p.map(x=>x.ft)),max=Math.max(...p.map(x=>x.ft));
 const lo=min-Math.max(8,(max-min)*.10),hi=max+Math.max(8,(max-min)*.1);
 const fx=x=>18+860*x.mile/Math.max(.001,p[p.length-1].mile);
 const fy=y=>98-80*(y.ft-lo)/Math.max(1,hi-lo);
 const path=p.map((v,i)=>(i?'L':'M')+fx(v).toFixed(1)+' '+fy(v).toFixed(1)).join(' ');
 const fill=path+' L'+fx(p.at(-1)).toFixed(1)+' 101 L18 101 Z';
 $('elevationSvg').innerHTML='<line x1="18" y1="101" x2="878" y2="101" stroke="#bcd6c3"/>'+
  '<path d="'+fill+'" fill="#dff4df"/><path d="'+path+'" fill="none" stroke="#318b58" stroke-width="2.5" vector-effect="non-scaling-stroke"/>'+
  '<text x="18" y="12" fill="#5e9572" font-size="11">'+Math.round(max).toLocaleString()+' ft peak</text>'+
  '<text x="18" y="110" fill="#899f8d" font-size="9">0 mi</text><text x="870" y="110" text-anchor="end" fill="#899f8d" font-size="9">'+r.distance_miles.toFixed(1)+' mi</text>';
 $('elevationSummary').textContent='+'+info.gain_ft.toLocaleString()+' ft ascent · '+info.loss_ft.toLocaleString()+' ft descent';
 updateStats();
}
function analyzeRoute(routeVersion){
 const r=st.route;if(!r)return;
 const versionsMatch=()=>routeVersion===st.routeVersion&&st.route===r;
 $('analysisStatus').textContent='Loading elevation and surface tags…';
 const elevated=E.elevation(r).then(info=>{
  if(versionsMatch())elevationChart(info);
 }).catch(err=>{if(versionsMatch())elevationChart(null);});
 const surface=!r.strictSoft&&TAGS?.enrich?TAGS.enrich(r,{preference:st.preference},progress=>{
  if(!versionsMatch()||!progress.partial)return;
  // Keep this route object stable so other parallel updates are not lost.
  Object.assign(r,progress.partial);
  drawRoute(true);updateStats();
  $('analysisStatus').textContent='Surface mapping '+progress.done+'/'+progress.total+' · '+progress.ok+' available';
 }).then(result=>{
  if(!versionsMatch())return;
  Object.assign(r,result);
  drawRoute(true);updateStats();
  $('analysisStatus').textContent=r.tagged_percent+'% tagged · '+r.unknown_percent+'% unknown';
 }).catch(err=>{if(versionsMatch())$('analysisStatus').textContent='Some surfaces unknown · GPX ready';}):Promise.resolve();
 Promise.allSettled([elevated,surface]).then(()=>{
  if(versionsMatch())status(r.strictSoft?(r.strictNote||'Strict gravel/dirt route ready; no pavement was inserted.'):
  'Route ready. Inspect the surface colors, edit waypoints, or export GPX for COROS.');
 });
}
function showRoute(route,{preserveView=false,analyze=true}={}){
 st.routeVersion++;st.route=route;
 drawRoute(preserveView);updateStats();
 const version=st.routeVersion;
 $('analysisStatus').textContent='Route mapped · calculating insights…';
 if(analyze)analyzeRoute(version);
 if(!st.bottomOpen){st.bottomOpen=true;$('bottomPanel').classList.add('open');}
}
function centerForAuto(){
 if(!st.zone)return st.map.getCenter();
 const sw=st.zone.sw,ne=st.zone.ne;
 const jitter=st.reroll?((st.reroll*0.61803398)%1):.5;
 const jitter2=st.reroll?((st.reroll*.41421356)%1):.5;
 return L.latLng(sw.lat+(ne.lat-sw.lat)*jitter,sw.lng+(ne.lng-sw.lng)*jitter2);
}
function offset(p,bearing,meters){
 const lon=Number.isFinite(p.lng)?p.lng:p.lon;
 const nextLon=lon+meters*Math.sin(bearing*Math.PI/180)/(111195*Math.max(.15,Math.cos(p.lat*Math.PI/180)));
 return {lat:p.lat+meters*Math.cos(bearing*Math.PI/180)/111195,
  lon:nextLon,lng:nextLon};
}
async function autoGenerate(){
 if(st.working||!st.map)return;
 setBusy(true,'Calculating route…');
 status(st.strictSoft?'Scanning ALL visible mapped gravel/dirt trails, then connecting compatible networks without paved roads.':
  'Connecting walking routes. Satellite surfaces are classified after the route is drawn.');
 try{
  const center=centerForAuto();
  const base=st.reroll?offset(center,(st.reroll*131)%360,Math.min(470,90+st.reroll*43)):center;
  let route,strictNote='';
  if(st.strictSoft){
   if(!STRICT)throw Error('Strict surface router did not load. Refresh the Studio.');
   const visible=st.zone?{
    south:st.zone.sw.lat,west:st.zone.sw.lng,
    north:st.zone.ne.lat,east:st.zone.ne.lng
   }:{
    south:st.map.getBounds().getSouth(),west:st.map.getBounds().getWest(),
    north:st.map.getBounds().getNorth(),east:st.map.getBounds().getEast()
   };
   const data=await STRICT.plan({
    lat:base.lat,lon:Number.isFinite(base.lon)?base.lon:base.lng,
    miles:st.miles,shape:st.shape,material:st.softMaterial,
    bounds:visible,variant:st.reroll
   },{
    reviews:VISION?.getReviews?.()||{},
    connectors:VISION?.getConnectors?.()||[],
    onProgress:scan=>status('Searching visible trail networks: '+
     scan.completed+'/'+scan.total+' map regions · '+scan.loaded+' loaded'+
     (scan.failed?' · '+scan.failed+' unavailable':'')+'…')
   });
   route=data.route;strictNote=data.note;route.strictNote=data.note;
  }else if(st.shape==='point-to-point'){
   const a={lat:base.lat,lon:base.lng},b=offset(base,(st.reroll*61+55)%360,st.miles*MI*.85);
   route=await E.snapRoute([a,b]);route.mode='point-to-point';route.title='Point-to-point route';
  }else{
   if(!WALK?.plan)throw Error('Walking route module did not load.');
   const data=await WALK.plan({lat:base.lat,lon:base.lng,miles:st.miles,mode:st.shape,
    preference:st.preference,goal_pct:65,avoid_traffic:st.quiet,favor_tagged:false});
   if(!data?.routes?.length)throw Error('No route found in this area.');
   route=data.routes[0];route.title='Suggested '+(st.shape==='loop'?'loop':'out & back');
  }
  st.waypoints=[];st.markerLayer.clearLayers();
  showRoute(route);
  status(route.strictSoft?strictNote:
    'Suggested '+route.distance_miles.toFixed(2)+'-mile route. Surface tags are loading separately.');
 }catch(err){status('Could not generate route: '+(err?.message||err));
   message(st.strictSoft?'No qualifying connected gravel/dirt route was found in the visible search area. Zoom out, move the map, or review missing trail sections.':
    'Route unavailable. Try another area or draw waypoints.',7500);}
 finally{setBusy(false);}
}
function deferManual(){lastRouteRequest++;clearTimeout(manualTimer);manualTimer=setTimeout(manualBuild,550);}
async function manualBuild(){
 if(st.mode!=='draw'||st.waypoints.length<2)return;
 if(st.working){clearTimeout(manualTimer);manualTimer=setTimeout(manualBuild,550);return;}
 const copy=st.waypoints.map(x=>({...x})),request=lastRouteRequest;
 const hybrid=!st.straight&&copy.some(x=>x.manualToHere);
 setBusy(true,st.strictSoft?'Connecting gravel/dirt waypoints…':st.straight?'Drawing manual line…':hybrid?'Connecting small trails…':'Snapping route…');
 try{
  let route;
  if(st.strictSoft){
   if(st.straight||hybrid)throw Error('Strict mode cannot claim an unmapped sketch is gravel/dirt. Turn off Strict mode for sketches, or review each mapped segment first.');
   if(!STRICT)throw Error('Strict router missing. Refresh the Studio.');
   const data=await STRICT.planBetween(copy,{material:st.softMaterial,reviews:VISION?.getReviews?.()||{},
     connectors:VISION?.getConnectors?.()||[]});
   route=data.route;route.strictNote=data.note;
  }else route=st.straight?E.directRoute(copy):hybrid?await E.hybridRoute(copy):await E.snapRoute(copy);
  if(request!==lastRouteRequest||st.mode!=='draw')return;
  route.title=st.strictSoft?'Connected gravel/dirt waypoints':st.straight?'Off-road sketch':hybrid?'Connected small trails':'Custom running route';
  route.mode='point-to-point';
  showRoute(route,{preserveView:true});
  status(route.strictSoft?'Connected gravel/dirt-only waypoints. No paved connector used.':
   'Route edited. Drag a marker to reroute; right-click to delete a waypoint.');
 }catch(err){
  status('Could not join those points: '+(err?.message||err)+
   (st.strictSoft?'. No paved road was used to fill the gap.':'. Try closer waypoints or enable manual straight lines.'));
 }finally{setBusy(false);}
}
function undo(){
 if(st.mode==='draw'&&st.waypoints.length){
  st.waypoints.pop();drawMarkers();
  if(st.traceOn)status('Trace point removed. Confirm the remaining trail points in Discover.');
  else if(st.waypoints.length>=2)deferManual();
  else clearRoute(false);
  return;
 }
 if(st.route){clearRoute();message('Route cleared.');}
}
function reverseRoute(){
 if(st.mode==='draw'&&st.waypoints.length>=2){
  const oldFlags=st.waypoints.map(p=>!!p.manualToHere);
  st.waypoints.reverse();
  st.waypoints.forEach((p,i)=>{p.manualToHere=i>0?oldFlags[oldFlags.length-i]:false;});
  drawMarkers();deferManual();return;
 }
 if(st.route){
  const source=st.route;
  const reversed=E.routeObject({coordinates:source.coordinates.slice().reverse(),
   directions:[],provider:'Reversed route'},source.mode,'Reversed '+(source.title||'route'));
  showRoute(reversed,{preserveView:true});message('Route direction reversed.');
 }
}
function reroll(){
 st.reroll++;
 if(st.mode==='draw'){if(st.waypoints.length>=2)manualBuild();else message('Place two waypoints first.');return;}
 autoGenerate();
}
function switchTab(name){
 for(const btn of document.querySelectorAll('[data-tab]')){
  const selected=btn.dataset.tab===name;btn.classList.toggle('active',selected);btn.setAttribute('aria-selected',String(selected));
 }
 for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!=='tab-'+name;
 if(name==='saved')renderSaved();
}
function addReviewedSegment(start,end,source='mapped trail',segment=null){
 if(st.strictSoft){
  if(!segment){
   if(!st.traceOn)toggleTrace();
   st.map?.fitBounds([[start.lat,start.lon],[end.lat,end.lon]],{maxZoom:19});
   message('Aerial paths are unverified. Trace the visible trail, then Confirm trace: Gravel or Dirt before strict routing.',8500);
   return;
  }
  const review=VISION?.getReviews?.()?.[segment.segmentKey];
  const material=review?.confirmed?review.label:
   segment.evidence==='tagged'?segment.surface:'unknown';
  if(!['gravel','dirt'].includes(material)){
   message('Classify and confirm this exact segment as gravel/dirt before adding it to a strict route.',7000);
   startTraining(segment);return;
  }
  if(st.mode!=='draw')setMode('draw',false);
  st.traceOn=false;st.waypoints=[
   {lat:start.lat,lon:start.lon,manualToHere:false},
   {lat:end.lat,lon:end.lon,manualToHere:false}
  ];
  drawMarkers();deferManual();
  st.map?.closePopup();
  status('Connecting this confirmed '+material+' mapped trail segment without paved shortcuts.');
  return;
 }
 if(!window.confirm('Include this possible '+source+' as a manually reviewed path? Check pedestrian access, fences, terrain, and safety yourself. Neither imagery nor OpenStreetMap proves it is accessible.'))return;
 if(st.waypoints.length>=14){message('Too many waypoints. Remove some before adding a trail.');return;}
 // Preserve the actual trail-like segment. Only connecting legs are snapped
 // to the pedestrian network (which may still avoid narrow/missing trails).
 st.traceOn=false;
 if(st.straight){st.straight=false;$('straightToggle').checked=false;}
 if(st.mode!=='draw')setMode('draw',true);
 let a={lat:start.lat,lon:start.lon},b={lat:end.lat,lon:end.lon},at=st.waypoints.length;
 if(st.waypoints.length>=2){
  const center={lat:(a.lat+b.lat)/2,lon:(a.lon+b.lon)/2};
  let best=Infinity;
  for(let i=1;i<st.waypoints.length;i++){
   const p=st.waypoints[i-1],q=st.waypoints[i];
   const mid={lat:(p.lat+q.lat)/2,lon:(p.lon+q.lon)/2};
   const meters=(center.lat-mid.lat)**2+((center.lon-mid.lon)*Math.cos(center.lat*Math.PI/180))**2;
   if(meters<best){best=meters;at=i;}
  }
  const prev=st.waypoints[Math.max(0,at-1)];
  const ds=(p)=>(p.lat-prev.lat)**2+(p.lon-prev.lon)**2;
  if(ds(b)<ds(a)){const tmp=a;a=b;b=tmp;}
 }
 const pair=[{lat:a.lat,lon:a.lon,manualToHere:false},
   {lat:b.lat,lon:b.lon,manualToHere:true}];
 if(st.waypoints.length===0)st.waypoints=pair;
 else st.waypoints.splice(at,0,...pair);
 drawMarkers();deferManual();
 st.map.closePopup();
 status('Trail segment added. Nearby connecting legs are now being routed. Dashed gold segments are not verified for access or surface.');
 message('Trail added as an explicit segment; check its access and continuity.',6500);
}
function trainerCounts(){
 const box=$('trainerCounts');
 if(!VISION){box.textContent='Training script did not load. Refresh the page.';return;}
 const c=VISION.count(),total=Object.values(c).reduce((a,b)=>a+b,0);
 box.textContent='Examples saved only in this browser: '+total+
  ' · gravel '+c.gravel+' · dirt '+c.dirt+' · grass '+c.grass+
  ' · paved '+c.paved+' · trees '+c.tree+' · roofs '+c.building+' · unknown '+c.unknown+
  ' · '+VISION.reviewedCount()+' mapped sections human-reviewed.';
}
function predictionLine(sample){
 if(!VISION||!sample)return;
 const p=VISION.predict(sample.vector);
 $('trainerPrediction').textContent=p.hasGuess?
  'Tentative model guess: '+(p.label==='paved'?'paved road':p.label==='tree'?'tree canopy':p.label==='building'?'building roof':p.label)+
  ' ('+Math.round(p.confidence*100)+'% example-vote agreement, NOT validated accuracy). Confirm or correct it.':
  'No guess yet. '+p.reason;
}
function showTrainerSample(sample,segment){
 st.trainerSample=sample;st.trainerSegment=segment||null;
 $('trainerBox').hidden=false;
 $('trainerImage').src=sample.preview;
 const target=segment?('Mapped '+(segment.highway||'path')+
  ' · '+(segment.name||'unnamed')+' · one OSM segment only'):
  'Map-center or user-owned training sample (not attached to a trail segment)';
 $('trainerContext').textContent=target+
  (sample.source==='NAIP'?' · NAIP close-up ~'+Math.round(sample.patchMeters)+' m wide':' · '+sample.source);
 $('trainerStatus').textContent='Choose the actual surface. After training, a review confirmation can enable this exact mapped trail segment in strict routing.';
 predictionLine(sample);
 trainerCounts();
}
async function trainAt(lat,lon,segment=null){
 if(!VISION){message('Surface trainer did not load. Refresh the Studio.');return;}
 switchTab('discover');
 $('trainerBox').hidden=false;$('trainerContext').textContent='Loading zoomed-in NAIP image…';
 $('trainerPrediction').textContent='Inspecting the aerial crop…';
 $('trainMapCenterBtn').disabled=true;
 try{
  const sample=await VISION.capture(lat,lon,{spanMeters:38,px:384});
  showTrainerSample(sample,segment);
  $('trainerBox').scrollIntoView({behavior:'smooth',block:'center'});
  message('Zoomed-in aerial sample loaded. Label its surface to train the classifier.',5600);
 }catch(err){
  $('trainerContext').textContent='Image unavailable: '+(err?.message||err);
  $('trainerPrediction').textContent='Try an authorized image upload, or use the dedicated Surface Trainer for clearer errors.';
  $('trainerStatus').textContent='Use “Add my own licensed training image” or open the full-page Surface Trainer.';
  $('trainerBox').scrollIntoView({behavior:'smooth',block:'center'});
  st.trainerSample=null;st.trainerSegment=null;
 }finally{$('trainMapCenterBtn').disabled=false;}
}
function startTraining(segment){
 if(!segment?.a||!segment?.b){message('Select a mapped path first.');return;}
 const lat=(segment.a[0]+segment.b[0])/2,lon=(segment.a[1]+segment.b[1])/2;
 st.map?.closePopup();
 trainAt(lat,lon,segment);
}
async function trainUpload(file){
 if(!file||!VISION)return;
 switchTab('discover');
 $('trainerBox').hidden=false;
 $('trainerContext').textContent='Reading training image…';
 try{
  const sample=await VISION.fromFile(file);
  showTrainerSample(sample,null);
  message('Image ready. Choose its known surface label.',4500);
 }catch(e){$('trainerContext').textContent='Could not open image: '+(e?.message||e);}
 finally{$('trainFile').value='';}
}
function labelSample(label){
 if(!VISION||!st.trainerSample)return;
 try{
  const sample=st.trainerSample;
  VISION.addExample(sample.vector,label,{source:sample.source,lat:sample.lat,lon:sample.lon});
  const segment=st.trainerSegment;
  let reviewed=false;
  if(segment?.segmentKey){
   const proceed=window.confirm('You labeled the image as '+label+
    '. Apply this as a HUMAN-REVIEWED label to this exact mapped trail segment? Only do this if you can actually identify the surface and pedestrian access. Image predictions alone are not enough.');
   if(proceed){VISION.review(segment,label);reviewed=true;}
  }
  trainerCounts();
  predictionLine(sample);
  $('trainerStatus').textContent='Training example saved locally: '+label+
   (reviewed?'. This mapped segment is now human-reviewed for strict routing.':
    '. No map segment was confirmed.');
  if(st.gravelSegments.length)drawGravel(st.gravelSegments);
  message(reviewed?'Surface review saved. Generate the strict route again to use it.':
    'Training example saved. The classifier improves as you add diverse labels.',6600);
 }catch(e){message('Could not save label: '+(e?.message||e),6400);}
}
function trainRandom(){
 if(!st.map)return;
 const c=st.map.getCenter(),angle=Math.random()*Math.PI*2,meters=35+Math.random()*230;
 const lat=c.lat+meters*Math.cos(angle)/111195;
 const lon=c.lng+meters*Math.sin(angle)/(111195*Math.max(.15,Math.cos(c.lat*Math.PI/180)));
 trainAt(lat,lon);
}
function exportTrainingSet(){
 if(!VISION)return;
 try{
  const json=JSON.stringify(VISION.exportTraining(),null,2);
  download(json,'surfacestride-austin-training-labels.json','application/json');
  message('Labeled color/texture features exported. No NAIP images are included.',6000);
 }catch(e){message('Could not export labels: '+(e?.message||e),6000);}
}
async function importTrainingSet(file){
 if(!file||!VISION)return;
 try{
  if(file.size>3000000)throw Error('Use a training JSON file under 3 MB');
  const json=JSON.parse(await file.text());
  const stats=VISION.importTraining(json);
  trainerCounts();predictionLine(st.trainerSample);
  message('Labeled examples imported. '+Object.values(stats).reduce((a,b)=>a+b,0)+' samples now saved locally.',6500);
 }catch(e){message('Could not import labels: '+(e?.message||e),6500);}
 finally{$('importDatasetFile').value='';}
}
async function batchAnalyze(){
 if(st.batchBusy||!VISION)return;
 let c=VISION.count(),total=Object.values(c).reduce((a,b)=>a+b,0);
 if(total<8||Object.values(c).filter(n=>n>=2).length<2){
  $('batchStatus').textContent='Label at least 8 NAIP samples in two or more classes first. The classifier is not trained yet.';
  switchTab('discover');return;
 }
 st.batchBusy=true;$('trainBatchBtn').disabled=true;
 $('batchStatus').textContent='Checking unknown paths with close-up aerial patches…';
 try{
  if(!st.gravelSegments.length){
   st.gravelSegments=await E.nearbyGravel(st.map.getCenter());
   drawGravel(st.gravelSegments);
  }
  const reviews=VISION.getReviews(),seen=new Set();
  const unknown=st.gravelSegments.filter(s=>{
   if(!s.segmentKey||reviews[s.segmentKey]?.confirmed||s.surface!=='unknown')return false;
   const ref=String(s.id);if(seen.has(ref))return false;seen.add(ref);return true;
  }).slice(0,6);
  if(!unknown.length){
   $('batchStatus').textContent='No nearby unreviewed unknown-surface paths in this map extract.';return;
  }
  let done=0,suggestions=0;
  for(const s of unknown){
   try{
    const sample=await VISION.capture((s.a[0]+s.b[0])/2,(s.a[1]+s.b[1])/2,
      {spanMeters:38,px:384});
    const prediction=VISION.predict(sample.vector);
    st.aiSuggestions.set(s.segmentKey,prediction);
    if(prediction.label!=='unknown'&&prediction.confidence>=.75)suggestions++;
   }catch(e){/* Keep other candidates available. */}
   done++;
   $('batchStatus').textContent='Visual checks '+done+'/'+unknown.length+
     ' · '+suggestions+' likely material suggestions. ALL are unverified.';
   if(done<unknown.length)await new Promise(resolve=>setTimeout(resolve,850));
  }
  if(st.gravelSegments.length)drawGravel(st.gravelSegments);
  $('batchStatus').textContent='Analyzed '+done+' nearby unknown trail sections; '+suggestions+
   ' model suggestions. Dotted cyan/colored lines are still UNVERIFIED until you open and confirm them.';
 }catch(e){
  $('batchStatus').textContent='Batch imagery unavailable: '+(e?.message||e);
 }finally{st.batchBusy=false;$('trainBatchBtn').disabled=false;}
}
function trailReviewPopup(s){
 const div=document.createElement('div');div.className='trail-review';
 const title=document.createElement('h3');
 title.textContent=s.likelyTrail?'Possible narrow mapped path':
  (s.surface==='gravel'?'Mapped gravel':s.surface==='dirt'?'Mapped dirt':'Mapped '+s.surface);
 const text=document.createElement('p');
 const review=VISION?.getReviews?.()?.[s.segmentKey],prediction=st.aiSuggestions.get(s.segmentKey);
 text.textContent=(s.name||'Unnamed footpath')+' · '+(s.highway||'path')+' · '+
  (review?.confirmed?'Your confirmed surface review: '+review.label:
   s.evidence==='tagged'?'OSM surface tag: '+s.surface:
   prediction?.label&&prediction.label!=='unknown'?'Model suggests '+prediction.label+' (UNVERIFIED)':
   'Surface not classified');
 const note=document.createElement('p');note.className='muted';
 note.textContent='Zoom in to inspect grass vs gravel vs dirt vs pavement. Confirm only what you actually recognize; verify pedestrian access.';
 const train=document.createElement('button');
 train.textContent='Zoom in / Train & review this surface';
 train.className='vision-review-button';
 train.addEventListener('click',()=>startTraining(s));
 const add=document.createElement('button');add.textContent='Add this small path to my route';
 add.addEventListener('click',()=>addReviewedSegment({lat:s.a[0],lon:s.a[1]},
   {lat:s.b[0],lon:s.b[1]},'mapped footpath',s));
 const view=document.createElement('button');view.textContent='Inspect in Instant Street View';
 view.style.background='#eaf4e8';view.style.color='#276044';
 view.addEventListener('click',()=>window.open('https://www.instantstreetview.com/s/'+
  ((s.a[0]+s.b[0])/2).toFixed(6)+','+((s.a[1]+s.b[1])/2).toFixed(6),'_blank','noopener,noreferrer'));
 div.append(title,text,note,train,add,view);return div;
}
function drawGravel(segments){
 st.gravelLayer.clearLayers();st.gravelSegments=segments;
 const ids=new Set(),possible=new Set(),tiny=new Set(),reviews=VISION?.getReviews?.()||{};
 for(const s of segments){
  const human=reviews[s.segmentKey]?.confirmed?reviews[s.segmentKey]:null;
  const prediction=st.aiSuggestions.get(s.segmentKey);
  const strong=prediction?.label&&prediction.label!=='unknown'&&prediction.confidence>=.75;
  const kind=human?human.label:strong?prediction.label:s.likelyTrail?'possible':s.surface;
  const col=COLORS[kind]||COLORS.unknown;
  const line=L.polyline([s.a,s.b],{
   color:col,weight:human?5.4:s.likelyTrail?4:s.evidence==='tagged'?4.3:3.1,
   dashArray:human?undefined:strong?'3 6':s.likelyTrail?'6 7':s.microtrail?'3 5':undefined,
   opacity:human?1:s.evidence==='tagged'?.97:.88,
   interactive:true
  });
  line.bindPopup(()=>trailReviewPopup(s),{maxWidth:270});
  line.on('click',e=>L.DomEvent.stopPropagation(e));
  line.addTo(st.gravelLayer);
  ids.add(s.id);if(s.likelyTrail)possible.add(s.id);if(s.microtrail)tiny.add(s.id);
 }
 st.gravelOn=true;$('gravelBtn').classList.add('active');
 $('gravelStatus').textContent=ids.size+' mapped paths/tracks in the scanned area, including '+
  possible.size+' possible trails with untagged surfaces and '+tiny.size+
  ' short or informal paths. Dashed yellow = surface unknown, NOT confirmed dirt.';
}
async function toggleGravel(force=false){
 if(st.gravelOn&&!force){
  st.gravelLayer.clearLayers();st.gravelOn=false;$('gravelBtn').classList.remove('active');
  $('gravelStatus').textContent='Mapped small-trail overlay hidden.';return;
 }
 const center=st.map?.getCenter();if(!center)return;
 $('gravelStatus').textContent='Searching mapped tiny paths, informal footways, and dirt/gravel trails…';
 try{
  const rows=await E.nearbyGravel(center);
  drawGravel(rows);
  message(rows.length?rows.length+' mapped trail segments shown. Click any line to inspect or add it.':
   'No mapped tiny paths found here. Try aerial scout or trace a visible trail.',6500);
 }catch(err){
  $('gravelStatus').textContent='Small-trail lookup failed: '+(err?.message||err);
  message('Map extract unavailable. Try aerial scout or pan to another area.',5000);
 }
}
function aerialPopup(candidate){
 const div=document.createElement('div');div.className='trail-review';
 const heading=document.createElement('h3');heading.textContent='Possible unmapped narrow path';
 const p=document.createElement('p');
 p.textContent='Aerial pattern: '+candidate.kind+'. Could instead be drainage, a rooftop, a shadow, or bare ground.';
 const note=document.createElement('p');note.className='muted';
 note.textContent='Unverified image interpretation. No proof of walking access, gravel, or safe connectivity.';
 const button=document.createElement('button');button.textContent='Review and include segment';
 button.addEventListener('click',()=>addReviewedSegment(candidate.a,candidate.b,'aerial image line'));
 const view=document.createElement('button');view.textContent='Inspect in Instant Street View';
 view.style.background='#edf5ea';view.style.color='#275b42';
 view.addEventListener('click',()=>{
  const lat=(candidate.a.lat+candidate.b.lat)/2,lon=(candidate.a.lon+candidate.b.lon)/2;
  window.open('https://www.instantstreetview.com/s/'+lat.toFixed(6)+','+lon.toFixed(6),
   '_blank','noopener,noreferrer');
 });
 div.append(heading,p,note,button,view);return div;
}
function clearAerial(){
 st.aerialLayer.clearLayers();st.aerialOn=false;st.aerialCandidates=[];
 $('aerialBtn').classList.remove('active');
 $('aerialStatus').textContent='Aerial suggestions hidden. Scan another area or trace a path manually.';
}
async function scanAerial(){
 if(st.aerialBusy||!st.map)return;
 const A=window.SurfaceStrideAerial;
 if(!A?.scan){$('aerialStatus').textContent='Aerial detection script was blocked. Refresh the page.';return;}
 st.aerialBusy=true;$('aerialScanBtn').disabled=true;
 $('aerialStatus').textContent='Scanning a roughly 510 m-wide image around the center of the map…';
 try{
  const candidates=await A.scan(st.map.getCenter());
  st.aerialCandidates=candidates;st.aerialLayer.clearLayers();
  for(const candidate of candidates){
   const l=L.polyline([[candidate.a.lat,candidate.a.lon],[candidate.b.lat,candidate.b.lon]],{
    color:candidate.kind==='dark corridor'?'#e69f66':'#ffb649',
    weight:4.7,dashArray:'5 7',opacity:.9,interactive:true});
   l.bindPopup(()=>aerialPopup(candidate),{maxWidth:275});
   l.on('click',e=>L.DomEvent.stopPropagation(e));
   l.addTo(st.aerialLayer);
  }
  st.aerialOn=candidates.length>0;
  $('aerialBtn').classList.toggle('active',st.aerialOn);
  $('aerialStatus').textContent=candidates.length?
   candidates.length+' LOW-confidence features in aerial imagery. Dashed orange may indicate narrow tracks, drainage, or image artifacts. Click to inspect and review.':
   'No obvious narrow lines detected here. Tiny dirt trails beneath trees may remain invisible; trace a visible route manually.';
  message(candidates.length?candidates.length+' possible image lines shown; verify before use.':
   'No aerial line suggestions here. You can trace a missing trail manually.',6500);
 }catch(err){
  $('aerialStatus').textContent='Aerial scan unavailable: '+(err?.message||err)+'. Try tracing the path yourself.';
  message('Aerial scanner unavailable. Manual trail tracing still works.',5500);
 }finally{st.aerialBusy=false;$('aerialScanBtn').disabled=false;}
}
function confirmTracedTrails(label){
 if(!VISION?.saveConnector){message('Surface confirmation module missing. Refresh the Studio.');return;}
 const runs=[],points=st.waypoints;let current=null;
 for(let i=1;i<points.length;i++){
  if(points[i].manualToHere){
   if(!current)current=[points[i-1]];
   current.push(points[i]);
  }else if(current){if(current.length>=2)runs.push(current);current=null;}
 }
 if(current&&current.length>=2)runs.push(current);
 if(!runs.length){
  message('First use Trace trail, click at least two points along the missing path, then confirm its surface.',7000);
  return;
 }
 const verified=window.confirm('Confirm ALL of the traced sections are actually '+label+
  ' and walkable with permitted access? This creates human-reviewed path connections. Aerial imagery and the model cannot verify surface, permissions or safety by themselves.');
 if(!verified)return;
 let count=0;
 for(const run of runs)try{
  VISION.saveConnector(run,label);count++;
 }catch(err){message('Could not save a segment: '+(err?.message||err),6500);}
 $('traceSavedCount').textContent=VISION.getConnectors().length+' saved';
 if(count){
  st.traceOn=false;$('traceTrailBtn').textContent='✎ Trace a path I can see';
  $('traceTrailBtn').classList.remove('active');$('traceMapBtn').classList.remove('active');
  setMode('auto');
  status(count+' '+label+' trail connection(s) saved. Generate a strict route again to use them. Unmapped connections appear as human-reviewed, not OSM-tagged.');
  message('Traced gravel/dirt connector saved. Generate a strict route again.',7000);
 }
}
function toggleTrace(){
 st.traceOn=!st.traceOn;
 if(st.traceOn){
  if(st.straight){st.straight=false;$('straightToggle').checked=false;}
  if(st.mode!=='draw')setMode('draw',false);
  st.waypoints=[];st.markerLayer.clearLayers();
  switchTab('build');
  status('Trace mode: click several points along the narrow trail. These links will stay in the route as unverified manual segments. Click Finish tracing when done.');
  message('Trace active. Click along the skinny trail; each connection is a manual sketch.',7000);
 }else status('Trail tracing ended. New waypoint legs can follow the mapped walking network.');
 $('traceTrailBtn').textContent=st.traceOn?'✓ Finish tracing small trail':'✎ Trace a path I can see';
 $('traceTrailBtn').classList.toggle('active',st.traceOn);
 $('traceMapBtn').classList.toggle('active',st.traceOn);
}
async function showWeather(){
 $('weatherCard').hidden=false;$('weatherInfo').textContent='Loading current conditions…';
 try{
  const c=st.map.getCenter(),w=await E.weather(c);
  $('weatherInfo').innerHTML='<strong>'+Number(w.temperature_2m).toFixed(0)+'°F</strong>'+
   '<p>Wind '+Number(w.wind_speed_10m).toFixed(0)+' mph from '+Math.round(w.wind_direction_10m)+'°'+
   '<br>Humidity '+Math.round(w.relative_humidity_2m)+'%<br>Source: Open-Meteo current conditions.</p>';
 }catch(err){$('weatherInfo').textContent='Weather temporarily unavailable.';}
}
function streetView(){const p=st.map.getCenter();
 window.open('https://www.instantstreetview.com/s/'+p.lat.toFixed(6)+','+p.lng.toFixed(6),'_blank','noopener,noreferrer');
}
async function geocode(event){
 event?.preventDefault();const q=$('placeInput').value.trim();if(q.length<2)return;
 $('placeForm').querySelector('button').disabled=true;
 try{
  const url='https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'jsonv2',limit:'1'});
  const r=await fetch(url);
  if(!r.ok)throw Error('Search service busy');
  const result=await r.json();
  if(!result.length)throw Error('Location not found');
  st.map.setView([Number(result[0].lat),Number(result[0].lon)],15,{animate:true});
  message(result[0].display_name.split(',').slice(0,2).join(','),5500);
 }catch(err){message('Search failed: '+(err?.message||err),6000);}
 finally{$('placeForm').querySelector('button').disabled=false;}
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function download(content,name,type){
 const b=new Blob([content],{type}),url=URL.createObjectURL(b);
 const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function gpx(){if(!st.route){message('Generate a route before exporting.');return;}
 download(E.gpx(st.route),'surfacestride-'+st.route.distance_miles.toFixed(2)+'mi.gpx','application/gpx+xml');
 message('GPX downloaded. Open it with COROS on your phone.');
}
function coros(){
 if(!st.route){message('Generate a route before sending to COROS.');return;}
 const text=E.gpx(st.route),filename='surfacestride-'+st.route.distance_miles.toFixed(2)+'mi.gpx';
 const file=new File([text],filename,{type:'application/gpx+xml'});
 if(navigator.share&&navigator.canShare?.({files:[file]})){
  navigator.share({files:[file],title:'SurfaceStride running route'}).catch(err=>{
   if(err.name!=='AbortError'){gpx();message('Downloaded GPX. Share the file to COROS on your phone.',6000);}
  });
 }else{
  gpx();message('GPX downloaded. AirDrop or email it to your phone and open in COROS.',7000);
 }
}
async function copyLink(){
 if(!st.route){message('Generate a route first.');return;}
 try{
  if(!SHARE)throw Error('Sharing library unavailable');
  const url=SHARE.link(st.route,location.href);
  if(navigator.clipboard?.writeText){
   try{await navigator.clipboard.writeText(url);message('Route link copied. Open it on your phone to export for COROS.',5500);return;}
   catch(err){}
  }
  window.prompt('Copy this route link',url);
 }catch(err){message('Could not make route link: '+(err?.message||err),6500);}
}
function savedGet(){try{return JSON.parse(localStorage.getItem('surfacestride.studio.routes.v1')||'[]');}catch(e){return [];}}
function savedPut(items){try{localStorage.setItem('surfacestride.studio.routes.v1',JSON.stringify(items.slice(0,12)));return true;}catch(e){return false;}}
function saveRoute(){
 if(!st.route){message('Generate a route to save.');return;}
 const name=window.prompt('Name your saved route',st.route.title+' · '+st.route.distance_miles.toFixed(2)+' miles');
 if(!name?.trim())return;
 const value={...st.route,title:name.trim()};
 const entries=savedGet();
 entries.unshift({id:Date.now(),name:name.trim(),miles:st.route.distance_miles,
  route:value,savedAt:new Date().toISOString()});
 if(!savedPut(entries)){message('Could not save route to this browser. Try copying the link.');return;}
 renderSaved();message('Route saved in this browser.');
}
async function importGpx(file){
 if(!file)return;
 try{
  if(file.size>6000000)throw Error('GPX file is too large.');
  const text=await file.text(),xml=new DOMParser().parseFromString(text,'application/xml');
  if(xml.getElementsByTagName('parsererror').length)throw Error('Invalid GPX file.');
  let nodes=Array.from(xml.getElementsByTagNameNS('*','trkpt'));
  if(!nodes.length)nodes=Array.from(xml.getElementsByTagNameNS('*','rtept'));
  if(!nodes.length)nodes=Array.from(xml.getElementsByTagName('trkpt'));
  if(nodes.length<2)throw Error('GPX does not contain a route track.');
  const coords=nodes.map(node=>[Number(node.getAttribute('lat')),Number(node.getAttribute('lon'))])
    .filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=85&&Math.abs(p[1])<=180);
  if(coords.length<2)throw Error('Not enough valid route coordinates.');
  const points=coords.length>12000?Array.from({length:12000},(_,i)=>coords[Math.round(i*(coords.length-1)/11999)]):coords;
  const route=E.routeObject({coordinates:points,provider:'Imported GPX'},'point-to-point','Imported · '+file.name.replace(/\.gpx$/i,''));
  st.waypoints=[];setMode('auto');st.markerLayer.clearLayers();
  showRoute(route);switchTab('build');
  status('GPX route imported. Export it to COROS or switch to Draw to edit its waypoints.');
  message('GPX track imported successfully.');
 }catch(err){message('Import failed: '+(err?.message||err),7000);}
 finally{$('importGpxFile').value='';}
}
function renderSaved(){
 const items=savedGet(),box=$('savedList');box.replaceChildren();
 if(!items.length){const p=document.createElement('p');p.className='hint';p.textContent='No routes saved yet. Generate one and click Save.';box.append(p);return;}
 for(const item of items){
  const div=document.createElement('div');div.className='saved-item';
  const main=document.createElement('button');main.className='saved-main';main.type='button';
  const title=document.createElement('b');title.textContent=item.name;const detail=document.createElement('small');
  detail.textContent=(item.miles||0).toFixed(2)+' mi · '+new Date(item.savedAt).toLocaleDateString();
  main.append(title,detail);main.addEventListener('click',()=>{
   st.waypoints=[];st.markerLayer.clearLayers();setMode('auto');
   showRoute(item.route);switchTab('build');message('Saved route opened.');
  });
  const del=document.createElement('button');del.className='saved-delete';del.textContent='×';
  del.title='Delete saved route';del.addEventListener('click',()=>{
   savedPut(savedGet().filter(e=>e.id!==item.id));renderSaved();
  });
  div.append(main,del);box.append(div);
 }
}
function openShared(){
 if(!SHARE||!location.hash.startsWith('#r='))return;
 try{
  const data=SHARE.restore(location.hash);
  if(!data?.routes?.length)return;
  st.waypoints=[];setMode('auto');showRoute(data.routes[0]);
  status('Shared route loaded. Download its GPX or send to COROS.');
 }catch(err){message('Could not open shared route: '+(err?.message||err),7000);}
}
function activateInsights(which){
 st.bottomTab=which;
 $('graphBtn').classList.toggle('active',which==='elevation');$('directionsBtn').classList.toggle('active',which==='directions');
 $('elevationView').hidden=which!=='elevation';$('directionsView').hidden=which!=='directions';
 if(!st.bottomOpen){st.bottomOpen=true;$('bottomPanel').classList.add('open');}
}
function wires(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
 document.querySelectorAll('[data-shape]').forEach(b=>b.addEventListener('click',()=>{
  st.shape=b.dataset.shape;
  document.querySelectorAll('[data-shape]').forEach(x=>x.classList.toggle('active',x===b));
 }));
 document.querySelectorAll('[data-preference]').forEach(b=>b.addEventListener('click',()=>{
  st.preference=b.dataset.preference;
  document.querySelectorAll('[data-preference]').forEach(x=>x.classList.toggle('active',x===b));
  if(st.preference==='gravel')st.softMaterial='gravel';
  else if(st.preference==='soft'||st.preference==='mixed')st.softMaterial='both';
  else if(st.preference==='paved'&&st.strictSoft){
   st.strictSoft=false;$('strictSoftToggle').checked=false;
   $('strictSoftNote').textContent='Strict gravel/dirt routing was disabled because you selected pavement.';
   message('Pavement selected: strict gravel/dirt-only restriction turned off.',5600);
  }
  document.querySelectorAll('[data-soft-material]').forEach(x=>
   x.classList.toggle('active',x.dataset.softMaterial===st.softMaterial));
  if(st.route)status('Surface preference updated. Generate again to use the new preference.');
 }));
 document.querySelectorAll('[data-terrain]').forEach(b=>b.addEventListener('click',()=>{
  st.terrain=b.dataset.terrain;document.querySelectorAll('[data-terrain]').forEach(x=>x.classList.toggle('active',x===b));
 }));
 $('distanceRange').addEventListener('input',e=>{
  st.miles=Number(e.target.value);$('distanceLabel').textContent=st.miles.toFixed(1);$('kmLabel').textContent=(st.miles*KM).toFixed(1)+' km';
 });
 document.querySelectorAll('[data-mi]').forEach(b=>b.addEventListener('click',()=>{
  st.miles=Number(b.dataset.mi);$('distanceRange').value=st.miles;
  $('distanceLabel').textContent=st.miles.toFixed(1);$('kmLabel').textContent=(st.miles*KM).toFixed(1)+' km';
 }));
 $('quietToggle').addEventListener('change',e=>{st.quiet=e.target.checked;});
 $('strictSoftToggle').addEventListener('change',e=>{
  st.strictSoft=e.target.checked;
  $('strictSoftNote').textContent=st.strictSoft?
   'Strict routing uses only connected gravel/dirt OSM tags or your confirmed labels. Pavement is never inserted; distance can be shorter.':
   'Standard walking routing can include paved roads. Surface percentages are estimated afterward.';
  if(st.route)status('Routing policy changed. Regenerate the route to apply it.');
 });
 document.querySelectorAll('[data-soft-material]').forEach(b=>b.addEventListener('click',()=>{
  st.softMaterial=b.dataset.softMaterial;
  document.querySelectorAll('[data-soft-material]').forEach(x=>x.classList.toggle('active',x===b));
  if(st.route)status('Material changed. Regenerate to use only '+st.softMaterial+' paths.');
 }));
 function openFullTrainer(){
  const p=st.map?.getCenter();
  const q=p?'?lat='+p.lat.toFixed(6)+'&lon='+p.lng.toFixed(6)+'&v=trainer-v5':'?v=trainer-v5';
  window.location.href='./train.html'+q;
 }
 $('trainMapCenterBtn').addEventListener('click',openFullTrainer);
 $('trainMapBtn').addEventListener('click',openFullTrainer);
 $('trainUploadBtn').addEventListener('click',()=>$('trainFile').click());
 $('trainFile').addEventListener('change',e=>trainUpload(e.target.files?.[0]));
 document.querySelectorAll('[data-training-label]').forEach(b=>
  b.addEventListener('click',()=>labelSample(b.dataset.trainingLabel)));
 $('trainBatchBtn').addEventListener('click',batchAnalyze);
 $('trainRandomBtn').addEventListener('click',trainRandom);
 $('exportDatasetBtn').addEventListener('click',exportTrainingSet);
 $('importDatasetBtn').addEventListener('click',()=>$('importDatasetFile').click());
 $('importDatasetFile').addEventListener('change',e=>importTrainingSet(e.target.files?.[0]));
 $('straightToggle').addEventListener('change',e=>{
  st.straight=e.target.checked;
  if(st.mode==='draw'&&st.waypoints.length>=2)deferManual();
  status(st.straight?'Manual straight-line mode: geometry will NOT follow mapped paths. Verify land access before running.':
    'Snap mode: route lines follow the mapped pedestrian network.');
 });
 $('importGpxBtn').addEventListener('click',()=>$('importGpxFile').click());
 $('importGpxFile').addEventListener('change',e=>importGpx(e.target.files?.[0]));
 $('autoMode').addEventListener('click',()=>setMode('auto'));
 $('drawMode').addEventListener('click',()=>setMode('draw',true));
 $('generateBtn').addEventListener('click',()=>st.mode==='draw'?manualBuild():autoGenerate());
 $('rerollBtn').addEventListener('click',reroll);
 $('clearBtn').addEventListener('click',()=>clearRoute());
 $('undoBtn').addEventListener('click',undo);
 $('reverseBtn').addEventListener('click',reverseRoute);
 $('placeForm').addEventListener('submit',geocode);
 $('labelsBtn').addEventListener('click',()=>{
  st.labelsOn=!st.labelsOn;st.labels.forEach(l=>st.labelsOn?l.addTo(st.map):st.map.removeLayer(l));
  $('labelsBtn').classList.toggle('active',st.labelsOn);
 });
 $('gravelBtn').addEventListener('click',()=>toggleGravel());
 $('aerialBtn').addEventListener('click',scanAerial);
 $('aerialScanBtn').addEventListener('click',scanAerial);
 $('clearAerialBtn').addEventListener('click',clearAerial);
 $('traceTrailBtn').addEventListener('click',toggleTrace);
 $('confirmTraceGravelBtn').addEventListener('click',()=>confirmTracedTrails('gravel'));
 $('confirmTraceDirtBtn').addEventListener('click',()=>confirmTracedTrails('dirt'));
 $('traceMapBtn').addEventListener('click',toggleTrace);
 $('scanGravelBtn').addEventListener('click',()=>toggleGravel(true));
 $('clearGravelBtn').addEventListener('click',()=>toggleGravel());
 $('zoneBtn').addEventListener('click',armZone);$('clearZoneBtn').addEventListener('click',clearZone);
 $('weatherBtn').addEventListener('click',()=>{
  $('weatherBtn').classList.toggle('active');
  if($('weatherCard').hidden)showWeather();else $('weatherCard').hidden=true;
 });
 $('closeWeather').addEventListener('click',()=>{$('weatherCard').hidden=true;$('weatherBtn').classList.remove('active');});
 $('streetBtn').addEventListener('click',streetView);
 $('minimizeSummary').addEventListener('click',()=>{$('routeSummary').hidden=true;message('Route summary hidden. Click the route to inspect.');});
 $('saveRouteBtn').addEventListener('click',saveRoute);
 $('copyRouteBtn').addEventListener('click',copyLink);
 $('corosBtn').addEventListener('click',coros);
 $('downloadGpxBtn').addEventListener('click',gpx);
 $('bottomToggle').addEventListener('click',()=>{
  st.bottomOpen=!st.bottomOpen;$('bottomPanel').classList.toggle('open',st.bottomOpen);
  if(st.map)setTimeout(()=>st.map.invalidateSize(),250);
 });
 $('graphBtn').addEventListener('click',()=>activateInsights('elevation'));
 $('directionsBtn').addEventListener('click',()=>activateInsights('directions'));
 const help=()=>{$('helpDialog').showModal();};
 $('helpBtn').addEventListener('click',help);
 $('closeHelp').addEventListener('click',()=>$('helpDialog').close());
 $('closeHelp2').addEventListener('click',()=>$('helpDialog').close());
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&st.zoneStage===1)clearZone();
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){
   e.preventDefault();undo();
  }
 });
}
function start(){
 if(!E){$('routeMessage').textContent='Studio engine did not load. Refresh this page.';return;}
 wires();setupMap();renderSaved();trainerCounts();
 $('traceSavedCount').textContent=(VISION?.getConnectors?.()?.length||0)+' saved';openShared();
}
window.SurfaceStrideStudio={_state:st,_test:{esc}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
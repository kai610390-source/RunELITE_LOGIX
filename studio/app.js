/* SurfaceStride Studio — independent no-subscription route builder. */
(function(){
'use strict';
const E=window.SurfaceStrideStudioEngine;
const TAGS=window.SurfaceStrideSurfaceTags;
const SHARE=window.SurfaceStrideShare;
const WALK=window.SurfaceStrideWalking;
const $=id=>document.getElementById(id);
const COLORS={grass:'#50d487',dirt:'#b7825a',gravel:'#efb061',paved:'#9db6b0',track:'#d08cbd',unknown:'#c6cbd0'};
const KM=1.609344,MI=1609.344;
const st={map:null,route:null,routeVersion:0,mode:'auto',shape:'loop',miles:5,preference:'soft',
 terrain:'any',quiet:true,waypoints:[],straight:false,reroll:0,working:false,
 zoneStage:0,zoneStart:null,zone:null,labelsOn:true,gravelOn:false,
 routeLayer:null,markerLayer:null,gravelLayer:null,zoneLayer:null,gravelSegments:[],
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
 st.zoneLayer=L.layerGroup().addTo(map);
 L.control.zoom({position:'bottomright'}).addTo(map);
 map.on('click',onMapClick);
 map.on('mousemove',e=>{
  if(st.zoneStage!==1)return;
  drawZone(st.zoneStart,e.latlng,true);
 });
 map.on('moveend',()=>{
  if(!st.route)$('mapStatus').innerHTML='SATELLITE VIEW <span>·</span> '+(st.mode==='draw'?'Tap to place route points':'Generate near map center');
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
 st.waypoints.push({lat:e.latlng.lat,lon:e.latlng.lng});
 drawMarkers();
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
   const v=marker.getLatLng();st.waypoints[i]={lat:v.lat,lon:v.lng};drawMarkers();deferManual();
  });
  marker.on('contextmenu',e=>{
   L.DomEvent.stopPropagation(e);
   if(st.waypoints.length<=2){status('Use Undo or Clear to remove a route endpoint.');return;}
   st.waypoints.splice(i,1);drawMarkers();deferManual();message('Waypoint removed.');
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
 $('surfaceConfidence').textContent=(r.surface_data_status==='scanned'?
  (r.tagged_percent||0)+'% OSM-tagged · '+(r.inferred_percent||0)+'% inferred · '+(r.unknown_percent||0)+'% unknown':
  'Surface lookup pending or unavailable. Unknown does not mean paved.');
}
function updateStats(){
 const r=st.route;if(!r)return;
 $('routeSummary').hidden=false;
 $('routeMiles').textContent=r.distance_miles.toFixed(2);
 $('routeGain').textContent=r.elevation_gain_ft===undefined?'—':r.elevation_gain_ft.toLocaleString();
 $('bottomRouteName').textContent=r.title||'Running route';
 surfaceSummary();renderDirections();
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
 const surface=TAGS?.enrich?TAGS.enrich(r,{preference:st.preference},progress=>{
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
  if(versionsMatch())status('Route ready. Inspect the surface colors, edit waypoints, or export GPX for COROS.');
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
 return {lat:p.lat+meters*Math.cos(bearing*Math.PI/180)/111195,
  lon:p.lng+meters*Math.sin(bearing*Math.PI/180)/(111195*Math.max(.15,Math.cos(p.lat*Math.PI/180)))};
}
async function autoGenerate(){
 if(st.working||!st.map)return;
 setBusy(true,'Calculating route…');
 status('Connecting walking routes. Satellite surfaces are classified after the route is drawn.');
 try{
  const center=centerForAuto();
  const base=st.reroll?offset(center,(st.reroll*131)%360,Math.min(470,90+st.reroll*43)):center;
  let route;
  if(st.shape==='point-to-point'){
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
  status('Suggested '+route.distance_miles.toFixed(2)+'-mile route. Surface tags are loading separately.');
 }catch(err){status('Could not generate route: '+(err?.message||err));message('Route unavailable. Try another area or draw waypoints.',6500);}
 finally{setBusy(false);}
}
function deferManual(){clearTimeout(manualTimer);manualTimer=setTimeout(manualBuild,550);}
async function manualBuild(){
 if(st.mode!=='draw'||st.waypoints.length<2||st.working)return;
 const copy=st.waypoints.map(x=>({...x})),request=++lastRouteRequest;
 setBusy(true,st.straight?'Drawing manual line…':'Snapping route…');
 try{
  const route=st.straight?E.directRoute(copy):await E.snapRoute(copy);
  if(request!==lastRouteRequest||st.mode!=='draw')return;
  route.title=st.straight?'Off-road sketch':'Custom running route';
  route.mode='point-to-point';
  showRoute(route,{preserveView:true});
  status('Route edited. Drag a marker to reroute; right-click to delete a waypoint.');
 }catch(err){
  status('Could not join those points: '+(err?.message||err)+'. Try closer waypoints or enable manual straight lines.');
 }finally{setBusy(false);}
}
function undo(){
 if(st.mode==='draw'&&st.waypoints.length){
  st.waypoints.pop();drawMarkers();
  if(st.waypoints.length>=2)deferManual();
  else clearRoute(false);
  return;
 }
 if(st.route){clearRoute();message('Route cleared.');}
}
function reverseRoute(){
 if(st.mode==='draw'&&st.waypoints.length>=2){
  st.waypoints.reverse();drawMarkers();deferManual();return;
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
function drawGravel(segments){
 st.gravelLayer.clearLayers();st.gravelSegments=segments;
 for(const s of segments){
  const col=COLORS[s.surface];if(!col)continue;
  const line=L.polyline([s.a,s.b],{color:col,weight:s.evidence==='tagged'?4.3:2.6,opacity:s.evidence==='tagged'?.95:.7});
  line.bindPopup('<strong>'+esc(s.name||'Unnamed path')+'</strong><br>'+esc(s.surface)+' · '+
   (s.evidence==='tagged'?'OSM tagged':'Inferred, not confirmed'));
  line.on('click',e=>{
   L.DomEvent.stopPropagation(e);
   if(st.mode==='draw')insertPointAt(e.latlng);
  });
  line.addTo(st.gravelLayer);
 }
 st.gravelOn=true;$('gravelBtn').classList.add('active');
 $('gravelStatus').textContent=segments.length+' matching mapped surface segments nearby (some may be inferred).';
}
async function toggleGravel(force=false){
 if(st.gravelOn&&!force){
  st.gravelLayer.clearLayers();st.gravelOn=false;$('gravelBtn').classList.remove('active');
  $('gravelStatus').textContent='Gravel overlay hidden.';return;
 }
 const center=st.map?.getCenter();if(!center)return;
 $('gravelStatus').textContent='Loading nearby surface tags from OpenStreetMap…';
 try{
  const rows=await E.nearbyGravel(center);
  drawGravel(rows);message(rows.length?rows.length+' mapped surface segments loaded.':'No tagged soft-surface ways in this area.',5500);
 }catch(err){
  $('gravelStatus').textContent='Could not load this small map extract: '+(err?.message||err);
  message('Gravel overlay unavailable. Try zooming to another area.',5000);
 }
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
  if(st.route){status('Surface preference updated. Regenerate to explore another route; tag percentages describe the current route.');}
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
 wires();setupMap();renderSaved();openShared();
}
window.SurfaceStrideStudio={_state:st,_test:{esc}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();
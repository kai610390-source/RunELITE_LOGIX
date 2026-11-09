/* SurfaceStride Satellite Scout — experimental path proposals from public-domain NAIP imagery.
   No Google imagery is scraped. A proposal is not evidence of public access or gravel. */
(function(){
  'use strict';
  var SERVICE='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
  var KEY='surfacestride.scout.reviewed.v1';
  var R=6378137;
  var map=null, layer=null, panel=null, launcher=null, status=null, candidates=[], paths=[];
  var draft=[], tracing=false, busy=false, scanBounds=null;
  function $(id){return document.getElementById(id);}
  function deg(v){return v*Math.PI/180;}
  function merc(lon,lat){return {x:R*deg(lon),y:R*Math.log(Math.tan(Math.PI/4+deg(Math.max(-85,Math.min(85,lat)))/2))};}
  function unmerc(x,y){return {lon:x/R*180/Math.PI,lat:(2*Math.atan(Math.exp(y/R))-Math.PI/2)*180/Math.PI};}
  function pixelPoint(x,y,b,w,h){return unmerc(b.left+(x/w)*(b.right-b.left),b.top-(y/h)*(b.top-b.bottom));}
  function feet(a,b){var la=deg(a.lat),lb=deg(b.lat),dlat=lb-la,dlon=deg(b.lon-a.lon);
    var q=Math.sin(dlat/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dlon/2)**2;
    return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(q)))*3.28084;
  }
  function detect(rgba,w,h){
    var light=new Float32Array(w*h),ground=new Uint8Array(w*h),vegetation=new Uint8Array(w*h);
    var data=rgba.data||rgba;
    for(var i=0;i<w*h;i++){
      var j=i*4,r=data[j],g=data[j+1],b=data[j+2],l=.21*r+.72*g+.07*b;
      var max=Math.max(r,g,b),min=Math.min(r,g,b),sat=(max-min)/Math.max(1,max);
      light[i]=l;
      ground[i]=l>88 && ((sat<.32 && Math.abs(r-g)<48)||(r>g*.94 && g>b*.91 && r-b<110))?1:0;
      vegetation[i]=g>r+6 && g>b+2 && l>38?1:0;
    }
    function at(x,y){x=Math.round(x);y=Math.round(y);return x<0||y<0||x>=w||y>=h?-1:y*w+x;}
    function lineScore(x,y,dx,dy){
      var hits=0,contrast=0,green=0,n=0;
      for(var t=-31;t<=31;t+=7){
        var mx=x+t*dx,my=y+t*dy,c=at(mx,my),s1=at(mx-11*dy,my+11*dx),s2=at(mx+11*dy,my-11*dx);
        if(c<0||s1<0||s2<0)continue;
        hits+=ground[c];
        contrast+=light[c]-(light[s1]+light[s2])/2;
        green+=vegetation[s1]+vegetation[s2];
        n++;
      }
      if(n<8 || hits/n<.7 || contrast/n<9 || green/(n*2)<.2)return null;
      var score=contrast/n+green/n*5+hits/n*10;
      return score>19?{score:score,coverage:hits/n,green:green/(2*n)}:null;
    }
    var raw=[],edge=45;
    for(var y=edge;y<h-edge;y+=8)for(var x=edge;x<w-edge;x+=8)
      for(var a=0;a<12;a++){
        var theta=a*Math.PI/12,dx=Math.cos(theta),dy=Math.sin(theta),s=lineScore(x,y,dx,dy);
        if(s)raw.push({x:x,y:y,dx:dx,dy:dy,score:s.score,coverage:s.coverage,angle:theta});
      }
    raw.sort(function(a,b){return b.score-a.score;});
    var out=[];
    for(var k=0;k<raw.length&&out.length<24;k++){
      var c=raw[k],near=out.some(function(p){
        var d=Math.hypot(c.x-p.x,c.y-p.y),a=Math.abs(c.angle-p.angle);
        return d<39 && (Math.min(a,Math.PI-a)<.48||d<24);
      });
      if(near)continue;
      out.push(c);
    }
    return out;
  }
  function loadSaved(){
    try{
      var raw=JSON.parse(localStorage.getItem(KEY)||'[]');
      if(Array.isArray(raw))paths=raw.filter(function(p){
        return p&&Array.isArray(p.points)&&p.points.length>=2&&p.points.length<=150&&
          p.points.every(function(v){return Number.isFinite(v.lat)&&Number.isFinite(v.lon);});
      }).slice(0,80);
    }catch(e){paths=[];}
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(paths.slice(-80)));}catch(e){}}
  function message(s){if(status)status.textContent=s;}
  function button(name,text){
    var b=document.createElement('button');b.type='button';b.textContent=text;
    b.style.cssText='padding:7px 9px;border:1px solid #d4e4d5;border-radius:8px;background:#eff8ef;color:#235a3e;font:600 11px system-ui;cursor:pointer;';
    b.dataset.scout=name;return b;
  }
  function row(s){var d=document.createElement('div');d.style.cssText='font:11px/1.5 system-ui;color:#627a69;padding:5px 0;';d.textContent=s;return d;}
  function draw(){
    if(!layer||!map||typeof L==='undefined')return;
    layer.clearLayers();
    paths.forEach(function(p,i){
      var points=p.points.map(function(c){return [c.lat,c.lon];});
      L.polyline(points,{color:'#843eb7',weight:5,opacity:.92,dashArray:'9 5'})
        .bindTooltip('Reviewed possible path '+(i+1)+' — surface/access not independently verified').addTo(layer);
    });
    candidates.forEach(function(p,i){
      if(paths.some(function(a){return a.fromScan===p.id;}))return;
      var shape=L.polyline(p.points.map(function(c){return [c.lat,c.lon];}),{color:'#f2a733',weight:5,opacity:.92,dashArray:'6 7'}).addTo(layer);
      shape.on('click',function(e){
        L.DomEvent.stopPropagation(e);
        var node=document.createElement('div');
        var txt=document.createElement('p');txt.textContent='Possible trail-like feature in aerial imagery. Gravel, access, and connectivity are NOT verified.';
        var b=button('approve','Review / include candidate');
        b.addEventListener('click',function(){approve(p);map.closePopup();});
        node.append(txt,b);
        L.popup().setLatLng(e.latlng).setContent(node).openOn(map);
      });
    });
    if(draft.length){
      L.polyline(draft.map(function(c){return [c.lat,c.lon];}),{color:'#d64664',weight:4,dashArray:'4 5'}).addTo(layer);
      draft.forEach(function(c){L.circleMarker([c.lat,c.lon],{radius:4,color:'#d64664',fillOpacity:1}).addTo(layer);});
    }
    renderList();
  }
  function renderList(){
    var c=$('scoutCandidateList'),saved=$('scoutSaved');
    if(!c)return;
    c.replaceChildren();
    if(!candidates.length)c.append(row('No scan candidates yet. Scan a small park or open area, or trace a visible path.'));
    candidates.forEach(function(p,i){
      var wrap=document.createElement('div');wrap.style.cssText='display:flex;align-items:center;gap:5px;padding:4px 0';
      var go=button('zoom','Candidate '+(i+1)+' · low confidence');
      go.addEventListener('click',function(){map.fitBounds(L.latLngBounds(p.points.map(function(z){return [z.lat,z.lon];})).pad(.8),{maxZoom:18});});
      var accept=button('approve',paths.some(function(a){return a.fromScan===p.id;})?'Added':'Review');
      accept.disabled=paths.some(function(a){return a.fromScan===p.id;});
      accept.addEventListener('click',function(){approve(p);});
      wrap.append(go,accept);c.append(wrap);
    });
    saved.replaceChildren();
    saved.append(row(paths.length+' reviewed possible path(s) stored in this browser. They can be used only near mapped paths.'));
    paths.forEach(function(p,i){
      var del=button('delete','Remove '+(i+1));
      del.addEventListener('click',function(){paths.splice(i,1);save();draw();message('Removed reviewed path. Generate again to update routes.');});
      saved.append(del);
    });
    var finish=$('scoutFinish');if(finish)finish.disabled=!tracing||draft.length<2;
  }
  function approve(p){
    if(paths.some(function(v){return v.fromScan===p.id;}))return;
    if(!confirm('Only include this possible path if you have checked that it is accessible on foot and does not cross restricted or unsafe property. Imagery cannot confirm gravel or legal access. Include as a low-confidence routing suggestion?'))return;
    paths.push({id:'scout'+Date.now()+Math.random().toString(16).slice(2),fromScan:p.id,source:'NAIP pale-line detector',points:p.points});
    save();draw();message('Saved a low-confidence possible path. Generate routes again to test mapped connections.');
  }
  function trace(){
    tracing=!tracing;draft=[];draw();
    var b=$('scoutTrace');if(b)b.textContent=tracing?'Cancel tracing':'Trace a missing path';
    message(tracing?'Click several positions along a path on the map, then select Finish trace.':'Tracing canceled.');
  }
  function finish(){
    if(draft.length<2)return;
    var length=0;for(var i=1;i<draft.length;i++)length+=feet(draft[i-1],draft[i]);
    if(length<35||length>6500){message('Trace must be between 35 and 6,500 feet.');return;}
    var p={id:'trace'+Date.now(),points:draft.slice(),source:'manual imagery review'};
    var before=paths.length;approve(p);
    if(paths.length===before){message('Trace kept until reviewed. Finish when ready.');return;}
    tracing=false;draft=[];$('scoutTrace').textContent='Trace a missing path';draw();
  }
  function imgRequest(url){
    return new Promise(function(resolve,reject){
      var img=new Image(),t=setTimeout(function(){img.onload=img.onerror=null;reject(Error('Imagery request timed out.'));},35000);
      img.crossOrigin='anonymous';
      img.onload=function(){clearTimeout(t);resolve(img);};
      img.onerror=function(){clearTimeout(t);reject(Error('Aerial imagery did not load or the server blocks browser access. Manual tracing still works.'));};
      img.src=url;
    });
  }
  async function scan(){
    if(busy||!map)return;var c=map.getCenter();
    if(c.lat<24||c.lat>50||c.lng< -125||c.lng> -66){
      message('NAIP scanning is currently available only in the continental United States. Use manual tracing elsewhere.');return;
    }
    busy=true;$('scoutScan').disabled=true;
    candidates=[];draw();message('Loading public USGS/USDA aerial imagery near the map center…');
    try{
      var m=merc(c.lng,c.lat),half=255;
      var b={left:m.x-half,right:m.x+half,bottom:m.y-half,top:m.y+half};
      var params=new URLSearchParams({bbox:[b.left,b.bottom,b.right,b.top].map(function(v){return v.toFixed(1);}).join(','),
        bboxSR:'3857',imageSR:'3857',size:'640,640',format:'jpg',f:'image'});
      var img=await imgRequest(SERVICE+'?'+params.toString());
      var canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
      var ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,640,640);
      var pixels=ctx.getImageData(0,0,640,640);
      message('Inspecting narrow pale lines in the aerial photograph…');
      await new Promise(function(resolve){setTimeout(resolve,10);});
      var lines=detect(pixels,640,640);
      scanBounds=b;
      candidates=lines.map(function(z,i){
        var a=pixelPoint(z.x-33*z.dx,z.y-33*z.dy,b,640,640);
        var middle=pixelPoint(z.x,z.y,b,640,640);
        var end=pixelPoint(z.x+33*z.dx,z.y+33*z.dy,b,640,640);
        return {id:'scan-'+Date.now()+'-'+i,points:[a,middle,end],confidence:'low',score:z.score};
      });
      draw();
      message(candidates.length?
        'Found '+candidates.length+' possible short trail-like segments in a 510 m-wide square. Orange = unverified. Inspect and review before use.':
        'No convincing narrow pale lines detected here. Try another map area or trace manually.');
    }catch(err){message('Scan unavailable: '+(err.message||err)+'. Try Trace a missing path.');}
    finally{busy=false;$('scoutScan').disabled=false;}
  }
  function init(opts){
    if(!opts||!opts.map||typeof L==='undefined')return;
    map=opts.map;layer=L.layerGroup().addTo(map);loadSaved();
    var host=document.querySelector('.map-side');if(!host)return;
    launcher=button('toggle','Satellite Scout ◇');
    launcher.style.cssText+='position:absolute;top:143px;right:14px;z-index:699;box-shadow:0 2px 18px #132e2840;padding:10px 13px;background:#fff;';
    host.append(launcher);
    panel=document.createElement('section');panel.hidden=true;panel.id='scoutPanel';
    panel.style.cssText='position:absolute;right:12px;top:185px;z-index:699;width:min(340px,calc(100% - 24px));max-height:45%;overflow:auto;background:#fff;box-shadow:0 8px 30px #102b2240;padding:14px;border-radius:14px;border:1px solid #cddfd1;font:11px/1.5 system-ui;';
    panel.innerHTML='<strong style="font-size:15px;color:#285a41">Satellite Scout · experimental</strong><p style="color:#738b7c;margin:6px 0 11px">Find possible narrow paths missed by OSM. Aerial color alone cannot verify gravel, access, or connectivity.</p><div id="scoutActions" style="display:flex;flex-wrap:wrap;gap:6px"></div><p id="scoutStatus" role="status" style="color:#526e5c;font-size:11px">Scan the visible area or trace a missing path.</p><div id="scoutCandidateList"></div><hr style="border:0;border-top:1px solid #e1e8e3;margin:10px 0"><strong>Reviewed candidates</strong><div id="scoutSaved"></div><p style="color:#809085;font-size:10px">Source: USGS/USDA NAIP public imagery. Detection is heuristic, not AI-trained or validated. Purple = reviewed, orange = proposed. No direct Google imagery analysis.</p>';
    host.append(panel);status=$('scoutStatus');
    var buttons=$('scoutActions');
    var scanButton=button('scan','Scan aerial image');scanButton.id='scoutScan';scanButton.addEventListener('click',scan);
    var traceButton=button('trace','Trace a missing path');traceButton.id='scoutTrace';traceButton.addEventListener('click',trace);
    var finishButton=button('finish','Finish trace');finishButton.id='scoutFinish';finishButton.disabled=true;finishButton.addEventListener('click',finish);
    var street=button('streetview','Inspect in Instant Street View');
    street.addEventListener('click',function(){
      var c=map.getCenter();
      window.open('https://www.instantstreetview.com/@'+c.lat.toFixed(6)+','+c.lng.toFixed(6)+',0h,0p,1z','_blank','noopener,noreferrer');
    });
    buttons.append(scanButton,traceButton,finishButton,street);
    launcher.addEventListener('click',function(){panel.hidden=!panel.hidden;launcher.textContent=panel.hidden?'Satellite Scout ◇':'Close Satellite Scout ×';});
    map.on('click',function(e){
      if(!tracing)return;
      if(draft.length>=150){message('Maximum 150 points per path. Finish this trace.');return;}
      draft.push({lat:e.latlng.lat,lon:e.latlng.lng});draw();
    });
    draw();
  }
  window.SurfaceStrideScout={
    init:init,scan:scan,
    getPaths:function(){return paths.map(function(p){return {points:p.points,source:p.source};});},
    get isTracing(){return tracing;},
    _test:{detect:detect,merc:merc,unmerc:unmerc,pixelPoint:pixelPoint,feet:feet}
  };
})();

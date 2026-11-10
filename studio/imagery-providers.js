/* Public-domain NAIP image sources for SurfaceStride trainer.
 * Uses Texas NAIP, USDA NAIP, USGS NAIP, then a cached USGS tile mosaic.
 * Each candidate MUST allow pixel reads before it can train a model.
 */
(function(){
'use strict';
const R=6378137,HALF=20037508.342789244;
const PROVIDERS=[
 {name:'Texas NAIP 2022',url:'https://imagery.geographic.texas.gov/server/rest/services/NAIP/NAIP22_NCCIR_60cm/ImageServer/exportImage'},
 {name:'USDA NAIP',url:'https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer/exportImage'},
 {name:'USGS NAIP',url:'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'},
 {name:'USGS NAIP Plus',url:'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage'}
];
function getImage(url,ms){
 return new Promise((resolve,reject)=>{
  const img=new Image();
  let ended=false;
  const finish=(error)=>{
   if(ended)return;
   ended=true;clearTimeout(timer);
   img.onload=null;img.onerror=null;
   error?reject(error):resolve(img);
  };
  const timer=setTimeout(()=>finish(Error('timed out')),ms);
  img.crossOrigin='anonymous';
  img.onload=()=>finish(null);
  img.onerror=()=>finish(Error('not accessible'));
  img.src=url;
 });
}
function canvasPixels(img,width,height){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('Canvas pixels unavailable');
 ctx.drawImage(img,0,0,width,height);
 const raster=ctx.getImageData(0,0,width,height);
 if(!raster?.data||raster.data.length<width*height*4)throw Error('Empty imagery');
 return {canvas,raster};
}
function bboxQuery(bounds,size){
 return new URLSearchParams({
  bbox:[bounds.left,bounds.bottom,bounds.right,bounds.top].map(n=>Number(n).toFixed(2)).join(','),
  bboxSR:'3857',imageSR:'3857',size:size+','+size,
  format:'jpg',f:'image',compressionQuality:'90'
 });
}
async function cachedTileMosaic(bounds,size,{perTileMs=4800}={}){
 // USGS National Map official public-domain cached imagery. Zoom 16 is its
 // highest reliable cached detail, so this is a lower-detail contingency.
 const zoom=16,worldTileMeters=2*HALF/(2**zoom);
 const tileMinX=Math.floor((bounds.left+HALF)/worldTileMeters);
 const tileMaxX=Math.floor((bounds.right+HALF)/worldTileMeters);
 const tileMinY=Math.floor((HALF-bounds.top)/worldTileMeters);
 const tileMaxY=Math.floor((HALF-bounds.bottom)/worldTileMeters);
 const tileCount=(tileMaxX-tileMinX+1)*(tileMaxY-tileMinY+1);
 if(tileCount>12)throw Error('Tile region too large');
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('Canvas unavailable');
 const tiles=[];
 for(let x=tileMinX;x<=tileMaxX;x++)for(let y=tileMinY;y<=tileMaxY;y++){
  const url='https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/'+zoom+'/'+y+'/'+x;
  const tileLeft=-HALF+x*worldTileMeters,tileTop=HALF-y*worldTileMeters;
  const dx=(tileLeft-bounds.left)/(bounds.right-bounds.left)*size;
  const dy=(bounds.top-tileTop)/(bounds.top-bounds.bottom)*size;
  const dw=worldTileMeters/(bounds.right-bounds.left)*size;
  const dh=worldTileMeters/(bounds.top-bounds.bottom)*size;
  tiles.push(getImage(url,perTileMs).then(img=>({img,dx,dy,dw,dh})));
 }
 const results=await Promise.all(tiles);
 for(const tile of results)ctx.drawImage(tile.img,tile.dx,tile.dy,tile.dw,tile.dh);
 const raster=ctx.getImageData(0,0,size,size);
 return {canvas,raster,source:'USGS cached imagery (lower resolution)',cached:true};
}
async function capture(bounds,size,{timeoutPerSource=6500,onProgress}={}){
 const failures=[];
 for(const entry of PROVIDERS){
  if(typeof onProgress==='function')onProgress('Trying '+entry.name+' imagery…');
  try{
   const url=entry.url+'?'+bboxQuery(bounds,size);
   const img=await getImage(url,timeoutPerSource);
   const loaded=canvasPixels(img,size,size);
   return {...loaded,source:entry.name,cached:false};
  }catch(err){
   failures.push(entry.name+': '+(err?.message||err));
  }
 }
 if(typeof onProgress==='function')onProgress('Trying a cached USGS aerial map…');
 try{return await cachedTileMosaic(bounds,size)}
 catch(err){failures.push('USGS cached map: '+(err?.message||err));}
 throw Error('Aerial imagery unavailable. '+failures.join(' · ')+
  '. Your network may be blocking external imagery; use an image you own.');
}
window.SurfaceStrideImagery={capture,_test:{bboxQuery,cachedTileMosaic,providers:PROVIDERS.map(p=>p.name)}};
})();
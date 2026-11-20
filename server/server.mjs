/** SurfaceStride server: existing browser route builder + guarded map-service proxy.
 * Requires Node 20+. No third-party npm dependencies. Data/route learning stays in browser.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const allowed = /^\/(?:studio\/[a-z0-9-]+\.(?:html|js|css)|(?:index|diagnostics)\.html|(?:surface-tags|scout|foot-router|share-route)\.js)$/;
const caches = new Map();
const hits = new Map();
let lastGeocode = 0;

function send(res, code, text, type='application/json; charset=utf-8', extra={}) {
  res.writeHead(code, {'Content-Type':type, 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin', ...extra});
  res.end(text);
}
function reply(res, code, obj, extra) { send(res,code,JSON.stringify(obj),'application/json; charset=utf-8',extra); }
function limit(req, kind) {
  const ip = String(req.socket.remoteAddress || 'unknown');
  const key = kind+'|'+ip, now=Date.now();
  const row = hits.get(key) || {count:0, reset:now+60000};
  if (now > row.reset) {row.count=0; row.reset=now+60000;}
  row.count++; hits.set(key,row);
  if(hits.size>3000) for(const [k,v] of hits) if(v.reset<now)hits.delete(k);
  return row.count <= (kind==='geocode'?10:40);
}
function bbox(text) {
  if(typeof text!=='string' || !/^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){3}$/.test(text))return null;
  const p=text.split(',').map(Number), [w,s,e,n]=p;
  if(p.some(v=>!Number.isFinite(v)) || Math.abs(w)>180||Math.abs(e)>180||Math.abs(s)>90||Math.abs(n)>90||
      w>=e||s>=n||e-w>.08||n-s>.08||(e-w)*(n-s)>.003)return null;
  return p.map(v=>v.toFixed(6)).join(',');
}
async function proxy(req,res,url,key,ttl) {
  const now=Date.now(), cached=caches.get(key);
  if(cached && cached.until>now){send(res,200,cached.body,cached.type,{'Cache-Control':'public, max-age=60', 'X-Cache':'HIT'});return;}
  try{
    const agent='SurfaceStride/1.0 ('+(process.env.USER_AGENT_CONTACT || 'https://github.com/kai610390-source/RunELITE_LOGIX')+')';
    const upstream=await fetch(url,{headers:{'User-Agent':agent,'Accept':'application/json','Accept-Language':'en'},signal:AbortSignal.timeout(15000)});
    if(!upstream.ok){reply(res,upstream.status===429?429:502,{error:'Map provider unavailable',upstream_status:upstream.status});return;}
    const type=upstream.headers.get('content-type')||'application/json; charset=utf-8';
    const length=Number(upstream.headers.get('content-length')||0);
    if(length>20000000){reply(res,502,{error:'Map response too large'});return;}
    const body=await upstream.text();
    if(Buffer.byteLength(body)>20000000){reply(res,502,{error:'Map response too large'});return;}
    caches.set(key,{body,type,until:now+ttl});
    if(caches.size>120)caches.delete(caches.keys().next().value);
    send(res,200,body,type,{'Cache-Control':'public, max-age=60','X-Cache':'MISS'});
  }catch{reply(res,503,{error:'Map provider timed out or unreachable'});}
}
export function createServer(root = defaultRoot) {
 return http.createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){reply(res,405,{error:'Method not allowed'},{Allow:'GET, HEAD'});return;}
  let u;try{u=new URL(req.url,'http://localhost');}catch{reply(res,400,{error:'Invalid URL'});return;}
  if(u.pathname==='/api/health'){reply(res,200,{ok:true,service:'surfacestride',mode:'server',routing:'browser',training:'browser-local'});return;}
  if(u.pathname==='/api/geocode'){
    const q=(u.searchParams.get('q')||'').trim();
    if(q.length<2||q.length>120){reply(res,400,{error:'Search requires 2 to 120 characters'});return;}
    if(!limit(req,'geocode')){reply(res,429,{error:'Search rate limit reached'},{'Retry-After':'60'});return;}
    const key='geo:'+q.toLowerCase();
    if(!caches.get(key)||caches.get(key).until<Date.now()){
      if(Date.now()-lastGeocode<1100){reply(res,429,{error:'Search service busy; retry shortly'},{'Retry-After':'2'});return;}
      lastGeocode=Date.now();
    }
    await proxy(req,res,'https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'jsonv2',limit:'1'}),key,86400000);return;
  }
  if(u.pathname==='/api/osm'){
    const b=bbox(u.searchParams.get('bbox'));
    if(!b){reply(res,400,{error:'Invalid or oversized bounding box'});return;}
    if(!limit(req,'osm')){reply(res,429,{error:'Map rate limit reached'},{'Retry-After':'60'});return;}
    await proxy(req,res,'https://api.openstreetmap.org/api/0.6/map?bbox='+encodeURIComponent(b),'osm:'+b,1800000);return;
  }
  let pathname=u.pathname;
  if(pathname==='/'||pathname==='')pathname='/index.html';
  if(pathname==='/studio'||pathname==='/studio/')pathname='/studio/index.html';
  let decoded;try{decoded=decodeURIComponent(pathname);}catch{reply(res,400,{error:'Invalid path'});return;}
  if(!allowed.test(decoded)){reply(res,404,{error:'Not found'});return;}
  const full=path.resolve(root,'.'+decoded);
  if(!full.startsWith(path.resolve(root)+path.sep)){reply(res,404,{error:'Not found'});return;}
  try{
    const f=await stat(full);if(!f.isFile()){reply(res,404,{error:'Not found'});return;}
    const bytes=await readFile(full), type=mime[path.extname(full)];
    res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'X-Content-Type-Options':'nosniff',
      'Cache-Control':path.extname(full)==='.html'?'no-cache':'public, max-age=300'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch{reply(res,404,{error:'Not found'});}
 });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173);
 createServer().listen(port,'0.0.0.0',()=>console.log(`SurfaceStride server listening on http://localhost:${port}/studio/`));
}

/* Only enable server API routes when a real SurfaceStride backend responds.
   GitHub Pages stays fully functional without the backend. */
window.SurfaceStrideServerAvailable = false;
fetch('/api/health', {cache:'no-store', signal:AbortSignal.timeout(2000)})
  .then(r=>r.ok?r.json():null)
  .then(data=>{window.SurfaceStrideServerAvailable = data?.service==='surfacestride';})
  .catch(()=>{});

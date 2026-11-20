# SurfaceStride trail builder - hosted server

This addon serves the **existing** SurfaceStride Studio route builder. It does not rewrite route generation, trail detection, Pixel Trail Lab, exports, or GPX/COROS functionality.

## Deploy with GitHub and Render

1. The existing source lives in `kai610390-source/RunELITE_LOGIX` on the `gh-pages` branch. Keep `main` (the separate running dashboard) unchanged.
2. In Render choose **New > Web Service**, connect GitHub, choose `RunELITE_LOGIX`, and set **Branch** to the merged `gh-pages`.
3. Runtime: **Node**. Build command: `echo no-build`. Start command: `node server/server.mjs`. Root directory: repository root. Health check path: `/api/health`.
4. Set `USER_AGENT_CONTACT` to a public contact URL or support email so upstream geocoding providers can identify the application.
5. Deploy and open `https://YOUR-RENDER-URL/studio/`. Test `/api/health`, searching a place, and GPX export.

Optionally use the `render.yaml` Blueprint in Render. GitHub stores code but **does not run the Node server**; Render runs it.

## Local testing (Node 20+)

From the **repository root**:

```bash
node server/server.mjs
```

Open http://localhost:4173/studio/ .

## Back-end endpoints

- `GET /api/health` - readiness and mode.
- `GET /api/geocode?q=Austin` - cached, throttled Nominatim search.
- `GET /api/osm?bbox=west,south,east,north` - cached, bbox-limited OSM extraction. Large/bulk downloads are deliberately rejected.

These integrations activate automatically when the app detects its own server. GitHub Pages can still run the original client-side version.

## Limits and privacy

- The original trainer and routes still persist **locally in the browser**. Nothing is silently uploaded. This deployment does not create multi-user synchronized training or an AI model server.
- Geocoding and OSM data use third-party public services with usage limits; request throttling/caching are best-effort per instance. For a larger public launch, replace public providers with a paid or self-hosted data service.
- Free Render instances can spin down when idle. This server contains no durable user database.
- Neither a server nor satellite imagery alone can verify trails beneath tree canopies: predicted paths should not be treated as confirmed access rights.

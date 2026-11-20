# SurfaceStride Trails — Live Server Branch

This is the permanent, GitHub-hosted source branch for the **SurfaceStride Visible Trails V19** running route app. The source is editable remotely via GitHub. You do **not** need to download ZIPs or run the app locally after hosting has been connected.

## One-time publishing (Render)

1. Open the [deploy link](https://render.com/deploy?repo=https://github.com/kai610390-source/RunELITE_LOGIX/tree/trails-live) and sign in to Render with GitHub.
2. Grant Render access to `RunELITE_LOGIX`. **Connect the GitHub account**, not the "Public Git Repository" URL option; only the connected-repo deployment supports automatic updates.
3. Pick the free web service when offered and confirm the `surfacestride-trail-server` Blueprint. Set USER_AGENT_CONTACT to a valid public support email or project contact URL.
4. In Render Settings, verify **Branch = trails-live** and **Auto-Deploy = After CI Checks Pass** (the Blueprint sets `autoDeployTrigger: checksPass`).
5. Open the resulting Render URL **/studio/**. Visit **/api/health** for a status JSON. If it's not live, inspect the Render deploy logs.

## Subsequent updates — zero local setup

Request code changes in ChatGPT. Changes committed to GitHub's **trails-live** branch trigger CI. Render then automatically pulls and deploys the updated app. Refresh the hosted URL (hard reload if cached). This does not modify the separate dashboard on `main` or GitHub Pages on `gh-pages`.

## Design boundaries

- The existing trail detection, training, route routing, GPX, and COROS features remain browser-side. The Node backend serves the app and hosts cached, bounded geocoding / OSM requests; it does not run a remote deep-learning trail detector.
- LocalStorage-trained models and saved routes stay in each browser. Cloud accounts and synced training data are **not** implemented.
- Map data and satellite providers have independent rate limits. Training works with browser-compliant imagery only.
- GPS/route outputs must be independently checked for paths, public access, and current conditions.

## Commands (optional)

`node server/server.mjs` starts a local preview; `node --test server/server.test.mjs` runs smoke tests. These are optional after cloud setup.

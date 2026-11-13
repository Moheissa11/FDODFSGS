# EARTIFY Development Status

## Update — TerraTwin maps and NASA Data Explorer

### Implemented
- Repaired front-end initialization so NASA catalog/search controls initialize independently of the sign-in form. Previously, the catalog and search setup was accidentally nested inside the authentication submit handler, preventing the NASA Data Explorer from initializing on page load.
- Added a working NASA archive search UI for PDS, NASA Earthdata CMR, and NASA NTRS using the existing `/api/nasa/search` backend route. Search results show source metadata and links to the original NASA records.
- Replaced the inactive scientific map placeholder with an interactive Leaflet map workspace. Earth imagery and selectable thermal, NDVI, and thermal-anomaly overlays use NASA GIBS WMTS. Mars and Moon views use the bundled global surface textures with pan/zoom. Controls for unsupported planetary overlays are disabled rather than presenting fabricated measurements.
- Removed the custom CSV/JSON upload from Analog Finder and removed the dataset-file upload from NASA Data Explorer. NASA archive discovery runs automatically from the target world and site.
- Preserved the scientific guardrail: archive metadata and surface imagery are not presented as validated numeric measurements, and no planetary similarity scores are invented.
- Updated TerraTwin UI regression tests.

### Verification
- `node --check public/app.js` — passed.
- `node --check server.js` — passed.
- `npm test` — 21 tests passed.
- Local server health and NASA catalog routes responded successfully. External NASA API calls could not be completed from the isolated build environment (outbound fetch returned a network error); the app's live archive routes remain configured to call the official NASA services when run in a network-enabled environment.

### Notes / limitations
- NASA GIBS provides Earth observation map imagery. It is not a Mars/Moon elevation service. Mars and Moon basemaps are the project's bundled global surface imagery; calibrated MOLA, THEMIS, HiRISE, LOLA, and LROC products remain linked to their official archive records.
- NASA archive search returns metadata and original-record links, not a claim that all raw/calibrated files are automatically rendered as map layers.


## Update — NASA Data Explorer registry removed

- Removed the standalone Scientific Dataset Registry / NASA Data Explorer card, including MOLA, THEMIS, HiRISE, LOLA, LROC archive listings, its live archive search UI, archive directory links, and the research-report export button.
- Removed the registry-only front-end search/catalog initialization and the corresponding `/api/nasa/catalog`, `/api/nasa/search`, and unused `/api/nasa/pds-search` endpoints.
- Preserved TerraTwin Analog Finder's independent automatic NASA metadata discovery, Scientific Maps and NASA GIBS map support, and Mission Simulator.
- Updated TerraTwin UI regression tests to assert the registry is absent and the retained tools remain present.


## Update — Cero smart site navigation and in-page help

### Implemented
- Added deterministic Arabic/English natural-language navigation intents for the Solar System, individual planets/moon, Compare, TerraTwin/Scientific Maps, Mission Lab, Research, Explore, and Home.
- Cero responses now include a safe route to an existing page/section; the main site automatically navigates to the Solar System or scrolls to the relevant section after showing its guidance.
- Solar System links can deep-open a requested planet using a query parameter and focus it in the 3D scene.
- Added a compact Cero assistant panel directly on the Solar System page so users can continue asking for help without leaving the 3D experience.
- Updated the verified website guide and added regression tests for Arabic requests, English planet requests, and section routing.

### Verification
- `npm test` — 23 tests passed.
- `node --check public/app.js`, `node --check server.js`, `node --check website-knowledge.js`, and `node --check public/solar/solar.js` — passed.

### Notes
- Navigation intents are restricted to actual routes and section IDs in the current project. Unrecognized questions continue through the existing assistant flow; no unsupported destination is fabricated.

## Update — strict approved-source search policy

### Implemented
- Added `source-registry.js` as the canonical allowlist for the nine user-approved sources and their official service hosts.
- Added `GET /api/sources` to expose the allowlist and the integration status of each source.
- Restricted Research Desk, standard comparison, and Cero scientific archive discovery to NASA PDS and NASA Earthdata CMR, with result URL host validation.
- Restricted TerraTwin's Earth collection links to NASA Earthdata Search; Harmony and GIBS remain approved Earthdata services for subsetting and maps.
- Disabled NASA NTRS and NASA Image Library search routes because they were not included in the user's approved list. Removed Wikipedia, Crossref, and arXiv from scientific discovery.
- Updated the Research Desk links to the approved Earthdata, Worldview, PDS, and PDS Geosciences destinations.
- Added visible archive-record links and source provenance to search results. No outside fallback is used when approved sources return no results.

### Integration status
- Connected and queried: NASA PDS, NASA Earthdata CMR; NASA Harmony capability/subset requests; NASA GIBS map layers.
- Registered but not yet API-integrated: Diviner/PDS Geosciences, CSA RADARSAT, Copernicus Data Space, ESA Open Science Catalog, JAXA G-Portal.
- CSA SAR Python tutorial is recorded as a processing/code reference only, not a source of science measurements.

### Important boundary
The currently integrated archive search returns metadata records, not decoded calibrated measurements for every instrument. No scientific comparison score is created from metadata alone. The registered-but-unintegrated sources must not be described as searched until their official access workflows are implemented and tested.

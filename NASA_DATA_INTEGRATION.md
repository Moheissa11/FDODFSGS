# EARTIFY NASA data integration (first implementation milestone)

## What is implemented

- TerraTwin discovery accepts `Mars`, `Moon`, or `Both`.
- Planetary archive metadata is searched through NASA PDS for each selected world.
- Earth analog collections are discovered through NASA Earthdata CMR.
- Discovery responses are cached in process memory for 30 minutes to reduce repeat calls.
- `GET /api/terratwin/capabilities?collectionId=...` reads the actual collection-specific NASA Harmony capabilities before enabling subset controls.
- `GET /api/terratwin/subset-url?...` validates a bounding box and date range, checks Harmony capabilities, and builds a bounded Harmony request (maximum 10 granules per request).
- The browser UI can inspect collection capabilities and open the resulting NASA Harmony request. Earthdata Login may be required by NASA.
- Existing EARTIFY styling, maps, mission simulator, and other site features are retained.

## API examples

```text
GET /api/terratwin/collect?world=Both&target=Jezero%20Crater
GET /api/terratwin/capabilities?collectionId=C1234567890-PROVIDER
GET /api/terratwin/subset-url?collectionId=C1234567890-PROVIDER&variable=all&west=34&south=29&east=36&north=31&start=2024-01-01&end=2024-01-31
```

Use a real collection ID returned by CMR; the ID above is only an example.

## Scientific and operational limits

- Harmony is an Earth-observation data transformation service. It does not process arbitrary Mars or Moon PDS products.
- PDS discovery currently returns archive product metadata and original-record links. It does not yet decode every PDS instrument product format into calibrated measurements.
- No cross-world numeric similarity score is calculated. A defensible comparison needs matching physical variables, units, calibration, spatial footprint, temporal context, and uncertainty treatment.
- The subset URL builder only enables a request when Harmony advertises both spatial and temporal subsetting for that Earth collection. Some collection services may have additional constraints; NASA may return an asynchronous job or require Earthdata Login.
- EARTIFY does not store the requested subset. The browser opens NASA Harmony directly.
- NASA source access is free for many public datasets, but always verify each dataset's access conditions. Hosting and compute for EARTIFY itself may have separate costs/limits.

## Run locally

```bash
npm install
npm test
npm start
```

Then open `http://localhost:3000`. Node.js 20 or newer is recommended.

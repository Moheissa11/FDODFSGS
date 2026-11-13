# EARTIFY approved scientific source policy

EARTIFY scientific discovery uses a strict allowlist. Search endpoints must not query, enrich, or silently fall back to domains outside this registry.

| Source | Purpose | Current status |
|---|---|---|
| NASA Earthdata Search | Earth-observation collection discovery via NASA CMR; Harmony subsetting where advertised | API integrated |
| NASA Worldview | Earth imagery and map layers via NASA GIBS | Map integrated |
| NASA PDS | Mars and Moon planetary archive discovery | API integrated |
| LRO Diviner / PDS Geosciences Node | Lunar surface temperature products | Registered; API integration pending |
| CSA RADARSAT data portal | Earth SAR observations | Registered; API integration pending |
| CSA SAR Python tutorial | Processing reference only; not a data provider | Code reference only |
| Copernicus Data Space Ecosystem | Earth-observation products | Registered; API integration pending |
| ESA Open Science Catalog | Public research/catalog records | Registered; API integration pending |
| JAXA G-Portal | Earth-observation products | Registered; API integration pending |

## Enforcement

- `source-registry.js` is the canonical host allowlist.
- `GET /api/sources` returns the registry and connection status.
- `GET /api/research/search`, `/api/place-search`, `/api/compare-text`, and TerraTwin discovery use only currently integrated approved archive endpoints (NASA PDS and NASA Earthdata CMR).
- NASA Harmony and NASA GIBS are used as Earthdata services for subsetting and map imagery.
- NASA NTRS, NASA Image and Video Library, Wikipedia, Crossref, arXiv, and general search engines are not permitted scientific search sources and their legacy app routes are disabled or no longer called.
- A registered source marked `registered-not-yet-api-integrated` must not be represented as searched or connected. If the connected archives return no records, EARTIFY reports no result instead of using another provider.
- Archive metadata, imagery, and calibrated numeric measurements are different evidence types. Metadata or a map image must never be described as a measured value.

## Current integration boundary

The first strict-allowlist build connects NASA PDS product metadata, NASA Earthdata CMR collection metadata, NASA Harmony capability/subset requests, and NASA GIBS map tiles. Diviner, CSA, Copernicus, ESA Open Science, and JAXA are registered but still require their official API/download workflows to be implemented and tested before their records can appear in searches.

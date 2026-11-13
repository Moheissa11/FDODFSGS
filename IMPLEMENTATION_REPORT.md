# EARTIFY — implementation report (advanced build)

## What was added in this build

1. **PDF and DOCX document ingestion**
   - Added `document-extract.js`.
   - Supports TXT, MD, CSV, JSON, XML, HTML, PDF, and DOCX.
   - Text PDFs use Poppler `pdftotext`; scanned PDFs attempt OCR for up to the first 10 pages using `pdftoppm` + Tesseract (`eng+ara`).
   - DOCX text is extracted from `word/document.xml` with Python's standard library.
   - Upload cap: 8 MB. Extracted-text cap: 300,000 characters.

2. **Hybrid retrieval / semantic search**
   - Added `embedding-core.js` with OpenAI embedding calls, cosine similarity, and a weighted blend of semantic similarity and lexical relevance.
   - Embeddings are enabled only when `OPENAI_API_KEY` is configured. When not configured or when the embeddings endpoint fails, retrieval falls back to lexical ranking.
   - A process-local cache avoids repeatedly embedding the same chunks during a running server process. It is not a persistent vector database.

3. **Scientific literature discovery**
   - Added combined discovery across NASA NTRS, Crossref, and arXiv.
   - Added `/api/research/search?q=...` and connected the Research Library search UI.
   - Cero research turns can include retrieved records from the same providers and are instructed to distinguish discovery records from independently verified full papers.

4. **Safer server behavior**
   - Added basic in-memory per-route rate limits and same-origin checks for POST requests.
   - Hardened public URL imports with DNS/IP checks, redirect revalidation, response-size limits, and timeout handling.
   - Added response security headers and stricter SameSite session cookies.
   - Added outbound AI request timeouts.

5. **Documentation and setup**
   - Updated `.env.example` with the embedding model setting.
   - Updated README with setup requirements, supported formats, API routes, test commands, and remaining deployment limitations.

## Preserved existing functionality

The existing EARTIFY 3D explorer, visual assets, account interface, research library, conversation UI, mission concept generator, NASA image search, and planet lookup flow remain in the project. No frontend framework migration was performed.

## Verification performed in this environment

- `npm test`: **13 passed, 0 failed**.
- `npm run validate:datasets`: **26 unique JSONL records** (16 train, 5 validation, 5 test).
- `node --check`: passed for server, frontend script, assistant core, research core, embedding core, and document extractor.
- Local HTTP smoke test: homepage HTTP 200; health endpoint returned `ok:true`; too-short research query correctly returned HTTP 400.
- End-to-end signed-in PDF upload test: account creation succeeded, PDF text extraction succeeded, and the saved document appeared in the account library.
- Direct extraction checks: text PDF, scanned PDF OCR, and DOCX extraction succeeded using the installed system tools.

## Not verified / external dependencies

- Live NASA NTRS, Crossref, and arXiv requests could not be confirmed from this execution environment; outbound network access may be restricted. Their integrations are implemented but must be tested from the user's machine/network.
- OpenAI chat and embedding calls were not tested because no user API key was supplied. Configure `OPENAI_API_KEY` locally. Embeddings may incur API usage charges.
- OCR requires Poppler and Tesseract with English and Arabic language packs installed on the host. PDF and DOCX extraction was tested in this Linux environment; Windows setup requires installing the documented binaries and adding them to PATH.

## Remaining limitations

- No persistent vector database. The semantic chunk cache is in-memory and resets when the server restarts; embeddings are recomputed as needed.
- Crossref results may not include abstracts; search results from all providers need source-level verification.
- Full-text publisher access, paper-to-paper contradiction analysis, OCR beyond 10 pages, and citation-quality evaluation are not implemented.
- Starter datasets are synthetic examples, not a trained intent classifier. No fine-tuning was performed.
- The JSON-file database and simple local authentication are still unsuitable for public multi-instance production. Before public launch, use a managed database, email verification/password reset, session expiry/revocation, HTTPS, durable distributed rate limiting, backups, privacy controls, and an independent security review.
- EARTIFY's 3D planetary models are educational visualizations, not validated scientific digital twins.

## Required user configuration

- Set `OPENAI_API_KEY` in a local `.env` file for full AI chat and semantic embeddings.
- Install Poppler, Tesseract (`eng` and `ara` language data), and Python 3 for document extraction.
- Do not share or commit `.env`.


## Realistic Moon update

- Added `public/assets/moon-realistic-map.png`, a 2:1 equirectangular lunar surface texture derived from a generated high-detail lunar reference.
- Updated the solar-system scene to load this local Moon map for the Moon sphere, so the main Moon uses detailed craters and lunar maria without depending on a remote texture host.
- Existing Moon surface-exploration backdrop and other planet textures are unchanged.

## Realistic Solar System texture update

- Added local high-resolution equirectangular surface maps for Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, and the Sun under `public/assets/planet-textures/`.
- Updated the 3D scene to load these local maps first, avoiding reliance on a remote texture host for the main planetary surfaces.
- The Sun now uses its local photosphere map as both surface and emissive texture for a brighter, more solar appearance.
- Added a subtle Uranian ring system while preserving Saturn's existing ring model.
- Kept the existing realistic Earth and Moon maps unchanged.
- Mirrored the updated scene module in both `public/solar/src/` and `solar/src/` to keep the project's duplicate solar entry points consistent.

Note: These are detailed visual/educational maps created for this EARTIFY build, not official scientific cartography or photogrammetric datasets.

## 2026-11-13 — Unified planetary landing scene
- Added a consistent 3D EARTIFY explorer character and a planted EARTIFY mission flag to every planetary/moon surface landing.
- Kept each landing environment procedurally generated so terrain, rocks, atmospheric haze, and sky colors change with the selected world rather than reusing a flat screenshot.
- Added the supplied visual reference to `public/assets/eartify-landing-reference.png` for project reference.
- Verified JavaScript syntax and all 13 existing automated tests.

## 2026-11-13 — Shared Solar System Language & Cero Website Help
- The main Arabic/English selector now persists the selected language in `localStorage` under `eartify-language`.
- The Solar System page reads the same setting on load and updates its page copy, planet picker, 3D planet labels, and RTL/LTR layout to match.
- Cero now receives a verified built-in EARTIFY feature guide covering the dashboard shortcuts, Solar System controls, comparison workflow, Mission Lab, Research, and My Library.
- Common website-navigation questions are answered from a bilingual stored FAQ module (`website-knowledge.js`) immediately, including when no external AI API key is configured. Other questions can still use the configured AI provider with the same website guide as system context.
- Added automated coverage for the stored website help responses.
- Verification: `node --test` passes 17/17; server smoke test returned HTTP 200 for `/solar/` and successful Arabic Solar System and English Compare guidance from `/api/robot-chat`.

## TerraTwin Research Suite (2026-11-13)

Added a bilingual TerraTwin section to the main site with four research workspaces:

- **Earth Analog Finder:** local CSV/JSON import; requires an explicit target row plus Earth candidate rows; calculates an exploratory equal-weight normalized Euclidean-distance ranking over shared numeric columns. The interface and Cero clearly label this as unvalidated until feature selection, units, uncertainty, provenance and scientific weighting are reviewed.
- **Scientific Map Workspace:** prepared UI for elevation/DEM, slope, thermal, geology/composition and crater layers; no map values or planetary layers are fabricated while source rasters/GeoJSON are not yet supplied.
- **Mission Simulator:** input-based preliminary energy budget/margin and route-slope screening, explicitly not an engineering or crew-safety model.
- **NASA Data Explorer / registry:** documents intended data families (MOLA, THEMIS, HiRISE, LOLA, LROC and Earth observation), accepts a local dataset selection for integration planning, and exports the current TerraTwin state as JSON.

Added Arabic/English translations and updated Cero's built-in feature guide. No user-provided scientific datasets were added or invented. The map-data adapters and validated planetary analysis remain pending the exact datasets and metadata supplied by the project team.

Validation: `node --check public/app.js`, `node --check server.js`, `npm test` (20/20), `npm run validate:datasets`, and local `/api/health` smoke test passed.

## NASA archive integration update (2026-11-13)
- Added a curated NASA archive registry endpoint at `/api/nasa/catalog` covering PDS, MOLA, THEMIS, HiRISE, LOLA, LROC, NASA Earthdata/EOSDIS, GIBS, NTRS, and NASA Image & Video Library.
- Added a live NASA PDS product metadata search proxy at `/api/nasa/pds-search?q=...` and a search interface in TerraTwin's NASA Data Explorer.
- Added direct archive links and explicit provenance/processing caveats.
- This is archive discovery and metadata search, not a local mirror of every NASA dataset. NASA archives contain very large mission collections and multiple product formats; actual data products must be selected, downloaded, decoded, and validated for instrument, target, units, map projection, resolution, processing level, and quality flags before use in analog scoring.
- NASA's general Open APIs are not a complete planetary science archive; PDS is the authoritative planetary mission archive. NASA data.nasa.gov is primarily a catalog/metadata index whose records often point to external archives.


## 2026-11-13 — NASA Data Explorer search restoration follow-up
- Removed the unrelated public-link/file-upload/document-Q&A/scientific-literature panel from the landing page.
- Replaced the PDS-only front-end flow with a source selector for PDS, NASA Earthdata CMR collections, and NASA NTRS.
- Added `/api/nasa/search` with source-specific server-side endpoints, bounded page sizes, timeouts, empty/error states, normalized metadata fields, original-source links, and a five-minute process cache.
- Corrected PDS free-text searching to use the documented `keywords` parameter (the previous route incorrectly passed free text as `q`, which expects PDS query-language expressions).
- Added `/api/nasa/gibs` service metadata and links to NASA GIBS capabilities and Worldview. GIBS is exposed as Earth imagery exploration; no unsupported claim is made that its layers render on planetary 3D models.
- Validation: JavaScript syntax checks passed; automated tests passed 20/20; local health endpoint returned HTTP 200.
- External validation limitation: live PDS search attempt from this environment failed at outbound network fetch, so no claim is made that external NASA endpoints were successfully exercised here. Earthdata/NTRS/GIBS live availability also remains to be verified from the user's deployment.
- Remaining work for full science-grade ingestion: authenticated Earthdata granule downloads where required; source-specific product download/decoding adapters for PDS formats (IMG/JP2/ISIS/PDS4); validated coordinate/projection/unit handling; actual GIBS map-layer rendering inside the app; and a safe Three.js texture/terrain adapter only for products whose format and projection are verified.


## TerraTwin automatic analog discovery update (2026-11-13)

- Earth Analog Finder now allows automatic archive discovery without requiring a CSV/JSON upload.
- Added `GET /api/terratwin/collect?world=Mars|Moon&target=...`.
- The endpoint queries the official NASA PDS product search and NASA Earthdata CMR collections API in parallel.
- Results include archive provenance, metadata, and original source links; failures are reported per source.
- Discovery responses are cached in server memory for 30 minutes to reduce repeated requests.
- Custom CSV/JSON upload remains optional for users who already have verified measurements.
- Important scientific limitation: archive metadata is not a set of comparable measurements. The application deliberately does not calculate analog similarity scores from titles/abstracts. Actual numeric ranking still requires extracting compatible variables from real PDS and Earth observation products, harmonizing units/CRS/time ranges, and validating uncertainty and spatial coverage.
- Validation: `node --check server.js`, `node --check public/app.js`, and `npm test` (20/20 passed). Live NASA API requests could not be verified in this execution environment because outbound requests failed (`fetch failed`); the endpoint returns a structured 502 with per-source errors in that case.


## 2026-11-13 — Removal of standalone NASA Data Explorer
- Removed the Scientific Dataset Registry / NASA Data Explorer card, its curated MOLA/THEMIS/HiRISE/LOLA/LROC list, standalone PDS/Earthdata/NTRS search UI, archive links, and research-report export button.
- Removed the registry-only catalog and search endpoints.
- Kept NASA GIBS map imagery, automatic archive metadata discovery inside Earth Analog Finder, planetary reference maps, and Mission Simulator.
- Updated the in-app assistant guide and user documentation so it no longer directs users to the removed controls.

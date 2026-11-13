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
   - Replaced unrestricted literature discovery with a strict allowlist of the user-approved NASA, CSA, ESA, and JAXA portals.
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

- Approved-source discovery currently returns official portal entry points; it does not claim that raw datasets were retrieved. Dataset queries must be completed on the linked official portals.
- OpenAI chat and embedding calls were not tested because no user API key was supplied. Configure `OPENAI_API_KEY` locally. Embeddings may incur API usage charges.
- OCR requires Poppler and Tesseract with English and Arabic language packs installed on the host. PDF and DOCX extraction was tested in this Linux environment; Windows setup requires installing the documented binaries and adding them to PATH.

## Remaining limitations

- No persistent vector database. The semantic chunk cache is in-memory and resets when the server restarts; embeddings are recomputed as needed.
- Only approved portal links are surfaced; users must verify dataset metadata at the official provider.
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

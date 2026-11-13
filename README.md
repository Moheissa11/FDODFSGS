# EARTIFY — Space Explorer & Cero Research Assistant

EARTIFY keeps its existing browser-based 3D explorer and adds a server-side Cero assistant, private account libraries, document Q&A, hybrid retrieval, and scientific-literature discovery.

## Start locally

1. Install **Node.js 18+** (Node 20 or 22 recommended).
2. Install PDF/OCR system tools:
   - **Windows:** install Poppler for Windows (make `pdftotext.exe` and `pdftoppm.exe` available on `PATH`) and Tesseract OCR with English and Arabic language packs. Install Python 3 for DOCX parsing.
   - **macOS:** `brew install poppler tesseract tesseract-lang python`.
   - **Ubuntu/Debian:** `sudo apt install poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara python3`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` from Google AI Studio to enable Cero with Gemini. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Alternatively, set `OPENAI_API_KEY` to use OpenAI. Gemini is preferred if both keys are present. Keep all keys private in the server-side `.env` file.
4. On Windows, double-click `START-EARTIFY.bat`. On macOS/Linux, run `./START-EARTIFY.sh`. Or run `npm start`.
5. Open `http://localhost:3000`.

Without either AI key, the site and basic/offline guided responses remain available, but Cero is not a full general-purpose AI. OpenAI semantic embeddings are enabled only when `OPENAI_API_KEY` is configured.

## Current capabilities

### Cero
- Understands Arabic script, common Egyptian Arabizi, English, and mixed-language context using lightweight language/intent hints plus the configured language model.
- Uses conversation history for follow-ups and pronouns. Signed-in users have up to 80 recent messages stored per account.
- Has a step-by-step teaching policy for maths, physics, science, and general explanations; it adapts when a learner is confused and respects requests for hints or direct solutions.
- General conversation is not restricted to space topics.

### Research and scientific discovery
- Scientific search is restricted by a strict allowlist to user-approved archives. Current live discovery connects NASA PDS and NASA Earthdata CMR; additional approved providers are registered with their integration status.
- Cero scientific research turns can retrieve records only from the currently integrated approved archives. If those archives return no records, no unapproved fallback is used.
- NASA Worldview imagery remains available through approved NASA GIBS map layers. The unapproved NASA Image Library and general encyclopedia lookup routes are disabled.
- `research-core.js` splits documents into overlapping passages and provides lexical ranking.
- `embedding-core.js` adds optional OpenAI embedding similarity blended with lexical relevance. If embeddings fail or are not configured, retrieval safely falls back to lexical search.

### Document library
- Upload and search TXT, MD, CSV, JSON, XML, HTML, PDF, and DOCX files (8 MB upload cap; extracted text capped at 300,000 characters).
- Text-based PDFs are extracted with Poppler. Scanned PDFs attempt OCR on the first 10 pages using Tesseract English + Arabic language packs.
- DOCX text is extracted from the document XML using Python's standard library; no pip packages are required.
- Saved documents are scoped to the signed-in account. Ask questions across the library or request a summary; the AI is instructed to answer from retrieved passages and identify the filename/passage.

### Security and reliability improvements
- Passwords are stored as salted scrypt hashes; session cookies are HttpOnly and SameSite=Strict.
- Basic per-route in-memory rate limiting and same-origin checks for POST requests.
- Public URL imports validate DNS results, block private/local IP ranges, validate redirects, and limit response size.
- API secrets remain server-side. Responses include basic security headers.

## Configuration

`.env` options:

- `GEMINI_API_KEY` — enables Gemini-powered Cero chat (preferred when configured). Create a key in Google AI Studio.
- `GEMINI_MODEL` — Gemini model name; defaults to `gemini-3.8-flash`.
- `OPENAI_API_KEY` — optional OpenAI chat fallback and semantic embeddings.
- `OPENAI_MODEL` — OpenAI fallback chat model; defaults to `gpt-4o-mini`.
- `OPENAI_EMBEDDING_MODEL` — defaults to `text-embedding-3-small`.
- `PORT` — defaults to `3000`.

Never put secrets in `public/`, commit `.env`, or share your API key in screenshots or chat. The server calls Gemini; the browser never receives the key.

## API routes

- `GET /api/health` — reports feature configuration and supported document formats.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/history`.
- `GET /api/documents`, `POST /api/documents`, `DELETE /api/documents/:id`, `POST /api/documents/ask`.
- `POST /api/robot-chat`, `POST /api/solve`, `POST /api/place-search`, `POST /api/compare-text`.
- `GET /api/sources` — approved source registry and connection status.
- `GET /api/research/search?q=...` — approved NASA PDS + NASA Earthdata CMR discovery only.
- Legacy NASA NTRS and NASA Image Library search routes return HTTP 410 and are disabled by source policy.

## Test and validate

```bash
npm test
npm run validate:datasets
node --check server.js
node --check public/app.js
```

The tests cover intent/language hints, chunking/retrieval, document extraction helpers, cosine similarity, and the no-key retrieval fallback. A local smoke test should also be performed after setup by opening the site and checking `/api/health`.

## Important limitations before public deployment

This is a strengthened local/student prototype, **not a production-hardened public service**. Before exposing it to the internet, replace the JSON-file database and demo account cap with a managed database, implement password reset/email verification and session expiry/revocation, use HTTPS and secure cookie configuration behind a correctly configured proxy, add durable distributed rate limiting, add backups and retention/deletion controls, review privacy/legal requirements, and perform a security audit. The current local JSON database is not designed for concurrent multi-instance hosting.

The search APIs are external dependencies and can be rate-limited or change their response formats. Search results must be opened and checked before being cited as evidence. Crossref does not necessarily provide abstracts; arXiv and NASA records may contain metadata/abstracts rather than full text. Full paper retrieval, source-to-source contradiction analysis, OCR beyond the first 10 PDF pages, and a trained intent model are not included. No model fine-tuning has been performed. EARTIFY's 3D planets are educational visualizations, not validated scientific digital twins.


## TerraTwin scientific tools

The standalone NASA Data Explorer / Scientific Dataset Registry panel has been removed from the current build at the project owner's request. TerraTwin retains the Earth Analog Finder's automatic PDS and Earthdata metadata discovery, the Scientific Maps workspace (NASA GIBS Earth imagery plus bundled Mars/Moon reference basemaps), and the Mission Simulator. The removed registry UI and its `/api/nasa/catalog`, `/api/nasa/search`, and `/api/nasa/pds-search` endpoints are not part of this build. The separate `/api/nasa/gibs` map-service metadata endpoint remains.

The unrelated standalone “Bring your sources / Add to your database / Ask your saved files / Search scientific literature” document-import panel was removed from the page. The separate TerraTwin research workspaces and the main scientific Research Lab remain.

**Verification note (2026-11-13):** `node --check server.js`, `node --check public/app.js`, and `npm test` passed (20/20). Local `/api/health` returned HTTP 200. A live PDS request could not be verified from this environment because outbound fetch failed; test live PDS, Earthdata, NTRS and GIBS access from the deployment/network before claiming those external providers are operational. No NASA results are fabricated or substituted with samples.


## TerraTwin live maps and NASA archive search

The Scientific Maps workspace uses NASA GIBS WMTS for Earth satellite imagery, with selectable MODIS land-surface temperature, NDVI and VIIRS thermal-anomaly overlays. Mars and Moon views use bundled global surface textures with interactive pan/zoom. Calibrated planetary products are not presented as rendered measurements unless a verified ingestion path is implemented.


### Cero smart navigation
Cero understands common Arabic and English requests to open the 3D Solar System, focus a named planet or the Moon, or jump to Compare, TerraTwin, Mission Lab, Research, Explore, and Home. The Solar System page includes its own compact Cero help panel.

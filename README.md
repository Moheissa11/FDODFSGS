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
- Scientific discovery lists only the approved NASA, CSA, ESA, and JAXA portals configured in the server allowlist. EARTIFY does not query Wikipedia, Crossref, arXiv, or other third-party scientific indexes.
- Cero research turns can retrieve records from the same three providers. Results are treated as discovery leads, not proof that a full paper was independently verified.
- Existing NASA imagery and planetary lookup features are preserved.
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
- `NASA_API_KEY` — retained as a configuration placeholder for NASA APIs that require a key; current NTRS search is public and does not use it.
- `PORT` — defaults to `3000`.

Never put secrets in `public/`, commit `.env`, or share your API key in screenshots or chat. The server calls Gemini; the browser never receives the key.

## API routes

- `GET /api/health` — reports feature configuration and supported document formats.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/history`.
- `GET /api/documents`, `POST /api/documents`, `DELETE /api/documents/:id`, `POST /api/documents/ask`.
- `POST /api/robot-chat`, `POST /api/solve`, `POST /api/place-search`, `POST /api/compare-text`.
- `GET /api/research/search?q=...` — approved NASA, CSA, ESA, and JAXA portal discovery only.
- `GET /api/research/ntrs?q=...` — NASA NTRS only.
- `GET /api/nasa-images?q=...`.

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

EARTIFY portal discovery returns official allowlisted portal links, not guaranteed live dataset records. Users must run the native search on the official portal and verify dataset metadata before using measurements. EARTIFY must never fill missing scientific evidence from unapproved domains or model memory. Full paper retrieval, source-to-source contradiction analysis, OCR beyond the first 10 PDF pages, and a trained intent model are not included. No model fine-tuning has been performed. EARTIFY's 3D planets are educational visualizations, not validated scientific digital twins.

## Live approved-source research (EARTIFY)

The research endpoints now request records from official agency APIs instead of returning a list of portal links:

- NASA Earthdata Search: NASA Common Metadata Repository (CMR) collection search (`cmr.earthdata.nasa.gov`).
- Copernicus Data Space: official STAC collections and item APIs (`stac.dataspace.copernicus.eu`).
- NASA Planetary Data System: official PDS Search API (`pds.nasa.gov`).

The UI renders returned record titles, abstracts/descriptions, source names, original record URLs, and the complete metadata object in an expandable panel. API errors and empty results are surfaced; EARTIFY does not replace missing records with invented data. All outbound scientific record URLs are checked against the configured approved-host allowlist.

Important coverage note: NASA Worldview, LRO Diviner archive, CSA RADARSAT/RCM, CSA SAR tutorial, ESA Open Science Catalog, and JAXA G-Portal remain approved source portals in the source registry, but this build does not claim live record retrieval from them unless their public machine-readable endpoint is integrated and verified. The CSA SAR tutorial is a processing guide, not a scientific dataset. Some archives may require accounts, specific query parameters, or authenticated access. These are not silently represented as successful API searches.

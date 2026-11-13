const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');

test('TerraTwin keeps analog discovery, map layers and mission planning', () => {
  for (const id of ['terratwin', 'runAnalog', 'missionSimForm', 'scienceMap', 'scienceMapWorld', 'scienceMapLayer']) {
    assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
  }
});

test('TerraTwin does not require users to upload datasets', () => {
  assert.doesNotMatch(html, /id="analogDataset"|id="registryDataset"|dataset-upload/);
  assert.match(app, /api\/terratwin\/collect/);
  assert.doesNotMatch(html, /NASA DATA EXPLORER|Scientific dataset registry|pdsSearchButton|downloadTerraReport/);
  assert.doesNotMatch(app, /runNasaSearch|loadNasaCatalog|downloadTerraReport/);
});

test('scientific similarity scores are not fabricated', () => {
  assert.match(app, /not scientifically validated/i);
  assert.match(app, /No shared numeric measurement columns found/);
});

test('NASA dataset registry endpoints are removed while map GIBS remains', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.doesNotMatch(server, /\/api\/nasa\/(catalog|search|pds-search)/);
  assert.match(server, /\/api\/nasa\/gibs/);
});

test('TerraTwin supports combined Mars and Moon discovery plus Harmony capability-gated subsets', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(html, /option value="Both" selected/);
  assert.match(html, /id="harmonySubsetForm"/);
  assert.match(app, /api\/terratwin\/capabilities/);
  assert.match(app, /api\/terratwin\/subset-url/);
  assert.match(server, /url\.pathname === "\/api\/terratwin\/capabilities"/);
  assert.match(server, /url\.pathname === "\/api\/terratwin\/subset-url"/);
  assert.match(server, /requiresEarthdataLogin:true/);
  assert.match(server, /worlds=world==="Both"\?\["Mars","Moon"\]/);
});

test('scientific search is restricted to the user-approved source registry', () => {
  const server = fs.readFileSync('server.js', 'utf8');
  const registry = fs.readFileSync('source-registry.js', 'utf8');
  assert.match(server, /searchApprovedArchives/);
  assert.match(server, /sourcePolicy:["']strict-allowlist["']/);
  assert.match(server, /url\.pathname === "\/api\/sources"/);
  assert.match(server, /isApprovedSourceUrl\(item\.url\)/);
  assert.match(registry, /NASA Earthdata Search/);
  assert.match(registry, /NASA Worldview/);
  assert.match(registry, /NASA Planetary Data System/);
  assert.match(registry, /Copernicus Data Space Ecosystem/);
  assert.match(registry, /JAXA G-Portal/);
  assert.doesNotMatch(server, /api\.crossref\.org|export\.arxiv\.org|en\.wikipedia\.org|images-api\.nasa\.gov/);
  assert.match(server, /NASA NTRS is not in the approved source list/);
});

test('unintegrated approved sources are not falsely reported as searched', () => {
  const registry = fs.readFileSync('source-registry.js', 'utf8');
  assert.match(registry, /registered-not-yet-api-integrated/);
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /Only currently integrated approved sources are queried/);
});

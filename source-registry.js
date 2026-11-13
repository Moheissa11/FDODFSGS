'use strict';

// Strict allowlist for scientific discovery and evidence links in EARTIFY.
// The SAR tutorial is a code/processing reference, not a scientific data provider.
const APPROVED_SOURCES = Object.freeze([
  { id: 'nasa-earthdata-search', name: 'NASA Earthdata Search', category: 'earth-data', url: 'https://search.earthdata.nasa.gov/', hosts: ['search.earthdata.nasa.gov', 'cmr.earthdata.nasa.gov', 'harmony.earthdata.nasa.gov'], status: 'api-integrated' },
  { id: 'nasa-worldview', name: 'NASA Worldview', category: 'earth-imagery', url: 'https://worldview.earthdata.nasa.gov/', hosts: ['worldview.earthdata.nasa.gov', 'gibs.earthdata.nasa.gov'], status: 'map-integrated' },
  { id: 'nasa-pds', name: 'NASA Planetary Data System', category: 'planetary-data', url: 'https://pds.nasa.gov/', hosts: ['pds.nasa.gov'], status: 'api-integrated' },
  { id: 'lro-diviner', name: 'LRO Diviner / PDS Geosciences Node', category: 'lunar-thermal-data', url: 'https://pds-geosciences.wustl.edu/', hosts: ['pds-geosciences.wustl.edu'], status: 'registered-not-yet-api-integrated' },
  { id: 'csa-radarsat', name: 'CSA RADARSAT Data', category: 'earth-radar-data', url: 'https://donnees-data.asc-csa.gc.ca/', hosts: ['donnees-data.asc-csa.gc.ca'], status: 'registered-not-yet-api-integrated' },
  { id: 'csa-sar-tutorial', name: 'CSA SAR Python Tutorial', category: 'processing-reference', url: 'https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial', hosts: [], status: 'code-reference-only' },
  { id: 'copernicus-data-space', name: 'Copernicus Data Space Ecosystem', category: 'earth-observation-data', url: 'https://dataspace.copernicus.eu/', hosts: ['dataspace.copernicus.eu'], status: 'registered-not-yet-api-integrated' },
  { id: 'esa-open-science', name: 'ESA Open Science Catalog', category: 'research-catalog', url: 'https://opensciencedata.esa.int/', hosts: ['opensciencedata.esa.int'], status: 'registered-not-yet-api-integrated' },
  { id: 'jaxa-gportal', name: 'JAXA G-Portal', category: 'earth-observation-data', url: 'https://www.gportal.jaxa.jp/?lang=en', hosts: ['www.gportal.jaxa.jp', 'gportal.jaxa.jp'], status: 'registered-not-yet-api-integrated' }
]);

const APPROVED_HOSTS = new Set(APPROVED_SOURCES.flatMap(source => source.hosts));
function isApprovedSourceUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && APPROVED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
function approvedSourceForUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return APPROVED_SOURCES.find(source => source.hosts.includes(host)) || null;
  } catch {
    return null;
  }
}

module.exports = { APPROVED_SOURCES, APPROVED_HOSTS, isApprovedSourceUrl, approvedSourceForUrl };

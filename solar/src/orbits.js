// J2000-era approximate osculating elements for a pedagogical heliocentric model.
// Angles are degrees; mean anomaly is advanced from the epoch using each body's
// sidereal orbital period. This is not a precision ephemeris.
export const ORBITAL_ELEMENTS = Object.freeze({
  mercury: { a: .387098, e: .20563, i: 7.005, period: 87.969, omega: 29.124, node: 48.331, M: 174.796 },
  venus: { a: .723332, e: .00677, i: 3.3947, period: 224.701, omega: 54.884, node: 76.680, M: 50.115 },
  earth: { a: 1, e: .01671, i: .00005, period: 365.256, omega: 114.207, node: -11.26064, M: 357.517 },
  mars: { a: 1.523679, e: .0934, i: 1.850, period: 686.980, omega: 286.502, node: 49.558, M: 19.373 },
  jupiter: { a: 5.20260, e: .04849, i: 1.303, period: 4332.59, omega: 273.867, node: 100.464, M: 20.020 },
  saturn: { a: 9.55491, e: .05551, i: 2.489, period: 10759.2, omega: 339.392, node: 113.665, M: 317.020 },
  uranus: { a: 19.2184, e: .0463, i: .773, period: 30688.5, omega: 96.998, node: 74.006, M: 142.238 },
  neptune: { a: 30.1104, e: .00946, i: 1.770, period: 60182, omega: 273.187, node: 131.784, M: 256.228 }
});

export function solveKepler(meanAnomaly, eccentricity, iterations = 12) {
  if (!Number.isFinite(meanAnomaly) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('Kepler solver requires a finite mean anomaly and 0 <= eccentricity < 1.');
  }
  const M = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = eccentricity < .8 ? M : Math.PI;
  for (let n = 0; n < iterations; n++) E -= (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
  return E;
}

export function orbitalPosition(elements, meanAnomaly, unitsPerAU = 1) {
  const E = solveKepler(meanAnomaly, elements.e);
  const x = elements.a * (Math.cos(E) - elements.e);
  const y = elements.a * Math.sqrt(1 - elements.e * elements.e) * Math.sin(E);
  const rad = Math.PI / 180;
  const O = elements.node * rad, i = elements.i * rad, w = elements.omega * rad;
  const X = (Math.cos(O) * Math.cos(w) - Math.sin(O) * Math.sin(w) * Math.cos(i)) * x + (-Math.cos(O) * Math.sin(w) - Math.sin(O) * Math.cos(w) * Math.cos(i)) * y;
  const Y = (Math.sin(O) * Math.cos(w) + Math.cos(O) * Math.sin(w) * Math.cos(i)) * x + (-Math.sin(O) * Math.sin(w) + Math.cos(O) * Math.cos(w) * Math.cos(i)) * y;
  const Z = Math.sin(w) * Math.sin(i) * x + Math.cos(w) * Math.sin(i) * y;
  return [X * unitsPerAU, Z * unitsPerAU, Y * unitsPerAU];
}

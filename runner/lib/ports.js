// runner/lib/ports.js
export function usedPorts(dockerPsText) {
  const set = new Set();
  const re = /:(\d+)->/g;
  let m;
  while ((m = re.exec(dockerPsText)) !== null) set.add(Number(m[1]));
  return set;
}
export function pickPort(used, { min = 8100, max = 8999 } = {}) {
  for (let p = min; p <= max; p++) if (!used.has(p)) return p;
  throw new Error('no free port in range');
}

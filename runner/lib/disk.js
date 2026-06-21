// runner/lib/disk.js
export function availableBytes(dfText) {
  const lines = dfText.trim().split('\n');
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  return Number(cols[3]);
}
export function hasHeadroom(bytes, floor) {
  return bytes >= floor;
}

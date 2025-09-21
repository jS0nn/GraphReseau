const FNV_OFFSET = 2166136261 >>> 0;
const FNV_PRIME = 16777619;

function hash32(str){
  if(!str) return 0;
  let h = FNV_OFFSET;
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function toHsl(hue, saturation, lightness){
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(Math.max(saturation, 0), 1);
  const l = Math.min(Math.max(lightness, 0), 1);
  return `hsl(${h}deg, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`;
}

export function colorForBranchId(branchId, theme = 'dark'){
  const id = typeof branchId === 'string' ? branchId.trim() : (branchId ? String(branchId).trim() : '');
  if(!id) return null;
  const hash = hash32(id);
  const maxUint32 = 0xffffffff;
  const goldenRatio = 0.61803398875;
  const seed = hash / maxUint32;
  const hue = Math.floor(((seed + goldenRatio) % 1) * 360);
  const sat = theme === 'light' ? 0.70 : 0.85;
  const baseLight = theme === 'light' ? 0.55 : 0.50;
  const lightJitter = (((hash >>> 10) & 0xff) / 255 - 0.5) * 0.12;
  const lightness = Math.min(Math.max(baseLight + lightJitter, 0.28), 0.74);
  return toHsl(hue, sat, lightness);
}

export function colorPairForBranchId(branchId, theme = 'dark'){
  const base = colorForBranchId(branchId, theme);
  if(!base) return { stroke: null, fill: null };
  const hash = hash32(branchId || '');
  const hueNoise = (((hash >>> 16) & 0xff) / 255 - 0.5) * 90;
  const accentHue = (parseInt(base.slice(4, base.indexOf('deg')), 10) + hueNoise + 360) % 360;
  const accentSat = theme === 'light' ? 0.58 : 0.70;
  const accentLight = theme === 'light' ? 0.70 : 0.42;
  const accent = toHsl(accentHue, accentSat, accentLight);
  return { stroke: base, fill: accent };
}

export default colorForBranchId;

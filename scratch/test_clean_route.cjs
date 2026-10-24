const fs = require('fs');

const buf = fs.readFileSync('campus_ground_floor_edited (1).glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const binBuf = buf.slice(binStart);

function getCorridorPolygons() {
  const polys = [];
  for (let meshIdx = 0; meshIdx < 12; meshIdx++) {
    const mesh = gltf.meshes[meshIdx];
    const prim = mesh.primitives[0];
    const posAcc = gltf.accessors[prim.attributes.POSITION];
    const posBv = gltf.bufferViews[posAcc.bufferView];
    const posOffset = (posBv.byteOffset || 0) + (posAcc.byteOffset || 0);
    const pos = new Float32Array(binBuf.buffer, binBuf.byteOffset + posOffset, posAcc.count * 3);
    const map = new Map();
    for (let i = 0; i < posAcc.count; i++) {
      const k = pos[i*3].toFixed(2) + ',' + pos[i*3+2].toFixed(2);
      if (!map.has(k)) map.set(k, { x: pos[i*3], z: pos[i*3+2] });
    }
    const pts = Array.from(map.values());
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
    polys.push({ name: gltf.nodes[meshIdx].name, pts });
  }
  return polys;
}

const polys = getCorridorPolygons();

const courtyards = [];
gltf.nodes.forEach(n => {
  if (n.name && n.name.startsWith('Courtyard_')) {
    const acc = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
    courtyards.push({ name: n.name, minX: acc.min[0], maxX: acc.max[0], minZ: acc.min[2], maxZ: acc.max[2] });
  }
});

function pointInPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function getWallDistance(wx, wz) {
  let inAny = false;
  let maxD = 0;
  for (const p of polys) {
    if (pointInPoly(wx, wz, p.pts)) {
      inAny = true;
      let minD = Infinity;
      for (let i = 0; i < p.pts.length; i++) {
        const p1 = p.pts[i], p2 = p.pts[(i + 1) % p.pts.length];
        const d = distToSegment(wx, wz, p1.x, p1.z, p2.x, p2.z);
        if (d < minD) minD = d;
      }
      if (minD > maxD) maxD = minD;
    }
  }
  if (!inAny) return 0;
  // Check courtyards
  for (const cy of courtyards) {
    if (wx >= cy.minX - 0.2 && wx <= cy.maxX + 0.2 && wz >= cy.minZ - 0.2 && wz <= cy.maxZ + 0.2) {
      return 0;
    }
  }
  return maxD;
}

const CELL = 0.5;
let minX = -45, maxX = 45, minZ = -45, maxZ = 40;
const cols = Math.round((maxX - minX) / CELL);
const rows = Math.round((maxZ - minZ) / CELL);

const wallDistGrid = new Float32Array(cols * rows);
const walkableGrid = new Uint8Array(cols * rows);

for (let r = 0; r < rows; r++) {
  const wz = minZ + r * CELL;
  for (let c = 0; c < cols; c++) {
    const wx = minX + c * CELL;
    const wd = getWallDistance(wx, wz);
    wallDistGrid[r * cols + c] = wd;
    if (wd >= 0.4) {
      walkableGrid[r * cols + c] = 1;
    }
  }
}

function findNearest(wx, wz) {
  let c = Math.round((wx - minX) / CELL);
  let r = Math.round((wz - minZ) / CELL);
  c = Math.max(0, Math.min(cols - 1, c));
  r = Math.max(0, Math.min(rows - 1, r));
  if (walkableGrid[r * cols + c] === 1) return { c, r };
  for (let rad = 1; rad < 35; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          if (walkableGrid[nr * cols + nc] === 1) return { c: nc, r: nr };
        }
      }
    }
  }
  return { c, r };
}

function aStar(startWx, startWz, endWx, endWz) {
  const start = findNearest(startWx, startWz);
  const end = findNearest(endWx, endWz);
  const startIdx = start.r * cols + start.c;
  const endIdx = end.r * cols + end.c;
  if (startIdx === endIdx) return [{ x: endWx, z: endWz }];

  const openSet = new Set([startIdx]);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const gScore = new Float32Array(cols * rows).fill(Infinity);
  const fScore = new Float32Array(cols * rows).fill(Infinity);
  gScore[startIdx] = 0;
  fScore[startIdx] = Math.hypot(start.c - end.c, start.r - end.r);

  const dCols = [ 0,  1,  0, -1,  1,  1, -1, -1];
  const dRows = [-1,  0,  1,  0, -1,  1,  1, -1];
  const costs = [ 1,  1,  1,  1, 1.414, 1.414, 1.414, 1.414];

  let iterations = 0;
  while (openSet.size > 0 && iterations < 35000) {
    iterations++;
    let currentIdx = -1, lowestF = Infinity;
    for (const idx of openSet) {
      if (fScore[idx] < lowestF) { lowestF = fScore[idx]; currentIdx = idx; }
    }
    if (currentIdx === endIdx) {
      const pathIndices = [];
      let curr = currentIdx;
      while (curr !== -1) { pathIndices.push(curr); curr = cameFrom[curr]; }
      pathIndices.reverse();
      const raw = pathIndices.map(idx => ({
        x: minX + (idx % cols) * CELL,
        z: minZ + Math.floor(idx / cols) * CELL
      }));
      raw.unshift({ x: startWx, z: startWz });
      raw.push({ x: endWx, z: endWz });
      return smoothPath(raw);
    }
    openSet.delete(currentIdx);
    const currC = currentIdx % cols, currR = Math.floor(currentIdx / cols);

    for (let i = 0; i < 8; i++) {
      const nc = currC + dCols[i], nr = currR + dRows[i];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (walkableGrid[nIdx] !== 1 && nIdx !== endIdx) continue;

      if (i >= 4) {
        if (walkableGrid[currR * cols + nc] !== 1 || walkableGrid[nr * cols + currC] !== 1) continue;
      }

      // Centerline bias: penalize being close to walls
      const wd = wallDistGrid[nIdx];
      const wallPenalty = wd < 0.9 ? (0.9 - wd) * 3.0 : 0;
      const tentativeG = gScore[currentIdx] + costs[i] + wallPenalty;

      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + Math.hypot(nc - end.c, nr - end.r);
        openSet.add(nIdx);
      }
    }
  }
  return null;
}

function lineOfSight(p1, p2) {
  const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const steps = Math.ceil(dist / 0.2);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const wx = p1.x + (p2.x - p1.x) * t;
    const wz = p1.z + (p2.z - p1.z) * t;
    if (getWallDistance(wx, wz) < 0.35) return false;
  }
  return true;
}

function smoothPath(points) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let curr = 0;
  while (curr < points.length - 1) {
    let furthest = curr + 1;
    for (let next = points.length - 1; next > curr + 1; next--) {
      if (lineOfSight(points[curr], points[next])) { furthest = next; break; }
    }
    result.push(points[furthest]);
    curr = furthest;
  }
  return result;
}

console.log('Testing route from (-8, 24) to (38, 30)...');
const path1 = aStar(-8, 24, 38, 30);
console.log('Path 1 waypoints:', path1 ? path1.length : 'none');
if (path1) path1.forEach((p, i) => console.log(`  pt ${i}: (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`));

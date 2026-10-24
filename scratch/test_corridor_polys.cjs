const fs = require('fs');

const buf = fs.readFileSync('campus_ground_floor_edited (1).glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const binBuf = buf.slice(binStart);

// 1. Extract corridor polygons
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

// 2. Extract courtyards and rooms bounding boxes
const courtyards = [];
const rooms = [];
gltf.nodes.forEach(n => {
  if (!n.name) return;
  if (n.name.startsWith('Courtyard_')) {
    const acc = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
    courtyards.push({ name: n.name, minX: acc.min[0], maxX: acc.max[0], minZ: acc.min[2], maxZ: acc.max[2] });
  } else if (n.name.startsWith('Room_')) {
    const acc = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
    rooms.push({ name: n.name, minX: acc.min[0], maxX: acc.max[0], minZ: acc.min[2], maxZ: acc.max[2] });
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

function distToPolyBoundary(px, pz, poly) {
  let minD = Infinity;
  for (let i = 0; i < poly.pts.length; i++) {
    const p1 = poly.pts[i];
    const p2 = poly.pts[(i + 1) % poly.pts.length];
    const d = distToSegment(px, pz, p1.x, p1.z, p2.x, p2.z);
    if (d < minD) minD = d;
  }
  return minD;
}

// Test grid resolution 0.5m
const CELL = 0.5;
let minX = -45, maxX = 45, minZ = -45, maxZ = 40;
const cols = Math.round((maxX - minX) / CELL);
const rows = Math.round((maxZ - minZ) / CELL);

let rawWalkable = 0;
let shrunkWalkable = 0;

for (let r = 0; r < rows; r++) {
  const wz = minZ + r * CELL;
  for (let c = 0; c < cols; c++) {
    const wx = minX + c * CELL;

    // Check if in any corridor polygon
    let inCorr = false;
    let maxDistToWall = 0;
    for (const p of polys) {
      if (pointInPoly(wx, wz, p.pts)) {
        inCorr = true;
        const d = distToPolyBoundary(wx, wz, p);
        if (d > maxDistToWall) maxDistToWall = d;
      }
    }

    if (inCorr) {
      // Check courtyard
      let inCy = false;
      for (const cy of courtyards) {
        if (wx >= cy.minX && wx <= cy.maxX && wz >= cy.minZ && wz <= cy.maxZ) {
          inCy = true; break;
        }
      }
      if (!inCy) {
        rawWalkable++;
        if (maxDistToWall >= 0.4) {
          shrunkWalkable++;
        }
      }
    }
  }
}

console.log(`Grid size: ${cols}x${rows}`);
console.log(`Raw walkable cells: ${rawWalkable}`);
console.log(`Walkable cells with 0.4m wall margin: ${shrunkWalkable}`);

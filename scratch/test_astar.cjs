const fs = require('fs');

const buf = fs.readFileSync('campus_ground_floor_edited (1).glb');
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

// Extract corridor bounding boxes
const corridorNodes = gltf.nodes.filter(n => n.name && n.name.startsWith('Corridor_'));
const corridors = corridorNodes.map(n => {
  const mesh = gltf.meshes[n.mesh];
  const prim = mesh.primitives[0];
  const posAcc = gltf.accessors[prim.attributes.POSITION];
  const tx = n.translation ? n.translation[0] : 0;
  const ty = n.translation ? n.translation[1] : 0;
  const tz = n.translation ? n.translation[2] : 0;
  return {
    name: n.name,
    minX: posAcc.min[0] + tx,
    maxX: posAcc.max[0] + tx,
    minZ: posAcc.min[2] + tz,
    maxZ: posAcc.max[2] + tz
  };
});

// Grid parameters
const CELL_SIZE = 0.5;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
corridors.forEach(c => {
  if (c.minX < minX) minX = c.minX;
  if (c.maxX > maxX) maxX = c.maxX;
  if (c.minZ < minZ) minZ = c.minZ;
  if (c.maxZ > maxZ) maxZ = c.maxZ;
});

// Pad slightly
minX = Math.floor(minX - 1);
maxX = Math.ceil(maxX + 1);
minZ = Math.floor(minZ - 1);
maxZ = Math.ceil(maxZ + 1);

const cols = Math.round((maxX - minX) / CELL_SIZE);
const rows = Math.round((maxZ - minZ) / CELL_SIZE);
console.log(`Grid: cols=${cols}, rows=${rows}, total=${cols*rows}`);

function isInsideCorridor(wx, wz) {
  for (const c of corridors) {
    if (wx >= c.minX && wx <= c.maxX && wz >= c.minZ && wz <= c.maxZ) {
      return true;
    }
  }
  return false;
}

const grid = new Uint8Array(cols * rows);
let walkableCount = 0;
for (let r = 0; r < rows; r++) {
  const wz = minZ + r * CELL_SIZE;
  for (let c = 0; c < cols; c++) {
    const wx = minX + c * CELL_SIZE;
    if (isInsideCorridor(wx, wz)) {
      grid[r * cols + c] = 1;
      walkableCount++;
    }
  }
}
console.log(`Walkable cells: ${walkableCount}`);

// Find nearest walkable cell
function findNearestCell(wx, wz) {
  let c = Math.round((wx - minX) / CELL_SIZE);
  let r = Math.round((wz - minZ) / CELL_SIZE);
  c = Math.max(0, Math.min(cols - 1, c));
  r = Math.max(0, Math.min(rows - 1, r));

  if (grid[r * cols + c] === 1) return { c, r };

  // Spiral search
  for (let rad = 1; rad < 20; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
          if (grid[nr * cols + nc] === 1) return { c: nc, r: nr };
        }
      }
    }
  }
  return { c, r };
}

// A* pathfinder
function aStar(startWx, startWz, endWx, endWz) {
  const start = findNearestCell(startWx, startWz);
  const end = findNearestCell(endWx, endWz);

  const startIdx = start.r * cols + start.c;
  const endIdx = end.r * cols + end.c;
  if (startIdx === endIdx) return [{ x: endWx, z: endWz }];

  // Simple min-heap or priority queue / flat arrays for fast A*
  const openSet = new Set([startIdx]);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const gScore = new Float32Array(cols * rows).fill(Infinity);
  const fScore = new Float32Array(cols * rows).fill(Infinity);

  gScore[startIdx] = 0;
  const h0 = Math.hypot(start.c - end.c, start.r - end.r);
  fScore[startIdx] = h0;

  // 8-direction neighbors: straight cost 1.0, diagonal cost 1.414
  const dCols = [ 0,  1,  0, -1,  1,  1, -1, -1];
  const dRows = [-1,  0,  1,  0, -1,  1,  1, -1];
  const costs = [ 1,  1,  1,  1, 1.414, 1.414, 1.414, 1.414];

  let iterations = 0;
  while (openSet.size > 0 && iterations < 30000) {
    iterations++;
    let currentIdx = -1;
    let lowestF = Infinity;
    for (const idx of openSet) {
      if (fScore[idx] < lowestF) {
        lowestF = fScore[idx];
        currentIdx = idx;
      }
    }

    if (currentIdx === endIdx) {
      // Reconstruct path
      const pathIndices = [];
      let curr = currentIdx;
      while (curr !== -1) {
        pathIndices.push(curr);
        curr = cameFrom[curr];
      }
      pathIndices.reverse();

      const rawWaypoints = pathIndices.map(idx => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        return {
          x: minX + c * CELL_SIZE,
          z: minZ + r * CELL_SIZE
        };
      });

      // Smooth path: eliminate collinear or redundant waypoints
      const smoothed = smoothPath(rawWaypoints);
      return smoothed;
    }

    openSet.delete(currentIdx);
    const currC = currentIdx % cols;
    const currR = Math.floor(currentIdx / cols);

    for (let i = 0; i < 8; i++) {
      const nc = currC + dCols[i];
      const nr = currR + dRows[i];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (grid[nIdx] !== 1) continue;

      // Prevent corner cutting across diagonals if both orthogonal neighbors are blocked
      if (i >= 4) {
        const orth1 = currR * cols + nc;
        const orth2 = nr * cols + currC;
        if (grid[orth1] !== 1 || grid[orth2] !== 1) continue;
      }

      const tentativeG = gScore[currentIdx] + costs[i];
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        const h = Math.hypot(nc - end.c, nr - end.r);
        fScore[nIdx] = tentativeG + h;
        openSet.add(nIdx);
      }
    }
  }
  return null;
}

// Line of sight check for path smoothing
function lineOfSight(p1, p2) {
  const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.4));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const wx = p1.x + (p2.x - p1.x) * t;
    const wz = p1.z + (p2.z - p1.z) * t;
    if (!isInsideCorridor(wx, wz)) return false;
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
      if (lineOfSight(points[curr], points[next])) {
        furthest = next;
        break;
      }
    }
    result.push(points[furthest]);
    curr = furthest;
  }
  return result;
}

// Test A* between sample coordinates
const t0 = performance.now();
const path = aStar(0, 25, -20, -40);
const t1 = performance.now();
console.log(`Path calculated in ${(t1-t0).toFixed(2)}ms! Waypoints:`, path ? path.length : 'none');
if (path) {
  console.log('Waypoints:');
  path.forEach((p, i) => console.log(`  #${i}: (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`));
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDist += Math.hypot(path[i+1].x - path[i].x, path[i+1].z - path[i].z);
  }
  console.log(`Total smoothed distance: ${totalDist.toFixed(1)}m`);
}

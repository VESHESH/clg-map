import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';

const buf = fs.readFileSync('campus_ground_floor_edited__1_.glb');
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuf, '', gltf => {
  gltf.scene.updateMatrixWorld(true);
  const corridorPolygons = [];
  const roomPolygons = [];
  const courtyardBoxes = [];

  gltf.scene.traverse(c => {
    if (!c.name) return;
    if (c.name.startsWith('Corridor_') && c.isMesh) {
      const pos = c.geometry.attributes.position;
      const v = new THREE.Vector3();
      const pts = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
        if (!pts.some(p => Math.hypot(p.x - v.x, p.z - v.z) < 0.05)) {
          pts.push({ x: v.x, z: v.z });
        }
      }
      if (pts.length >= 3) {
        let cx = 0, cz = 0;
        pts.forEach(p => { cx += p.x; cz += p.z; });
        cx /= pts.length; cz /= pts.length;
        pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
        const box = new THREE.Box3().setFromObject(c);
        corridorPolygons.push({ name: c.name, pts, box, cx, cz });
      }
    } else if (c.name.startsWith('Room_') && c.isMesh) {
      const pos = c.geometry.attributes.position;
      const v = new THREE.Vector3();
      const pts = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
        if (!pts.some(p => Math.hypot(p.x - v.x, p.z - v.z) < 0.05)) {
          pts.push({ x: v.x, z: v.z });
        }
      }
      if (pts.length >= 3) {
        let cx = 0, cz = 0;
        pts.forEach(p => { cx += p.x; cz += p.z; });
        cx /= pts.length; cz /= pts.length;
        pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
        roomPolygons.push({ name: c.name, pts, cx, cz });
      }
    } else if (c.name.includes('Courtyard') || c.name.includes('Paved') || c.name === 'Ground') {
      courtyardBoxes.push(new THREE.Box3().setFromObject(c));
    }
  });

  function isPointInPoly(px, pz, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, zi = pts[i].z;
      const xj = pts[j].x, zj = pts[j].z;
      const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function isPointInCorridors(px, pz) {
    for (let i = 0; i < corridorPolygons.length; i++) {
      const cp = corridorPolygons[i];
      if (cp.box && (px < cp.box.min.x - 0.05 || px > cp.box.max.x + 0.05 || pz < cp.box.min.z - 0.05 || pz > cp.box.max.z + 0.05)) {
        continue;
      }
      if (isPointInPoly(px, pz, cp.pts)) return true;
    }
    return false;
  }

  // Find bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  corridorPolygons.forEach(cp => {
    cp.pts.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    });
  });

  const cellSize = 0.5;
  const gridMinX = Math.floor(minX - 1);
  const gridMaxX = Math.ceil(maxX + 1);
  const gridMinZ = Math.floor(minZ - 1);
  const gridMaxZ = Math.ceil(maxZ + 1);
  const cols = Math.round((gridMaxX - gridMinX) / cellSize);
  const rows = Math.round((gridMaxZ - gridMinZ) / cellSize);

  console.log(`Grid dimensions: ${cols} cols x ${rows} rows`);

  const grid = new Uint8Array(cols * rows);

  // Step 1: Base corridor cells
  for (let r = 0; r < rows; r++) {
    const wz = gridMinZ + r * cellSize;
    for (let c = 0; c < cols; c++) {
      const wx = gridMinX + c * cellSize;
      if (isPointInCorridors(wx, wz)) {
        grid[r * cols + c] = 1;
      }
    }
  }

  const initialCount = grid.filter(x => x === 1).length;
  console.log('Initial walkable cells directly in corridor meshes:', initialCount);

  // Step 2: Connect Corridor pieces less than 1m apart (e.g., Corridor_4 <-> 9, Corridor_5 <-> 10, etc.)
  for (let i = 0; i < corridorPolygons.length; i++) {
    for (let j = i + 1; j < corridorPolygons.length; j++) {
      const c1 = corridorPolygons[i];
      const c2 = corridorPolygons[j];

      // Find closest points between c1 and c2
      let minD = Infinity;
      const pairs = [];
      for (const p1 of c1.pts) {
        for (const p2 of c2.pts) {
          const d = Math.hypot(p1.x - p2.x, p1.z - p2.z);
          if (d < 1.0) {
            pairs.push({ p1, p2, d });
          }
        }
      }

      if (pairs.length > 0) {
        // Bridge cells along the line segments between close vertex pairs
        pairs.forEach(({ p1, p2, d }) => {
          const steps = Math.ceil(d / (cellSize * 0.5));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const bx = p1.x + (p2.x - p1.x) * t;
            const bz = p1.z + (p2.z - p1.z) * t;
            const gc = Math.round((bx - gridMinX) / cellSize);
            const gr = Math.round((bz - gridMinZ) / cellSize);
            if (gc >= 0 && gc < cols && gr >= 0 && gr < rows) {
              grid[gr * cols + gc] = 1;
              // Also bridge adjacent 1-cell radius for corridor width
              for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                  const nc = gc + dc, nr = gr + dr;
                  if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
                    grid[nr * cols + nc] = 1;
                  }
                }
              }
            }
          }
        });
      }
    }
  }

  const afterBridgeCount = grid.filter(x => x === 1).length;
  console.log('After bridging pieces < 1m apart:', afterBridgeCount);

  // Helper: check if a point is inside room interior or courtyard
  function isInsideRoomOrCourtyard(wx, wz) {
    for (const cb of courtyardBoxes) {
      if (wx >= cb.min.x && wx <= cb.max.x && wz >= cb.min.z && wz <= cb.max.z) return true;
    }
    for (const rp of roomPolygons) {
      if (isPointInPoly(wx, wz, rp.pts)) return true;
    }
    return false;
  }

  // Step 3: Close small holes and thin gaps (fill cells that are walkable on both sides within 0.5 m = 1 cell)
  // Repeat 2 passes
  for (let pass = 0; pass < 2; pass++) {
    const toFill = [];
    for (let r = 1; r < rows - 1; r++) {
      const wz = gridMinZ + r * cellSize;
      for (let c = 1; c < cols - 1; c++) {
        const idx = r * cols + c;
        if (grid[idx] === 1) continue;
        const wx = gridMinX + c * cellSize;
        if (isInsideRoomOrCourtyard(wx, wz)) continue;

        // Check horizontal: walkable on both sides within 0.5m (1 cell)
        const left = grid[r * cols + (c - 1)] === 1;
        const right = grid[r * cols + (c + 1)] === 1;
        const top = grid[(r - 1) * cols + c] === 1;
        const bottom = grid[(r + 1) * cols + c] === 1;

        // Diagonals
        const tl = grid[(r - 1) * cols + (c - 1)] === 1;
        const br = grid[(r + 1) * cols + (c + 1)] === 1;
        const tr = grid[(r - 1) * cols + (c + 1)] === 1;
        const bl = grid[(r + 1) * cols + (c - 1)] === 1;

        if ((left && right) || (top && bottom) || (tl && br) || (tr && bl)) {
          toFill.push(idx);
        }
      }
    }
    toFill.forEach(idx => { grid[idx] = 1; });
    console.log(`Pass ${pass + 1}: filled ${toFill.length} gap cells`);
  }

  const finalCount = grid.filter(x => x === 1).length;
  console.log('Final walkable cells count:', finalCount);

  // Check connectivity with BFS from reception / first corridor
  const visited = new Uint8Array(cols * rows);
  let startIdx = -1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1) { startIdx = i; break; }
  }

  const queue = [startIdx];
  visited[startIdx] = 1;
  let reached = 0;
  const dCols = [0, 1, 0, -1, 1, 1, -1, -1];
  const dRows = [-1, 0, 1, 0, -1, 1, 1, -1];

  while (queue.length > 0) {
    const curr = queue.shift();
    reached++;
    const cc = curr % cols;
    const cr = Math.floor(curr / cols);
    for (let k = 0; k < 8; k++) {
      const nc = cc + dCols[k];
      const nr = cr + dRows[k];
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
        const nIdx = nr * cols + nc;
        if (grid[nIdx] === 1 && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }
  }

  console.log(`Connected components check: reached ${reached} / ${finalCount} (${(reached / finalCount * 100).toFixed(1)}%)`);
});

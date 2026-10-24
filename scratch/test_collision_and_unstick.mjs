import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';

const buf = fs.readFileSync('campus_ground_floor_edited__1_.glb');
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new GLTFLoader();
loader.parse(arrayBuf, '', gltf => {
  gltf.scene.updateMatrixWorld(true);

  const corridorPolygons = [];
  const roomMeshes = [];
  let wallsMesh = null;
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
        corridorPolygons.push({ name: c.name, pts, box });
      }
    } else if (c.name.startsWith('Room_') && c.isMesh) {
      roomMeshes.push(c);
    } else if ((c.name === 'Walls' || c.name.includes('Wall')) && c.isMesh) {
      wallsMesh = c;
    } else if (c.name.includes('Courtyard') || c.name.includes('Paved') || c.name === 'Ground') {
      courtyardBoxes.push(new THREE.Box3().setFromObject(c));
    }
  });

  const realWallMeshes = [wallsMesh, ...roomMeshes].filter(Boolean);

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

  const grid = new Uint8Array(cols * rows);

  // Base cells
  for (let r = 0; r < rows; r++) {
    const wz = gridMinZ + r * cellSize;
    for (let c = 0; c < cols; c++) {
      const wx = gridMinX + c * cellSize;
      if (isPointInCorridors(wx, wz)) {
        grid[r * cols + c] = 1;
      }
    }
  }

  // Connect corridor pieces < 1m apart
  for (let i = 0; i < corridorPolygons.length; i++) {
    for (let j = i + 1; j < corridorPolygons.length; j++) {
      const c1 = corridorPolygons[i];
      const c2 = corridorPolygons[j];
      const pairs = [];
      for (const p1 of c1.pts) {
        for (const p2 of c2.pts) {
          const d = Math.hypot(p1.x - p2.x, p1.z - p2.z);
          if (d < 1.0) pairs.push({ p1, p2, d });
        }
      }
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
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nc = gc + dc, nr = gr + dr;
                if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) grid[nr * cols + nc] = 1;
              }
            }
          }
        }
      });
    }
  }

  // Close small holes and thin gaps (fill cells that are walkable on both sides within 0.5 m)
  for (let pass = 0; pass < 2; pass++) {
    const toFill = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const idx = r * cols + c;
        if (grid[idx] === 1) continue;
        const left = grid[r * cols + (c - 1)] === 1;
        const right = grid[r * cols + (c + 1)] === 1;
        const top = grid[(r - 1) * cols + c] === 1;
        const bottom = grid[(r + 1) * cols + c] === 1;
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
  }

  function isCellWalkable(wx, wz) {
    const c = Math.round((wx - gridMinX) / cellSize);
    const r = Math.round((wz - gridMinZ) / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return grid[r * cols + c] === 1;
  }

  const collisionRaycaster = new THREE.Raycaster();
  const collisionRayOrigin = new THREE.Vector3();
  const collisionRayDir = new THREE.Vector3();

  function checkRealWallCollision(currX, currZ, targetX, targetZ) {
    const dist = Math.hypot(targetX - currX, targetZ - currZ);
    if (dist < 0.001) return null;
    const dx = (targetX - currX) / dist;
    const dz = (targetZ - currZ) / dist;
    collisionRayDir.set(dx, 0, dz);

    const radius = 0.25;
    const maxHitDist = dist + radius;
    const testHeights = [0.4, 1.0, 1.6];

    for (let i = 0; i < testHeights.length; i++) {
      collisionRayOrigin.set(currX, testHeights[i], currZ);
      collisionRaycaster.set(collisionRayOrigin, collisionRayDir);
      collisionRaycaster.near = 0.02;
      collisionRaycaster.far = maxHitDist;

      const hits = collisionRaycaster.intersectObjects(realWallMeshes, false);
      if (hits.length > 0 && hits[0].distance <= maxHitDist) {
        return hits[0].object.name;
      }
    }
    return null;
  }

  function canMoveTo(currX, currZ, nx, nz) {
    if (!isCellWalkable(nx, nz)) {
      return { ok: false, reason: 'outside walkable grid' };
    }
    const hitWall = checkRealWallCollision(currX, currZ, nx, nz);
    if (hitWall) {
      return { ok: false, reason: hitWall };
    }
    return { ok: true, reason: null };
  }

  // TEST 1: Open corridor position
  const res1 = canMoveTo(0, -40, 0, -39.8);
  console.log('TEST 1 (Move in open corridor):', res1);

  // TEST 2: Move outside into courtyard
  const res2 = canMoveTo(10, 0, 15, 0);
  console.log('TEST 2 (Move into courtyard):', res2);

  // TEST 3: Move towards a room wall
  // Let's find a room center and test moving into it from corridor
  const room = roomMeshes[0];
  const box = new THREE.Box3().setFromObject(room);
  const center = new THREE.Vector3();
  box.getCenter(center);
  // From corridor near room, move towards room center
  const res3 = canMoveTo(center.x, -40, center.x, center.z);
  console.log('TEST 3 (Move towards ' + room.name + '):', res3);

  console.log('ALL TESTS EXECUTED SUCCESSFULLY!');
});

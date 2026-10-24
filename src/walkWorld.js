/**
 * walkWorld.js - Realistic First-Person Walk Mode 3D Environment
 *
 * Uses real photo textures:
 * 1. textures/wall.jpg    – Corridor walls (cream upper, pink lower band, maroon skirting).
 * 2. textures/floor.jpg   – Corridor & room floors (one tile ~60 cm wide, slightly glossy).
 * 3. textures/ceiling.jpg – Ceiling panels (3 m high).
 * 4. textures/door.jpg    – Real 1m x 2.2m walk-through doors opened ~70° with brown frames.
 *
 * Materials: MeshStandardMaterial (matte walls, slightly glossy floor, warm-white LED lights).
 */

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getRoomDoorInfo } from './graph.js';

// ─── Real Scale Constants (1 unit ≈ 0.35m) ──────────────────────────────────
const H  = CONFIG.WALK_CEILING_HEIGHT; // ~8.57 units (3 meters high)
const CW = CONFIG.WALK_CORRIDOR_WIDTH; // ~8.57 units (3 meters wide)
const WT = CONFIG.WALL_THICKNESS;      // ~0.8 units wall thickness
const DW = CONFIG.WALK_DOOR_WIDTH;     // ~2.86 units (1 meter wide door)
const DH = CONFIG.WALK_DOOR_HEIGHT;    // ~6.28 units (2.2 meters high door)
const TILE_SIZE = CONFIG.WALK_TILE_SIZE; // ~1.71 units (60cm tile)

const ENTERABLE_ROOMS = new Set(['lab', 'office', 'toilet', 'store', 'reception']);
const DOOR_OPEN_RAD = (70 * Math.PI) / 180; // opened ~70 degrees

// ─── Texture Loading ────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();

// 1. Wall texture (cream upper, 1.2m pink lower band, maroon skirting at bottom)
const wallTex = texLoader.load('./textures/wall.jpg');
wallTex.wrapS = THREE.RepeatWrapping;
wallTex.wrapT = THREE.ClampToEdgeWrapping;
wallTex.colorSpace = THREE.SRGBColorSpace;

// 2. Floor texture (one tile ~60 cm wide)
const floorTex = texLoader.load('./textures/floor.jpg');
floorTex.wrapS = THREE.RepeatWrapping;
floorTex.wrapT = THREE.RepeatWrapping;
floorTex.colorSpace = THREE.SRGBColorSpace;

// 3. Ceiling texture
const ceilingTex = texLoader.load('./textures/ceiling.jpg');
ceilingTex.wrapS = THREE.RepeatWrapping;
ceilingTex.wrapT = THREE.RepeatWrapping;
ceilingTex.colorSpace = THREE.SRGBColorSpace;

// 4. Door texture
const doorTex = texLoader.load('./textures/door.jpg');
doorTex.colorSpace = THREE.SRGBColorSpace;

// ─── MeshStandardMaterial Setup (Matte walls, slightly glossy floor) ─────────
// Wall material factory helper: sets horizontal texture repeat based on wall span
function createWallMaterial(spanLength) {
  const t = wallTex.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // Repeat wall photo pattern every ~3m (8.57 units)
  t.repeat.set(Math.max(0.5, spanLength / H), 1);

  return new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.92, // matte walls
    metalness: 0.02,
    side: THREE.DoubleSide
  });
}

const standardFloorMat = new THREE.MeshStandardMaterial({
  map: floorTex,
  roughness: 0.32,  // slightly glossy floor
  metalness: 0.08,
  side: THREE.DoubleSide
});

const standardCeilingMat = new THREE.MeshStandardMaterial({
  map: ceilingTex,
  roughness: 0.88,
  metalness: 0.02,
  side: THREE.DoubleSide
});

const doorMaterial = new THREE.MeshStandardMaterial({
  map: doorTex,
  roughness: 0.55,
  metalness: 0.05
});

const doorFrameMaterial = new THREE.MeshStandardMaterial({
  color: 0x6b4226, // rich warm brown wood frame
  roughness: 0.65,
  metalness: 0.05
});

const warmLightPanelMaterial = new THREE.MeshStandardMaterial({
  color: 0xfffaed,
  emissive: 0xfff3db,
  emissiveIntensity: 1.8,
  roughness: 0.2
});

const courtyardGroundMat = new THREE.MeshStandardMaterial({
  color: 0x4ade80,
  roughness: 0.9
});

const courtyardBenchMat = new THREE.MeshStandardMaterial({
  color: 0x78350f,
  roughness: 0.8
});

// Helper: create simple box
function makeBox(group, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// ─── 1. ROOM FLOOR ──────────────────────────────────────────────────────────
export function buildRoomFloor(room, worldX, worldZ) {
  const g = new THREE.Group();
  g.position.set(worldX(room.cx), 0.01, worldZ(room.cy));
  g.rotation.y = -THREE.MathUtils.degToRad(room.rot || 0);

  // Custom tiled floor material per room
  const t = floorTex.clone();
  t.needsUpdate = true;
  t.repeat.set(room.w / TILE_SIZE, room.h / TILE_SIZE);

  const mat = new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.32,
    metalness: 0.08
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.h), mat);
  plane.rotation.x = -Math.PI / 2;
  g.add(plane);
  return g;
}

// ─── 2. CORRIDOR FLOOR STRIP (~3m wide) ─────────────────────────────────────
export function buildCorridorFloors(corridors, worldX, worldZ) {
  const group = new THREE.Group();
  const capRadius = CW / 2; // ~4.3 units

  corridors.forEach(poly => {
    // Round caps at corridor turns and ends
    poly.forEach(pt => {
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(capRadius, 20),
        standardFloorMat
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(worldX(pt[0]), 0.02, worldZ(pt[1]));
      group.add(cap);
    });

    // 3m wide ribbon between consecutive corridor vertices
    for (let i = 0; i < poly.length - 1; i++) {
      const x1 = worldX(poly[i][0]),   z1 = worldZ(poly[i][1]);
      const x2 = worldX(poly[i+1][0]), z2 = worldZ(poly[i+1][1]);
      const len = Math.hypot(x2 - x1, z2 - z1);
      const angle = Math.atan2(x2 - x1, z2 - z1);

      const t = floorTex.clone();
      t.needsUpdate = true;
      t.repeat.set(CW / TILE_SIZE, len / TILE_SIZE);

      const mat = new THREE.MeshStandardMaterial({
        map: t,
        roughness: 0.32,
        metalness: 0.08
      });

      const g = new THREE.Group();
      g.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
      g.rotation.y = angle;

      const inner = new THREE.Mesh(new THREE.PlaneGeometry(CW, len), mat);
      inner.rotation.x = -Math.PI / 2;
      g.add(inner);
      group.add(g);
    }
  });

  return group;
}

// ─── 3. RED NUMBER PLATE TEXTURE ────────────────────────────────────────────
function createRedNumberPlateTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  // Red plate background
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  ctx.roundRect(4, 4, 376, 88, 12);
  ctx.fill();

  // Subtle gold border
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Crisp white bold room name
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fs = 32;
  ctx.font = `bold ${fs}px system-ui, -apple-system, sans-serif`;
  while (ctx.measureText(name).width > 340 && fs > 16) {
    fs -= 2;
    ctx.font = `bold ${fs}px system-ui, -apple-system, sans-serif`;
  }
  ctx.fillText(name, 192, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ─── 4. ROOM WALLS (Real Door Openings, textures/wall.jpg, brown frames) ────
export function buildRoomWalls(room, corridors, worldX, worldZ, allRooms = []) {
  const group = new THREE.Group();
  group.position.set(worldX(room.cx), 0, worldZ(room.cy));
  group.rotation.y = -THREE.MathUtils.degToRad(room.rot || 0);

  const w = room.w, d = room.h;
  const hw = w / 2, hd = d / 2;

  // Door is generated only for enterable rooms
  const isEnterable = ENTERABLE_ROOMS.has(room.type);
  const door = isEnterable ? getRoomDoorInfo(room, corridors, allRooms) : null;
  const side = door ? door.side : null;

  function solidWall(span, ww, wh, wd, x, y, z) {
    const mat = createWallMaterial(span);
    makeBox(group, ww, wh, wd, x, y + wh / 2, z, mat);
  }

  function doorWall(span, posX, posZ, axis) {
    const segLen = (span - DW) / 2;
    const lintelH = H - DH;
    const wallMat = createWallMaterial(span);

    if (axis === 'x') {
      // Left and right wall pieces
      makeBox(group, segLen, H, WT, -span / 2 + segLen / 2, H / 2, posZ, wallMat);
      makeBox(group, segLen, H, WT,  span / 2 - segLen / 2, H / 2, posZ, wallMat);

      // Lintel wall piece above the 2.2m door opening
      makeBox(group, DW, lintelH, WT, 0, DH + lintelH / 2, posZ, wallMat);

      // Brown door frame
      addDoorFrame(group, 0, posZ, 'x');

      // Hinged door leaf (textures/door.jpg, opened ~70 degrees into room)
      addHingedDoor(group, 0, posZ, 'x', posZ < 0 ? 1 : -1);

      // Small red number plate above door
      addRedPlate(group, room.name, 0, DH + lintelH * 0.45, posZ, 'x');
    } else {
      // Top and bottom wall pieces
      makeBox(group, WT, H, segLen, posX, H / 2, -span / 2 + segLen / 2, wallMat);
      makeBox(group, WT, H, segLen, posX, H / 2,  span / 2 - segLen / 2, wallMat);

      // Lintel wall piece above door
      makeBox(group, WT, lintelH, DW, posX, DH + lintelH / 2, 0, wallMat);

      // Brown door frame
      addDoorFrame(group, posX, 0, 'z');

      // Hinged door leaf opened ~70 degrees
      addHingedDoor(group, posX, 0, 'z', posX < 0 ? 1 : -1);

      // Small red number plate above door
      addRedPlate(group, room.name, posX, DH + lintelH * 0.45, 0, 'z');
    }
  }

  // Brown wood door frame helper
  function addDoorFrame(g, cx, cz, axis) {
    const FT = 0.16; // frame post thickness
    const FW = DH + 0.1;
    const FD = WT + 0.1;

    if (axis === 'x') {
      makeBox(g, FT, FW, FD, cx - DW / 2 - FT / 2, FW / 2, cz, doorFrameMaterial);
      makeBox(g, FT, FW, FD, cx + DW / 2 + FT / 2, FW / 2, cz, doorFrameMaterial);
      makeBox(g, DW + FT * 2, FT, FD, cx, DH + FT / 2, cz, doorFrameMaterial);
    } else {
      makeBox(g, FD, FW, FT, cx, FW / 2, cz - DW / 2 - FT / 2, doorFrameMaterial);
      makeBox(g, FD, FW, FT, cx, FW / 2, cz + DW / 2 + FT / 2, doorFrameMaterial);
      makeBox(g, FD, FT, DW + FT * 2, cx, DH + FT / 2, cz, doorFrameMaterial);
    }
  }

  // Realistic hinged door leaf opened ~70 degrees into the room
  function addHingedDoor(g, cx, cz, axis, swingDir) {
    const pivot = new THREE.Group();
    const leafThick = 0.08;

    if (axis === 'x') {
      pivot.position.set(cx - DW / 2, 0, cz);
      pivot.rotation.y = DOOR_OPEN_RAD * swingDir;

      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(DW * 0.98, DH, leafThick),
        doorMaterial
      );
      leaf.position.set(DW / 2, DH / 2, 0);
      pivot.add(leaf);
    } else {
      pivot.position.set(cx, 0, cz - DW / 2);
      pivot.rotation.y = (Math.PI / 2 + DOOR_OPEN_RAD) * swingDir;

      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(DW * 0.98, DH, leafThick),
        doorMaterial
      );
      leaf.position.set(DW / 2, DH / 2, 0);
      pivot.add(leaf);
    }
    g.add(pivot);
  }

  // Small red number plate helper
  function addRedPlate(g, name, cx, cy, cz, axis) {
    const plateW = Math.min(DW * 0.9, 3.2);
    const plateH = 0.65;
    const plateD = 0.08;
    const tex = createRedNumberPlateTexture(name);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.5
    });

    const geo = axis === 'x'
      ? new THREE.BoxGeometry(plateW, plateH, plateD)
      : new THREE.BoxGeometry(plateD, plateH, plateW);

    const plate = new THREE.Mesh(geo, mat);
    plate.position.set(cx, cy, cz);
    g.add(plate);
  }

  // Build the 4 walls (one with door opening if enterable)
  if (side === 'top')    { doorWall(w, 0, -hd + WT / 2, 'x'); } else { solidWall(w, w, H, WT,        0, 0, -hd + WT / 2); }
  if (side === 'bottom') { doorWall(w, 0,  hd - WT / 2, 'x'); } else { solidWall(w, w, H, WT,        0, 0,  hd - WT / 2); }
  if (side === 'left')   { doorWall(d, -hw + WT / 2, 0, 'z'); } else { solidWall(d, WT, H, d, -hw + WT / 2, 0, 0); }
  if (side === 'right')  { doorWall(d,  hw - WT / 2, 0, 'z'); } else { solidWall(d, WT, H, d,  hw - WT / 2, 0, 0); }

  return group;
}

// ─── 5. CEILINGS (textures/ceiling.jpg at 3m height) ─────────────────────────
export function buildCeilings(rooms, corridors, worldX, worldZ) {
  const group = new THREE.Group();
  const capRadius = CW / 2;

  // Corridor ceilings
  corridors.forEach(poly => {
    poly.forEach(pt => {
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(capRadius, 20),
        standardCeilingMat
      );
      cap.rotation.x = Math.PI / 2;
      cap.position.set(worldX(pt[0]), H, worldZ(pt[1]));
      group.add(cap);
    });

    for (let i = 0; i < poly.length - 1; i++) {
      const x1 = worldX(poly[i][0]),   z1 = worldZ(poly[i][1]);
      const x2 = worldX(poly[i+1][0]), z2 = worldZ(poly[i+1][1]);
      const len = Math.hypot(x2 - x1, z2 - z1);
      const angle = Math.atan2(x2 - x1, z2 - z1);

      const t = ceilingTex.clone();
      t.needsUpdate = true;
      t.repeat.set(CW / 3.0, len / 3.0);

      const mat = new THREE.MeshStandardMaterial({
        map: t,
        roughness: 0.88,
        metalness: 0.02
      });

      const g = new THREE.Group();
      g.position.set((x1 + x2) / 2, H, (z1 + z2) / 2);
      g.rotation.y = angle;

      const p = new THREE.Mesh(new THREE.PlaneGeometry(CW, len), mat);
      p.rotation.x = Math.PI / 2;
      g.add(p);
      group.add(g);
    }
  });

  // Room ceilings (except void courtyard)
  rooms.filter(r => r.type !== 'void').forEach(r => {
    const g = new THREE.Group();
    g.position.set(worldX(r.cx), H, worldZ(r.cy));
    g.rotation.y = -THREE.MathUtils.degToRad(r.rot || 0);

    const t = ceilingTex.clone();
    t.needsUpdate = true;
    t.repeat.set(r.w / 4.0, r.h / 4.0);

    const mat = new THREE.MeshStandardMaterial({
      map: t,
      roughness: 0.88,
      metalness: 0.02
    });

    const p = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.h), mat);
    p.rotation.x = Math.PI / 2;
    g.add(p);
    group.add(g);
  });

  return group;
}

// ─── 6. WARM-WHITE CEILING LIGHT PANELS ─────────────────────────────────────
export function buildCeilingLights(corridors, worldX, worldZ) {
  const group = new THREE.Group();

  corridors.forEach(poly => {
    for (let i = 0; i < poly.length - 1; i++) {
      const x1 = worldX(poly[i][0]),   z1 = worldZ(poly[i][1]);
      const x2 = worldX(poly[i+1][0]), z2 = worldZ(poly[i+1][1]);
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ang = Math.atan2(x2 - x1, z2 - z1);
      const count = Math.max(2, Math.floor(len / 16));

      for (let k = 1; k <= count; k++) {
        const t  = k / (count + 1);
        const lx = x1 + (x2 - x1) * t;
        const lz = z1 + (z2 - z1) * t;

        // Warm-white glowing LED panel (1.2m long, 0.35m wide)
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 0.08, 3.8),
          warmLightPanelMaterial
        );
        panel.position.set(lx, H - 0.04, lz);
        panel.rotation.y = ang;
        group.add(panel);
      }
    }
  });

  return group;
}

// ─── 7. OPEN TO SKY COURTYARD ───────────────────────────────────────────────
export function buildCourtyard(room, worldX, worldZ) {
  const group = new THREE.Group();
  group.position.set(worldX(room.cx), 0, worldZ(room.cy));
  group.rotation.y = -THREE.MathUtils.degToRad(room.rot || 0);

  const w = room.w, d = room.h;

  // Green courtyard ground (no ceiling above)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), courtyardGroundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  group.add(ground);

  // Wooden benches
  const benchPositions = [
    [-w * 0.25,  d * 0.25],
    [ w * 0.25, -d * 0.25],
    [-w * 0.25, -d * 0.25]
  ];
  benchPositions.forEach(([bx, bz]) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 2), courtyardBenchMat);
    seat.position.set(bx, 0.55, bz);
    group.add(seat);

    const back = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 0.3), courtyardBenchMat);
    back.position.set(bx, 1.35, bz + 0.85);
    group.add(back);
  });

  return group;
}

// ─── 8. OUTER WALL ──────────────────────────────────────────────────────────
export function buildOuterWall(rooms, worldX, worldZ) {
  const group = new THREE.Group();
  const mat = createWallMaterial(20);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  rooms.filter(r => r.type !== 'void').forEach(r => {
    minX = Math.min(minX, worldX(r.cx) - r.w / 2 - 4);
    maxX = Math.max(maxX, worldX(r.cx) + r.w / 2 + 4);
    minZ = Math.min(minZ, worldZ(r.cy) - r.h / 2 - 4);
    maxZ = Math.max(maxZ, worldZ(r.cy) + r.h / 2 + 4);
  });

  const W = maxX - minX;
  const cx = (minX + maxX) / 2;

  makeBox(group, W, H, WT, cx, H / 2, minZ, mat);
  makeBox(group, W, H, WT, cx, H / 2, maxZ, mat);

  return group;
}

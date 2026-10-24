/**
 * main.js  –  AIT Pune Indoor Navigation
 *
 * Exclusively uses the new 3D campus model (campus_ground_floor_edited__1_.glb)
 *
 * Two modes:
 *  MAP  mode  – Slanted top-down 3D view with OrbitControls, readable room labels, roofs hidden
 *  WALK mode  – First-person walk mode at 1.6m eye height, corridor roofs as ceilings, WASD movement
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';

// ─── Scene & Fog ─────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a201c);

const walkFog = new THREE.Fog(0xe8e2d8, 15, 120);

// ─── Camera ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.3, 2000);
const GLB_CAM_POS    = new THREE.Vector3(0, 125, 95);
const GLB_CAM_TARGET = new THREE.Vector3(0, 0, 5);
camera.position.copy(GLB_CAM_POS);

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// ─── Orbit Controls (Map mode only) ─────────────────────────────────────────
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping  = true;
orbitControls.dampingFactor  = 0.05;
orbitControls.screenSpacePanning = true;
orbitControls.maxPolarAngle  = Math.PI / 2.05;
orbitControls.minDistance    = 10;
orbitControls.maxDistance    = 1400;
orbitControls.target.copy(GLB_CAM_TARGET);

// ─── Lighting ────────────────────────────────────────────────────────────────
const mapAmbient = new THREE.AmbientLight(0xffffff, 0.75);
const walkAmbient = new THREE.AmbientLight(0xfff5ea, 0.95);
walkAmbient.visible = false;
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.75);
const dirLight = new THREE.DirectionalLight(0xfff8ee, 0.65);
dirLight.position.set(60, 150, 80);

scene.add(mapAmbient, walkAmbient, hemi, dirLight);

// ─── 3D Model & Route Groups ────────────────────────────────────────────────
const glbGroup = new THREE.Group();
scene.add(glbGroup);

const roomDoorsGroup = new THREE.Group();
roomDoorsGroup.name = 'RoomDoors';
glbGroup.add(roomDoorsGroup);

const textureLoader = new THREE.TextureLoader();
const doorTexture = textureLoader.load('./textures/door.jpg');
doorTexture.colorSpace = THREE.SRGBColorSpace;

const grp = {
  route: new THREE.Group(),
  debugGraph: new THREE.Group(),
  doors: new THREE.Group(),
  walkableArea: new THREE.Group()
};
Object.values(grp).forEach(g => scene.add(g));
grp.doors.visible = false;
grp.walkableArea.visible = false;

// ─── State ───────────────────────────────────────────────────────────────────
let activeMode        = 'map';
const interactable    = [];         // meshes that can be tapped/clicked

// GLB model state
let glbScene          = null;
let glbRooms          = [];         // parsed Room_ objects from GLB
let glbDisambNames    = {};         // id -> "Gents Toilet (near Accounts)"
let glbRoofs          = [];         // Roof_ meshes
let glbCorridorRoofs  = [];         // CorridorRoof_ meshes
let glbLabels         = [];         // Label_ text meshes
let glbLoaded         = false;

let fromRoomId = null;
let toRoomId   = null;
let routeResult = null;
let destBeacon = null;

// STAGE 4: Corridor Grid & Walkable Navigation State
let corridorBoxes = [];
let corridorPolygons = []; // [{ name, pts: [{x, z}], box }]
let courtyardBoxes = [];   // [THREE.Box3]
let roomBoxes = [];        // [{ name, box: THREE.Box3, mesh }]
let solidWallMeshes = [];  // [THREE.Mesh]
let wallDistGrid = null;   // Float32Array (distance to nearest wall in meters)
let gridMinX = 0, gridMaxX = 0, gridMinZ = 0, gridMaxZ = 0;
let gridCols = 0, gridRows = 0;
let corridorGrid = null;   // Uint8Array (1 = walkable corridor floor)

let activeRouteWaypoints = [];
let activeRouteInstructions = [];
let hasArrivedAtDest = false;
let lastOffRouteRecalcTime = 0;

// Simulation State
let simWaypointIdx = 1;
let simDistanceTraveled = 0;

// STAGE 4: Guidance Instruction Card Elements
const walkInstructionCard = document.getElementById('walk-instruction-card');
const instructionIconEl   = document.getElementById('instruction-icon');
const instructionTitleEl  = document.getElementById('instruction-title');
const instructionSubEl    = document.getElementById('instruction-sub');

// STAGE 4: Show Walkable Area Toggle Buttons
const walkShowWalkableBtn  = document.getElementById('walk-show-walkable-btn');
const walkShowWalkableText = document.getElementById('walk-show-walkable-text');
const showWalkableBtn      = document.getElementById('show-walkable-btn');

// Collision Debug UI Elements
const debugBlockedBar    = document.getElementById('debug-blocked-bar');
const debugBlockedReason = document.getElementById('debug-blocked-reason');
const walkDebugBtn       = document.getElementById('walk-debug-btn');
const walkDebugText      = document.getElementById('walk-debug-text');
const showDebugBtn       = document.getElementById('show-debug-btn');
let isDebugMode          = false;
let currentBlockedReason = null;

// ─── Walk-mode person state ──────────────────────────────────────────────────
const person = {
  x: 0,
  z: 25,
  yaw: 0,
  pitch: 0
};
const heldKeys = new Set();
const heldPointerButtons = new Set();
let lastControlEventTime = 0;
let isDragging      = false;
let dragStartX      = 0;
let dragStartY      = 0;
let pointerDownTime = 0;
let isPersonStuckKeyHeld = false;
let stuckStartTime  = 0;

// ─── Location Banner Helper ──────────────────────────────────────────────────
const locationBanner = document.createElement('div');
locationBanner.id = 'location-banner';
locationBanner.style.cssText = `
  position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%);
  background: rgba(15,23,42,0.9); color: #fff;
  padding: 10px 22px; border-radius: 40px;
  font-size: 15px; font-weight: 600;
  border: 1.5px solid rgba(56,189,248,0.5);
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  pointer-events: none; z-index: 30; opacity: 0;
  transition: opacity 0.4s ease;
`;
document.body.appendChild(locationBanner);

function showBanner(text) {
  locationBanner.textContent = text;
  locationBanner.style.opacity = '1';
  clearTimeout(locationBanner._timer);
  locationBanner._timer = setTimeout(() => { locationBanner.style.opacity = '0'; }, 3500);
}

// ─── Room Type Helper ────────────────────────────────────────────────────────
function getGlbRoomType(name) {
  const s = (name || '').toLowerCase();
  if (s.includes('toilet')) return 'toilet';
  if (s.includes('stair')) return 'stair';
  if (s.includes('lab')) return 'lab';
  if (s.includes('reception') || s.includes('foyer')) return 'reception';
  if (s.includes('entry')) return 'entry';
  if (s.includes('store')) return 'store';
  if (s.includes('library')) return 'office';
  if (s.includes('office') || s.includes('hod') || s.includes('director') || s.includes('staff') || s.includes('registrar') || s.includes('accounts') || s.includes('admission') || s.includes('cell') || s.includes('corner') || s.includes('hall')) return 'office';
  return 'other';
}

function cleanRoomName(str) {
  if (!str) return '';
  return str
    .replace(/^Room_/i, '')
    .replace(/\.\d+$/g, '')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(str) {
  return cleanRoomName(str).toLowerCase();
}

function getActiveRoomList() {
  return glbRooms.map(r => ({
    id: r.id,
    name: cleanRoomName(r.name),
    displayName: cleanRoomName(glbDisambNames[r.id] || r.displayName || r.name),
    type: r.type,
    x: r.x,
    y: r.y
  }));
}

function searchRooms(queryText) {
  const cleanQ = normalizeSearchText(queryText);
  if (!cleanQ) return [];

  const activeRooms = getActiveRoomList();
  if (!activeRooms || !activeRooms.length) return [];

  const qWords = cleanQ.split(' ').filter(Boolean);
  const matched = [];

  activeRooms.forEach(room => {
    const rawLower = (room.name || '').toLowerCase();
    if (rawLower.includes('courtyard') || rawLower.includes('paved') || rawLower.includes('ground') || room.type === 'void') {
      return;
    }

    const cleanDisplay = room.displayName;
    const normDisplay = cleanDisplay.toLowerCase();
    const normRaw = (room.name || '').toLowerCase();
    const normType = (room.type || '').toLowerCase();

    // Contains match: true if direct substring match or all query words match
    const directContains = normDisplay.includes(cleanQ) || normRaw.includes(cleanQ) || normType.includes(cleanQ);
    const matchesAllWords = qWords.length > 0 && qWords.every(w => normDisplay.includes(w) || normRaw.includes(w) || normType.includes(w));

    if (directContains || matchesAllWords) {
      let score = 3;
      if (normDisplay.startsWith(cleanQ)) {
        score = 1;
      } else if (normDisplay.split(' ').some(w => w.startsWith(cleanQ))) {
        score = 2;
      }

      matched.push({
        room,
        cleanDisplay,
        score,
        len: cleanDisplay.length
      });
    }
  });

  matched.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.len - b.len;
  });

  return matched.slice(0, 8).map(m => ({
    ...m.room,
    displayName: m.cleanDisplay
  }));
}

// ─── Mode Switching (Map vs Walk) ───────────────────────────────────────────
function applyMapMode() {
  scene.background.setHex(0x1a201c);
  scene.fog = null;

  glbGroup.visible = true;

  // In Map mode: hide roofs so room interiors and floor are visible, show 3D room labels
  glbRoofs.forEach(m => { m.visible = false; });
  glbCorridorRoofs.forEach(m => { m.visible = false; });
  glbLabels.forEach(m => { m.visible = true; });

  mapAmbient.visible   = true;
  mapAmbient.intensity = 0.75;
  walkAmbient.visible  = false;
  hemi.color.setHex(0xffffff);
  hemi.groundColor.setHex(0x444444);
  hemi.intensity       = 0.75;
  dirLight.intensity   = 0.65;

  camera.fov = 45;
  camera.updateProjectionMatrix();
  camera.position.copy(GLB_CAM_POS);
  orbitControls.target.copy(GLB_CAM_TARGET);
  orbitControls.enabled = true;
}

function applyWalkMode() {
  scene.background.setHex(0xe8e2d8);
  scene.fog = walkFog;
  walkFog.color.setHex(0xe8e2d8);
  walkFog.near = 15;
  walkFog.far = 120;

  glbGroup.visible = true;

  // In Walk mode: hide room roofs and floating labels, keep corridor roof as ceiling
  glbRoofs.forEach(m => { m.visible = false; });
  glbCorridorRoofs.forEach(m => { m.visible = true; });
  glbLabels.forEach(m => { m.visible = false; });

  mapAmbient.visible    = false;
  walkAmbient.visible   = true;
  walkAmbient.intensity = 0.95;
  hemi.color.setHex(0xfff8f0);
  hemi.groundColor.setHex(0x332822);
  hemi.intensity        = 0.75;
  dirLight.intensity    = 0.55;

  camera.fov = 70;
  camera.updateProjectionMatrix();
  orbitControls.enabled = false;

  // Ensure start position is inside a walkable cell
  if (corridorGrid && !isCellWalkable(person.x, person.z)) {
    const snapped = findNearestWalkableCell(person.x, person.z);
    person.x = snapped.x;
    person.z = snapped.z;
  }
}

function applyCameraFromPerson() {
  camera.position.set(person.x, CONFIG.EYE_HEIGHT_METERS || 1.6, person.z);
  camera.rotation.set(person.pitch, person.yaw, 0, 'YXZ');
}

function placePersonAtRoom(roomId, openConfirm = false) {
  const room = glbRooms.find(r => r.id === roomId);
  if (!room) return;

  if (room.door) {
    // 2m in front of room door, facing the door, never touching a wall
    const standoff = CONFIG.DOOR_STANDOFF_DISTANCE || 2.0;
    const targetX = room.door.x + room.door.normal.x * standoff;
    const targetZ = room.door.z + room.door.normal.z * standoff;

    // Snap to nearest walkable corridor cell with safety margin
    const snapped = findNearestWalkableCell(targetX, targetZ);
    person.x = snapped.x;
    person.z = snapped.z;

    // Face directly towards the room's door
    const dx = room.door.x - person.x;
    const dz = room.door.z - person.z;
    person.yaw = Math.atan2(-dx, -dz);
  } else {
    const snapped = findNearestWalkableCell(room.x, room.y);
    person.x = snapped.x;
    person.z = snapped.z;
    const dx = room.x - person.x;
    const dz = room.y - person.z;
    person.yaw = Math.atan2(-dx, -dz);
  }
  person.pitch = 0;
  applyCameraFromPerson();
  showBanner(`You are at ${glbDisambNames[room.id] || room.name}`);
  if (openConfirm) showConfirmDialog(room);
  if (activeRouteWaypoints.length && toRoomId) updateGuidanceCard();
}

// ─── Confirmation & Start Flow Dialogs ──────────────────────────────────────
const whereModalEl     = document.getElementById('where-modal');
const whereCloseBtn    = document.getElementById('where-close-btn');
const whereInputEl     = document.getElementById('where-input');
const whereAutoListEl  = document.getElementById('where-autocomplete');
const clearWhereBtn    = document.getElementById('clear-where-btn');
const repositionBtn    = document.getElementById('reposition-btn');
const checkGpsBtn      = document.getElementById('check-gps-btn');
const gpsBannerEl      = document.getElementById('gps-sanity-banner');
const gpsIconEl        = document.getElementById('gps-icon');
const gpsStatusTitleEl = document.getElementById('gps-status-title');
const gpsStatusDescEl  = document.getElementById('gps-status-desc');

const confirmDialogEl  = document.getElementById('confirm-dialog') || document.getElementById('confirm-location-dialog');
const confirmHeadingEl = document.getElementById('confirm-room-heading') || document.getElementById('confirm-heading');
const confirmYesBtn    = document.getElementById('confirm-yes-btn');
const confirmNotQuiteB = document.getElementById('confirm-notquite-btn') || document.getElementById('confirm-not-quite-btn');
const notQuiteOptions  = document.getElementById('notquite-options') || document.getElementById('not-quite-options');
const turnLeftBtn      = document.getElementById('turn-left-btn');
const turnRightBtn     = document.getElementById('turn-right-btn');
const flipAroundBtn    = document.getElementById('flip-around-btn');
const repickRoomBtn    = document.getElementById('repick-room-btn');

const compassDialogEl  = document.getElementById('compass-dialog') || document.getElementById('compass-calibration-dialog');
const setDirectionBtn  = document.getElementById('set-direction-btn');
const skipCompassBtn   = document.getElementById('skip-compass-btn');
const compassStatusMsg = document.getElementById('compass-status-msg');

let hasCompletedStartFlow = false;
let currentConfirmRoom   = null;
let storedCompassOffset   = parseFloat(localStorage.getItem('ait_compass_offset') || '0');

const popularSectionEl = document.getElementById('popular-section');

function openWhereModal() {
  if (whereModalEl) whereModalEl.classList.remove('hidden');
  if (whereInputEl) {
    whereInputEl.value = '';
    whereInputEl.focus();
  }
  if (clearWhereBtn) clearWhereBtn.classList.remove('visible');
  if (whereAutoListEl) whereAutoListEl.classList.add('hidden');
  if (popularSectionEl) popularSectionEl.classList.remove('hidden');
}

function closeWhereModal() {
  whereModalEl.classList.add('hidden');
}

function verifyCampusGps() {
  if (!navigator.geolocation) {
    updateGpsStatus('demo', 'Location Unavailable', 'GPS not supported on this browser. Continuing in demo mode.');
    return;
  }
  updateGpsStatus('checking', 'Locating...', 'Checking GPS signal...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      const R = 6371000;
      const dLat = THREE.MathUtils.degToRad(latitude - CONFIG.CAMPUS_GPS.latitude);
      const dLon = THREE.MathUtils.degToRad(longitude - CONFIG.CAMPUS_GPS.longitude);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(THREE.MathUtils.degToRad(CONFIG.CAMPUS_GPS.latitude)) *
                Math.cos(THREE.MathUtils.degToRad(latitude)) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      if (dist <= CONFIG.CAMPUS_GPS.radiusMeters) {
        updateGpsStatus('ok', 'At AIT Campus', `Within campus bounds (~${dist.toFixed(0)}m from center).`);
      } else {
        updateGpsStatus('demo', 'Demo Mode Active', `Away from campus (~${(dist/1000).toFixed(1)}km). Full building preview enabled.`);
      }
    },
    err => {
      updateGpsStatus('demo', 'GPS Permission Denied', 'Running in manual demo mode.');
    },
    { timeout: 8000, enableHighAccuracy: false }
  );
}

function updateGpsStatus(type, title, desc) {
  gpsBannerEl.className = 'gps-banner';
  if (type === 'ok') {
    gpsBannerEl.classList.add('verified');
    gpsIconEl.textContent = '✅';
  } else if (type === 'demo') {
    gpsBannerEl.classList.add('demo-mode');
    gpsIconEl.textContent = '📍';
  } else {
    gpsIconEl.textContent = '📡';
  }
  gpsStatusTitleEl.textContent = title;
  gpsStatusDescEl.textContent = desc;
}

if (checkGpsBtn) checkGpsBtn.addEventListener('click', verifyCampusGps);
if (whereCloseBtn) whereCloseBtn.addEventListener('click', closeWhereModal);
if (repositionBtn) repositionBtn.addEventListener('click', openWhereModal);

function setupWhereAutocomplete() {
  function render(q) {
    if (!whereAutoListEl) return;
    whereAutoListEl.innerHTML = '';
    const cleanQ = normalizeSearchText(q);

    // While there's any text in the box, hide "Popular places" and show list of matching rooms
    if (!cleanQ) {
      whereAutoListEl.classList.add('hidden');
      if (popularSectionEl) popularSectionEl.classList.remove('hidden');
      return;
    }

    if (popularSectionEl) popularSectionEl.classList.add('hidden');

    const results = searchRooms(cleanQ);
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'autocomplete-empty';
      li.textContent = `No matching rooms found for "${q.trim()}"`;
      whereAutoListEl.appendChild(li);
      whereAutoListEl.classList.remove('hidden');
      return;
    }

    results.forEach(room => {
      const li = document.createElement('li');
      li.className = 'autocomplete-item';
      li.innerHTML = `<span>${room.displayName}</span>
                      <span class="autocomplete-item-tag">${room.type}</span>`;
      li.addEventListener('click', () => {
        selectStartingRoom(room.id);
      });
      whereAutoListEl.appendChild(li);
    });
    whereAutoListEl.classList.remove('hidden');
  }

  if (whereInputEl) {
    whereInputEl.addEventListener('focus', () => render(whereInputEl.value));
    whereInputEl.addEventListener('input', () => {
      if (clearWhereBtn) clearWhereBtn.classList.toggle('visible', !!whereInputEl.value.trim());
      render(whereInputEl.value);
    });
    whereInputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const results = searchRooms(whereInputEl.value);
        if (results.length > 0) {
          selectStartingRoom(results[0].id);
        }
      }
    });
  }

  if (clearWhereBtn) {
    clearWhereBtn.addEventListener('click', () => {
      if (whereInputEl) whereInputEl.value = '';
      clearWhereBtn.classList.remove('visible');
      if (whereAutoListEl) whereAutoListEl.classList.add('hidden');
      if (popularSectionEl) popularSectionEl.classList.remove('hidden');
      if (whereInputEl) whereInputEl.focus();
    });
  }
}

setupWhereAutocomplete();

// Popular Quick Buttons
document.querySelectorAll('.popular-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const roomId = btn.dataset.roomId;
    if (roomId) selectStartingRoom(roomId);
  });
});

function selectStartingRoom(roomId) {
  closeWhereModal();
  const activeRooms = getActiveRoomList();
  let room = activeRooms.find(r => r.id === roomId);
  if (!room) {
    const lower = (roomId || '').toLowerCase();
    if (lower === 'r69' || lower.includes('reception')) {
      room = activeRooms.find(r => r.name.toLowerCase().includes('reception') || r.name.toLowerCase().includes('foyer'));
    } else if (lower === 'r07' || lower.includes('physics')) {
      room = activeRooms.find(r => r.name.toLowerCase().includes('physics'));
    } else if (lower === 'r11' || lower.includes('software')) {
      room = activeRooms.find(r => r.name.toLowerCase().includes('central software') || r.name.toLowerCase().includes('software'));
    } else if (lower === 'r71' || lower.includes('entry')) {
      room = activeRooms.find(r => r.name.toLowerCase().includes('entry'));
    }
  }

  if (!room && activeRooms.length > 0) room = activeRooms[0];

  if (room) {
    onFromRoomChanged(room.id);
    const dName = glbDisambNames[room.id] || room.displayName || room.name;
    if (currLocationTxt) currLocationTxt.textContent = dName;
    enterWalkMode();
    placePersonAtRoom(room.id, false);
    if (orbitControls?.target) orbitControls.target.set(room.x, 0, room.y);
    showBanner(`Teleported to ${dName}`);
    if (toRoomId) drawGlbRoute();
  }
}

function showConfirmDialog(room) {
  currentConfirmRoom = room;
  const displayName = glbDisambNames[room.id] || room.displayName || room.name;
  if (confirmHeadingEl) confirmHeadingEl.textContent = `You are at ${displayName}`;
  if (notQuiteOptions) notQuiteOptions.classList.add('hidden');
  if (confirmDialogEl) confirmDialogEl.classList.remove('hidden');
}

if (confirmYesBtn) {
  confirmYesBtn.addEventListener('click', () => {
    if (confirmDialogEl) confirmDialogEl.classList.add('hidden');
    hasCompletedStartFlow = true;
    showCompassDialog();
  });
}

if (confirmNotQuiteB) {
  confirmNotQuiteB.addEventListener('click', () => {
    if (notQuiteOptions) notQuiteOptions.classList.toggle('hidden');
  });
}

if (turnLeftBtn) {
  turnLeftBtn.addEventListener('click', () => {
    person.yaw += Math.PI / 2;
    applyCameraFromPerson();
  });
}

if (turnRightBtn) {
  turnRightBtn.addEventListener('click', () => {
    person.yaw -= Math.PI / 2;
    applyCameraFromPerson();
  });
}

if (flipAroundBtn) {
  flipAroundBtn.addEventListener('click', () => {
    person.yaw += Math.PI;
    applyCameraFromPerson();
  });
}

if (repickRoomBtn) {
  repickRoomBtn.addEventListener('click', () => {
    if (confirmDialogEl) confirmDialogEl.classList.add('hidden');
    openWhereModal();
  });
}

function showCompassDialog() {
  if (compassStatusMsg) compassStatusMsg.classList.add('hidden');
  if (compassDialogEl) compassDialogEl.classList.remove('hidden');
}

if (setDirectionBtn) {
  setDirectionBtn.addEventListener('click', async () => {
    if (compassStatusMsg) {
      compassStatusMsg.textContent = 'Aligning direction...';
      compassStatusMsg.classList.remove('hidden');
    }

    setTimeout(() => {
      if (compassStatusMsg) compassStatusMsg.textContent = 'Direction confirmed! Ready to walk.';
      setTimeout(() => {
        if (compassDialogEl) compassDialogEl.classList.add('hidden');
      }, 1000);
    }, 400);
  });
}

if (skipCompassBtn) {
  skipCompassBtn.addEventListener('click', () => {
    if (compassDialogEl) compassDialogEl.classList.add('hidden');
  });
}

// ─── Simplified Mode Switcher (Round FAB in Corner) ──────────────────────────
const modeFabBtn   = document.getElementById('mode-fab-btn');
const modeFabIcon  = document.getElementById('mode-fab-icon');
const modeFabLabel = document.getElementById('mode-fab-label');

function updateModeFab() {
  if (!modeFabBtn) return;
  if (activeMode === 'walk') {
    if (modeFabIcon) modeFabIcon.textContent = '🗺️';
    if (modeFabLabel) modeFabLabel.textContent = 'Map';
    modeFabBtn.title = 'Switch to 3D Map View';
  } else {
    if (modeFabIcon) modeFabIcon.textContent = '🚶';
    if (modeFabLabel) modeFabLabel.textContent = 'Walk';
    modeFabBtn.title = 'Switch to First-Person Walk Mode';
  }
}

function enterMapMode() {
  activeMode = 'map';
  updateModeFab();
  closeWhereModal();
  closeSettings();
  if (confirmDialogEl) confirmDialogEl.classList.add('hidden');
  if (compassDialogEl) compassDialogEl.classList.add('hidden');
  if (imHereModalEl) imHereModalEl.classList.add('hidden');
  if (walkInstructionCard) walkInstructionCard.classList.add('hidden');
  const touchPad = document.getElementById('walk-touch-pad');
  if (touchPad) touchPad.classList.add('hidden');
  clearAllControls();
  stopSimulatingWalking();
  applyMapMode();
}

function enterWalkMode() {
  activeMode = 'walk';
  updateModeFab();
  applyWalkMode();
  const touchPad = document.getElementById('walk-touch-pad');
  if (touchPad) touchPad.classList.remove('hidden');

  const targetId = fromRoomId ||
    glbRooms.find(r => r.type === 'reception')?.id ||
    glbRooms[0]?.id;
  if (targetId) placePersonAtRoom(targetId);

  if (activeRouteWaypoints.length && toRoomId) {
    if (topSearchCard) topSearchCard.classList.add('compact');
    updateGuidanceCard();
  }
}

if (modeFabBtn) {
  modeFabBtn.addEventListener('click', () => {
    if (activeMode === 'map') {
      enterWalkMode();
    } else {
      enterMapMode();
    }
  });
}

function onFromRoomChanged(roomId) {
  fromRoomId = roomId;
  const room = glbRooms.find(r => r.id === roomId);
  const dName = room ? (glbDisambNames[room.id] || room.name) : 'Reception';
  if (currLocationTxt) currLocationTxt.textContent = dName;
  if (activeMode === 'walk' && roomId) placePersonAtRoom(roomId);
  if (fromRoomId && toRoomId) drawGlbRoute();
}

// ─── Single Search Bar ("Where do you want to go?") & UI Elements ───────────
const topSearchCard   = document.getElementById('top-search-card');
const toInput         = document.getElementById('to-input');
const toAutoEl        = document.getElementById('to-autocomplete');
const clearToB        = document.getElementById('clear-to-btn');
const startRouteBtn   = document.getElementById('start-route-btn');
const currLocationTxt = document.getElementById('current-location-text');
const changeLocBtn    = document.getElementById('change-location-btn');

// Settings Elements
const settingsOpenBtn  = document.getElementById('settings-open-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsModal    = document.getElementById('settings-modal');
const voiceToggleBtn   = document.getElementById('voice-toggle-btn');
const modelNewBtn      = document.getElementById('model-new-btn');
const modelOldBtn      = document.getElementById('model-old-btn');
const toiletBtn        = document.getElementById('nearest-toilet-btn');
const stairBtn         = document.getElementById('nearest-stair-btn');
const debugBtn         = document.getElementById('debug-toggle-btn');

let isVoiceEnabled = false;
let lastSpokenText = '';

function speakInstruction(text) {
  if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
  if (!text || text === lastSpokenText) return;
  lastSpokenText = text;
  try {
    window.speechSynthesis.cancel();
    const clean = text.replace(/[\u{1F300}-\u{1F6FF}]/gu, '').replace(/[~•]/g, '').trim();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn('Speech synthesis error:', e);
  }
}

function openSettings() {
  if (settingsModal) settingsModal.classList.remove('hidden');
}

function closeSettings() {
  if (settingsModal) settingsModal.classList.add('hidden');
}

if (settingsOpenBtn) settingsOpenBtn.addEventListener('click', openSettings);
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
if (settingsModal) {
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) closeSettings();
  });
}

function updateSwitch(btn, active) {
  if (!btn) return;
  btn.setAttribute('data-active', active ? 'true' : 'false');
}

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', () => {
    isVoiceEnabled = !isVoiceEnabled;
    updateSwitch(voiceToggleBtn, isVoiceEnabled);
    showBanner(isVoiceEnabled ? '🔊 Voice Guidance ON' : 'Voice Guidance OFF');
    if (isVoiceEnabled && activeRouteInstructions.length) {
      speakInstruction('Voice guidance enabled');
    }
  });
}

if (changeLocBtn) {
  changeLocBtn.addEventListener('click', () => {
    openWhereModal();
  });
}

// Autocomplete for Destination Search Bar
function setupDestinationSearch() {
  function render(q) {
    if (!toAutoEl) return;
    toAutoEl.innerHTML = '';
    const cleanQ = normalizeSearchText(q);

    if (!cleanQ) {
      toAutoEl.classList.add('hidden');
      return;
    }

    const results = searchRooms(cleanQ);
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'autocomplete-empty';
      li.textContent = `No matching rooms found for "${q.trim()}"`;
      toAutoEl.appendChild(li);
      toAutoEl.classList.remove('hidden');
      return;
    }

    results.forEach(room => {
      const li = document.createElement('li');
      li.className = 'autocomplete-item';
      li.innerHTML = `<span>${room.displayName}</span>
                      <span class="autocomplete-item-tag">${room.type}</span>`;
      li.addEventListener('click', () => {
        toInput.value = room.displayName;
        toAutoEl.classList.add('hidden');
        if (clearToB) clearToB.classList.add('visible');
        toRoomId = room.id;
        if (startRouteBtn) startRouteBtn.classList.remove('hidden');
        showBanner(`Selected: ${room.displayName}`);
        drawGlbRoute();
      });
      toAutoEl.appendChild(li);
    });
    toAutoEl.classList.remove('hidden');
  }

  if (toInput) {
    toInput.addEventListener('focus', () => {
      if (topSearchCard && topSearchCard.classList.contains('compact')) {
        topSearchCard.classList.remove('compact');
        if (toRoomId && startRouteBtn) startRouteBtn.classList.remove('hidden');
      }
      render(toInput.value);
    });

    toInput.addEventListener('input', () => {
      if (clearToB) clearToB.classList.toggle('visible', !!toInput.value.trim());
      if (!toInput.value.trim()) {
        toRoomId = null;
        if (startRouteBtn) startRouteBtn.classList.add('hidden');
        clearRoute();
      }
      render(toInput.value);
    });

    // Pressing Enter picks the top result
    toInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const results = searchRooms(toInput.value);
        if (results.length > 0) {
          const room = results[0];
          toInput.value = room.displayName;
          toAutoEl.classList.add('hidden');
          if (clearToB) clearToB.classList.add('visible');
          toRoomId = room.id;
          if (startRouteBtn) startRouteBtn.classList.remove('hidden');
          showBanner(`Selected: ${room.displayName}`);
          drawGlbRoute();
        }
      }
    });
  }

  if (clearToB) {
    clearToB.addEventListener('click', () => {
      clearRoute();
      toInput.value = '';
      clearToB.classList.remove('visible');
      toAutoEl.classList.add('hidden');
      if (startRouteBtn) startRouteBtn.classList.add('hidden');
      if (topSearchCard) topSearchCard.classList.remove('compact');
      toInput.focus();
    });
  }

  document.addEventListener('click', e => {
    if (toInput && toAutoEl && !toInput.contains(e.target) && !toAutoEl.contains(e.target)) {
      toAutoEl.classList.add('hidden');
    }
  });
}

setupDestinationSearch();

// "Start" Button Action
if (startRouteBtn) {
  startRouteBtn.addEventListener('click', () => {
    if (toRoomId) {
      if (activeMode !== 'walk') enterWalkMode();
      if (topSearchCard) topSearchCard.classList.add('compact');
      startRouteBtn.classList.add('hidden');
      drawGlbRoute();
      updateGuidanceCard();
      if (activeRouteInstructions.length) {
        speakInstruction(activeRouteInstructions[0].text);
      }
    }
  });
}

// ─── STAGE 4: Geometry-Based Corridor Walkability & A* Pathfinding ───────────

// Fast Point-in-Polygon check (ray-casting method)
function isPointInPoly(px, pz, pts) {
  if (!pts || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z;
    const xj = pts[j].x, zj = pts[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Check if a point (px, pz) is inside any Corridor_ floor polygon
function isPointInCorridors(px, pz) {
  if (!corridorPolygons.length) return false;
  for (let i = 0; i < corridorPolygons.length; i++) {
    const cp = corridorPolygons[i];
    if (cp.box && (px < cp.box.min.x - 0.05 || px > cp.box.max.x + 0.05 || pz < cp.box.min.z - 0.05 || pz > cp.box.max.z + 0.05)) {
      continue;
    }
    if (isPointInPoly(px, pz, cp.pts)) return true;
  }
  return false;
}

// Distance from point (px, pz) to corridor perimeter edges (approximate distance to nearest wall)
function getDistToCorridorEdges(px, pz) {
  if (!isPointInCorridors(px, pz)) return 0;
  for (let r = 0.2; r <= 2.0; r += 0.2) {
    if (!isPointInCorridors(px + r, pz) || !isPointInCorridors(px - r, pz) ||
        !isPointInCorridors(px, pz + r) || !isPointInCorridors(px, pz - r)) {
      return r;
    }
  }
  return 2.0;
}

function isCellWalkable(wx, wz) {
  if (!corridorGrid) return true;
  const cellSize = CONFIG.GRID_CELL_SIZE || 0.5;
  const c = Math.round((wx - gridMinX) / cellSize);
  const r = Math.round((wz - gridMinZ) / cellSize);
  if (c < 0 || c >= gridCols || r < 0 || r >= gridRows) return false;
  return corridorGrid[r * gridCols + c] === 1;
}

function findNearestWalkableCell(wx, wz) {
  const cellSize = CONFIG.GRID_CELL_SIZE || 0.5;
  let c = Math.round((wx - gridMinX) / cellSize);
  let r = Math.round((wz - gridMinZ) / cellSize);
  c = Math.max(0, Math.min(gridCols - 1, c));
  r = Math.max(0, Math.min(gridRows - 1, r));

  if (corridorGrid && corridorGrid[r * gridCols + c] === 1) {
    return { x: gridMinX + c * cellSize, z: gridMinZ + r * cellSize, c, r };
  }

  for (let rad = 1; rad < 45; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc >= 0 && nc < gridCols && nr >= 0 && nr < gridRows) {
          if (corridorGrid && corridorGrid[nr * gridCols + nc] === 1) {
            return { x: gridMinX + nc * cellSize, z: gridMinZ + nr * cellSize, c: nc, r: nr };
          }
        }
      }
    }
  }
  return { x: wx, z: wz, c, r };
}

function isPositionWalkable(wx, wz) {
  return isCellWalkable(wx, wz);
}

// Raycast against real walls (Walls mesh and Room_ meshes only) horizontally at heights 0.3m to 1.8m
const collisionRaycaster = new THREE.Raycaster();
const collisionRayOrigin = new THREE.Vector3();
const collisionRayDir    = new THREE.Vector3();

function checkRealWallCollision(currX, currZ, targetX, targetZ) {
  const dist = Math.hypot(targetX - currX, targetZ - currZ);
  if (dist < 0.001) return null;
  if (!solidWallMeshes || solidWallMeshes.length === 0) return null;

  const dx = (targetX - currX) / dist;
  const dz = (targetZ - currZ) / dist;
  collisionRayDir.set(dx, 0, dz);

  const radius = CONFIG.PLAYER_COLLISION_RADIUS || 0.25;
  const maxHitDist = dist + radius;

  // Test horizontally at heights between 0.3m and 1.8m above floor
  const testHeights = [0.4, 1.0, 1.6];
  for (let i = 0; i < testHeights.length; i++) {
    collisionRayOrigin.set(currX, testHeights[i], currZ);
    collisionRaycaster.set(collisionRayOrigin, collisionRayDir);
    collisionRaycaster.near = 0.02;
    collisionRaycaster.far = maxHitDist;

    const hits = collisionRaycaster.intersectObjects(solidWallMeshes, false);
    if (hits.length > 0 && hits[0].distance <= maxHitDist) {
      return hits[0].object.name || 'Wall';
    }
  }

  return null;
}

function canMoveTo(currX, currZ, targetX, targetZ) {
  // (a) Must be inside the walkable grid
  if (!isCellWalkable(targetX, targetZ)) {
    return { ok: false, reason: 'outside walkable grid' };
  }
  // (b) Must not collide with solid Walls or Room_ meshes
  const hitObj = checkRealWallCollision(currX, currZ, targetX, targetZ);
  if (hitObj) {
    return { ok: false, reason: hitObj };
  }
  return { ok: true, reason: null };
}

function updateDebugBar() {
  if (!isDebugMode || !debugBlockedBar || !debugBlockedReason) return;

  const heldList = [];
  if (heldKeys.size > 0) heldList.push(...heldKeys);
  if (heldPointerButtons.size > 0) heldList.push(...heldPointerButtons);
  const heldText = heldList.length > 0 ? heldList.join(', ') : 'none';

  const badge = debugBlockedBar.querySelector('.debug-badge');
  if (currentBlockedReason) {
    debugBlockedBar.classList.remove('hidden');
    debugBlockedReason.textContent = `held: ${heldText} | BLOCKED: ${currentBlockedReason}`;
    if (badge) {
      badge.textContent = 'BLOCKED';
      badge.style.background = '#dc2626';
    }
  } else {
    debugBlockedBar.classList.remove('hidden');
    debugBlockedReason.textContent = `held: ${heldText}`;
    if (badge) {
      badge.textContent = 'DEBUG';
      badge.style.background = '#2563eb';
    }
  }
}

function setDebugBlocked(reason) {
  currentBlockedReason = reason;
  if (isDebugMode) {
    updateDebugBar();
  }
}

function clearAllControls() {
  heldKeys.clear();
  heldPointerButtons.clear();
  document.querySelectorAll('.walk-touch-btn').forEach(btn => btn.classList.remove('active'));
  lastControlEventTime = performance.now();
  if (isDebugMode) {
    updateDebugBar();
  }
}

// Wall-sliding player movement: try (nx, nz), then slide along X, then slide along Z
function tryMovePerson(currX, currZ, dx, dz) {
  const nx = currX + dx;
  const nz = currZ + dz;

  // 1. Try full (nx, nz)
  const full = canMoveTo(currX, currZ, nx, nz);
  if (full.ok) {
    person.x = nx;
    person.z = nz;
    setDebugBlocked(null);
    return true;
  }

  const primaryBlockedReason = full.reason;

  // 2. Slide along X only
  if (dx !== 0) {
    const xMove = canMoveTo(currX, currZ, nx, currZ);
    if (xMove.ok) {
      person.x = nx;
      setDebugBlocked(null);
      return true;
    }
  }

  // 3. Slide along Z only
  if (dz !== 0) {
    const zMove = canMoveTo(currX, currZ, currX, nz);
    if (zMove.ok) {
      person.z = nz;
      setDebugBlocked(null);
      return true;
    }
  }

  // Fully blocked
  setDebugBlocked(primaryBlockedReason);
  return false;
}

// Initialize 0.5m grid from Corridor_ floor meshes, connect pieces < 1m, and close gaps
function initCorridorGrid(corridors) {
  gridMinX = Infinity; gridMaxX = -Infinity;
  gridMinZ = Infinity; gridMaxZ = -Infinity;

  corridorPolygons.forEach(cp => {
    cp.pts.forEach(p => {
      if (p.x < gridMinX) gridMinX = p.x;
      if (p.x > gridMaxX) gridMaxX = p.x;
      if (p.z < gridMinZ) gridMinZ = p.z;
      if (p.z > gridMaxZ) gridMaxZ = p.z;
    });
  });

  gridMinX = Math.floor(gridMinX - 1);
  gridMaxX = Math.ceil(gridMaxX + 1);
  gridMinZ = Math.floor(gridMinZ - 1);
  gridMaxZ = Math.ceil(gridMaxZ + 1);

  const cellSize = CONFIG.GRID_CELL_SIZE || 0.5;
  gridCols = Math.round((gridMaxX - gridMinX) / cellSize);
  gridRows = Math.round((gridMaxZ - gridMinZ) / cellSize);

  corridorGrid = new Uint8Array(gridCols * gridRows);
  wallDistGrid = new Float32Array(gridCols * gridRows);

  // 1. Base corridor cells directly from Corridor_ floor meshes
  for (let r = 0; r < gridRows; r++) {
    const wz = gridMinZ + r * cellSize;
    for (let c = 0; c < gridCols; c++) {
      const wx = gridMinX + c * cellSize;
      if (isPointInCorridors(wx, wz)) {
        corridorGrid[r * gridCols + c] = 1;
      }
    }
  }

  // 2. Connect Corridor_ pieces that are less than 1m apart (including diagonal wings)
  for (let i = 0; i < corridorPolygons.length; i++) {
    for (let j = i + 1; j < corridorPolygons.length; j++) {
      const c1 = corridorPolygons[i];
      const c2 = corridorPolygons[j];
      const closePairs = [];
      for (const p1 of c1.pts) {
        for (const p2 of c2.pts) {
          const d = Math.hypot(p1.x - p2.x, p1.z - p2.z);
          if (d < 1.0) closePairs.push({ p1, p2, d });
        }
      }
      closePairs.forEach(({ p1, p2, d }) => {
        const steps = Math.ceil(d / (cellSize * 0.5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const bx = p1.x + (p2.x - p1.x) * t;
          const bz = p1.z + (p2.z - p1.z) * t;
          const gc = Math.round((bx - gridMinX) / cellSize);
          const gr = Math.round((bz - gridMinZ) / cellSize);
          if (gc >= 0 && gc < gridCols && gr >= 0 && gr < gridRows) {
            corridorGrid[gr * gridCols + gc] = 1;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nc = gc + dc, nr = gr + dr;
                if (nc >= 0 && nc < gridCols && nr >= 0 && nr < gridRows) {
                  corridorGrid[nr * gridCols + nc] = 1;
                }
              }
            }
          }
        }
      });
    }
  }

  // Helper: check if point is inside courtyard or room interior
  function isInsideRoomOrCourtyard(wx, wz) {
    for (let i = 0; i < courtyardBoxes.length; i++) {
      const cb = courtyardBoxes[i];
      if (wx >= cb.min.x && wx <= cb.max.x && wz >= cb.min.z && wz <= cb.max.z) return true;
    }
    for (let i = 0; i < glbRooms.length; i++) {
      const r = glbRooms[i];
      if (r.poly && isPointInPoly(wx, wz, r.poly)) {
        if (r.door && Math.hypot(wx - r.door.x, wz - r.door.z) <= 0.8) continue;
        return true;
      }
    }
    return false;
  }

  // 3. Close small holes and thin gaps (fill cells that are walkable on both sides within 0.5 m = 1 cell)
  for (let pass = 0; pass < 2; pass++) {
    const toFill = [];
    for (let r = 1; r < gridRows - 1; r++) {
      const wz = gridMinZ + r * cellSize;
      for (let c = 1; c < gridCols - 1; c++) {
        const idx = r * gridCols + c;
        if (corridorGrid[idx] === 1) continue;
        const wx = gridMinX + c * cellSize;
        if (isInsideRoomOrCourtyard(wx, wz)) continue;

        const left   = corridorGrid[r * gridCols + (c - 1)] === 1;
        const right  = corridorGrid[r * gridCols + (c + 1)] === 1;
        const top    = corridorGrid[(r - 1) * gridCols + c] === 1;
        const bottom = corridorGrid[(r + 1) * gridCols + c] === 1;
        const tl     = corridorGrid[(r - 1) * gridCols + (c - 1)] === 1;
        const br     = corridorGrid[(r + 1) * gridCols + (c + 1)] === 1;
        const tr     = corridorGrid[(r - 1) * gridCols + (c + 1)] === 1;
        const bl     = corridorGrid[(r + 1) * gridCols + (c - 1)] === 1;

        if ((left && right) || (top && bottom) || (tl && br) || (tr && bl)) {
          toFill.push(idx);
        }
      }
    }
    toFill.forEach(idx => { corridorGrid[idx] = 1; });
  }

  // 4. Ensure door access points are marked walkable
  glbRooms.forEach(room => {
    if (room.door) {
      const dx = room.door.x + room.door.normal.x * 0.45;
      const dz = room.door.z + room.door.normal.z * 0.45;
      const c = Math.round((dx - gridMinX) / cellSize);
      const r = Math.round((dz - gridMinZ) / cellSize);
      if (c >= 0 && c < gridCols && r >= 0 && r < gridRows) {
        corridorGrid[r * gridCols + c] = 1;
      }
    }
  });

  // 5. Build wallDistGrid and collect final walkable cells
  const finalWalkableCells = [];
  for (let r = 0; r < gridRows; r++) {
    const wz = gridMinZ + r * cellSize;
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      if (corridorGrid[idx] === 1) {
        const wx = gridMinX + c * cellSize;
        finalWalkableCells.push({ x: wx, z: wz });
        let minD = 2.0;
        for (let dr = -3; dr <= 3; dr++) {
          for (let dc = -3; dc <= 3; dc++) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows || corridorGrid[nr * gridCols + nc] !== 1) {
              const d = Math.hypot(dc, dr) * cellSize;
              if (d < minD) minD = d;
            }
          }
        }
        wallDistGrid[idx] = minD;
      }
    }
  }

  // 6. Make "Show walkable" draw the final grid after these fixes
  buildWalkableGridMesh(finalWalkableCells);

  // 7. Make sure start position is inside a walkable cell
  if (!isCellWalkable(person.x, person.z)) {
    const snapped = findNearestWalkableCell(person.x, person.z);
    person.x = snapped.x;
    person.z = snapped.z;
  }
}

function buildWalkableGridMesh(cells) {
  while (grp.walkableArea.children.length) {
    const ch = grp.walkableArea.children[0];
    grp.walkableArea.remove(ch);
    if (ch.geometry) ch.geometry.dispose();
  }

  if (!cells || !cells.length) return;

  const cellSize = CONFIG.GRID_CELL_SIZE || 0.5;
  const planeGeo = new THREE.PlaneGeometry(cellSize * 0.92, cellSize * 0.92);
  planeGeo.rotateX(-Math.PI / 2);

  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const instMesh = new THREE.InstancedMesh(planeGeo, planeMat, cells.length);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < cells.length; i++) {
    dummy.position.set(cells[i].x, 0.025, cells[i].z);
    dummy.updateMatrix();
    instMesh.setMatrixAt(i, dummy.matrix);
  }

  instMesh.instanceMatrix.needsUpdate = true;
  grp.walkableArea.add(instMesh);
}

// A* pathfinding strictly on shrunk corridor grid with centerline bias
function findAStarRoute(startPt, endPt) {
  if (!corridorGrid) return [startPt, endPt];

  const startCell = findNearestWalkableCell(startPt.x, startPt.z);
  const endCell   = findNearestWalkableCell(endPt.x, endPt.z);

  const startIdx = startCell.r * gridCols + startCell.c;
  const endIdx   = endCell.r * gridCols + endCell.c;

  if (startIdx === endIdx) {
    return [
      { x: startPt.x, z: startPt.z },
      { x: endPt.x, z: endPt.z }
    ];
  }

  const cellSize = CONFIG.GRID_CELL_SIZE || 0.5;
  const openSet = new Set([startIdx]);
  const cameFrom = new Int32Array(gridCols * gridRows).fill(-1);
  const gScore = new Float32Array(gridCols * gridRows).fill(Infinity);
  const fScore = new Float32Array(gridCols * gridRows).fill(Infinity);

  gScore[startIdx] = 0;
  fScore[startIdx] = Math.hypot(startCell.c - endCell.c, startCell.r - endCell.r);

  const dCols = [ 0,  1,  0, -1,  1,  1, -1, -1];
  const dRows = [-1,  0,  1,  0, -1,  1,  1, -1];
  const costs = [ 1,  1,  1,  1, 1.414, 1.414, 1.414, 1.414];

  let iterations = 0;
  while (openSet.size > 0 && iterations < 45000) {
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
      const pathIndices = [];
      let curr = currentIdx;
      while (curr !== -1) {
        pathIndices.push(curr);
        curr = cameFrom[curr];
      }
      pathIndices.reverse();

      const rawWaypoints = pathIndices.map(idx => ({
        x: gridMinX + (idx % gridCols) * cellSize,
        z: gridMinZ + Math.floor(idx / gridCols) * cellSize
      }));

      rawWaypoints.unshift({ x: startPt.x, z: startPt.z });
      rawWaypoints.push({ x: endPt.x, z: endPt.z });

      return smoothRoutePath(rawWaypoints);
    }

    openSet.delete(currentIdx);
    const currC = currentIdx % gridCols;
    const currR = Math.floor(currentIdx / gridCols);

    for (let i = 0; i < 8; i++) {
      const nc = currC + dCols[i];
      const nr = currR + dRows[i];
      if (nc < 0 || nc >= gridCols || nr < 0 || nr >= gridRows) continue;
      const nIdx = nr * gridCols + nc;
      if (corridorGrid[nIdx] !== 1) continue;

      if (i >= 4) {
        if (corridorGrid[currR * gridCols + nc] !== 1 || corridorGrid[nr * gridCols + currC] !== 1) continue;
      }

      // Centerline bias: penalize cells close to walls, favor center of corridor
      const distToWall = wallDistGrid ? wallDistGrid[nIdx] : 1.0;
      const centerPenalty = Math.max(0, 1.4 - distToWall) * 1.5;

      const tentativeG = gScore[currentIdx] + costs[i] + centerPenalty;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        const h = Math.hypot(nc - endCell.c, nr - endCell.r);
        fScore[nIdx] = tentativeG + h;
        openSet.add(nIdx);
      }
    }
  }

  return [startPt, endPt];
}

// Line of sight check ensures path never cuts corners closer than 0.35m to walls
function lineOfSightCheck(p1, p2) {
  const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const steps = Math.ceil(dist / 0.25);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const wx = p1.x + (p2.x - p1.x) * t;
    const wz = p1.z + (p2.z - p1.z) * t;
    if (!isPositionWalkable(wx, wz, 0.35)) return false;
  }
  return true;
}

function smoothRoutePath(points) {
  if (points.length <= 2) return points;
  const result = [points[0]];
  let curr = 0;
  while (curr < points.length - 1) {
    let furthest = curr + 1;
    for (let next = points.length - 1; next > curr + 1; next--) {
      if (lineOfSightCheck(points[curr], points[next])) {
        furthest = next;
        break;
      }
    }
    result.push(points[furthest]);
    curr = furthest;
  }
  return result;
}

function pointToSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function buildTurnByTurnInstructions(waypoints, toRoom) {
  if (!waypoints || waypoints.length < 2) return [];

  const instructions = [];
  const stepLen = CONFIG.STEP_LENGTH_METERS || 0.7;
  const destName = toRoom ? (glbDisambNames[toRoom.id] || toRoom.name) : 'Destination';

  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const legDist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(1, Math.round(legDist / stepLen));

    let text = '';
    let icon = '⬆️';
    let turnDir = 'straight';

    if (i === waypoints.length - 2) {
      text = `Walk straight about ${steps} steps to ${destName}`;
      icon = '🏁';
    } else {
      const p3 = waypoints[i + 2];
      const v1x = p2.x - p1.x, v1z = p2.z - p1.z;
      const v2x = p3.x - p2.x, v2z = p3.z - p2.z;
      const cross = v1x * v2z - v1z * v2x;

      if (cross > 0.05) {
        turnDir = 'turn right';
        icon = '➡️';
      } else if (cross < -0.05) {
        turnDir = 'turn left';
        icon = '⬅️';
      } else {
        turnDir = 'continue straight';
        icon = '⬆️';
      }

      let nearestLandmark = null, minD = Infinity;
      glbRooms.forEach(r => {
        if (r.cleanName.toLowerCase().startsWith('courtyard') || r.type === 'void') return;
        const d = Math.hypot(r.x - p2.x, r.y - p2.z);
        if (d < minD) { minD = d; nearestLandmark = r; }
      });

      if (nearestLandmark && minD < 14) {
        const lmName = glbDisambNames[nearestLandmark.id] || nearestLandmark.cleanName;
        text = `Walk straight about ${steps} steps, then ${turnDir} after ${lmName}`;
      } else {
        text = `Walk straight about ${steps} steps, then ${turnDir}`;
      }
    }

    instructions.push({
      text,
      icon,
      turnDir,
      legDist,
      steps,
      waypointIdx: i
    });
  }

  return instructions;
}

function updateGuidanceCard() {
  if (!walkInstructionCard) return;

  if (activeMode !== 'walk' || !activeRouteWaypoints.length || !toRoomId) {
    walkInstructionCard.classList.add('hidden');
    return;
  }

  walkInstructionCard.classList.remove('hidden');

  const toRoom = glbRooms.find(r => r.id === toRoomId);
  const targetPt = toRoom?.door ? { x: toRoom.door.x, z: toRoom.door.z } : (activeRouteWaypoints.length ? activeRouteWaypoints[activeRouteWaypoints.length - 1] : (toRoom ? { x: toRoom.x, z: toRoom.y } : null));
  const distToDest = targetPt ? Math.hypot(targetPt.x - person.x, targetPt.z - person.z) : Infinity;

  if (distToDest <= (CONFIG.ARRIVAL_DISTANCE_THRESHOLD || 1.8) || hasArrivedAtDest) {
    hasArrivedAtDest = true;
    walkInstructionCard.classList.add('arrived');
    const targetRoomName = toRoom ? (glbDisambNames[toRoom.id] || toRoom.name) : 'your destination';
    if (instructionIconEl) instructionIconEl.textContent = '🎉';
    if (instructionTitleEl) instructionTitleEl.textContent = `You have arrived at ${targetRoomName}`;
    if (instructionSubEl) {
      instructionSubEl.innerHTML = `<button id="go-elsewhere-btn" class="go-elsewhere-btn">Go somewhere else</button>`;
      const goBtn = document.getElementById('go-elsewhere-btn');
      if (goBtn) {
        goBtn.onclick = () => {
          clearRoute();
          if (toInput) {
            toInput.value = '';
            toInput.focus();
          }
          if (startRouteBtn) startRouteBtn.classList.add('hidden');
          if (topSearchCard) topSearchCard.classList.remove('compact');
          if (walkInstructionCard) walkInstructionCard.classList.add('hidden');
        };
      }
    }
    speakInstruction(`You have arrived at ${targetRoomName}`);
    return;
  }

  walkInstructionCard.classList.remove('arrived');

  let activeIdx = 0;
  let minLegDist = Infinity;
  for (let i = 0; i < activeRouteWaypoints.length - 1; i++) {
    const p1 = activeRouteWaypoints[i];
    const p2 = activeRouteWaypoints[i + 1];
    const d = pointToSegmentDistance(person.x, person.z, p1.x, p1.z, p2.x, p2.z);
    if (d < minLegDist) {
      minLegDist = d;
      activeIdx = i;
    }
  }

  let remainingDist = 0;
  const pNext = activeRouteWaypoints[activeIdx + 1] || activeRouteWaypoints[activeRouteWaypoints.length - 1];
  remainingDist += Math.hypot(pNext.x - person.x, pNext.z - person.z);
  for (let i = activeIdx + 1; i < activeRouteWaypoints.length - 1; i++) {
    const pa = activeRouteWaypoints[i];
    const pb = activeRouteWaypoints[i + 1];
    remainingDist += Math.hypot(pb.x - pa.x, pb.z - pa.z);
  }

  const remainingSteps = Math.max(1, Math.round(remainingDist / (CONFIG.STEP_LENGTH_METERS || 0.7)));
  const currentInst = activeRouteInstructions[activeIdx] || activeRouteInstructions[activeRouteInstructions.length - 1];
  if (currentInst) {
    if (instructionIconEl) instructionIconEl.textContent = currentInst.icon;
    if (instructionTitleEl) instructionTitleEl.textContent = currentInst.text;
    speakInstruction(currentInst.text);
  }
  if (instructionSubEl) {
    instructionSubEl.textContent = `Distance remaining: ~${remainingDist.toFixed(0)}m • ~${remainingSteps} steps`;
  }
}

function redrawRouteMeshes(waypoints, destDoor) {
  while (grp.route.children.length) grp.route.remove(grp.route.children[0]);
  if (!waypoints || waypoints.length < 2) return;

  const pts3D = waypoints.map(p => new THREE.Vector3(p.x, 0.08, p.z));
  const curve = new THREE.CatmullRomCurve3(pts3D);
  const sampled = curve.getPoints(Math.max(20, waypoints.length * 8));

  // Inner glowing cyan tube
  const innerTubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sampled), sampled.length, 0.22, 8);
  const innerTubeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.95 });
  grp.route.add(new THREE.Mesh(innerTubeGeo, innerTubeMat));

  // Outer soft glow tube (blue)
  const outerTubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sampled), sampled.length, 0.65, 8);
  const outerTubeMat = new THREE.MeshBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.35, depthWrite: false });
  grp.route.add(new THREE.Mesh(outerTubeGeo, outerTubeMat));

  // Pulsing Destination Beacon above destination door
  const ep = destDoor ? { x: destDoor.x, z: destDoor.z } : waypoints[waypoints.length - 1];
  const beaconGroup = new THREE.Group();
  const coneGeo = new THREE.ConeGeometry(0.8, 2.0, 16);
  coneGeo.rotateX(Math.PI);
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xffd600, emissive: 0xff6d00 });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(0, 0, 0);
  beaconGroup.add(cone);

  const ringGeo = new THREE.RingGeometry(0.5, 0.9, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd600, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(0, -3.1, 0);
  beaconGroup.add(ring);

  beaconGroup.position.set(ep.x, 3.2, ep.z);
  grp.route.add(beaconGroup);
  destBeacon = beaconGroup;
}

function drawGlbRoute() {
  while (grp.route.children.length) grp.route.remove(grp.route.children[0]);
  hasArrivedAtDest = false;

  if (!fromRoomId || !toRoomId) {
    activeRouteWaypoints = [];
    activeRouteInstructions = [];
    if (walkInstructionCard) walkInstructionCard.classList.add('hidden');
    return;
  }

  const fromRoom = glbRooms.find(r => r.id === fromRoomId);
  const toRoom   = glbRooms.find(r => r.id === toRoomId);
  if (!fromRoom || !toRoom) return;

  const startPt = fromRoom.door ? { x: fromRoom.door.x, z: fromRoom.door.z } : { x: fromRoom.x, z: fromRoom.y };
  const endPt   = toRoom.door   ? { x: toRoom.door.x,   z: toRoom.door.z }   : { x: toRoom.x,   z: toRoom.y };

  const waypoints = findAStarRoute(startPt, endPt);
  activeRouteWaypoints = waypoints;
  activeRouteInstructions = buildTurnByTurnInstructions(waypoints, toRoom);

  redrawRouteMeshes(waypoints, toRoom.door);

  if (activeMode === 'walk') {
    updateGuidanceCard();
  }
}

const drawSimpleGlbRoute = drawGlbRoute;

function clearRoute() {
  while (grp.route.children.length) grp.route.remove(grp.route.children[0]);
  routeResult = null;
  destBeacon = null;
  toRoomId = null;
  activeRouteWaypoints = [];
  activeRouteInstructions = [];
  hasArrivedAtDest = false;
  if (toInput) toInput.value = '';
  if (clearToB) clearToB.classList.remove('visible');
  if (startRouteBtn) startRouteBtn.classList.add('hidden');
  if (topSearchCard) topSearchCard.classList.remove('compact');
  if (walkInstructionCard) walkInstructionCard.classList.add('hidden');
  stopSimulatingWalking();
}

function findNearest(type) {
  const activeRooms = getActiveRoomList();
  if (!activeRooms.length) return;

  const current = activeRooms.find(r => r.id === fromRoomId) ||
    activeRooms.find(r => r.type === 'reception') ||
    activeRooms[0];
  if (!fromRoomId && current) onFromRoomChanged(current.id);

  const candidates = activeRooms.filter(r => r.id !== fromRoomId && r.type === type);
  if (!candidates.length) {
    showBanner(`No ${type} found in building.`);
    return;
  }

  const startPt = (current && current.door) ? { x: current.door.x, z: current.door.z } : { x: current.x, z: current.y };

  let best = null, bestDist = Infinity;
  candidates.forEach(c => {
    const endPt = c.door ? { x: c.door.x, z: c.door.z } : { x: c.x, z: c.y };
    const approxD = Math.hypot(endPt.x - startPt.x, endPt.z - startPt.z);
    if (approxD < bestDist * 1.5) {
      const path = findAStarRoute(startPt, endPt);
      let d = 0;
      for (let i = 0; i < path.length - 1; i++) {
        d += Math.hypot(path[i+1].x - path[i].x, path[i+1].z - path[i].z);
      }
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  });

  if (best) {
    toRoomId = best.id;
    toInput.value = best.displayName;
    clearToB.classList.add('visible');
    if (startRouteBtn) startRouteBtn.classList.remove('hidden');
    showBanner(`Nearest ${type}: ${best.displayName} (~${bestDist.toFixed(0)}m)`);
    closeSettings();
    drawGlbRoute();
  }
}

if (toiletBtn) toiletBtn.addEventListener('click', () => findNearest('toilet'));
if (stairBtn)  stairBtn.addEventListener('click',  () => findNearest('stair'));

// ─── Tap / Click to Inspect Room ─────────────────────────────────────────────
const roomCard       = document.getElementById('room-card');
const roomNameEl     = document.getElementById('room-name');
const roomTypeEl     = document.getElementById('room-type');
const roomIdEl       = document.getElementById('room-id');
const roomCloseBtn   = document.getElementById('room-card-close');
const cardStartBtn   = document.getElementById('card-set-start-btn');
const cardRouteBtn   = document.getElementById('card-route-here-btn');
let tappedRoom = null;

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

function trySelect(ex, ey) {
  mouse.x = (ex / window.innerWidth)  *  2 - 1;
  mouse.y = (ey / window.innerHeight) * -2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(interactable, true);
  if (!hits.length) return;

  let obj = hits[0].object;
  while (obj && !obj.userData?.name) obj = obj.parent;
  if (!obj?.userData?.name) return;

  tappedRoom = obj.userData;
  const dName = glbDisambNames[tappedRoom.id] || tappedRoom.name;
  roomNameEl.textContent = dName;
  roomTypeEl.textContent = tappedRoom.type;
  roomIdEl.textContent   = `Room: ${tappedRoom.name}`;
  roomCard.classList.remove('hidden');
}

roomCloseBtn.addEventListener('click', () => { tappedRoom = null; roomCard.classList.add('hidden'); });
cardStartBtn.addEventListener('click', () => {
  if (!tappedRoom) return;
  onFromRoomChanged(tappedRoom.id);
  const dName = glbDisambNames[tappedRoom.id] || tappedRoom.name;
  if (currLocationTxt) currLocationTxt.textContent = dName;
  roomCard.classList.add('hidden');
  enterWalkMode();
  placePersonAtRoom(tappedRoom.id, false);
  if (orbitControls?.target) orbitControls.target.set(tappedRoom.cx || 0, 0, tappedRoom.cy || 0);
  showBanner(`Teleported to: ${dName}`);
  if (toRoomId) drawGlbRoute();
});
cardRouteBtn.addEventListener('click', () => {
  if (!tappedRoom) return;
  toRoomId = tappedRoom.id;
  const dName = glbDisambNames[tappedRoom.id] || tappedRoom.name;
  toInput.value = dName;
  clearToB.classList.add('visible');
  if (startRouteBtn) startRouteBtn.classList.remove('hidden');
  roomCard.classList.add('hidden');
  showBanner(`Destination: ${dName}`);
  drawSimpleGlbRoute();
});

// ─── Walk Mode HUD & Sensors ────────────────────────────────────────────────
const walkHudEl          = document.getElementById('walk-hud');
const simulateWalkBtn    = document.getElementById('simulate-walk-btn');
const simulateIconEl     = document.getElementById('simulate-icon');
const simulateLabelEl    = document.getElementById('simulate-label');
const imHereBtn          = document.getElementById('im-here-btn');
const sensorPillEl       = document.getElementById('sensor-pill');
const sensorIndicatorEl  = document.getElementById('sensor-indicator');
const sensorTextEl       = document.getElementById('sensor-text');

const miniMapContainerEl = document.getElementById('mini-map-container');
const miniMapCanvas      = document.getElementById('mini-map-canvas');
const miniMapCtx         = miniMapCanvas ? miniMapCanvas.getContext('2d') : null;
const minimapToggleBtn   = document.getElementById('minimap-toggle-btn');

const imHereModalEl      = document.getElementById('im-here-modal');
const imHereCloseBtn     = document.getElementById('im-here-close-btn');
const imHereListEl       = document.getElementById('im-here-list');

let stepCount          = 0;
let lastStepTime       = 0;
let lastHighMotionTime = 0;
let isSensorsActive    = false;
let isSimulatingWalk   = false;
let simInterval        = null;
let lastPassedDoorId   = null;

function updateSensorPill() {
  if (!sensorTextEl || !sensorIndicatorEl) return;
  if (isSensorsActive) {
    sensorTextEl.textContent = `Sensors: Active (${stepCount} steps)`;
    sensorIndicatorEl.className = 'sensor-dot';
  } else {
    sensorTextEl.textContent = `Sensors: Ready (${stepCount} steps)`;
    sensorIndicatorEl.className = 'sensor-dot inactive';
  }
}

function onStepTaken() {
  const stepDist = 0.75;
  const dx = -Math.sin(person.yaw) * stepDist;
  const dz = -Math.cos(person.yaw) * stepDist;
  tryMovePerson(person.x, person.z, dx, dz);

  applyCameraFromPerson();
  updateSensorPill();
  checkDoorProximity();
}

function checkDoorProximity() {
  if (!glbRooms || !glbRooms.length) return;
  for (const r of glbRooms) {
    const d = Math.hypot(person.x - r.x, person.z - r.y);
    if (d < 4.5 && lastPassedDoorId !== r.id) {
      lastPassedDoorId = r.id;
      showBanner(`Passing ${glbDisambNames[r.id] || r.name}`);
      break;
    }
  }
}

// Phone Step Detection (devicemotion)
window.addEventListener('devicemotion', e => {
  if (activeMode !== 'walk') return;
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc) return;
  const mag = Math.hypot(acc.x || 0, acc.y || 0, acc.z || 0);
  const now = performance.now();

  if (mag > CONFIG.STEP_DETECTION_THRESHOLD) {
    lastHighMotionTime = now;
    if ((now - lastStepTime) > CONFIG.STEP_MIN_INTERVAL_MS) {
      lastStepTime = now;
      stepCount++;
      isSensorsActive = true;
      onStepTaken();
    }
  } else {
    // SENSOR STEPS: If motion stays below the threshold for 1 second, stop moving
    if (lastHighMotionTime > 0 && (now - lastHighMotionTime) >= 1000) {
      if (isSensorsActive) {
        isSensorsActive = false;
        updateSensorPill();
      }
    }
  }
});

// Phone Compass Orientation (deviceorientation)
window.addEventListener('deviceorientation', e => {
  if (activeMode !== 'walk' || isDragging) return;
  let phoneHeading = null;
  if (typeof e.webkitCompassHeading !== 'undefined') {
    phoneHeading = e.webkitCompassHeading;
  } else if (e.alpha !== null) {
    phoneHeading = (360 - e.alpha) % 360;
  }

  if (phoneHeading !== null) {
    isSensorsActive = true;
    updateSensorPill();
    const targetDeg = (phoneHeading - storedCompassOffset + 360) % 360;
    const targetRad = THREE.MathUtils.degToRad(targetDeg);
    const diff = ((targetRad - person.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
    person.yaw += diff * 0.15;
    applyCameraFromPerson();
  }
});

if (sensorPillEl) {
  sensorPillEl.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        await DeviceOrientationEvent.requestPermission();
        await DeviceMotionEvent.requestPermission();
        isSensorsActive = true;
        updateSensorPill();
        showBanner('Phone sensors enabled!');
      } catch (err) {
        showBanner('Sensor permission denied. Using manual controls.');
      }
    } else {
      showBanner('Desktop / standard sensors active.');
    }
  });
}

function toggleSimulateWalking() {
  if (!toRoomId || !activeRouteWaypoints.length) {
    showBanner('Please select From and To rooms to start walking!');
    return;
  }

  isSimulatingWalk = !isSimulatingWalk;
  if (isSimulatingWalk) {
    simWaypointIdx = 1;
    simDistanceTraveled = 0;
    hasArrivedAtDest = false;
    simulateWalkBtn.classList.add('simulating');
    if (simulateIconEl) simulateIconEl.textContent = '⏸';
    if (simulateLabelEl) simulateLabelEl.textContent = 'Walking...';
    showBanner('Walking automatically along corridor route...');
  } else {
    stopSimulatingWalking();
  }
}

function stopSimulatingWalking() {
  isSimulatingWalk = false;
  if (simulateWalkBtn) {
    simulateWalkBtn.classList.remove('simulating');
    if (simulateIconEl) simulateIconEl.textContent = '▶';
    if (simulateLabelEl) simulateLabelEl.textContent = 'Simulate Walking';
  }
}

if (simulateWalkBtn) simulateWalkBtn.addEventListener('click', toggleSimulateWalking);

// "I'm Here" Button & Quick Re-centering Modal
function openImHereModal() {
  imHereModalEl.classList.remove('hidden');
  imHereListEl.innerHTML = '';

  const activeRooms = getActiveRoomList();
  const sorted = activeRooms
    .map(r => {
      const d = Math.hypot(person.x - r.x, person.z - r.y);
      return { room: r, dist: d };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);

  sorted.forEach(({ room, dist }) => {
    const item = document.createElement('div');
    item.className = 'im-here-item';
    const icon = CONFIG.TYPE_ICONS[room.type] || '🚪';
    const name = room.displayName;

    item.innerHTML = `
      <span>${icon} ${name}</span>
      <span class="im-here-dist">~${dist.toFixed(0)}m</span>
    `;

    item.addEventListener('click', () => {
      imHereModalEl.classList.add('hidden');
      placePersonAtRoom(room.id, false);
      showBanner(`Position corrected to ${name}`);
    });

    imHereListEl.appendChild(item);
  });
}

if (imHereBtn) imHereBtn.addEventListener('click', openImHereModal);
if (imHereCloseBtn) imHereCloseBtn.addEventListener('click', () => imHereModalEl.classList.add('hidden'));

// Mini-map Toggle (Tap to hide / show)
let isMiniMapCollapsed = false;
if (miniMapContainerEl) {
  miniMapContainerEl.addEventListener('click', () => {
    isMiniMapCollapsed = !isMiniMapCollapsed;
    miniMapContainerEl.classList.toggle('minimized', isMiniMapCollapsed);
  });
}

// Mini-map 2D Canvas Renderer
function renderMiniMap() {
  if (!miniMapCtx || isMiniMapCollapsed) return;

  const w = miniMapCanvas.width;
  const h = miniMapCanvas.height;
  const ctx = miniMapCtx;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  const s = 1.05;
  const cx = w / 2;
  const cy = h / 2 + 6;

  function toX(wx) { return cx + wx * s; }
  function toY(wz) { return cy + wz * s; }

  // Draw Corridor Floor meshes
  if (corridorBoxes && corridorBoxes.length) {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
    ctx.lineWidth = 1;
    corridorBoxes.forEach(c => {
      const x1 = toX(c.minX);
      const y1 = toY(c.minZ);
      const bw = (c.maxX - c.minX) * s;
      const bh = (c.maxZ - c.minZ) * s;
      ctx.fillRect(x1, y1, bw, bh);
      ctx.strokeRect(x1, y1, bw, bh);
    });
  }

  // Draw Room Outlines from glbRooms
  glbRooms.forEach(r => {
    const rx = toX(r.x);
    const ry = toY(r.y);
    const rw = 6;
    const rh = 6;

    ctx.fillStyle = 'rgba(51, 65, 85, 0.6)';
    ctx.fillRect(rx - rw / 2, ry - rh / 2, rw, rh);
  });

  // Draw active A* Route Polyline in bright cyan
  if (activeRouteWaypoints && activeRouteWaypoints.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(toX(activeRouteWaypoints[0].x), toY(activeRouteWaypoints[0].z));
    for (let i = 1; i < activeRouteWaypoints.length; i++) {
      ctx.lineTo(toX(activeRouteWaypoints[i].x), toY(activeRouteWaypoints[i].z));
    }
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Destination beacon gold dot
    const endPt = activeRouteWaypoints[activeRouteWaypoints.length - 1];
    ctx.beginPath();
    ctx.arc(toX(endPt.x), toY(endPt.z), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw User Position & Direction Cone
  const ux = toX(person.x);
  const uy = toY(person.z);

  ctx.save();
  ctx.translate(ux, uy);
  const coneAngle = person.yaw + Math.PI / 2;
  const fovSpan = 0.55;
  const coneDist = 18;

  // Direction Cone
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, coneDist, coneAngle - fovSpan, coneAngle + fovSpan);
  ctx.closePath();
  ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.fill();

  // Blue Dot
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#0284c7';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ─── Input Events (WASD, Set Tracking & On-Screen Touch Controls) ────────────
function getMovementKeyName(e) {
  const k = e.key;
  const c = e.code;
  if (k === 'w' || k === 'W' || k === 'ArrowUp' || c === 'KeyW' || c === 'ArrowUp') return 'W';
  if (k === 's' || k === 'S' || k === 'ArrowDown' || c === 'KeyS' || c === 'ArrowDown') return 'S';
  if (k === 'a' || k === 'A' || k === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowLeft') return 'A';
  if (k === 'd' || k === 'D' || k === 'ArrowRight' || c === 'KeyD' || c === 'ArrowRight') return 'D';
  return null;
}

window.addEventListener('keydown', e => {
  if (activeMode !== 'walk') return;
  if (document.activeElement?.tagName === 'INPUT') return;
  const keyName = getMovementKeyName(e);
  if (keyName) {
    heldKeys.add(keyName);
    lastControlEventTime = performance.now();
    if (isDebugMode) updateDebugBar();
  }
});

window.addEventListener('keyup', e => {
  const keyName = getMovementKeyName(e);
  if (keyName) {
    heldKeys.delete(keyName);
  } else {
    // If an untracked key or modifier is released, clear all
    clearAllControls();
  }
  lastControlEventTime = performance.now();
  if (isDebugMode) updateDebugBar();
});

// Clear ALL pressed keys when window loses focus, tab becomes hidden, or page loses pointer focus
window.addEventListener('blur', clearAllControls);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearAllControls();
});
window.addEventListener('pagehide', clearAllControls);
document.addEventListener('pointerleave', e => {
  if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) {
    clearAllControls();
  }
});

// ON-SCREEN BUTTONS AND TOUCH: Pointer events with setPointerCapture
function setupWalkTouchControls() {
  const touchPad = document.getElementById('walk-touch-pad');
  if (!touchPad) return;
  const buttons = touchPad.querySelectorAll('.walk-touch-btn');
  buttons.forEach(btn => {
    const controlName = btn.dataset.control;
    let heartbeat = null;

    const onStart = e => {
      e.preventDefault();
      e.stopPropagation();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {}
      heldPointerButtons.add(controlName);
      btn.classList.add('active');
      lastControlEventTime = performance.now();
      if (isDebugMode) updateDebugBar();

      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (!heldPointerButtons.has(controlName)) {
          clearInterval(heartbeat);
          return;
        }
        try {
          btn.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: e.pointerId }));
        } catch (err) {}
        lastControlEventTime = performance.now();
      }, 100);
    };

    const onStop = e => {
      clearInterval(heartbeat);
      try {
        if (btn.hasPointerCapture(e.pointerId)) {
          btn.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
      heldPointerButtons.delete(controlName);
      btn.classList.remove('active');
      lastControlEventTime = performance.now();
      if (isDebugMode) updateDebugBar();
    };

    btn.addEventListener('pointerdown', onStart);
    btn.addEventListener('pointerup', onStop);
    btn.addEventListener('pointercancel', onStop);
    btn.addEventListener('pointerleave', onStop);
    btn.addEventListener('lostpointercapture', onStop);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });
}
setupWalkTouchControls();

window.addEventListener('pointerdown', e => {
  if (e.target.closest('#walk-touch-pad') || e.target.closest('button') || e.target.closest('input')) return;
  isDragging     = true;
  dragStartX     = e.clientX;
  dragStartY     = e.clientY;
  pointerDownTime = performance.now();
});

window.addEventListener('pointermove', e => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  if (activeMode === 'walk') {
    person.yaw -= dx * 0.004;
    person.pitch -= dy * 0.004;
    person.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, person.pitch));
  }
});

window.addEventListener('pointerup', e => {
  const wasDrag  = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 6;
  const wasQuick = (performance.now() - pointerDownTime) < 350;
  isDragging = false;

  if (!wasDrag && wasQuick) {
    trySelect(e.clientX, e.clientY);
  }
});

window.addEventListener('pointercancel', () => {
  isDragging = false;
});

const resetViewBtn = document.getElementById('reset-view-btn');
if (resetViewBtn) {
  resetViewBtn.addEventListener('click', () => {
  if (activeMode === 'walk') {
    const targetRoomId = fromRoomId || glbRooms.find(r => r.type === 'reception')?.id || glbRooms[0]?.id;
    if (targetRoomId) {
      placePersonAtRoom(targetRoomId);
    } else {
      const snapped = findNearestWalkableCell(0, -40);
      person.x = snapped.x; person.z = snapped.z; person.yaw = 0; person.pitch = 0;
      applyCameraFromPerson();
    }
  } else {
    orbitControls.reset();
    camera.position.copy(GLB_CAM_POS);
    orbitControls.target.copy(GLB_CAM_TARGET);
  }
  });
}

// ─── Graphics Quality Toggle ────────────────────────────────────────────────
const qualityToggleBtn = document.getElementById('quality-toggle-btn');
const qualityTextEl    = document.getElementById('quality-text');
let isLowQuality       = false;

function toggleQuality() {
  isLowQuality = !isLowQuality;
  if (isLowQuality) {
    renderer.setPixelRatio(1.0);
    if (qualityTextEl) qualityTextEl.textContent = 'Low Q (Fast)';
    if (qualityToggleBtn) qualityToggleBtn.classList.add('active');
    showBanner('⚡ Switched to Low Quality (Smooth Phone Mode)');
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (qualityTextEl) qualityTextEl.textContent = 'High Q';
    if (qualityToggleBtn) qualityToggleBtn.classList.remove('active');
    showBanner('✨ Switched to High Quality');
  }
}

if (qualityToggleBtn) {
  qualityToggleBtn.addEventListener('click', toggleQuality);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(isLowQuality ? 1.0 : Math.min(window.devicePixelRatio, 2));
});

// ─── Room Door & Sign Board Builder ─────────────────────────────────────────
// ─── Room Door & Red Number Plate Builder ────────────────────────────────────
function createRedDoorPlateTexture(roomName) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Red plate background
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.roundRect(6, 6, 500, 116, 12);
  ctx.fill();

  // Darker red border
  ctx.strokeStyle = '#991b1b';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Inner subtle border highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(12, 12, 488, 104, 8);
  ctx.stroke();

  // Crisp white room name text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = 34;
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;

  while (ctx.measureText(roomName).width > 470 && fontSize > 16) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
  }
  ctx.fillText(roomName, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Extract world-space 2D polygon vertices of a room mesh
function getRoomPolygon(mesh) {
  const posAttr = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    v.applyMatrix4(mesh.matrixWorld);
    if (!pts.some(p => Math.hypot(p.x - v.x, p.z - v.z) < 0.05)) {
      pts.push({ x: v.x, z: v.z });
    }
  }
  let cx = 0, cz = 0;
  pts.forEach(p => { cx += p.x; cz += p.z; });
  cx /= pts.length; cz /= pts.length;
  pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
  return { pts, cx, cz };
}

// Find the wall edge of the room that directly faces the nearest corridor
function findRoomCorridorFacing(room, corridors) {
  const { pts, cx, cz } = getRoomPolygon(room.mesh);
  let bestEdge = null;
  let bestDist = Infinity;

  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (len < 0.5) continue; // skip negligible bevels

    const mx = (p1.x + p2.x) / 2;
    const mz = (p1.z + p2.z) / 2;
    const wx = (p2.x - p1.x) / len;
    const wz = (p2.z - p1.z) / len;
    let nx = wz;
    let nz = -wx;
    // Check dot product with (M - C) to ensure outward normal pointing away from room
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }

    // Test a point 0.35m outside the wall
    const testX = mx + nx * 0.35;
    const testZ = mz + nz * 0.35;
    let d = Infinity;
    if (isPointInCorridors(testX, testZ)) {
      d = 0;
    } else {
      // Distance to nearest corridor polygon edge
      for (let c = 0; c < corridorPolygons.length; c++) {
        const poly = corridorPolygons[c].pts;
        for (let j = 0; j < poly.length; j++) {
          const cp1 = poly[j];
          const cp2 = poly[(j + 1) % poly.length];
          const segDist = pointToSegmentDistance(testX, testZ, cp1.x, cp1.z, cp2.x, cp2.z);
          if (segDist < d) d = segDist;
        }
      }
    }

    if (d < bestDist) {
      bestDist = d;
      bestEdge = { p1, p2, len, mx, mz, nx, nz, d };
    }
  }

  // Size rule: 0.8m wide if wall < 1.4m, otherwise exactly 1.0m wide
  const doorWidth = bestEdge.len < 1.4 ? 0.8 : 1.0;

  // Position rule: centred on wall, pushed out of wall by exactly 2 cm (0.02m) so it doesn't sink in
  const doorPt = {
    x: bestEdge.mx + bestEdge.nx * 0.02,
    y: 0,
    z: bestEdge.mz + bestEdge.nz * 0.02
  };
  const normal = { x: bestEdge.nx, z: bestEdge.nz };
  // Parallel to wall, facing into corridor, zero tilt (pitch=0, roll=0)
  const rotY = Math.atan2(bestEdge.nx, bestEdge.nz);

  return {
    pt: doorPt,
    doorPt,
    normal,
    rotY,
    wallLength: bestEdge.len,
    doorWidth,
    distToCorridor: bestEdge.d
  };
}

// Flat, thin panel (5 cm thick) flush on wall surface, 1.0m (or 0.8m) x 2.2m, 8cm brown frame, red plate
function createRoomDoor(room, doorInfo, doorTexture) {
  const doorGroup = new THREE.Group();
  doorGroup.name = `Door_${room.cleanName}`;
  doorGroup.userData = { isDoor: true, isSolid: false, roomId: room.id };

  const width = doorInfo.doorWidth;
  const height = 2.2;        // exactly 2.2 m tall
  const thickness = 0.05;    // exactly 5 cm thick panel

  // 1. Flat, closed door panel lying flush against the wall surface
  const panelGeo = new THREE.BoxGeometry(width, height, thickness);
  const panelMat = new THREE.MeshStandardMaterial({
    map: doorTexture,
    roughness: 0.45,
    metalness: 0.05
  });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  // Bottom edge exactly on floor (y = 0 to 2.20), back face flush at z = 0, front face at z = 0.05
  panel.position.set(0, height / 2, thickness / 2);
  doorGroup.add(panel);

  // 2. Door Frame: 8 cm (0.08 m) around the door
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3d2314, // brown wooden frame
    roughness: 0.55,
    metalness: 0.1
  });
  const frameWidth = 0.08;
  const frameDepth = 0.06;

  // Left frame post
  const postHeight = height + frameWidth; // 2.28 m tall
  const postGeo = new THREE.BoxGeometry(frameWidth, postHeight, frameDepth);
  const leftPost = new THREE.Mesh(postGeo, frameMat);
  leftPost.position.set(-(width / 2 + frameWidth / 2), postHeight / 2, frameDepth / 2);
  doorGroup.add(leftPost);

  // Right frame post
  const rightPost = new THREE.Mesh(postGeo, frameMat);
  rightPost.position.set(width / 2 + frameWidth / 2, postHeight / 2, frameDepth / 2);
  doorGroup.add(rightPost);

  // Top frame lintel
  const lintelWidth = width + frameWidth * 2;
  const lintelGeo = new THREE.BoxGeometry(lintelWidth, frameWidth, frameDepth);
  const lintel = new THREE.Mesh(lintelGeo, frameMat);
  lintel.position.set(0, height + frameWidth / 2, frameDepth / 2);
  doorGroup.add(lintel);

  // 3. Small red number plate with the room name just above the door
  const plateWidth = Math.min(width, 0.88);
  const plateHeight = 0.22;
  const plateDepth = 0.02;

  const plateTex = createRedDoorPlateTexture(room.displayName || room.cleanName);
  const plateGeo = new THREE.BoxGeometry(plateWidth, plateHeight, plateDepth);
  const redMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.5 });
  const plateMaterials = [
    redMat, // right
    redMat, // left
    redMat, // top
    redMat, // bottom
    new THREE.MeshBasicMaterial({ map: plateTex }), // front face (red with white text)
    redMat  // back
  ];
  const plate = new THREE.Mesh(plateGeo, plateMaterials);
  plate.position.set(0, height + frameWidth + plateHeight / 2 + 0.04, plateDepth / 2 + 0.01);
  doorGroup.add(plate);

  // Orient door group in world space: exactly parallel to the wall, facing into the corridor
  doorGroup.position.set(doorInfo.doorPt.x, 0, doorInfo.doorPt.z);
  doorGroup.rotation.set(0, doorInfo.rotY, 0, 'YXZ');

  // Interactive on tap/click (room selection), but NEVER solid (not in solidWallMeshes)
  doorGroup.traverse(child => {
    if (child.isMesh) {
      child.userData = room.mesh.userData;
      interactable.push(child);
    }
  });

  return doorGroup;
}

function addDoorMarker(doorPt) {
  const sphereGeo = new THREE.SphereGeometry(0.22, 12, 12);
  const sphereMat = new THREE.MeshLambertMaterial({
    color: 0xef4444,
    emissive: 0xdc2626
  });
  const marker = new THREE.Mesh(sphereGeo, sphereMat);
  marker.position.set(doorPt.x, 2.6, doorPt.z);
  grp.doors.add(marker);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), sphereMat);
  post.position.set(doorPt.x, 1.3, doorPt.z);
  grp.doors.add(post);
}

let roomsWithDoorsList = [];

function buildAllRoomDoors(corridors) {
  while (roomDoorsGroup.children.length) roomDoorsGroup.remove(roomDoorsGroup.children[0]);
  while (grp.doors.children.length) grp.doors.remove(grp.doors.children[0]);
  roomsWithDoorsList = [];

  glbRooms.forEach(room => {
    const rawName = (room.rawName || room.name || '').toLowerCase();
    // ONLY ONE DOOR PER ROOM, and none for Courtyard_, Stair, Ground, Paved Footprint, Main Entry, Reception
    if (
      rawName.includes('courtyard') ||
      rawName.includes('stair') ||
      rawName.includes('ground') ||
      rawName.includes('paved') ||
      rawName.includes('main entry') ||
      rawName.includes('reception') ||
      rawName.includes('foyer') ||
      room.type === 'reception' ||
      room.type === 'stair' ||
      room.type === 'void'
    ) {
      room.door = null;
      return;
    }

    const doorInfo = findRoomCorridorFacing(room, corridors);
    room.door = {
      x: doorInfo.doorPt.x,
      z: doorInfo.doorPt.z,
      normal: doorInfo.normal,
      rotY: doorInfo.rotY,
      width: doorInfo.doorWidth,
      wallLength: doorInfo.wallLength,
      distToCorridor: doorInfo.distToCorridor
    };

    const doorMesh = createRoomDoor(room, doorInfo, doorTexture);
    roomDoorsGroup.add(doorMesh);

    addDoorMarker(doorInfo.doorPt);
    roomsWithDoorsList.push(room.displayName || room.cleanName);
  });

  console.log(`Doors built for ${roomsWithDoorsList.length} rooms:`, roomsWithDoorsList);
}

// "Show Doors" Toggle Handler
const showDoorsBtn      = document.getElementById('show-doors-btn');
const walkShowDoorsBtn  = document.getElementById('walk-show-doors-btn');
const walkShowDoorsText = document.getElementById('walk-show-doors-text');

function toggleShowDoors() {
  grp.doors.visible = !grp.doors.visible;
  if (showDoorsBtn) showDoorsBtn.classList.toggle('active', grp.doors.visible);
  if (walkShowDoorsBtn) walkShowDoorsBtn.classList.toggle('active', grp.doors.visible);
  if (walkShowDoorsText) {
    walkShowDoorsText.textContent = grp.doors.visible ? 'Hide doors' : 'Show doors';
  }
  showBanner(grp.doors.visible ? '🔴 Red door markers visible' : 'Door markers hidden');
  updateSwitch(showDoorsBtn, grp.doors.visible);
}

if (showDoorsBtn) showDoorsBtn.addEventListener('click', toggleShowDoors);

// "Debug Collision" Toggle Handler
function toggleDebugMode() {
  isDebugMode = !isDebugMode;
  updateSwitch(debugBtn, isDebugMode);
  if (isDebugMode) {
    updateDebugBar();
  } else if (debugBlockedBar) {
    debugBlockedBar.classList.add('hidden');
  }
  showBanner(isDebugMode ? '🐛 Debug ON (held controls & obstacles)' : 'Debug OFF');
}

if (debugBtn) debugBtn.addEventListener('click', toggleDebugMode);

// "Show Walkable Area" Toggle Handler
function toggleShowWalkableArea() {
  grp.walkableArea.visible = !grp.walkableArea.visible;
  updateSwitch(showWalkableBtn, grp.walkableArea.visible);
  showBanner(grp.walkableArea.visible ? '🟢 Walkable corridor cells visible (green)' : 'Walkable area hidden');
}

if (showWalkableBtn) showWalkableBtn.addEventListener('click', toggleShowWalkableArea);

// ─── Load GLB Model & Start ─────────────────────────────────────────────────
function loadGlbModel() {
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingProgress = document.getElementById('loading-progress');

  // Safety timer: hide loading overlay after 4 seconds no matter what
  setTimeout(() => {
    if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
      loadingOverlay.classList.add('hidden');
    }
  }, 4000);

  const loader = new GLTFLoader();
  const primaryUrl = './campus_ground_floor_edited__1_.glb';

  loader.load(
    primaryUrl,
    gltf => {
      try {
        onGlbModelLoaded(gltf);
      } catch (err) {
        console.error('Error processing campus model:', err);
      } finally {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
      }
    },
    xhr => {
      if (xhr.total && xhr.total > 0 && loadingProgress) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loadingProgress.textContent = `Loading Campus 3D Model (${pct}%)...`;
      }
    },
    err => {
      console.warn('Primary GLB load failed, trying fallback...', err);
      loader.load(
        './campus_ground_floor.glb',
        gltf => {
          try {
            onGlbModelLoaded(gltf);
          } catch (err2) {
            console.error('Error processing fallback model:', err2);
          } finally {
            if (loadingOverlay) loadingOverlay.classList.add('hidden');
          }
        },
        null,
        err2 => {
          console.error('All GLB loads failed:', err2);
          if (loadingProgress) loadingProgress.textContent = 'Could not load campus model.';
          if (loadingOverlay) loadingOverlay.classList.add('hidden');
        }
      );
    }
  );
}

function onGlbModelLoaded(gltf) {
  glbScene = gltf.scene;
  glbRoofs = [];
  glbCorridorRoofs = [];
  glbLabels = [];
  const roomMeshes = [];

  glbScene.traverse(child => {
    if (!child.name) return;
    if (child.name.startsWith('Room_')) {
      roomMeshes.push(child);
    } else if (child.name.startsWith('Roof_')) {
      glbRoofs.push(child);
    } else if (child.name.startsWith('CorridorRoof_')) {
      glbCorridorRoofs.push(child);
    } else if (child.name.startsWith('Label_')) {
      glbLabels.push(child);
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
          if (!mat) return;
          mat.side = THREE.DoubleSide;
          mat.depthTest = true;
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = -1.0;
          mat.polygonOffsetUnits = -4.0;
        });
      }
    }
  });

  // Calculate bounding box and centers for rooms
  glbRooms = roomMeshes.map(mesh => {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const clean = cleanRoomName(mesh.name.replace(/^Room_/, '').replace(/\.\d+$/, ''));
    const type = getGlbRoomType(clean);

    mesh.userData = {
      id: mesh.name,
      name: clean,
      type,
      cx: center.x,
      cy: center.z,
      isGlbRoom: true
    };
    interactable.push(mesh);

    return {
      id: mesh.name,
      rawName: mesh.name,
      cleanName: clean,
      name: clean,
      type,
      x: center.x,
      y: center.z,
      mesh,
      box
    };
  });

  // Disambiguate duplicate room names:
  // e.g. "Gents Toilet (near Accounts)"
  const nameCounts = {};
  glbRooms.forEach(r => { nameCounts[r.cleanName] = (nameCounts[r.cleanName] || 0) + 1; });

  glbRooms.forEach(r => {
    if (nameCounts[r.cleanName] > 1) {
      let bestDist = Infinity, bestNear = null;
      glbRooms.forEach(other => {
        if (other.cleanName === r.cleanName) return;
        const isGeneric = ['Gents Toilet', 'Ladies Toilet', 'Stair'].includes(other.cleanName);
        const d = Math.hypot(r.x - other.x, r.y - other.y) + (isGeneric ? 25 : 0);
        if (d < bestDist) {
          bestDist = d;
          bestNear = other;
        }
      });
      r.displayName = `${r.cleanName} (near ${bestNear ? bestNear.cleanName : 'Corridor'})`;
    } else {
      r.displayName = r.cleanName;
    }
    glbDisambNames[r.id] = r.displayName;
  });

  // Extract corridors, courtyards, rooms and solid walls
  glbScene.updateMatrixWorld(true);
  const corridors = [];
  corridorPolygons = [];
  courtyardBoxes = [];
  solidWallMeshes = [];

  glbScene.traverse(child => {
    if (!child.name) return;
    if (child.name.startsWith('Corridor_') && child.isMesh) {
      const box = new THREE.Box3().setFromObject(child);
      corridors.push({ name: child.name, box, mesh: child });

      // Extract ordered polygon vertices
      const posAttr = child.geometry.attributes.position;
      const v = new THREE.Vector3();
      const pts = [];
      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i);
        v.applyMatrix4(child.matrixWorld);
        if (!pts.some(p => Math.hypot(p.x - v.x, p.z - v.z) < 0.05)) {
          pts.push({ x: v.x, z: v.z });
        }
      }
      if (pts.length >= 3) {
        let cx = 0, cz = 0;
        pts.forEach(p => { cx += p.x; cz += p.z; });
        cx /= pts.length; cz /= pts.length;
        pts.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
        corridorPolygons.push({ name: child.name, pts, box, mesh: child });
      }
    } else if (child.name.startsWith('Courtyard') || child.name.includes('Courtyard') || child.name.includes('Paved') || child.name === 'Ground') {
      courtyardBoxes.push(new THREE.Box3().setFromObject(child));
    } else if (child.name.includes('Wall') || child.name === 'Walls') {
      if (child.isMesh) solidWallMeshes.push(child);
    }
  });

  // Precompute room polygons for precise polygon collision
  glbRooms.forEach(room => {
    const { pts, cx, cz } = getRoomPolygon(room.mesh);
    room.poly = pts;
    room.cx = cx;
    room.cz = cz;
  });

  roomBoxes = glbRooms.map(r => ({
    name: r.id,
    box: r.box,
    poly: r.poly
  }));

  // COLLISION ONLY WITH REAL WALLS: movement may be blocked only by walkable grid, Walls mesh, and Room_ meshes
  solidWallMeshes = [...solidWallMeshes.filter(m => m && m.isMesh), ...roomMeshes.filter(m => m && m.isMesh)];

  buildAllRoomDoors(corridors);
  initCorridorGrid(corridors);

  glbGroup.add(glbScene);
  glbLoaded = true;

  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');

  // Set default starting point to Reception or first room
  const rec = glbRooms.find(r => r.type === 'reception') || glbRooms[0];
  if (rec) {
    fromRoomId = rec.id;
    const recName = glbDisambNames[rec.id] || rec.name;
    if (currLocationTxt) currLocationTxt.textContent = recName;
    placePersonAtRoom(rec.id);
  }

  if (activeMode === 'map') {
    applyMapMode();
  } else {
    applyWalkMode();
  }

  console.log('New 3D Campus model loaded! Total rooms:', glbRooms.length);
}

async function initApp() {
  loadGlbModel();
  applyMapMode();
}

initApp().catch(console.error);

// ─── STAGE 4: Route Progress, Off-Route Recalculation & Arrival ─────────────
function checkRouteProgress() {
  if (!toRoomId || !activeRouteWaypoints.length) return;

  const toRoom = glbRooms.find(r => r.id === toRoomId);
  const destDoor = toRoom ? toRoom.door : null;
  const distToDest = destDoor ? Math.hypot(destDoor.x - person.x, destDoor.z - person.z) : Infinity;

  if (distToDest <= (CONFIG.ARRIVAL_DISTANCE_THRESHOLD || 1.8)) {
    if (!hasArrivedAtDest) {
      hasArrivedAtDest = true;
      if (isSimulatingWalk) stopSimulatingWalking();
      updateGuidanceCard();
      showBanner(`🎉 You have arrived at ${toRoom ? (glbDisambNames[toRoom.id] || toRoom.name) : 'your destination'}!`);
    }
    return;
  }

  // Check off-route distance: find minimum distance to route segments
  let minRouteDist = Infinity;
  for (let i = 0; i < activeRouteWaypoints.length - 1; i++) {
    const p1 = activeRouteWaypoints[i];
    const p2 = activeRouteWaypoints[i + 1];
    const d = pointToSegmentDistance(person.x, person.z, p1.x, p1.z, p2.x, p2.z);
    if (d < minRouteDist) minRouteDist = d;
  }

  const now = performance.now();
  if (minRouteDist > (CONFIG.OFF_ROUTE_RECALC_THRESHOLD || 3.8) && (now - lastOffRouteRecalcTime > 2500)) {
    lastOffRouteRecalcTime = now;
    showBanner('🔄 Off route: recalculating path...');

    const startPt = { x: person.x, z: person.z };
    const endPt = destDoor ? { x: destDoor.x, z: destDoor.z } : { x: toRoom.x, z: toRoom.y };
    const newPath = findAStarRoute(startPt, endPt);
    activeRouteWaypoints = newPath;
    activeRouteInstructions = buildTurnByTurnInstructions(newPath, toRoom);
    simWaypointIdx = 1;

    redrawRouteMeshes(newPath, destDoor);
  }

  updateGuidanceCard();
}

// ─── Animation Loop ──────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  if (activeMode === 'walk') {
    if (isSimulatingWalk && activeRouteWaypoints.length >= 2) {
      // Automatic route walking simulation
      const targetPt = activeRouteWaypoints[simWaypointIdx];
      if (targetPt) {
        const dx = targetPt.x - person.x;
        const dz = targetPt.z - person.z;
        const dist = Math.hypot(dx, dz);
        const speed = (CONFIG.SIMULATION_SPEED_MPS || 4.2) * delta;

        if (dist <= speed || dist < 0.25) {
          person.x = targetPt.x;
          person.z = targetPt.z;
          simWaypointIdx++;
          stepCount += Math.max(1, Math.round(dist / (CONFIG.STEP_LENGTH_METERS || 0.7)));
          updateSensorPill();

          if (simWaypointIdx >= activeRouteWaypoints.length) {
            stopSimulatingWalking();
            hasArrivedAtDest = true;
            updateGuidanceCard();
            const toRoom = glbRooms.find(r => r.id === toRoomId);
            showBanner(`🎉 You have arrived at ${toRoom ? (glbDisambNames[toRoom.id] || toRoom.name) : 'your destination'}!`);
          }
        } else {
          const moveX = (dx / dist) * speed;
          const moveZ = (dz / dist) * speed;
          tryMovePerson(person.x, person.z, moveX, moveZ);

          // Smoothly rotate yaw towards target walking direction
          const targetYaw = Math.atan2(-dx, -dz);
          const diff = ((targetYaw - person.yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
          person.yaw += diff * Math.min(1.0, 7.5 * delta);

          simDistanceTraveled += speed;
          if (simDistanceTraveled >= (CONFIG.STEP_LENGTH_METERS || 0.7)) {
            simDistanceTraveled = 0;
            stepCount++;
            updateSensorPill();
          }
        }

        checkRouteProgress();
        checkDoorProximity();
      }
    } else {
      // Manual walking via WASD, Arrow keys, or on-screen buttons
      const now = performance.now();
      const hasHeldControls = (heldKeys.size > 0 || heldPointerButtons.size > 0);

      // SAFETY NET: The movement loop must only move me while at least one control is currently active.
      // If no key or pointer has sent an event for 300 ms while a "held" state is on, treat it as released and stop.
      if (hasHeldControls && (now - lastControlEventTime > 300)) {
        clearAllControls();
      }

      // SENSOR STEPS safety: if motion stays below threshold for 1s, stop moving
      if (isSensorsActive && lastHighMotionTime > 0 && (now - lastHighMotionTime) >= 1000) {
        isSensorsActive = false;
        updateSensorPill();
      }

      let moveForward = 0;
      let moveRight = 0;

      if (heldKeys.has('W') || heldPointerButtons.has('forward button'))   moveForward += 1;
      if (heldKeys.has('S') || heldPointerButtons.has('backward button'))  moveForward -= 1;
      if (heldKeys.has('D') || heldPointerButtons.has('right button'))     moveRight += 1;
      if (heldKeys.has('A') || heldPointerButtons.has('left button'))      moveRight -= 1;

      if (moveForward !== 0 || moveRight !== 0) {
        const len = Math.hypot(moveForward, moveRight);
        const nf = moveForward / len;
        const nr = moveRight / len;

        const sinYaw = Math.sin(person.yaw);
        const cosYaw = Math.cos(person.yaw);

        // World XZ motion vector
        const dx = (-sinYaw * nf + cosYaw * nr);
        const dz = (-cosYaw * nf - sinYaw * nr);

        const speed = (CONFIG.WALK_SPEED_MPS || 5.0) * delta;
        const moveDx = dx * speed;
        const moveDz = dz * speed;

        const prevX = person.x;
        const prevZ = person.z;

        // Try movement with wall sliding (X then Z)
        tryMovePerson(person.x, person.z, moveDx, moveDz);

        const movedDist = Math.hypot(person.x - prevX, person.z - prevZ);

        if (movedDist > 0.005) {
          isPersonStuckKeyHeld = false;
          stuckStartTime = 0;
        } else {
          // Movement key is held but player did not move
          if (!isPersonStuckKeyHeld) {
            isPersonStuckKeyHeld = true;
            stuckStartTime = now;
          } else if (now - stuckStartTime >= 1000) {
            // NEVER TRAPPED: if haven't moved for 1s while holding key, gently push to nearest cell centre
            const nearest = findNearestWalkableCell(person.x, person.z);
            const toX = nearest.x - person.x;
            const toZ = nearest.z - person.z;
            const distToCenter = Math.hypot(toX, toZ);
            if (distToCenter > 0.02) {
              const nudge = Math.min(distToCenter, 2.5 * delta);
              person.x += (toX / distToCenter) * nudge;
              person.z += (toZ / distToCenter) * nudge;
            } else {
              person.x = nearest.x;
              person.z = nearest.z;
              stuckStartTime = now;
            }
            if (isDebugMode) {
              setDebugBlocked('Unsticking: nudged to cell centre');
            }
          }
        }

        checkRouteProgress();
        checkDoorProximity();
      } else {
        isPersonStuckKeyHeld = false;
        stuckStartTime = 0;
        setDebugBlocked(null);
      }
      if (isDebugMode) {
        updateDebugBar();
      }
    }

    applyCameraFromPerson();
  } else {
    orbitControls.update();
  }
  renderMiniMap();

  // Pulsing destination marker above door
  if (destBeacon) {
    destBeacon.position.y = 3.2 + Math.sin(elapsed * 4) * 0.35;
    destBeacon.rotation.y = elapsed * 2.5;
  }

  renderer.render(scene, camera);
}

animate();

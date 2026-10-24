/**
 * config.js - Central Configuration for AIT Pune Indoor Navigation
 * 
 * All tunable parameters (scale, eye height, step length, colors, GPS)
 * are stored here with simple English explanations.
 */

export const CONFIG = {
  // Map Scale: real meters represented by 1 map unit (approx 0.35m per unit)
  METERS_PER_UNIT: 0.35,

  // Camera eye height for first-person walk mode (in meters)
  EYE_HEIGHT_METERS: 1.6,

  // Average walking step length (in meters)
  STEP_LENGTH_METERS: 0.7,

  // Wall height in 3D map units (for Map view)
  WALL_HEIGHT: 3.2,
  MAP_WALL_HEIGHT: 3.2,

  // Walk Mode Real Dimensions (Corridors 3m wide, Ceiling 3m high, Scale 0.35m/unit)
  WALK_CEILING_HEIGHT: 3.0 / 0.35,   // ~8.57 units (3 meters high)
  WALK_CORRIDOR_WIDTH: 3.0 / 0.35,   // ~8.57 units (3 meters wide)
  WALK_EYE_HEIGHT_3D: 1.6 / 0.35,    // ~4.57 units (1.6 meters eye height)
  WALK_DOOR_WIDTH: 1.0 / 0.35,       // ~2.86 units (1 meter wide door)
  WALK_DOOR_HEIGHT: 2.2 / 0.35,      // ~6.28 units (2.2 meters high door)
  WALK_TILE_SIZE: 0.6 / 0.35,        // ~1.71 units (60cm floor tile)

  // Wall thickness in 3D units
  WALL_THICKNESS: 0.8,

  // Legacy fallback eye height
  EYE_HEIGHT_3D: 1.6 / 0.35,

  // AIT Pune Campus GPS anchor coordinates (placeholder for sanity check)
  CAMPUS_LATITUDE: 18.6069,
  CAMPUS_LONGITUDE: 73.8745,
  CAMPUS_RADIUS_METERS: 1200,

  // First-person Walk Mode Bright Pastel Wall Colors (by room type)
  WALK_COLORS: {
    lab: 0xa7f3d0,       // Mint green
    office: 0xfed7aa,    // Warm pastel orange
    toilet: 0xbae6fd,    // Sky blue
    stair: 0xfef08a,     // Soft yellow
    store: 0xffedd5,     // Peach
    reception: 0xe9d5ff, // Soft purple
    other: 0xe2e8f0,     // Clean light grey
    entry: 0xfcd34d,     // Warm amber
    void: 0x94a3b8       // Courtyard border
  },

  // Map Mode Architectural Block Colors (darker theme from Stage 1/2)
  MAP_COLORS: {
    lab: 0x2e7d32,
    office: 0x795548,
    store: 0x6d4c41,
    toilet: 0x78909c,
    stair: 0x1565c0,
    reception: 0x7b1fa2,
    other: 0x37474f,
    entry: 0xe65100,
    void: 0x8a9a86
  },

  // Step detection parameters (devicemotion)
  STEP_DETECTION_THRESHOLD: 11.2,    // m/s² peak acceleration threshold
  STEP_MIN_INTERVAL_MS: 360,          // minimum milliseconds between counted steps (prevents double steps)
  CORRIDOR_SNAP_TOLERANCE: 14.0,      // max units to snap onto corridor lines (prevents wall clipping)

  // Room type icons for door signboards
  TYPE_ICONS: {
    lab: '🔬',
    office: '💼',
    toilet: '🚻',
    stair: '🪜',
    store: '📦',
    reception: 'ℹ️',
    entry: '🚪',
    other: '🏢'
  },

  // STAGE 4: Walking, A* Navigation & Guidance Parameters
  GRID_CELL_SIZE: 0.5,             // 0.5 meter cells for corridor walkable grid
  WALK_SPEED_MPS: 5.0,             // Manual walking speed (meters per second)
  SIMULATION_SPEED_MPS: 4.2,       // "Simulate walking" speed (meters per second)
  DOOR_STANDOFF_DISTANCE: 2.0,     // Start 2m in front of chosen door, facing it
  PLAYER_COLLISION_RADIUS: 0.25,   // Margin from corridor walls to avoid clipping (0.25m)
  OFF_ROUTE_RECALC_THRESHOLD: 3.8, // Distance in meters off route before recalculating
  ARRIVAL_DISTANCE_THRESHOLD: 1.8  // Distance in meters to destination door for arrival
};

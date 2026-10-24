/**
 * graph.js - Walkable Navigation Graph for AIT Pune Floor Plan
 * 
 * Builds a graph from rooms and corridor polylines:
 * 1. Automatically computes door nodes for each room at the edge nearest to a corridor.
 * 2. Connects door nodes to the nearest point on the corridor network.
 * 3. Subdivides corridor segments at all junctions and door intersections.
 * 4. Provides Dijkstra / A* shortest path routing and nearest facility queries.
 */

// Helper: 2D Euclidean distance
export function distance2D(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Point-to-segment distance and projection
export function projectPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { dist: distance2D(px, py, ax, ay), t: 0, proj: [ax, ay] };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return {
    dist: distance2D(px, py, projX, projY),
    t,
    proj: [projX, projY]
  };
}

export class WalkableGraph {
  constructor() {
    this.nodes = new Map(); // id -> { id, x, y, type, label, roomId }
    this.adj = new Map();   // id -> Array of { to: node, dist: number }
  }

  addNode(id, x, y, type = 'waypoint', label = '', roomId = null) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, x, y, type, label, roomId });
      this.adj.set(id, []);
    }
    return this.nodes.get(id);
  }

  addEdge(id1, id2) {
    if (!id1 || !id2 || id1 === id2) return;
    const n1 = this.nodes.get(id1);
    const n2 = this.nodes.get(id2);
    if (!n1 || !n2) return;

    const dist = distance2D(n1.x, n1.y, n2.x, n2.y);
    const list1 = this.adj.get(id1);
    const list2 = this.adj.get(id2);

    if (!list1.some(e => e.to.id === id2)) {
      list1.push({ to: n2, dist });
    }
    if (!list2.some(e => e.to.id === id1)) {
      list2.push({ to: n1, dist });
    }
  }

  findShortestPath(startNodeId, endNodeId) {
    if (!this.nodes.has(startNodeId) || !this.nodes.has(endNodeId)) {
      return null;
    }
    if (startNodeId === endNodeId) {
      const n = this.nodes.get(startNodeId);
      return { path: [n], distance: 0 };
    }

    const dists = new Map();
    const prev = new Map();
    const visited = new Set();

    this.nodes.forEach((_, id) => dists.set(id, Infinity));
    dists.set(startNodeId, 0);

    while (true) {
      let closestId = null;
      let closestDist = Infinity;

      dists.forEach((d, id) => {
        if (!visited.has(id) && d < closestDist) {
          closestDist = d;
          closestId = id;
        }
      });

      if (!closestId || closestDist === Infinity) break;
      if (closestId === endNodeId) break;

      visited.add(closestId);

      for (const edge of this.adj.get(closestId)) {
        if (visited.has(edge.to.id)) continue;
        const alt = closestDist + edge.dist;
        if (alt < dists.get(edge.to.id)) {
          dists.set(edge.to.id, alt);
          prev.set(edge.to.id, closestId);
        }
      }
    }

    if (!prev.has(endNodeId)) return null;

    const path = [];
    let curr = endNodeId;
    while (curr) {
      path.unshift(this.nodes.get(curr));
      curr = prev.get(curr);
    }

    return { path, distance: dists.get(endNodeId) };
  }
}

/**
 * Disambiguates duplicate room names by attaching their nearest neighbor
 */
export function buildDisambiguatedRoomNames(rooms) {
  const counts = {};
  rooms.forEach(r => {
    counts[r.name] = (counts[r.name] || 0) + 1;
  });

  const names = {};
  rooms.forEach(r => {
    if (counts[r.name] === 1) {
      names[r.id] = r.name;
    } else {
      let nearest = null;
      let minDist = Infinity;
      rooms.forEach(other => {
        if (
          other.id !== r.id &&
          other.name !== r.name &&
          other.type !== 'void' &&
          other.name !== 'Unnamed Room'
        ) {
          const d = distance2D(r.cx, r.cy, other.cx, other.cy);
          if (d < minDist) {
            minDist = d;
            nearest = other;
          }
        }
      });
      const neighborLabel = nearest ? nearest.name : 'Wing';
      names[r.id] = `${r.name} (near ${neighborLabel})`;
    }
  });

  return names;
}

/**
 * Computes which side of a room is closest to the corridor (door side & position)
 */
export function getRoomDoorInfo(room, corridors, allRooms = []) {
  const rad = ((room.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = room.w / 2;
  const hh = room.h / 2;

  const midpoints = [
    { side: 'top',    x: room.cx + hh * sin, y: room.cy - hh * cos },
    { side: 'bottom', x: room.cx - hh * sin, y: room.cy + hh * cos },
    { side: 'left',   x: room.cx - hw * cos, y: room.cy - hw * sin },
    { side: 'right',  x: room.cx + hw * cos, y: room.cy + hw * sin }
  ];

  // Filter out any side midpoint that touches or penetrates another room's wall
  const validMidpoints = midpoints.filter(m => {
    for (const o of allRooms) {
      if (o.id === room.id || o.type === 'void') continue;
      const ox = m.x - o.cx, oy = m.y - o.cy;
      const oRot = -((o.rot || 0) * Math.PI) / 180;
      const lx = ox * Math.cos(oRot) - oy * Math.sin(oRot);
      const ly = ox * Math.sin(oRot) + oy * Math.cos(oRot);
      if (Math.abs(lx) <= o.w / 2 + 0.6 && Math.abs(ly) <= o.h / 2 + 0.6) {
        return false; // wall touches adjacent room
      }
    }
    return true;
  });

  const candidates = validMidpoints.length > 0 ? validMidpoints : midpoints;
  let best = candidates[0];
  let minD = Infinity;

  corridors.forEach(poly => {
    for (let i = 0; i < poly.length - 1; i++) {
      const p1 = poly[i];
      const p2 = poly[i + 1];
      candidates.forEach(m => {
        const res = projectPointToSegment(m.x, m.y, p1[0], p1[1], p2[0], p2[1]);
        if (res.dist < minD) {
          minD = res.dist;
          best = m;
        }
      });
    }
  });

  return { side: best.side, x: best.x, y: best.y, dist: minD };
}

/**
 * Build graph from rooms and corridor polylines
 */
export function buildNavigationGraph(roomsData) {
  const graph = new WalkableGraph();
  const rooms = (roomsData.rooms || []).filter(r => (r.floor ?? 0) === 0 && r.type !== 'void');
  const corridors = roomsData.corridors || [];

  function ptKey(x, y) {
    return `pt_${Math.round(x * 10) / 10}_${Math.round(y * 10) / 10}`;
  }

  // 1. Create list of corridor segments
  const segments = [];
  corridors.forEach((poly, polyIdx) => {
    for (let i = 0; i < poly.length - 1; i++) {
      segments.push({
        polyIdx,
        p1: poly[i],
        p2: poly[i + 1],
        splits: []
      });
    }
  });

  // Explicit junction: Corridor 0 top [671, 232] lands on Corridor 2's [500, 232]->[700, 232]
  segments.forEach(seg => {
    if (seg.p1[0] === 500 && seg.p1[1] === 232 && seg.p2[0] === 700 && seg.p2[1] === 232) {
      seg.splits.push({
        t: (671 - 500) / 200,
        pt: [671, 232],
        type: 'junction'
      });
    }
  });

  // 2. Connect each room's door to nearest corridor segment
  rooms.forEach(room => {
    const doorInfo = getRoomDoorInfo(room, corridors, rooms);
    const bestDoor = { side: doorInfo.side, x: doorInfo.x, y: doorInfo.y };

    let bestDist = Infinity;
    let bestSegResult = null;

    segments.forEach(seg => {
      const res = projectPointToSegment(bestDoor.x, bestDoor.y, seg.p1[0], seg.p1[1], seg.p2[0], seg.p2[1]);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestSegResult = { seg, ...res };
      }
    });

    if (bestSegResult && bestDoor) {
      bestSegResult.seg.splits.push({
        t: bestSegResult.t,
        pt: bestSegResult.proj,
        door: bestDoor,
        room: room,
        type: 'door_junction'
      });
    }
  });

  // 3. Assemble graph by iterating each corridor segment and its sorted splits
  segments.forEach(seg => {
    seg.splits.sort((a, b) => a.t - b.t);

    const startId = ptKey(seg.p1[0], seg.p1[1]);
    graph.addNode(startId, seg.p1[0], seg.p1[1], 'corridor_corner');

    let prevId = startId;

    seg.splits.forEach(split => {
      const splitId = ptKey(split.pt[0], split.pt[1]);
      graph.addNode(splitId, split.pt[0], split.pt[1], split.type || 'junction');
      graph.addEdge(prevId, splitId);
      prevId = splitId;

      if (split.door && split.room) {
        const doorId = `door_${split.room.id}`;
        const roomCenterId = `room_${split.room.id}`;

        graph.addNode(doorId, split.door.x, split.door.y, 'door', `Door: ${split.room.name}`, split.room.id);
        graph.addNode(roomCenterId, split.room.cx, split.room.cy, 'room', split.room.name, split.room.id);

        graph.addEdge(splitId, doorId);
        graph.addEdge(doorId, roomCenterId);
      }
    });

    const endId = ptKey(seg.p2[0], seg.p2[1]);
    graph.addNode(endId, seg.p2[0], seg.p2[1], 'corridor_corner');
    graph.addEdge(prevId, endId);
  });

  // 4. Interconnect the 3 corridor branches at Reception / Foyer
  const foyerPoint = ptKey(648, 513);
  graph.addEdge(ptKey(640, 520), foyerPoint);
  graph.addEdge(ptKey(671, 505), foyerPoint);

  return graph;
}

const fs = require('fs');

const buf = fs.readFileSync('campus_ground_floor_edited__1_.glb');
// Parse GLB header
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
const jsonLen = buf.readUInt32LE(12);
const jsonType = buf.readUInt32LE(16);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

console.log('GLTF nodes with Corridor_:');
const corridorNodes = gltf.nodes.filter(n => n.name && n.name.startsWith('Corridor_'));
corridorNodes.forEach(n => {
  console.log(n.name, 'mesh:', n.mesh, 'translation:', n.translation);
});

// Let's get accessors min/max for corridor meshes
corridorNodes.forEach(n => {
  const mesh = gltf.meshes[n.mesh];
  const prim = mesh.primitives[0];
  const posAcc = gltf.accessors[prim.attributes.POSITION];
  const tx = n.translation ? n.translation[0] : 0;
  const ty = n.translation ? n.translation[1] : 0;
  const tz = n.translation ? n.translation[2] : 0;
  const min = [posAcc.min[0] + tx, posAcc.min[1] + ty, posAcc.min[2] + tz];
  const max = [posAcc.max[0] + tx, posAcc.max[1] + ty, posAcc.max[2] + tz];
  console.log(`${n.name}: X[${min[0].toFixed(2)}, ${max[0].toFixed(2)}] (w=${(max[0]-min[0]).toFixed(2)}m)  Z[${min[2].toFixed(2)}, ${max[2].toFixed(2)}] (d=${(max[2]-min[2]).toFixed(2)}m)`);
});

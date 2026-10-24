const fs = require('fs');
const THREE = require('three');
const { GLTFLoader } = require('three/examples/jsm/loaders/GLTFLoader.js');

// Polyfill minimal browser environment for GLTFLoader in node if needed
// Or let's inspect the GLB using binary parsing or three
console.log('Testing corridor geometry...');

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─── URL PARAMETERS: SHOW UI CONTROLS ─────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const showGridCells = urlParams.get('showGridCells') === 'true';
const showPhases = urlParams.get('showPhases') === 'true';

// ─── CONSTANTS & GLOBAL STATE ────────────────────────────────────────────────
const BASE_POINT_SIZE_TORUS = 0.00075 * 1.75;
const BASE_POINT_SIZE_2D = 0.000075 * 1.75;

// Global state for coloration modes and grid-cell selections
// Modes: 'default', 'gridCell', 'phase1', 'phase2', 'phase3'
let currentColorMode = 'default';
let defaultColors = null;
let selectedCells = [];
// Remove dynamic colormap assignments – we now use a fixed mapping.
let fixedColormapMapping = {};
let thumbnailElements = {};

// Fixed colormaps for grid cells (three available)
const colormaps = [hotColormap, coolColormap, magentaColormap];

// Global cache for phase data (3-column matrix)
let phaseData = null;

// ─── UTILITY DATA LOADER FUNCTIONS ───────────────────────────────────────────
async function loadJSON(url) {
  const response = await fetch(url);
  return response.json();
}

async function loadBinary(url) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Float32Array(buffer);
}

// ─── COLORMAP FUNCTIONS ───────────────────────────────────────────────────────
function viridisColormap(value, limLo, limHi) {
  const colormap = [
    [68, 1, 84], [72, 35, 116], [64, 67, 135], [52, 94, 141],
    [41, 120, 142], [32, 144, 140], [34, 167, 132], [68, 190, 112],
    [121, 209, 81], [189, 222, 38], [253, 231, 37]
  ];
  let t = (value - limLo) / (limHi - limLo);
  t = Math.max(0, Math.min(1, t));
  const index = Math.min(Math.floor(t * (colormap.length - 1)), colormap.length - 2);
  const mix = t * (colormap.length - 1) - index;
  const c1 = colormap[index], c2 = colormap[index + 1];
  return [(1 - mix) * c1[0] + mix * c2[0],
          (1 - mix) * c1[1] + mix * c2[1],
          (1 - mix) * c1[2] + mix * c2[2]].map(x => x / 255);
}

function hsvColormapCircular(value, minVal = -Math.PI, maxVal = Math.PI) {
  let t = (value - minVal) / (maxVal - minVal);
  t = Math.max(0, Math.min(1, t));
  let hue = t * 360;
  return hsvToRgb(hue, 1.0, 1.0);
}

function hsvToRgb(h, s, v) {
  let c = v * s;
  let x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)      [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

function hotColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  return [Math.min(1, t * 2), Math.max(0, Math.min(1, t * 3 - 1)), 0];
}

function coolColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  return [0, Math.max(0, Math.min(1, t * 3 - 1)), Math.min(1, t * 3)];
}

function magentaColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  return [Math.max(0, Math.min(1, t * 3 - 1)), 0, Math.max(0, Math.min(1, t * 2 - 1))];
}

// ─── COLOR MANAGER MODULE ─────────────────────────────────────────────────────
const ColorManager = {
  async initPhaseData() {
    if (!phaseData) {
      phaseData = await loadBinary('./torusphase_interp.bin');
    }
  },
  updateColors: async function(points, positionsData) {
    // If grid-cell mode but no cells are selected, revert to default.
    if (currentColorMode === 'gridCell' && selectedCells.length === 0) {
      currentColorMode = 'default';
    }
    switch (currentColorMode) {
      case 'default':
        this.applyDefaultColors(points, positionsData, 1);
        break;
      case 'gridCell':
        await this.applyGridCellColors(points);
        break;
      default:
        if (currentColorMode.startsWith('phase')) {
          await this.applyPhaseColors(points, currentColorMode);
        }
        break;
    }
  },
  applyDefaultColors(points, positionsData, dim) {
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i++) {
      const [r, g, b] = viridisColormap(positionsData[i * 3 + dim], -4, 4);
      colors.set([r, g, b], i * 3);
    }
    points.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    defaultColors = colors.slice();
  },
  applyGridCellColors: async function(points) {
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3).fill(0.1);
    // Iterate over the selected grid cells and combine their fixed colormaps.
    for (const cellID of selectedCells) {
      const firingRates = await loadBinary(`./fr/${cellID}.bin`);
      const cmap = fixedColormapMapping[cellID];
      for (let i = 0; i < pointCount; i++) {
        const [r, g, b] = cmap(firingRates[i]);
        colors[i * 3] += r;
        colors[i * 3 + 1] += g;
        colors[i * 3 + 2] += b;
      }
    }
    points.geometry.attributes.color.array.set(colors);
    points.geometry.attributes.color.needsUpdate = true;
  },
  applyPhaseColors: async function(points, phaseMode) {
    await this.initPhaseData();
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3);
    let phaseIndex = (phaseMode === 'phase1') ? 0 :
                     (phaseMode === 'phase2') ? 1 : 2;
    for (let i = 0; i < pointCount; i++) {
      const phaseValue = phaseData[i + phaseIndex * pointCount];
      const [r, g, b] = hsvColormapCircular(phaseValue);
      colors.set([r, g, b], i * 3);
    }
    points.geometry.attributes.color.array.set(colors);
    points.geometry.attributes.color.needsUpdate = true;
  }
};

// ─── SCENE, CAMERA, RENDERER & CONTROLS SETUP ───────────────────────────────
const sceneTorus = new THREE.Scene();
const scene2d = new THREE.Scene();
const cameraTorus = new THREE.PerspectiveCamera(120, window.innerWidth / (2 * window.innerHeight), 0.1, 1000);
const camera2d = new THREE.PerspectiveCamera(120, window.innerWidth / (2 * window.innerHeight), 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.backgroundColor = 'black';
document.body.appendChild(renderer.domElement);

function createBloomPass(renderer, scene, camera, strength) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, 0.3, 0.0)
  composer.addPass(bloomPass);
  composer.setSize(window.innerWidth / 2, window.innerHeight);
  return {composer, bloomPass};
}

const {composer: composerTorus, bloomPass: bloomPassTorus} = createBloomPass(renderer, sceneTorus, cameraTorus, 0.5);
const {composer: composer2d, bloomPass: bloomPass2d} = createBloomPass(renderer, scene2d, camera2d, 1.0);

// The "bloom" effect needs boosting when we display the single-grid-cell data.
function updateBloomStrength() {
  if (currentColorMode === 'gridCell') {
    bloomPassTorus.strength = 1.5; // stronger glow for grid-cell mode
    bloomPass2d.strength = 3;
  } else {
    bloomPassTorus.strength = 0.5; // default glow
    bloomPass2d.strength = 1.0;
  }
}

// Call updateBloomStrength() each time the color mode changes or in your animation loop:
updateAllPointsColors = async function() {
  if (pointsTorus) await ColorManager.updateColors(pointsTorus, torusData);
  if (points2d) await ColorManager.updateColors(points2d, torusData);
  updateBloomStrength();
}


const controlsTorus = new OrbitControls(cameraTorus, renderer.domElement);
controlsTorus.enableDamping = true;
controlsTorus.autoRotate = true;
controlsTorus.autoRotateSpeed = 1;
controlsTorus.enablePan = false;
controlsTorus.enableZoom = true;

const controls2d = new OrbitControls(camera2d, renderer.domElement);
controls2d.enableDamping = true;
controls2d.enableRotate = false;
controls2d.enablePan = false;
controls2d.enableZoom = false;

// ─── SOFT GLOW TEXTURE SETUP ──────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;
const ctx = canvas.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
gradient.addColorStop(0, 'rgba(255,255,255,0.3)');
gradient.addColorStop(1, 'rgba(255,255,255,0)');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);
const texture = new THREE.CanvasTexture(canvas);
texture.encoding = THREE.SRGBColorSpace;

const materialTorus = new THREE.PointsMaterial({ 
  vertexColors: true,
  size: BASE_POINT_SIZE_TORUS,
  map: texture,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

const material2d = new THREE.PointsMaterial({
  size: BASE_POINT_SIZE_2D,
  vertexColors: true,
  map: texture,
  transparent: true
});

// ─── POINT CLOUD LOADING ────────────────────────────────────────────────────
async function loadPointCloud(scene, file, is2D, material) {
  const data = await loadJSON(file);
  const pointCount = data.length;
  let sumX = 0, sumY = 0, sumZ = 0;
  for (let i = 0; i < pointCount; i++) {
    sumX += data[i][0];
    sumY += data[i][1];
    sumZ += is2D ? 0 : data[i][2];
  }
  const centerX = sumX / pointCount;
  const centerY = sumY / pointCount;
  const centerZ = sumZ / pointCount;
  const positions = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount; i++) {
    positions[i * 3]     = data[i][0] - centerX;
    positions[i * 3 + 1] = data[i][1] - centerY;
    positions[i * 3 + 2] = is2D ? 0 : data[i][2] - centerZ;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const colors = new Float32Array(pointCount * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { points, positions };
}

let torusData = null;
let pointsTorus, points2d;

loadPointCloud(sceneTorus, './points_umap.json', false, materialTorus)
  .then(({ points, positions }) => {
    pointsTorus = points;
    torusData = positions;
    ColorManager.applyDefaultColors(pointsTorus, torusData, 1);
  });

loadPointCloud(scene2d, './points_2d.json', true, material2d)
  .then(({ points }) => {
    points2d = points;
    setTimeout(() => {
      ColorManager.applyDefaultColors(points2d, torusData, 1);
    }, 100);
  });

// ─── UI: THUMBNAILS & PHASE MODE BUTTONS ─────────────────────────────────────
function setupThumbnails() {
  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.id = 'thumbnailContainer';
  thumbnailContainer.style.position = 'absolute';
  thumbnailContainer.style.left = '50%';
  thumbnailContainer.style.transform = 'translateX(-50%)';
  thumbnailContainer.style.display = 'grid';
  thumbnailContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(80px, 1fr))';
  thumbnailContainer.style.gap = '5px';
  thumbnailContainer.style.maxWidth = '80vw';
  thumbnailContainer.style.justifyContent = 'center';
  document.body.appendChild(thumbnailContainer);

  fetch('cell_list_3.txt')
    .then(response => response.text())
    .then(text => {
      const cellIDs = text.split('\n').map(line => line.trim()).filter(line => line !== '');
      cellIDs.forEach((cellID, index) => {
        const img = document.createElement('img');
        img.src = `rm/${cellID}.png`;
        img.style.transform = 'rotate(-90deg)';
        img.classList.add('thumbnail');
        // Assign a fixed colormap based on the order (only three expected)
        if (index < colormaps.length) {
          fixedColormapMapping[cellID] = colormaps[index];
        }
        img.addEventListener('click', () => toggleGridCellColor(cellID));
        thumbnailContainer.appendChild(img);
        thumbnailElements[cellID] = img;
      });
    });
}

function setupPhaseModeButtons() {
  const phaseContainer = document.createElement('div');
  phaseContainer.id = 'phaseButtonContainer';
  phaseContainer.style.position = 'absolute';
  // phaseContainer.style.bottom = '5%';
  phaseContainer.style.left = '50%';
  phaseContainer.style.transform = 'translateX(-50%)';
  phaseContainer.style.display = 'flex';
  phaseContainer.style.gap = '10px';
  phaseContainer.style.justifyContent = 'center';
  document.body.appendChild(phaseContainer);

  ['phase1', 'phase2', 'phase3'].forEach(mode => {
    const btn = document.createElement('button');
    btn.textContent = mode.toUpperCase();
    btn.addEventListener('click', () => {
      currentColorMode = mode;
      updateAllPointsColors();
    });
    phaseContainer.appendChild(btn);
  });

  const defaultBtn = document.createElement('button');
  defaultBtn.textContent = 'DEFAULT';
  defaultBtn.addEventListener('click', () => {
    currentColorMode = 'default';
    updateAllPointsColors();
  });
  phaseContainer.appendChild(defaultBtn);
}

function updateThumbnailBorders() {
  Object.keys(thumbnailElements).forEach(cellID => {
    const img = thumbnailElements[cellID];
    if (selectedCells.includes(cellID)) {
      // Use the fixed mapping for border color.
      const cmap = fixedColormapMapping[cellID];
      img.style.border = `2px solid rgb(${cmap(0.75).map(v => v * 255).join(',')})`;
    } else {
      img.style.border = '2px solid transparent';
    }
  });
}

// Simplified toggle: simply add or remove the cell from the selection.
// If no cells remain selected, revert to default mode.
function toggleGridCellColor(cellID) {
  if (selectedCells.includes(cellID)) {
    selectedCells = selectedCells.filter(id => id !== cellID);
  } else {
    selectedCells.push(cellID);
  }
  currentColorMode = selectedCells.length === 0 ? 'default' : 'gridCell';
  updateThumbnailBorders();
  updateAllPointsColors();
}

async function updateAllPointsColors() {
  if (pointsTorus) await ColorManager.updateColors(pointsTorus, torusData);
  if (points2d) await ColorManager.updateColors(points2d, torusData);
}

// Only set up the grid-cell thumbnails and phase buttons if enabled via URL.
if (showGridCells) {
  setupThumbnails();
}
if (showPhases) {
  setupPhaseModeButtons();
}

// ─── RESPONSIVE LAYOUT & WINDOW RESIZING ──────────────────────────────────────
cameraTorus.position.set(3, -6, 3);
cameraTorus.lookAt(0, 0, 0);
camera2d.position.z = 0.6;
cameraTorus.aspect = 1;
camera2d.aspect = 1;
cameraTorus.updateProjectionMatrix();
camera2d.updateProjectionMatrix();

let initialSizeSet = false;
const STACK_CENTER_POS = 0.5;
let isHorzStacked = true;

function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ASPECT_RATIO_THRESH = 1.0;
  const aspectRatio = w / h;
  isHorzStacked = aspectRatio > ASPECT_RATIO_THRESH;

  // Reposition button containers

  let container
  container = document.getElementById('thumbnailContainer');
  if (container) {
    container.style.top = `${window.innerHeight * (isHorzStacked ? 0.85 : 0.7)}px`;
  }

  container = document.getElementById('phaseButtonContainer');
  if (container) {
    container.style.top = `${window.innerHeight * (isHorzStacked ? 0.95 : 0.8)}px`;
  }

  renderer.setSize(w, h);
}
window.addEventListener('resize', onWindowResize);

function setDrawRect(windowObj, renderer, composer, isHorz, numDivs, tileIndex, centerN) {
  if (!initialSizeSet && points2d && pointsTorus) {
    onWindowResize();
    initialSizeSet = true;
  }
  const w = windowObj.innerWidth;
  const h = windowObj.innerHeight;
  let wszT;
  let wszN;
  if (isHorz) {
    wszT = w;
    wszN = h;
  } else {
    wszT = h;
    wszN = w;
  }
  let fracNAvailable;
  if (centerN > 0.5) {
    fracNAvailable = (1 - centerN) * 2;
  } else if (centerN < 0.5) {
    fracNAvailable = centerN * 2;
  } else {
    fracNAvailable = 1;
  }
  const wszNAvailable = wszN * fracNAvailable;
  const tlenT = wszT / numDivs;
  const tlenN = wszN;
  const tlenView = Math.min(tlenT, wszNAvailable);
  const viewTileOffsetT = (tlenT - tlenView) / 2;
  const viewTileOffsetN = (tlenN - tlenView) * centerN;
  const posTileT = isHorz ? (tileIndex * tlenT) : ((numDivs - tileIndex - 1) * tlenT);
  const posTileN = 0;
  const posViewT = posTileT + viewTileOffsetT;
  const posViewN = posTileN + viewTileOffsetN;
  if (isHorz) {
    renderer.setScissor(posTileT, posTileN, tlenT, tlenN);
    renderer.setViewport(posViewT, posViewN, tlenView, tlenView);
  } else {
    renderer.setScissor(posTileN, posTileT, tlenN, tlenT);
    renderer.setViewport(posViewN, posViewT, tlenView, tlenView);
  }
  if (composer) {
    composer.setSize(tlenView, tlenView);
  }
  return tlenView;
}

// ─── ANIMATION LOOP ──────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controlsTorus.update();
  renderer.setScissorTest(true);
  const nTiles = isHorzStacked ? 2 : 3;
  const tsz = setDrawRect(window, renderer, composerTorus, isHorzStacked, nTiles, 0, STACK_CENTER_POS);
  const scaleFactor = Math.sqrt(tsz);
  materialTorus.size = BASE_POINT_SIZE_TORUS * scaleFactor;
  material2d.size = BASE_POINT_SIZE_2D * scaleFactor;
  composerTorus.render();
  setDrawRect(window, renderer, composer2d, isHorzStacked, nTiles, 1, STACK_CENTER_POS);
  composer2d.render();
  renderer.setScissorTest(false);
}

animate();
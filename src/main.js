import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
// Import fat-line classes for thicker trajectory lines:
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

// My utils module – contains data loading, color maps, and setDrawRect
import {loadJSON, loadBinary, viridisColormap, hsvColormapCircular, hotColormap, 
  coolColormap, magentaColormap, setDrawRect, softGlowTexture, spriteMaterial, parseUrlBoolOption
} from './utils/utils.js';


// TODO:
// Fix rat sprite alignment

// ─── URL PARAMETERS: SHOW UI CONTROLS ─────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const showGridBtns = parseUrlBoolOption(urlParams, 'showGridBtns', '1')
const showPhaseBtns = parseUrlBoolOption(urlParams, 'showPhaseBtns', '1');
const showTrajBtns = parseUrlBoolOption(urlParams, 'showTrajBtns', '1');
const showViewTorus = parseUrlBoolOption(urlParams, 'showViewTorus', '1');
const showView2d = parseUrlBoolOption(urlParams, 'showView2d', '1');

let numViews = 0;
if (showViewTorus) numViews++;
if (showView2d) numViews++;

let trajVisible = urlParams.get('trajVisible') === '1'; // initial traj visibility state

console.log(trajVisible);

// ─── GLOBAL VARIABLES USED BY UI (COLOR MODES, SELECTIONS, ETC.) ─────────────
let currentColorMode = 'default';
let defaultColors = null;
let selectedCells = [];
let isHorzStacked = null;

// Fixed colormap mapping for grid cells.
let fixedColormapMapping = {};
let thumbnailElements = {};

let trajAnimationActive = false;
let trajAnimationProgress = 0.0;
const TRAJECTORY_START = 10633;
const TRAJECTORY_COUNT = 16;

const DEFAULT_COLOR_DIM = 0;

// Fixed colormaps (three available)
const colormaps = [hotColormap, coolColormap, magentaColormap];

// Global cache for phase data (for ColorManager)
let phaseData = null;

// ─── GLOBAL RENDERER SETUP ─────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
const parentContainer = renderer.domElement.parentElement || document.body;
renderer.setPixelRatio(window.devicePixelRatio);
// // renderer.setSize(window.innerWidth, window.innerHeight);
// console.log("parentContainer width:", parentContainer.clientWidth);
// console.log("parentContainer height:", parentContainer.clientHeight);
// renderer.setSize(parentContainer.clientWidth, parentContainer.clientHeight);
renderer.domElement.style.backgroundColor = 'black';
document.body.appendChild(renderer.domElement);

// Extract a segment of points from a flat Float32Array of positions.
// `positions` is a Float32Array of length (N * 3)
// `startIdx` is the index (in point-space, not array index) of the first point,
// and `count` is the number of points to extract.
function getTrajectorySegment(positions, startIdx, count) {
  const segment = [];
  const totalPoints = positions.length / 3;
  // Clamp the end to the available points.
  const endIdx = Math.min(startIdx + count, totalPoints);
  for (let i = startIdx; i < endIdx; i++) {
    segment.push({ x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] });
  }
  return segment;
}

// Helper: 3-point moving median filter.
// Given an array of {x, y, z} objects, smooth each coordinate by taking
// the median of the previous, current, and next values.
// The first and last points remain unchanged.
function medianFilter(points) {
  if (points.length < 3) return points;
  const filtered = [];
  filtered.push(points[0]); // keep first point unchanged
  for (let i = 1; i < points.length - 1; i++) {
    const neighbors = [points[i - 1], points[i], points[i + 1]];
    const xs = neighbors.map(p => p.x).sort((a, b) => a - b);
    const ys = neighbors.map(p => p.y).sort((a, b) => a - b);
    const zs = neighbors.map(p => p.z).sort((a, b) => a - b);
    filtered.push({ x: xs[1], y: ys[1], z: zs[1] });
  }
  filtered.push(points[points.length - 1]); // keep last point unchanged
  return filtered;
}

// New Helper: Create a fat (thick) trajectory line using CatmullRom spline and upsampling.
function createFatTrajectoryLine(filteredPoints) {
  // Convert filtered points to an array of THREE.Vector3
  const vectorPoints = filteredPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
  // Create a CatmullRomCurve3 to smoothly interpolate points.
  const curve = new THREE.CatmullRomCurve3(vectorPoints);
  // Upsample the curve with 100 points for extra smoothness.
  const upsampledPoints = curve.getPoints(100);
  // Flatten points for LineGeometry.
  const positionsArray = [];
  upsampledPoints.forEach(pt => { positionsArray.push(pt.x, pt.y, pt.z); });
  const lineGeom = new LineGeometry();
  lineGeom.setPositions(positionsArray);
  // Create a fat line material. Note: linewidth is in pixels.
  const lineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 3,
    resolution: new THREE.Vector2(parentContainer.clientWidth, parentContainer.clientHeight),
    dashed: false,
  });
  const fatLine = new Line2(lineGeom, lineMat);
  fatLine.computeLineDistances();
  fatLine.scale.set(1, 1, 1);
  return { line: fatLine, curve: curve };
}

function createTrajectoryHelper(scene, positions) {
  // 1. Extract a segment from the positions data (assumed same for both scenes).
  const segment = getTrajectorySegment(positions, TRAJECTORY_START, TRAJECTORY_COUNT);
  // 2. Denoise the segment with a 3-point moving median filter.
  // const filteredSegment = medianFilter(segment);
  // 3. Create a fat line from the filtered segment using a CatmullRom spline for smoothness.
  const { line, curve } = createFatTrajectoryLine(segment);
  // Add the trajectory line to the scene.
  scene.add(line);
  return { line, curve };
}

// Global ColorManager (as before)
const ColorManager = {

  async initPhaseData() {
    if (!phaseData) {
      phaseData = await loadBinary('./torusphase_interp.bin');
    }
  },

  updateColors: async function(points) {
    // If grid-cell mode but no cells are selected, revert to default.
    if (currentColorMode === 'gridCell' && selectedCells.length === 0) {
      currentColorMode = 'default';
    }
    switch (currentColorMode) {
      case 'default':
        this.applyDefaultColors(points);
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

  applyDefaultColors: async function(points) {
    const pointCount = points.geometry.attributes.position.count;
    if (defaultColors) {
      const colorAttr = points.geometry.attributes.color;
      colorAttr.array.set(defaultColors);
      colorAttr.needsUpdate = true;
    }
  },

  applyGridCellColors: async function(points) {
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3).fill(0.1);
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


// ─── SCENE VIEW CLASS ─────────────────────────────────────────────────────────
//
// The SceneView class encapsulates all functionality for a single scene.
// It creates the scene, camera, controls, composer, and loads the point cloud.
// It also handles updating colors and trajectory elements.
class SceneView {
  constructor(config) {
    this.config = config;
    // Create the scene and camera.
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(config.fov, config.aspect, config.near, config.far);
    this.camera.position.copy(config.cameraPosition);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    
    // Create composer and bloom pass using the provided config.
    this.baseBloomStrength = config.baseBloomStrength;
    const { composer, bloomPass } = this.createBloomPass(renderer, this.scene, this.camera);
    this.composer = composer;
    this.bloomPass = bloomPass;

    this.basePointSize = config.basePointSize;
    
    // Create OrbitControls.
    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = config.autoRotate;
    controls.autoRotateSpeed = config.autoRotateSpeed;
    controls.enablePan = config.enablePan;
    controls.enableZoom = config.enableZoom;
    controls.enableRotate = config.enableRotate;
    this.controls = controls;
    
    // To be set later.
    this.pointCloud = null;
    this.positions = null;
    this.trajectory = null; // { line, curve }
    this.disc = null;
  }

  createBloomPass(strength) {
    const w = parentContainer.clientWidth;
    const h = parentContainer.clientHeight;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), this.baseBloomStrength, 0.3, 0.0);
    composer.addPass(bloomPass);
    composer.setSize(w / 2, h);
    return { composer, bloomPass };
  }

  setBloomStrength(multiplier) {
    this.bloomPass.strength = this.baseBloomStrength * multiplier;
  }
  
  // Load the point cloud and store positions.
  async loadPointCloud() {
    // const { points, positions } = await loadPointCloud(this.scene, this.config.pointFile, this.config.is2D, this.config.material);
    const data = await loadJSON(this.config.pointFile);
    const pointCount = data.length;
    const is2D = this.config.is2D;
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
    const points = new THREE.Points(geometry, this.config.material);
    this.scene.add(points);
    this.pointCloud = points;
    this.positions = positions;
    ColorManager.applyDefaultColors(points);
  }
  
  // Update colors for the point cloud.
  async updateColors() {
    if (this.pointCloud && this.positions) {
      // console.log(defaultColors);
      await ColorManager.updateColors(this.pointCloud, this.positions);
    }
  }
  
  // Create trajectory (line and disc) based on the loaded positions.
  createTrajectory() {
    if (!this.positions) return;
    const trajObj = createTrajectoryHelper(this.scene, this.positions);
    trajObj.line.visible = trajVisible;
    this.trajectory = trajObj;
    // Create a disc sprite for this trajectory.
    // const disc = new THREE.Sprite(spriteMaterial);
    let disc;
    if (this.config.is2D && this.config.ratTextureURL) {
      const ratTexture = new THREE.TextureLoader().load(this.config.ratTextureURL);
      const ratSpriteMaterial = new THREE.SpriteMaterial({ 
        map: ratTexture,
        transparent: true
      });
      // ratSpriteMaterial.center = new THREE.Vector2(0, 0);
      disc = new THREE.Sprite(ratSpriteMaterial);
    } else {
      // Use the default sprite (white disc) for non-2d scenes.
      disc = new THREE.Sprite(spriteMaterial);
    }

    disc.scale.copy(this.config.discScale);
    disc.position.copy(trajObj.curve.getPoint(0));
    // Ensure the disc always renders on top.
    disc.material.depthTest = false;
    disc.renderOrder = 999;
    disc.visible = trajVisible;
    this.scene.add(disc);
    this.disc = disc;
  }
  
  // Update the position of the trajectory disc given a progress (0 to 1).
  updateTrajectoryDisc(progress) {
    if (this.trajectory && this.disc) {
      const pt = this.trajectory.curve.getPoint(progress);
      this.disc.position.copy(pt);

      if (this.config.is2D) {
        // Get the tangent vector along the curve.
        const tangent = this.trajectory.curve.getTangent(progress);
        // Compute the angle; subtract PI/2 if needed because our rat image is oriented with its spine along y.
        const angle = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
        this.disc.material.rotation = angle;
      }

    }
  }
  
  // Render the scene via the composer.
  render(tileIndex) {
    const w = parentContainer.clientWidth;
    const h = parentContainer.clientHeight;
    const nTiles = numViews + ((isHorzStacked) ? 0 : 1);
    const tsz = setDrawRect(w, h, renderer, this.composer, isHorzStacked, nTiles, tileIndex, 0.5);
    this.pointCloud.material.size = this.basePointSize * Math.sqrt(tsz);
    this.composer.render();
  }
  
  // Update the controls (for animation).
  updateControls() {
    this.controls.update();
  }
}


// ─── CONFIGURATION OBJECTS FOR THE TWO SCENES ───────────────────────────────

// Torus scene configuration.
const torusConfig = {
  is2D: false,
  pointFile: './points_umap.json',
  material: new THREE.PointsMaterial({ 
    vertexColors: true,
    map: softGlowTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }),
  bloomStrength: 0.5,
  fov: 100,
  aspect: parentContainer.clientWidth / (2 * parentContainer.clientHeight),
  near: 0.1,
  far: 1000,
  cameraPosition: new THREE.Vector3(4, -8, 4),
  autoRotate: true,
  autoRotateSpeed: 1,
  enablePan: false,
  enableZoom: true,
  enableRotate: true,
  discScale: new THREE.Vector3(1, 1, 1),
  basePointSize: 0.00075 * 1.75,
  baseBloomStrength: 1
};

// 2d scene configuration.
const view2dConfig = {
  is2D: true,
  pointFile: './points_2d.json',
  material: new THREE.PointsMaterial({
    vertexColors: true,
    map: softGlowTexture,
    transparent: true
  }),
  bloomStrength: 1.0,
  fov: 120,
  aspect: parentContainer.clientWidth / (2 * parentContainer.clientHeight),
  near: 0.1,
  far: 1000,
  cameraPosition: new THREE.Vector3(0, 0, 0.6),
  autoRotate: false,
  autoRotateSpeed: 0,
  enablePan: false,
  enableZoom: false,
  enableRotate: false,
  discScale: new THREE.Vector3(0.25, 0.4, 0.25),
  basePointSize: 0.00005 * 1.75,
  ratTextureURL: 'Rat_Top_by_GC.svg',
  baseBloomStrength: 2
};


// ─── CREATE THE TWO SCENE VIEWS ─────────────────────────────────────────────
const viewTorus = new SceneView(torusConfig);
const view2d = new SceneView(view2dConfig);
const sceneViews = [viewTorus, view2d];

// Load point clouds for both scenes.
Promise.all([
  viewTorus.loadPointCloud(),
  view2d.loadPointCloud()
]).then(() => {
  // If trajectory display is enabled, create trajectories in both scenes.
  if (showTrajBtns) {
    viewTorus.createTrajectory();
    view2d.createTrajectory();
  }

  // When we have the torus position data, use this to define the default color values
  const p = viewTorus.positions;
  const pointCount = p.length / 3;
  defaultColors = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount; i++) {
    const [r, g, b] = viridisColormap(p[i * 3 + DEFAULT_COLOR_DIM], -4, 4);
    defaultColors.set([r, g, b], i * 3);
  }

});

// ─── CONSOLIDATED UI HANDLING ───────────────────────────────────────────────
// For grid-cell thumbnails and phase mode buttons, we use your existing UI functions
// and then broadcast the changes to both scene views.

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
        if (index < colormaps.length) {
          fixedColormapMapping[cellID] = colormaps[index];
        }
        img.addEventListener('click', () => {
          // Toggle selection
          if (selectedCells.includes(cellID)) {
            selectedCells = selectedCells.filter(id => id !== cellID);
          } else {
            selectedCells.push(cellID);
          }
          currentColorMode = selectedCells.length === 0 ? 'default' : 'gridCell';
          updateAllScenesColors();
          updateThumbnailBorders();
        });
        thumbnailContainer.appendChild(img);
        thumbnailElements[cellID] = img;
      });
    });
}

function setupPhaseModeButtons() {
  const container = document.createElement('div');
  container.id = 'phaseButtonContainer';
  container.style.position = 'absolute';
  container.style.left = '50%';
  container.style.transform = 'translateX(-50%)';
  container.style.display = 'flex';
  container.style.gap = '10px';
  container.style.justifyContent = 'center';
  document.body.appendChild(container);

  ['phase1', 'phase2', 'phase3'].forEach(mode => {
    const btn = document.createElement('button');
    btn.textContent = mode.toUpperCase();
    btn.addEventListener('click', () => {
      currentColorMode = mode;
      updateAllScenesColors();
    });
    container.appendChild(btn);
  });
  
  const defaultBtn = document.createElement('button');
  defaultBtn.textContent = 'DEFAULT';
  defaultBtn.addEventListener('click', () => {
    currentColorMode = 'default';
    updateAllScenesColors();
  });
  container.appendChild(defaultBtn);
}

function setupTrajectoryButtons() {
  const container = document.createElement('div');
  container.id = 'trajButtonContainer';
  container.style.position = 'absolute';
  container.style.right = '10px';
  container.style.bottom = '10px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';
  document.body.appendChild(container);
  
  const toggleTrajBtn = document.createElement('button');
  toggleTrajBtn.textContent = 'Toggle Trajectory';
  toggleTrajBtn.addEventListener('click', () => {
    // Toggle trajectory visibility in both scenes.
    trajVisible = !trajVisible;
    sceneViews.forEach(view => {
      view.trajectory.line.visible = trajVisible;
      view.disc.visible = trajVisible;
    });
    updateAllScenesColors();
  });
  container.appendChild(toggleTrajBtn);
  
  const animateTrajBtn = document.createElement('button');
  animateTrajBtn.textContent = 'Animate Trajectory';
  animateTrajBtn.addEventListener('click', () => {
    if (trajVisible) {
      trajAnimationActive = true;
      trajAnimationProgress = 0;
    }
  });
  container.appendChild(animateTrajBtn);
}

function updateThumbnailBorders() {
  Object.keys(thumbnailElements).forEach(cellID => {
    const img = thumbnailElements[cellID];
    if (selectedCells.includes(cellID)) {
      const cmap = fixedColormapMapping[cellID];
      img.style.border = `2px solid rgb(${cmap(0.75).map(v => v * 255).join(',')})`;
    } else {
      img.style.border = '2px solid transparent';
    }
  });
}

async function updateAllScenesColors() {
  await viewTorus.updateColors();
  await view2d.updateColors();

  if (trajVisible){
    // Disable bloom when showing traj
    viewTorus.setBloomStrength(0);
    view2d.setBloomStrength(0);
  } else {
    if (currentColorMode === 'gridCell') {
      viewTorus.setBloomStrength(1.5);
      view2d.setBloomStrength(1.5);
    } else {
      viewTorus.setBloomStrength(1);
      view2d.setBloomStrength(1);
    }
  }

}

// Only set up the UI if enabled via URL parameters.
if (showGridBtns) {
  setupThumbnails();
}
if (showPhaseBtns) {
  setupPhaseModeButtons();
}
if (showTrajBtns) {
  setupTrajectoryButtons();
}


// ─── RESPONSIVE LAYOUT & WINDOW RESIZING ──────────────────────────────────────
function onWindowResize() {
  const cnt = renderer.domElement.parentElement || document.body;
  const w = cnt.clientWidth;
  const h = cnt.clientHeight;
  console.log("parentContainer width:", w);
  console.log("parentContainer height:", h);
  // const w = window.innerWidth;
  // const h = window.innerHeight;
  const ASPECT_RATIO_THRESH = 1.0;
  isHorzStacked = (w / h) > ASPECT_RATIO_THRESH;
  
  // Reposition UI containers.
  let container = document.getElementById('thumbnailContainer');
  if (container) container.style.top = `${h * (isHorzStacked ? 0.85 : 0.7)}px`;
  container = document.getElementById('phaseButtonContainer');
  if (container) container.style.top = `${h * (isHorzStacked ? 0.95 : 0.8)}px`;
  
  renderer.setSize(w, h);
}
window.addEventListener('resize', onWindowResize);

let initialized = false;

// ─── ANIMATION LOOP ──────────────────────────────────────────────────────────
function animate() {

  requestAnimationFrame(animate);

  // When all data is loaded (which we confirm by checking that "defaultColors" is initialized),
  // we run some initial routines to initialize the dynamic properties of the UI elements
  // (namely the colors and positions/sizes).
  if (!initialized) {
    // Wait until data is loaded before rendering anything
    if (defaultColors) {
      updateAllScenesColors(); // apply default colors to point-cloud plots 
      onWindowResize(); // set proportions

      initialized = true;
    } else {
      return;
    }
  }
  
  // Update each scene view.
  sceneViews.forEach(view => {view.updateControls()});
  
  // If trajectory animation is active, update disc positions in both scenes.
  if (showTrajBtns && trajAnimationActive && viewTorus.trajectory && view2d.trajectory) {
    trajAnimationProgress += 0.002; // adjust speed as needed
    if (trajAnimationProgress >= 1) {
      trajAnimationProgress = 1;
      trajAnimationActive = false;
    }
    sceneViews.forEach(view => {view.updateTrajectoryDisc(trajAnimationProgress)});
  }

  renderer.setScissorTest(true);

  let tile = 0;
  if (showViewTorus) viewTorus.render(tile++);
  if (showView2d) view2d.render(tile++);
  renderer.setScissorTest(false);
}

animate();
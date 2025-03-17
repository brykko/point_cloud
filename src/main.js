import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const NUM_CELLS = 199;
const MAX_SELECTED_CELLS = 3;
const BASE_POINT_SIZE_TORUS = 0.00075 * 1.75;
const BASE_POINT_SIZE_2D = 0.000075 * 1.75;

let currentSelectedCell = null;
let defaultColors = null;
let points;

let selectedCells = [];
let colormapAssignments = {};
let thumbnailElements = {};
const colormaps = [hotColormap, coolColormap, magentaColormap];

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
    return [(1 - mix) * c1[0] + mix * c2[0], (1 - mix) * c1[1] + mix * c2[1], (1 - mix) * c1[2] + mix * c2[2]].map(x => x / 255);
}

function hsvColormapCircular(value, minVal = -Math.PI, maxVal = Math.PI) {
    // Normalize value to [0, 1] range
    let t = (value - minVal) / (maxVal - minVal);
    t = Math.max(0, Math.min(1, t));  // Ensure within bounds

    // Convert to hue angle (0-360 degrees)
    let hue = t * 360;

    // Convert HSV (hue, saturation, value) → RGB
    return hsvToRgb(hue, 1.0, 1.0);
}

// Helper function: Convert HSV to RGB (all values in range [0, 1])
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

    return [r + m, g + m, b + m];  // Adjust to fit [0,1] range
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
    return [Math.max(0, Math.min(1, t * 3 - 1)), 0, Math.max(0, Math.min(1, t * 2 - 1)) ];
}

function updateThumbnailBorders() {
    Object.keys(thumbnailElements).forEach(cellID => {
        const img = thumbnailElements[cellID];
        if (selectedCells.includes(parseInt(cellID))) {
            const colormap = colormapAssignments[cellID];
            img.style.border = `2px solid rgb(${colormap(0.75).map(v => v * 255).join(',')})`;
        } else {
            img.style.border = '2px solid transparent';
        }
    });
}

let pointsTorus, points2d;

const sceneTorus = new THREE.Scene();
const scene2d = new THREE.Scene();
const cameraTorus = new THREE.PerspectiveCamera(120, window.innerWidth / (2 * window.innerHeight), 0.1, 1000);
const camera2d = new THREE.PerspectiveCamera(120, window.innerWidth / (2 * window.innerHeight), 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.backgroundColor = 'black'; // crucial for filling entire page!

document.body.appendChild(renderer.domElement);

const composerTorus = new EffectComposer(renderer);
composerTorus.addPass(new RenderPass(sceneTorus, cameraTorus));
composerTorus.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.3, 0.0));
composerTorus.setSize(window.innerWidth / 2, window.innerHeight); // must be consistent with the viewport size, otherwise dots will be stretched

const composer2d = new EffectComposer(renderer);
composer2d.addPass(new RenderPass(scene2d, camera2d));
composer2d.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.3, 0.0));
composer2d.setSize(window.innerWidth / 2, window.innerHeight);

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

////////////////////////////////////////////////////////////////////////////////////////
// Set up soft glow texture
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;
const ctx = canvas.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
gradient.addColorStop(0, 'rgba(255,255,255,0.3)');  // Bright center
gradient.addColorStop(1, 'rgba(255,255,255,0)');  // Fade out edges
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);

const texture = new THREE.CanvasTexture(canvas);
texture.encoding = THREE.SRGBColorSpace;  // Ensure correct color representation

const materialTorus = new THREE.PointsMaterial({ 
    vertexColors: true,
    size: BASE_POINT_SIZE_TORUS,
    map: texture,           // Apply soft glow texture
    transparent: true,      // Enable transparency
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

// const material2d = new THREE.PointsMaterial({size: 0.003, vertexColors: true});

const material2d = new THREE.PointsMaterial({
    size: BASE_POINT_SIZE_2D,
    vertexColors: true,
    map: texture,         // Use the same canvas texture
    transparent: true     // Allow the circular alpha gradient to work
  });

////////////////////////////////////////////////////////////////////////////////////////
// Create point cloud from JSON file

function loadPointCloud(scene, file, onLoadCallback, is2D, material) {
    fetch(file)
        .then(response => response.json())
        .then(data => {
            const pointCount = data.length;

            // Compute sum of all coordinates
            let sumX = 0, sumY = 0, sumZ = 0;
            for (let i = 0; i < pointCount; i++) {
                sumX += data[i][0];
                sumY += data[i][1];
                sumZ += is2D ? 0 : data[i][2];
            }

            // Compute centroid (average position)
            const centerX = sumX / pointCount;
            const centerY = sumY / pointCount;
            const centerZ = sumZ / pointCount;
            console.log("Centroid:", centerX, centerY, centerZ); // Debugging

            const positions = new Float32Array(pointCount * 3);
            for (let i = 0; i < pointCount; i++) {
                positions[i * 3]     = data[i][0] - centerX;
                positions[i * 3 + 1] = data[i][1] - centerY;
                positions[i * 3 + 2] = is2D ? 0 : data[i][2] - centerZ;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const points = new THREE.Points(geometry, material);
            scene.add(points);
            onLoadCallback(points, positions);
        });
}

function setDefaultPointColors(points, data, dim) {
    // Here we load the "torus phase" data (the new data that we don't yet make use of).
    // This is a three-column matrix (the torus has three phase axes).
    // There is probably a more sensible place to load the data.
    fetch('./torusphase_interp.bin').then(r => r.arrayBuffer()).then(buffer => {
        const phases = new Float32Array(buffer) // array of torus-phase data (unused)
        const pointCount = points.geometry.attributes.position.count;
        const colors = new Float32Array(pointCount * 3);
        for (let i = 0; i < pointCount; i++) {

            // We use the input data array as the default coloration
            const [r, g, b] = viridisColormap(data[i*3 + dim], -4, 4);

            // To instead use the torus-phase data as default, uncomment the line below.
            // (But really, we want to make the torus-phase colors switchable, similar
            // to the single-grid-cell coloration).
            // const [r, g, b] = hsvColormapCircular(phases[i + dim*pointCount]);

            colors.set([r, g, b], i * 3);
        }
        points.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Store the default colors in a global variable
        defaultColors = colors.slice();
    })
}

let torusData = null; // Store the torus data globally

loadPointCloud(sceneTorus, './points_umap.json', (pointsObj, positionsArr) => { 
    pointsTorus = pointsObj;
    torusData = positionsArr; // Save torus data globally
    console.log(torusData);
    setDefaultPointColors(pointsTorus, torusData, 1);
}, false, materialTorus);

loadPointCloud(scene2d, './points_2d.json', (pointsObj, positionsArr) => { 
    points2d = pointsObj;
    setTimeout(function(){
        setDefaultPointColors(points2d, torusData, 1);
    }, 100) // Delay to ensure torusData is loaded
}, true, material2d);

///////////////////////////////////////////////////////////////////////////////////////////
// Thumbnail setup

// Create the thumbnail container
const thumbnailContainer = document.createElement('div');
thumbnailContainer.style.position = 'absolute';
thumbnailContainer.style.left = '50%';
thumbnailContainer.style.transform = 'translateX(-50%)';
thumbnailContainer.style.display = 'grid';
thumbnailContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(80px, 1fr))';
thumbnailContainer.style.gap = '5px';
thumbnailContainer.style.maxWidth = '80vw';
thumbnailContainer.style.justifyContent = 'center';
document.body.appendChild(thumbnailContainer);

// Fill
fetch('cell_list_3.txt')
    .then(response => response.text())
    .then(text => {
        const cellIDs = text.split('\n').map(line => line.trim()).filter(line => line !== '');
        cellIDs.forEach(cellID => {
            const img = document.createElement('img');
            img.src = `rm/${cellID}.png`;
            img.style.transform = 'rotate(-90deg)';  // Rotate counter-clockwise
            img.classList.add('thumbnail');  // Apply the CSS class
            img.addEventListener('click', () => toggleColoring(parseInt(cellID)));
            thumbnailContainer.appendChild(img);
            thumbnailElements[cellID] = img;
        });
    });

///////////////////////////////////////////////////////////////////////////////////////////
// Callbacks

function toggleColoring(cellID) {
    // Clicked the currently selected cell: deselect it
    if (selectedCells.includes(cellID)) {
        selectedCells = selectedCells.filter(id => id !== cellID);
        delete colormapAssignments[cellID];
    // Clicked a non-selected cell: select it
    } else {
        if (selectedCells.length >= MAX_SELECTED_CELLS) return;
        selectedCells.push(cellID);
        colormapAssignments[cellID] = colormaps[selectedCells.length - 1];
    }
    updateThumbnailBorders();
    updatePointsColors(pointsTorus);
    updatePointsColors(points2d);
}

function updatePointsColors(points) {
    // Sets the color for a given Points object, depending on the current
    // selection of cells. The selected cells' firing rates are mapped to 
    // their respective colormaps and added to the Points color attribute.

    // Special case: no points selected. Here we revert to the default colors
    if (selectedCells.length === 0) {
        points.geometry.attributes.color.array.set(defaultColors);
        points.geometry.attributes.color.needsUpdate = true;
        return;
    }
    
    // All other cases: additively combine the RGB-mapped activity of the 
    // selected cells.
    //
    // Create a new array for the RGB color of the points
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3).fill(0.1);
    selectedCells.forEach(cellID => {
        fetch(`./fr/${cellID}.bin`)
            .then(response => response.arrayBuffer())
            .then(buffer => {
                const firingRates = new Float32Array(buffer);
                const colormap = colormapAssignments[cellID];
                for (let i = 0; i < pointCount; i++) {
                    const [r, g, b] = colormap(firingRates[i]);
                    colors[i * 3] += r;
                    colors[i * 3 + 1] += g;
                    colors[i * 3 + 2] += b;
                }
                points.geometry.attributes.color.array.set(colors);
                points.geometry.attributes.color.needsUpdate = true;
            });
    });
}

// Set camera position / aspect
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
    const ASPECT_RATIO_THRESH = 1.0
    const aspectRatio = w/h;

    isHorzStacked = aspectRatio > ASPECT_RATIO_THRESH;
    let thumbnailVPos;

    if (isHorzStacked) {
        thumbnailVPos = 0.85;
    } else {
        thumbnailVPos = 2/3;
    }
    thumbnailContainer.style.top = `${window.innerHeight * thumbnailVPos}px`;

    renderer.setSize(w, h);
}
window.addEventListener('resize', onWindowResize);

function setDrawRect(window, renderer, composer, isHorz, numDivs, tileIndex, centerN) {

    if (!initialSizeSet && points2d && pointsTorus) {
        onWindowResize();
        initialSizeSet = true;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;

    let wszT;   // window size in tiling dimension (T)
    let wszN;   // window size in nontiling dimension (N)

    if (isHorz) {
        wszT = w;
        wszN = h;
    } else {
        wszT = h;
        wszN = w;
    }

    // The stack of tiles can be offset from the middle of the window's N dim, 
    // according to input variable "centerN". If centerN is smaller or greater 
    // than 0.5, the effective available fraction of wszN will be less than 1. 
    let fracNAvailable;
    if (centerN > 0.5) {
        // Positive offset (upwards or rightwards)
        fracNAvailable = (1-centerN) * 2;
    } else if (centerN < 0.5) {
        // Negative offset (downwards or leftwards)
        fracNAvailable = centerN * 2;
    } else if (centerN == 0.5) {
        // Center-aligned: full size available
        fracNAvailable = 1;
    }

    const wszNAvailable = wszN * fracNAvailable;

    // We want to work out what the *maximum* side-length for a square tile
    // would be, given the window's dimensions and the specified tile stacking
    const tlenView = Math.min(wszT/numDivs, wszNAvailable); // actual viewport size
    const tlenT = wszT/numDivs;                             // tile scissor size
    const tlenN = wszN;
    const tLenViewOffsetT = (tlenT - tlenView)/2;           // single-tile view offset
    const tLenViewOffsetN = (tlenN - tlenView) * centerN;


    // const offFullT = tileIndex * tlenT;  // 1 is the stacking dimension
    const offFullT = isHorz ? (tileIndex*tlenT) : ((numDivs-tileIndex-1)*tlenT);
    const offFullN = 0;                  // scissor draws whole slice of window
    const offViewT = offFullT + tLenViewOffsetT;
    const offViewN = offFullN + tLenViewOffsetN;

    // Call the two renderer rect-setting functions
    if (isHorz) {
        renderer.setScissor(offFullT, offFullN, tlenT, tlenN);
        renderer.setViewport(offViewT, offViewN, tlenView, tlenView);
    } else {
        renderer.setScissor(offFullN, offFullT, tlenN, tlenT);
        renderer.setViewport(offViewN, offViewT, tlenView, tlenView);
    }

    if (composer) {
        composer.setSize(tlenView, tlenView);
    }

    // console.log(`offFullT=${offFullT}, offFullN=${offFullN}, offViewT=${offViewT}, offViewN=${offViewN}, tlenT=${tlenT}, tlenN=${tlenN}, tlenView=${tlenView}`)

    return tlenView;

}

function animate() {
    requestAnimationFrame(animate);
    controlsTorus.update();

    // First, disable scissor test and clear the entire canvas
    renderer.setScissorTest(false);
    renderer.clear(); // Clears the whole canvas using the clear color

    // Now re-enable scissor test for the composer's viewports
    renderer.setScissorTest(true);


    let nTiles;
    if (isHorzStacked) {
        nTiles = 2;
    } else {
        nTiles = 3;
    }


    // Render torus scene
    const tsz = setDrawRect(window, renderer, composerTorus, isHorzStacked, nTiles, 0, STACK_CENTER_POS);
    const scaleFactor = Math.sqrt(tsz);
    materialTorus.size = BASE_POINT_SIZE_TORUS * scaleFactor;
    material2d.size = BASE_POINT_SIZE_2D * scaleFactor;
    composerTorus.render();

    // Render 2d scene
    setDrawRect(window, renderer, composer2d, isHorzStacked, nTiles, 1, STACK_CENTER_POS);
    composer2d.render();

    // Optionally, disable scissor test for any further operations
    renderer.setScissorTest(false);
}

animate();

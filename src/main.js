// This version plots the UMAP torus, adds a nice glow effect, and implements firing-rate map thumbnails with torus recoloring

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const NUM_CELLS = 199;
const MAX_SELECTED_CELLS = 3;
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

function singleChannelColormap(value, limLo, limHi, channel) {
    let t = (value - limLo) / (limHi - limLo);
    const baseValue = 0.1
    t = Math.max(baseValue, Math.min(1, t));
    let rgb = [baseValue, baseValue, baseValue];
    rgb[channel] = t;
    return rgb;
}

// function hotColormap(value) {
//     let t = Math.max(0, Math.min(1, value));
//     return [Math.min(1, t * 3), Math.max(0, Math.min(1, t * 3 - 1)), Math.max(0, Math.min(1, t * 3 - 2))];
// }

// function coolColormap(value) {
//     let t = Math.max(0, Math.min(1, value));
//     return [Math.max(0, Math.min(1, t * 2 - 1)), Math.max(0, Math.min(1, t * 3)), Math.min(1, t * 3)];
// }
// 
// function magentaColormap(value) {
//     let t = Math.max(0, Math.min(1, value));
//     return [Math.max(0, Math.min(1, t * 3 - 1)), Math.max(0, Math.min(1, t * 3 - 2)), Math.min(1, t * 3)];
// }

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
    // return [Math.max(0, Math.min(1, t * 3 - 1)), Math.max(0, Math.min(1, t * 3 - 2)), Math.min(1, t * 3)];
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

// function updateThumbnailBorders() {
//     Object.keys(thumbnailElements).forEach(cellID => {
//         const img = thumbnailElements[cellID];
//         if (selectedCells.includes(parseInt(cellID))) {
//             const colormap = colormapAssignments[cellID];
//             const midColor = colormap(0.75).map(v => Math.round(v * 255));
//             console.log(midColor);
//             img.style.border = `2px solid rgb(${midColor[0]}, ${midColor[1]}, ${midColor[2]})`;
//         } else {
//             img.style.border = '2px solid transparent';
//         }
//     });
// }


// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(120, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1, 1, 0.0)); // strength, radius, threshold

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth camera movement
controls.autoRotate = true; // Enable auto-rotation
controls.autoRotateSpeed = 0.25; // 100 seconds per rotation
controls.enablePan = false; // Disable panning
controls.enableZoom = true; // Disable zooming


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

const material = new THREE.PointsMaterial({ 
    vertexColors: true,
    size: 0.05,
    map: texture,           // Apply soft glow texture
    transparent: true,      // Enable transparency
    blending: THREE.AdditiveBlending,
    depthWrite: false, 
});

////////////////////////////////////////////////////////////////////////////////////////
// Create point cloud from JSON file

fetch('points_umap.json')
    .then(response => response.json())
    .then(data => {
        const pointCount = data.length;
        console.log(`Loaded ${pointCount} points`);

        // Compute sum of all coordinates
        let sumX = 0, sumY = 0, sumZ = 0;
        for (let i = 0; i < pointCount; i++) {
            sumX += data[i][0];
            sumY += data[i][1];
            sumZ += data[i][2];
        }
        // Compute centroid (average position)
        const centerX = sumX / pointCount;
        const centerY = sumY / pointCount;
        const centerZ = sumZ / pointCount;
        console.log("Centroid:", centerX, centerY, centerZ); // Debugging

        const colors = new Float32Array(pointCount * 3);
        const positions = new Float32Array(pointCount * 3);
        for (let i = 0; i < pointCount; i++) {
            positions[i * 3] = data[i][0] - centerX; // X
            positions[i * 3 + 1] = data[i][1] - centerY; // Y
            positions[i * 3 + 2] = data[i][2] - centerZ; // Z

            const value = positions[i * 3 + 1]; // Use X coordinate as value
            const [r, g, b] = viridisColormap(value, -4, 4);
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        points = new THREE.Points(geometry, material);
        defaultColors = colors.slice();
        scene.add(points);
    });

// Thumbnail display
const thumbnailContainer = document.createElement('div');
thumbnailContainer.style.position = 'absolute';
thumbnailContainer.style.bottom = '20px';
thumbnailContainer.style.left = '50%';
thumbnailContainer.style.transform = 'translateX(-50%)';
thumbnailContainer.style.display = 'grid';
thumbnailContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(80px, 1fr))';
thumbnailContainer.style.gap = '5px';
thumbnailContainer.style.maxWidth = '80vw';
thumbnailContainer.style.justifyContent = 'center';
document.body.appendChild(thumbnailContainer);

fetch('cell_list.txt')
    .then(response => response.text())
    .then(text => {
        const cellIDs = text.split('\n').map(line => line.trim()).filter(line => line !== '');
        cellIDs.forEach(cellID => {
            const img = document.createElement('img');
            img.src = `rm/${cellID}.png`;
            img.style.width = '80px';
            img.style.height = '80px';
            img.style.cursor = 'pointer';
            img.style.border = '2px solid transparent';
            img.addEventListener('click', () => toggleTorusColoring(parseInt(cellID)));
            thumbnailContainer.appendChild(img);
            thumbnailElements[cellID] = img;
        });
    });

// for (let cellID = 1; cellID <= NUM_CELLS; cellID++) {
//     const img = document.createElement('img');
//     img.src = `rm/${cellID}.png`;
//     img.style.width = '40px';
//     img.style.height = '40px';
//     img.style.cursor = 'pointer';
//     img.style.border = '2px solid transparent';
//     // img.addEventListener('mouseenter', () => img.style.border = '2px solid white');
//     // img.addEventListener('mouseleave', () => img.style.border = '2px solid transparent');
//     img.addEventListener('click', () => toggleTorusColoring(cellID, img));
//     thumbnailContainer.appendChild(img);
//     thumbnailElements[cellID] = img;
// }

function toggleTorusColoring(cellID) {
    if (selectedCells.includes(cellID)) {
        selectedCells = selectedCells.filter(id => id !== cellID);
        delete colormapAssignments[cellID];
        // img.style.border = '2px solid transparent';
    } else {
        if (selectedCells.length >= MAX_SELECTED_CELLS) return;
        selectedCells.push(cellID);
        colormapAssignments[cellID] = colormaps[selectedCells.length - 1];
        // img.style.border = `2px solid rgb(${colormapAssignments[cellID](1).map(v => v * 255).join(',')})`;
    }
    updateThumbnailBorders();
    updateTorusColors();
}

function updateTorusColors() {
    if (selectedCells.length === 0) {
        points.geometry.attributes.color.array.set(defaultColors);
        points.geometry.attributes.color.needsUpdate = true;
        return;
    }
    
    const pointCount = points.geometry.attributes.position.count;
    const colors = new Float32Array(pointCount * 3).fill(0.1);
    selectedCells.forEach(cellID => {
        fetch(`fr/${cellID}.bin`)
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

camera.position.z = 10;
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    composer.render();
}
animate();

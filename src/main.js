// Import Three.js and OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function viridisColormap(value, limLo, limHi) {
    // Predefined Viridis colormap (interpolated from matplotlib)
    const colormap = [
        [68, 1, 84], [72, 35, 116], [64, 67, 135], [52, 94, 141],
        [41, 120, 142], [32, 144, 140], [34, 167, 132], [68, 190, 112],
        [121, 209, 81], [189, 222, 38], [253, 231, 37]
    ];

    // Normalize value from [-100, 100] to [0, 1]
    let t = (value - limLo) / (limHi - limLo);
    t = Math.max(0, Math.min(1, t));  // Clamp to [0, 1]
    const index = Math.min(Math.floor(t * (colormap.length - 1)), colormap.length - 2);
    const mix = t * (colormap.length - 1) - index;

    // Linear interpolation between two colors
    const c1 = colormap[index], c2 = colormap[index + 1];
    const r = (1 - mix) * c1[0] + mix * c2[0];
    const g = (1 - mix) * c1[1] + mix * c2[1];
    const b = (1 - mix) * c1[2] + mix * c2[2];

    return [r / 255, g / 255, b / 255];  // Normalize to [0,1] for Three.js
}

// Create the scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(120, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth camera movement


////////////////////////////////////////////////////////////////////////////////////////
// Set up soft glow texture
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;
const ctx = canvas.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
gradient.addColorStop(0, 'rgba(255,255,255,0.8)');  // Bright center
gradient.addColorStop(1, 'rgba(255,255,255,0)');  // Fade out edges
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);
const texture = new THREE.CanvasTexture(canvas);

const material = new THREE.PointsMaterial({ 
    vertexColors: true,
    size: 0.05,             // Adjust as needed
    map: texture,           // Apply soft glow texture
    transparent: true,      // Enable transparency
    blending: THREE.AdditiveBlending, 
    depthWrite: false 
});

////////////////////////////////////////////////////////////////////////////////////////
// Create point cloud from JSON file

fetch('points.json')
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

        // Assign the new data to geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // ✅ Now that geometry is ready, create and add points
        const points = new THREE.Points(geometry, material);
        scene.add(points);
    });


// Set the camera position
camera.position.z = 10;

// Handle window resizing
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

// Animation loop
const animate = () => {
    requestAnimationFrame(animate);
    controls.update(); // Update camera controls
    renderer.render(scene, camera);
};
animate();

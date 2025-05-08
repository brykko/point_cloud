// utils.js
import * as THREE from 'three';

// ----- Data Loading Utilities -----
export async function loadJSON(url) {
  const response = await fetch(url);
  return response.json();
}

export async function loadBinary(url) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return new Float32Array(buffer);
}

// ----- Color Map Utilities -----
export function viridisColormap(value, limLo, limHi) {
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

export function hsvColormapCircular(value, minVal = -Math.PI, maxVal = Math.PI) {
  let t = (value - minVal) / (maxVal - minVal);
  t = Math.max(0, Math.min(1, t));
  let hue = t * 360;
  return hsvToRgb(hue, 1.0, 1.0);
}

export function hsvToRgb(h, s, v) {
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

function cscale(multiplier, offset, value) {
  return Math.max(0, Math.min(1, value * multiplier + offset))
}

export function hotColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  // return [Math.min(1, t * 2), Math.max(0, Math.min(1, t * 3 - 1)), 0];
  return [cscale(2, 0, t), cscale(3, -1, t), 0];
}

export function coolColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  // return [0, Math.max(0, Math.min(1, t * 3 - 1)), Math.min(1, t * 3)];
  return [0, cscale(3, -1, t), cscale(3, 0, t)];
}

export function magentaColormap(value) {
  let t = Math.max(0, Math.min(1, value));
  // return [Math.max(0, Math.min(1, t * 3 - 1)), 0, Math.max(0, Math.min(1, t * 2 - 1))];
  return [cscale(5, -1, t), cscale(2, -1, t), cscale(5, -1, t)];
}


// ----- Textures -----

// The soft glow texture (shared by both materials) is already created in your utils
// (or you can keep your original code here if you prefer)
const canvasTexture = document.createElement('canvas');
canvasTexture.width = 128;
canvasTexture.height = 128;
const ctx = canvasTexture.getContext('2d');
const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
gradient.addColorStop(0, 'rgba(255,255,255,0.3)');  // Bright center
gradient.addColorStop(1, 'rgba(255,255,255,0)');    // Fading edge
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);
export const softGlowTexture = new THREE.CanvasTexture(canvasTexture);
softGlowTexture.encoding = THREE.SRGBColorSpace;

// Create a circular texture for the sprite (or load one)
const circleCanvas = document.createElement('canvas');
circleCanvas.width = 128;
circleCanvas.height = 128;
const ctxCircle = circleCanvas.getContext('2d');
ctxCircle.beginPath();
ctxCircle.arc(64, 64, 60, 0, Math.PI * 2);
ctxCircle.fillStyle = '#ffffff';
ctxCircle.fill();
const circleTexture = new THREE.CanvasTexture(circleCanvas);

// Create a sprite material using the circle texture
export const spriteMaterial = new THREE.SpriteMaterial({
  map: circleTexture,
  color: 0xffffff,
  transparent: true});


export function calcViewTileSize(w, h, isHorz, numDivs, centerN) {
  let wszT = isHorz ? w : h;
  let wszN = isHorz ? h : w;
  let fracNAvailable = centerN > 0.5 ? (1 - centerN) * 2 : (centerN < 0.5 ? centerN * 2 : 1);
  const wszNAvailable = wszN * fracNAvailable;
  const tlenT = wszT / numDivs;
  const tlenN = wszN;
  const tlenView = Math.min(tlenT, wszNAvailable);
  return {view:tlenView, dimN:tlenN, dimT:tlenT}
}

// ----- Layout Utility -----
export function setDrawRect(w, h, renderer, composer, isHorz, numDivs, tileIndex, centerN) {
  // const w = windowObj.innerWidth;
  // const h = windowObj.innerHeight;
  // let wszT = isHorz ? w : h;
  // let wszN = isHorz ? h : w;
  // let fracNAvailable = centerN > 0.5 ? (1 - centerN) * 2 : (centerN < 0.5 ? centerN * 2 : 1);
  // const wszNAvailable = wszN * fracNAvailable;
  // const tlenT = wszT / numDivs;
  // const tlenN = wszN;
  // const tlenView = Math.min(tlenT, wszNAvailable);

  const sz = calcViewTileSize(w, h, isHorz, numDivs, centerN);
  const tlenT = sz.dimT;
  const tlenN = sz.dimN;
  const tlenView = sz.view;

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
  // renderer.clearColor(0, 0, 0, 0);  // last arg = alpha 0
  // renderer.clear();
  // console.log("tlenView:", tlenView);
  if (composer) {
    // composer.setSize(tlenView, tlenView);
  }
  return tlenView;
}


// ----- Other misc helpers ----- 

export function parseUrlBoolOption(urlParams, name, defval) {
  return  Boolean(parseInt(urlParams.get(name) || defval));
}
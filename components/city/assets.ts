import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "@/lib/city";

/* ------------------------------------------------------------------ */
/* Procedural textures (no network, no asset loading = nothing can     */
/* leave the canvas blank while waiting)                               */
/* ------------------------------------------------------------------ */

/** One window texture tile covers this many world units. */
const TILE_W = 4;
const TILE_H = 8;

let windowTexture: THREE.CanvasTexture | null = null;
export function getWindowTexture() {
  if (windowTexture) return windowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 256, 512);
  const rand = rng(4242);
  const litColumn = new Set([Math.floor(rand() * 8), Math.floor(rand() * 8)]);
  for (let row = 0; row < 16; row++) {
    const band = rand() < 0.09;
    for (let col = 0; col < 8; col++) {
      const lit = band || litColumn.has(col) ? rand() < 0.92 : rand() < 0.48;
      const v = lit ? 0.5 + rand() * 0.5 : 0.04 + rand() * 0.07;
      const shade = Math.round(v * 255);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(col * 32 + 6, row * 32 + 7, 20, 17);
    }
  }
  windowTexture = new THREE.CanvasTexture(canvas);
  windowTexture.wrapS = windowTexture.wrapT = THREE.RepeatWrapping;
  windowTexture.colorSpace = THREE.SRGBColorSpace;
  windowTexture.anisotropy = 4;
  return windowTexture;
}

let emberTexture: THREE.CanvasTexture | null = null;
function getEmberTexture() {
  if (emberTexture) return emberTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 128, 128);
  const rand = rng(77);
  for (let i = 0; i < 70; i++) {
    const x = rand() * 128;
    const y = rand() * 128;
    const r = 1 + rand() * 5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r * 2);
    grad.addColorStop(0, `rgba(255,${120 + Math.floor(rand() * 90)},40,1)`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
  }
  emberTexture = new THREE.CanvasTexture(canvas);
  emberTexture.wrapS = emberTexture.wrapT = THREE.RepeatWrapping;
  emberTexture.colorSpace = THREE.SRGBColorSpace;
  return emberTexture;
}

const labelCache = new Map<string, THREE.CanvasTexture>();
export function getLabelTexture(text: string, color: string) {
  const key = `${text}|${color}`;
  const hit = labelCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const r = 30;
  g.beginPath();
  g.moveTo(r + 6, 6);
  g.arcTo(506, 6, 506, 122, r);
  g.arcTo(506, 122, 6, 122, r);
  g.arcTo(6, 122, 6, 6, r);
  g.arcTo(6, 6, 506, 6, r);
  g.closePath();
  g.fillStyle = "rgba(9,6,24,0.88)";
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.arc(54, 64, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "800 54px ui-monospace, 'JetBrains Mono', Menlo, monospace";
  g.textBaseline = "middle";
  g.fillText(text, 88, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, texture);
  return texture;
}

/* ------------------------------------------------------------------ */
/* Shared materials (one per neon colour keeps draw state tiny)        */
/* ------------------------------------------------------------------ */

const bodyMaterials = new Map<string, THREE.MeshStandardMaterial>();
export function getBodyMaterial(color: string) {
  let material = bodyMaterials.get(color);
  if (!material) {
    const neon = new THREE.Color(color);
    material = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1a2044").lerp(neon, 0.22),
      emissive: neon,
      emissiveMap: getWindowTexture(),
      emissiveIntensity: 2.3,
      roughness: 0.42,
      metalness: 0.5,
    });
    bodyMaterials.set(color, material);
  }
  return material;
}

const trimMaterials = new Map<string, THREE.MeshBasicMaterial>();
export function getTrimMaterial(color: string) {
  let material = trimMaterials.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false });
    trimMaterials.set(color, material);
  }
  return material;
}

let rubbleMaterial: THREE.MeshStandardMaterial | null = null;
export function getRubbleMaterial() {
  if (!rubbleMaterial) {
    rubbleMaterial = new THREE.MeshStandardMaterial({
      color: "#3a3346",
      roughness: 0.92,
      metalness: 0.1,
      emissive: "#ff5a1f",
      emissiveMap: getEmberTexture(),
      emissiveIntensity: 2.2,
    });
  }
  return rubbleMaterial;
}

export const beaconMaterial = () => new THREE.MeshBasicMaterial({ color: "#ff3355", toneMapped: false });

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const DARK_UV = 0.003; // lands in the gap between windows

function darkUV(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, DARK_UV, DARK_UV);
  return geo;
}

/** Box with windows on the four sides, scaled so windows keep a real size. */
function windowBox(w: number, h: number, d: number, offU: number, offV: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4); // px, nx, py, ny, pz, nz
    if (face === 2 || face === 3) {
      uv.setXY(i, DARK_UV, DARK_UV);
      continue;
    }
    const span = face < 2 ? d : w;
    uv.setXY(i, (uv.getX(i) * span) / TILE_W + offU, (uv.getY(i) * h) / TILE_H + offV);
  }
  return geo;
}

function windowCylinder(rTop: number, rBottom: number, h: number, segments: number, offU: number, offV: number) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, false);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const torso = (segments + 1) * 2;
  const circumference = Math.PI * (rTop + rBottom);
  for (let i = 0; i < uv.count; i++) {
    if (i >= torso) uv.setXY(i, DARK_UV, DARK_UV);
    else uv.setXY(i, (uv.getX(i) * circumference) / TILE_W + offU, (uv.getY(i) * h) / TILE_H + offV);
  }
  return geo;
}

function at<T extends THREE.BufferGeometry>(geo: T, x: number, y: number, z: number, ry = 0, rx = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

function edgeStrips(trim: THREE.BufferGeometry[], w: number, d: number, h: number, y0: number, thickness = 0.07) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    trim.push(at(new THREE.BoxGeometry(thickness, h, thickness), (sx * w) / 2, y0 + h / 2, (sz * d) / 2));
  }
}

function crown(trim: THREE.BufferGeometry[], w: number, d: number, y: number) {
  // A glowing outline at a roof edge.
  const t = 0.1;
  trim.push(at(new THREE.BoxGeometry(w + 0.08, t, t), 0, y, d / 2));
  trim.push(at(new THREE.BoxGeometry(w + 0.08, t, t), 0, y, -d / 2));
  trim.push(at(new THREE.BoxGeometry(t, t, d + 0.08), w / 2, y, 0));
  trim.push(at(new THREE.BoxGeometry(t, t, d + 0.08), -w / 2, y, 0));
}

function lotPad(trim: THREE.BufferGeometry[], size: number) {
  const s = size / 2;
  const t = 0.09;
  trim.push(at(new THREE.BoxGeometry(size, 0.04, t), 0, 0.03, s));
  trim.push(at(new THREE.BoxGeometry(size, 0.04, t), 0, 0.03, -s));
  trim.push(at(new THREE.BoxGeometry(t, 0.04, size), s, 0.03, 0));
  trim.push(at(new THREE.BoxGeometry(t, 0.04, size), -s, 0.03, 0));
}

export type TowerGeometry = {
  body: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  /** Highest point of the model at full height. */
  top: number;
  beacon: [number, number, number];
  rotation: number;
};

/**
 * Seven architectural archetypes. Every part of a tower is merged into
 * two meshes (windows body + neon trim) so a full city stays cheap on phones.
 */
export function buildTowerGeometry(style: number, width: number, height: number, seed: number): TowerGeometry {
  const rand = rng(seed);
  const w = width;
  const h = Math.max(2.5, height);
  const offU = Math.floor(rand() * 8) * 0.125;
  const offV = Math.floor(rand() * 16) * 0.0625;
  const body: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  let top = h;
  let beacon: [number, number, number] = [0, h + 0.2, 0];

  switch (style) {
    case 0: {
      // Setback slab with antenna
      const d = w * 0.86;
      const lower = h * 0.82;
      body.push(at(windowBox(w, lower, d, offU, offV), 0, lower / 2, 0));
      const upper = h - lower;
      body.push(at(windowBox(w * 0.66, upper, d * 0.7, offU, offV), 0, lower + upper / 2, 0));
      edgeStrips(trim, w, d, lower, 0);
      crown(trim, w, d, lower);
      crown(trim, w * 0.66, d * 0.7, h);
      trim.push(at(new THREE.CylinderGeometry(0.05, 0.09, 2.4, 6), 0, h + 1.2, 0));
      top = h + 2.4;
      beacon = [0, h + 2.45, 0];
      break;
    }
    case 1: {
      // Ziggurat: three stepped tiers and a pyramid cap
      const tiers = [
        [w, 0.5],
        [w * 0.76, 0.3],
        [w * 0.52, 0.2],
      ];
      let y = 0;
      for (const [tw, share] of tiers) {
        const th = h * share;
        body.push(at(windowBox(tw, th, tw, offU, offV), 0, y + th / 2, 0));
        y += th;
        crown(trim, tw, tw, y);
      }
      const cap = darkUV(new THREE.ConeGeometry(w * 0.37, 1.6, 4));
      body.push(at(cap, 0, h + 0.8, 0, Math.PI / 4));
      trim.push(at(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 5), 0, h + 2.2, 0));
      top = h + 2.9;
      beacon = [0, h + 2.95, 0];
      break;
    }
    case 2: {
      // Round tower with neon rings and a dome
      const r = w * 0.5;
      const bodyH = h * 0.94;
      body.push(at(windowCylinder(r, r, bodyH, 22, offU, offV), 0, bodyH / 2, 0));
      const dome = darkUV(new THREE.SphereGeometry(r, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2));
      body.push(at(dome, 0, bodyH, 0));
      for (const f of [0.28, 0.56, 0.84]) {
        trim.push(at(new THREE.TorusGeometry(r + 0.05, 0.06, 6, 36), 0, bodyH * f, 0, 0, Math.PI / 2));
      }
      trim.push(at(new THREE.CylinderGeometry(0.04, 0.1, 2, 6), 0, bodyH + r + 0.9, 0));
      top = bodyH + r + 1.9;
      beacon = [0, top + 0.05, 0];
      break;
    }
    case 3: {
      // Twin towers joined by a skybridge
      const tw = w * 0.42;
      const d = w * 0.8;
      const h2 = h * 0.78;
      body.push(at(windowBox(tw, h, d, offU, offV), -w * 0.29, h / 2, 0));
      body.push(at(windowBox(tw, h2, d, offU + 0.25, offV), w * 0.29, h2 / 2, 0));
      body.push(at(windowBox(w * 0.2, 0.55, d * 0.5, offU, offV), 0, h2 * 0.72, 0));
      trim.push(at(new THREE.BoxGeometry(w * 0.2, 0.08, d * 0.52), 0, h2 * 0.72 - 0.3, 0));
      crown(trim, tw, d, h);
      crown(trim, tw, d, h2);
      trim.push(at(new THREE.CylinderGeometry(0.04, 0.08, 2.2, 6), -w * 0.29, h + 1.1, 0));
      top = h + 2.2;
      beacon = [-w * 0.29, h + 2.25, 0];
      break;
    }
    case 4: {
      // Hexagonal prism with a faceted cap
      const r = w * 0.56;
      const bodyH = h * 0.9;
      body.push(at(windowCylinder(r, r * 0.92, bodyH, 6, offU, offV), 0, bodyH / 2, 0));
      body.push(at(darkUV(new THREE.ConeGeometry(r * 0.92, h - bodyH + 1, 6)), 0, bodyH + (h - bodyH + 1) / 2, 0));
      trim.push(at(new THREE.TorusGeometry(r * 0.95, 0.07, 4, 6), 0, bodyH, 0, Math.PI / 6, Math.PI / 2));
      trim.push(at(new THREE.TorusGeometry(r * 1.02, 0.05, 4, 6), 0, 0.15, 0, Math.PI / 6, Math.PI / 2));
      top = h + 1;
      beacon = [0, h + 1.05, 0];
      break;
    }
    case 5: {
      // Tapered needle on a podium
      const podium = h * 0.28;
      body.push(at(windowBox(w, podium, w, offU, offV), 0, podium / 2, 0));
      const shaft = h - podium;
      body.push(at(windowCylinder(w * 0.2, w * 0.46, shaft, 4, offU, offV), 0, podium + shaft / 2, 0, Math.PI / 4));
      crown(trim, w, w, podium);
      edgeStrips(trim, w, w, podium, 0);
      trim.push(at(new THREE.CylinderGeometry(0.03, 0.13, 3.4, 6), 0, h + 1.7, 0));
      top = h + 3.4;
      beacon = [0, h + 3.45, 0];
      break;
    }
    default: {
      // Blade slab with neon fins and a rooftop billboard
      const bw = w * 1.15;
      const d = w * 0.44;
      body.push(at(windowBox(bw, h, d, offU, offV), 0, h / 2, 0));
      trim.push(at(new THREE.BoxGeometry(0.1, h, d + 0.18), bw / 2 + 0.02, h / 2, 0));
      trim.push(at(new THREE.BoxGeometry(0.1, h, d + 0.18), -bw / 2 - 0.02, h / 2, 0));
      trim.push(at(new THREE.BoxGeometry(bw * 0.82, 1.1, 0.1), 0, h + 0.75, 0));
      body.push(at(darkUV(new THREE.BoxGeometry(0.12, 0.6, 0.12)), -bw * 0.3, h + 0.3, 0));
      body.push(at(darkUV(new THREE.BoxGeometry(0.12, 0.6, 0.12)), bw * 0.3, h + 0.3, 0));
      top = h + 1.3;
      beacon = [bw / 2, h + 0.1, 0];
      break;
    }
  }

  lotPad(trim, w + 0.7);

  const merged = {
    body: mergeGeometries(body, false)!,
    trim: mergeGeometries(trim, false)!,
  };
  body.forEach((g) => g.dispose());
  trim.forEach((g) => g.dispose());
  return { ...merged, top, beacon, rotation: Math.floor(rand() * 4) * (Math.PI / 2) };
}

/** A heap of broken slabs, sized to the tower that fell. */
export function buildRubbleGeometry(width: number, height: number, seed: number) {
  const rand = rng(seed ^ 0x9e3779b9);
  const parts: THREE.BufferGeometry[] = [];
  const pieces = 7 + Math.floor(Math.min(height, 20) / 2.5);
  const spread = width * 0.75;
  for (let i = 0; i < pieces; i++) {
    const s = 0.35 + rand() * (0.5 + Math.min(height, 20) * 0.03);
    const geo = new THREE.BoxGeometry(s * (1 + rand()), s * (0.5 + rand() * 0.6), s * (1 + rand()));
    geo.rotateX((rand() - 0.5) * 1.2);
    geo.rotateZ((rand() - 0.5) * 1.2);
    geo.rotateY(rand() * Math.PI);
    const a = rand() * Math.PI * 2;
    const dist = rand() * spread;
    geo.translate(Math.cos(a) * dist, s * 0.3 + (i < 3 ? 0.3 : 0), Math.sin(a) * dist);
    parts.push(geo);
  }
  // A jagged stump of the old tower.
  const stump = new THREE.BoxGeometry(width * 0.55, 0.9 + rand() * 1.1, width * 0.5);
  stump.rotateZ(0.12);
  stump.translate(0, 0.5, 0);
  parts.push(stump);
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

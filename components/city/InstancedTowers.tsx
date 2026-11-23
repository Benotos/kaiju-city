"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CityBuilding } from "@/lib/types";
import { getWindowTexture } from "./assets";

/**
 * Every holder outside the detailed top tier. Towers are split into six
 * architectural archetypes; each archetype is one instanced body mesh plus
 * one instanced glowing roof, so ~1,500 varied towers cost about a dozen
 * draw calls and stay smooth on phones.
 */

type Archetype = {
  name: string;
  /** Body geometry normalised to height 1, footprint ~1, base at y=0. */
  body: () => THREE.BufferGeometry;
  /** Roof geometry, base at y=0, scaled by footprint (not by height). */
  roof: () => THREE.BufferGeometry;
  /** How much the window texture wraps horizontally (π for round shapes). */
  uScale: number;
};

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
};
const merged = (parts: THREE.BufferGeometry[]) => {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat, false)!;
  parts.forEach((p) => p.dispose());
  flat.forEach((p) => p.dispose());
  return g;
};

const ARCHETYPES: Archetype[] = [
  {
    name: "slab",
    body: () => box(1, 1, 0.8),
    roof: () => merged([box(1.06, 0.09, 0.86), box(0.05, 1.6, 0.05, 0.3, 0.09, 0)]),
    uScale: 1,
  },
  {
    name: "round",
    body: () => {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1);
      g.translate(0, 0.5, 0);
      return g;
    },
    roof: () => {
      const dome = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const ring = new THREE.TorusGeometry(0.52, 0.04, 4, 24);
      ring.rotateX(Math.PI / 2);
      return merged([dome, ring]);
    },
    uScale: Math.PI,
  },
  {
    name: "hex",
    body: () => {
      const g = new THREE.CylinderGeometry(0.52, 0.56, 1, 6, 1);
      g.translate(0, 0.5, 0);
      return g;
    },
    roof: () => {
      const g = new THREE.ConeGeometry(0.54, 0.7, 6);
      g.translate(0, 0.35, 0);
      return g;
    },
    uScale: 3,
  },
  {
    name: "needle",
    body: () => {
      const g = new THREE.CylinderGeometry(0.24, 0.56, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.translate(0, 0.5, 0);
      return g;
    },
    roof: () => {
      const g = new THREE.CylinderGeometry(0.02, 0.07, 1.8, 5);
      g.translate(0, 0.9, 0);
      return g;
    },
    uScale: 2.2,
  },
  {
    name: "stepped",
    body: () => merged([box(1, 0.62, 1), box(0.7, 0.38, 0.7, 0, 0.62)]),
    roof: () => merged([box(0.76, 0.08, 0.76), box(0.36, 0.3, 0.36, 0, 0.08)]),
    uScale: 1,
  },
  {
    name: "twin",
    body: () => merged([box(0.42, 1, 0.8, -0.29), box(0.42, 0.82, 0.8, 0.29), box(0.2, 0.08, 0.5, 0, 0.6)]),
    roof: () => merged([box(0.46, 0.08, 0.84, -0.29), box(0.04, 1.4, 0.04, -0.29, 0.08)]),
    uScale: 0.6,
  },
];

function makeBodyMaterial(uScale: number) {
  const material = new THREE.MeshStandardMaterial({
    color: "#25345a",
    emissive: "#ffffff",
    emissiveMap: getWindowTexture(),
    emissiveIntensity: 1.8,
    roughness: 0.45,
    metalness: 0.45,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
#if defined( USE_INSTANCING ) && defined( USE_EMISSIVEMAP )
  {
    vec2 size = vec2( length( instanceMatrix[0].xyz ) * ${uScale.toFixed(3)}, length( instanceMatrix[1].xyz ) );
    vec2 offset = floor( fract( instanceMatrix[3].xz * 0.173 ) * vec2( 8.0, 16.0 ) ) * vec2( 0.125, 0.0625 );
    vEmissiveMapUv = abs( normal.y ) > 0.5 ? vec2( 0.003 ) : vec2( uv.x * size.x / 4.0, uv.y * size.y / 8.0 ) + offset;
  }
#endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
#ifdef USE_COLOR
  totalEmissiveRadiance *= vColor.rgb;
#endif`,
    );
  };
  // One compiled shader per window-wrap factor.
  material.customProgramCacheKey = () => `stomp-instanced-${uScale}`;
  return material;
}

export function archetypeOf(building: CityBuilding) {
  return (building.seed >>> 5) % ARCHETYPES.length;
}

export function InstancedTowers({ buildings, onSelect }: { buildings: CityBuilding[]; onSelect?: (wallet: string) => void }) {
  const groups = useMemo(() => {
    const out: CityBuilding[][] = ARCHETYPES.map(() => []);
    for (const b of buildings) out[archetypeOf(b)].push(b);
    return out;
  }, [buildings]);
  return (
    <>
      {ARCHETYPES.map((archetype, i) => (
        <ArchetypeLayer key={archetype.name} archetype={archetype} buildings={groups[i]} onSelect={onSelect} />
      ))}
    </>
  );
}

function ArchetypeLayer({ archetype, buildings, onSelect }: { archetype: Archetype; buildings: CityBuilding[]; onSelect?: (wallet: string) => void }) {
  // Grow capacity in chunks so meshes are only rebuilt when the city outgrows them.
  const capacity = Math.max(64, Math.ceil(buildings.length / 128) * 128);
  return <Layer key={capacity} capacity={capacity} archetype={archetype} buildings={buildings} onSelect={onSelect} />;
}

function Layer({ archetype, buildings, capacity, onSelect }: { archetype: Archetype; buildings: CityBuilding[]; capacity: number; onSelect?: (wallet: string) => void }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const roof = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(new Map<string, number>());
  const dirty = useRef(true);

  const bodyGeometry = useMemo(() => archetype.body(), [archetype]);
  const roofGeometry = useMemo(() => archetype.roof(), [archetype]);
  const bodyMaterial = useMemo(() => makeBodyMaterial(archetype.uScale), [archetype]);
  const roofMaterial = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const hsl = useMemo(() => ({ h: 0, s: 0, l: 0 }), []);
  useEffect(() => () => {
    bodyGeometry.dispose();
    roofGeometry.dispose();
    bodyMaterial.dispose();
    roofMaterial.dispose();
  }, [bodyGeometry, roofGeometry, bodyMaterial, roofMaterial]);

  useEffect(() => {
    const b = body.current;
    const r = roof.current;
    if (!b || !r) return;
    buildings.forEach((building, i) => {
      // Tints both the body and its windows, so every tower carries its own colour.
      color.set(building.color).getHSL(hsl);
      // Saturated tint: pale palette colours would wash the windows out to white.
      color.setHSL(hsl.h, Math.max(hsl.s, 0.8), 0.56);
      b.setColorAt(i, color);
      color.set(building.color).multiplyScalar(1.6);
      r.setColorAt(i, color);
    });
    b.count = buildings.length;
    r.count = buildings.length;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
    const ids = new Set(buildings.map((x) => x.id));
    for (const id of shown.current.keys()) if (!ids.has(id)) shown.current.delete(id);
    dirty.current = true;
  }, [buildings, color, hsl]);

  useFrame((_, rawDelta) => {
    const b = body.current;
    const r = roof.current;
    if (!b || !r || buildings.length === 0) return;
    const delta = Math.min(rawDelta, 0.05);
    const now = Date.now();
    const force = dirty.current;
    let changed = force;
    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      const prev = shown.current.get(building.id);
      let current = prev ?? (now - building.bornAt < 1200 ? 0 : building.height);
      let target = building.height;
      if (now < building.bornAt) target = 0;
      if (building.hitAt > now) target = current; // hold until the kaiju lands
      else if (building.status === "rubble") target = 0;
      const speed = building.status === "rubble" ? 7 : current < target ? 3.2 : 4.5;
      const next = Math.abs(target - current) < 0.01 ? target : current + (target - current) * (1 - Math.exp(-delta * speed));
      if (prev === undefined || force || Math.abs(next - current) > 0.0005) {
        current = next;
        shown.current.set(building.id, current);
        const w = building.width;
        const depth = 0.8 + ((building.seed >>> 3) % 40) / 100;
        const rot = ((building.seed >>> 1) % 4) * (Math.PI / 2);
        const h = Math.max(0.001, current);
        dummy.position.set(building.x, 0, building.z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(w, h, w * depth);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
        const visible = h > 0.4;
        dummy.position.set(building.x, h, building.z);
        dummy.scale.set(visible ? w : 0, visible ? w : 0, visible ? w * depth : 0);
        dummy.updateMatrix();
        r.setMatrixAt(i, dummy.matrix);
        changed = true;
      }
    }
    if (changed) {
      b.instanceMatrix.needsUpdate = true;
      r.instanceMatrix.needsUpdate = true;
    }
    dirty.current = false;
  });

  // Colour buffers exist from the first frame, so the shaders compile with per-tower colour.
  const bodyColors = useMemo(() => new Float32Array(capacity * 3).fill(1), [capacity]);
  const roofColors = useMemo(() => new Float32Array(capacity * 3).fill(1), [capacity]);

  // Tap / click a tower to focus it (ignored if the pointer was dragging the camera).
  const select = (event: { delta: number; instanceId?: number; stopPropagation: () => void }) => {
    if (event.delta > 6 || event.instanceId === undefined) return;
    const building = buildings[event.instanceId];
    if (!building) return;
    event.stopPropagation();
    onSelect?.(building.wallet);
  };

  return (
    <>
      <instancedMesh ref={body} args={[bodyGeometry, bodyMaterial, capacity]} frustumCulled={false} onClick={select}>
        <instancedBufferAttribute attach="instanceColor" args={[bodyColors, 3]} />
      </instancedMesh>
      <instancedMesh ref={roof} args={[roofGeometry, roofMaterial, capacity]} frustumCulled={false} onClick={select}>
        <instancedBufferAttribute attach="instanceColor" args={[roofColors, 3]} />
      </instancedMesh>
    </>
  );
}
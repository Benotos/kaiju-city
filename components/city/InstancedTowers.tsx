"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityBuilding } from "@/lib/types";
import { getWindowTexture } from "./assets";

/**
 * Every holder outside the top tier, drawn as ONE instanced mesh (plus one
 * for the glowing roof trims). 1,500 towers cost two draw calls, so the full
 * holder city stays smooth on phones.
 *
 * The shader patch keeps windows at a real size on towers of any height and
 * tints each tower's windows with its own colour.
 */

function makeBodyMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: "#1a2742",
    emissive: "#ffffff",
    emissiveMap: getWindowTexture(),
    emissiveIntensity: 1.9,
    roughness: 0.45,
    metalness: 0.45,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
#if defined( USE_INSTANCING ) && defined( USE_EMISSIVEMAP )
  {
    vec2 size = vec2( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ) );
    vec2 offset = floor( fract( instanceMatrix[3].xz * 0.173 ) * vec2( 8.0, 16.0 ) ) * vec2( 0.125, 0.0625 );
    vEmissiveMapUv = abs( normal.y ) > 0.5 ? vec2( 0.003 ) : vec2( uv.x * size.x / 4.0, uv.y * size.y / 8.0 ) + offset;
  }
#endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
#ifdef USE_INSTANCING_COLOR
  totalEmissiveRadiance *= vColor;
#endif`,
    );
  };
  return material;
}

type Props = { buildings: CityBuilding[] };

export function InstancedTowers({ buildings }: Props) {
  // Grow capacity in chunks so the mesh is only rebuilt when the city outgrows it.
  const capacity = Math.max(256, Math.ceil(buildings.length / 256) * 256);
  return <InstancedDistrict key={capacity} capacity={capacity} buildings={buildings} />;
}

function InstancedDistrict({ capacity, buildings }: Props & { capacity: number }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(new Map<string, number>());
  const dirty = useRef(true);

  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const crownGeometry = useMemo(() => new THREE.BoxGeometry(1.06, 0.09, 1.06), []);
  const bodyMaterial = useMemo(() => makeBodyMaterial(), []);
  const crownMaterial = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => {
    geometry.dispose();
    crownGeometry.dispose();
    bodyMaterial.dispose();
    crownMaterial.dispose();
  }, [geometry, crownGeometry, bodyMaterial, crownMaterial]);

  // Colours change only when the list changes.
  useEffect(() => {
    const b = body.current;
    const c = crown.current;
    if (!b || !c) return;
    const white = new THREE.Color("#ffffff");
    buildings.forEach((building, i) => {
      color.set(building.color).lerp(white, 0.2);
      b.setColorAt(i, color);
      color.set(building.color).multiplyScalar(1.5);
      c.setColorAt(i, color);
    });
    b.count = buildings.length;
    c.count = buildings.length;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    // Forget animation state for towers that left this tier.
    const ids = new Set(buildings.map((x) => x.id));
    for (const id of shown.current.keys()) if (!ids.has(id)) shown.current.delete(id);
    dirty.current = true;
  }, [buildings, color]);

  useFrame((_, rawDelta) => {
    const b = body.current;
    const c = crown.current;
    if (!b || !c) return;
    const delta = Math.min(rawDelta, 0.05);
    const now = Date.now();
    let changed = dirty.current;
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
      if (prev === undefined || Math.abs(next - current) > 0.0005 || dirty.current) {
        current = next;
        shown.current.set(building.id, current);
        const depth = 0.75 + ((building.seed >>> 3) % 50) / 100;
        const rot = ((building.seed >>> 1) % 4) * (Math.PI / 2);
        const h = Math.max(0.001, current);
        dummy.position.set(building.x, 0, building.z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(building.width, h, building.width * depth);
        dummy.updateMatrix();
        b.setMatrixAt(i, dummy.matrix);
        const visible = h > 0.2;
        dummy.position.set(building.x, h, building.z);
        dummy.scale.set(visible ? building.width : 0, visible ? 1 : 0, visible ? building.width * depth : 0);
        dummy.updateMatrix();
        c.setMatrixAt(i, dummy.matrix);
        changed = true;
      }
    }
    if (changed) {
      b.instanceMatrix.needsUpdate = true;
      c.instanceMatrix.needsUpdate = true;
    }
    dirty.current = false;
  });

  return (
    <>
      <instancedMesh ref={body} args={[geometry, bodyMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={crown} args={[crownGeometry, crownMaterial, capacity]} frustumCulled={false} />
    </>
  );
}
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BLOCKS, LOT, PARKS, rng } from "@/lib/city";

/**
 * Street trees along every pavement, parks with grass and tree clusters,
 * wooded outskirts, and flocks of birds circling the skyline. All instanced:
 * thousands of trees cost a handful of draw calls.
 */

type Tree = { x: number; z: number; s: number; kind: 0 | 1; tint: number };

const GREENS = ["#1f7a4a", "#2f8f4e", "#3a9d5d", "#1d6b45", "#4aa36a", "#2a7f5f"];

function placeTrees(radius: number, lowPower: boolean): { trees: Tree[]; parks: { x: number; z: number }[] } {
  const rand = rng(2024);
  const trees: Tree[] = [];
  const reach = radius + 8;
  const blockHalf = LOT + 0.75; // on the pavement, just inside the kerb
  const perSide = lowPower ? 2 : 3;

  // Street trees on every block in the city.
  for (const b of BLOCKS) {
    if (b.ring > reach) continue;
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < perSide; i++) {
        const t = (i + 0.5) / perSide - 0.5;
        const along = t * blockHalf * 2;
        const x = side < 2 ? b.x + along : b.x + (side === 2 ? -blockHalf : blockHalf);
        const z = side < 2 ? b.z + (side === 0 ? -blockHalf : blockHalf) : b.z + along;
        trees.push({ x, z, s: 0.75 + rand() * 0.35, kind: rand() > 0.75 ? 1 : 0, tint: Math.floor(rand() * GREENS.length) });
      }
    }
  }

  // Parks: grass lots with a cluster of trees.
  const parks = PARKS.filter((p) => p.ring <= reach);
  for (const p of parks) {
    const n = lowPower ? 3 : 5 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = 0.6 + rand() * 1.6;
      trees.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, s: 0.9 + rand() * 0.6, kind: rand() > 0.6 ? 1 : 0, tint: Math.floor(rand() * GREENS.length) });
    }
  }

  // Wooded outskirts beyond the last towers.
  for (const b of BLOCKS) {
    if (b.ring <= reach || b.ring > reach + 45) continue;
    const n = lowPower ? 4 : 9;
    for (let i = 0; i < n; i++) {
      trees.push({ x: b.x + (rand() - 0.5) * 10, z: b.z + (rand() - 0.5) * 10, s: 1 + rand() * 0.8, kind: rand() > 0.45 ? 1 : 0, tint: Math.floor(rand() * GREENS.length) });
    }
  }
  return { trees, parks };
}

export function Trees({ radius, lowPower }: { radius: number; lowPower: boolean }) {
  // Re-place only when the city grows noticeably.
  const bucket = Math.ceil(radius / 12) * 12;
  const { trees, parks } = useMemo(() => placeTrees(bucket, lowPower), [bucket, lowPower]);
  const round = useMemo(() => trees.filter((t) => t.kind === 0), [trees]);
  const pine = useMemo(() => trees.filter((t) => t.kind === 1), [trees]);

  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const pines = useRef<THREE.InstancedMesh>(null);
  const grass = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    if (trunks.current) {
      trees.forEach((t, i) => {
        dummy.position.set(t.x, 0.2 + 0.55 * t.s, t.z);
        dummy.scale.set(t.s, t.s, t.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.current!.setMatrixAt(i, dummy.matrix);
      });
      trunks.current.count = trees.length;
      trunks.current.instanceMatrix.needsUpdate = true;
    }
    if (crowns.current) {
      round.forEach((t, i) => {
        dummy.position.set(t.x, 0.2 + 1.55 * t.s, t.z);
        dummy.scale.set(t.s, t.s * 0.95, t.s);
        dummy.rotation.set(0, t.x * 3.1, 0);
        dummy.updateMatrix();
        crowns.current!.setMatrixAt(i, dummy.matrix);
        crowns.current!.setColorAt(i, color.set(GREENS[t.tint]));
      });
      crowns.current.count = round.length;
      crowns.current.instanceMatrix.needsUpdate = true;
      if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true;
    }
    if (pines.current) {
      pine.forEach((t, i) => {
        dummy.position.set(t.x, 0.2 + 1.7 * t.s, t.z);
        dummy.scale.set(t.s, t.s * 1.1, t.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        pines.current!.setMatrixAt(i, dummy.matrix);
        pines.current!.setColorAt(i, color.set(GREENS[t.tint]).multiplyScalar(0.8));
      });
      pines.current.count = pine.length;
      pines.current.instanceMatrix.needsUpdate = true;
      if (pines.current.instanceColor) pines.current.instanceColor.needsUpdate = true;
    }
    if (grass.current) {
      parks.forEach((p, i) => {
        dummy.position.set(p.x, 0.215, p.z);
        dummy.scale.set(LOT * 0.92, 1, LOT * 0.92);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        grass.current!.setMatrixAt(i, dummy.matrix);
      });
      grass.current.count = parks.length;
      grass.current.instanceMatrix.needsUpdate = true;
    }
  }, [trees, round, pine, parks]);

  const nT = Math.max(1, trees.length);
  const nR = Math.max(1, round.length);
  const nP = Math.max(1, pine.length);
  const nG = Math.max(1, parks.length);
  const crownColors = useMemo(() => new Float32Array(nR * 3).fill(1), [nR]);
  const pineColors = useMemo(() => new Float32Array(nP * 3).fill(1), [nP]);

  return (
    <group key={`${bucket}-${lowPower}`}>
      <instancedMesh ref={grass} args={[undefined, undefined, nG]} frustumCulled={false}>
        <boxGeometry args={[1, 0.03, 1]} />
        <meshStandardMaterial color="#1e5b3a" emissive="#0d3a22" emissiveIntensity={0.5} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, nT]} frustumCulled={false}>
        <cylinderGeometry args={[0.07, 0.1, 1.1, 5]} />
        <meshStandardMaterial color="#4a3426" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, nR]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[crownColors, 3]} />
        <icosahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial roughness={0.85} emissive="#0b3a22" emissiveIntensity={0.55} flatShading />
      </instancedMesh>
      <instancedMesh ref={pines} args={[undefined, undefined, nP]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[pineColors, 3]} />
        <coneGeometry args={[0.6, 1.9, 7]} />
        <meshStandardMaterial roughness={0.85} emissive="#0b3a22" emissiveIntensity={0.5} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Flocks of birds circling the skyline, wings flapping. */
export function Birds({ count, radius }: { count: number; radius: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const flocks = 3;
  const birds = useMemo(() => {
    const rand = rng(55);
    return Array.from({ length: count }, (_, i) => ({
      flock: i % flocks,
      dx: (rand() - 0.5) * 7,
      dy: (rand() - 0.5) * 2.5,
      dz: (rand() - 0.5) * 7,
      flap: rand() * Math.PI * 2,
      speed: 7 + rand() * 3,
    }));
  }, [count]);
  const geometry = useMemo(() => {
    // A simple "V": two wing triangles.
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([0, 0, 0.15, -0.55, 0, -0.1, 0, 0, -0.15, 0, 0, 0.15, 0.55, 0, -0.1, 0, 0, -0.15]);
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const r = Math.max(40, radius * 0.6);

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    birds.forEach((b, i) => {
      const f = b.flock;
      const orbit = r * (0.55 + f * 0.25);
      const angle = t * (0.05 + f * 0.012) * (f % 2 ? -1 : 1) + f * 2.1;
      const cx = Math.cos(angle) * orbit;
      const cz = Math.sin(angle) * orbit;
      const y = 34 + f * 8 + Math.sin(t * 0.4 + f) * 3;
      dummy.position.set(cx + b.dx, y + b.dy, cz + b.dz);
      dummy.rotation.set(0, -angle + (f % 2 ? Math.PI : 0), 0);
      const flap = Math.sin(t * b.speed + b.flap);
      dummy.scale.set(1.4, 1, 1.4);
      dummy.rotation.z = flap * 0.5;
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, Math.max(1, count)]} frustumCulled={false}>
      <meshBasicMaterial color="#cfe4ff" side={THREE.DoubleSide} />
    </instancedMesh>
  );
}
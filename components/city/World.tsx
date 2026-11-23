"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLOCK_PITCH, CITY_RADIUS, GRID_BLOCKS, STREET, STREET_LINES, rng } from "@/lib/city";
import { getWindowTexture } from "./assets";

const SPAN = GRID_BLOCKS * BLOCK_PITCH;

export function Sky() {
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(320, 32, 20);
    const top = new THREE.Color("#01040b");
    const mid = new THREE.Color("#04132a");
    const horizon = new THREE.Color("#0f4c70").lerp(new THREE.Color("#1b6f8f"), 0.35);
    const colors: number[] = [];
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 320;
      if (y < 0.02) c.copy(horizon).lerp(new THREE.Color("#020812"), Math.min(1, -y * 6));
      else if (y < 0.3) c.copy(horizon).lerp(mid, y / 0.3);
      else c.copy(mid).lerp(top, Math.min(1, (y - 0.3) / 0.5));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

export function Lights() {
  return (
    <>
      <hemisphereLight args={["#a9d8ff", "#06142a", 1.2]} />
      <ambientLight intensity={0.4} color="#3f6fd6" />
      <directionalLight position={[-30, 50, 25]} intensity={2.1} color="#cfe4ff" />
      <directionalLight position={[35, 18, -30]} intensity={1.2} color="#ffb35c" />
      <pointLight position={[0, 16, 0]} intensity={900} distance={60} decay={1.6} color="#5fd4ff" />
      <pointLight position={[-22, 10, 18]} intensity={320} distance={45} decay={1.6} color="#ffb547" />
      <pointLight position={[24, 10, -16]} intensity={600} distance={50} decay={1.6} color="#3f7bff" />
    </>
  );
}

export function Ground({ radius }: { radius: number }) {
  const { streets, lanes, edges } = useMemo(() => {
    const s: THREE.BufferGeometry[] = [];
    const l: THREE.BufferGeometry[] = [];
    const e: THREE.BufferGeometry[] = [];
    for (const c of STREET_LINES) {
      for (const axis of ["x", "z"] as const) {
        const street = new THREE.PlaneGeometry(axis === "x" ? STREET : SPAN + STREET, axis === "x" ? SPAN + STREET : STREET);
        street.rotateX(-Math.PI / 2);
        street.translate(axis === "x" ? c : 0, 0.012, axis === "x" ? 0 : c);
        s.push(street);
        // Dashed centre line.
        for (let d = -SPAN / 2; d < SPAN / 2; d += 2.2) {
          const dash = new THREE.PlaneGeometry(axis === "x" ? 0.12 : 1.1, axis === "x" ? 1.1 : 0.12);
          dash.rotateX(-Math.PI / 2);
          dash.translate(axis === "x" ? c : d, 0.02, axis === "x" ? d : c);
          l.push(dash);
        }
        for (const side of [-1, 1]) {
          const edge = new THREE.PlaneGeometry(axis === "x" ? 0.08 : SPAN, axis === "x" ? SPAN : 0.08);
          edge.rotateX(-Math.PI / 2);
          const off = side * (STREET / 2 - 0.1);
          edge.translate(axis === "x" ? c + off : 0, 0.022, axis === "x" ? 0 : c + off);
          e.push(edge);
        }
      }
    }
    const merged = { streets: mergeGeometries(s)!, lanes: mergeGeometries(l)!, edges: mergeGeometries(e)! };
    [...s, ...l, ...e].forEach((g) => g.dispose());
    return merged;
  }, []);
  useEffect(() => () => [streets, lanes, edges].forEach((g) => g.dispose()), [streets, lanes, edges]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#040b16" roughness={0.85} metalness={0.25} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}>
        <circleGeometry args={[radius + 6, 96]} />
        <meshStandardMaterial color="#0a1729" roughness={0.7} metalness={0.35} />
      </mesh>
      <gridHelper args={[240, 120, "#1f5584", "#0d2541"]} position={[0, 0, 0]} />
      <mesh geometry={streets}>
        <meshStandardMaterial color="#030812" roughness={0.55} metalness={0.4} />
      </mesh>
      <mesh geometry={lanes}>
        <meshBasicMaterial color="#ffb547" toneMapped={false} transparent opacity={0.6} />
      </mesh>
      <mesh geometry={edges}>
        <meshBasicMaterial color="#5fd4ff" toneMapped={false} transparent opacity={0.7} />
      </mesh>
      {/* outer neon boundary */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[radius + 5.6, radius + 6, 128]} />
        <meshBasicMaterial color="#5fd4ff" toneMapped={false} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

/** Ground traffic and flying cars streaming along the street grid. */
export function Traffic({ count }: { count: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const cars = useMemo(() => {
    const rand = rng(31);
    return Array.from({ length: count }, (_, i) => {
      const flying = i % 3 === 0;
      const dir = rand() > 0.5 ? 1 : -1;
      return {
        axis: rand() > 0.5 ? "x" : "z",
        line: STREET_LINES[Math.floor(rand() * STREET_LINES.length)],
        dir,
        speed: (flying ? 7 : 4) + rand() * 5,
        offset: rand() * SPAN,
        y: flying ? 4 + rand() * 12 : 0.25,
        lane: flying ? 0 : dir * 0.55,
      };
    });
  }, [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!mesh.current) return;
    const head = new THREE.Color("#e8fbff").multiplyScalar(1.8);
    const tail = new THREE.Color("#ff4a3d").multiplyScalar(1.6);
    const fly = new THREE.Color("#ffb547").multiplyScalar(1.6);
    cars.forEach((car, i) => mesh.current!.setColorAt(i, car.y > 1 ? fly : car.dir > 0 ? head : tail));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [cars]);

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    cars.forEach((car, i) => {
      const travel = ((car.offset + t * car.speed * car.dir) % SPAN + SPAN) % SPAN - SPAN / 2;
      if (car.axis === "x") {
        dummy.position.set(car.line + car.lane, car.y, travel);
        dummy.rotation.set(0, 0, 0);
      } else {
        dummy.position.set(travel, car.y, car.line + car.lane);
        dummy.rotation.set(0, Math.PI / 2, 0);
      }
      dummy.scale.set(1, 1, car.y > 1 ? 1.8 : 1);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[0.32, 0.16, 0.7]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** A ring of distant towers so the skyline continues to the horizon. */
export function Backdrop({ count }: { count: number }) {
  const violet = useRef<THREE.InstancedMesh>(null);
  const cyan = useRef<THREE.InstancedMesh>(null);
  const materials = useMemo(() => {
    const make = (emissive: string) => {
      const tex = getWindowTexture().clone();
      tex.repeat.set(2, 7);
      tex.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ color: "#0b1830", emissive, emissiveMap: tex, emissiveIntensity: 1.6, roughness: 0.6, metalness: 0.4 });
    };
    return [make("#3f7bff"), make("#5fd4ff")];
  }, []);
  useEffect(() => () => materials.forEach((m) => { m.emissiveMap?.dispose(); m.dispose(); }), [materials]);

  useEffect(() => {
    const rand = rng(909);
    const dummy = new THREE.Object3D();
    const half = Math.ceil(count / 2);
    [violet.current, cyan.current].forEach((mesh) => {
      if (!mesh) return;
      for (let i = 0; i < half; i++) {
        const angle = rand() * Math.PI * 2;
        // Start beyond the furthest camera position so nothing blocks the view.
        const r = CITY_RADIUS + 50 + rand() * 110;
        const far = (r - CITY_RADIUS - 50) / 110;
        const h = 18 + rand() * 30 + far * 40;
        const w = 6 + rand() * 9;
        dummy.position.set(Math.cos(angle) * r, h / 2, Math.sin(angle) * r);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.set(w, h, w * (0.7 + rand() * 0.6));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [count]);

  const half = Math.ceil(count / 2);
  return (
    <>
      <instancedMesh ref={violet} args={[undefined, undefined, half]} material={materials[0]}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={cyan} args={[undefined, undefined, half]} material={materials[1]}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </>
  );
}

/** Sweeping searchlights and a hologram crown over the city core. */
export function Atmosphere({ radius }: { radius: number }) {
  const beams = useRef<(THREE.Group | null)[]>([]);
  const halo = useRef<THREE.Group>(null);
  const spots = useMemo(() => [
    { x: -radius * 0.8, z: radius * 0.55, color: "#5fd4ff", speed: 0.35, phase: 0 },
    { x: radius * 0.85, z: radius * 0.35, color: "#d8ecff", speed: -0.28, phase: 2 },
    { x: radius * 0.2, z: -radius * 0.9, color: "#ffb547", speed: 0.22, phase: 4 },
    { x: -radius * 0.55, z: -radius * 0.6, color: "#3f7bff", speed: -0.31, phase: 1 },
  ], [radius]);
  const beamGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(4.5, 70, 24, 1, true);
    g.translate(0, -35, 0);
    g.rotateX(Math.PI); // apex at origin, opening upward
    return g;
  }, []);
  useEffect(() => () => beamGeo.dispose(), [beamGeo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    spots.forEach((s, i) => {
      const b = beams.current[i];
      if (!b) return;
      b.rotation.z = Math.sin(t * s.speed + s.phase) * 0.45;
      b.rotation.x = Math.cos(t * s.speed * 0.8 + s.phase) * 0.3;
    });
    if (halo.current) {
      halo.current.rotation.y = t * 0.25;
      halo.current.position.y = 31 + Math.sin(t * 0.8) * 0.6;
    }
  });

  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} ref={(el) => { beams.current[i] = el; }}>
          <mesh geometry={beamGeo}>
            <meshBasicMaterial color={s.color} transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <group ref={halo} position={[0, 31, 0]}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[7, 0.09, 6, 80]} />
          <meshBasicMaterial color="#5fd4ff" toneMapped={false} />
        </mesh>
        <mesh rotation-x={Math.PI / 2 + 0.25}>
          <torusGeometry args={[8.4, 0.05, 6, 80]} />
          <meshBasicMaterial color="#ffb547" toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}
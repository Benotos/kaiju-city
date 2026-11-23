"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLOCK_PITCH, BLOCKS, GRID_BLOCKS, LOT, STREET, STREET_LINES, rng } from "@/lib/city";
import { getWindowTexture } from "./assets";

const SPAN = GRID_BLOCKS * BLOCK_PITCH;
/** Half-width of a block's raised pavement. */
const BLOCK_HALF = LOT + 1.1;

export function Sky() {
  const geometry = useMemo(() => {
    const R = 900;
    const geo = new THREE.SphereGeometry(R, 32, 20);
    const top = new THREE.Color("#01040b");
    const mid = new THREE.Color("#04132a");
    const horizon = new THREE.Color("#0f4c70").lerp(new THREE.Color("#1b6f8f"), 0.35);
    const colors: number[] = [];
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / R;
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

export function Lights({ radius }: { radius: number }) {
  const r = Math.max(30, radius);
  return (
    <>
      <hemisphereLight args={["#a9d8ff", "#06142a", 1.2]} />
      <ambientLight intensity={0.42} color="#3f6fd6" />
      <directionalLight position={[-60, 90, 45]} intensity={2.1} color="#cfe4ff" />
      <directionalLight position={[70, 35, -60]} intensity={1.1} color="#ffb35c" />
      <pointLight position={[0, 22, 0]} intensity={1400} distance={r * 0.9} decay={1.5} color="#5fd4ff" />
      <pointLight position={[-r * 0.45, 14, r * 0.35]} intensity={500} distance={r * 0.6} decay={1.6} color="#ffb547" />
      <pointLight position={[r * 0.5, 14, -r * 0.3]} intensity={600} distance={r * 0.6} decay={1.6} color="#3f7bff" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ground: asphalt, lane markings, raised blocks with pavements        */
/* ------------------------------------------------------------------ */

export function Ground({ radius }: { radius: number }) {
  const reach = radius + 40;
  const { streets, centre, lanes, kerbs } = useMemo(() => {
    const s: THREE.BufferGeometry[] = [];
    const c: THREE.BufferGeometry[] = [];
    const l: THREE.BufferGeometry[] = [];
    const k: THREE.BufferGeometry[] = [];
    const plane = (w: number, d: number, x: number, y: number, z: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      return g;
    };
    const span = Math.min(SPAN, reach * 2);
    for (const line of STREET_LINES) {
      if (Math.abs(line) > reach) continue;
      for (const axis of ["x", "z"] as const) {
        const along = (w: number, off: number, y: number) =>
          axis === "x" ? plane(w, span, line + off, y, 0) : plane(span, w, 0, y, line + off);
        s.push(along(STREET, 0, 0.01));
        // Double yellow centre line.
        c.push(along(0.08, -0.12, 0.02), along(0.08, 0.12, 0.02));
        // Dashed white lane dividers, one per direction.
        for (let d = -span / 2; d < span / 2; d += 3.2) {
          for (const off of [-STREET / 4, STREET / 4]) {
            l.push(axis === "x" ? plane(0.09, 1.4, line + off, 0.02, d) : plane(1.4, 0.09, d, 0.02, line + off));
          }
        }
      }
    }
    // Glowing kerb outline around each block.
    for (const b of BLOCKS) {
      if (b.ring > reach) continue;
      const h = BLOCK_HALF;
      k.push(plane(h * 2, 0.07, b.x, 0.21, b.z - h), plane(h * 2, 0.07, b.x, 0.21, b.z + h));
      k.push(plane(0.07, h * 2, b.x - h, 0.21, b.z), plane(0.07, h * 2, b.x + h, 0.21, b.z));
    }
    const merge = (parts: THREE.BufferGeometry[]) => {
      const g = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
      parts.forEach((p) => p.dispose());
      return g;
    };
    return { streets: merge(s), centre: merge(c), lanes: merge(l), kerbs: merge(k) };
  }, [reach]);
  useEffect(() => () => [streets, centre, lanes, kerbs].forEach((g) => g.dispose()), [streets, centre, lanes, kerbs]);

  // Raised blocks (pavement) as one instanced mesh.
  const blocks = useMemo(() => BLOCKS.filter((b) => b.ring <= reach), [reach]);
  const blockMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = blockMesh.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    blocks.forEach((b, i) => {
      dummy.position.set(b.x, 0.1, b.z);
      dummy.scale.set(BLOCK_HALF * 2, 0.2, BLOCK_HALF * 2);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [blocks]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[2400, 2400]} />
        <meshStandardMaterial color="#040b16" roughness={0.85} metalness={0.25} />
      </mesh>
      <gridHelper args={[1600, 400, "#163f63", "#0b2036"]} position={[0, -0.01, 0]} />
      <mesh geometry={streets}>
        <meshStandardMaterial color="#0a0f1a" roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh geometry={centre}>
        <meshBasicMaterial color="#ffb547" toneMapped={false} transparent opacity={0.75} />
      </mesh>
      <mesh geometry={lanes}>
        <meshBasicMaterial color="#d8ecff" toneMapped={false} transparent opacity={0.45} />
      </mesh>
      <instancedMesh ref={blockMesh} args={[undefined, undefined, Math.max(1, blocks.length)]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#1b2436" roughness={0.8} metalness={0.15} />
      </instancedMesh>
      <mesh geometry={kerbs}>
        <meshBasicMaterial color="#5fd4ff" toneMapped={false} transparent opacity={0.45} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[radius + 14, radius + 14.5, 160]} />
        <meshBasicMaterial color="#5fd4ff" toneMapped={false} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Street lamps                                                        */
/* ------------------------------------------------------------------ */

let lampPoolTexture: THREE.CanvasTexture | null = null;
function getLampPoolTexture() {
  if (lampPoolTexture) return lampPoolTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,210,150,0.9)");
  grad.addColorStop(1, "rgba(255,210,150,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  lampPoolTexture = new THREE.CanvasTexture(canvas);
  lampPoolTexture.colorSpace = THREE.SRGBColorSpace;
  return lampPoolTexture;
}

export function StreetLamps({ radius, spacing }: { radius: number; spacing: number }) {
  const points = useMemo(() => {
    const out: [number, number][] = [];
    const reach = radius + 10;
    const side = STREET / 2 + 0.45;
    for (const line of STREET_LINES) {
      if (Math.abs(line) > reach) continue;
      for (let d = -reach; d <= reach; d += spacing) {
        for (const s of [-1, 1]) {
          const a: [number, number] = [line + s * side, d];
          const b: [number, number] = [d, line + s * side];
          if (Math.hypot(a[0], a[1]) < reach) out.push(a);
          if (Math.hypot(b[0], b[1]) < reach) out.push(b);
        }
      }
    }
    return out;
  }, [radius, spacing]);
  const poles = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const poolTexture = useMemo(() => getLampPoolTexture(), []);
  useEffect(() => {
    if (!poles.current || !heads.current || !pools.current) return;
    const dummy = new THREE.Object3D();
    points.forEach(([x, z], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, 1.6, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 3.25, z);
      dummy.updateMatrix();
      heads.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 0.23, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      pools.current!.setMatrixAt(i, dummy.matrix);
    });
    for (const m of [poles.current, heads.current, pools.current]) {
      m.count = points.length;
      m.instanceMatrix.needsUpdate = true;
    }
  }, [points]);
  const n = Math.max(1, points.length);
  return (
    <>
      <instancedMesh key={`p${n}`} ref={poles} args={[undefined, undefined, n]} frustumCulled={false}>
        <cylinderGeometry args={[0.05, 0.07, 3.2, 5]} />
        <meshStandardMaterial color="#3a4a60" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh key={`h${n}`} ref={heads} args={[undefined, undefined, n]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 8, 6]} />
        <meshBasicMaterial color="#ffd59a" toneMapped={false} />
      </instancedMesh>
      <instancedMesh key={`g${n}`} ref={pools} args={[undefined, undefined, n]} frustumCulled={false}>
        <planeGeometry args={[3.4, 3.4]} />
        <meshBasicMaterial map={poolTexture} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Traffic: real-looking cars in lanes, plus flying cars               */
/* ------------------------------------------------------------------ */

const CAR_COLORS = ["#e9edf2", "#0d0f14", "#b3121f", "#9aa4b1", "#1d4ed8", "#f2c500", "#e9edf2", "#2b2f36", "#f2c500", "#0f5132"];

function carGeometry() {
  const body = new THREE.BoxGeometry(0.95, 0.42, 2.1);
  body.translate(0, 0.38, 0);
  const cabin = new THREE.BoxGeometry(0.82, 0.36, 1.05);
  cabin.translate(0, 0.77, -0.1);
  const g = mergeGeometries([body, cabin])!;
  body.dispose();
  cabin.dispose();
  return g;
}

function carLightsGeometry() {
  // Headlights (white, front) and tail lights (red, back) in one mesh via vertex colours.
  const parts: THREE.BufferGeometry[] = [];
  const quad = (x: number, z: number, facing: number, color: THREE.Color) => {
    const g = new THREE.PlaneGeometry(0.3, 0.16);
    if (facing < 0) g.rotateY(Math.PI);
    g.translate(x, 0.42, z);
    const c: number[] = [];
    for (let i = 0; i < g.attributes.position.count; i++) c.push(color.r, color.g, color.b);
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    parts.push(g);
  };
  const white = new THREE.Color("#fff6dd").multiplyScalar(3);
  const red = new THREE.Color("#ff2a2a").multiplyScalar(2.6);
  for (const x of [-0.3, 0.3]) {
    quad(x, 1.06, 1, white);
    quad(x, -1.06, -1, red);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

export function Traffic({ count, flying, radius }: { count: number; flying: number; radius: number }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const flyers = useRef<THREE.InstancedMesh>(null);
  const reach = Math.min(SPAN / 2, radius + 12);
  const lines = useMemo(() => STREET_LINES.filter((l) => Math.abs(l) < reach), [reach]);
  const cars = useMemo(() => {
    const rand = rng(31);
    return Array.from({ length: count }, () => {
      const dir = rand() > 0.5 ? 1 : -1;
      const lane = rand() > 0.5 ? STREET / 4 : STREET / 4 + 0.9;
      return {
        axis: rand() > 0.5 ? "x" : "z",
        line: lines[Math.floor(rand() * lines.length)] ?? 0,
        dir,
        // Right-hand traffic: lane side depends on direction.
        offset: dir * Math.min(lane, STREET / 2 - 0.6),
        speed: 4 + rand() * 6,
        phase: rand() * reach * 2,
        color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
      };
    });
  }, [count, lines, reach]);
  const flyersData = useMemo(() => {
    const rand = rng(77);
    return Array.from({ length: flying }, () => ({
      axis: rand() > 0.5 ? "x" : "z",
      line: lines[Math.floor(rand() * lines.length)] ?? 0,
      dir: rand() > 0.5 ? 1 : -1,
      y: 9 + rand() * 18,
      speed: 9 + rand() * 9,
      phase: rand() * reach * 2,
    }));
  }, [flying, lines, reach]);

  const bodyGeo = useMemo(() => carGeometry(), []);
  const lightGeo = useMemo(() => carLightsGeometry(), []);
  useEffect(() => () => {
    bodyGeo.dispose();
    lightGeo.dispose();
  }, [bodyGeo, lightGeo]);

  useEffect(() => {
    if (!bodies.current) return;
    const c = new THREE.Color();
    cars.forEach((car, i) => bodies.current!.setColorAt(i, c.set(car.color)));
    if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true;
  }, [cars]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const span = reach * 2;
    if (bodies.current && lights.current) {
      cars.forEach((car, i) => {
        const travel = (((car.phase + t * car.speed * car.dir) % span) + span) % span - reach;
        if (car.axis === "x") {
          dummy.position.set(car.line + car.offset, 0.02, travel);
          dummy.rotation.set(0, car.dir > 0 ? 0 : Math.PI, 0);
        } else {
          dummy.position.set(travel, 0.02, car.line - car.offset);
          dummy.rotation.set(0, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        }
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bodies.current!.setMatrixAt(i, dummy.matrix);
        lights.current!.setMatrixAt(i, dummy.matrix);
      });
      bodies.current.instanceMatrix.needsUpdate = true;
      lights.current.instanceMatrix.needsUpdate = true;
    }
    if (flyers.current) {
      flyersData.forEach((car, i) => {
        const travel = (((car.phase + t * car.speed * car.dir) % span) + span) % span - reach;
        if (car.axis === "x") {
          dummy.position.set(car.line, car.y, travel);
          dummy.rotation.set(0, 0, 0);
        } else {
          dummy.position.set(travel, car.y, car.line);
          dummy.rotation.set(0, Math.PI / 2, 0);
        }
        dummy.updateMatrix();
        flyers.current!.setMatrixAt(i, dummy.matrix);
      });
      flyers.current.instanceMatrix.needsUpdate = true;
    }
  });

  const n = Math.max(1, count);
  const colors = useMemo(() => new Float32Array(n * 3).fill(1), [n]);
  return (
    <>
      <instancedMesh ref={bodies} args={[bodyGeo, undefined, n]} frustumCulled={false}>
        <instancedBufferAttribute attach="instanceColor" args={[colors, 3]} />
        <meshStandardMaterial roughness={0.3} metalness={0.5} emissive="#1a2236" emissiveIntensity={0.6} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[lightGeo, undefined, n]} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={flyers} args={[undefined, undefined, Math.max(1, flying)]} frustumCulled={false}>
        <boxGeometry args={[0.7, 0.3, 1.6]} />
        <meshBasicMaterial color={new THREE.Color("#ffb547").multiplyScalar(1.6)} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Distant skyline                                                     */
/* ------------------------------------------------------------------ */

export function Backdrop({ count, radius }: { count: number; radius: number }) {
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
    const start = radius + 70;
    [violet.current, cyan.current].forEach((mesh) => {
      if (!mesh) return;
      for (let i = 0; i < half; i++) {
        const angle = rand() * Math.PI * 2;
        const r = start + rand() * 220;
        const far = (r - start) / 220;
        const h = 22 + rand() * 34 + far * 50;
        const w = 7 + rand() * 11;
        dummy.position.set(Math.cos(angle) * r, h / 2, Math.sin(angle) * r);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.set(w, h, w * (0.7 + rand() * 0.6));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [count, radius]);

  const half = Math.ceil(count / 2);
  return (
    <>
      <instancedMesh ref={violet} args={[undefined, undefined, half]} material={materials[0]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={cyan} args={[undefined, undefined, half]} material={materials[1]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </>
  );
}

/** Sweeping searchlights and a hologram crown over the city core. */
export function Atmosphere({ radius }: { radius: number }) {
  const beams = useRef<(THREE.Group | null)[]>([]);
  const halo = useRef<THREE.Group>(null);
  const r = Math.max(30, radius);
  const spots = useMemo(() => [
    { x: -r * 0.8, z: r * 0.55, color: "#5fd4ff", speed: 0.35, phase: 0 },
    { x: r * 0.85, z: r * 0.35, color: "#d8ecff", speed: -0.28, phase: 2 },
    { x: r * 0.2, z: -r * 0.9, color: "#ffb547", speed: 0.22, phase: 4 },
    { x: -r * 0.55, z: -r * 0.6, color: "#3f7bff", speed: -0.31, phase: 1 },
  ], [r]);
  const beamGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(6, 110, 24, 1, true);
    g.translate(0, -55, 0);
    g.rotateX(Math.PI);
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
      halo.current.position.y = 40 + Math.sin(t * 0.8) * 0.6;
    }
  });

  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} ref={(el) => { beams.current[i] = el; }}>
          <mesh geometry={beamGeo}>
            <meshBasicMaterial color={s.color} transparent opacity={0.06} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <group ref={halo} position={[0, 40, 0]}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[8, 0.1, 6, 80]} />
          <meshBasicMaterial color="#5fd4ff" toneMapped={false} />
        </mesh>
        <mesh rotation-x={Math.PI / 2 + 0.25}>
          <torusGeometry args={[9.6, 0.06, 6, 80]} />
          <meshBasicMaterial color="#ffb547" toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}
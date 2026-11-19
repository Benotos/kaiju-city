"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KaijuAttack } from "@/lib/types";
import { KAIJU_LEAD_MS } from "@/lib/city";

/** Shared with the world group so impacts shake the whole city (never the camera). */
export const impactShake = { at: 0, strength: 0 };

const UP = new THREE.Vector3(0, 1, 0);

function latestAttack(attacks: KaijuAttack[], now: number) {
  let best: KaijuAttack | null = null;
  for (const a of attacks) if (now < a.at + 1600 && (!best || a.at > best.at)) best = a;
  return best;
}

/* ------------------------------------------------------------------ */
/* The kaiju                                                           */
/* ------------------------------------------------------------------ */

export function Kaiju({ attacks, prowlRadius }: { attacks: KaijuAttack[]; prowlRadius: number }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const jaw = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group[]>([]);
  const mouthGlow = useRef<THREE.Mesh>(null);
  const beamCore = useRef<THREE.Mesh>(null);
  const beamGlow = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);

  const pos = useRef(new THREE.Vector3(prowlRadius, 0, 0));
  const from = useRef(new THREE.Vector3());
  const stand = useRef(new THREE.Vector3());
  const heading = useRef(-Math.PI / 2);
  const walkPhase = useRef(0);
  const prowlAngle = useRef(0);
  const currentId = useRef<string | null>(null);
  const leap = useRef(false);

  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b3f4c", roughness: 0.68, metalness: 0.25, emissive: "#102638", emissiveIntensity: 1.2 }), []);
  const belly = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5b6a5e", roughness: 0.85 }), []);
  const spine = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1b0f2e", emissive: "#ff2bd6", emissiveIntensity: 2.5, roughness: 0.4 }), []);
  const eye = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff2a2a", toneMapped: false }), []);
  const claw = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d9d2c0", roughness: 0.5 }), []);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff7a2a", toneMapped: false, transparent: true, opacity: 0 }), []);
  const beamCoreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#e6fbff", toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const beamGlowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#22e6ff", toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => [skin, belly, spine, eye, claw, glow, beamCoreMat, beamGlowMat].forEach((m) => m.dispose()), [skin, belly, spine, eye, claw, glow, beamCoreMat, beamGlowMat]);

  const mouthWorld = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, rawDelta) => {
    const g = root.current;
    if (!g || !body.current) return;
    const delta = Math.min(rawDelta, 0.05);
    const now = Date.now();
    const t = state.clock.elapsedTime;
    const attack = latestAttack(attacks, now);
    let moving = false;
    let lift = 0;
    let lunge = 0;
    let roar = 0;
    let faceX = 0;
    let faceZ = 0;

    if (attack) {
      if (attack.id !== currentId.current) {
        currentId.current = attack.id;
        from.current.copy(pos.current);
        tmp.set(pos.current.x - attack.x, 0, pos.current.z - attack.z);
        if (tmp.lengthSq() < 0.01) tmp.set(1, 0, 0);
        tmp.normalize().multiplyScalar(5.2);
        stand.current.set(attack.x + tmp.x, 0, attack.z + tmp.z);
        leap.current = from.current.distanceTo(stand.current) > 12;
      }
      const start = attack.at - KAIJU_LEAD_MS;
      const travel = KAIJU_LEAD_MS - 260;
      const p = Math.min(1, Math.max(0, (now - start) / travel));
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      pos.current.lerpVectors(from.current, stand.current, eased);
      moving = p < 1;
      if (leap.current && p < 1) lift = Math.sin(p * Math.PI) * 9;
      faceX = attack.x - pos.current.x;
      faceZ = attack.z - pos.current.z;
      const toHit = (now - attack.at) / 1000;
      // Wind-up, slam, recover.
      if (toHit > -0.3 && toHit < 0) {
        lunge = (toHit + 0.3) / 0.3;
        lift += Math.sin(lunge * Math.PI) * 0.8;
      } else if (toHit >= 0 && toHit < 0.5) {
        lunge = 1 - toHit / 0.5;
      }
      roar = toHit > -0.45 && toHit < 0.6 ? 1 : 0;
      if (!moving) prowlAngle.current = Math.atan2(pos.current.z, pos.current.x);
    } else {
      // Prowl the edge of the city, keeping an eye on it.
      currentId.current = null;
      prowlAngle.current += delta * 0.07;
      tmp.set(Math.cos(prowlAngle.current) * prowlRadius, 0, Math.sin(prowlAngle.current) * prowlRadius);
      const dx = tmp.x - pos.current.x;
      const dz = tmp.z - pos.current.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.2) {
        const step = Math.min(dist, delta * (dist > 6 ? 7 : 2.4));
        pos.current.x += (dx / dist) * step;
        pos.current.z += (dz / dist) * step;
        moving = true;
        faceX = dx;
        faceZ = dz;
      } else {
        faceX = -pos.current.x;
        faceZ = -pos.current.z;
      }
    }

    // Turn smoothly toward where it's going / what it's attacking.
    if (Math.abs(faceX) + Math.abs(faceZ) > 0.001) {
      const want = Math.atan2(faceX, faceZ);
      let diff = want - heading.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      heading.current += diff * (1 - Math.exp(-delta * 7));
    }

    g.position.set(pos.current.x, lift, pos.current.z);
    g.rotation.y = heading.current;
    walkPhase.current += delta * (moving ? (leap.current && attack ? 4 : 7) : 1.2);
    const swing = moving ? Math.sin(walkPhase.current) : Math.sin(walkPhase.current) * 0.08;

    if (legL.current) legL.current.rotation.x = swing * 0.55;
    if (legR.current) legR.current.rotation.x = -swing * 0.55;
    if (armL.current) armL.current.rotation.x = -0.6 - swing * 0.25 - lunge * 0.9;
    if (armR.current) armR.current.rotation.x = -0.6 + swing * 0.25 - lunge * 0.9;
    body.current.position.y = Math.abs(swing) * 0.18 - lunge * 0.35;
    body.current.rotation.x = 0.32 + lunge * 0.4;
    body.current.rotation.z = swing * 0.05;
    tail.current.forEach((seg, i) => {
      if (seg) seg.rotation.y = Math.sin(t * 2.2 - i * 0.6) * 0.12 * (moving ? 1.6 : 1);
    });
    if (head.current) {
      head.current.rotation.x = -0.25 - roar * 0.35 + Math.sin(t * 1.3) * 0.04;
      head.current.rotation.y = Math.sin(t * 0.7) * 0.15 * (1 - roar);
    }
    if (jaw.current) jaw.current.rotation.x = 0.08 + roar * 0.75;

    const charge = attack ? Math.max(0, 1 - Math.abs((now - attack.at) / 700)) : 0;
    spine.emissiveIntensity = 2.2 + Math.sin(t * 3) * 0.6 + charge * 6;
    spine.emissive.set(charge > 0.2 ? "#22e6ff" : "#ff2bd6");
    glow.opacity = roar * 0.95;
    if (light.current) light.current.intensity = 260 + charge * 1400;

    // Atomic breath for heavy sells.
    const breathing = attack && (attack.destroy || attack.strength > 1.3) && now > attack.at - 320 && now < attack.at + 380;
    if (beamCore.current && beamGlow.current) {
      beamCore.current.visible = beamGlow.current.visible = Boolean(breathing);
      if (breathing && attack && mouthGlow.current) {
        mouthGlow.current.getWorldPosition(mouthWorld);
        tmp.set(attack.x, Math.max(1.5, attack.top * 0.7), attack.z);
        const length = mouthWorld.distanceTo(tmp);
        const mid = mouthWorld.clone().add(tmp).multiplyScalar(0.5);
        const dir = tmp.clone().sub(mouthWorld).normalize();
        for (const beam of [beamCore.current, beamGlow.current]) {
          beam.position.copy(mid);
          beam.quaternion.setFromUnitVectors(UP, dir);
          beam.scale.set(1, length, 1);
        }
        const flicker = 0.75 + Math.sin(t * 70) * 0.25;
        beamCoreMat.opacity = 0.95 * flicker;
        beamGlowMat.opacity = 0.45 * flicker;
      }
    }
  });

  const spines = [
    [0, 5.05, -0.15, 0.62],
    [0, 4.6, -0.75, 0.75],
    [0, 4.05, -1.25, 0.68],
    [0, 3.4, -1.6, 0.55],
    [0, 2.75, -1.85, 0.45],
  ] as const;

  return (
    <>
      <group ref={root} scale={2.35}>
        <pointLight ref={light} position={[0, 6, 3.5]} color="#ff2bd6" intensity={140} distance={30} decay={1.5} />
        <group ref={body} rotation-x={0.32}>
          {/* torso */}
          <mesh material={skin} position={[0, 3, 0]} scale={[1.35, 1.75, 1.15]}>
            <sphereGeometry args={[1, 20, 16]} />
          </mesh>
          <mesh material={belly} position={[0, 2.8, 0.55]} scale={[0.95, 1.4, 0.7]}>
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
          {/* neck + head */}
          <mesh material={skin} position={[0, 4.55, 0.45]} scale={[0.78, 0.8, 0.8]}>
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
          <group ref={head} position={[0, 5.15, 0.95]}>
            <mesh material={skin} scale={[0.78, 0.62, 0.95]}>
              <sphereGeometry args={[1, 18, 14]} />
            </mesh>
            <mesh material={skin} position={[0, -0.05, 0.85]} scale={[0.5, 0.36, 0.6]}>
              <sphereGeometry args={[1, 14, 10]} />
            </mesh>
            {/* brow ridges */}
            {[-1, 1].map((s) => (
              <mesh key={s} material={skin} position={[s * 0.38, 0.32, 0.55]} rotation={[0.3, 0, s * -0.4]} scale={[0.32, 0.14, 0.4]}>
                <sphereGeometry args={[1, 10, 8]} />
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={s} material={eye} position={[s * 0.36, 0.16, 0.78]}>
                <sphereGeometry args={[0.11, 10, 8]} />
              </mesh>
            ))}
            <mesh ref={mouthGlow} material={glow} position={[0, -0.24, 0.98]} scale={[0.32, 0.12, 0.3]}>
              <sphereGeometry args={[1, 10, 8]} />
            </mesh>
            <group ref={jaw} position={[0, -0.28, 0.15]}>
              <mesh material={skin} position={[0, -0.08, 0.75]} scale={[0.44, 0.16, 0.6]}>
                <sphereGeometry args={[1, 12, 8]} />
              </mesh>
              {[-0.22, 0, 0.22].map((x) => (
                <mesh key={x} material={claw} position={[x, 0.05, 1.18]} rotation-x={Math.PI}>
                  <coneGeometry args={[0.05, 0.16, 4]} />
                </mesh>
              ))}
            </group>
          </group>
          {/* dorsal spines */}
          {spines.map(([x, y, z, s], i) => (
            <group key={i} position={[x, y, z]} rotation-x={-0.5}>
              <mesh material={spine} scale={[s, s * 1.5, s * 0.5]}>
                <coneGeometry args={[0.5, 1.1, 4]} />
              </mesh>
              {[-1, 1].map((side) => (
                <mesh key={side} material={spine} position={[side * s * 0.45, -0.15, 0]} rotation-z={side * -0.35} scale={[s * 0.6, s, s * 0.4]}>
                  <coneGeometry args={[0.45, 0.9, 4]} />
                </mesh>
              ))}
            </group>
          ))}
          {/* arms */}
          {[
            [-1, armL],
            [1, armR],
          ].map(([side, ref]) => (
            <group key={side as number} ref={ref as React.RefObject<THREE.Group>} position={[(side as number) * 1.15, 3.55, 0.6]} rotation-z={(side as number) * 0.25}>
              <mesh material={skin} position={[0, -0.45, 0.2]} rotation-x={0.4}>
                <capsuleGeometry args={[0.22, 0.75, 4, 8]} />
              </mesh>
              {[-0.12, 0, 0.12].map((x) => (
                <mesh key={x} material={claw} position={[x, -0.95, 0.5]} rotation-x={2.2}>
                  <coneGeometry args={[0.05, 0.25, 4]} />
                </mesh>
              ))}
            </group>
          ))}
          {/* tail */}
          <group position={[0, 1.7, -1.1]} ref={(el) => { if (el) tail.current[0] = el; }}>
            <mesh material={skin} rotation-x={-1.25} position={[0, -0.2, -0.65]}>
              <coneGeometry args={[0.72, 1.8, 10]} />
            </mesh>
            <group position={[0, -0.5, -1.4]} ref={(el) => { if (el) tail.current[1] = el; }}>
              <mesh material={skin} rotation-x={-1.4} position={[0, -0.1, -0.6]}>
                <coneGeometry args={[0.5, 1.7, 10]} />
              </mesh>
              <group position={[0, -0.25, -1.35]} ref={(el) => { if (el) tail.current[2] = el; }}>
                <mesh material={skin} rotation-x={-1.5} position={[0, 0, -0.55]}>
                  <coneGeometry args={[0.32, 1.6, 8]} />
                </mesh>
                <mesh material={spine} position={[0, 0.25, -0.4]} rotation-x={-0.6} scale={[0.25, 0.4, 0.15]}>
                  <coneGeometry args={[0.5, 1.1, 4]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
        {/* legs (outside the tilted body so feet stay planted) */}
        {[
          [-0.85, legL],
          [0.85, legR],
        ].map(([x, ref]) => (
          <group key={x as number} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 2.2, -0.1]}>
            <mesh material={skin} position={[0, -0.6, 0.1]} scale={[1, 1, 1.1]}>
              <capsuleGeometry args={[0.52, 0.8, 4, 10]} />
            </mesh>
            <mesh material={skin} position={[0, -1.85, 0.25]} scale={[0.9, 0.35, 1.2]}>
              <sphereGeometry args={[0.55, 12, 8]} />
            </mesh>
            {[-0.25, 0, 0.25].map((cx) => (
              <mesh key={cx} material={claw} position={[cx, -1.95, 0.85]} rotation-x={Math.PI / 2}>
                <coneGeometry args={[0.07, 0.3, 4]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* breath beam lives in world space */}
      <mesh ref={beamGlow} material={beamGlowMat} visible={false}>
        <cylinderGeometry args={[0.7, 0.35, 1, 12, 1, true]} />
      </mesh>
      <mesh ref={beamCore} material={beamCoreMat} visible={false}>
        <cylinderGeometry args={[0.22, 0.1, 1, 10, 1, true]} />
      </mesh>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Impact effects: shockwave, fireball, debris, sparks, smoke          */
/* ------------------------------------------------------------------ */

const DEBRIS = 260;
const SPARKS = 240;
const SMOKE = 70;
const RINGS = 4;

type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; life: number; max: number; size: number };

function emptyPool(n: number): Particle[] {
  return Array.from({ length: n }, () => ({ x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, life: 0, max: 1, size: 0 }));
}

export function ImpactEffects({ attacks }: { attacks: KaijuAttack[] }) {
  const debrisMesh = useRef<THREE.InstancedMesh>(null);
  const sparkMesh = useRef<THREE.InstancedMesh>(null);
  const smokeMesh = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const fireball = useRef<THREE.Mesh>(null);
  const flashLight = useRef<THREE.PointLight>(null);

  const debris = useMemo(() => emptyPool(DEBRIS), []);
  const sparks = useMemo(() => emptyPool(SPARKS), []);
  const smoke = useMemo(() => emptyPool(SMOKE), []);
  const ringState = useMemo(() => Array.from({ length: RINGS }, () => ({ start: -1e9, x: 0, z: 0, s: 1 })), []);
  const fire = useRef({ start: -1e9, x: 0, z: 0, y: 1, s: 1 });
  const spawned = useRef(new Set<string>());
  const cursor = useRef({ d: 0, sp: 0, sm: 0, r: 0 });
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const ringMaterials = useMemo(
    () => Array.from({ length: RINGS }, () => new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })),
    [],
  );
  const fireMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
  useEffect(() => () => {
    ringMaterials.forEach((m) => m.dispose());
    fireMat.dispose();
  }, [ringMaterials, fireMat]);

  function spawn(a: KaijuAttack) {
    const c = cursor.current;
    const s = a.strength;
    const height = Math.max(2, a.top);
    const nDebris = Math.round((a.destroy ? 70 : 30) * s);
    for (let i = 0; i < nDebris; i++) {
      const p = debris[c.d++ % DEBRIS];
      const ang = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 7) * s;
      p.x = a.x + Math.cos(ang) * 0.6;
      p.z = a.z + Math.sin(ang) * 0.6;
      p.y = 0.5 + Math.random() * height * (a.destroy ? 0.9 : 0.4);
      p.vx = Math.cos(ang) * sp;
      p.vz = Math.sin(ang) * sp;
      p.vy = 4 + Math.random() * 9 * s;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.life = 0;
      p.max = 2.2 + Math.random() * 1.5;
      p.size = 0.15 + Math.random() * 0.45;
    }
    for (let i = 0; i < Math.round(70 * s); i++) {
      const p = sparks[c.sp++ % SPARKS];
      const ang = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 9) * s;
      p.x = a.x;
      p.z = a.z;
      p.y = 0.5 + Math.random() * height * 0.6;
      p.vx = Math.cos(ang) * sp;
      p.vz = Math.sin(ang) * sp;
      p.vy = 3 + Math.random() * 12;
      p.life = 0;
      p.max = 0.8 + Math.random() * 1.1;
      p.size = 0.06 + Math.random() * 0.12;
    }
    for (let i = 0; i < (a.destroy ? 16 : 7); i++) {
      const p = smoke[c.sm++ % SMOKE];
      p.x = a.x + (Math.random() - 0.5) * 2.5;
      p.z = a.z + (Math.random() - 0.5) * 2.5;
      p.y = 0.5 + Math.random() * 2;
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vz = (Math.random() - 0.5) * 1.2;
      p.vy = 1.2 + Math.random() * 1.5;
      p.life = 0;
      p.max = 3.5 + Math.random() * 2.5;
      p.size = 1 + Math.random() * 1.2;
    }
    const r = ringState[c.r++ % RINGS];
    r.start = performance.now();
    r.x = a.x;
    r.z = a.z;
    r.s = s;
    fire.current = { start: performance.now(), x: a.x, z: a.z, y: Math.min(height * 0.5, 6), s };
    impactShake.at = performance.now();
    impactShake.strength = s * (a.destroy ? 1 : 0.6);
  }

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const now = Date.now();
    for (const a of attacks) {
      if (!spawned.current.has(a.id) && now >= a.at) {
        spawned.current.add(a.id);
        spawn(a);
      }
    }
    if (spawned.current.size > 200) spawned.current = new Set(attacks.map((a) => a.id));

    const step = (pool: Particle[], mesh: THREE.InstancedMesh | null, gravity: number, mode: "debris" | "spark" | "smoke") => {
      if (!mesh) return;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p.life >= p.max) {
          dummy.position.set(0, -50, 0);
          dummy.scale.setScalar(0);
        } else {
          p.life += delta;
          p.vy -= gravity * delta;
          if (mode === "smoke") {
            p.vx *= 0.99;
            p.vz *= 0.99;
          }
          p.x += p.vx * delta;
          p.y += p.vy * delta;
          p.z += p.vz * delta;
          if (mode === "debris" && p.y < p.size * 0.5) {
            p.y = p.size * 0.5;
            p.vy *= -0.3;
            p.vx *= 0.6;
            p.vz *= 0.6;
          }
          const k = p.life / p.max;
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(p.rx + p.life * 4, p.ry + p.life * 3, 0);
          const scale = mode === "smoke" ? p.size * (0.5 + k * 1.7) * (k > 0.8 ? (1 - k) * 5 : 1) : mode === "spark" ? p.size * (1 - k) : p.size * (k > 0.85 ? (1 - k) / 0.15 : 1);
          dummy.scale.setScalar(Math.max(0, scale));
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    step(debris, debrisMesh.current, 20, "debris");
    step(sparks, sparkMesh.current, 9, "spark");
    step(smoke, smokeMesh.current, -0.2, "smoke");

    const pnow = performance.now();
    ringState.forEach((r, i) => {
      const mesh = rings.current[i];
      if (!mesh) return;
      const age = (pnow - r.start) / 1000;
      const on = age < 1.3;
      mesh.visible = on;
      if (on) {
        mesh.position.set(r.x, 0.1, r.z);
        mesh.scale.setScalar(1 + age * 14 * r.s);
        ringMaterials[i].opacity = Math.max(0, 0.9 * (1 - age / 1.3));
      }
    });
    const f = fire.current;
    const fAge = (pnow - f.start) / 1000;
    if (fireball.current) {
      const on = fAge < 0.7;
      fireball.current.visible = on;
      if (on) {
        fireball.current.position.set(f.x, f.y, f.z);
        fireball.current.scale.setScalar((1 + fAge * 9) * f.s);
        fireMat.opacity = 0.9 * (1 - fAge / 0.7);
      }
    }
    if (flashLight.current) {
      flashLight.current.position.set(f.x, f.y + 2, f.z);
      flashLight.current.intensity = fAge < 1.5 ? 2600 * f.s * Math.exp(-fAge * 3.2) : 0;
    }
  });

  return (
    <>
      <pointLight ref={flashLight} color="#ff7a2a" intensity={0} distance={60} decay={1.7} />
      <instancedMesh ref={debrisMesh} args={[undefined, undefined, DEBRIS]} frustumCulled={false}>
        <boxGeometry args={[1, 0.7, 1]} />
        <meshStandardMaterial color="#6d6482" roughness={0.9} emissive="#ff5a1f" emissiveIntensity={0.35} />
      </instancedMesh>
      <instancedMesh ref={sparkMesh} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffc04d" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={smokeMesh} args={[undefined, undefined, SMOKE]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#5a4a80" emissive="#ff5a1f" emissiveIntensity={0.15} transparent opacity={0.32} depthWrite={false} roughness={1} />
      </instancedMesh>
      {ringMaterials.map((m, i) => (
        <mesh key={i} ref={(el) => { rings.current[i] = el; }} rotation-x={-Math.PI / 2} material={m} visible={false}>
          <ringGeometry args={[0.85, 1, 64]} />
        </mesh>
      ))}
      <mesh ref={fireball} material={fireMat} visible={false}>
        <sphereGeometry args={[1, 18, 14]} />
      </mesh>
    </>
  );
}

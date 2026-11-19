"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityBuilding } from "@/lib/types";
import { shortWallet } from "@/lib/demo-data";
import { beaconMaterial, buildRubbleGeometry, buildTowerGeometry, getBodyMaterial, getLabelTexture, getRubbleMaterial, getTrimMaterial } from "./assets";

const RISE_MS = 1300;
const COLLAPSE_MS = 950;

type TowerProps = { building: CityBuilding; focused: boolean; labelled: boolean };

/**
 * One tower. Data changes (rise, growth, damage, destruction) arrive as new
 * target values; the frame loop eases the displayed height towards them, and
 * waits for the kaiju's hit time before showing damage.
 */
export const Tower = memo(function Tower({ building: b, focused, labelled }: TowerProps) {
  const geo = useMemo(() => buildTowerGeometry(b.style, b.width, b.height, b.seed), [b.style, b.width, b.height, b.seed]);
  useEffect(() => () => {
    geo.body.dispose();
    geo.trim.dispose();
  }, [geo]);

  const root = useRef<THREE.Group>(null);
  const scaled = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const label = useRef<THREE.Sprite>(null);
  const warn = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const shown = useRef<number>(Date.now() - b.bornAt < RISE_MS ? 0.001 : b.height);
  const collapse = useRef(0);
  const collapseFrom = useRef(-1);

  const warnMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ff2244", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
  const beamMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), [b.color]);
  const beaconMat = useMemo(() => beaconMaterial(), []);
  const labelTexture = useMemo(() => (b.claimed ? getLabelTexture(shortWallet(b.wallet), b.color) : null), [b.claimed, b.wallet, b.color]);
  const phase = (b.seed % 1000) / 160;

  useEffect(() => () => {
    warnMaterial.dispose();
    beamMaterial.dispose();
    beaconMat.dispose();
  }, [warnMaterial, beamMaterial, beaconMat]);

  useFrame((state, delta) => {
    const group = root.current;
    const inner = scaled.current;
    if (!group || !inner) return;
    const now = Date.now();
    const H = Math.max(2.5, b.height);
    const pendingHit = b.hitAt > now;
    const sinceHit = now - b.hitAt;
    const t = state.clock.elapsedTime;

    if (pendingHit) {
      // Targeted: tremble and flash red while the kaiju closes in.
      const urgency = 1 - Math.min(1, (b.hitAt - now) / 1200);
      group.position.x = b.x + Math.sin(t * 60) * 0.05 * urgency;
      group.position.z = b.z + Math.cos(t * 53) * 0.05 * urgency;
      warnMaterial.opacity = (0.25 + 0.3 * urgency) * (0.5 + 0.5 * Math.sin(t * 18));
    } else {
      group.position.x = b.x;
      group.position.z = b.z;
      const hitFlash = b.hitAt > 0 && sinceHit < 600 ? 1 - sinceHit / 600 : 0;
      warnMaterial.opacity = hitFlash * 0.7;

      if (b.status === "rubble") {
        if (collapseFrom.current < 0) collapseFrom.current = shown.current;
        collapse.current = Math.min(1, sinceHit / COLLAPSE_MS);
        const k = collapse.current;
        shown.current = Math.max(0.001, collapseFrom.current * (1 - k * k));
        inner.rotation.z = k * 0.35 * ((b.seed & 1) ? 1 : -1);
        inner.rotation.x = k * 0.18;
        inner.position.y = -k * 1.2;
        group.position.x = b.x + Math.sin(t * 40) * 0.12 * (1 - k);
      } else {
        const target = now < b.bornAt ? 0.001 : b.height;
        const speed = shown.current < target ? 3.2 : 4.5;
        shown.current += (target - shown.current) * (1 - Math.exp(-delta * speed));
        inner.rotation.set(0, 0, 0);
        inner.position.y = 0;
      }
    }

    const ratio = Math.max(0.001, shown.current / H);
    inner.scale.set(1, ratio, 1);
    inner.visible = !(b.status === "rubble" && collapse.current >= 1);

    if (warn.current) {
      warn.current.visible = warnMaterial.opacity > 0.01 && inner.visible;
    }

    // Rise / growth beam of light.
    const sinceBorn = now - b.bornAt;
    const sinceGrow = b.grewAt ? now - b.grewAt : Infinity;
    const beamLife = Math.min(sinceBorn > 0 ? sinceBorn : Infinity, sinceGrow);
    if (beam.current) {
      const on = beamLife < 1500 && b.status === "standing";
      beam.current.visible = on;
      if (on) {
        beamMaterial.opacity = 0.55 * (1 - beamLife / 1500);
        beam.current.scale.set(1 + (beamLife / 1500) * 0.6, 1, 1 + (beamLife / 1500) * 0.6);
      }
    }

    if (beacon.current) {
      beacon.current.visible = inner.visible && b.status === "standing" && Math.sin(t * 2.4 + phase) > 0.35;
      beacon.current.position.y = geo.beacon[1] * ratio;
    }
    if (label.current) {
      label.current.visible = labelled && inner.visible && b.status === "standing";
      label.current.position.y = geo.top * ratio + 1.3 + (focused ? Math.sin(t * 3) * 0.15 : 0);
    }
  });

  const H = Math.max(2.5, b.height);
  return (
    <group ref={root} position={[b.x, 0, b.z]}>
      <group rotation-y={geo.rotation}>
        <group ref={scaled}>
          <mesh geometry={geo.body} material={getBodyMaterial(b.color)} />
          <mesh geometry={geo.trim} material={getTrimMaterial(b.color)} />
          <mesh ref={warn} position={[0, H / 2, 0]} material={warnMaterial} visible={false}>
            <boxGeometry args={[b.width * 1.25, H + 0.4, b.width * 1.25]} />
          </mesh>
        </group>
        <mesh ref={beacon} position={[geo.beacon[0], geo.beacon[1], geo.beacon[2]]} material={beaconMat}>
          <sphereGeometry args={[0.16, 8, 6]} />
        </mesh>
      </group>
      <mesh ref={beam} position={[0, 20, 0]} material={beamMaterial} visible={false}>
        <cylinderGeometry args={[b.width * 0.55, b.width * 0.75, 40, 18, 1, true]} />
      </mesh>
      {labelTexture && (
        <sprite ref={label} position={[0, geo.top + 1.3, 0]} scale={focused ? [6.4, 1.6, 1] : [5.2, 1.3, 1]} renderOrder={10}>
          <spriteMaterial map={labelTexture} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      )}
    </group>
  );
});

/** Wreckage left after the kaiju destroys a tower. Smokes for a while. */
export const Rubble = memo(function Rubble({ building: b }: { building: CityBuilding }) {
  const geo = useMemo(() => buildRubbleGeometry(b.width, b.height, b.seed), [b.width, b.height, b.seed]);
  useEffect(() => () => geo.dispose(), [geo]);
  const group = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.Group>(null);
  const smokeMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5a4a80", emissive: "#ff5a1f", emissiveIntensity: 0.12, transparent: true, opacity: 0.3, depthWrite: false, roughness: 1 }), []);
  useEffect(() => () => smokeMaterial.dispose(), [smokeMaterial]);

  useFrame((state) => {
    const now = Date.now();
    const since = now - b.hitAt;
    if (!group.current) return;
    group.current.visible = since > 0;
    const k = Math.min(1, Math.max(0, since / 900));
    group.current.position.y = -0.8 * (1 - k);
    if (smoke.current) {
      const life = since / 1000;
      const on = life > 0 && life < 30;
      smoke.current.visible = on;
      if (on) {
        smokeMaterial.opacity = 0.3 * Math.min(1, (30 - life) / 8);
        smoke.current.children.forEach((child, i) => {
          const cycle = ((state.clock.elapsedTime * 0.35 + i / 3) % 1);
          child.position.y = 1 + cycle * 7;
          child.position.x = Math.sin(cycle * 4 + i) * 0.6 + cycle * 1.4;
          child.scale.setScalar(0.6 + cycle * 2.2);
        });
      }
    }
  });

  return (
    <group position={[b.x, 0, b.z]}>
      <group ref={group} visible={false}>
        <mesh geometry={geo} material={getRubbleMaterial()} />
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[b.width * 1.1, 24]} />
          <meshBasicMaterial color="#ff4a1a" transparent opacity={0.22} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <group ref={smoke} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} material={smokeMaterial}>
            <sphereGeometry args={[0.9, 10, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

/** Ring + light pillar marking the tower the camera is tracking. */
export function FocusMarker({ building }: { building: CityBuilding | undefined }) {
  const ring = useRef<THREE.Mesh>(null);
  const pillar = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      ring.current.rotation.z = t * 0.8;
      ring.current.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
    }
    if (pillar.current) pillar.current.opacity = 0.16 + Math.sin(t * 2.5) * 0.06;
  });
  if (!building) return null;
  const r = building.width * 0.9 + 0.8;
  return (
    <group position={[building.x, 0, building.z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
        <ringGeometry args={[r, r + 0.28, 6]} />
        <meshBasicMaterial color="#b6ff3b" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 30, 0]}>
        <cylinderGeometry args={[r * 0.7, r * 0.9, 60, 24, 1, true]} />
        <meshBasicMaterial ref={pillar} color="#b6ff3b" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

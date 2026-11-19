"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, Float, OrbitControls, Stars, Text } from "@react-three/drei";
import * as THREE from "three";
import type { CityBuilding } from "@/lib/types";

function Building({ building, focused }: { building: CityBuilding; focused: boolean }) {
  const body = useRef<THREE.Mesh>(null);
  const variant = useMemo(() => { let hash = 0; for (const char of building.id) hash = (hash * 31 + char.charCodeAt(0)) | 0; return Math.abs(hash) % 5; }, [building.id]);
  const roof = useRef<THREE.Group>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const currentHeight = useRef(building.height);
  const targetHeight = useRef(building.targetHeight);
  const windowGeometry = useMemo(() => new THREE.BoxGeometry(0.2, 0.19, 0.025), []);
  const windowMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: building.color,
    emissive: building.color,
    emissiveIntensity: 1.25,
    metalness: 0.2,
    roughness: 0.36,
    transparent: true,
    opacity: 0.82,
  }), [building.color]);

  useEffect(() => {
    targetHeight.current = building.targetHeight;
  }, [building.targetHeight]);

  useEffect(() => {
    windowMaterial.color.set(building.isFlattened ? "#26343a" : building.color);
    windowMaterial.emissive.set(building.isFlattened ? "#10181c" : building.color);
    windowMaterial.emissiveIntensity = building.isFlattened ? 0.08 : 1.25;
    windowMaterial.opacity = building.isFlattened ? 0.25 : 1;
  }, [building.color, building.isFlattened, windowMaterial]);

  // One instanced draw call replaces 28 individual window meshes per tower.
  useEffect(() => {
    const instance = windows.current;
    if (!instance) return;
    const transform = new THREE.Object3D();
    let index = 0;
    for (let row = 0; row < 7; row += 1) {
      const y = (row - 3) * 0.13;
      for (const x of [-0.37, 0.37]) {
        transform.position.set(x, y, 0.677);
        transform.rotation.set(0, 0, 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        instance.setMatrixAt(index++, transform.matrix);
      }
      for (const z of [-0.36, 0.36]) {
        transform.position.set(0.722, y, z);
        transform.rotation.set(0, Math.PI / 2, 0);
        transform.scale.set(1, 1, 1);
        transform.updateMatrix();
        instance.setMatrixAt(index++, transform.matrix);
      }
    }
    instance.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    instance.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((state, delta) => {
    currentHeight.current = THREE.MathUtils.damp(currentHeight.current, targetHeight.current, building.isFlattened ? 5.5 : 4.5, delta);
    const height = Math.max(0.11, currentHeight.current);
    if (body.current) {
      body.current.scale.y = height;
      body.current.position.y = height / 2;
      if (focused) {
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 3.2) * 0.018;
        body.current.scale.x = pulse;
        body.current.scale.z = pulse;
      } else {
        body.current.scale.x = 1;
        body.current.scale.z = 1;
      }
    }
    if (roof.current) roof.current.position.y = height + 0.12;
    if (windows.current) {
      windows.current.position.y = height / 2;
      windows.current.scale.y = height;
    }
  });

  return (
    <group position={[building.x, 0, building.z]}>
      <mesh ref={body} castShadow receiveShadow>
        <boxGeometry args={[1.42, 1, 1.34]} />
        <meshStandardMaterial
          color={building.isFlattened ? "#303943" : "#263747"}
          metalness={0.48}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0.045, 0]}>
        <boxGeometry args={[1.52, 0.09, 1.43]} />
        <meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={building.isFlattened ? 0.025 : 0.24} metalness={0.5} roughness={0.34} />
      </mesh>
      <instancedMesh ref={windows} args={[windowGeometry, windowMaterial, 28]} frustumCulled={false} />
      {variant === 0 && <group>{[-0.58, 0.58].map((x) => <mesh key={x} position={[x, 0.5, 0.68]}><boxGeometry args={[0.08, 1, 0.08]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.2} /></mesh>)}</group>}
      {variant === 1 && [0.25, 0.5, 0.75].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[1.55, 0.045, 1.48]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.18} /></mesh>)}
      {variant === 2 && <mesh position={[0, 0.5, 0]}><boxGeometry args={[0.22, 1, 1.42]} /><meshStandardMaterial color="#243640" metalness={0.5} /></mesh>}
      {variant === 3 && <group>{[-0.5, 0, 0.5].map((x) => <mesh key={x} position={[x, 0.5, 0.68]}><boxGeometry args={[0.08, 1, 0.06]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.28} /></mesh>)}</group>}
      {variant === 4 && [0.25, 0.5, 0.75].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[1.5, 0.06, 1.4]} /><meshStandardMaterial color="#253944" metalness={0.7} /></mesh>)}
      <group ref={roof}>
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[1.08, 0.12, 1.04]} />
          <meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.42} metalness={0.42} roughness={0.34} />
        </mesh>
        {variant === 0 && <mesh position={[0, 0.28, 0]}><cylinderGeometry args={[0.28, 0.42, 0.5, 6]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.32} metalness={0.4} /></mesh>}
        {variant === 1 && <group position={[0, 0.22, 0]}><mesh><boxGeometry args={[0.82, 0.28, 0.82]} /><meshStandardMaterial color="#1d3038" metalness={0.7} /></mesh><mesh position={[0, 0.25, 0]}><boxGeometry args={[0.55, 0.2, 0.55]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.6} /></mesh></group>}
        {variant === 2 && <group>{[-0.42, 0.42].map((x) => <mesh key={x} position={[x, 0.24, 0]}><cylinderGeometry args={[0.08, 0.08, 0.5, 8]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.45} /></mesh>)}</group>}
        {variant === 3 && <mesh position={[0, 0.3, 0]}><coneGeometry args={[0.48, 0.65, 4]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.3} metalness={0.5} /></mesh>}
        {variant === 4 && <group position={[0, 0.2, 0]}><mesh><boxGeometry args={[1.12, 0.18, 0.3]} /><meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.35} /></mesh><mesh rotation={[0, Math.PI / 4, 0]} position={[0, 0.2, 0]}><boxGeometry args={[0.7, 0.12, 0.7]} /><meshStandardMaterial color="#263b45" metalness={0.6} /></mesh></group>}
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.27, 8]} />
          <meshStandardMaterial color={building.color} emissive={building.color} emissiveIntensity={0.78} />
        </mesh>
        {!building.isFlattened && (
          <Text
            position={[0, 0.47, 0]}
            fontSize={0.18}
            color="#e5f2f2"
            outlineColor="#081319"
            outlineWidth={0.02}
            anchorX="center"
            anchorY="middle"
            maxWidth={1.8}
          >
            {building.wallet.slice(0, 9)}
          </Text>
        )}
      </group>
      {focused && (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.08, 1.22, 48]} />
          <meshBasicMaterial color="#74d8cb" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function Kaiju({ target, pulse, strength }: { target: { x: number; z: number } | null; pulse: number; strength: number }) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const progress = useRef(1);
  const previousPulse = useRef(pulse);
  const targetPos = useRef(new THREE.Vector3(0, 0, 0));
  const fromPos = useRef(new THREE.Vector3(0, 0, 0));
  const stompAge = useRef(99);
  const debris = useRef<THREE.InstancedMesh>(null);
  const fire = useRef<THREE.InstancedMesh>(null);
  const debrisDummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (target) targetPos.current.set(target.x + 2.6, 0, target.z + 1.2);
  }, [target, pulse]);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (pulse !== previousPulse.current) {
      previousPulse.current = pulse;
      fromPos.current.copy(group.current.position);
      progress.current = 0;
    }
    if (target && progress.current < 1) {
      progress.current = Math.min(1, progress.current + delta * 1.35);
      const eased = 1 - Math.pow(1 - progress.current, 3);
      group.current.position.lerpVectors(fromPos.current, targetPos.current, eased);
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, -0.75, delta * 2.5);
    }
    stompAge.current += delta;
    const stomp = progress.current > 0.7 && progress.current < 0.92;
    if (debris.current) {
      for (let i = 0; i < 48; i++) {
        const active = stompAge.current < 1.8;
        const seed = i * 12.9898;
        const angle = seed % (Math.PI * 2);
        const speed = 1.2 + (i % 7) * 0.32;
        const t = stompAge.current;
        const x = Math.cos(angle) * speed * t;
        const z = Math.sin(angle) * speed * t;
        const y = Math.max(0.05, (i % 5) * 0.22 + 3.8 * t - 5.2 * t * t);
        debrisDummy.position.set(targetPos.current.x + x, y, targetPos.current.z + z);
        debrisDummy.rotation.set(t * (i % 3), t * 2, t * 3);
        const scale = active ? (0.06 + (i % 4) * 0.035) * Math.max(0, 1 - t / 1.8) : 0;
        debrisDummy.scale.setScalar(scale);
        debrisDummy.updateMatrix();
        debris.current.setMatrixAt(i, debrisDummy.matrix);
      }
      debris.current.instanceMatrix.needsUpdate = true;
    }
    if (fire.current) {
      for (let i = 0; i < 20; i++) {
        const active = stompAge.current < 4;
        const angle = i * 2.399;
        const t = state.clock.elapsedTime;
        debrisDummy.position.set(
          targetPos.current.x + Math.cos(angle) * (1.1 + Math.sin(t * 3 + i) * 0.2),
          active ? 0.25 + Math.abs(Math.sin(t * 4 + i)) * 1.25 : -3,
          targetPos.current.z + Math.sin(angle) * (1.1 + Math.cos(t * 2 + i) * 0.2)
        );
        debrisDummy.scale.setScalar(active ? 0.05 + Math.abs(Math.sin(t * 6 + i)) * 0.1 : 0);
        debrisDummy.rotation.set(0, 0, t);
        debrisDummy.updateMatrix();
        fire.current.setMatrixAt(i, debrisDummy.matrix);
      }
      fire.current.instanceMatrix.needsUpdate = true;
    }
    const bob = Math.sin(state.clock.elapsedTime * 2.1) * 0.07;
    const kaijuScale = 1.06 + strength * 0.025;
    group.current.position.y = stomp ? -0.15 * strength : bob;
    group.current.scale.setScalar(stomp ? kaijuScale : 1);
    if (ring.current) {
      const age = Math.max(0, progress.current - 0.7);
      ring.current.scale.setScalar(0.65 + age * 8 * strength);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - age * 3);
    }
  });

  return (
    <group ref={group} position={[7, 0, 6]}>
      <group position={[0, 1.2, 0]}>
        {/* Body */}
        <mesh castShadow position={[0, 0.25, 0]} scale={[1.35, 0.86, 1.1]}>
          <sphereGeometry args={[1, 18, 14]} />
          <meshStandardMaterial color="#438f80" roughness={0.62} metalness={0.05} />
        </mesh>
        {/* Head */}
        <mesh castShadow position={[0.15, 0.86, -0.42]} scale={[0.94, 0.7, 0.86]}>
          <sphereGeometry args={[1, 18, 14]} />
          <meshStandardMaterial color="#71bca1" roughness={0.54} />
        </mesh>
        {/* Eyes */}
        {[-0.42, 0.55].map((x) => (
          <group key={x} position={[x, 1.34, -0.72]}>
            <mesh>
              <sphereGeometry args={[0.24, 12, 10]} />
              <meshStandardMaterial color="#e2c27d" />
            </mesh>
            <mesh position={[0, 0, -0.2]}>
              <sphereGeometry args={[0.11, 12, 10]} />
              <meshBasicMaterial color="#ead9ae" />
            </mesh>
            <mesh position={[0, 0, -0.29]}>
              <sphereGeometry args={[0.055, 10, 8]} />
              <meshBasicMaterial color="#101b12" />
            </mesh>
          </group>
        ))}
        {/* Jaw */}
        <mesh position={[0.18, 0.39, -0.8]} scale={[0.72, 0.17, 0.25]}>
          <sphereGeometry args={[1, 16, 10]} />
          <meshStandardMaterial color="#193d3e" />
        </mesh>
        {/* Arms */}
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 1.02, 0.38, -0.12]} rotation={[0, 0, side * -0.3]}>
            <mesh castShadow rotation={[0, 0, side * -0.35]} position={[0, -0.12, 0]}>
              <capsuleGeometry args={[0.24, 0.58, 5, 8]} />
              <meshStandardMaterial color="#4b9b86" />
            </mesh>
            <mesh position={[0, -0.49, -0.08]}>
              <sphereGeometry args={[0.3, 12, 10]} />
              <meshStandardMaterial color="#65ad91" />
            </mesh>
          </group>
        ))}
        {/* Legs */}
        {[-0.8, 0.8].map((x) => (
          <mesh key={x} castShadow position={[x, -0.55, 0.42]} rotation={[0.2, 0, x * 0.25]}>
            <capsuleGeometry args={[0.32, 0.44, 5, 8]} />
            <meshStandardMaterial color="#3e7e73" />
          </mesh>
        ))}
        {/* Back bumps */}
        {[-0.62, -0.2, 0.24, 0.64].map((x, i) => (
          <mesh key={x} position={[x, 1.01 - Math.abs(x) * 0.15, 0.48]} rotation={[0.25, 0, x * 0.25]}>
            <coneGeometry args={[0.16, 0.3 + (i % 2) * 0.08, 5]} />
            <meshStandardMaterial color="#d6b579" />
          </mesh>
        ))}
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[1.15, 1.38, 48]} />
        <meshBasicMaterial color="#d6b579" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function CityFloor() {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#132b3c" roughness={0.7} />
      </mesh>
      <gridHelper args={[100, 64, "#32647b", "#1c3a4c"]} position={[0, -0.09, 0]} />
      {/* Streets */}
      {[ -8.8, 0, 8.8 ].map((x) => (
        <mesh key={`road-x-${x}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.075, 0]}>
          <planeGeometry args={[1.15, 36]} />
          <meshBasicMaterial color="#10212a" />
        </mesh>
      ))}
      {[ -7, 1.5, 10 ].map((z) => (
        <mesh key={`road-z-${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, z]}>
          <planeGeometry args={[34, 1.1]} />
          <meshBasicMaterial color="#10212a" />
        </mesh>
      ))}
    </group>
  );
}

function CameraFlight({ focus }: { focus: { x: number; z: number } | null }) {
  const { camera, controls } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.2, 0));
  const cameraTarget = useRef(new THREE.Vector3(15, 13, 18));
  const flightActive = useRef(false);
  useEffect(() => {
    if (focus) {
      target.current.set(focus.x, 1.6, focus.z);
      cameraTarget.current.set(focus.x + 9, 8, focus.z + 11);
    } else {
      target.current.set(0, 1.2, 0);
      cameraTarget.current.set(15, 13, 18);
    }
    flightActive.current = true;
  }, [focus]);
  useFrame((_, delta) => {
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void };
    if (!flightActive.current) return;
    const alpha = 1 - Math.exp(-delta * 2.1);
    camera.position.lerp(cameraTarget.current, alpha);
    if (orbit?.target) {
      orbit.target.lerp(target.current, 1 - Math.exp(-delta * 2.5));
      orbit.update?.();
    }
    if (camera.position.distanceTo(cameraTarget.current) < 0.12 && (!orbit?.target || orbit.target.distanceTo(target.current) < 0.08)) flightActive.current = false;
  });
  return null;
}
export default function CityScene({
  buildings,
  focusedWallet,
  stompTarget,
  stompPulse,
  stompStrength,
}: {
  buildings: CityBuilding[];
  focusedWallet: string | null;
  stompTarget: { x: number; z: number } | null;
  stompPulse: number;
  stompStrength: number;
}) {
  const focused = useMemo(() => buildings.find((item) => item.wallet === focusedWallet), [buildings, focusedWallet]);
  const focus = useMemo(() => focused ? { x: focused.x, z: focused.z } : null, [focused?.x, focused?.z]);
  return (
    <Canvas frameloop="always" shadows dpr={[1, 1.35]} camera={{ position: [13, 11, 15], fov: 48, near: 0.1, far: 140 }} gl={{ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false }} performance={{ min: 0.65, max: 1, debounce: 250 }}>
      <AdaptiveDpr pixelated={false} />
      <color attach="background" args={["#071218"]} />
      <fog attach="fog" args={["#071218", 25, 58]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#c5eaff", "#24364d", 0.72]} />
      <directionalLight position={[9, 18, 8]} intensity={2.8} castShadow shadow-mapSize={[768, 768]} />
      <pointLight position={[-12, 8, -10]} intensity={80} color="#55aeb0" distance={35} />
      <pointLight position={[10, 5, 12]} intensity={70} color="#d0a76a" distance={24} />
      <Stars radius={70} depth={36} count={900} factor={1.7} saturation={0.28} fade speed={0.16} />
      <CityFloor />
      {buildings.map((building) => (
        <Building key={building.id} building={building} focused={building.wallet === focusedWallet} />
      ))}
      <Kaiju target={stompTarget} pulse={stompPulse} strength={stompStrength} />
      {focused && (
        <Float speed={2} rotationIntensity={0.15} floatIntensity={0.4}>
          <mesh position={[focused.x, focused.height + 1.45, focused.z]}>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshBasicMaterial color="#d6b579" />
          </mesh>
        </Float>
      )}
      <CameraFlight focus={focus} />
      <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.09} rotateSpeed={0.68} zoomSpeed={0.78} minDistance={8} maxDistance={36} maxPolarAngle={Math.PI / 2.08} minPolarAngle={0.32} />
    </Canvas>
  );
}

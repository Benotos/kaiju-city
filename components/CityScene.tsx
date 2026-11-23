"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import type { CityBuilding, KaijuAttack } from "@/lib/types";
import { CITY_RADIUS } from "@/lib/city";
import { FocusMarker, Rubble, Tower } from "@/components/city/Towers";
import { InstancedTowers } from "@/components/city/InstancedTowers";
import { ImpactEffects, Kaiju, impactShake } from "@/components/city/Kaiju";
import { Atmosphere, Backdrop, Ground, Lights, Sky, Traffic } from "@/components/city/World";

type OrbitControlsImpl = {
  target: THREE.Vector3;
  autoRotate: boolean;
  update: () => void;
  addEventListener: (type: "start" | "end", listener: () => void) => void;
  removeEventListener: (type: "start" | "end", listener: () => void) => void;
};

type SceneProps = {
  buildings: CityBuilding[];
  attacks: KaijuAttack[];
  focusedWallet: string | null;
  /** Increment to fly the camera back to the full-city view. */
  resetToken: number;
};

/* ------------------------------------------------------------------ */
/* Camera: one system. OrbitControls owns the camera; this rig only    */
/* eases the controls' target/position during a flight, and stops the  */
/* moment the user grabs the view.                                     */
/* ------------------------------------------------------------------ */

function CameraRig({ focus, fitRadius, resetToken }: { focus: CityBuilding | undefined; fitRadius: number; resetToken: number }) {
  const { camera, controls, size } = useThree();
  const flight = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const lastInput = useRef(-1e9);
  const placed = useRef(false);

  const home = useCallback(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (persp.fov * Math.PI) / 180;
    // Big holder cities: frame the skyline core rather than the far edge.
    const framed = fitRadius > 40 ? 40 + (fitRadius - 40) * 0.45 : fitRadius;
    let dist = (framed / Math.tan(vFov / 2)) * 0.82;
    if (aspect < 1.25) dist /= Math.pow(aspect / 1.25, 0.55);
    dist = THREE.MathUtils.clamp(dist, 26, 230);
    const dir = new THREE.Vector3(1, 0.78, 1.2).normalize();
    return { pos: dir.multiplyScalar(dist), target: new THREE.Vector3(0, 4.5, 0) };
  }, [camera, size.width, size.height, fitRadius]);

  // Place the camera instantly on first frame so the city is in view at load.
  useEffect(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c || placed.current) return;
    const h = home();
    camera.position.copy(h.pos);
    c.target.copy(h.target);
    c.update();
    placed.current = true;
  }, [controls, camera, home]);

  useEffect(() => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const onStart = () => {
      flight.current = null;
      lastInput.current = performance.now();
      c.autoRotate = false;
    };
    const onEnd = () => { lastInput.current = performance.now(); };
    c.addEventListener("start", onStart);
    c.addEventListener("end", onEnd);
    return () => {
      c.removeEventListener("start", onStart);
      c.removeEventListener("end", onEnd);
    };
  }, [controls]);

  // Reset / resize / city growth → fly home (unless the user is driving).
  useEffect(() => {
    if (!placed.current) return;
    if (focus) return;
    if (performance.now() - lastInput.current < 6000 && resetToken === 0) return;
    flight.current = home();
  }, [home, resetToken, focus]);

  // Focus a wallet's tower, keeping the current viewing angle.
  const focusKey = focus ? `${focus.id}` : "";
  useEffect(() => {
    if (!focus) return;
    const c = controls as unknown as OrbitControlsImpl | null;
    const target = new THREE.Vector3(focus.x, Math.min(focus.height * 0.55, 12), focus.z);
    const dir = camera.position.clone().sub(c ? c.target : new THREE.Vector3()).normalize();
    dir.y = Math.max(dir.y, 0.42);
    dir.normalize();
    const dist = 16 + focus.height * 0.9;
    flight.current = { pos: target.clone().add(dir.multiplyScalar(dist)), target };
    if (c) c.autoRotate = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useFrame((_, delta) => {
    const c = controls as unknown as OrbitControlsImpl | null;
    if (!c) return;
    const f = flight.current;
    if (f) {
      const a = 1 - Math.exp(-delta * 2.6);
      camera.position.lerp(f.pos, a);
      c.target.lerp(f.target, a);
      if (camera.position.distanceTo(f.pos) < 0.15 && c.target.distanceTo(f.target) < 0.1) flight.current = null;
    } else if (!focus && performance.now() - lastInput.current > 7000) {
      c.autoRotate = true;
    }
    // Keep the view anchored on the city.
    const limit = CITY_RADIUS * 0.85;
    c.target.x = THREE.MathUtils.clamp(c.target.x, -limit, limit);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -limit, limit);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0.5, 16);
  });

  return null;
}

/** Impacts shake the world, not the camera, so it never fights OrbitControls. */
function ShakeGroup({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!group.current) return;
    const age = (performance.now() - impactShake.at) / 1000;
    if (age < 0.9) {
      const amp = impactShake.strength * 0.32 * Math.exp(-age * 5);
      group.current.position.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.6, (Math.random() - 0.5) * amp);
    } else group.current.position.set(0, 0, 0);
  });
  return <group ref={group}>{children}</group>;
}

/** Detailed towers: the largest holders, plus whatever the viewer is looking at or just traded. */
const HERO_COUNT = 64;
const HERO_COUNT_LOW = 40;

function City({ buildings, attacks, focusedWallet, resetToken, lowPower }: SceneProps & { lowPower: boolean }) {
  const focused = useMemo(() => buildings.find((b) => b.claimed && b.wallet === focusedWallet && b.status === "standing"), [buildings, focusedWallet]);

  const occupiedRadius = useMemo(
    () => buildings.reduce((r, b) => Math.max(r, Math.hypot(b.x, b.z) + b.width), 10),
    [buildings],
  );
  // Round so tiny changes don't re-trigger camera flights.
  const fitRadius = Math.ceil((occupiedRadius + 8) / 4) * 4;

  const { heroes, minors } = useMemo(() => {
    const now = Date.now();
    const rank = [...buildings].sort((a, b) => (b.balance ?? b.height) - (a.balance ?? a.height));
    const hero = new Set<string>();
    const limit = lowPower ? HERO_COUNT_LOW : HERO_COUNT;
    for (const b of rank) {
      if (hero.size >= limit) break;
      if (b.status === "standing") hero.add(b.id);
    }
    if (focused) hero.add(focused.id);
    // Recent action gets the full treatment (rise beams, kaiju warnings, tags).
    let recent = 0;
    for (const b of buildings) {
      if (recent >= 24) break;
      if (!hero.has(b.id) && (now - b.lastActive < 20_000 || b.hitAt > now - 3000)) {
        hero.add(b.id);
        recent++;
      }
    }
    return { heroes: buildings.filter((b) => hero.has(b.id)), minors: buildings.filter((b) => !hero.has(b.id)) };
  }, [buildings, focused, lowPower]);

  const labelled = useMemo(() => {
    const now = Date.now();
    const ids = new Set<string>();
    heroes
      .filter((b) => b.claimed && b.status === "standing")
      .sort((a, b) => (b.balance ?? b.height) - (a.balance ?? a.height))
      .slice(0, lowPower ? 4 : 8)
      .forEach((b) => ids.add(b.id));
    heroes.forEach((b) => { if (b.claimed && now - b.lastActive < 12000) ids.add(b.id); });
    if (focused) ids.add(focused.id);
    return ids;
  }, [heroes, focused, lowPower]);

  // Larger cities need thinner fog so the far side stays visible.
  const fogDensity = (lowPower ? 0.36 : 0.3) / Math.max(42, fitRadius * 1.5);

  return (
    <>
      <color attach="background" args={["#020812"]} />
      <fogExp2 attach="fog" args={["#06182c", fogDensity]} />
      <Sky />
      <Stars radius={180} depth={60} count={lowPower ? 700 : 1600} factor={4} saturation={0} fade speed={0.4} />
      <Lights />
      <ShakeGroup>
        <Ground radius={occupiedRadius} />
        <Backdrop count={lowPower ? 80 : 170} />
        <Traffic count={lowPower ? 36 : 90} />
        <Atmosphere radius={occupiedRadius} />
        {heroes.map((b) => (
          <Tower key={b.id} building={b} focused={focused?.id === b.id} labelled={labelled.has(b.id)} />
        ))}
        <InstancedTowers buildings={minors} />
        {buildings.filter((b) => b.status === "rubble").map((b) => <Rubble key={`rubble-${b.id}`} building={b} />)}
        <FocusMarker building={focused} />
        <Kaiju attacks={attacks} prowlRadius={Math.min(CITY_RADIUS + 4, occupiedRadius + 6)} />
        <ImpactEffects attacks={attacks} />
      </ShakeGroup>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        zoomSpeed={0.9}
        panSpeed={0.8}
        minDistance={12}
        maxDistance={280}
        minPolarAngle={0.2}
        maxPolarAngle={1.42}
        autoRotateSpeed={0.55}
      />
      <CameraRig focus={focused} fitRadius={fitRadius} resetToken={resetToken} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Robustness: never leave a silent blank canvas                       */
/* ------------------------------------------------------------------ */

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Unknown rendering error" };
  }
  componentDidCatch(error: Error) {
    console.error("[stomp-city] 3D scene crashed:", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="scene-message">
          <b>THE CITY FAILED TO RENDER</b>
          <span>{this.state.error}</span>
          <button onClick={() => { this.setState({ error: null }); this.props.onRetry(); }}>RETRY</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function CityScene(props: SceneProps) {
  const [support, setSupport] = useState<"checking" | "ok" | "none">("checking");
  const [lowPower, setLowPower] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    setSupport(hasWebGL() ? "ok" : "none");
    const small = window.matchMedia("(max-width: 760px)").matches;
    const weak = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
    setLowPower(small || weak);
  }, []);

  if (support === "none") {
    return (
      <div className="scene-message">
        <b>WEBGL IS OFF IN THIS BROWSER</b>
        <span>Stomp City needs WebGL. Turn on hardware acceleration, or open the site in Chrome, Safari or Firefox.</span>
      </div>
    );
  }
  if (support === "checking") return <div className="scene-message"><b>BUILDING THE CITY…</b></div>;

  return (
    <div className="city-render-root">
      <SceneBoundary onRetry={() => setGeneration((g) => g + 1)}>
        <Canvas
          key={generation}
          frameloop="always"
          dpr={[1, lowPower ? 1.3 : 1.8]}
          camera={{ position: [44, 34, 54], fov: 42, near: 0.5, far: 700 }}
          gl={{ antialias: true, alpha: false, stencil: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.25;
            const canvas = gl.domElement;
            canvas.addEventListener("webglcontextlost", (event) => {
              event.preventDefault();
              setLost(true);
            });
            canvas.addEventListener("webglcontextrestored", () => {
              setLost(false);
              setGeneration((g) => g + 1);
            });
          }}
        >
          <City {...props} lowPower={lowPower} />
        </Canvas>
      </SceneBoundary>
      {lost && (
        <div className="scene-message scene-message-overlay">
          <b>GPU RESET · REBUILDING CITY</b>
          <button onClick={() => { setLost(false); setGeneration((g) => g + 1); }}>REBUILD NOW</button>
        </div>
      )}
    </div>
  );
}
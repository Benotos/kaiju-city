"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CityBuilding } from "@/lib/types";
import { shortWallet } from "@/lib/demo-data";
import { getLabelTexture } from "./assets";

/**
 * Wallet tags for the towers nearest the camera. Wherever the viewer flies
 * or zooms, the towers around them are labelled, without drawing 1,000 tags
 * at once. Refreshes a few times a second as the camera moves.
 */
export function ProximityLabels({ buildings, skip, limit }: { buildings: CityBuilding[]; skip: Set<string>; limit: number }) {
  const { camera } = useThree();
  const [visible, setVisible] = useState<CityBuilding[]>([]);
  const last = useRef(0);
  const lastKey = useRef("");
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const point = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 280) return;
    last.current = now;
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const scored: { b: CityBuilding; d: number }[] = [];
    for (const b of buildings) {
      if (b.status !== "standing" || !b.claimed || skip.has(b.id)) continue;
      point.set(b.x, b.height + 1, b.z);
      if (!frustum.containsPoint(point)) continue;
      scored.push({ b, d: point.distanceToSquared(camera.position) });
    }
    scored.sort((a, z) => a.d - z.d);
    const next = scored.slice(0, limit).map((s) => s.b);
    const key = next.map((b) => `${b.id}:${b.height.toFixed(1)}`).join("|");
    if (key !== lastKey.current) {
      lastKey.current = key;
      setVisible(next);
    }
  });

  return (
    <>
      {visible.map((b) => (
        <WalletTag key={b.id} building={b} />
      ))}
    </>
  );
}

function WalletTag({ building }: { building: CityBuilding }) {
  const texture = useMemo(() => getLabelTexture(shortWallet(building.wallet), building.color), [building.wallet, building.color]);
  // Sit above the roof (roofs add up to ~1.8 units on the tallest archetypes).
  const y = building.height + 1.4 + building.width * 0.6;
  return (
    <sprite position={[building.x, y, building.z]} scale={[4.4, 1.1, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
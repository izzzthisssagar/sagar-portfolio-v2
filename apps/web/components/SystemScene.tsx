'use client';
import { Canvas } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import type { SystemSceneState } from '@portfolio/types';
function Machine({ state }: { state: SystemSceneState }) {
  const exploded = state === 'exploded' ? 1.2 : 0;
  return (
    <group rotation={[0.35, -0.45, 0]}>
      {[-1, 0, 1].map((x, i) => (
        <mesh key={x} position={[x * (1.1 + exploded), 0, 0]} castShadow>
          <boxGeometry args={[0.9, 2.8 - i * 0.25, 0.42]} />
          <meshStandardMaterial
            color={i === 1 ? '#ff5a35' : '#303030'}
            metalness={0.8}
            roughness={0.35}
          />
        </mesh>
      ))}
      <mesh>
        <cylinderGeometry args={[0.42, 0.42, 2.8, 24]} />
        <meshStandardMaterial color="#ff5a35" emissive="#ff5a35" emissiveIntensity={1.5} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.9, 0.035, 8, 64]} />
        <meshBasicMaterial color="#c8ff72" />
      </mesh>
    </group>
  );
}
export function SystemScene({ state }: { state: SystemSceneState }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7], fov: 42 }}
      fallback={<div>3D unavailable</div>}
    >
      <color attach="background" args={['#121212']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 5, 5]} intensity={3} color="#ece9df" />
      <pointLight position={[-3, 0, 2]} color="#ff5a35" intensity={20} />
      <Float speed={1.2} rotationIntensity={0.12} floatIntensity={0.2}>
        <Machine state={state} />
      </Float>
    </Canvas>
  );
}

'use client';
import { Canvas } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import type { SystemSceneState } from '@portfolio/types';
import type { QualityProfile } from '@portfolio/three';
import { SCENE_TRANSFORMS, shouldAnimateScene, SYSTEM_LAYERS } from '@/lib/system-scene';

function Machine({ state }: { state: SystemSceneState }) {
  const transform = SCENE_TRANSFORMS[state];
  return (
    <group rotation={transform.rotation}>
      {SYSTEM_LAYERS.map((label, index) => {
        const offset = index - 2;
        const fault = transform.faultLayer === index;
        return (
          <mesh
            key={label}
            name={label}
            position={[
              offset * transform.spread,
              fault ? 0.45 : Math.sin(index) * transform.fracture,
              fault ? 0.4 : Math.abs(offset) * transform.fracture,
            ]}
            castShadow
          >
            <boxGeometry args={[0.72, 2.65 - index * 0.12, 0.34]} />
            <meshStandardMaterial
              color={
                fault
                  ? '#ff5a35'
                  : transform.verified
                    ? '#c8ff72'
                    : index === 2
                      ? '#ff5a35'
                      : '#303030'
              }
              emissive={fault || transform.verified ? (fault ? '#ff5a35' : '#c8ff72') : '#000000'}
              emissiveIntensity={fault || transform.verified ? 0.75 : 0}
              metalness={0.8}
              roughness={0.35}
            />
          </mesh>
        );
      })}
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={transform.ringScale}>
        <torusGeometry args={[1.9, 0.035, 8, 64]} />
        <meshBasicMaterial color={transform.verified ? '#c8ff72' : '#ff5a35'} />
      </mesh>
    </group>
  );
}
export function SystemScene({
  state,
  profile,
  reducedMotion,
  onContextLost,
}: {
  state: SystemSceneState;
  profile: QualityProfile;
  reducedMotion: boolean;
  onContextLost(): void;
}) {
  const machine = <Machine state={state} />;
  return (
    <Canvas
      aria-hidden="true"
      dpr={profile.dpr}
      shadows={profile.shadows}
      camera={{ position: [0, 0, 7], fov: 42 }}
      onCreated={({ gl }) =>
        gl.domElement.addEventListener('webglcontextlost', onContextLost, { once: true })
      }
    >
      <color attach="background" args={['#121212']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 5, 5]} intensity={3} color="#ece9df" />
      {shouldAnimateScene(profile, reducedMotion) ? (
        <Float speed={1.2} rotationIntensity={0.12} floatIntensity={0.2}>
          {machine}
        </Float>
      ) : (
        machine
      )}
    </Canvas>
  );
}

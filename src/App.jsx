import { useState, useEffect, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Plane, Sphere, Environment } from '@react-three/drei'
import { Pose } from '@mediapipe/pose'
import { Camera } from '@mediapipe/camera_utils'
import * as THREE from 'three'
import { Model as ElephantModel } from '../Elephant.jsx'
import { Model as AntelopeModel } from '../Antelope.jsx'
import { Model as CatModel } from '../Cat.jsx'
import { Model as GrassModel } from '../Grass.jsx'
import { Model as SpearModel } from '../Spear.jsx'
import { Model as TreeModel } from '../Tree.jsx'
import './App.css'

// Spear states
const SPEAR_STATES = {
  IDLE: 'Idle',
  GRIPPED: 'Gripped',
  THROWING: 'Throwing',
  THROWN: 'Thrown'
}

// Animal types and properties
const ANIMAL_TYPES = {
  ELEPHANT: {
    name: 'elephant',
    baseSpeed: 0.4, // Reduced from 0.8
    speedIncrease: 0.6, // Speed boost per hit
    health: 3, // 3 hits to kill
    damage: 50,
    size: [2, 2.5, 3],
    color: '#8B7355',
    score: 100,
    spawnWeight: 0.5
  },
  CHEETAH: {
    name: 'cheetah',
    baseSpeed: 1.0, // Reduced from 2.0
    speedIncrease: 0.5, // Speed boost per hit
    health: 2, // 2 hits to kill
    damage: 25,
    size: [1.5, 2.0, 2],
    color: '#DAA520',
    score: 75,
    spawnWeight: 0.125
  },
  ANTELOPE: {
    name: 'antelope',
    baseSpeed: 0.6, // Reduced from 1.2
    speedIncrease: 0, // No speed increase (one-shot kill)
    health: 1, // 1 hit to kill
    damage: 10,
    size: [1, 2.2, 1.5],
    color: '#CD853F',
    score: 50,
    spawnWeight: 0.25
  }
}

// Pose tracking hook
function usePoseTracking() {
  const [pose, setPose] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [poseLandmarks, setPoseLandmarks] = useState(null)
  const [availableCameras, setAvailableCameras] = useState([])
  const [selectedCameraId, setSelectedCameraId] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const currentStream = useRef(null)

  // Function to enumerate available cameras
  const enumerateCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter(device => device.kind === 'videoinput')
      // console.log('Available cameras:', videoDevices)
      setAvailableCameras(videoDevices)

      // Set default camera if none selected
      if (!selectedCameraId && videoDevices.length > 0) {
        setSelectedCameraId(videoDevices[0].deviceId)
      }
    } catch (error) {
      // console.error('Error enumerating cameras:', error)
    }
  }

  // Function to initialize camera with specific device ID
  const initializeCamera = async (deviceId) => {
    try {
      // Stop current stream if exists
      if (currentStream.current) {
        currentStream.current.getTracks().forEach(track => track.stop())
      }

      // console.log('Requesting camera access for device:', deviceId)
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // console.log('Camera access granted:', stream)
      currentStream.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.addEventListener('loadeddata', () => {
          // console.log('Video loaded, setting ready to true')
          setIsReady(true)
        })
      }
    } catch (error) {
      // console.error('Error accessing camera:', error)
    }
  }

  useEffect(() => {
    const initializePose = async () => {
      const poseInstance = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        }
      })

      poseInstance.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      })

      poseInstance.onResults((results) => {
        // console.log('MediaPipe pose results:', results)
        if (results.poseLandmarks) {
          // console.log('Pose detected:', results.poseLandmarks)
          setPoseLandmarks(results.poseLandmarks)
        } else {
          setPoseLandmarks(null)
        }
      })

      setPose(poseInstance)

      // Enumerate cameras first
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await enumerateCameras()
      } else {
        // console.error('getUserMedia not supported')
      }
    }

    initializePose()
  }, [])

  // Initialize camera when selected camera changes
  useEffect(() => {
    if (selectedCameraId) {
      initializeCamera(selectedCameraId)
    }
  }, [selectedCameraId])

  useEffect(() => {
    if (pose && videoRef.current && isReady) {
      // console.log('Initializing MediaPipe camera...')
      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await pose.send({ image: videoRef.current })
          }
        },
        width: 640,
        height: 480
      })
      // console.log('Starting MediaPipe camera...')
      camera.start()
    }
  }, [pose, isReady])

  return {
    poseLandmarks,
    isReady,
    videoRef,
    canvasRef,
    availableCameras,
    selectedCameraId,
    setSelectedCameraId
  }
}

// Get head position for aiming (using nose landmark)
function getHeadPosition(landmarks) {
  if (!landmarks || landmarks.length < 33) return null

  // Use nose landmark (index 0) for head position
  const nose = landmarks[0]
  return {
    x: nose.x,
    y: nose.y,
    z: nose.z || 0
  }
}

// Detect hand raising for firing
function detectHandRaised(landmarks) {
  if (!landmarks || landmarks.length < 33) return false

  // MediaPipe pose landmark indices:
  // 15: Left wrist, 16: Right wrist
  // 11: Left shoulder, 12: Right shoulder
  // 0: Nose (head reference)

  const leftWrist = landmarks[15]
  const rightWrist = landmarks[16]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  const nose = landmarks[0]

  // Check if either wrist is raised above shoulder level
  const leftHandRaised = leftWrist.y < leftShoulder.y - 0.05
  const rightHandRaised = rightWrist.y < rightShoulder.y - 0.05

  // Also check if hand is raised above head level for more dramatic gesture
  const leftHandAboveHead = leftWrist.y < nose.y - 0.1
  const rightHandAboveHead = rightWrist.y < nose.y - 0.1

  return leftHandRaised || rightHandRaised || leftHandAboveHead || rightHandAboveHead
}

// Ground plane component with forest textures
function GroundPlane() {
  return (
    <Plane args={[20, 40]} rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.5, -10]} receiveShadow>
      <shadowMaterial
        transparent={true}
        opacity={0.3}
        color={0x000000}
      />
    </Plane>
  )
}

// Spear component
function Spear({ position, spearState }) {
  const meshRef = useRef()
  const [spearPosition, setSpearPosition] = useState([0, -3.5, 5])
  const lastValidPosition = useRef([0, -3.5, 5])

  useFrame(() => {
    if (meshRef.current) {
      if (spearState === SPEAR_STATES.GRIPPED) {
        if (position) {
          // Spear follows hand when position is available
          meshRef.current.position.set(position[0], position[1], position[2])
          lastValidPosition.current = [...position] // Store last valid position
        } else {
          // Keep spear at last valid position when hand tracking is lost
          meshRef.current.position.set(...lastValidPosition.current)
        }
      } else if (spearState === SPEAR_STATES.IDLE) {
        // Return to starting position closer to camera
        meshRef.current.position.set(0, -3.5, 5)
        lastValidPosition.current = [0, -3.5, 5]
      }
    }
  })

  useEffect(() => {
    if (spearState === SPEAR_STATES.IDLE) {
      setSpearPosition([0, -3.5, 5]) // Start closer to camera
      lastValidPosition.current = [0, -3.5, 5]
    }
  }, [spearState])

  console.log('Spear rendering at position:', position, 'state:', spearState)

  return (
    <group ref={meshRef} position={spearPosition}>
      <SpearModel scale={[0.5, 0.5, 0.5]} rotation={[0, 0, Math.PI / 2]} castShadow />
      {/* Debug sphere to show spear position */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.2]} />
        <meshBasicMaterial color="red" transparent opacity={0.8} />
      </mesh>
      {/* Debug text to show coordinates */}
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.1]} />
        <meshBasicMaterial color="yellow" />
      </mesh>
    </group>
  )
}

// Animal component
function Animal({ animalData, onHit, onReachPlayer, thrownSpears, onHitMessage, isPaused, onDeathAnimationComplete }) {
  const meshRef = useRef()
  const [position, setPosition] = useState(animalData.position)
  const [health, setHealth] = useState(animalData.type.health)
  const [isAlive, setIsAlive] = useState(true)
  const [stuckSpears, setStuckSpears] = useState([])
  const [isDying, setIsDying] = useState(false)

  useFrame((state, delta) => {
    if (!meshRef.current || !isAlive || isPaused) return

    // Calculate dynamic speed based on health (animals get faster when hit)
    const hitsTaken = animalData.type.health - health
    const currentSpeed = animalData.type.baseSpeed + (hitsTaken * animalData.type.speedIncrease)

    // Move animal forward towards camera
    const newPosition = [
      position[0],
      position[1],
      position[2] + currentSpeed * delta
    ]

    // Check if animal reached the front (player position)
    if (newPosition[2] >= 8) {
      onReachPlayer(animalData.type.damage, animalData.id)
      setIsAlive(false)
      return
    }

    // Check collision with thrown spears
    thrownSpears.forEach(spear => {
      if (!spear.isActive || stuckSpears.includes(spear.id)) return

      const spearPos = spear.position || [0, 0, 0]
      const distance = Math.sqrt(
        Math.pow(newPosition[0] - spearPos[0], 2) +
        Math.pow(newPosition[1] - spearPos[1], 2) +
        Math.pow(newPosition[2] - spearPos[2], 2)
      )

      // Increased collision threshold for better hit detection
      if (distance < 3.0) { // Increased from 2.5 to 3.0 for better hit detection
        const damage = 1 // Each hit reduces health by 1
        const newHealth = health - damage
        setHealth(newHealth)

        // Add spear to stuck spears list temporarily
        setStuckSpears(prev => [...prev, spear.id])

        // Mark spear as inactive and as having hit an animal
        spear.isActive = false
        if (spear.setHasHitAnimal) {
          spear.setHasHitAnimal(true)
        }

        // Show hit message
        const messages = ['HIT!', 'STRIKE!', 'NICE SHOT!', 'BULLSEYE!', 'PERFECT!']
        const randomMessage = messages[Math.floor(Math.random() * messages.length)]
        onHitMessage(randomMessage)

        // Remove spear after a short delay to show impact
        setTimeout(() => {
          onHit(animalData.type.score, spear.id, animalData.id)
        }, 500)

        if (newHealth <= 0) {
          setIsAlive(false)
          setIsDying(true)
          onHit(animalData.type.score, spear.id, animalData.id)

          // Remove the animal after death animation
          // Different durations: 3 seconds for elephants, 2 seconds for cheetahs, 1 second for antelopes
          const deathAnimationDuration = animalData.type.name === 'elephant' ? 3000 :
            animalData.type.name === 'cheetah' ? 4000 : 800
          console.log('💀 DEATH ANIMATION STARTED:', { animalId: animalData.id, type: animalData.type.name, duration: deathAnimationDuration })
          setTimeout(() => {
            console.log('✅ DEATH ANIMATION COMPLETE:', { animalId: animalData.id, type: animalData.type.name })
            setIsDying(false) // This will cause the component to return null
            if (onDeathAnimationComplete) {
              console.log('⏰ RESPAWN TRIGGER: Death animation complete, spawning new animal')
              onDeathAnimationComplete(animalData.id) // Pass animal ID to remove it from array
            }
          }, deathAnimationDuration)
        }
      }
    })

    setPosition(newPosition)
    meshRef.current.position.set(...newPosition)
  })

  if (!isAlive && !isDying) return null

  return (
    <group ref={meshRef} position={position}>
      {/* Animal body - 3D models for elephant, antelope, and cheetah, cube for others */}
      {animalData.type.name === 'elephant' ? (
        <ElephantModel
          scale={[5.5, 5.5, 5.5]}
          rotation={[0, 0, 0]}
          castShadow
          animationState={
            isDying ? 'death' :
              health === animalData.type.health - 1 ? 'run' :
                health === animalData.type.health - 2 ? 'attack' :
                  'walk'
          }
        />
      ) : animalData.type.name === 'antelope' ? (
        <AntelopeModel
          scale={[3, 3, 3]}
          rotation={[0, 0, 0]}
          castShadow
          animationState={isDying ? 'death' : 'walk'}
        />
      ) : animalData.type.name === 'cheetah' ? (
        <CatModel
          scale={[3.5, 3.5, 3.5]}
          rotation={[0, 0, 0]}
          castShadow
          animationState={
            isDying ? 'death' :
              health === animalData.type.health - 1 ? 'run' :
                'walk'
          }
        />
      ) : (
        <mesh castShadow>
          <boxGeometry args={animalData.type.size} />
          <meshStandardMaterial color={animalData.type.color} />
        </mesh>
      )}
      {/* Health bar above animal */}
      <mesh position={[0, animalData.type.size[1] + 0.5, 0]}>
        <planeGeometry args={[1, 0.1]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[0, animalData.type.size[1] + 0.5, 0.01]}>
        <planeGeometry args={[health / animalData.type.health, 0.1]} />
        <meshBasicMaterial color={
          health / animalData.type.health > 0.66 ? '#00AA00' :
            health / animalData.type.health > 0.33 ? '#AAAA00' : '#AA0000'
        } />
      </mesh>

      {/* Stuck spears */}
      {stuckSpears.map((spearId, index) => {
        const spear = thrownSpears.find(s => s.id === spearId)
        if (!spear) return null

        const offset = [
          (Math.random() - 0.5) * animalData.type.size[0],
          (Math.random() - 0.5) * animalData.type.size[1],
          (Math.random() - 0.5) * animalData.type.size[2]
        ]

        return (
          <group key={spearId} position={offset} rotation={[Math.PI / -2 + (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.02, 0.02, 1.5]} />
              <meshStandardMaterial color="#8B4513" />
            </mesh>
            <mesh position={[0, 0.8, 0]} castShadow>
              <coneGeometry args={[0.05, 0.3]} />
              <meshStandardMaterial color="#C0C0C0" />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ThrownSpear component
function ThrownSpear({ spearData, isPaused, onMiss }) {
  const meshRef = useRef()
  const [position, setPosition] = useState(spearData.position)
  const [velocity, setVelocity] = useState(spearData.velocity)
  const [isActive, setIsActive] = useState(true)
  const [hasTriggeredMiss, setHasTriggeredMiss] = useState(false)
  const [hasHitAnimal, setHasHitAnimal] = useState(false)

  // Update spear data with current position and active state for collision detection
  spearData.position = position
  spearData.isActive = isActive
  spearData.hasHitAnimal = hasHitAnimal
  spearData.setHasHitAnimal = setHasHitAnimal

  // Update spear data for collision detection
  spearData.position = position
  spearData.isActive = isActive
  spearData.hasHitAnimal = hasHitAnimal

  useFrame((state, delta) => {
    if (!meshRef.current || !isActive || isPaused) return

    // Apply gravity and update position
    const newVelocity = [
      velocity[0],
      velocity[1] - 9.8 * delta, // gravity
      velocity[2]
    ]

    const newPosition = [
      position[0] + newVelocity[0] * delta,
      position[1] + newVelocity[1] * delta,
      position[2] + newVelocity[2] * delta
    ]

    // Check collision with backboard (at z = -30, width = 10, height = 8, center at y = -1)
    if (newPosition[2] <= -29.9 &&
      newPosition[0] >= -5 && newPosition[0] <= 5 &&
      newPosition[1] >= -5 && newPosition[1] <= 3) {
      // Stick to backboard - this is a miss only if it didn't hit an animal
      newPosition[2] = -29.9
      setIsActive(false)
      if (!hasTriggeredMiss && !hasHitAnimal && onMiss) {
        setHasTriggeredMiss(true)
        onMiss(spearData.id)
      }
    }
    // Stick in ground when hitting - this is also a miss only if it didn't hit an animal
    else if (newPosition[1] <= -3.25) {
      newPosition[1] = -3.25
      setIsActive(false)
      if (!hasTriggeredMiss && !hasHitAnimal && onMiss) {
        setHasTriggeredMiss(true)
        onMiss(spearData.id)
      }
    }
    // Remove spear if it goes too far out of bounds - miss only if no animal hit
    else if (newPosition[2] < -35 || newPosition[0] < -15 || newPosition[0] > 15) {
      if (!hasTriggeredMiss && !hasHitAnimal && onMiss) {
        setHasTriggeredMiss(true)
        onMiss(spearData.id)
      }
    }

    setVelocity(newVelocity)
    setPosition(newPosition)
    meshRef.current.position.set(...newPosition)
  })

  // Don't render if spear is out of bounds
  if (position[2] < -35 || position[0] < -15 || position[0] > 15) {
    return null
  }

  return (
    <group ref={meshRef} position={position}>
      <SpearModel scale={[0.5, 0.5, 0.5]} rotation={[0, 0, Math.PI / 2]} castShadow />
    </group>
  )
}

// 3D Scene component
function Scene({ headPosition, spearState, thrownSpears, animals, onAnimalHit, onAnimalReachPlayer, onHitMessage, isPaused, onSpearMiss, onDeathAnimationComplete }) {
  return (
    <>
      <Environment files="/savannah.hdr" background backgroundRotation={[0, Math.PI * 2 / 3, 0]} />
      <ambientLight intensity={0.05} />
      <directionalLight
        position={[0, 20, 0]}
        castShadow
        intensity={1.2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={1}
        shadow-bias={-0.0001}
      />

      {/* Ground plane - extended to end of range */}
      <GroundPlane />

      {/* Grass scattered across ground plane - 30 instances covering full length */}
      <GrassModel position={[0, -4.5, -10]} scale={[1.0, 1.0, 1.0]} />
      <GrassModel position={[-8, -4.5, -5]} scale={[0.8, 0.8, 0.8]} rotation={[0, 0.5, 0]} />
      <GrassModel position={[7, -4.5, -15]} scale={[1.2, 1.2, 1.2]} rotation={[0, -0.3, 0]} />
      <GrassModel position={[-5, -4.5, -25]} scale={[1.0, 1.0, 1.0]} rotation={[0, 1.2, 0]} />
      <GrassModel position={[-9, -4.5, -18]} scale={[1.4, 1.4, 1.4]} rotation={[0, 0.9, 0]} />
      <GrassModel position={[6, -4.5, -3]} scale={[0.8, 0.8, 0.8]} rotation={[0, -1.1, 0]} />
      <GrassModel position={[-2, -4.5, -28]} scale={[1.0, 1.0, 1.0]} rotation={[0, 0.7, 0]} />
      <GrassModel position={[9, -4.5, -12]} scale={[1.2, 1.2, 1.2]} rotation={[0, -0.4, 0]} />
      <GrassModel position={[4, -4.5, -22]} scale={[1.0, 1.0, 1.0]} rotation={[0, -0.6, 0]} />
      <GrassModel position={[8, -4.5, -26]} scale={[1.2, 1.2, 1.2]} rotation={[0, -1.3, 0]} />
      <GrassModel position={[-6, -4.5, -13]} scale={[1.0, 1.0, 1.0]} rotation={[0, 0.8, 0]} />
      <GrassModel position={[-8, -4.5, -20]} scale={[1.4, 1.4, 1.4]} rotation={[0, 1.0, 0]} />
      <GrassModel position={[-1, -4.5, -24]} scale={[1.0, 1.0, 1.0]} rotation={[0, 0.6, 0]} />
      <GrassModel position={[7, -4.5, -9]} scale={[1.2, 1.2, 1.2]} rotation={[0, -1.0, 0]} />
      <GrassModel position={[2, -4.5, -27]} scale={[1.0, 1.0, 1.0]} rotation={[0, -0.5, 0]} />
      {/* Additional 15 grass instances for extended coverage */}
      <GrassModel position={[12, -4.5, 8]} scale={[0.9, 0.9, 0.9]} rotation={[0, 0.8, 0]} />
      <GrassModel position={[-11, -4.5, 6]} scale={[0.7, 0.7, 0.7]} rotation={[0, -0.6, 0]} />
      <GrassModel position={[14, -4.5, 4]} scale={[1.1, 1.1, 1.1]} rotation={[0, 1.4, 0]} />
      <GrassModel position={[-13, -4.5, 2]} scale={[0.8, 0.8, 0.8]} rotation={[0, -1.0, 0]} />
      <GrassModel position={[11, -4.5, 9]} scale={[1.3, 1.3, 1.3]} rotation={[0, 0.3, 0]} />
      <GrassModel position={[-15, -4.5, 7]} scale={[0.6, 0.6, 0.6]} rotation={[0, -1.5, 0]} />
      <GrassModel position={[13, -4.5, 5]} scale={[1.0, 1.0, 1.0]} rotation={[0, 0.9, 0]} />
      <GrassModel position={[-12, -4.5, 3]} scale={[0.9, 0.9, 0.9]} rotation={[0, -0.4, 0]} />
      <GrassModel position={[15, -4.5, 1]} scale={[1.2, 1.2, 1.2]} rotation={[0, 1.1, 0]} />
      <GrassModel position={[-14, -4.5, 0]} scale={[0.7, 0.7, 0.7]} rotation={[0, -0.7, 0]} />
      <GrassModel position={[16, -4.5, -1]} scale={[1.4, 1.4, 1.4]} rotation={[0, 0.5, 0]} />
      <GrassModel position={[-10, -4.5, -3]} scale={[0.8, 0.8, 0.8]} rotation={[0, -1.2, 0]} />
      <GrassModel position={[10, -4.5, -5]} scale={[1.1, 1.1, 1.1]} rotation={[0, 0.7, 0]} />
      <GrassModel position={[-16, -4.5, -7]} scale={[0.9, 0.9, 0.9]} rotation={[0, -0.8, 0]} />
      <GrassModel position={[12, -4.5, -29]} scale={[1.0, 1.0, 1.0]} rotation={[0, 1.3, 0]} />

      {/* Trees replacing backboard at end of plane */}
      <TreeModel position={[-3, -4.5, -30]} scale={[2, 2, 2]} rotation={[0, 0.3, 0]} castShadow receiveShadow />
      <TreeModel position={[0, -4.5, -31]} scale={[2.5, 2.5, 2.5]} rotation={[0, -0.5, 0]} castShadow receiveShadow />
      <TreeModel position={[4, -4.5, -29]} scale={[2.2, 2.2, 2.2]} rotation={[0, 0.8, 0]} castShadow receiveShadow />

      {/* Single tree on edge of floor plane */}
      <TreeModel position={[-9, -4.5, -5]} scale={[1.5, 1.5, 1.5]} rotation={[0, 1.2, 0]} castShadow receiveShadow />



      {/* Active Spear */}
      <Spear
        position={headPosition}
        spearState={spearState}
      />

      {/* Thrown Spears */}
      {thrownSpears.map(spear => (
        <ThrownSpear key={spear.id} spearData={spear} isPaused={isPaused} onMiss={onSpearMiss} />
      ))}

      {/* Animals */}
      {animals.map(animal => (
        <Animal
          key={animal.id}
          animalData={animal}
          onHit={onAnimalHit}
          onReachPlayer={onAnimalReachPlayer}
          thrownSpears={thrownSpears}
          onHitMessage={onHitMessage}
          isPaused={isPaused}
          onDeathAnimationComplete={onDeathAnimationComplete}
        />
      ))}

      <OrbitControls enablePan={false} enableZoom={false} enableRotate={true} />
    </>
  )
}

// Overlay UI component
function Overlay({ spearState, showCamera, onToggleCamera, isReady, videoRef, poseLandmarks, thrownSpearsCount, score, hitMessage, flashMessage, isPaused, onTogglePause, onRestart, availableCameras, selectedCameraId, onCameraChange, cameraRotation, onCameraRotation, lastFireTime, fireCooldown }) {
  // Debug pose detection states
  const headPosition = poseLandmarks ? getHeadPosition(poseLandmarks) : null
  const isHandRaised = poseLandmarks ? detectHandRaised(poseLandmarks) : false

  // Force re-render for cooldown timer
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate({})
    }, 100) // Update every 100ms for smooth countdown
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="overlay">

      {/* Pause Screen */}
      {isPaused && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1500
          }}
        >
          <div style={{ color: '#fff', fontSize: '36px', fontWeight: 'bold' }}>
            PAUSED
          </div>
        </div>
      )}

      {/* Hit Message */}
      {hitMessage && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#FFD700',
            fontSize: '32px',
            fontWeight: 'bold',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
            zIndex: 1200,
            pointerEvents: 'none'
          }}
        >
          {hitMessage}
        </div>
      )}

      {/* Flash Message for Animal Reaching Player */}
      {flashMessage && (
        <div
          style={{
            position: 'fixed',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#FF0000',
            fontSize: '48px',
            fontWeight: 'bold',
            textShadow: '3px 3px 6px rgba(0,0,0,0.9)',
            zIndex: 1300,
            pointerEvents: 'none',
            animation: 'flash 0.5s ease-in-out'
          }}
        >
          {flashMessage}
        </div>
      )}

      <div className="top-left">
        <div className="game-stats">
          <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>
            Score: <span style={{ color: '#FFD700' }}>{score}</span>
          </div>
        </div>
      </div>

      <div className="top-right">
        {showCamera && (
          <div className="camera-view">
            <div style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: '200px',
                  height: '150px',
                  transform: 'scaleX(-1)',
                  border: '2px solid white',
                  borderRadius: '8px'
                }}
              />
              {/* Skeleton overlay */}
              {poseLandmarks && (
                <svg
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '200px',
                    height: '150px',
                    pointerEvents: 'none',
                    transform: 'scaleX(-1)'
                  }}
                >
                  {/* Draw pose landmarks */}
                  {poseLandmarks.map((landmark, index) => {
                    if (index === 0 || index === 11 || index === 12 || index === 15 || index === 16) {
                      return (
                        <circle
                          key={index}
                          cx={landmark.x * 200}
                          cy={landmark.y * 150}
                          r="3"
                          fill={index === 0 ? '#ff0000' : index === 15 || index === 16 ? '#00ff00' : '#ffff00'}
                          stroke="white"
                          strokeWidth="1"
                        />
                      );
                    }
                    return null;
                  })}
                  {/* Draw connections */}
                  {poseLandmarks[11] && poseLandmarks[12] && (
                    <line
                      x1={poseLandmarks[11].x * 200}
                      y1={poseLandmarks[11].y * 150}
                      x2={poseLandmarks[12].x * 200}
                      y2={poseLandmarks[12].y * 150}
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                  {poseLandmarks[11] && poseLandmarks[15] && (
                    <line
                      x1={poseLandmarks[11].x * 200}
                      y1={poseLandmarks[11].y * 150}
                      x2={poseLandmarks[15].x * 200}
                      y2={poseLandmarks[15].y * 150}
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                  {poseLandmarks[12] && poseLandmarks[16] && (
                    <line
                      x1={poseLandmarks[12].x * 200}
                      y1={poseLandmarks[12].y * 150}
                      x2={poseLandmarks[16].x * 200}
                      y2={poseLandmarks[16].y * 150}
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                </svg>
              )}
            </div>
            {poseLandmarks && (
              <div className="hand-indicator">
                🎯 Pose: {headPosition ? '👤 Head Tracked' : '❌ No Head'} | {isHandRaised ? '🙋 Hand Raised' : '👇 Hand Down'}
                <div>Fire Cooldown: {(() => {
                  const currentTime = Date.now()
                  const timeSinceLastFire = currentTime - lastFireTime
                  const remainingCooldown = Math.max(0, fireCooldown - timeSinceLastFire)
                  return remainingCooldown > 0 ? `${(remainingCooldown / 1000).toFixed(1)}s` : 'Ready'
                })()}</div>
              </div>
            )}
          </div>
        )}

        <div className="controls">
          <button onClick={onToggleCamera} className="toggle-btn">
            {showCamera ? 'Hide Camera' : 'Show Camera'}
          </button>
          <button onClick={onTogglePause} className="toggle-btn" style={{ marginLeft: '10px' }}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          {availableCameras && availableCameras.length > 1 && (
            <select
              value={selectedCameraId || ''}
              onChange={(e) => onCameraChange(e.target.value)}
              className="camera-selector"
              style={{ marginLeft: '10px' }}
            >
              {availableCameras.map((camera, index) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Camera Rotation Controls */}
        <div className="controls" style={{ marginTop: '10px' }}>
          <div style={{ color: 'white', fontSize: '12px', marginBottom: '5px' }}>Camera Input Rotation:</div>
          <button
            onClick={() => onCameraRotation(0)}
            className="toggle-btn"
            style={{
              backgroundColor: cameraRotation === 0 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
              fontSize: '12px',
              padding: '6px 12px'
            }}
          >
            0°
          </button>
          <button
            onClick={() => onCameraRotation(90)}
            className="toggle-btn"
            style={{
              backgroundColor: cameraRotation === 90 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
              fontSize: '12px',
              padding: '6px 12px',
              marginLeft: '5px'
            }}
          >
            90°
          </button>
          <button
            onClick={() => onCameraRotation(180)}
            className="toggle-btn"
            style={{
              backgroundColor: cameraRotation === 180 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
              fontSize: '12px',
              padding: '6px 12px',
              marginLeft: '5px'
            }}
          >
            180°
          </button>
          <button
            onClick={() => onCameraRotation(270)}
            className="toggle-btn"
            style={{
              backgroundColor: cameraRotation === 270 ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
              fontSize: '12px',
              padding: '6px 12px',
              marginLeft: '5px'
            }}
          >
            270°
          </button>
        </div>
      </div>

      <div className="bottom-left">
        <div className="status">
          <div>Spear Status: <span className="status-value">{spearState}</span></div>
          <div>Tracking: <span className="status-value">{isReady ? 'Ready' : 'Loading...'}</span></div>
          <div>Thrown Spears: <span className="status-value">{thrownSpearsCount}</span></div>
        </div>

        <div className="instructions">
          {spearState === SPEAR_STATES.IDLE && 'Make a fist to grip the spear'}
          {spearState === SPEAR_STATES.GRIPPED && 'Hold fist to aim, open palm to throw! Hunt the animals!'}
          {spearState === SPEAR_STATES.THROWING && 'New spear spawning...'}
        </div>
      </div>

    </div>
  )
}

function App() {
  const { poseLandmarks, isReady, videoRef, availableCameras, selectedCameraId, setSelectedCameraId } = usePoseTracking()
  const [spearState, setSpearState] = useState(SPEAR_STATES.IDLE)
  const [showCamera, setShowCamera] = useState(true)
  const [headPosition, setHeadPosition] = useState(null)
  const [thrownSpears, setThrownSpears] = useState([])
  const [animals, setAnimals] = useState([])
  const [score, setScore] = useState(0)
  const [hitMessage, setHitMessage] = useState('')
  const [flashMessage, setFlashMessage] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [cameraRotation, setCameraRotation] = useState(0) // 0, 90, 180, 270 degrees
  const [lastFireTime, setLastFireTime] = useState(0)
  const FIRE_COOLDOWN = 1000 // 1 second cooldown between shots
  const spearIdCounter = useRef(0)
  const animalIdCounter = useRef(0)
  const animalSpawnInterval = useRef(null)

  // Removed power meter oscillation - all shots are now max power

  // Manual spawn function
  const spawnNewAnimal = (deadAnimalId = null) => {
    // Remove dead animal if ID provided
    if (deadAnimalId) {
      console.log('🗑️ REMOVING DEAD ANIMAL:', { animalId: deadAnimalId })
      setAnimals(prev => prev.filter(animal => animal.id !== deadAnimalId))
      // Add delay to ensure state update processes before spawning
      setTimeout(() => {
        spawnNewAnimal() // Recursive call without deadAnimalId
      }, 100)
      return
    }

    if (isPaused) {
      console.log('🚫 SPAWN BLOCKED:', { isPaused, animalCount: animals.length })
      return
    }

    // Weighted random animal type selection
    const animalTypes = Object.values(ANIMAL_TYPES)
    const totalWeight = animalTypes.reduce((sum, type) => sum + type.spawnWeight, 0)
    let randomWeight = Math.random() * totalWeight

    let selectedType = animalTypes[0]
    for (const type of animalTypes) {
      randomWeight -= type.spawnWeight
      if (randomWeight <= 0) {
        selectedType = type
        break
      }
    }

    // Random spawn position at the back of the plane
    // const spawnX = (Math.random() - 0.5) * 15 // Random X position across the width
    const spawnX = (Math.random() - 0.5)
    const spawnY = -4 // Ground level (lowered by 4 units)
    const spawnZ = -25 // Back of the plane

    const newAnimal = {
      id: animalIdCounter.current++,
      type: selectedType,
      position: [spawnX, spawnY, spawnZ],
      timestamp: Date.now()
    }

    console.log('🦌 ANIMAL SPAWNED:', { id: newAnimal.id, type: selectedType.name, health: selectedType.health })
    setAnimals(prev => [...prev, newAnimal])
  }

  // Initial animal spawn when game starts
  useEffect(() => {
    if (!isPaused) {
      const timer = setTimeout(() => {
        spawnNewAnimal()
      }, 1000) // Spawn first animal after 1 second
      return () => clearTimeout(timer)
    }
  }, [isPaused])

  // Handle animal hitting player - remove animal from scene
  const handleAnimalReachPlayer = (damage, animalId) => {
    console.log('🎯 ANIMAL REACHED PLAYER:', { animalId, damage })

    // Find the animal to get its type for the flash message
    const animal = animals.find(a => a.id === animalId)
    if (animal) {
      const message = animal.type.name === 'cheetah' ? 'EATEN!' : 'TRAMPLED!'
      setFlashMessage(message)
      setTimeout(() => setFlashMessage(''), 2000) // Clear message after 2 seconds
    }

    // Remove the animal that reached the player
    setAnimals(prev => prev.filter(animal => animal.id !== animalId))
    // Spawn new animal after a short delay
    setTimeout(() => {
      console.log('⏰ RESPAWN TRIGGER: Animal reached player, spawning new animal')
      spawnNewAnimal()
    }, 1000)
  }

  // Handle animal being killed
  const handleAnimalHit = (scorePoints, spearId, animalId) => {
    console.log('💥 COLLISION DETECTED:', { animalId, spearId, scorePoints })
    setScore(prev => prev + scorePoints)
    // Remove the spear that hit the animal
    if (spearId) {
      setThrownSpears(prev => prev.filter(spear => spear.id !== spearId))
    }
    // Animal removal is handled by death animation completion
  }

  // Handle hit message display
  const handleHitMessage = (message) => {
    setHitMessage(message)
    setTimeout(() => setHitMessage(''), 1500) // Clear message after 1.5 seconds
  }

  // Handle spear miss
  const handleSpearMiss = (spearId) => {
    const missMessages = ['Missed!', 'Oof!', 'Try again!', 'So close!', 'Better luck next time!']
    const randomMessage = missMessages[Math.floor(Math.random() * missMessages.length)]
    handleHitMessage(randomMessage)

    // Remove the missed spear immediately to prevent clutter
    setTimeout(() => {
      setThrownSpears(prev => prev.filter(spear => spear.id !== spearId))
    }, 1000)
  }

  // Handle pause toggle
  const handleTogglePause = () => {
    setIsPaused(prev => !prev)
  }

  // Handle game restart
  const handleRestart = () => {
    setScore(0)
    setAnimals([])
    setThrownSpears([])
    setIsPaused(false)
    setHitMessage('')
    setFlashMessage('')
    setSpearState(SPEAR_STATES.IDLE)
    spearIdCounter.current = 0
    animalIdCounter.current = 0
  }

  // Function to rotate coordinates based on camera rotation
  const rotateCoordinates = (x, y, rotation) => {
    const rad = (rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return [
      x * cos - y * sin,
      x * sin + y * cos
    ]
  }

  // Handle camera rotation change
  const handleCameraRotation = (degrees) => {
    setCameraRotation(degrees)
  }

  useEffect(() => {
    if (poseLandmarks && isReady && !isPaused) {
      const headPos = getHeadPosition(poseLandmarks)
      const isHandRaised = detectHandRaised(poseLandmarks)
      console.log('Pose detection - Head:', headPos, 'Hand Raised:', isHandRaised, 'Spear State:', spearState)

      if (headPos) {
        // Convert head position to 3D aiming position
        let x = (0.5 - headPos.x) * 25 // Increased X-axis range for wider movement
        let y = (1 - headPos.y) * 2.5 - 4  // Reduced Y height to match lowered animal ground level

        // Apply camera rotation to X and Y coordinates
        const [rotatedX, rotatedY] = rotateCoordinates(x, y, cameraRotation)

        const position = [
          rotatedX,
          rotatedY,
          5 + (headPos.z || 0) * -3      // Start closer to camera (z=5) and scale depth
        ]

        // Always update head position for aiming
        setHeadPosition(position)
        console.log('Updated head position:', position)

        // Set spear to gripped state when head is detected
        if (spearState === SPEAR_STATES.IDLE) {
          setSpearState(SPEAR_STATES.GRIPPED)
        }
      } else {
        // If no head detected, return to idle
        setHeadPosition([0, -2, 5])
        console.log('No head detected, spear at center')
        if (spearState === SPEAR_STATES.GRIPPED) {
          setSpearState(SPEAR_STATES.IDLE)
        }
      }

      // Simplified state machine logic - always ready to fire when hand is raised with cooldown
      if (isHandRaised && spearState === SPEAR_STATES.GRIPPED && headPosition) {
        const currentTime = Date.now()

        // Check if enough time has passed since last fire
        if (currentTime - lastFireTime >= FIRE_COOLDOWN) {
          // All shots are now max power
          const powerRatio = 1.0 // Always 100% power
          const baseVelocity = 1.5 + powerRatio * 5.0 // Reduced max velocity

          // Z velocity at max power
          const zVelocity = -baseVelocity * (1 + powerRatio * 5) // Reduced max distance
          const yVelocity = 0.8 + powerRatio * 1.5 // Reduced upward arc
          const xVelocity = 0 // No horizontal movement

          const velocity = [xVelocity, yVelocity, zVelocity]

          const newSpear = {
            id: spearIdCounter.current++,
            position: [...headPosition], // Use current head position for aiming
            velocity: velocity,
            timestamp: Date.now()
          }

          console.log('🏹 SPEAR FIRED:', { id: newSpear.id, position: newSpear.position, velocity: newSpear.velocity })
          setThrownSpears(prev => [...prev, newSpear])
          setSpearState(SPEAR_STATES.THROWING)
          setLastFireTime(currentTime) // Update last fire time

          // Reset to gripped after a short delay to continue aiming
          setTimeout(() => {
            setSpearState(SPEAR_STATES.GRIPPED)
          }, 500)
        }
      }
    }
  }, [poseLandmarks, isReady, spearState, headPosition, isPaused])

  return (
    <div className="app">
      <Canvas
        shadows
        camera={{ position: [0, -1, 14], fov: 75 }}
        style={{ width: '100vw', height: '100vh' }}
      >
        <Scene
          headPosition={headPosition}
          spearState={spearState}
          thrownSpears={thrownSpears}
          animals={animals}
          onAnimalHit={handleAnimalHit}
          onAnimalReachPlayer={handleAnimalReachPlayer}
          onHitMessage={handleHitMessage}
          isPaused={isPaused}
          onSpearMiss={handleSpearMiss}
          onDeathAnimationComplete={spawnNewAnimal}
        />
      </Canvas>

      <Overlay
        spearState={spearState}
        showCamera={showCamera}
        onToggleCamera={() => setShowCamera(!showCamera)}
        isReady={isReady}
        videoRef={videoRef}
        poseLandmarks={poseLandmarks}
        thrownSpearsCount={thrownSpears.length}
        score={score}
        hitMessage={hitMessage}
        flashMessage={flashMessage}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        onRestart={handleRestart}
        availableCameras={availableCameras}
        selectedCameraId={selectedCameraId}
        onCameraChange={setSelectedCameraId}
        cameraRotation={cameraRotation}
        onCameraRotation={handleCameraRotation}
        lastFireTime={lastFireTime}
        fireCooldown={FIRE_COOLDOWN}
      />
    </div>
  )
}

export default App

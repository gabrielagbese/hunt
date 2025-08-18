import { useState, useEffect, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Plane, Sphere, Environment } from '@react-three/drei'
import { Hands } from '@mediapipe/hands'
import { Camera } from '@mediapipe/camera_utils'
import * as THREE from 'three'
import { Model as ElephantModel } from '../Elephant.jsx'
import { Model as AntelopeModel } from '../Antelope.jsx'
import { Model as CatModel } from '../Cat.jsx'
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
    spawnWeight: 2
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
    spawnWeight: 3
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
    spawnWeight: 6
  }
}

// Hand tracking hook
function useHandTracking() {
  const [hands, setHands] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [handLandmarks, setHandLandmarks] = useState(null)
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
      console.log('Available cameras:', videoDevices)
      setAvailableCameras(videoDevices)

      // Set default camera if none selected
      if (!selectedCameraId && videoDevices.length > 0) {
        setSelectedCameraId(videoDevices[0].deviceId)
      }
    } catch (error) {
      console.error('Error enumerating cameras:', error)
    }
  }

  // Function to initialize camera with specific device ID
  const initializeCamera = async (deviceId) => {
    try {
      // Stop current stream if exists
      if (currentStream.current) {
        currentStream.current.getTracks().forEach(track => track.stop())
      }

      console.log('Requesting camera access for device:', deviceId)
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      console.log('Camera access granted:', stream)
      currentStream.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.addEventListener('loadeddata', () => {
          console.log('Video loaded, setting ready to true')
          setIsReady(true)
        })
      }
    } catch (error) {
      console.error('Error accessing camera:', error)
    }
  }

  useEffect(() => {
    const initializeHands = async () => {
      const handsInstance = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        }
      })

      handsInstance.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      })

      handsInstance.onResults((results) => {
        console.log('MediaPipe results:', results)
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          console.log('Hand detected:', results.multiHandLandmarks[0])
          setHandLandmarks(results.multiHandLandmarks[0])
        } else {
          setHandLandmarks(null)
        }
      })

      setHands(handsInstance)

      // Enumerate cameras first
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await enumerateCameras()
      } else {
        console.error('getUserMedia not supported')
      }
    }

    initializeHands()
  }, [])

  // Initialize camera when selected camera changes
  useEffect(() => {
    if (selectedCameraId) {
      initializeCamera(selectedCameraId)
    }
  }, [selectedCameraId])

  useEffect(() => {
    if (hands && videoRef.current && isReady) {
      console.log('Initializing MediaPipe camera...')
      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await hands.send({ image: videoRef.current })
          }
        },
        width: 640,
        height: 480
      })
      console.log('Starting MediaPipe camera...')
      camera.start()
    }
  }, [hands, isReady])

  return {
    handLandmarks,
    isReady,
    videoRef,
    canvasRef,
    availableCameras,
    selectedCameraId,
    setSelectedCameraId
  }
}

// Detect closed fist
function detectFist(landmarks) {
  if (!landmarks || landmarks.length < 21) return false

  // Finger tip and PIP joint indices
  const fingerTips = [4, 8, 12, 16, 20] // Thumb, Index, Middle, Ring, Pinky
  const fingerPIPs = [3, 6, 10, 14, 18]

  let curledFingers = 0

  // Check if fingers are curled (tip below PIP joint)
  for (let i = 1; i < 5; i++) { // Skip thumb for now
    if (landmarks[fingerTips[i]].y > landmarks[fingerPIPs[i]].y) {
      curledFingers++
    }
  }

  // Check thumb crossing index finger
  const thumbCrossing = landmarks[4].x < landmarks[8].x

  return curledFingers >= 3 && thumbCrossing
}

function detectOpenPalm(landmarks) {
  if (!landmarks || landmarks.length < 21) return false

  // Check if fingertips are above their respective PIP joints (more reliable than MCP)
  const fingerTips = [8, 12, 16, 20] // Index, Middle, Ring, Pinky tips
  const fingerPIPs = [6, 10, 14, 18] // PIP joints (more reliable for open detection)
  const fingerMCPs = [5, 9, 13, 17] // MCP joints for additional validation

  let openFingers = 0
  let extendedFingers = 0

  for (let i = 0; i < fingerTips.length; i++) {
    const tip = landmarks[fingerTips[i]]
    const pip = landmarks[fingerPIPs[i]]
    const mcp = landmarks[fingerMCPs[i]]

    // Check if finger is extended (tip above PIP and PIP above MCP)
    const tipAbovePip = tip.y < pip.y - 0.01
    const pipAboveMcp = pip.y < mcp.y + 0.005

    if (tipAbovePip && pipAboveMcp) {
      extendedFingers++
    }

    // Also check simple tip above MCP for backup detection
    if (tip.y < mcp.y - 0.02) {
      openFingers++
    }
  }

  // Enhanced thumb detection
  const thumbTip = landmarks[4]
  const thumbIp = landmarks[3]
  const thumbMcp = landmarks[2]

  // Check thumb extension in multiple ways
  const thumbXDistance = Math.abs(thumbTip.x - thumbMcp.x)
  const thumbYDistance = Math.abs(thumbTip.y - thumbIp.y)
  const thumbExtended = thumbXDistance > 0.025 || thumbYDistance > 0.02

  // Multiple criteria for robust detection
  const criteriaA = extendedFingers >= 3 && thumbExtended // Strict: 3+ extended fingers + thumb
  const criteriaB = openFingers >= 3 && thumbExtended     // Backup: 3+ open fingers + thumb
  const criteriaC = extendedFingers >= 4                  // Very open hand: 4+ extended fingers

  return criteriaA || criteriaB || criteriaC
}

// Ground plane component with forest textures
function GroundPlane() {
  const [diffuseMap, normalMap, displacementMap, armMap] = useLoader(THREE.TextureLoader, [
    '/textures/forest_leaves_02_diffuse_1k.jpg',
    '/textures/forest_leaves_02_nor_gl_1k.jpg',
    '/textures/forest_leaves_02_disp_1k.jpg',
    '/textures/forest_leaves_02_arm_1k.jpg'
  ])

  // Configure texture properties for tiling
  const configureTexture = (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1.5, 3) // Tile the texture across the ground
    return texture
  }

  configureTexture(diffuseMap)
  configureTexture(normalMap)
  configureTexture(displacementMap)
  configureTexture(armMap)

  return (
    <Plane args={[20, 40]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -10]} receiveShadow>
      <meshStandardMaterial
        map={diffuseMap}
        normalMap={normalMap}
        displacementMap={displacementMap}
        displacementScale={0.15}
        aoMap={armMap}
        roughnessMap={armMap}
        metalnessMap={armMap}
        roughness={0.8}
        metalness={0.1}
        color={0xcccccc} // Very slightly darker ground plane
        transparent={true}
        opacity={0.9} // Slight transparency
      />
    </Plane>
  )
}

// Spear component
function Spear({ position, spearState }) {
  const meshRef = useRef()
  const [spearPosition, setSpearPosition] = useState([0, 0.5, 5])
  const lastValidPosition = useRef([0, 0.5, 5])

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
        meshRef.current.position.set(0, 0.5, 5)
        lastValidPosition.current = [0, 0.5, 5]
      }
    }
  })

  useEffect(() => {
    if (spearState === SPEAR_STATES.IDLE) {
      setSpearPosition([0, 0.5, 5]) // Start closer to camera
      lastValidPosition.current = [0, 0.5, 5]
    }
  }, [spearState])

  return (
    <group ref={meshRef} position={spearPosition} rotation={[Math.PI / -2, 0, 0]}>
      {/* Spear shaft */}
      <mesh castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.5]} />
        <meshStandardMaterial color={spearState === SPEAR_STATES.GRIPPED ? '#8B4513' : '#654321'} />
      </mesh>
      {/* Spear tip */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <coneGeometry args={[0.05, 0.3]} />
        <meshStandardMaterial color="#C0C0C0" />
      </mesh>
    </group>
  )
}

// Animal component
function Animal({ animalData, onHit, onReachPlayer, thrownSpears, onHitMessage, isPaused }) {
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
      onReachPlayer(animalData.type.damage)
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
          onHit(animalData.type.score, spear.id)
        }, 500)

        if (newHealth <= 0) {
          setIsAlive(false)
          setIsDying(true)
          onHit(animalData.type.score, spear.id)

          // Remove the animal after death animation
          // Different durations: 3 seconds for elephants, 2 seconds for cheetahs, 1 second for antelopes
          const deathAnimationDuration = animalData.type.name === 'elephant' ? 3000 :
            animalData.type.name === 'cheetah' ? 4000 : 800
          setTimeout(() => {
            setIsDying(false) // This will cause the component to return null
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
          scale={[2, 2, 2]}
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
          scale={[1.5, 1.5, 1.5]}
          rotation={[0, 0, 0]}
          castShadow
          animationState={isDying ? 'death' : 'walk'}
        />
      ) : animalData.type.name === 'cheetah' ? (
        <CatModel
          scale={[1.5, 1.5, 1.5]}
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

    // Check collision with backboard (at z = -30, width = 10, height = 8, center at y = 3)
    if (newPosition[2] <= -29.9 &&
      newPosition[0] >= -5 && newPosition[0] <= 5 &&
      newPosition[1] >= -1 && newPosition[1] <= 7) {
      // Stick to backboard - this is a miss only if it didn't hit an animal
      newPosition[2] = -29.9
      setIsActive(false)
      if (!hasTriggeredMiss && !hasHitAnimal && onMiss) {
        setHasTriggeredMiss(true)
        onMiss(spearData.id)
      }
    }
    // Stick in ground when hitting - this is also a miss only if it didn't hit an animal
    else if (newPosition[1] <= 0.75) {
      newPosition[1] = 0.75
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
    <group ref={meshRef} position={position} rotation={[Math.PI / -2, 0, 0]}>
      {/* Spear shaft */}
      <mesh castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.5]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      {/* Spear tip */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <coneGeometry args={[0.05, 0.3]} />
        <meshStandardMaterial color="#C0C0C0" />
      </mesh>
    </group>
  )
}

// 3D Scene component
function Scene({ handPosition, spearState, thrownSpears, animals, onAnimalHit, onAnimalReachPlayer, onHitMessage, isPaused, onSpearMiss }) {
  return (
    <>
      <Environment files="/env.hdr" background />
      <ambientLight intensity={0.05} />
      <directionalLight
        position={[0, 20, 10]}
        castShadow
        intensity={0.8}
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

      {/* Target backboard at end of plane */}
      {/* <Plane args={[10, 8]} position={[0, 3, -30]} receiveShadow>
        <meshStandardMaterial color="#FFFFFF" />
      </Plane> */}

      {/* Target rings */}
      <mesh position={[0, 3, -29.9]}>
        <ringGeometry args={[2, 2.2]} />
        <meshStandardMaterial color="#FF0000" />
      </mesh>
      <mesh position={[0, 3, -29.8]}>
        <ringGeometry args={[1, 1.2]} />
        <meshStandardMaterial color="#FFFFFF" />
      </mesh>
      <mesh position={[0, 3, -29.7]}>
        <ringGeometry args={[0.3, 0.5]} />
        <meshStandardMaterial color="#FF0000" />
      </mesh>

      {/* Active Spear */}
      <Spear
        position={handPosition}
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
        />
      ))}

      <OrbitControls enablePan={false} enableZoom={false} enableRotate={true} />
    </>
  )
}

// Overlay UI component
function Overlay({ spearState, showCamera, onToggleCamera, isReady, videoRef, handLandmarks, powerLevel, thrownSpearsCount, playerHealth, score, screenFlash, hitMessage, isPaused, onTogglePause, isGameOver, onRestart, availableCameras, selectedCameraId, onCameraChange, cameraRotation, onCameraRotation }) {
  // Debug hand detection states
  const isFist = handLandmarks ? detectFist(handLandmarks) : false
  const isOpenPalm = handLandmarks ? detectOpenPalm(handLandmarks) : false

  return (
    <div className="overlay">
      {/* Screen flash effect */}
      {screenFlash && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(255, 0, 0, 0.5)',
            pointerEvents: 'none',
            zIndex: 1000
          }}
        />
      )}

      {/* Game Over Screen */}
      {isGameOver && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000
          }}
        >
          <div style={{ color: '#FF0000', fontSize: '48px', fontWeight: 'bold', marginBottom: '20px' }}>
            GAME OVER
          </div>
          <div style={{ color: '#fff', fontSize: '24px', marginBottom: '10px' }}>
            Final Score: <span style={{ color: '#FFD700' }}>{score}</span>
          </div>
          <button
            onClick={onRestart}
            style={{
              padding: '15px 30px',
              fontSize: '20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              marginTop: '20px'
            }}
          >
            Restart Game
          </button>
        </div>
      )}

      {/* Pause Screen */}
      {isPaused && !isGameOver && (
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

      <div className="top-left">
        <div className="game-stats">
          <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold', marginBottom: '10px' }}>
            Health: <span style={{ color: playerHealth > 50 ? '#00FF00' : playerHealth > 25 ? '#FFFF00' : '#FF0000' }}>{playerHealth}</span>
          </div>
          <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>
            Score: <span style={{ color: '#FFD700' }}>{score}</span>
          </div>
        </div>
      </div>

      <div className="top-right">
        {showCamera && (
          <div className="camera-view">
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
            {handLandmarks && (
              <div className="hand-indicator">
                ✋ Hand: {isFist ? '👊 Fist' : isOpenPalm ? '✋ Open' : '🤚 Neutral'}
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

      {/* Power meter - always visible at bottom */}
      <div className="power-meter-bottom">
        <div className="power-label">Power</div>
        <div className="power-bar">
          <div
            className="power-fill"
            style={{
              width: `${powerLevel}%`,
              backgroundColor: `hsl(${powerLevel * 1.2}, 70%, 50%)`
            }}
          />
        </div>
        <div className="power-value">{Math.round(powerLevel)}%</div>
      </div>
    </div>
  )
}

function App() {
  const { handLandmarks, isReady, videoRef, availableCameras, selectedCameraId, setSelectedCameraId } = useHandTracking()
  const [spearState, setSpearState] = useState(SPEAR_STATES.IDLE)
  const [showCamera, setShowCamera] = useState(true)
  const [handPosition, setHandPosition] = useState(null)
  const [powerLevel, setPowerLevel] = useState(0)
  const [thrownSpears, setThrownSpears] = useState([])
  const [animals, setAnimals] = useState([])
  const [playerHealth, setPlayerHealth] = useState(100)
  const [score, setScore] = useState(0)
  const [screenFlash, setScreenFlash] = useState(false)
  const [hitMessage, setHitMessage] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [isGameOver, setIsGameOver] = useState(false)
  const [cameraRotation, setCameraRotation] = useState(0) // 0, 90, 180, 270 degrees
  const powerDirection = useRef(1)
  const powerInterval = useRef(null)
  const spearIdCounter = useRef(0)
  const animalIdCounter = useRef(0)
  const animalSpawnInterval = useRef(null)

  // Power meter oscillation effect - runs continuously
  useEffect(() => {
    if (isPaused || isGameOver) return

    powerInterval.current = setInterval(() => {
      setPowerLevel(prev => {
        const newLevel = prev + (powerDirection.current * 4) // Increased from 2 to 4 for faster cycling
        if (newLevel >= 100) {
          powerDirection.current = -1
          return 100
        } else if (newLevel <= 0) {
          powerDirection.current = 1
          return 0
        }
        return newLevel
      })
    }, 30) // Reduced from 50ms to 30ms for smoother animation

    return () => {
      if (powerInterval.current) {
        clearInterval(powerInterval.current)
      }
    }
  }, [isPaused, isGameOver])

  // Animal spawning system
  useEffect(() => {
    if (isPaused || isGameOver || playerHealth <= 0) return

    animalSpawnInterval.current = setInterval(() => {
      if (playerHealth <= 0 || isPaused || isGameOver) return // Stop spawning if player is dead, paused, or game over

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
      const spawnX = (Math.random() - 0.5) * 15 // Random X position across the width
      const spawnY = 0 // Ground level
      const spawnZ = -25 // Back of the plane

      const newAnimal = {
        id: animalIdCounter.current++,
        type: selectedType,
        position: [spawnX, spawnY, spawnZ],
        timestamp: Date.now()
      }

      setAnimals(prev => [...prev, newAnimal])
    }, 8000) // Spawn every 8 seconds (further reduced spawn rate)

    return () => {
      if (animalSpawnInterval.current) {
        clearInterval(animalSpawnInterval.current)
      }
    }
  }, [playerHealth, isPaused, isGameOver])

  // Handle animal hitting player
  const handleAnimalReachPlayer = (damage) => {
    setPlayerHealth(prev => {
      const newHealth = Math.max(0, prev - damage)
      if (newHealth <= 0) {
        setIsGameOver(true)
      }
      return newHealth
    })

    // Screen flash effect
    setScreenFlash(true)
    setTimeout(() => setScreenFlash(false), 200)
  }

  // Handle animal being killed
  const handleAnimalHit = (scorePoints, spearId) => {
    setScore(prev => prev + scorePoints)
    // Remove the spear that hit the animal
    if (spearId) {
      setThrownSpears(prev => prev.filter(spear => spear.id !== spearId))
    }
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
    if (!isGameOver) {
      setIsPaused(prev => !prev)
    }
  }

  // Handle game restart
  const handleRestart = () => {
    setPlayerHealth(100)
    setScore(0)
    setAnimals([])
    setThrownSpears([])
    setIsGameOver(false)
    setIsPaused(false)
    setHitMessage('')
    setScreenFlash(false)
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
    if (handLandmarks && isReady && !isPaused && !isGameOver) {
      const isFist = detectFist(handLandmarks)
      const isOpenPalm = detectOpenPalm(handLandmarks)
      console.log('Hand detection - Fist:', isFist, 'Open Palm:', isOpenPalm, 'Spear State:', spearState)

      // Convert hand landmarks to 3D position
      const handCenter = handLandmarks[9] // Middle finger MCP joint
      let x = (0.5 - handCenter.x) * 25 // Increased X-axis range for wider movement
      let y = (1 - handCenter.y) * 2.5  // Reduced Y height to match animal ground level
      
      // Apply camera rotation to X and Y coordinates
      const [rotatedX, rotatedY] = rotateCoordinates(x, y, cameraRotation)
      
      const position = [
        rotatedX,
        rotatedY,
        5 + handCenter.z * -3      // Start closer to camera (z=5) and scale depth
      ]

      // Only update hand position when gripped to follow hand
      if (spearState === SPEAR_STATES.GRIPPED) {
        setHandPosition(position)
      }

      // Simplified state machine logic
      if (isFist && spearState === SPEAR_STATES.IDLE) {
        setSpearState(SPEAR_STATES.GRIPPED)
        setHandPosition(position) // Set initial grip position
      } else if (isOpenPalm && spearState === SPEAR_STATES.GRIPPED) {
        // Calculate throwing velocity based on power level
        const powerRatio = powerLevel / 100
        const baseVelocity = 2.0 + powerRatio * 8.0 // Increased from 1.5-7.5 to 2.0-10.0 for more distance

        // Z velocity scaled by power (100% power reaches target)
        const zVelocity = -baseVelocity * (1 + powerRatio * 8) // Increased multiplier from 6 to 8 for much more distance
        const yVelocity = 1.0 + powerRatio * 2.0 // Increased upward arc for better trajectory
        const xVelocity = 0 // No horizontal movement

        const velocity = [xVelocity, yVelocity, zVelocity]

        const newSpear = {
          id: spearIdCounter.current++,
          position: [...handPosition], // Use current hand position
          velocity: velocity,
          timestamp: Date.now()
        }

        setThrownSpears(prev => [...prev, newSpear])
        setSpearState(SPEAR_STATES.THROWING)

        // Reset to idle after a short delay to spawn new spear
        setTimeout(() => {
          setSpearState(SPEAR_STATES.IDLE)
        }, 500)
      }
    }
    // If hand tracking is lost while gripped, keep spear in current position
  }, [handLandmarks, isReady, spearState, powerLevel, handPosition, isPaused, isGameOver])

  return (
    <div className="app">
      <Canvas
        shadows
        camera={{ position: [0, 5, 10], fov: 75 }}
        style={{ width: '100vw', height: '100vh' }}
      >
        <Scene
          handPosition={handPosition}
          spearState={spearState}
          thrownSpears={thrownSpears}
          animals={animals}
          onAnimalHit={handleAnimalHit}
          onAnimalReachPlayer={handleAnimalReachPlayer}
          onHitMessage={handleHitMessage}
          isPaused={isPaused}
          onSpearMiss={handleSpearMiss}
        />
      </Canvas>

      <Overlay
        spearState={spearState}
        showCamera={showCamera}
        onToggleCamera={() => setShowCamera(!showCamera)}
        isReady={isReady}
        videoRef={videoRef}
        handLandmarks={handLandmarks}
        powerLevel={powerLevel}
        thrownSpearsCount={thrownSpears.length}
        playerHealth={playerHealth}
        score={score}
        screenFlash={screenFlash}
        hitMessage={hitMessage}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        isGameOver={isGameOver}
        onRestart={handleRestart}
        availableCameras={availableCameras}
        selectedCameraId={selectedCameraId}
        onCameraChange={setSelectedCameraId}
        cameraRotation={cameraRotation}
        onCameraRotation={handleCameraRotation}
      />
    </div>
  )
}

export default App

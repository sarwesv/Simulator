import { useState, useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import './App.css';

// Constants
const AIRPORTS = [
  { name: 'San Francisco (SFO)', lat: 37.6191, lon: -122.3752, height: 100 },
  { name: 'London Heathrow (LHR)', lat: 51.4700, lon: -0.4543, height: 100 },
  { name: 'Tokyo Haneda (HND)', lat: 35.5494, lon: 139.7798, height: 100 },
  { name: 'New York (JFK)', lat: 40.6413, lon: -73.7781, height: 100 },
  { name: 'Dubai (DXB)', lat: 25.2532, lon: 55.3657, height: 100 },
];

const JETS = [
  { name: 'Cesium Air', url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb' },
  { name: 'Drone', url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumDrone/CesiumDrone.glb' }
];

function App() {
  const [ionToken, setIonToken] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMWE1NTJkOC03ZDY0LTQ2M2ItOWVkNi0yOGI4OTVmMjg3MmMiLCJpZCI6NDQzMjg4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODExOTQ0Mjd9.QzLRzlRgP9n8GfYKQiHJMLXIoCzK-qLHDR6SHuowZzk');
  const [isStarted, setIsStarted] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState(AIRPORTS[0]);
  const [selectedJet, setSelectedJet] = useState(JETS[0]);
  const cesiumContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  const handleStart = () => {
    if (!ionToken) {
      alert('Please enter your Cesium ion Access Token');
      return;
    }
    setIsStarted(true);
  };

  useEffect(() => {
    if (isStarted && cesiumContainerRef.current && !viewerRef.current) {
      initCesium();
    }
  }, [isStarted]);

  const initCesium = async () => {
    try {
      // 1. Set Token
      Cesium.Ion.defaultAccessToken = ionToken;

      // 2. Initialize Viewer with Terrain
      const viewer = new Cesium.Viewer(cesiumContainerRef.current!, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        baseLayerPicker: false,
        timeline: false,
        animation: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
      });
      viewerRef.current = viewer;

      // 3. Add OSM Buildings
      try {
        const buildings = await Cesium.createOsmBuildingsAsync();
        viewer.scene.primitives.add(buildings);
      } catch (error) {
        console.error('Error loading OSM Buildings:', error);
      }

      // 4. Add Aircraft
      const position = Cesium.Cartesian3.fromDegrees(
        selectedAirport.lon,
        selectedAirport.lat,
        selectedAirport.height
      );
      
      const hpr = new Cesium.HeadingPitchRoll(0, 0, 0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

      const entity = viewer.entities.add({
        position: position,
        orientation: orientation as any,
        model: {
          uri: selectedJet.url,
          minimumPixelSize: 128,
          maximumScale: 20000,
        },
      });

      // 5. Flight State
      const state = {
        thrust: 0,
        speed: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
        position: position,
        hpr: new Cesium.HeadingPitchRoll(0, 0, 0),
      };

      const keys: Record<string, boolean> = {};
      window.onkeydown = (e) => { keys[e.code] = true; };
      window.onkeyup = (e) => { keys[e.code] = false; };

      // 6. Simulation Loop
      viewer.scene.preUpdate.addEventListener(() => {
        // Update physics
        if (keys['ShiftLeft']) state.thrust = Math.min(state.thrust + 0.5, 100);
        if (keys['ControlLeft']) state.thrust = Math.max(state.thrust - 0.5, 0);
        
        // Speed approach thrust
        state.speed += (state.thrust * 2 - state.speed) * 0.01;

        // Controls
        const rotationSpeed = 0.02;
        if (keys['KeyW']) state.hpr.pitch -= rotationSpeed;
        if (keys['KeyS']) state.hpr.pitch += rotationSpeed;
        if (keys['KeyA']) state.hpr.roll -= rotationSpeed;
        if (keys['KeyD']) state.hpr.roll += rotationSpeed;
        if (keys['KeyQ']) state.hpr.heading -= rotationSpeed;
        if (keys['KeyE']) state.hpr.heading += rotationSpeed;

        // Auto-level roll
        if (!keys['KeyA'] && !keys['KeyD']) {
          state.hpr.roll *= 0.95;
        }

        // Calculate direction
        const rotationMatrix = Cesium.Matrix3.fromHeadingPitchRoll(state.hpr);
        const forward = Cesium.Matrix3.multiplyByVector(
          rotationMatrix,
          Cesium.Cartesian3.UNIT_Y,
          new Cesium.Cartesian3()
        );

        // Update position
        const moveStep = Cesium.Cartesian3.multiplyByScalar(forward, state.speed, new Cesium.Cartesian3());
        Cesium.Cartesian3.add(state.position, moveStep, state.position);

        // Update Entity
        entity.position = state.position as any;
        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(state.position, state.hpr) as any;

        // Update Camera (Chase Cam)
        const cameraOffset = new Cesium.Cartesian3(0, -50, 20);
        const cameraPosition = Cesium.Matrix3.multiplyByVector(rotationMatrix, cameraOffset, new Cesium.Cartesian3());
        Cesium.Cartesian3.add(state.position, cameraPosition, cameraPosition);

        viewer.camera.lookAt(
          cameraPosition,
          new Cesium.HeadingPitchRange(state.hpr.heading, state.hpr.pitch - 0.2, 100)
        );
        (viewer.camera as any)._suspendTransform = false;

        // Update HUD
        const cartographic = Cesium.Cartographic.fromCartesian(state.position);
        const altElement = document.getElementById('alt-val');
        const spdElement = document.getElementById('spd-val');
        if (altElement) altElement.innerText = Math.round(cartographic.height * 3.28084).toLocaleString();
        if (spdElement) spdElement.innerText = Math.round(state.speed * 1.94384).toLocaleString();
      });

    } catch (error) {
      console.error('Cesium init error:', error);
    }
  };

  if (!isStarted) {
    return (
      <div className="landing-page">
        <div className="config-card">
          <h1>Global Sky</h1>
          <p>Explore the world in 3D.</p>
          
          <div className="input-group">
            <label>Starting Location</label>
            <select 
              value={selectedAirport.name}
              onChange={(e) => setSelectedAirport(AIRPORTS.find(a => a.name === e.target.value) || AIRPORTS[0])}
            >
              {AIRPORTS.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>

          <div className="input-group">
            <label>Aircraft</label>
            <select 
              value={selectedJet.name}
              onChange={(e) => setSelectedJet(JETS.find(j => j.name === e.target.value) || JETS[0])}
            >
              {JETS.map(j => <option key={j.name} value={j.name}>{j.name}</option>)}
            </select>
          </div>

          <button className="start-btn" onClick={handleStart}>Take Off</button>
        </div>
      </div>
    );
  }

  return (
    <div className="simulation-container">
      <div ref={cesiumContainerRef} className="cesium-container" />
      <div className="hud">
        <div className="hud-item">ALT: <span id="alt-val">0</span> ft</div>
        <div className="hud-item">SPD: <span id="spd-val">0</span> kts</div>
      </div>
      <div className="controls-hint">
        WASD to Pitch/Roll | QE for Yaw | Shift/Ctrl for Thrust
      </div>
    </div>
  );
}

export default App;

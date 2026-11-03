import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useGame, PAINTS, paintColor } from '../core/store';
import { CAR_SPECS, buildCarModel, CarModel } from '../vehicles/VehicleModels';
import { createBallMesh } from '../ball/Ball';
import { Audio } from '../audio/AudioManager';

function Preview({ car, paint }: { car: 0 | 1; paint: number }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setCar: (c: 0 | 1, p: number) => void; setPaint: (p: number) => void } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    cam.position.set(2.6, 1.1, 2.6); cam.lookAt(0, 0.15, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(3, 5, 2); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = sc.bottom = -2; sc.right = sc.top = 2;
    const rim = new THREE.DirectionalLight(0x19d3ff, 2); rim.position.set(-3, 2, -3);
    const rim2 = new THREE.DirectionalLight(0xffa21a, 1.6); rim2.position.set(-2, 1.5, 3);
    scene.add(key, rim, rim2, new THREE.AmbientLight(0x334455, 0.6));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshStandardMaterial({ color: 0x0d1320, metalness: 0.6, roughness: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.33; floor.receiveShadow = true; scene.add(floor);
    const ringM = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.54, 96), new THREE.MeshBasicMaterial({ color: 0x19d3ff, toneMapped: false }));
    ringM.rotation.x = -Math.PI / 2; ringM.position.y = -0.325; scene.add(ringM);
    const { mesh: ball } = createBallMesh(0.93);
    ball.position.set(0.7, 0.6, -2.9); scene.add(ball);

    const turn = new THREE.Group(); scene.add(turn);
    let model: CarModel | null = null;
    const setCar = (c: 0 | 1, p: number) => {
      if (model) turn.remove(model.group);
      model = buildCarModel(CAR_SPECS[c], p);
      model.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      model.wheels.forEach((w) => (w.mount.position.y = CAR_SPECS[c].attachY - CAR_SPECS[c].suspRest * 0.55));
      const sp = CAR_SPECS[c]; model.group.position.y = -0.33 - (sp.attachY - sp.suspRest * 0.55 - Math.max(...sp.wheels.map((w) => w.r)));
      turn.add(model.group);
    };
    api.current = { setCar, setPaint: (p) => model?.setPaint(p) };
    setCar(car, paint);

    let yaw = 0.6, vel = 0.25, drag = false, lastX = 0, pitch = 0;
    const down = (e: PointerEvent) => { drag = true; lastX = e.clientX; el.setPointerCapture(e.pointerId); };
    const mv = (e: PointerEvent) => { if (!drag) return; const d = e.clientX - lastX; lastX = e.clientX; vel = d * 0.25; yaw += d * 0.01; pitch = Math.max(-0.2, Math.min(0.5, pitch + e.movementY * 0.004)); };
    const up = () => { drag = false; };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0, t = 0, lastT = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; t += dt;
      // gamepad right stick rotates the preview too
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
      const rx = pad ? pad.axes[2] ?? 0 : 0;
      if (Math.abs(rx) > 0.15) { yaw += rx * dt * 3; vel = 0; }
      if (!drag) { yaw += vel * dt; vel += (0.25 - vel) * dt * 0.8; }
      turn.rotation.y = yaw;
      const r = 3.7;
      cam.position.set(Math.sin(0.8) * r, 0.9 + pitch * 2.5, Math.cos(0.8) * r); cam.lookAt(0, 0.12, 0);
      model?.wheels.forEach((w) => (w.spin.rotation.z = -t * 2));
      ball.rotation.y = t * 0.3;
      ringM.scale.setScalar(1 + Math.sin(t * 2) * 0.01);
      renderer.render(scene, cam);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); el.removeChild(renderer.domElement); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { api.current?.setCar(car, paint); }, [car]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.current?.setPaint(paint); }, [paint]);

  return <div className="preview" ref={host}><div className="hint">ARRASTRA O USA EL STICK DERECHO PARA ROTAR</div></div>;
}

export function Garage() {
  const { car, paints, setCar, setPaint, setScreen } = useGame();
  const spec = CAR_SPECS[car];
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const back = () => setScreen('menu');
    window.addEventListener('nav-back', back);
    return () => window.removeEventListener('nav-back', back);
  }, [setScreen]);
  const stats: [string, number][] = [['VELOCIDAD', spec.stats.speed], ['ACELERACIÓN', spec.stats.accel], ['MANEJO', spec.stats.handling], ['AÉREO', spec.stats.aerial], ['PESO', spec.stats.weight]];
  return (
    <div className="screen">
      <div className="head"><h2>GARAJE</h2><button data-nav className="back" onClick={() => setScreen('menu')}>← VOLVER</button></div>
      <div className="garage">
        <Preview car={car} paint={paintColor(paints[car])} />
        <div className="side">
          <div className="cars">
            {CAR_SPECS.map((c, i) => (
              <button key={c.id} ref={i === 0 ? first : undefined} data-nav className={`carbtn ${car === c.id ? 'on' : ''}`} onClick={() => { Audio.click(true); setCar(c.id); }}>
                <b>{c.name}</b><span>{c.model}</span>
              </button>
            ))}
          </div>
          <div style={{ color: 'var(--dim)', fontSize: 14, lineHeight: 1.5 }}>{spec.tagline}</div>
          <div>{stats.map(([n, v]) => <div key={n} className="stat" style={{ marginBottom: 8 }}><span>{n}</span><div className="bar"><i style={{ width: `${v * 10}%` }} /></div></div>)}</div>
          <div style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.2em' }}>PINTURA · {PAINTS.find((p) => p.id === paints[car])?.name.toUpperCase()}</div>
          <div className="swatches">
            {PAINTS.map((p) => (
              <button key={p.id} data-nav aria-label={p.name} className={`sw ${paints[car] === p.id ? 'on' : ''}`} style={{ background: `#${p.color.toString(16).padStart(6, '0')}` }} onClick={() => { Audio.click(); setPaint(car, p.id); }} />
            ))}
          </div>
          <div className="note" style={{ marginTop: 0 }}>Hitbox {spec.half.map((h) => (h * 200).toFixed(0)).join(' × ')} cm · ruedas {spec.wheels[0].r * 200 | 0}/{spec.wheels[2].r * 200 | 0} cm</div>
          <button data-nav className="cta" style={{ marginTop: 'auto' }} onClick={() => { Audio.click(true); setScreen('playing'); }}>JUGAR CON {spec.model}</button>
        </div>
      </div>
    </div>
  );
}

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA, TEAM_A, TEAM_B, G_ARENA, groups } from '../core/config';
import { buildShell, perimeter } from './ArenaGeometry';
import { fieldTexture, bandTextures, hexTexture, goalFloorTexture, screenTexture, beamTexture } from './Textures';
import type { Quality } from '../core/store';

const { W, L, H, curveR: RF, goalW, goalH, goalD, bandTop } = ARENA;
const hx = W / 2, hz = L / 2;

export class Arena {
  group = new THREE.Group();
  crowdMat!: THREE.MeshBasicMaterial;
  crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  screens: { mesh: THREE.Mesh; accent: number }[] = [];
  beams: THREE.Mesh[] = [];
  private stars!: THREE.Points;

  constructor(private scene: THREE.Scene, private world: RAPIER.World, quality: Quality) {
    scene.add(this.group);
    this.buildShell();
    this.buildGoal(1, TEAM_B);
    this.buildGoal(-1, TEAM_A);
    this.buildStadium(quality);
    this.buildSky();
  }

  private buildShell() {
    const shell = buildShell();
    const band = bandTextures();
    const lowerMat = new THREE.MeshStandardMaterial({
      map: band.map, emissiveMap: band.emissive, emissive: 0xffffff, emissiveIntensity: 1.1,
      metalness: 0.75, roughness: 0.38, side: THREE.DoubleSide,
    });
    const lower = new THREE.Mesh(shell.lower, lowerMat);
    lower.receiveShadow = true;
    this.group.add(lower);

    const hex = hexTexture(512, 3, 0.05);
    const colorize = (geo: THREE.BufferGeometry, k: number) => {
      const p = geo.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      const ca = new THREE.Color(TEAM_A), cb = new THREE.Color(TEAM_B), tmp = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), y = p.getY(i);
        const t = THREE.MathUtils.smoothstep(z, -25, 25);
        tmp.copy(ca).lerp(cb, t).multiplyScalar(k * (0.55 + 0.45 * Math.max(0, 1 - (y - bandTop) / 12)));
        col.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    };
    colorize(shell.upper, 1);
    colorize(shell.top, 0.5);
    const glassMat = new THREE.MeshBasicMaterial({
      map: hex, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.group.add(new THREE.Mesh(shell.upper, glassMat));
    const topMat = glassMat.clone(); topMat.opacity = 0.25;
    this.group.add(new THREE.Mesh(shell.top, topMat));
    const ceilGeo = shell.ceiling;
    const cuv = ceilGeo.getAttribute('uv');
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * 14, cuv.getY(i) * 17);
    colorize(ceilGeo, 0.35);
    const ceilMat = glassMat.clone(); ceilMat.opacity = 0.12;
    this.group.add(new THREE.Mesh(ceilGeo, ceilMat));

    // Field
    const fieldMat = new THREE.MeshStandardMaterial({ map: fieldTexture(TEAM_A, TEAM_B), roughness: 0.82, metalness: 0.02 });
    const floor = new THREE.Mesh(shell.floor, fieldMat);
    floor.receiveShadow = true;
    this.group.add(floor);

    // LED ribbons on the walls
    this.group.add(this.ribbon(bandTop - 0.05, 0.16, 0.04, 2.2, true));
    this.group.add(this.ribbon(H - RF - 0.2, 0.22, 0.02, 1.6, false));

    // Physics: one trimesh for the whole shell + floors
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(shell.collision.vertices, shell.collision.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.6).setRestitution(0.0).setCollisionGroups(groups(G_ARENA, 0xffff));
    this.world.createCollider(desc, body);
  }

  /** Emissive strip that follows the wall surface. */
  private ribbon(y: number, h: number, inset: number, intensity: number, cutGoals: boolean) {
    const perim = perimeter();
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const ca = new THREE.Color(TEAM_A), cb = new THREE.Color(TEAM_B), c = new THREE.Color();
    const N = perim.length;
    for (let i = 0; i < N; i++) {
      const p0 = perim[i], p1 = perim[(i + 1) % N];
      if (cutGoals && p0.end && p1.end && Math.abs((p0.x + p1.x) / 2) < goalW / 2) continue;
      const base = pos.length / 3;
      for (const p of [p0, p1]) {
        const x = p.x - p.nx * inset, z = p.z - p.nz * inset;
        pos.push(x, y, z, x, y + h, z);
        c.copy(ca).lerp(cb, THREE.MathUtils.smoothstep(p.z, -20, 20)).multiplyScalar(intensity);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
  }

  private buildGoal(sgn: 1 | -1, team: number) {
    const g = new THREE.Group();
    const zMouth = sgn * hz;
    const z0 = sgn * (hz - RF), zBack = sgn * (hz + goalD);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.85, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151a22, metalness: 0.6, roughness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: team, toneMapped: false });
    glow.color.multiplyScalar(2.2);
    const net = new THREE.MeshBasicMaterial({ map: hexTexture(256, 4, 0.12), color: team, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    net.map!.repeat.set(3, 2);

    // Goal floor
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(goalW, Math.abs(zBack - z0)), new THREE.MeshStandardMaterial({ map: goalFloorTexture(team), roughness: 0.6, metalness: 0.3 }));
    fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.005, (z0 + zBack) / 2); fl.receiveShadow = true;
    g.add(fl);

    const depth = Math.abs(zBack - z0);
    // side walls (solid outside, net inside)
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, goalH, depth), dark);
      wall.position.set(sx * (goalW / 2 + 0.25), goalH / 2, (z0 + zBack) / 2);
      g.add(wall);
      const nt = new THREE.Mesh(new THREE.PlaneGeometry(depth, goalH), net);
      nt.rotation.y = Math.PI / 2; nt.position.set(sx * (goalW / 2 + 0.01), goalH / 2, (z0 + zBack) / 2);
      g.add(nt);
      // post fin glow edge
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, goalH, 0.12), glow);
      edge.position.set(sx * (goalW / 2 + 0.06), goalH / 2, z0 + sgn * 0.06);
      g.add(edge);
      this.cuboid(0.25, goalH / 2, depth / 2, sx * (goalW / 2 + 0.25), goalH / 2, (z0 + zBack) / 2);
    }
    // roof
    const roofDepth = Math.abs(zBack - zMouth);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(goalW + 1, 0.5, roofDepth), dark);
    roof.position.set(0, goalH + 0.25, (zMouth + zBack) / 2); g.add(roof);
    const roofNet = new THREE.Mesh(new THREE.PlaneGeometry(goalW, roofDepth), net);
    roofNet.rotation.x = Math.PI / 2; roofNet.position.set(0, goalH - 0.01, (zMouth + zBack) / 2); g.add(roofNet);
    this.cuboid(goalW / 2 + 0.5, 0.25, roofDepth / 2, 0, goalH + 0.25, (zMouth + zBack) / 2);
    // back wall
    const back = new THREE.Mesh(new THREE.BoxGeometry(goalW + 1, goalH + 1, 0.5), metal);
    back.position.set(0, (goalH + 1) / 2, zBack + sgn * 0.25); g.add(back);
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(goalW, goalH), net);
    backNet.position.set(0, goalH / 2, zBack - sgn * 0.01); g.add(backNet);
    this.cuboid(goalW / 2 + 0.5, (goalH + 1) / 2, 0.25, 0, (goalH + 1) / 2, zBack + sgn * 0.25);
    // interior light bars
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(goalW * 0.18, 0.08, 0.05), glow);
      bar.position.set(-goalW * 0.33 + i * goalW * 0.22, goalH * 0.72, zBack - sgn * 0.05); g.add(bar);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 48), glow);
    ring.position.set(0, goalH * 0.42, zBack - sgn * 0.06); g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 8, 32, Math.PI * 1.5), glow);
    ring2.position.copy(ring.position); ring2.rotation.z = 0.6; g.add(ring2);

    // Mouth frame (rounded tube)
    const r = 1.1, gw2 = goalW / 2;
    const path = new THREE.CurvePath<THREE.Vector3>();
    const pts: THREE.Vector3[] = [];
    pts.push(new THREE.Vector3(-gw2, 0, 0), new THREE.Vector3(-gw2, goalH - r, 0));
    for (let k = 0; k <= 8; k++) { const a = Math.PI - (k / 8) * Math.PI / 2; pts.push(new THREE.Vector3(-gw2 + r + r * Math.cos(a), goalH - r + r * Math.sin(a), 0)); }
    for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 - (k / 8) * Math.PI / 2; pts.push(new THREE.Vector3(gw2 - r + r * Math.cos(a), goalH - r + r * Math.sin(a), 0)); }
    pts.push(new THREE.Vector3(gw2, 0, 0));
    for (let k = 0; k < pts.length - 1; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
    const frame = new THREE.Mesh(new THREE.TubeGeometry(path, 120, 0.11, 8, false), glow);
    frame.position.z = zMouth - sgn * 0.02; g.add(frame);
    const frameOuter = new THREE.Mesh(new THREE.TubeGeometry(path, 120, 0.22, 8, false), metal);
    frameOuter.scale.set(1.04, 1.03, 1); frameOuter.position.z = zMouth + sgn * 0.12; g.add(frameOuter);

    // Gate structure behind the glass wall (trapezoid with glowing outline)
    const sh = new THREE.Shape();
    const ow = gw2 + 7, top = goalH + 3.2;
    sh.moveTo(-ow, 0); sh.lineTo(-gw2 - 2.2, top); sh.lineTo(gw2 + 2.2, top); sh.lineTo(ow, 0); sh.lineTo(gw2 + 0.6, 0);
    sh.lineTo(gw2 + 0.6, goalH + 0.6); sh.lineTo(-gw2 - 0.6, goalH + 0.6); sh.lineTo(-gw2 - 0.6, 0); sh.closePath();
    const gate = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 2 }), dark);
    gate.position.z = zMouth + sgn * 0.35; if (sgn < 0) { gate.rotation.y = Math.PI; } else gate.position.z -= 0; g.add(gate);
    const outline = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-ow, 0.1, 0), new THREE.Vector3(-gw2 - 2.2, top, 0), new THREE.Vector3(gw2 + 2.2, top, 0), new THREE.Vector3(ow, 0.1, 0),
    ], false, 'catmullrom', 0), 60, 0.12, 6), glow);
    outline.position.z = zMouth + sgn * 0.3; g.add(outline);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(8, 0.35, 0.3), glow);
    crown.position.set(0, top + 0.6, zMouth + sgn * 0.4); g.add(crown);

    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
    this.group.add(g);
  }

  private cuboid(hx_: number, hy: number, hz_: number, x: number, y: number, z: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx_, hy, hz_).setFriction(0.5).setCollisionGroups(groups(G_ARENA, 0xffff)), body);
  }

  private buildStadium(quality: Quality) {
    const stands = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.9, metalness: 0.1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3b4352, roughness: 0.5, metalness: 0.6 });
    // stepped profile in (d, y): d = distance outward from the wall
    const steps = 14, stepD = 1.6, stepH = 1.05, base = 6;
    const prof = new THREE.Shape();
    prof.moveTo(0, 0);
    prof.lineTo(0, base);
    for (let i = 0; i < steps; i++) { prof.lineTo(i * stepD + stepD, base + i * stepH); prof.lineTo(i * stepD + stepD, base + (i + 1) * stepH); }
    prof.lineTo(steps * stepD + 2, base + steps * stepH + 4); prof.lineTo(steps * stepD + 2, 0); prof.closePath();

    const crowdPos: THREE.Vector3[] = [];
    const placeSide = (len: number, x: number, z: number, rotY: number) => {
      const geo = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false });
      geo.translate(0, 0, -len / 2);
      const m = new THREE.Mesh(geo, concrete);
      m.position.set(x, 0, z); m.rotation.y = rotY;
      stands.add(m);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len), trim);
      rail.position.set(0.2, base + 0.2, 0); m.add(rail);
      m.updateMatrixWorld();
      for (let i = 0; i < steps; i++) {
        for (let s = -len / 2 + 0.5; s < len / 2 - 0.5; s += 0.62) {
          if (Math.random() < 0.18) continue;
          const v = new THREE.Vector3(i * stepD + stepD * 0.55 + (Math.random() - 0.5) * 0.3, base + i * stepH + 0.42, s + (Math.random() - 0.5) * 0.2);
          crowdPos.push(v.applyMatrix4(m.matrixWorld));
        }
      }
    };
    const off = 4;
    // rotY so that +x of the profile points away from the field
    placeSide(L - 26, hx + off, 0, 0);
    placeSide(L - 26, -hx - off, 0, Math.PI);
    placeSide(W - 46, 0, -hz - off - 10, Math.PI / 2);
    placeSide(W - 46, 0, hz + off + 10, -Math.PI / 2);
    // corner wedges
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ang = Math.atan2(sz, sx);
      placeSide(26, sx * 43, sz * 53, -ang);
    }
    this.group.add(stands);

    // Crowd: instanced little figures
    const list = crowdPos.sort(() => Math.random() - 0.5);
    const geo = new THREE.BoxGeometry(0.42, 0.75, 0.32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.crowdUniforms.uTime; sh.uniforms.uExcite = this.crowdUniforms.uExcite;
      sh.vertexShader = 'uniform float uTime; uniform float uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
        transformed.y += max(0.0, sin(uTime * (3.0 + uExcite * 6.0) + ph)) * (0.05 + uExcite * 0.35);
      `);
    };
    this.crowdMat = mat;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const palette = [TEAM_A, TEAM_B, 0xffffff, 0x223344, 0x884422, 0xdddd55, 0x335577, 0xaa3355];
    list.forEach((p, i) => {
      m4.makeRotationY(Math.random() * 6.28); m4.setPosition(p);
      inst.setMatrixAt(i, m4);
      col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.25 + Math.random() * 0.35);
      if (p.z > 15) col.lerp(new THREE.Color(TEAM_B).multiplyScalar(0.5), 0.35);
      if (p.z < -15) col.lerp(new THREE.Color(TEAM_A).multiplyScalar(0.5), 0.35);
      inst.setColorAt(i, col);
    });
    this.group.add(inst);
    this.crowd = inst; this.crowdTotal = list.length;
    this.setQuality(quality);

    // Roof ring structure
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1f29, metalness: 0.7, roughness: 0.45 });
    const ringR = { x: hx + 26, z: hz + 26 };
    const segs = 40;
    const beamTex = beamTexture();
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    lampMat.color.setScalar(3);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * ringR.x, z = Math.sin(a) * ringR.z;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 12), roofMat);
      seg.position.set(x, 30, z); seg.lookAt(0, 30, 0);
      this.group.add(seg);
      if (i % 2 === 0) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.4), lampMat);
        lamp.position.set(x * 0.9, 29.2, z * 0.9); lamp.lookAt(0, 0, 0); this.group.add(lamp);
      }
    }
    // Floodlight towers + light beams
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
      const x = sx * (hx + 30), z = sz * (hz + 22);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 44, 8), roofMat);
      tower.position.set(x, 22, z); this.group.add(tower);
      const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 0.8), lampMat);
      head.position.set(x, 44, z); head.lookAt(0, 0, 0); this.group.add(head);
    }
    // vertical light beams (like stage spots) around the arena
    const beamGeo = new THREE.CylinderGeometry(0.4, 3.2, 34, 16, 1, true);
    beamGeo.translate(0, -17, 0);
    for (let i = 0; i < 10; i++) {
      const sgn = i < 5 ? -1 : 1;
      const k = i % 5;
      const mat = new THREE.MeshBasicMaterial({ map: beamTex, color: i % 2 ? (sgn < 0 ? TEAM_A : TEAM_B) : 0xfff2dd, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.set(-30 + k * 15, 38, sgn * (hz + 14));
      beam.rotation.x = sgn * 0.35;
      this.beams.push(beam); this.group.add(beam);
    }
    // Big screens above the goals
    for (const sgn of [-1, 1] as const) {
      const accent = sgn < 0 ? TEAM_A : TEAM_B;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: screenTexture(['OVERBOOST', 'ENTRENAMIENTO LIBRE'], accent), toneMapped: false }));
      mesh.position.set(0, 27, sgn * (hz + 20)); mesh.lookAt(0, 20, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(23.5, 12.5, 1), roofMat);
      frame.position.copy(mesh.position).add(new THREE.Vector3(0, 0, sgn * 0.6)); frame.quaternion.copy(mesh.quaternion);
      this.group.add(frame, mesh);
      this.screens.push({ mesh, accent });
    }
    // Ground outside the arena
    const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 48), new THREE.MeshStandardMaterial({ color: 0x0c0f15, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; this.group.add(ground);
  }

  crowd!: THREE.InstancedMesh;
  private crowdTotal = 0;
  setQuality(q: Quality) {
    const density = { low: 0.25, medium: 0.5, high: 0.8, ultra: 1 }[q];
    if (this.crowd) this.crowd.count = Math.floor(this.crowdTotal * density);
  }

  setScreenText(a: string, b: string) {
    for (const s of this.screens) {
      const m = s.mesh.material as THREE.MeshBasicMaterial;
      m.map?.dispose(); m.map = screenTexture([a, b], s.accent); m.needsUpdate = true;
    }
  }

  private buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
        vec3 top = vec3(0.02,0.03,0.09); vec3 mid = vec3(0.08,0.10,0.25); vec3 hor = vec3(0.22,0.18,0.35);
        vec3 c = mix(hor, mid, smoothstep(0.0,0.25,h)); c = mix(c, top, smoothstep(0.25,0.9,h));
        gl_FragColor = vec4(c,1.0); }`,
    }));
    this.group.add(sky);
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9 + 0.1 - 0.1);
      const r = 380;
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 20, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe3ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8 }));
    this.group.add(this.stars);
  }

  update(t: number, excite: number) {
    this.crowdUniforms.uTime.value = t;
    this.crowdUniforms.uExcite.value = excite;
    this.beams.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.4 + i * 1.3) * 0.35; });
  }
}

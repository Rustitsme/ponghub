// 3D-игрок PongHub: модели парня и девушки (Hunyuan3D + Mixamo), форма из магазина, ракетка из «Моей ракетки», жесты.
// Перекраска формы — в шейдере по зонам роста; хват ракетки — настройки из редактора создателя (platform.grip).
import { BRANDS, colorOf, parseKey } from './shop-catalog.js';
import { buildRacket, loadThree } from './shop3d.js';

const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const ZONES = {
  boy: { shirt: [.505, .838], shorts: [.335, .52], shoe: .072, sock: .125, high: .24, sleeve: .118, sole: .016, file: 'models/boy.glb' },
  girl: { shirt: [.535, .848], shorts: [.40, .55], shoe: .068, sock: .12, high: .24, sleeve: .098, sole: .016, file: 'models/girl.glb' },
};
let TUNE_ON = false;
const BUF = {};
const script = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('3D не загрузилось — проверьте интернет')); document.head.appendChild(s); });
async function libs() {
  await loadThree();
  if (!THREE.GLTFLoader) await script('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
  if (!window.MeshoptDecoder) await script('https://cdn.jsdelivr.net/npm/meshoptimizer@0.18.1/meshopt_decoder.js');
}
async function fetchModel(key) {
  if (!BUF[key]) BUF[key] = fetch(ZONES[key].file).then(r => { if (!r.ok) throw new Error('Модель не загрузилась'); return r.arrayBuffer(); });
  return BUF[key];
}
let loader = null;
const parseGLB = buf => new Promise((ok, bad) => { if (!loader) { loader = new THREE.GLTFLoader(); loader.setMeshoptDecoder(window.MeshoptDecoder); } loader.parse(buf.slice(0), '', ok, bad); });

// перекраска одежды прямо в шейдере: зона по высоте + цвет исходной раскраски
function wearMaterial(map, z, bbox, axis, sideAxis) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: .78, metalness: 0, skinning: true });
  const U = m.userData.u = {
    uAxis: { value: axis }, uSide: { value: sideAxis }, uMin: { value: bbox.min.dot(axis) }, uLen: { value: bbox.max.dot(axis) - bbox.min.dot(axis) },
    uSideC: { value: bbox.getCenter(new THREE.Vector3()).dot(sideAxis) },
    uShirtR: { value: new THREE.Vector3(z.shirt[0], z.shirt[1], z.sleeve) }, uShortR: { value: new THREE.Vector2(...z.shorts) },
    uFeet: { value: new THREE.Vector4(z.shoe, z.sock, z.high, z.sole) },
    uSole: { value: lin('#eef0f3') },
    uShirt: { value: lin('#ffffff') }, uSleeve: { value: lin('#ffffff') }, uStripe: { value: lin('#ffffff') }, uStripeOn: { value: 0 },
    uShorts: { value: lin('#1b1c20') }, uShortsOn: { value: 0 }, uShirtOn: { value: 0 },
    uSock: { value: lin('#f4f6fa') }, uHigh: { value: 0 }, uSockOn: { value: 0 },
    uShoe: { value: lin('#ffffff') }, uShoeAcc: { value: lin('#1b1c20') }, uShoeOn: { value: 0 },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBind = position;');
    sh.fragmentShader = `varying vec3 vBind; uniform vec3 uAxis, uSide; uniform float uMin, uLen, uSideC; uniform vec3 uShirtR; uniform vec2 uShortR; uniform vec4 uFeet;
      uniform vec3 uShirt, uSleeve, uStripe, uShorts, uSock, uShoe, uShoeAcc, uSole; uniform float uStripeOn, uShortsOn, uShirtOn, uHigh, uSockOn, uShoeOn;\n` +
      sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c0 = diffuseColor.rgb;
        float h = (dot(vBind, uAxis) - uMin) / uLen;
        float sd = abs(dot(vBind, uSide) - uSideC) / uLen;
        float l = dot(c0, vec3(.2126, .7152, .0722));
        float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
        float sat = (mx - mn) / max(mx, 1e-4);
        float warm = (c0.r - c0.b) / max(l, .04);
        float white = smoothstep(.16, .30, l) * (1. - smoothstep(.20, .34, warm)) * (1. - smoothstep(.22, .40, sat));
        float dark = (1. - smoothstep(.03, .075, l)) * (1. - smoothstep(.40, .65, sat));
        float shade = clamp(l / .70, .35, 1.25);
        // футболка: тело / рукава / полоса на груди
        float inShirt = step(uShirtR.x, h) * step(h, uShirtR.y);
        float sleeve = smoothstep(uShirtR.z - .006, uShirtR.z + .006, sd);
        vec3 sc = mix(uShirt, uSleeve, sleeve);
        sc = mix(sc, uStripe, uStripeOn * (1. - sleeve) * (1. - smoothstep(.006, .009, abs(h - (uShirtR.y - .085)))));
        // ткань футболки: всё нетелесное в зоне футболки, включая затенённые складки и подмышки
        float cloth = (1. - smoothstep(.18, .32, warm)) * smoothstep(.035, .09, l) * (1. - smoothstep(.28, .48, sat));
        diffuseColor.rgb = mix(diffuseColor.rgb, sc * clamp(l / .70, .22, 1.25), cloth * inShirt * uShirtOn);
        // шорты (исходно чёрные): берём складки из яркости
        float inShorts = step(uShortR.x, h) * step(h, uShortR.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShorts * clamp(.55 + l * 9., .5, 1.3), dark * inShorts * uShortsOn);
        // носки (белые); высокие — поверх кожи до середины голени
        float inSock = step(uFeet.x, h) * step(h, uFeet.y);
        float inHigh = step(uFeet.x, h) * step(h, mix(uFeet.y, uFeet.z, uHigh)) * uHigh;
        float sockM = max(white * inSock, inHigh * (1. - smoothstep(uFeet.z - .004, uFeet.z, h)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uSock * mix(shade, .92, inHigh * (1. - white)), sockM * uSockOn);
        if (uHigh > .5) diffuseColor.rgb = mix(diffuseColor.rgb, uSock * .75, uSockOn * step(abs(h - uFeet.z + .006), .004));
        // кроссовки: белое — основной цвет, тёмные полосы — акцент
        float inShoe = step(h, uFeet.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShoe * shade, white * inShoe * uShoeOn);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShoeAcc * clamp(.6 + l * 6., .5, 1.2), dark * inShoe * uShoeOn);
        // подошва — отдельной полосой, чтобы её было видно у любых кроссовок
        float sole = step(h, uFeet.w) * uShoeOn;
        diffuseColor.rgb = mix(diffuseColor.rgb, uSole * clamp(l / .55, .7, 1.1), sole);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSole * .55, uShoeOn * (1. - smoothstep(.0015, .004, abs(h - uFeet.w))));
      }`);
  };
  return m;
}


// кольцо, которое облегает модель вокруг кости (повязка, напульсник): точки кожи → радиус по углам
function hugRing(mesh, boneName, t0, t1, inflate, color) {
  const sk = mesh.skeleton, bi = sk.bones.findIndex(b => b.name.endsWith(boneName));
  if (bi < 0) return null;
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const v = new THREE.Vector3(), pts = [];
  for (let i = 0; i < pos.count; i++) {
    let w = 0; const ix = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], wx = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]; for (let k = 0; k < 4; k++) if (ix[k] === bi) w += wx[k];
    if (w < .45) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(sk.boneInverses[bi]);
    pts.push(v.clone());
  }
  if (pts.length < 20) return null;
  let y0 = Infinity, y1 = -Infinity; for (const p of pts) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const a = y0 + (y1 - y0) * t0, b = y0 + (y1 - y0) * t1;
  const sl = pts.filter(p => p.y >= a && p.y <= b);
  const cx = sl.reduce((s, p) => s + p.x, 0) / sl.length, cz = sl.reduce((s, p) => s + p.z, 0) / sl.length;
  const N = 48, rad = new Array(N).fill(0);
  for (const p of sl) { const ang = Math.atan2(p.z - cz, p.x - cx), k = ((Math.round(ang / (Math.PI * 2) * N) % N) + N) % N, r = Math.hypot(p.x - cx, p.z - cz); rad[k] = Math.max(rad[k], r); }
  const avg = rad.reduce((s, r) => s + r, 0) / N;
  for (let k = 0; k < N; k++) if (!rad[k]) rad[k] = avg;
  const sm = rad.map((r, k) => (rad[(k + N - 1) % N] + 2 * r + rad[(k + 1) % N]) / 4);
  // кольцо с толщиной: внешняя стенка, внутренняя, торцы
  const H = b - a, th = avg * .06, geo = new THREE.BufferGeometry(), P = [], I = [];
  const ring = (rr, yy) => { const base = P.length / 3; for (let k = 0; k <= N; k++) { const ang = k / N * Math.PI * 2, r = sm[k % N] * inflate + rr; P.push(cx + Math.cos(ang) * r, yy, cz + Math.sin(ang) * r); } return base; };
  const o0 = ring(th, a), o1 = ring(th, b), i0 = ring(0, a), i1 = ring(0, b);
  const quad = (r0, r1, flip) => { for (let k = 0; k < N; k++) { const p = [r0 + k, r0 + k + 1, r1 + k + 1, r1 + k]; flip ? I.push(p[0], p[2], p[1], p[0], p[3], p[2]) : I.push(p[0], p[1], p[2], p[0], p[2], p[3]); } };
  quad(o0, o1, true); quad(i0, i1, false); quad(i1, o1, true); quad(i0, o0, false);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setIndex(I); geo.computeVertexNormals();
  const ringMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide }));
  ringMesh.userData.h = H;
  return { mesh: ringMesh, bone: sk.bones[bi] };
}


// игрок: модель + анимации + форма + ракетка
async function makePlayer(key) {
  const gltf = await parseGLB(await fetchModel(key));
  const scene = gltf.scene, z = ZONES[key];
  let mesh = null; scene.traverse(n => { if (n.isSkinnedMesh && !mesh) mesh = n; });
  const bones = {}; mesh.skeleton.bones.forEach(b => bones[b.name.replace(/^mixamorig:?/, '')] = b);
  // ось роста и ширины по геометрии в позе привязки
  const g = mesh.geometry; g.computeBoundingBox(); const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3());
  const axis = sz.y >= sz.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const map = mesh.material.map; if (map) { map.encoding = THREE.sRGBEncoding; map.anisotropy = 8; }
  mesh.material = wearMaterial(map, z, bb, axis, new THREE.Vector3(1, 0, 0));
  mesh.frustumCulled = false; mesh.castShadow = false;
  // масштаб: рост 1.75 м, ноги на полу
  const holder = new THREE.Group(); holder.add(scene);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), k = 1.75 / (box.max.y - box.min.y);
  scene.scale.multiplyScalar(k); scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene); scene.position.y -= box2.min.y; scene.position.x -= (box2.min.x + box2.max.x) / 2; scene.position.z -= (box2.min.z + box2.max.z) / 2;
  const mixer = new THREE.AnimationMixer(scene), clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  const fbase = {}; for (const n in bones) if (/^(Right|Left)Hand/.test(n)) fbase[n] = bones[n].quaternion.clone();
  const P = { key, holder, scene, mesh, bones, mixer, clips, cur: null, z, acc: {}, fbase };
  P.play = (name, once) => {
    if (name === 'idle' && clips.ready && window.USE_READY) name = 'ready';
    const c = clips[name]; if (!c) return;
    const a = mixer.clipAction(c); a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = !!once;
    if (P.cur && P.cur !== a) a.crossFadeFrom(P.cur, .35, false); a.play(); P.cur = a; P.curName = name;
    if (P.rk) P.rk.visible = name !== 'clap' && name !== 'wave';
  };
  clips.swing = buildSwing(P);
  clips.ready = buildReady(P);
  mixer.addEventListener('finished', e => { if (e.action === P.cur && P.curName !== 'idle' && P.curName !== 'ready') { P.play('idle'); } });
  P.play('idle');
  // ступни на полу именно в стойке (анимация чуть опускает тело относительно исходной позы)
  {
    const toes = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'].map(n => bones[n]).filter(Boolean), v = new THREE.Vector3();
    const low = () => { holder.updateMatrixWorld(true); return Math.min(...toes.map(b => b.getWorldPosition(v).y)); };
    const a0 = mixer.clipAction(clips.idle); mixer.stopAllAction();
    const bind = low();
    a0.reset().play(); mixer.update(0); const idle = low();
    scene.position.y += bind - idle;
    P.cur = null; P.play('idle');
  }
  // аксессуары, облегающие модель
  const hb = hugRing(mesh, 'Head', .63, .73, 1.03, '#d62839');
  if (hb) { hb.bone.add(hb.mesh); P.acc.head = hb.mesh; hb.mesh.visible = false; }
  for (const s of ['Left', 'Right']) {
    const wb = hugRing(mesh, s + 'ForeArm', .70, .90, 1.07, '#1f5fc4');
    if (wb) { wb.bone.add(wb.mesh); P.acc['band' + s] = wb.mesh; wb.mesh.visible = false; }
  }
  return P;
}


// удар справа (топспин): строим ключевые кадры в мировых направлениях — замах, удар, проводка, возврат
// направления в системе игрока: x — его левая рука, y — вверх, z — вперёд
const SWING_KEYS = [
  { t: 0, tw: 0, ua: [-.3, -.9, .35], fa: [-.25, -.05, 1], roll: -1.25 },
  { t: .45, tw: -.75, ua: [-.75, -.55, -.35], fa: [-.75, -.55, .1], roll: -.7 },
  { t: .68, tw: -.1, ua: [-.6, -.5, .5], fa: [-.7, .15, .7], roll: -1.2 },
  { t: .84, tw: .55, ua: [.05, .35, .95], fa: [.75, .65, .15], roll: -1.4 },
  { t: 1.3, tw: .2, ua: [-.2, -.5, .8], fa: [.2, .3, 1], roll: -1.3 },
  { t: 1.8, tw: 0, ua: [-.3, -.9, .35], fa: [-.25, -.05, 1], roll: -1.25 },
];
// стойка с ракеткой: как idle, но правая рука согнута и держит ракетку перед собой
const READY = window.READYK || { ua: [-.3, -.9, .35], fa: [-.25, -.05, 1], roll: -1.25 };
function buildReady(P) {
  const b = P.bones, idle = P.clips.idle, names = ['RightArm', 'RightForeArm'];
  const a = P.mixer.clipAction(idle); P.mixer.stopAllAction(); a.reset().play(); P.mixer.update(0);
  const base = {}; names.forEach(n => base[n] = b[n].quaternion.clone());
  P.holder.updateMatrixWorld(true);
  const R = window.READYK || READY;
  poseArm(b, R);
  const vals = names.map(n => b[n].quaternion.toArray());
  names.forEach(n => b[n].quaternion.copy(base[n]));
  const keepTr = idle.tracks.filter(t => !names.some(n => t.name === b[n].name + '.quaternion'));
  const fixed = names.map((n, i) => new THREE.QuaternionKeyframeTrack(b[n].name + '.quaternion', [0, idle.duration], [...vals[i], ...vals[i]]));
  return new THREE.AnimationClip('ready', idle.duration, keepTr.concat(fixed));
}
// поставить плечо/предплечье в мировые направления + развернуть предплечье
function poseArm(b, k) {
  const pq = new THREE.Quaternion(), wq = new THREE.Quaternion(), dq = new THREE.Quaternion(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  const setWorld = (bone, fn) => { bone.parent.getWorldQuaternion(pq); wq.copy(pq).multiply(bone.quaternion); fn(wq); bone.quaternion.copy(pq.invert().multiply(wq)); bone.updateMatrixWorld(true); };
  const aim = (bone, child, dir) => { bone.getWorldPosition(p0); child.getWorldPosition(p1); const cur = p1.sub(p0).normalize(), d = new THREE.Vector3(...dir).normalize(); setWorld(bone, q => q.premultiply(dq.setFromUnitVectors(cur, d))); };
  aim(b.RightArm, b.RightForeArm, k.ua); aim(b.RightForeArm, b.RightHand, k.fa);
  if (k.roll) { b.RightForeArm.getWorldPosition(p0); b.RightHand.getWorldPosition(p1); const ax = p1.sub(p0).normalize(); setWorld(b.RightForeArm, q => q.premultiply(dq.setFromAxisAngle(ax, k.roll))); }
}
function buildSwing(P) {
  const b = P.bones, names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'RightArm', 'RightForeArm', 'RightHand'].filter(n => b[n]);
  const a = P.mixer.clipAction(P.clips.idle); P.mixer.stopAllAction(); a.reset().play(); P.mixer.update(0);
  const base = {}; names.forEach(n => base[n] = b[n].quaternion.clone());
  const Y = new THREE.Vector3(0, 1, 0), pq = new THREE.Quaternion(), wq = new THREE.Quaternion(), dq = new THREE.Quaternion(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  const setWorld = (bone, fn) => { bone.parent.getWorldQuaternion(pq); wq.copy(pq).multiply(bone.quaternion); fn(wq); bone.quaternion.copy(pq.invert().multiply(wq)); bone.updateMatrixWorld(true); };
  const twist = (bone, th) => bone && setWorld(bone, q => q.premultiply(dq.setFromAxisAngle(Y, th)));
  const aim = (bone, child, dir) => { bone.getWorldPosition(p0); child.getWorldPosition(p1); const cur = p1.sub(p0).normalize(), d = new THREE.Vector3(...dir).normalize(); setWorld(bone, q => q.premultiply(dq.setFromUnitVectors(cur, d))); };
  const vals = {}; names.forEach(n => vals[n] = []);
  const KEYS = window.SWINGK || SWING_KEYS;
  for (const k of KEYS) {
    names.forEach(n => b[n].quaternion.copy(base[n])); P.holder.updateMatrixWorld(true);
    twist(b.Hips, k.tw * .35); twist(b.Spine, k.tw * .25); twist(b.Spine1, k.tw * .2); twist(b.Spine2, k.tw * .2);
    aim(b.RightArm, b.RightForeArm, k.ua); aim(b.RightForeArm, b.RightHand, k.fa);
    // поворот предплечья вокруг своей оси (ракетка разворачивается лицом к мячу) и сгиб кисти
    if (k.roll) { b.RightForeArm.getWorldPosition(p0); b.RightHand.getWorldPosition(p1); const ax = p1.sub(p0).normalize(); setWorld(b.RightForeArm, q => q.premultiply(dq.setFromAxisAngle(ax, k.roll))); }
    names.forEach(n => vals[n].push(...b[n].quaternion.toArray()));
  }
  names.forEach(n => b[n].quaternion.copy(base[n]));
  const T = KEYS.map(k => k.t);
  return new THREE.AnimationClip('swing', T[T.length - 1], names.map(n => new THREE.QuaternionKeyframeTrack(b[n].name + '.quaternion', T, vals[n])));
}


// ───────────── Ракетка ─────────────
// пальцы сгибаются вокруг оси X своих костей (вокруг Z они уходили вбок); кулак чуть приоткрыт под толщину ручки
const GRIP = { Index1: [.75, 0, .25], Index2: [.95, 0, .15], Index3: [.65, 0, .08], Thumb1: [.45, 0, 0], Thumb2: [.45, 0, 0] };
// хват подобран Рустамом в редакторе (17.10)
export const RK = { tilt: 2.62, spin: -1.74, pitch: -0.78, roll: -0.11, slide: 5.9, sx: 0, sz: 0, grip: -5.8, side: -0.2, ox: 0, oz: -0.8, curl: .75, thumb: 1, fside: -0.66, tside: -0.46, wx: -0.2, wz: 0.06, ...(window.RKFIT || {}) };
function attachRacket(P, cfg) {
  if (P.rk) { P.rk.parent && P.rk.parent.remove(P.rk); P.rk = null; }
  const B = P.bones, hand = B.RightHand, idx = B.RightHandIndex1, th = B.RightHandThumb1; if (!hand || !idx || !th) return;
  const G = window.GRIP || GRIP, v = new THREE.Vector3(), q = new THREE.Quaternion();
  // 1) сжимаем кулак (как в игре) и берём реальные точки: костяшки, кончик пальца, ладонь
  const names = Object.keys(P.fbase).filter(n => n.startsWith('RightHand') && n !== 'RightHand'), keep = names.map(n => B[n].quaternion.clone());
  names.forEach(n => { B[n].quaternion.copy(P.fbase[n]); const g = gripOf(n.slice(9), G); if (g) B[n].quaternion.multiply(q.setFromEuler(new THREE.Euler(...g))); });
  hand.updateWorldMatrix(true, true);
  const inv = hand.matrixWorld.clone().invert(), loc = b => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const knuckle = idx.position.clone(), tip = loc(B.RightHandIndex4 || B.RightHandIndex3), mid = loc(B.RightHandIndex2 || idx);
  // ось ручки — та, вокруг которой сгибаются пальцы (линия костяшек), к большому пальцу
  let axis = new THREE.Vector3(1, 0, 0).applyQuaternion(P.fbase.RightHandIndex1).normalize();
  if (axis.dot(th.position) > 0) axis.negate(); // голова ракетки выходит со стороны большого и указательного пальцев
  names.forEach((n, i) => B[n].quaternion.copy(keep[i])); hand.updateWorldMatrix(true, true);
  // 2) центр кулака: между ладонью у костяшек, серединой пальца и согнутым кончиком
  const palm = knuckle.clone().multiplyScalar(.62);
  const C = palm.add(mid).add(tip).multiplyScalar(1 / 3);
  const cmU = knuckle.length() / 9.5;
  C.add(axis.clone().multiplyScalar(RK.side * cmU));
  // 3) плоскость ракетки параллельна ладони: нормаль — от ладони к пальцам в сжатом кулаке
  const f = knuckle.clone().normalize();
  const Y = axis.clone().multiplyScalar(Math.cos(RK.tilt)).add(f.clone().multiplyScalar(Math.sin(RK.tilt))).normalize();
  let n = tip.clone().sub(knuckle.clone().multiplyScalar(.62)); n.sub(Y.clone().multiplyScalar(n.dot(Y))).normalize();
  const X = new THREE.Vector3().crossVectors(Y, n).normalize(), Z = new THREE.Vector3().crossVectors(X, Y);
  const r = new THREE.Group(); r.add(buildRacket({ ...cfg }, .5));
  r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  r.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(RK.pitch, RK.spin, RK.roll || 0)));
  r.scale.setScalar(cmU);
  // середина ручки (−7.6 см от центра головы) — в центре кулака, со сдвигом к голове
  r.position.copy(C).add(Y.clone().multiplyScalar((7.6 + RK.grip) * cmU));
  r.position.add(X.clone().multiplyScalar(RK.ox * cmU)).add(Z.clone().multiplyScalar(RK.oz * cmU));
  // сдвиг по осям самой ракетки (после всех поворотов): вдоль ручки, вбок, по нормали к накладке
  r.position.add(new THREE.Vector3(RK.sx || 0, RK.slide || 0, RK.sz || 0).applyQuaternion(r.quaternion).multiplyScalar(cmU));
  r.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => { m.toneMapped = false; }); });
  if (window.RKDBG) { const m = new THREE.Mesh(new THREE.SphereGeometry(.6 * cmU, 12, 8), new THREE.MeshBasicMaterial({ color: '#00ff00', depthTest: false })); m.position.copy(C); m.renderOrder = 9; hand.add(m); }
  hand.add(r); P.rk = r; r.visible = P.curName !== 'clap' && P.curName !== 'wave';
}
// перед обновлением анимации пальцы возвращаются в исходное положение — поворот не накапливается
function gripOf(n, F) {
  const g = F[n]; if (!g) return null; const th = n.startsWith('Thumb'), k = th ? RK.thumb : RK.curl;
  const w = { Index1: 1, Index2: .5, Index3: .3, Thumb1: 1, Thumb2: .5 }[n] || 0;
  return [g[0] * k, g[1] * k + (th ? RK.tside * w : 0), g[2] * k + (th ? 0 : RK.fside * w)];
}
function resetFingers(P) { for (const n in P.fbase) P.bones[n].quaternion.copy(P.fbase[n]); }
function gripFingers(P) {
  if (!P.rk || !P.rk.visible) return;
  const b = P.bones, F = window.GRIP || GRIP;
  for (const n in F) { const bn = b['RightHand' + n], g = gripOf(n, F); if (bn && g) bn.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...g))); }
  if (RK.wx || RK.wz) b.RightHand.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(RK.wx, 0, RK.wz)));
}
function stepPlayer(P, dt) { resetFingers(P); if (TUNE_ON && P.cur && (P.curName === 'idle' || P.curName === 'ready')) { P.cur.time = 0; dt = 0; } P.mixer.update(dt); gripFingers(P); }


// ───────────── Форма и ракетка на игроке ─────────────
const hexOf = key => { const { it, color } = parseKey(key); return (it && colorOf(it, color)?.hex) || '#ffffff'; };
function applyLook(P, lo) {
  const U = P.mesh.material.userData.u;
  const shirt = lo.shirt || 'wr-t1:white', shorts = lo.shorts || 'wr-s1:black', shoes = lo.shoes || 'wr-f1:wb';
  const sh = parseKey(shirt), sf = parseKey(shoes);
  if (sh.it) {
    const shHex = hexOf(shirt), brand = BRANDS[sh.it.bk]?.color || shHex, pro = ['wr-t3', 'wr-t4', 'wr-t6', 'wr-t7'].includes(sh.it.id), isWhite = sh.color === 'white';
    U.uShirtOn.value = 1; U.uShirt.value = lin(shHex);
    U.uSleeve.value = lin(pro ? (isWhite ? brand : (sh.it.id === 'wr-t7' ? '#ffcc00' : '#ffffff')) : shHex);
    U.uStripe.value = lin(sh.it.id === 'wr-t7' ? '#ffcc00' : isWhite ? brand : '#ffffff'); U.uStripeOn.value = pro ? 1 : 0;
  }
  U.uShortsOn.value = 1; U.uShorts.value = lin(hexOf(shorts));
  if (sf.it) {
    const fHex = hexOf(shoes), wbase = /^w/.test(sf.color), acc = fHex.toLowerCase() === '#f4f6fa' ? (BRANDS[sf.it.bk]?.color || '#1b1c20') : fHex;
    U.uSole.value = lin(wbase ? '#e9ecf1' : '#f2f2f2');
    U.uShoeOn.value = 1; U.uShoe.value = lin(wbase ? '#f6f7fa' : fHex); U.uShoeAcc.value = lin(wbase ? acc : '#f6f7fa');
  }
  const sk = parseKey(lo.socks || ''), wr = parseKey(lo.wrist || ''), hd = parseKey(lo.head || '');
  U.uSockOn.value = 1; U.uSock.value = lin(sk.it ? hexOf(lo.socks) : '#f4f6fa'); U.uHigh.value = sk.it?.high ? 1 : 0;
  // напульсники и повязка — кольца по форме руки и головы
  for (const [m, it, key] of [[P.acc.bandLeft, wr.it, lo.wrist], [P.acc.bandRight, wr.it, lo.wrist], [P.acc.head, hd.it, lo.head]]) {
    if (!m) continue; m.visible = !!it; if (it) m.material.color.set(hexOf(key)).convertSRGBToLinear();
  }
  const rcfg = { blade: lo.blade || 'cn-b1:FL', fh: lo.fh, bh: lo.bh, grip: lo.grip, tape: lo.tape }, rk = JSON.stringify(rcfg) + JSON.stringify(RK);
  if (P.rkId !== rk) { attachRacket(P, rcfg); P.rkId = rk; }
}

// ───────────── Просмотр: один на экран ─────────────
let V = null;
const headY = P => { const v = new THREE.Vector3(); (P.bones.Head || P.scene).getWorldPosition(v); return v.y + .08; };
export async function mountAvatar(el, opts = {}) {
  await libs();
  if (!V) {
    const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.setPixelRatio(Math.min(2, devicePixelRatio));
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(24, 1, .05, 50);
    scene.add(new THREE.HemisphereLight('#ffffff', '#9aa8c4', .7));
    const key = new THREE.DirectionalLight('#ffffff', 1.2); key.position.set(2.5, 4, 4); scene.add(key);
    const rim = new THREE.DirectionalLight('#cfe0ff', .7); rim.position.set(-3, 3, -3); scene.add(rim);
    const fill = new THREE.DirectionalLight('#ffe8d6', .35); fill.position.set(-3, 1.5, 3); scene.add(fill);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(.62, .66, .06, 64), new THREE.MeshStandardMaterial({ color: '#2a64b8', roughness: .6 })); pod.position.y = -.031; scene.add(pod);
    const line = new THREE.Mesh(new THREE.TorusGeometry(.57, .006, 6, 96), new THREE.MeshBasicMaterial({ color: '#ffffff' })); line.rotation.x = Math.PI / 2; line.position.y = .001; scene.add(line);
    V = { R, scene, cam, P: {}, cur: null, ry: .35, target: .35, zoom: 1, tz: 1, fy: .84, tfy: .84, drag: false, idle: 0, tune: { dist: .85, dy: .1, full: false }, clock: new THREE.Clock() };
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(.05, V.clock.getDelta());
      if (!V.cur || !V.R.domElement.isConnected) return;
      stepPlayer(V.cur, dt);
      if (!TUNE_ON && !V.drag && performance.now() - V.idle > 3000) V.target += .0035;
      V.ry += (V.target - V.ry) * .1; V.zoom += (V.tz - V.zoom) * .1; V.fy += (V.tfy - V.fy) * .1;
      V.cur.holder.rotation.y = V.ry;
      const d = 5.1 / V.zoom; V.cam.position.set(0, V.fy + .22 / V.zoom, d); V.cam.lookAt(0, V.fy, 0);
      if (TUNE_ON && !V.tune.full) { const hp = V.cur.bones.RightHand.getWorldPosition(new THREE.Vector3()); V.cam.position.set(hp.x, hp.y + .02, hp.z + V.tune.dist); V.cam.lookAt(hp.x, hp.y - V.tune.dy, hp.z); }
      V.R.render(V.scene, V.cam);
    };
    loop();
  }
  TUNE_ON = !!opts.tune;
  if (opts.grip) Object.assign(RK, opts.grip);
  const w = el.clientWidth, h = el.clientHeight; V.R.setSize(w, h, false); V.cam.aspect = w / h; V.cam.updateProjectionMatrix();
  el.prepend(V.R.domElement);
  const gender = opts.gender === 'girl' ? 'girl' : 'boy';
  if (!V.P[gender]) V.P[gender] = await makePlayer(gender);
  if (V.cur && V.cur !== V.P[gender]) V.scene.remove(V.cur.holder);
  V.cur = V.P[gender]; V.scene.add(V.cur.holder); V.cur.rkId = null;
  applyLook(V.cur, opts.loadout || {});
  V.tz = 1; V.tfy = .84; if (TUNE_ON) { V.idle = Infinity; V.target = V.ry = -0.6; }
  let last = null;
  el.onpointerdown = e => { if (e.target.closest('button,input,a')) return; V.drag = true; last = e.clientX; el.setPointerCapture(e.pointerId); };
  el.onpointermove = e => { if (!V.drag) return; V.target += (e.clientX - last) * .012; last = e.clientX; V.idle = performance.now(); };
  el.onpointerup = el.onpointercancel = () => { V.drag = false; V.idle = performance.now(); };
  el.onwheel = TUNE_ON ? e => { e.preventDefault(); V.tune.dist = Math.max(.25, Math.min(1.6, V.tune.dist * (e.deltaY < 0 ? .92 : 1.08))); } : null;
  const P = V.cur;
  return {
    play: name => { P.play(name, true); if (name === 'win') { V.tz = .8; V.tfy = 1; } V.target = Math.round(V.target / (Math.PI * 2)) * Math.PI * 2 + (name === 'swing' ? .9 : .25); V.idle = performance.now(); },
    face: () => { V.tz = 3.1; V.tfy = headY(P) - .04; },
    full: () => { V.tz = 1; V.tfy = .84; },
    flip: () => { V.target += Math.PI; V.idle = performance.now(); },
    resize: () => { const w2 = el.clientWidth, h2 = el.clientHeight; V.R.setSize(w2, h2, false); V.cam.aspect = w2 / h2; V.cam.updateProjectionMatrix(); },
    look: lo => applyLook(P, lo || {}),
    regrip: () => { P.rkId = null; applyLook(P, opts.loadout || {}); },
    tuneFull: on => { V.tune.full = on; },
    tuneDist: d => { V.tune.dist = d; },
  };
}

// ───────────── Табло: выход игроков перед матчем и жест победителя ─────────────
// opts.A / opts.B / opts.W: { gender, loadout, nick, rating, league:{name, cls}, racket }
const tvCss = `.p3-ov{position:absolute;inset:0;z-index:50;overflow:hidden;background:radial-gradient(90% 80% at 50% 10%,#1b3d73 0%,#0b1a33 55%,#050b17 100%);color:#fff;opacity:0;transition:opacity .6s}
.p3-ov.on{opacity:1}.p3-ov canvas{position:absolute;inset:0;width:100%;height:100%}
.p3-names{position:absolute;inset:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 5%;font:800 clamp(28px,6.5vw,110px)/1 "Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;transition:opacity .5s}
.p3-names .a{color:#ff6b75;transform:translateX(-120%);transition:transform .7s cubic-bezier(.2,.9,.2,1);text-shadow:0 6px 30px rgba(230,57,70,.6)}
.p3-names .b{color:#6fb0ff;text-align:right;transform:translateX(120%);transition:transform .7s cubic-bezier(.2,.9,.2,1);text-shadow:0 6px 30px rgba(47,125,225,.6)}
.p3-names .vs{font-size:.6em;color:#ffd75e;opacity:0;transform:scale(2.4);transition:all .5s .45s}
.p3-names.in .a,.p3-names.in .b{transform:none}.p3-names.in .vs{opacity:1;transform:none}
.p3-card{position:absolute;top:22%;width:30%;padding:1.6% 2%;border-radius:1vw;background:rgba(8,18,38,.8);border:1px solid rgba(255,255,255,.15);opacity:0;transition:opacity .45s,transform .45s;font-size:clamp(12px,1.5vw,26px)}
.p3-card.l{left:6%;transform:translateX(-20px);border-left:5px solid #e63946}.p3-card.r{right:6%;transform:translateX(20px);border-right:5px solid #2f7de1;text-align:right}
.p3-card.on{opacity:1;transform:none}.p3-card b{display:block;font:800 2.2em/1 "Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase}
.p3-card .lg{display:inline-block;margin:.5em 0 .3em;padding:.15em .7em;border-radius:999px;background:rgba(255,255,255,.14);font-weight:800}
.p3-card .rk{opacity:.85;margin-top:.3em}
.p3-logo{position:absolute;left:3%;top:4%;font:800 clamp(14px,1.8vw,30px) "Barlow Condensed",sans-serif;letter-spacing:.08em;opacity:.85}
.p3-win{position:absolute;left:0;right:0;bottom:9%;text-align:center;opacity:0;transform:translateY(20px);transition:all .6s}
.p3-win.on{opacity:1;transform:none}.p3-win b{display:block;font:800 clamp(30px,6vw,100px)/1 "Barlow Condensed",sans-serif;text-transform:uppercase;color:#ffd75e;text-shadow:0 8px 40px rgba(255,200,60,.5)}
.p3-win span{font:700 clamp(14px,2vw,34px) "Barlow Condensed",sans-serif;opacity:.9}`;
const lerp3 = (a, b, t) => a.clone().lerp(b, t);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function tvScene(root) {
  await libs();
  if (!document.getElementById('p3-css')) { const st = document.createElement('style'); st.id = 'p3-css'; st.textContent = tvCss; document.head.appendChild(st); }
  const ov = document.createElement('div'); ov.className = 'p3-ov'; root.appendChild(ov);
  const R = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.setPixelRatio(Math.min(2, devicePixelRatio));
  ov.appendChild(R.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 16 / 9, .05, 60);
  scene.add(new THREE.HemisphereLight('#ffffff', '#9aa8c4', .55));
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(2.5, 4, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.4); rim.position.set(-3, 3, -3); scene.add(rim);
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const g = x.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, 'rgba(60,110,200,.55)'); g.addColorStop(.45, 'rgba(25,60,130,.35)'); g.addColorStop(1, 'rgba(10,25,60,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const ft = new THREE.CanvasTexture(c); ft.encoding = THREE.sRGBEncoding;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.5), new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false, toneMapped: false })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const ring = (xx, col) => { const m = new THREE.Mesh(new THREE.RingGeometry(.55, .6, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9 })); m.rotation.x = -Math.PI / 2; m.position.set(xx, .003, 0); scene.add(m); return m; };
  const size = () => { const w = ov.clientWidth || root.clientWidth, h = ov.clientHeight || root.clientHeight; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  size();
  const S = { R, scene, cam, ov, ring, size, frame: null, run: true, players: [] };
  const clock = new THREE.Clock();
  const loop = () => { if (!S.run) return; requestAnimationFrame(loop); const dt = Math.min(.05, clock.getDelta()); S.players.forEach(p => stepPlayer(p, dt)); S.frame && S.frame(dt); R.render(scene, cam); };
  loop();
  S.end = async () => { ov.classList.remove('on'); await wait(650); S.run = false; R.dispose(); ov.remove(); };
  return S;
}
async function tvPlayer(S, info) {
  const P = await makePlayer(info.gender === 'girl' ? 'girl' : 'boy');
  applyLook(P, info.loadout || {}); S.scene.add(P.holder); S.players.push(P); return P;
}
const cardHtml = (who, side) => `<div class="p3-card ${side}"><b>${who.nick}</b><span class="lg">${who.league ? who.league.name + ' · ' : ''}${who.rating ?? ''}</span>${who.racket ? `<div class="rk">🏓 ${who.racket}</div>` : ''}</div>`;
const safe = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export async function tvIntro(root, { A, B, grip }) {
  if (grip) Object.assign(RK, grip);
  const S = await tvScene(root);
  const a = { ...A, nick: safe(A.nick), racket: safe(A.racket) }, b = { ...B, nick: safe(B.nick), racket: safe(B.racket) };
  S.ov.insertAdjacentHTML('beforeend', `<div class="p3-logo">PONGHUB · МАТЧ</div><div class="p3-names"><div class="a">${a.nick}</div><div class="vs">VS</div><div class="b">${b.nick}</div></div>${cardHtml(a, 'l')}${cardHtml(b, 'r')}`);
  const [PA, PB] = await Promise.all([tvPlayer(S, A), tvPlayer(S, B)]);
  S.ring(-1.05, '#e63946'); S.ring(1.05, '#2f7de1');
  const XA = -1.05, XB = 1.05, START = 3.6;
  PA.holder.position.x = -START; PB.holder.position.x = START; PA.holder.rotation.y = Math.PI / 2; PB.holder.rotation.y = -Math.PI / 2;
  PA.holder.visible = PB.holder.visible = false;
  const names = S.ov.querySelector('.p3-names'), cA = S.ov.querySelector('.p3-card.l'), cB = S.ov.querySelector('.p3-card.r');
  const hy = P => { const v = new THREE.Vector3(); (P.bones.Head || P.scene).getWorldPosition(v); return v.y + .08; };
  let t = 0;
  const W = { pos: new THREE.Vector3(0, 1.05, 6.6), look: new THREE.Vector3(0, .95, 0) };
  const walk = (P, x0, x1, t0, dur, face) => {
    const k = ease((t - t0) / dur); if (t < t0) return; P.holder.visible = true;
    P.holder.position.x = x0 + (x1 - x0) * Math.min(1, (t - t0) / dur);
    if (t - t0 >= dur) { const kk = ease((t - t0 - dur) / .5); P.holder.rotation.y = (x0 < 0 ? Math.PI / 2 : -Math.PI / 2) * (1 - kk) + face * kk; if (P.curName === 'walk') P.play('idle'); }
    else if (P.curName !== 'walk') P.play('walk');
    void k;
  };
  S.frame = dt => {
    t += dt;
    walk(PA, -START, XA, 1.5, 2.3, .25); walk(PB, START, XB, 1.8, 2.3, -.25);
    const fA = { pos: new THREE.Vector3(XA - .25, hy(PA) + .02, 1.95), look: new THREE.Vector3(XA - .57, hy(PA) - .05, 0) };
    const fB = { pos: new THREE.Vector3(XB + .25, hy(PB) + .02, 1.95), look: new THREE.Vector3(XB + .57, hy(PB) - .05, 0) };
    let from = W, to = W, k = 0;
    if (t < 4.6) { from = { pos: new THREE.Vector3(0, 1.3, 8.5), look: W.look }; k = ease((t - .5) / 3.5); }
    else if (t < 7.2) { from = W; to = fA; k = ease((t - 4.6) / 1.1); if (t > 4.8) PA.holder.rotation.y += (Math.atan2(fA.pos.x - XA, fA.pos.z) - PA.holder.rotation.y) * .08; }
    else if (t < 9.8) { from = fA; to = fB; k = ease((t - 7.2) / 1.2); if (t > 7.4) PB.holder.rotation.y += (Math.atan2(fB.pos.x - XB, fB.pos.z) - PB.holder.rotation.y) * .08; }
    else { from = fB; to = W; k = ease((t - 9.8) / 1.2); PA.holder.rotation.y += (.25 - PA.holder.rotation.y) * .06; PB.holder.rotation.y += (-.25 - PB.holder.rotation.y) * .06; }
    S.cam.position.copy(lerp3(from.pos, to.pos, k)); S.cam.lookAt(lerp3(from.look, to.look, k));
  };
  requestAnimationFrame(() => S.ov.classList.add('on'));
  await wait(80); names.classList.add('in');
  await wait(1400); names.style.opacity = 0;
  await wait(2900); PA.play('wave', true);
  await wait(300); PB.play('wave', true);
  await wait(1000); cA.classList.add('on');
  await wait(1600); cA.classList.remove('on');
  await wait(900); cB.classList.add('on');
  await wait(1600); cB.classList.remove('on');
  await wait(700); PA.play('clap', true); PB.play('clap', true);
  await wait(1500);
  await S.end();
}

export async function tvWinner(root, { W, score, grip }) {
  if (grip) Object.assign(RK, grip);
  const S = await tvScene(root);
  S.ov.insertAdjacentHTML('beforeend', `<div class="p3-logo">PONGHUB · ИТОГ</div><div class="p3-win"><b>🏆 ${safe(W.nick)}</b><span>Победа ${safe(score || '')}</span></div>`);
  const P = await tvPlayer(S, W); S.ring(0, '#ffd75e');
  P.holder.rotation.y = .2;
  const hy = () => { const v = new THREE.Vector3(); (P.bones.Head || P.scene).getWorldPosition(v); return v.y; };
  let t = 0;
  S.frame = dt => {
    t += dt; const k = ease(t / 2.2);
    S.cam.position.copy(lerp3(new THREE.Vector3(0, 1.2, 6.2), new THREE.Vector3(0, 1.15, 3.6), k));
    S.cam.lookAt(new THREE.Vector3(0, .95 + (hy() - 1.6) * .1, 0));
  };
  requestAnimationFrame(() => S.ov.classList.add('on'));
  await wait(500); P.play('win', true);
  await wait(400); S.ov.querySelector('.p3-win').classList.add('on');
  await wait(5200);
  await S.end();
}

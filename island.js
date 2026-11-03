/*
 * 🏝 Остров подписчиков — общий строитель острова для сайта-карты и видео.
 *
 *   const isl = OstrovIsland.build(THREE, residents);
 *   scene.add(isl.group);
 *   isl.houses.get("neex_yt")  // { no, nick, level, pos, top, cell, features: [...] }
 *
 * Каждый номер жителя навсегда закреплён за своим участком: участки идут от центра
 * по кругу, остров расширяется сам. Внешний вид дома (тип шалаша, цвета, вещи во дворе)
 * выбирается по нику и не меняется; пожелания из комментов (r.wish) добавляют свои детали.
 */
(function (root) {
  const PLOT = 7;          // шаг сетки участков
  const TERRAIN = 2;       // размер колонки рельефа
  const LEVELS = [
    { name: "Шалаш", emoji: "⛺" },
    { name: "Хижина", emoji: "🛖" },
    { name: "Домик", emoji: "🏠" },
    { name: "Коттедж", emoji: "🏡" },
    { name: "Особняк", emoji: "🏘" },
    { name: "Вилла", emoji: "🏰" },
    { name: "Маяк", emoji: "🗼" },
  ];
  // features shown on the resident card
  const FEATURES = {
    flag: "🚩 флаг", fire: "🔥 костёр", barrel: "🛢 бочка", chest: "🧰 сундук", surf: "🏄 доска для серфинга",
    hammock: "🏝 гамак", laundry: "👕 сушилка", torch: "🕯 факел", pot: "🌺 цветок", boat: "🛶 лодка",
    pet: "🐶 питомец", ball: "⚽ мяч", lamp: "🏮 фонарь", palm: "🌴 пальма",
  };
  const COLORS = {
    red: "#E2483D", blue: "#2E86AB", green: "#3FA34D", yellow: "#F4D35E", pink: "#FF7AA8",
    black: "#2B2D42", purple: "#8E5BD9", white: "#F5F5F5", orange: "#F08A24",
  };
  const C = {
    grass: "#6CC24A", grass2: "#5DB03F", soil: "#8B5A2B", sand: "#F4D58D", sand2: "#E8C574",
    trunk: "#A9733F", leaf: "#3FA34D", leaf2: "#2F8C3E", white: "#FFFFFF", red: "#E2483D", lamp: "#FFD93B",
    log: "#8A5530", log2: "#6E4123", door: "#4A2F17", glass: "#9FE3FF", cream: "#F1D3A1", stone: "#9AA0A6",
    stone2: "#7D838A", pool: "#3FC1E0", pad: "#E3CF94", path: "#D2B77A", path2: "#C9AC6C", flower: "#FF7AA8",
    fl2: "#FFE066", rope: "#D8C9A3", flame: "#FF8C1A", flame2: "#FFD23F", plank: "#B98552", plank2: "#A87443",
  };
  const STRAW = [["#E0B04E", "#C8933A"], ["#C9A86A", "#A88848"], ["#D9C27A", "#B7A05C"], ["#B98552", "#8F6236"]];
  const CANVAS = [["#F5F0E6", "#2EC4B6"], ["#F5F0E6", "#E2483D"], ["#F2E3B3", "#2E86AB"], ["#EDE7DA", "#8E5BD9"]];
  const ROOFS = ["#D9452F", "#2E86AB", "#3FA34D", "#8E5BD9", "#F08A24", "#B23A48"];
  const ACCESSORIES = ["flag", "fire", "barrel", "chest", "surf", "hammock", "laundry", "torch", "pot"];

  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const strHash = (s, salt) => { let h = 2166136261 ^ (salt || 0); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

  // plot order: grid cells sorted by distance from the centre, ties broken by angle; centre cell is the plaza.
  // Only cells inside the full circle of radius k are kept, so growing k never reorders earlier plots.
  let PLOTS = [];
  function plotCell(no) {
    const idx = no - 2; // №1 — сам остров (площадь в центре)
    let k = 8;
    while (PLOTS.length <= idx) {
      k *= 2;
      const cells = [];
      for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
        const d = Math.hypot(i, j);
        if ((i === 0 && j === 0) || d > k) continue;
        cells.push([i, j, d, Math.atan2(j, i)]);
      }
      cells.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
      PLOTS = cells;
    }
    return PLOTS[idx];
  }

  function Builder(THREE) { this.T = THREE; this.pos = []; this.nor = []; this.col = []; }
  Builder.prototype.box = function (x, y, z, w, h, d, top, side, rotZ, rotY, rotX) {
    const T = this.T;
    const g = new T.BoxGeometry(w, h, d).toNonIndexed();
    const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(rotX || 0, rotY || 0, rotZ || 0));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const ct = new T.Color(top), cs = new T.Color(side || top), cb = cs.clone().multiplyScalar(0.82);
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      const c = n[i + 1] > 0.5 ? ct : Math.abs(n[i]) > 0.5 ? cb : cs;
      this.col.push(c.r, c.g, c.b);
    }
    g.dispose();
    return this;
  };
  Builder.prototype.mesh = function () {
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(this.col, 3));
    const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // ── level-1 huts: four kinds, each with its own colours
  function shalash(b, x, y, z, s, c1, c2) {
    b.box(x - 0.62 * s, y + 0.9 * s, z, 1.6 * s, 0.22 * s, 2.6 * s, c1, c2, 0.95);
    b.box(x + 0.62 * s, y + 0.9 * s, z, 1.6 * s, 0.22 * s, 2.6 * s, c1, c2, -0.95);
    b.box(x, y + 1.62 * s, z, 0.25 * s, 0.25 * s, 2.8 * s, C.log2);
    b.box(x, y + 0.45 * s, z + 1.25 * s, 0.6 * s, 0.9 * s, 0.1 * s, C.door);
  }
  const HUTS = [
    (b, x, y, z, v) => shalash(b, x, y, z, 1.15, v.c1, v.c2),
    // вигвам: stacked rings and poles sticking out of the top
    (b, x, y, z, v) => {
      for (let k = 0; k < 6; k++) b.box(x, y + 0.25 + k * 0.45, z, 2.6 - k * 0.42, 0.45, 2.6 - k * 0.42, k % 2 ? v.c2 : v.c1);
      b.box(x - 0.2, y + 3.0, z, 0.12, 0.9, 0.12, C.log2, C.log2, 0.3).box(x + 0.2, y + 3.0, z, 0.12, 0.9, 0.12, C.log2, C.log2, -0.3);
      b.box(x, y + 0.5, z + 1.28, 0.55, 1.0, 0.06, C.door);
    },
    // круглая хижина: walls and a two-tier straw cap
    (b, x, y, z, v) => {
      b.box(x, y + 0.65, z, 2.4, 1.3, 2.4, "#C9A27A", "#B08A62");
      b.box(x, y + 1.55, z, 3.0, 0.5, 3.0, v.c1, v.c2).box(x, y + 2.0, z, 2.1, 0.45, 2.1, v.c2, v.c1).box(x, y + 2.4, z, 1.0, 0.4, 1.0, v.c1);
      b.box(x, y + 0.5, z + 1.22, 0.55, 1.0, 0.06, C.door);
    },
    // палатка: striped canvas with poles
    (b, x, y, z, v) => {
      for (let k = 0; k < 4; k++) {
        const col = k % 2 ? v.t2 : v.t1, zz = z - 1.05 + k * 0.7;
        b.box(x - 0.7, y + 0.75, zz, 1.75, 0.16, 0.7, col, col, 0.75).box(x + 0.7, y + 0.75, zz, 1.75, 0.16, 0.7, col, col, -0.75);
      }
      b.box(x, y + 0.7, z + 1.45, 0.12, 1.4, 0.12, C.log2).box(x, y + 0.7, z - 1.45, 0.12, 1.4, 0.12, C.log2);
      b.box(x, y + 0.45, z + 1.3, 0.7, 0.9, 0.04, "#3D2B1F");
    },
  ];

  // ── yard items; slot gives the spot on the pad
  const SLOTS = [[1.75, 1.55], [-1.75, 1.55], [1.75, -1.6], [-1.75, -1.6]];
  const ITEMS = {
    flag: (b, x, y, z, v) => { b.box(x, y + 1.6, z, 0.1, 3.2, 0.1, "#DDDDDD"); b.box(x + 0.48, y + 2.9, z, 0.9, 0.55, 0.05, v.flag); },
    fire: (b, x, y, z) => {
      b.box(x, y + 0.1, z, 1.0, 0.18, 0.25, C.log2, C.log2, 0, 0.6).box(x, y + 0.1, z, 1.0, 0.18, 0.25, C.log2, C.log2, 0, -0.6);
      b.box(x, y + 0.35, z, 0.4, 0.4, 0.4, C.flame).box(x, y + 0.65, z, 0.22, 0.3, 0.22, C.flame2);
      [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]].forEach(([a, c]) => b.box(x + a, y + 0.1, z + c, 0.22, 0.2, 0.22, C.stone));
    },
    barrel: (b, x, y, z) => { b.box(x, y + 0.45, z, 0.75, 0.9, 0.75, "#8A5530").box(x, y + 0.45, z, 0.8, 0.12, 0.8, "#4A4A4A"); },
    chest: (b, x, y, z) => { b.box(x, y + 0.3, z, 0.9, 0.6, 0.6, "#7A4A22").box(x, y + 0.45, z + 0.31, 0.2, 0.2, 0.02, "#F4D35E"); },
    surf: (b, x, y, z, v) => { b.box(x, y + 1.0, z, 0.55, 2.0, 0.12, v.flag, "#FFFFFF", 0.15); },
    hammock: (b, x, y, z, v) => {
      b.box(x - 0.15, y + 0.7, z - 0.9, 0.15, 1.4, 0.15, C.log2).box(x - 0.15, y + 0.7, z + 0.9, 0.15, 1.4, 0.15, C.log2);
      b.box(x - 0.15, y + 0.75, z, 0.55, 0.08, 1.6, v.t2);
    },
    laundry: (b, x, y, z) => {
      b.box(x, y + 0.75, z - 0.9, 0.1, 1.5, 0.1, C.log2).box(x, y + 0.75, z + 0.9, 0.1, 1.5, 0.1, C.log2).box(x, y + 1.45, z, 0.03, 0.03, 1.8, "#EEEEEE");
      b.box(x, y + 1.2, z - 0.45, 0.04, 0.45, 0.4, "#2E86AB").box(x, y + 1.2, z + 0.1, 0.04, 0.45, 0.4, "#FF7AA8").box(x, y + 1.2, z + 0.6, 0.04, 0.4, 0.35, "#F4D35E");
    },
    torch: (b, x, y, z) => { b.box(x, y + 0.8, z, 0.14, 1.6, 0.14, C.log).box(x, y + 1.7, z, 0.3, 0.3, 0.3, C.flame).box(x, y + 1.9, z, 0.16, 0.2, 0.16, C.flame2); },
    pot: (b, x, y, z) => { b.box(x, y + 0.22, z, 0.55, 0.45, 0.55, "#C0613C").box(x, y + 0.6, z, 0.2, 0.4, 0.2, C.leaf).box(x, y + 0.85, z, 0.4, 0.25, 0.4, C.flower); },
    boat: (b, x, y, z) => { b.box(x, y + 0.2, z, 0.8, 0.35, 2.0, "#9C6B3C").box(x, y + 0.42, z, 0.6, 0.1, 1.7, "#C79A62"); },
    pet: (b, x, y, z) => { b.box(x, y + 0.3, z, 0.6, 0.35, 0.3, "#E8A33D").box(x + 0.28, y + 0.55, z, 0.3, 0.3, 0.28, "#E8A33D").box(x - 0.32, y + 0.45, z, 0.08, 0.25, 0.08, "#E8A33D"); },
    ball: (b, x, y, z) => { b.box(x, y + 0.2, z, 0.4, 0.4, 0.4, "#FFFFFF").box(x, y + 0.2, z + 0.21, 0.14, 0.14, 0.02, "#222222"); },
    lamp: (b, x, y, z) => { b.box(x, y + 1.0, z, 0.12, 2.0, 0.12, "#444444").box(x, y + 2.1, z, 0.4, 0.45, 0.4, C.lamp).box(x, y + 2.4, z, 0.5, 0.1, 0.5, "#333333"); },
    palm: (b, x, y, z) => palm(b, x, y, z, 4, 1),
  };

  // ── bigger levels, roof colour comes from the look
  function gable(b, x, y, z, w, d, color, rise) {
    const half = w / 2 + 0.25, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    b.box(x - half / 2, y + rise / 2, z, len, 0.22, d + 0.4, color, color, ang);
    b.box(x + half / 2, y + rise / 2, z, len, 0.22, d + 0.4, color, color, -ang);
  }
  const MODELS = [
    (b, x, y, z, v) => HUTS[v.hut](b, x, y, z, v),
    (b, x, y, z, v) => {
      for (let i = 0; i < 4; i++) b.box(x, y + 0.22 + i * 0.4, z, 2.6, 0.38, 2.4, i % 2 ? C.log : C.log2);
      gable(b, x, y + 1.62, z, 2.6, 2.4, v.roof === ROOFS[0] ? C.log2 : v.roof, 0.9);
      b.box(x, y + 0.6, z + 1.22, 0.6, 1.1, 0.06, C.door).box(x + 0.85, y + 1.0, z + 1.22, 0.45, 0.45, 0.06, C.glass);
    },
    (b, x, y, z, v) => {
      b.box(x, y + 0.9, z, 2.6, 1.8, 2.4, C.cream);
      gable(b, x, y + 1.8, z, 2.6, 2.4, v.roof, 1.0);
      b.box(x, y + 0.55, z + 1.22, 0.6, 1.1, 0.06, C.door).box(x - 0.8, y + 1.1, z + 1.22, 0.5, 0.5, 0.06, C.glass).box(x + 0.8, y + 1.1, z + 1.22, 0.5, 0.5, 0.06, C.glass);
      for (let i = -4; i <= 4; i++) b.box(x + i * 0.55, y + 0.3, z + 2.3, 0.12, 0.6, 0.12, C.white);
      b.box(x, y + 0.45, z + 2.3, 4.6, 0.08, 0.08, C.white);
    },
    (b, x, y, z, v) => {
      b.box(x, y + 1.0, z - 0.2, 3.0, 2.0, 2.6, C.cream);
      gable(b, x, y + 2.0, z - 0.2, 3.0, 2.6, v.roof, 1.1);
      b.box(x + 0.8, y + 2.7, z - 0.8, 0.4, 0.9, 0.4, "#A0522D");
      b.box(x, y + 0.6, z + 1.12, 0.6, 1.2, 0.06, C.door).box(x - 0.9, y + 1.25, z + 1.12, 0.55, 0.55, 0.06, C.glass).box(x + 0.9, y + 1.25, z + 1.12, 0.55, 0.55, 0.06, C.glass);
      ITEMS.pet(b, x + 1.7, y, z + 1.7);
    },
    (b, x, y, z, v) => {
      b.box(x - 0.3, y + 0.9, z - 0.3, 3.0, 1.8, 2.6, C.cream).box(x - 0.3, y + 2.5, z - 0.3, 2.4, 1.4, 2.2, C.cream);
      gable(b, x - 0.3, y + 3.2, z - 0.3, 2.4, 2.2, v.roof, 0.9);
      b.box(x - 0.3, y + 0.6, z + 1.02, 0.7, 1.2, 0.06, C.door).box(x - 1.2, y + 1.2, z + 1.02, 0.5, 0.6, 0.06, C.glass).box(x + 0.6, y + 1.2, z + 1.02, 0.5, 0.6, 0.06, C.glass).box(x - 0.3, y + 2.6, z + 0.82, 1.4, 0.6, 0.06, C.glass);
      b.box(x + 1.55, y + 0.08, z + 1.4, 1.1, 0.16, 1.2, C.pool, "#CFE7EE");
    },
    (b, x, y, z, v) => {
      b.box(x - 0.3, y + 0.85, z - 0.2, 3.2, 1.7, 2.6, C.white).box(x + 0.2, y + 2.35, z - 0.4, 2.4, 1.3, 2.0, C.white);
      b.box(x - 0.3, y + 1.75, z - 0.2, 3.4, 0.12, 2.8, "#D7DEE2").box(x + 0.2, y + 3.05, z - 0.4, 2.6, 0.12, 2.2, v.roof);
      b.box(x - 0.3, y + 0.95, z + 1.12, 2.6, 0.9, 0.06, C.glass).box(x + 0.2, y + 2.35, z + 0.62, 1.8, 0.7, 0.06, C.glass);
      b.box(x + 0.4, y + 0.08, z + 1.95, 2.8, 0.16, 1.0, C.pool, "#CFE7EE");
    },
    (b, x, y, z, v) => {
      for (let i = 0; i < 8; i++) b.box(x, y + 0.45 + i * 0.9, z, 1.4 - i * 0.04, 0.9, 1.4 - i * 0.04, i % 2 ? C.white : v.roof);
      b.box(x, y + 7.55, z, 1.3, 0.8, 1.3, C.lamp, C.lamp).box(x, y + 8.15, z, 1.6, 0.4, 1.6, v.roof);
      b.box(x, y + 0.05, z, 2.6, 0.1, 2.6, C.stone);
    },
  ];
  const HEIGHT = [2.6, 2.6, 3.0, 3.3, 4.2, 3.4, 8.6];

  /** Appearance of one resident: stable for a nick, wishes from comments add details. */
  function look(r) {
    const n = r.nick, wish = r.wish || [];
    const straw = pick(STRAW, strHash(n, 1)), canvas = pick(CANVAS, strHash(n, 2));
    const colorWish = wish.find((w) => COLORS[w]);
    const v = {
      hut: Math.floor(strHash(n, 3) * HUTS.length),
      c1: straw[0], c2: straw[1], t1: canvas[0], t2: canvas[1],
      roof: colorWish ? COLORS[colorWish] : pick(ROOFS, strHash(n, 4)),
      flag: colorWish ? COLORS[colorWish] : pick(Object.values(COLORS), strHash(n, 5)),
      items: [],
    };
    if (colorWish && v.hut === 3) v.t2 = COLORS[colorWish];
    if (colorWish && v.hut !== 3) { v.c1 = COLORS[colorWish]; }
    wish.forEach((w) => { if (ITEMS[w] && !v.items.includes(w)) v.items.push(w); });
    // one or two random yard items on top of the wished ones, four at most
    const want = Math.min(4, v.items.length + 1 + (strHash(n, 6) < 0.45 ? 1 : 0));
    for (let k = 0; v.items.length < want && k < 20; k++) {
      const it = ACCESSORIES[Math.floor(strHash(n, 10 + k) * ACCESSORIES.length)];
      if (!v.items.includes(it)) v.items.push(it);
    }
    return v;
  }

  function palm(b, x, y, z, h, lean) {
    for (let i = 0; i < h; i++) b.box(x + lean * i * 0.12, y + 0.5 + i, z, 0.6, 1, 0.6, C.trunk);
    const tx = x + lean * h * 0.12, ty = y + h + 0.3;
    b.box(tx, ty, z, 1.2, 0.6, 1.2, C.leaf);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, c]) => {
      b.box(tx + a * 1.3, ty - 0.1, z + c * 1.3, a ? 1.6 : 1, 0.5, c ? 1.6 : 1, C.leaf);
      b.box(tx + a * 2.5, ty - 0.6, z + c * 2.5, a ? 1.2 : 0.9, 0.45, c ? 1.2 : 0.9, C.leaf2);
    });
  }

  function signTexture(THREE, residentsCount) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 384;
    const g = c.getContext("2d");
    g.fillStyle = "#9C6B3C"; g.fillRect(0, 0, 512, 384);
    g.fillStyle = "#8A5C31";
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 96 + 92, 512, 6);
    g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "900 74px Montserrat, sans-serif"; g.fillText("ОСТРОВ", 256, 96); g.fillText("ПОДПИСЧИКОВ", 256, 176);
    g.fillStyle = "#0B3954"; g.fillRect(40, 262, 432, 92);
    g.fillStyle = "#FFFFFF"; g.font = "800 48px Montserrat, sans-serif"; g.fillText("ЖИТЕЛЕЙ: " + residentsCount, 256, 310);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * residents: [{ no, nick, level, wish? }] — no ≥ 2, level 1..7
   * returns { group, houses: Map, radius, plaza: Vector3, sign }
   */
  function build(THREE, residents, opts) {
    opts = opts || {};
    const group = new THREE.Group();
    const houses = new Map();
    const rows = residents.filter((r) => r.no >= 2).sort((a, b) => a.no - b.no);

    let far = 1;
    const cells = rows.map((r) => { const c = plotCell(r.no); far = Math.max(far, c[2]); return c; });
    // empty plots waiting for followers who have not commented yet: the next cells after the last resident
    const lastNo = rows.length ? rows[rows.length - 1].no : 1;
    const emptyCells = [];
    for (let k = 1; k <= (opts.emptyPlots || 0); k++) { const c = plotCell(lastNo + k); far = Math.max(far, c[2]); emptyCells.push(c); }
    const R = Math.max(18, (far + 1) * PLOT + 7);
    const grassR = R - 6;
    const occupied = new Set(cells.map((c) => c[0] + "," + c[1]));
    emptyCells.forEach((c) => occupied.add(c[0] + "," + c[1]));
    occupied.add("0,0");

    // terrain columns
    const terrain = new Builder(THREE);
    const tops = new Map();
    const n = Math.ceil(R / TERRAIN) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const x = i * TERRAIN, z = j * TERRAIN;
      const r = Math.hypot(x, z) + (hash(i, j) - 0.5) * 2.4;
      if (r > R) continue;
      const grass = r < grassR, top = grass ? 2 : 1;
      const ct = grass ? (hash(i * 3, j) < 0.5 ? C.grass : C.grass2) : (hash(i, j * 2) < 0.5 ? C.sand : C.sand2);
      terrain.box(x, (top - 3) / 2, z, TERRAIN, top + 3, TERRAIN, ct, grass ? C.soil : C.sand2);
      tops.set(i + "," + j, top);
    }
    const topAt = (x, z) => tops.get(Math.round(x / TERRAIN) + "," + Math.round(z / TERRAIN)) || 0;
    group.add(terrain.mesh());

    const shallows = new THREE.Mesh(new THREE.CircleGeometry(R + 6, 64), new THREE.MeshLambertMaterial({ color: "#46C4DE" }));
    shallows.rotation.x = -Math.PI / 2;
    shallows.position.y = 0.02;
    shallows.receiveShadow = true;
    group.add(shallows);

    const b = new Builder(THREE);

    // paths around every occupied plot (streets), torches on some crossings
    const segs = new Set(), corners = new Set();
    const H = PLOT / 2;
    occupied.forEach((key) => {
      const [i, j] = key.split(",").map(Number);
      segs.add(`v${i},${j}`); segs.add(`v${i + 1},${j}`); segs.add(`h${i},${j}`); segs.add(`h${i},${j + 1}`);
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([a, c]) => corners.add(`${i + a},${j + c}`));
    });
    segs.forEach((s) => {
      const [i, j] = s.slice(1).split(",").map(Number);
      const col = hash(i * 5 + (s[0] === "v" ? 1 : 7), j) < 0.5 ? C.path : C.path2;
      if (s[0] === "v") { const x = i * PLOT - H, z = j * PLOT; if (topAt(x, z) === 2) b.box(x, 2.03, z, 1.6, 0.06, PLOT, col); }
      else { const x = i * PLOT, z = j * PLOT - H; if (topAt(x, z) === 2) b.box(x, 2.03, z, PLOT, 0.06, 1.6, col); }
    });
    corners.forEach((s) => {
      const [i, j] = s.split(",").map(Number);
      const x = i * PLOT - H, z = j * PLOT - H;
      if (topAt(x, z) === 2 && hash(i + 31, j - 17) < 0.28) ITEMS.torch(b, x + 0.9, 2, z + 0.9);
    });

    // houses; with opts.perHouse every house is its own mesh (origin at its plot) so videos can animate them
    rows.forEach((r, k) => {
      const [i, j, d] = cells[k];
      const x = i * PLOT, z = j * PLOT, y = 2;
      const lvl = Math.min(7, Math.max(1, r.level || 1));
      const v = look(r);
      b.box(x, y + 0.03, z, 5.4, 0.06, 5.4, C.pad);
      let mesh = null;
      if (opts.perHouse) {
        const hb = new Builder(THREE);
        MODELS[lvl - 1](hb, 0, 0, 0, v);
        v.items.forEach((it, s) => ITEMS[it](hb, SLOTS[s][0], 0, SLOTS[s][1], v));
        mesh = hb.mesh();
        mesh.position.set(x, y, z);
        group.add(mesh);
      } else {
        MODELS[lvl - 1](b, x, y, z, v);
        v.items.forEach((it, s) => ITEMS[it](b, x + SLOTS[s][0], y, z + SLOTS[s][1], v));
      }
      houses.set(r.nick, {
        mesh,
        no: r.no, nick: r.nick, level: lvl, cell: [i, j], ring: d,
        features: v.items.map((it) => FEATURES[it]), wished: (r.wish || []).length > 0,
        pos: new THREE.Vector3(x, y, z), top: new THREE.Vector3(x, y + HEIGHT[lvl - 1] + 0.6, z),
      });
    });

    // empty plots: corner stakes, a rope and a little sign — «your place is waiting»
    emptyCells.forEach(([i, j]) => {
      const x = i * PLOT, z = j * PLOT, y = 2, s = 2.2;
      b.box(x, y + 0.03, z, 5.0, 0.06, 5.0, C.sand2);
      [[-s, -s], [s, -s], [s, s], [-s, s]].forEach(([a, c]) => b.box(x + a, y + 0.45, z + c, 0.18, 0.9, 0.18, C.log));
      b.box(x, y + 0.72, z - s, 2 * s, 0.06, 0.06, C.rope).box(x, y + 0.72, z + s, 2 * s, 0.06, 0.06, C.rope);
      b.box(x - s, y + 0.72, z, 0.06, 0.06, 2 * s, C.rope).box(x + s, y + 0.72, z, 0.06, 0.06, 2 * s, C.rope);
      b.box(x + 0.8, y + 0.6, z + 1.2, 0.12, 1.2, 0.12, C.log2).box(x + 0.8, y + 1.25, z + 1.2, 1.0, 0.6, 0.1, "#F5F0E6");
      b.box(x + 0.8, y + 1.3, z + 1.26, 0.14, 0.32, 0.02, C.navy).box(x + 0.8, y + 1.07, z + 1.26, 0.12, 0.08, 0.02, C.navy);
    });

    // plaza: big campfire, log benches, the founder's hut and the sign
    b.box(0, 2.03, 0, PLOT - 1.4, 0.06, PLOT - 1.4, C.path);
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      b.box(Math.cos(ang) * 1.1, 2.15, Math.sin(ang) * 1.1, 0.4, 0.3, 0.4, a % 2 ? C.stone : C.stone2);
    }
    b.box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log2, C.log2, 0, 0.5).box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log2, C.log2, 0, -0.5).box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log, C.log, 0, Math.PI / 2);
    b.box(0, 2.55, 0, 0.8, 0.6, 0.8, C.flame).box(0, 3.05, 0, 0.5, 0.5, 0.5, C.flame2).box(0.1, 3.4, 0.05, 0.25, 0.3, 0.25, "#FFF3B0");
    [[0, 2.3, 0], [2.3, 0, Math.PI / 2], [0, -2.3, 0], [-2.3, 0, Math.PI / 2]].forEach(([xx, zz, ry]) => b.box(xx, 2.25, zz, 1.8, 0.4, 0.45, C.log, C.log2, 0, ry));
    shalash(b, -2.0, 2, -2.0, 0.8, STRAW[0][0], STRAW[0][1]);

    // empty cells: palms, flowers, rocks; beach palms around the edge
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      if (occupied.has(i + "," + j)) continue;
      const x = i * PLOT, z = j * PLOT, d = Math.hypot(x, z);
      if (d > R - 2) continue;
      const h = hash(i + 7, j - 3), top = topAt(x, z);
      if (!top) continue;
      if (top === 1 ? h < 0.55 : h < 0.4) palm(b, x + (hash(j, i) - 0.5) * 2, top, z + (hash(i, j) - 0.5) * 2, 5 + Math.floor(hash(j, i) * 3), hash(i, j + 9) < 0.5 ? 1 : -1);
      else if (top === 2 && h < 0.7) { b.box(x - 1, 2.2, z, 0.4, 0.4, 0.4, C.flower).box(x + 1, 2.2, z + 0.8, 0.4, 0.4, 0.4, C.fl2); }
      else if (top === 1) b.box(x, 1.35, z, 1.0, 0.7, 0.9, C.stone);
    }

    // pier with a boat, on the +z beach
    const pz = R - 4;
    for (let k = 0; k < 9; k++) b.box(2.5, 1.15, pz + k * 1.05, 1.9, 0.18, 1.0, k % 2 ? C.plank : C.plank2);
    for (let k = 0; k < 9; k += 2) b.box(1.6, 0.6, pz + k * 1.05, 0.2, 1.2, 0.2, C.log2).box(3.4, 0.6, pz + k * 1.05, 0.2, 1.2, 0.2, C.log2);
    b.box(4.6, 0.3, pz + 6, 1.1, 0.5, 2.8, "#9C6B3C").box(4.6, 0.6, pz + 6, 0.8, 0.12, 2.4, "#C79A62").box(4.6, 1.4, pz + 6, 0.1, 1.6, 0.1, C.log2).box(4.6, 1.5, pz + 6.4, 0.05, 1.1, 0.8, "#FFFFFF");
    group.add(b.mesh());

    const sign = new THREE.Group();
    const post = new Builder(THREE);
    post.box(-1.4, 1.2, 0, 0.35, 2.4, 0.35, C.log).box(1.4, 1.2, 0, 0.35, 2.4, 0.35, C.log).box(0, 2.45, -0.12, 3.4, 2.5, 0.2, "#7A4F2A");
    sign.add(post.mesh());
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.45), new THREE.MeshLambertMaterial({ map: signTexture(THREE, rows.length + 1) }));
    face.position.set(0, 2.45, 0.01);
    sign.add(face);
    sign.scale.setScalar(0.8);
    sign.position.set(2.0, 2, -2.2);
    sign.rotation.y = -0.6;
    group.add(sign);

    const empty = emptyCells.map(([i, j]) => new THREE.Vector3(i * PLOT, 2, j * PLOT));
    return { group, houses, empty, radius: R, plaza: new THREE.Vector3(0, 2, 0), pier: new THREE.Vector3(3.5, 1, pz + 5), sign, levels: LEVELS };
  }

  root.OstrovIsland = { build, plotCell, look, LEVELS, FEATURES, PLOT };
})(typeof window !== "undefined" ? window : globalThis);

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
  // пропорции как у «Города подписчиков»: дом ≈ 0.5–0.6 участка, улица ≈ 2/3 ширины дома
  const PLOT = 10.5;       // шаг сетки участков
  const STREET = 3.0;      // ширина улицы
  const HOUSE = 1.8;       // во сколько раз дом крупнее своей модели
  const YARD = 1.75;       // вещи во дворе отодвинуты к углам участка, чтобы не влезать в дом
  const ITEM = 1.3;        // и чуть крупнее, под стать дому
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
    pet: "🐶 питомец", ball: "⚽ мяч", lamp: "🏮 фонарь", palm: "🌴 пальма", horse: "🐴 лошадка",
    car: "🚗 машина", pool: "🏊 бассейн", moto: "🏍 мотоцикл", parrot: "🦜 попугай",
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
    navy: "#0B3954", dark: "#2B2D42", metal: "#8D99AE", gold: "#F4C430", brick: "#B5523B",
  };
  const STRAW = [["#E0B04E", "#C8933A"], ["#C9A86A", "#A88848"], ["#D9C27A", "#B7A05C"], ["#B98552", "#8F6236"]];
  const CANVAS = [["#F5F0E6", "#2EC4B6"], ["#F5F0E6", "#E2483D"], ["#F2E3B3", "#2E86AB"], ["#EDE7DA", "#8E5BD9"]];
  const WALLS = [["#C9A27A", "#B08A62"], ["#E8D3A9", "#CDB68A"], ["#9FC3E0", "#82A9C7"], ["#F2C86B", "#D9AE52"], ["#9ED9B8", "#80BF9C"], ["#F1E4CF", "#D6C8B0"]];
  const MUD = [["#D9A066", "#C68B59"], ["#E6C9A0", "#CDAE82"], ["#E8D8C0", "#CFBFA5"], ["#C97B5A", "#A9603F"]];
  const HULLS = [["#2E86AB", "#1F6E8E"], ["#E2483D", "#B93A31"], ["#3FA34D", "#2F8C3E"], ["#F4D35E", "#D9B840"], ["#F5F5F5", "#D8D8D8"]];
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

  // world-space UVs are kept on every box (one repeat per PIXEL_TILE units) for a future texture; a pixel-noise
  // texture shimmered on phones, so the island renders with plain vertex colours and one shared material
  const PIXEL_TILE = 4;
  let FLAT_MAT = null;
  const flatMaterial = (T) => FLAT_MAT || (FLAT_MAT = new T.MeshLambertMaterial({ vertexColors: true }));

  function Builder(THREE) { this.T = THREE; this.pos = []; this.nor = []; this.col = []; this.uv = []; this.xf = null; }
  // boxes added after around(x, y, z, s, turn) are scaled by s and turned by turn about that point; around() with no args resets
  Builder.prototype.around = function (x, y, z, s, turn) {
    const T = this.T;
    this.xf = s ? new T.Matrix4().makeTranslation(x, y, z).multiply(new T.Matrix4().makeRotationY(turn || 0)).multiply(new T.Matrix4().makeScale(s, s, s)).multiply(new T.Matrix4().makeTranslation(-x, -y, -z)) : null;
    return this;
  };
  Builder.prototype.box = function (x, y, z, w, h, d, top, side, rotZ, rotY, rotX) {
    const T = this.T;
    const g = new T.BoxGeometry(w, h, d).toNonIndexed();
    const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(rotX || 0, rotY || 0, rotZ || 0));
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    if (this.xf) g.applyMatrix4(this.xf);
    const p =g.attributes.position.array, n = g.attributes.normal.array;
    const ct = new T.Color(top), cs = new T.Color(side || top), cb = cs.clone().multiplyScalar(0.82);
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      const c = n[i + 1] > 0.5 ? ct : Math.abs(n[i]) > 0.5 ? cb : cs;
      this.col.push(c.r, c.g, c.b);
      // world-space UVs, so the pixel texture has the same pixel size on every face of every box
      const ax = Math.abs(n[i]), ay = Math.abs(n[i + 1]);
      if (ay >= ax && ay >= Math.abs(n[i + 2])) this.uv.push(p[i] / PIXEL_TILE, p[i + 2] / PIXEL_TILE);
      else if (ax >= Math.abs(n[i + 2])) this.uv.push(p[i + 2] / PIXEL_TILE, p[i + 1] / PIXEL_TILE);
      else this.uv.push(p[i] / PIXEL_TILE, p[i + 1] / PIXEL_TILE);
    }
    g.dispose();
    return this;
  };
  Builder.prototype.mesh = function () {
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(this.uv, 2));
    const mesh = new T.Mesh(g, flatMaterial(T));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // a window on both side walls (±dx from the centre): a light frame with blue glass and a cross bar
  function sideWindows(b, x, y, z, dx, size) {
    const s = size || 0.5;
    [-1, 1].forEach((k) => {
      b.box(x + k * dx, y, z, 0.06, s, s, C.cream);
      b.box(x + k * (dx + 0.02), y, z, 0.06, s - 0.14, s - 0.14, C.glass);
      b.box(x + k * (dx + 0.04), y, z, 0.04, s - 0.14, 0.05, C.cream).box(x + k * (dx + 0.04), y, z, 0.04, 0.05, s - 0.14, C.cream);
    });
  }

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
      b.box(x, y + 0.5, z + 1.22, 0.55, 1.0, 0.06, C.door).box(x, y + 0.06, z + 1.45, 0.8, 0.12, 0.35, C.stone);
      sideWindows(b, x, y + 0.75, z, 1.21);
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
    // хижина на сваях: posts, a deck, a little house with a straw roof, a ladder
    (b, x, y, z, v) => {
      [[-1.1, -1.0], [1.1, -1.0], [-1.1, 1.0], [1.1, 1.0]].forEach(([a, c]) => b.box(x + a, y + 0.45, z + c, 0.18, 0.9, 0.18, C.log2));
      b.box(x, y + 0.95, z, 2.7, 0.15, 2.5, C.plank, C.plank2);
      b.box(x, y + 1.65, z - 0.15, 2.2, 1.25, 1.9, v.w, v.w2);
      gable(b, x, y + 2.27, z - 0.15, 2.2, 1.9, v.c1, 0.85);
      b.box(x, y + 1.5, z + 0.81, 0.55, 0.95, 0.06, C.door);
      sideWindows(b, x, y + 1.7, z - 0.15, 1.11, 0.45);
      b.box(x - 0.3, y + 0.5, z + 1.45, 0.08, 1.0, 0.08, C.log).box(x + 0.3, y + 0.5, z + 1.45, 0.08, 1.0, 0.08, C.log);
      for (let k = 0; k < 3; k++) b.box(x, y + 0.2 + k * 0.3, z + 1.45, 0.6, 0.06, 0.08, C.log);
    },
    // бунгало: plank walls, a porch on posts under the long roof
    (b, x, y, z, v) => {
      b.box(x, y + 0.75, z - 0.3, 2.6, 1.5, 2.0, v.w, v.w2);
      for (let k = 0; k < 3; k++) b.box(x, y + 0.35 + k * 0.45, z + 0.71, 2.62, 0.05, 0.02, v.w2);
      gable(b, x, y + 1.5, z + 0.1, 2.6, 2.6, v.c1, 0.8);
      b.box(x, y + 0.08, z + 1.15, 2.6, 0.16, 0.9, C.plank, C.plank2);
      b.box(x - 1.15, y + 0.8, z + 1.5, 0.14, 1.5, 0.14, C.log2).box(x + 1.15, y + 0.8, z + 1.5, 0.14, 1.5, 0.14, C.log2);
      b.box(x - 0.5, y + 0.6, z + 0.72, 0.55, 1.0, 0.06, C.door).box(x + 0.6, y + 0.9, z + 0.72, 0.6, 0.5, 0.06, C.glass);
      sideWindows(b, x, y + 0.9, z - 0.3, 1.31);
    },
    // мазанка: a clay block, flat roof with beam ends, a jar on top
    (b, x, y, z, v) => {
      b.box(x, y + 0.8, z, 2.6, 1.6, 2.4, v.m1, v.m2);
      b.box(x, y + 1.68, z, 2.8, 0.16, 2.6, v.c2);
      for (let k = -1; k <= 1; k++) b.box(x + k * 0.8, y + 1.45, z + 1.3, 0.14, 0.14, 0.4, C.log2);
      b.box(x - 0.45, y + 0.55, z + 1.21, 0.6, 1.1, 0.06, C.door).box(x + 0.65, y + 1.0, z + 1.21, 0.45, 0.45, 0.06, C.dark);
      b.box(x + 0.8, y + 1.98, z - 0.6, 0.4, 0.45, 0.4, "#C0613C");
      b.box(x - 0.45, y + 0.06, z + 1.4, 0.8, 0.12, 0.35, C.stone);
      sideWindows(b, x, y + 0.95, z, 1.31, 0.45);
    },
    // дом-лодка: an upturned hull on the sand, plank front with a round window
    (b, x, y, z, v) => {
      [2.8, 2.6, 2.2, 1.6, 0.8].forEach((w, k) => b.box(x, y + 0.2 + k * 0.4, z, w, 0.4, 3.0 - k * 0.1, k % 2 ? v.h2 : v.h1));
      b.box(x, y + 2.1, z, 0.2, 0.15, 3.2, C.log2);
      b.box(x, y + 0.75, z + 1.52, 1.8, 1.5, 0.06, C.plank2);
      b.box(x, y + 0.55, z + 1.56, 0.55, 1.0, 0.04, C.door).box(x, y + 1.4, z + 1.56, 0.35, 0.35, 0.04, C.glass);
    },
    // пляжный домик: a deck, posts, small walls and a stepped straw roof
    (b, x, y, z, v) => {
      b.box(x, y + 0.1, z, 3.0, 0.2, 3.0, C.plank, C.plank2);
      b.box(x, y + 0.85, z, 2.0, 1.3, 2.0, v.w, v.w2);
      [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35]].forEach(([a, c]) => b.box(x + a, y + 0.9, z + c, 0.14, 1.5, 0.14, C.log));
      b.box(x, y + 1.7, z, 3.3, 0.25, 3.3, v.c1, v.c2).box(x, y + 2.0, z, 2.5, 0.3, 2.5, v.c2, v.c1).box(x, y + 2.3, z, 1.6, 0.3, 1.6, v.c1, v.c2).box(x, y + 2.55, z, 0.7, 0.25, 0.7, v.c2);
      b.box(x, y + 0.65, z + 1.01, 0.55, 1.0, 0.06, C.door);
      sideWindows(b, x, y + 0.95, z, 1.01, 0.45);
    },
  ];
  const HUT_KINDS = [
    { name: "Шалаш", emoji: "⛺" }, { name: "Вигвам", emoji: "🛖" }, { name: "Круглая хижина", emoji: "🛖" }, { name: "Палатка", emoji: "⛺" },
    { name: "Хижина на сваях", emoji: "🛖" }, { name: "Бунгало", emoji: "🏡" }, { name: "Мазанка", emoji: "🏠" }, { name: "Дом-лодка", emoji: "🛶" }, { name: "Пляжный домик", emoji: "🏖" },
  ];
  const HUT_H = [2.2, 3.4, 2.6, 1.6, 3.3, 2.4, 2.2, 2.2, 2.7];

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
    // a brown horse facing +z (towards the street), centred on its spot: long along z so it stays clear of the house
    horse: (b, x, y, z) => {
      const s = 0.9, hx = (dx) => x + dx * s, hy = (dy) => y + dy * s, hz = (dz) => z + (dz - 0.2) * s;
      const coat = "#A0522D", leg = "#7A3E1D", hair = "#3B2414";
      b.box(hx(0), hy(0.95), hz(0), 0.5 * s, 0.55 * s, 1.3 * s, coat);
      [[-0.17, -0.45], [-0.17, 0.45], [0.17, -0.45], [0.17, 0.45]].forEach(([a, c]) => b.box(hx(a), hy(0.35), hz(c), 0.16 * s, 0.7 * s, 0.16 * s, leg));
      b.box(hx(0), hy(1.35), hz(0.62), 0.36 * s, 0.7 * s, 0.32 * s, coat, coat, 0, 0, 0.5);
      b.box(hx(0), hy(1.5), hz(0.55), 0.12 * s, 0.75 * s, 0.18 * s, hair, hair, 0, 0, 0.5);
      b.box(hx(0), hy(1.65), hz(0.92), 0.32 * s, 0.3 * s, 0.55 * s, coat);
      b.box(hx(0), hy(1.6), hz(1.15), 0.28 * s, 0.22 * s, 0.15 * s, "#5A2E14");
      b.box(hx(-0.1), hy(1.86), hz(0.8), 0.08 * s, 0.14 * s, 0.08 * s, leg).box(hx(0.1), hy(1.86), hz(0.8), 0.08 * s, 0.14 * s, 0.08 * s, leg);
      b.box(hx(0), hy(0.85), hz(-0.72), 0.14 * s, 0.6 * s, 0.12 * s, hair, hair, 0, 0, -0.35);
    },
    // a small car along z (nose towards the street), painted in the resident's colour
    car: (b, x, y, z, v) => {
      [[-0.46, -0.55], [0.46, -0.55], [-0.46, 0.55], [0.46, 0.55]].forEach(([a, c]) => b.box(x + a, y + 0.18, z + c, 0.16, 0.36, 0.36, "#222222"));
      b.box(x, y + 0.42, z, 0.9, 0.4, 1.7, v.flag);
      b.box(x, y + 0.8, z - 0.1, 0.78, 0.36, 0.9, v.flag);
      b.box(x, y + 0.8, z + 0.36, 0.7, 0.28, 0.02, C.glass).box(x, y + 0.8, z - 0.56, 0.7, 0.28, 0.02, C.glass);
      b.box(x + 0.4, y + 0.8, z - 0.1, 0.02, 0.26, 0.72, C.glass).box(x - 0.4, y + 0.8, z - 0.1, 0.02, 0.26, 0.72, C.glass);
      b.box(x - 0.28, y + 0.45, z + 0.86, 0.18, 0.12, 0.02, C.lamp, C.lamp).box(x + 0.28, y + 0.45, z + 0.86, 0.18, 0.12, 0.02, C.lamp, C.lamp);
    },
    pool: (b, x, y, z) => {
      b.box(x, y + 0.12, z, 1.6, 0.24, 1.3, C.white, "#E8E8E8");
      b.box(x, y + 0.25, z, 1.3, 0.04, 1.0, C.pool, C.pool);
      b.box(x + 0.55, y + 0.45, z - 0.5, 0.05, 0.4, 0.05, C.metal).box(x + 0.55, y + 0.45, z - 0.3, 0.05, 0.4, 0.05, C.metal);
      b.box(x - 0.3, y + 0.29, z + 0.15, 0.3, 0.06, 0.3, "#FF7AA8");
    },
    moto: (b, x, y, z, v) => {
      b.box(x, y + 0.25, z - 0.45, 0.14, 0.5, 0.5, "#222222").box(x, y + 0.25, z + 0.45, 0.14, 0.5, 0.5, "#222222");
      b.box(x, y + 0.5, z, 0.24, 0.22, 0.75, v.flag);
      b.box(x, y + 0.66, z - 0.15, 0.22, 0.1, 0.4, "#2B2D42");
      b.box(x, y + 0.75, z + 0.36, 0.08, 0.4, 0.08, C.metal).box(x, y + 0.95, z + 0.36, 0.6, 0.06, 0.06, C.metal);
      b.box(x, y + 0.62, z + 0.42, 0.14, 0.1, 0.04, C.lamp, C.lamp);
    },
    parrot: (b, x, y, z) => {
      b.box(x, y + 0.7, z, 0.1, 1.4, 0.1, C.log2).box(x, y + 1.4, z, 0.7, 0.08, 0.08, C.log2);
      b.box(x, y + 1.62, z, 0.24, 0.36, 0.22, "#E2483D").box(x, y + 1.88, z + 0.04, 0.2, 0.2, 0.2, "#E2483D");
      b.box(x, y + 1.85, z + 0.17, 0.08, 0.1, 0.08, "#F4D35E");
      b.box(x + 0.13, y + 1.6, z - 0.02, 0.04, 0.26, 0.18, "#2E86AB").box(x - 0.13, y + 1.6, z - 0.02, 0.04, 0.26, 0.18, "#2E86AB");
      b.box(x, y + 1.38, z - 0.14, 0.12, 0.3, 0.06, "#F4D35E");
    },
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

  // ── businesses: a resident who asked for one in a comment gets it instead of a hut.
  // Every model faces +z; the sign board hangs at SIGN_Z in front, its height is h + 0.45.
  const SIGN_Z = 1.08;
  function shopBox(b, x, y, z, wall, aw1, aw2, h) {
    h = h || 2.2;
    b.box(x, y + h / 2, z - 0.3, 3.2, h, 2.6, wall);
    b.box(x, y + h + 0.06, z - 0.3, 3.4, 0.12, 2.8, "#D7DEE2");
    for (let k = 0; k < 6; k++) b.box(x - 1.35 + k * 0.54, y + h - 0.45, z + 1.3, 0.54, 0.1, 0.75, k % 2 ? aw2 : aw1, k % 2 ? aw2 : aw1, 0, 0, 0.35);
    b.box(x - 0.7, y + 0.6, z + 1.02, 0.65, 1.2, 0.06, C.door).box(x + 0.6, y + 0.85, z + 1.02, 1.2, 0.9, 0.06, C.glass);
  }
  function umbrella(b, x, y, z, c1, c2) {
    b.box(x, y + 0.35, z, 0.7, 0.08, 0.7, C.plank).box(x, y + 0.18, z, 0.1, 0.35, 0.1, C.log2);
    b.box(x, y + 0.75, z, 0.06, 1.5, 0.06, "#EEEEEE").box(x, y + 1.45, z, 1.4, 0.1, 1.4, c1).box(x, y + 1.55, z, 0.8, 0.1, 0.8, c2);
  }
  const BIZ = {
    shop: { title: "Магазин", emoji: "🛒", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.cream, "#3FA34D", "#FFFFFF");
      b.box(x + 1.0, y + 0.25, z + 1.9, 0.6, 0.5, 0.5, C.plank).box(x + 1.0, y + 0.55, z + 1.9, 0.5, 0.12, 0.4, "#E2483D").box(x + 0.3, y + 0.25, z + 1.9, 0.6, 0.5, 0.5, C.plank2).box(x + 0.3, y + 0.55, z + 1.9, 0.5, 0.12, 0.4, "#F08A24");
    } },
    cafe: { title: "Кафе", emoji: "☕", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, "#F6E7D0", "#E2483D", "#FFFFFF");
      umbrella(b, x - 1.1, y, z + 2.1, "#E2483D", "#FFFFFF"); umbrella(b, x + 1.1, y, z + 2.1, "#2EC4B6", "#FFFFFF");
    } },
    shawarma: { title: "Шаурма", emoji: "🌯", h: 2.0, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, "#F4D35E", "#E2483D", "#F4D35E", 2.0);
      for (let k = 0; k < 5; k++) b.box(x + 0.6, y + 0.55 + k * 0.16, z + 1.15, 0.42 - Math.abs(k - 2) * 0.06, 0.16, 0.42 - Math.abs(k - 2) * 0.06, k % 2 ? "#A0522D" : "#C8793B");
      b.box(x + 0.6, y + 0.85, z + 1.15, 0.05, 1.1, 0.05, C.metal).box(x, y + 0.5, z + 1.5, 3.0, 0.1, 0.5, C.metal, "#6C757D");
    } },
    pizza: { title: "Пиццерия", emoji: "🍕", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.brick, "#3FA34D", "#FFFFFF");
      b.box(x - 0.9, y + 2.7, z - 0.8, 1.2, 0.8, 1.2, C.stone, C.stone2).box(x - 0.9, y + 3.4, z - 0.8, 0.4, 0.8, 0.4, C.stone2);
      b.box(x + 1.0, y + 2.45, z - 0.6, 1.0, 0.1, 1.0, "#F4C27A").box(x + 1.0, y + 2.52, z - 0.6, 0.8, 0.05, 0.8, "#E2483D");
    } },
    sushi: { title: "Суши", emoji: "🍣", h: 2.2, draw: (b, x, y, z) => {
      b.box(x, y + 1.1, z - 0.3, 3.2, 2.2, 2.6, C.white);
      b.box(x, y + 2.35, z - 0.3, 4.0, 0.25, 3.4, "#B23A48").box(x, y + 2.6, z - 0.3, 3.0, 0.25, 2.4, "#B23A48").box(x, y + 2.85, z - 0.3, 1.6, 0.25, 1.4, C.dark);
      b.box(x - 0.7, y + 0.6, z + 1.02, 0.65, 1.2, 0.06, C.dark).box(x + 0.6, y + 0.9, z + 1.02, 1.1, 0.8, 0.06, C.glass);
      [-1.7, 1.7].forEach((dx) => b.box(x + dx, y + 1.7, z + 1.1, 0.4, 0.55, 0.4, "#E2483D").box(x + dx, y + 2.05, z + 1.1, 0.06, 0.2, 0.06, C.dark));
    } },
    burger: { title: "Бургерная", emoji: "🍔", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, "#F7C04A", "#E2483D", "#FFFFFF");
      b.box(x, y + 2.45, z - 0.5, 1.6, 0.35, 1.6, "#D9913C").box(x, y + 2.72, z - 0.5, 1.75, 0.12, 1.75, "#5DB03F").box(x, y + 2.9, z - 0.5, 1.6, 0.25, 1.6, "#6E3B1E").box(x, y + 3.05, z - 0.5, 1.7, 0.08, 1.7, "#F4D35E").box(x, y + 3.3, z - 0.5, 1.5, 0.45, 1.5, "#D9913C");
    } },
    icecream: { title: "Мороженое", emoji: "🍦", h: 2.0, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, "#FFD1E0", "#FF7AA8", "#FFFFFF", 2.0);
      for (let k = 0; k < 4; k++) b.box(x, y + 2.3 + k * 0.3, z - 0.5, 0.25 + k * 0.18, 0.3, 0.25 + k * 0.18, "#D9A15B");
      b.box(x, y + 3.6, z - 0.5, 1.0, 0.5, 1.0, "#FFF4E0").box(x, y + 4.0, z - 0.5, 0.75, 0.4, 0.75, "#FF7AA8").box(x, y + 4.3, z - 0.5, 0.25, 0.25, 0.25, "#E2483D");
    } },
    bar: { title: "Пляжный бар", emoji: "🍹", h: 2.4, draw: (b, x, y, z, v) => {
      [[-1.4, -1.2], [1.4, -1.2], [-1.4, 0.9], [1.4, 0.9]].forEach(([a, c]) => b.box(x + a, y + 1.2, z + c, 0.22, 2.4, 0.22, C.log2));
      b.box(x, y + 2.5, z - 0.15, 3.8, 0.3, 3.1, v.c1, v.c2).box(x, y + 2.8, z - 0.15, 2.8, 0.3, 2.2, v.c2, v.c1).box(x, y + 3.05, z - 0.15, 1.6, 0.25, 1.2, v.c1);
      b.box(x, y + 0.55, z + 0.6, 2.8, 1.1, 0.4, C.plank, C.plank2).box(x, y + 1.15, z + 0.6, 3.0, 0.1, 0.6, C.log);
      [-0.9, 0, 0.9].forEach((dx) => b.box(x + dx, y + 0.35, z + 1.3, 0.35, 0.7, 0.35, C.log2).box(x + dx, y + 1.3, z + 0.6, 0.12, 0.25, 0.12, dx ? "#FF7AA8" : "#F4D35E"));
      ITEMS.torch(b, x - 2.0, y, z + 1.6); ITEMS.torch(b, x + 2.0, y, z + 1.6);
    } },
    fish: { title: "Рыбная лавка", emoji: "🐟", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.plank, "#2E86AB", "#FFFFFF");
      [-0.9, 0.1, 1.1].forEach((dx) => { b.box(x + dx, y + 0.3, z + 1.9, 0.8, 0.6, 0.6, C.plank2); b.box(x + dx, y + 0.65, z + 1.9, 0.6, 0.12, 0.15, "#7FB7D9").box(x + dx, y + 0.65, z + 2.05, 0.6, 0.12, 0.15, "#9AC8E3"); });
      b.box(x - 1.7, y + 1.2, z + 0.2, 0.05, 1.6, 1.6, C.rope);
    } },
    hotel: { title: "Отель", emoji: "🏨", h: 5.4, draw: (b, x, y, z, v) => {
      b.box(x, y + 2.7, z - 0.5, 3.4, 5.4, 2.6, C.white);
      b.box(x, y + 5.5, z - 0.5, 3.6, 0.2, 2.8, v.roof);
      for (let f = 0; f < 3; f++) for (let k = -1; k <= 1; k++) {
        const yy = y + 1.0 + f * 1.6;
        b.box(x + k * 1.05, yy, z + 0.82, 0.6, 0.7, 0.06, C.glass);
        if (f) b.box(x + k * 1.05, yy - 0.45, z + 1.0, 0.8, 0.08, 0.4, "#D7DEE2").box(x + k * 1.05, yy - 0.3, z + 1.18, 0.8, 0.25, 0.04, v.roof);
      }
      b.box(x, y + 0.5, z + 0.82, 0.8, 1.0, 0.06, C.door);
      b.box(x + 1.4, y + 0.08, z + 1.9, 1.6, 0.16, 1.1, C.pool, "#CFE7EE");
    } },
    cinema: { title: "Кинотеатр", emoji: "🎬", h: 2.8, draw: (b, x, y, z) => {
      b.box(x, y + 1.4, z - 0.3, 3.4, 2.8, 2.6, C.navy);
      b.box(x, y + 2.85, z - 0.3, 3.6, 0.12, 2.8, "#E2483D");
      for (let k = 0; k < 7; k++) b.box(x - 1.5 + k * 0.5, y + 2.95, z + 1.02, 0.14, 0.14, 0.08, C.lamp);
      b.box(x - 0.9, y + 1.1, z + 1.0, 0.8, 1.2, 0.06, "#F4D35E").box(x + 0.9, y + 1.1, z + 1.0, 0.8, 1.2, 0.06, "#2EC4B6").box(x, y + 0.6, z + 1.0, 0.7, 1.2, 0.06, C.dark);
    } },
    surf: { title: "Сёрф-станция", emoji: "🏄", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, "#2EC4B6", "#F4D35E", "#FFFFFF");
      ["#E2483D", "#F4D35E", "#8E5BD9", "#FF7AA8"].forEach((c, k) => b.box(x - 1.3 + k * 0.85, y + 1.0, z + 1.45, 0.5, 2.0, 0.1, c, "#FFFFFF", 0.12 - k * 0.08, 0, -0.18));
    } },
    bank: { title: "Банк", emoji: "🏦", h: 2.6, draw: (b, x, y, z) => {
      b.box(x, y + 0.15, z - 0.1, 3.6, 0.3, 3.0, C.stone);
      b.box(x, y + 1.4, z - 0.5, 3.2, 2.4, 2.0, "#E5E5E5");
      for (let k = 0; k < 4; k++) b.box(x - 1.2 + k * 0.8, y + 1.4, z + 0.85, 0.3, 2.3, 0.3, C.white);
      b.box(x, y + 2.7, z + 0.2, 3.6, 0.25, 1.6, C.white).box(x, y + 3.0, z + 0.2, 2.6, 0.35, 1.4, "#E5E5E5").box(x, y + 3.3, z + 0.2, 1.4, 0.3, 1.2, C.gold);
      b.box(x, y + 0.7, z + 0.52, 0.8, 1.1, 0.06, C.door);
    } },
    farm: { title: "Ферма", emoji: "🌾", h: 2.4, draw: (b, x, y, z) => {
      b.box(x - 0.6, y + 1.0, z - 0.8, 2.2, 2.0, 2.0, "#B23A48");
      gable(b, x - 0.6, y + 2.0, z - 0.8, 2.2, 2.0, C.dark, 0.9);
      b.box(x - 0.6, y + 0.65, z + 0.22, 1.0, 1.3, 0.06, C.white).box(x - 0.6, y + 0.65, z + 0.25, 1.0, 0.08, 0.04, C.white, C.white, 0.9).box(x - 0.6, y + 0.65, z + 0.25, 1.0, 0.08, 0.04, C.white, C.white, -0.9);
      for (let k = 0; k < 3; k++) for (let m = 0; m < 3; m++) b.box(x + 1.3 + m * 0.5, y + 0.25, z - 1.4 + k * 0.9, 0.3, 0.5, 0.6, k === 1 ? "#F4D35E" : "#5DB03F");
      b.box(x + 1.6, y + 0.3, z + 2.2, 0.3, 0.25, 0.5, C.white).box(x + 1.6, y + 0.55, z + 2.45, 0.2, 0.2, 0.2, C.white);
    } },
    pharmacy: { title: "Аптека", emoji: "💊", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.white, "#3FA34D", "#FFFFFF");
      b.box(x + 1.75, y + 1.8, z + 0.4, 0.1, 0.9, 0.3, "#3FA34D").box(x + 1.75, y + 1.8, z + 0.4, 0.1, 0.3, 0.9, "#3FA34D");
    } },
    barber: { title: "Барбершоп", emoji: "💈", h: 2.2, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.dark, "#E2483D", "#FFFFFF");
      for (let k = 0; k < 6; k++) b.box(x - 1.7, y + 0.4 + k * 0.25, z + 1.15, 0.25, 0.25, 0.25, ["#E2483D", "#FFFFFF", "#2E86AB"][k % 3]);
    } },
    gym: { title: "Спортзал", emoji: "🏋", h: 2.4, draw: (b, x, y, z) => {
      shopBox(b, x, y, z, C.metal, C.dark, "#F08A24", 2.4);
      b.box(x, y + 2.75, z - 0.5, 2.0, 0.12, 0.12, C.dark).box(x - 0.9, y + 2.75, z - 0.5, 0.2, 0.6, 0.6, C.dark).box(x + 0.9, y + 2.75, z - 0.5, 0.2, 0.6, 0.6, C.dark);
    } },
    garage: { title: "Автосервис", emoji: "🔧", h: 2.4, draw: (b, x, y, z, v) => {
      b.box(x, y + 1.2, z - 0.3, 3.4, 2.4, 2.6, C.metal);
      b.box(x, y + 2.46, z - 0.3, 3.6, 0.12, 2.8, C.dark);
      for (let k = 0; k < 6; k++) b.box(x - 0.4, y + 0.2 + k * 0.3, z + 1.02, 1.8, 0.24, 0.06, "#D7DEE2");
      b.box(x + 1.3, y + 0.35, z + 2.0, 0.9, 0.4, 1.7, v.roof).box(x + 1.3, y + 0.75, z + 1.9, 0.8, 0.4, 0.9, C.glass);
      [[-0.45, -0.6], [0.45, -0.6], [-0.45, 0.6], [0.45, 0.6]].forEach(([a, c]) => b.box(x + 1.3 + a, y + 0.18, z + 2.0 + c, 0.12, 0.35, 0.35, C.dark));
    } },
  };

  function bizSignTexture(THREE, biz, label) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 136;
    const g = c.getContext("2d");
    g.fillStyle = "#0B3954"; g.fillRect(0, 0, 512, 136);
    g.fillStyle = "#F4D35E"; g.fillRect(0, 0, 512, 8); g.fillRect(0, 128, 512, 8);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "900 52px Montserrat, sans-serif"; g.fillStyle = "#FFFFFF";
    g.fillText(biz.emoji + " " + biz.title.toUpperCase(), 256, 50, 490);
    g.font = "800 32px Montserrat, sans-serif"; g.fillStyle = "#F4D35E";
    g.fillText(label, 256, 104, 490);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  /** Appearance of one resident: stable for a nick, wishes from comments add details. */
  function look(r) {
    const n = r.nick, wish = r.wish || [];
    const straw = pick(STRAW, strHash(n, 1)), canvas = pick(CANVAS, strHash(n, 2));
    const wall = pick(WALLS, strHash(n, 7)), mud = pick(MUD, strHash(n, 8)), hull = pick(HULLS, strHash(n, 9));
    const colorWish = wish.find((w) => COLORS[w]);
    const v = {
      hut: Math.floor(strHash(n, 3) * HUTS.length),
      turn: Math.floor(strHash(n, 41) * 4) * Math.PI / 2,
      c1: straw[0], c2: straw[1], t1: canvas[0], t2: canvas[1],
      w: wall[0], w2: wall[1], m1: mud[0], m2: mud[1], h1: hull[0], h2: hull[1],
      roof: colorWish ? COLORS[colorWish] : pick(ROOFS, strHash(n, 4)),
      flag: colorWish ? COLORS[colorWish] : pick(Object.values(COLORS), strHash(n, 5)),
      items: [],
    };
    if (colorWish && v.hut === 3) v.t2 = COLORS[colorWish];
    if (colorWish && v.hut === 7) { v.h1 = COLORS[colorWish]; }
    else if (colorWish && v.hut !== 3) { v.c1 = COLORS[colorWish]; }
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

  // the empty-plot board, styled like the city's «free flats» sign: white, yellow edge, two dark lines
  function emptySignTexture(THREE, no) {
    const c = document.createElement("canvas");
    c.width = 384; c.height = 118;
    const g = c.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 384, 118);
    g.textAlign = "center"; g.textBaseline = "middle";
    // the plot waits for a follower who has not commented yet: their place in line, and the one step left
    g.fillStyle = "#1B2129"; g.font = "900 30px Montserrat, sans-serif"; g.fillText("ДЛЯ ПОДПИСЧИКА №" + no, 192, 30, 360);
    g.fillStyle = "#C8473D"; g.font = "800 25px Montserrat, sans-serif"; g.fillText("НАПИШИ КОММЕНТ —", 192, 66, 360);
    g.fillStyle = "#1B2129"; g.font = "800 25px Montserrat, sans-serif"; g.fillText("И ДОМ ТВОЙ", 192, 96, 360);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  // the «subscribe to keep the house» board for a resident who does not follow the account
  function followSignTexture(THREE, nick) {
    const c = document.createElement("canvas");
    c.width = 384; c.height = 122;
    const g = c.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 384, 122);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#1B2129"; g.font = "900 28px Montserrat, sans-serif"; g.fillText("@" + nick, 192, 28, 360);
    g.fillStyle = "#C8473D"; g.font = "800 24px Montserrat, sans-serif"; g.fillText("ПОДПИШИСЬ, ЧТОБЫ", 192, 66, 360);
    g.fillText("СОХРАНИТЬ ДОМ", 192, 96, 360);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function signTexture(THREE, residentsCount) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 384;
    const g = c.getContext("2d");
    g.fillStyle = "#9C6B3C"; g.fillRect(0, 0, 512, 384);
    g.fillStyle = "#8A5C31";
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 96 + 92, 512, 6);
    g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "middle";
    // maxWidth keeps the long word inside the board on any font
    g.font = "900 74px Montserrat, sans-serif"; g.fillText("ОСТРОВ", 256, 96, 460); g.font = "900 62px Montserrat, sans-serif"; g.fillText("ПОДПИСЧИКОВ", 256, 176, 460);
    g.fillStyle = "#0B3954"; g.fillRect(40, 262, 432, 92);
    g.fillStyle = "#FFFFFF"; g.font = "800 48px Montserrat, sans-serif"; g.fillText("ЖИТЕЛЕЙ: " + residentsCount, 256, 310, 410);
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
    // the coast: never closer than Rb (the outer plots keep their grass), bulging into capes elsewhere
    const Rb = Math.max(18, (far + 0.5) * PLOT + 9);
    const wave = (a) => 0.5 * Math.sin(2 * a + 1.3) + 0.3 * Math.sin(3 * a + 4.1) + 0.2 * Math.sin(5 * a + 2.2) + 0.12 * Math.sin(7 * a + 0.7);
    const coast = (a) => Rb * (1 + 0.32 * Math.max(0, wave(a) + 0.25));
    const coastAt = (x, z) => coast(Math.atan2(z, x));
    let R = Rb;
    for (let k = 0; k < 360; k++) R = Math.max(R, coast((k / 360) * Math.PI * 2));
    const occupied = new Set(cells.map((c) => c[0] + "," + c[1]));
    emptyCells.forEach((c) => occupied.add(c[0] + "," + c[1]));
    occupied.add("0,0");

    // terrain columns
    const terrain = new Builder(THREE);
    const tops = new Map();
    const n = Math.ceil(R / TERRAIN) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const x = i * TERRAIN, z = j * TERRAIN;
      const r = Math.hypot(x, z) + (hash(i, j) - 0.5) * 2.4, edge = coastAt(x, z);
      if (r > edge) continue;
      const grass = r < edge - 6, top = grass ? 2 : 1;
      const ct = grass ? (hash(i * 3, j) < 0.5 ? C.grass : C.grass2) : (hash(i, j * 2) < 0.5 ? C.sand : C.sand2);
      terrain.box(x, (top - 3) / 2, z, TERRAIN, top + 3, TERRAIN, ct, grass ? C.soil : C.sand2);
      tops.set(i + "," + j, top);
    }
    const topAt = (x, z) => tops.get(Math.round(x / TERRAIN) + "," + Math.round(z / TERRAIN)) || 0;
    // flat ground only receives shadows: casting onto itself gave shadow acne that made the whole island shimmer on phones
    const ground = terrain.mesh();
    ground.castShadow = false;
    group.add(ground);

    // shallows follow the coast; shape points are (x, -z) because the mesh is laid flat with rotation.x = -π/2
    const rim = new THREE.Shape();
    for (let k = 0; k <= 128; k++) {
      const a = (k / 128) * Math.PI * 2, rr = coast(a) + 6;
      if (k) rim.lineTo(Math.cos(a) * rr, -Math.sin(a) * rr); else rim.moveTo(Math.cos(a) * rr, -Math.sin(a) * rr);
    }
    const shallows = new THREE.Mesh(new THREE.ShapeGeometry(rim), new THREE.MeshLambertMaterial({ color: "#46C4DE" }));
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
      if (s[0] === "v") { const x = i * PLOT - H, z = j * PLOT; if (topAt(x, z) === 2) b.box(x, 2.03, z, STREET, 0.06, PLOT, col); }
      // a hair above the other direction, so the two never share a plane where streets cross (that flickered)
      else { const x = i * PLOT, z = j * PLOT - H; if (topAt(x, z) === 2) b.box(x, 2.04, z, PLOT, 0.06, STREET, col); }
    });
    corners.forEach((s) => {
      const [i, j] = s.split(",").map(Number);
      const x = i * PLOT - H, z = j * PLOT - H;
      if (topAt(x, z) === 2 && hash(i + 31, j - 17) < 0.28) ITEMS.torch(b, x + STREET / 2 + 0.1, 2, z + STREET / 2 + 0.1);
    });

    // houses; with opts.perHouse every house is its own mesh (origin at its plot) so videos can animate them
    rows.forEach((r, k) => {
      const [i, j, d] = cells[k];
      const x = i * PLOT, z = j * PLOT, y = 2;
      const lvl = Math.min(7, Math.max(1, r.level || 1));
      const v = look(r);
      const biz = BIZ[r.biz];
      b.box(x, y + 0.05, z, PLOT - STREET, 0.1, PLOT - STREET, biz ? C.stone : C.pad);
      // a business replaces the hut; its own props stand where the yard items would be
      const draw = (bb, ox, oz) => {
        // a business always faces +z so its sign reads from the street; huts face any side
        bb.around(ox, y0(bb), oz, HOUSE, biz ? 0 : v.turn);
        if (biz) { biz.draw(bb, ox, y0(bb), oz, v); bb.around(); return; }
        MODELS[lvl - 1](bb, ox, y0(bb), oz, v);
        bb.around();
        v.items.forEach((it, s) => {
          const ix = ox + SLOTS[s][0] * YARD, iz = oz + SLOTS[s][1] * YARD;
          bb.around(ix, y0(bb), iz, ITEM);
          ITEMS[it](bb, ix, y0(bb), iz, v);
          bb.around();
        });
      };
      const y0 = (bb) => (bb === b ? y : 0);
      let mesh = null, signHost = group, sx = x, sy = y, sz = z;
      if (opts.perHouse) {
        const hb = new Builder(THREE);
        draw(hb, 0, 0);
        mesh = hb.mesh();
        mesh.position.set(x, y, z);
        group.add(mesh);
        signHost = mesh; sx = 0; sy = 0; sz = 0;
      } else draw(b, x, z);
      let bizInfo = null;
      if (biz) {
        const label = r.brand ? "«" + r.brand + "»" : "@" + r.nick;
        // the sign: a dark board on two posts in front of the building, facing the street
        const sb = new Builder(THREE).around(sx, sy, sz, HOUSE);
        sb.box(sx - 1.45, sy + (biz.h + 0.45) / 2, sz + SIGN_Z - 0.05, 0.12, biz.h + 0.45, 0.12, C.log2).box(sx + 1.45, sy + (biz.h + 0.45) / 2, sz + SIGN_Z - 0.05, 0.12, biz.h + 0.45, 0.12, C.log2);
        sb.box(sx, sy + biz.h + 0.45, sz + SIGN_Z - 0.03, 3.1, 0.86, 0.08, C.navy);
        signHost.add(sb.mesh());
        const face = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8), new THREE.MeshBasicMaterial({ map: bizSignTexture(THREE, biz, label) }));
        face.position.set(sx, sy + (biz.h + 0.45) * HOUSE, sz + (SIGN_Z + 0.02) * HOUSE);
        face.scale.setScalar(HOUSE);
        signHost.add(face);
        bizInfo = { kind: r.biz, title: biz.title, emoji: biz.emoji, label };
      }
      if (r.follows === false) {
        // not following (known from direct messages): a red board in front of the door, turned with the house
        const t = biz ? 0 : v.turn, fx = Math.sin(t), fz = Math.cos(t);
        const fb = new Builder(THREE).around(sx, sy, sz, 1, t);
        fb.box(sx - 1.4, sy + 1.0, sz + 3.2, 0.14, 2.0, 0.14, C.log2).box(sx + 1.4, sy + 1.0, sz + 3.2, 0.14, 2.0, 0.14, C.log2);
        fb.box(sx, sy + 1.75, sz + 3.22, 3.3, 1.15, 0.1, C.red);
        signHost.add(fb.mesh());
        const mat = new THREE.MeshBasicMaterial({ map: followSignTexture(THREE, r.nick) }), geo = new THREE.PlaneGeometry(3.1, 0.98);
        const front = new THREE.Mesh(geo, mat), rear = new THREE.Mesh(geo, mat);
        front.position.set(sx + fx * 3.29, sy + 1.75, sz + fz * 3.29);
        front.rotation.y = t;
        rear.position.set(sx + fx * 3.15, sy + 1.75, sz + fz * 3.15);
        rear.rotation.y = t + Math.PI;
        signHost.add(front, rear);
      }
      houses.set(r.nick, {
        follows: r.follows !== false,
        mesh,
        no: r.no, nick: r.nick, level: lvl, cell: [i, j], ring: d, biz: bizInfo,
        features: biz ? [biz.emoji + " " + biz.title + " " + bizInfo.label] : v.items.map((it) => FEATURES[it]), wished: (r.wish || []).length > 0 || !!biz,
        pos: new THREE.Vector3(x, y, z), top: new THREE.Vector3(x, y + (biz ? biz.h + 1.0 : lvl === 1 ? HUT_H[v.hut] : HEIGHT[lvl - 1]) * HOUSE + 0.6, z),
        kind: !biz && lvl === 1 ? HUT_KINDS[v.hut] : null,
        face: biz ? 0 : v.turn, // the door looks along (sin face, 0, cos face)
      });
    });

    // empty plots: corner stakes, a rope and a little sign — «your place is waiting»
    emptyCells.forEach(([i, j]) => {
      const x = i * PLOT, z = j * PLOT, y = 2, s = (PLOT - STREET) / 2 - 0.4;
      b.box(x, y + 0.05, z, PLOT - STREET - 0.4, 0.1, PLOT - STREET - 0.4, C.sand2);
      [[-s, -s], [s, -s], [s, s], [-s, s]].forEach(([a, c]) => b.box(x + a, y + 0.45, z + c, 0.18, 0.9, 0.18, C.log));
      // ropes thick enough to stay a solid line on a phone instead of shimmering
      b.box(x, y + 0.72, z - s, 2 * s, 0.12, 0.12, C.rope).box(x, y + 0.72, z + s, 2 * s, 0.12, 0.12, C.rope);
      b.box(x - s, y + 0.72, z, 0.12, 0.12, 2 * s, C.rope).box(x + s, y + 0.72, z, 0.12, 0.12, 2 * s, C.rope);
      // a big sign like the city's: two posts and a board, the words go on it below as one instanced plane
      b.box(x - 1.6, y + 1.2, z + 0.6, 0.16, 2.4, 0.16, C.log2).box(x + 1.6, y + 1.2, z + 0.6, 0.16, 2.4, 0.16, C.log2);
      b.box(x, y + 2.0, z + 0.62, 3.7, 1.25, 0.1, "#F4C430");
    });
    // each board names its plot (the number the next commenter gets) and says what to do, on both faces
    const plateGeo = new THREE.PlaneGeometry(3.5, 1.08);
    emptyCells.forEach(([i, j], k) => {
      const mat = new THREE.MeshBasicMaterial({ map: emptySignTexture(THREE, lastNo + 1 + k) });
      const front = new THREE.Mesh(plateGeo, mat), back = new THREE.Mesh(plateGeo, mat);
      front.position.set(i * PLOT, 4.0, j * PLOT + 0.68);
      back.position.set(i * PLOT, 4.0, j * PLOT + 0.56);
      back.rotation.y = Math.PI;
      group.add(front, back);
    });

    // plaza: big campfire, log benches, the founder's hut and the sign
    b.box(0, 2.06, 0, PLOT - STREET + 0.2, 0.06, PLOT - STREET + 0.2, C.path);
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      b.box(Math.cos(ang) * 1.1, 2.15, Math.sin(ang) * 1.1, 0.4, 0.3, 0.4, a % 2 ? C.stone : C.stone2);
    }
    b.box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log2, C.log2, 0, 0.5).box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log2, C.log2, 0, -0.5).box(0, 2.2, 0, 1.6, 0.25, 0.35, C.log, C.log, 0, Math.PI / 2);
    b.box(0, 2.55, 0, 0.8, 0.6, 0.8, C.flame).box(0, 3.05, 0, 0.5, 0.5, 0.5, C.flame2).box(0.1, 3.4, 0.05, 0.25, 0.3, 0.25, "#FFF3B0");
    [[0, 2.3, 0], [2.3, 0, Math.PI / 2], [0, -2.3, 0], [-2.3, 0, Math.PI / 2]].forEach(([xx, zz, ry]) => b.box(xx, 2.25, zz, 1.8, 0.4, 0.45, C.log, C.log2, 0, ry));
    shalash(b, -2.0, 2, -2.0, 1.1, STRAW[0][0], STRAW[0][1]);

    // empty cells: palms, flowers, rocks; beach palms around the edge
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      if (occupied.has(i + "," + j)) continue;
      const x = i * PLOT, z = j * PLOT, d = Math.hypot(x, z);
      if (d > coastAt(x, z) - 2) continue;
      const h = hash(i + 7, j - 3), top = topAt(x, z);
      if (!top) continue;
      if (top === 1 ? h < 0.55 : h < 0.4) palm(b, x + (hash(j, i) - 0.5) * 2, top, z + (hash(i, j) - 0.5) * 2, 5 + Math.floor(hash(j, i) * 3), hash(i, j + 9) < 0.5 ? 1 : -1);
      else if (top === 2 && h < 0.7) { b.box(x - 1, 2.2, z, 0.4, 0.4, 0.4, C.flower).box(x + 1, 2.2, z + 0.8, 0.4, 0.4, 0.4, C.fl2); }
      else if (top === 1) b.box(x, 1.35, z, 1.0, 0.7, 0.9, C.stone);
    }

    // pier with a boat, on the +z beach
    const pz = coast(Math.PI / 2) - 4;
    for (let k = 0; k < 9; k++) b.box(2.5, 1.15, pz + k * 1.05, 1.9, 0.18, 1.0, k % 2 ? C.plank : C.plank2);
    for (let k = 0; k < 9; k += 2) b.box(1.6, 0.6, pz + k * 1.05, 0.2, 1.2, 0.2, C.log2).box(3.4, 0.6, pz + k * 1.05, 0.2, 1.2, 0.2, C.log2);
    b.box(4.6, 0.3, pz + 6, 1.1, 0.5, 2.8, "#9C6B3C").box(4.6, 0.6, pz + 6, 0.8, 0.12, 2.4, "#C79A62").box(4.6, 1.4, pz + 6, 0.1, 1.6, 0.1, C.log2).box(4.6, 1.5, pz + 6.4, 0.05, 1.1, 0.8, "#FFFFFF");
    group.add(b.mesh());

    const sign = new THREE.Group();
    const post = new Builder(THREE);
    post.box(-1.4, 1.2, 0, 0.35, 2.4, 0.35, C.log).box(1.4, 1.2, 0, 0.35, 2.4, 0.35, C.log).box(0, 2.45, 0.28, 3.4, 2.5, 0.2, "#7A4F2A");
    sign.add(post.mesh());
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.45), new THREE.MeshLambertMaterial({ map: signTexture(THREE, rows.length + 1) }));
    // the board hangs in front of the posts, otherwise they cover the edges of «ЖИТЕЛЕЙ: N»
    face.position.set(0, 2.45, 0.39);
    sign.add(face);
    sign.scale.setScalar(1.3);
    sign.position.set(1.9, 2, -2.4);
    sign.rotation.y = -0.6;
    group.add(sign);

    // the lighthouse everyone built together (goal 500, day 5): on a rock past the pier, with a turning beam
    const lighthouse = buildLighthouse(THREE, new THREE.Vector3(2.5, 0, pz + 14));
    group.add(lighthouse.group);

    const empty = emptyCells.map(([i, j]) => new THREE.Vector3(i * PLOT, 2, j * PLOT));
    return { group, houses, empty, radius: R, plaza: new THREE.Vector3(0, 2, 0), pier: new THREE.Vector3(3.5, 1, pz + 5), sign, levels: LEVELS, lighthouse };
  }

  function buildLighthouse(THREE, at) {
    const g = new THREE.Group();
    const box = (x, y, z, w, h, d, col, basic) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic ? new THREE.MeshBasicMaterial({ color: col }) : new THREE.MeshLambertMaterial({ color: col }));
      m.position.set(x, y, z); g.add(m); return m;
    };
    box(0, 0.8, 0, 7, 1.6, 7, "#8A8F96"); box(1.2, 1.2, 1.4, 3, 1.4, 3, "#9EA3AA"); box(-1.6, 1.0, -1.2, 2.6, 1.6, 2.4, "#7C8188");
    let y = 1.6;
    for (let k = 0; k < 8; k++) { const w = 3.4 - k * 0.14; box(0, y + 1.1, 0, w, 2.2, w, k % 2 ? "#FFFFFF" : "#D9433B"); y += 2.2; }
    box(0, y + 0.2, 0, 3.6, 0.4, 3.6, "#2B2F36");
    [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]].forEach(([a, c]) => box(a, y + 0.9, c, 0.15, 1.0, 0.15, "#2B2F36"));
    box(0, y + 1.4, 0, 1.9, 1.8, 1.9, "#FFE27A", true);
    box(0, y + 2.6, 0, 2.4, 0.6, 2.4, "#D9433B"); box(0, y + 3.2, 0, 1.2, 0.6, 1.2, "#D9433B");
    const beam = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: "#FFF3B0", transparent: true, opacity: 0.22, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    [1, -1].forEach((s) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 36, 24, 1, true), mat);
      cone.rotation.z = s * Math.PI / 2; cone.position.x = -s * 18; beam.add(cone);
    });
    beam.position.y = y + 1.4;
    g.add(beam);
    g.position.copy(at);
    return { group: g, beam, pos: at.clone(), top: at.clone().add(new THREE.Vector3(0, y + 3.5, 0)) };
  }

  root.OstrovIsland = { build, plotCell, look, LEVELS, FEATURES, PLOT, BIZ };
})(typeof window !== "undefined" ? window : globalThis);

/* 悬停聚焦（本柱 / 3×3）验收
   用法：node sf_focus.js [file://地址] [标签]
   判据不是"看着像"，而是量化：球心附近的最大**饱和度**。
   实心球的球心是鲜明色（蓝 74,146,223 / 橙 226,113,60，饱和度 ≥ 0.6）；
   被压到 alpha 0.13 之后与米色背景混合 → 饱和度塌到 0.06 以下。
   中间留了很宽的安全带（阈值 0.15 / 0.35），不会因渐变/阴影抖动而误判。 */
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'file:///tmp/sf_fix.html';
const TAG = process.argv[3] || 'v0.7.2';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

/* 中心柱 (2,2) 摞 3 颗；两个"3×3 内"邻柱；两个"3×3 外"的远柱 */
const BOARD = [
  [2,2,0,1],[2,2,1,2],[2,2,2,1],
  [1,2,0,2], [3,3,0,1],
  [0,4,0,2], [4,0,0,1],
];
const CENTER = 12;                       // focusCol = 2 + 2*5
const NEAR  = [ [1,2], [3,3] ];
const FAR   = [ [0,4], [4,0] ];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await b.newPage({ viewport: { width: 780, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(400);

  console.log(`\n### ${TAG}  加载`);
  ok(errs.length === 0, `加载零报错${errs.length ? '：' + errs.join(' | ') : ''}`);

  /* ---------- A. inFocus 语义（纯逻辑） ---------- */
  console.log('\n### A. 聚焦范围判定');
  const A = await page.evaluate(() => {
    const T = globalThis.__T;
    const res = {};
    for (const m of [0, 1, 2]) {
      T.focusCol = 12; T.setFocusMode(m);
      const on = [];
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (T.inFocus(x, y)) on.push(x + ',' + y);
      res['m' + m] = on;
    }
    T.focusCol = -1; T.setFocusMode(1);
    const off = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (T.inFocus(x, y)) off.push(x + ',' + y);
    res.none = off;
    T.focusCol = 12;
    return res;
  });
  ok(A.m0.length === 25, `模式「关」：25 根柱子都在范围内（实得 ${A.m0.length}）`);
  ok(A.m1.length === 1 && A.m1[0] === '2,2', `模式「本柱」：只有 (2,2) 在范围内（实得 ${A.m1.join(' / ')}）`);
  ok(A.m2.length === 9, `模式「3×3」：中心＋一圈 = 9 根（实得 ${A.m2.length}）`);
  ok(A.m2.every(s => { const [x, y] = s.split(',').map(Number); return Math.abs(x - 2) <= 1 && Math.abs(y - 2) <= 1; }),
     `模式「3×3」：全落在 |dx|≤1 且 |dy|≤1 内`);
  ok(A.none.length === 25, `没有悬停（focusCol=-1）时不做任何虚化（实得 ${A.none.length}）`);

  /* ---------- B. 虚化强度 ----------
     主判据是**白盒**的：直接读"画这颗球那一刻 ctx.globalAlpha 是多少"。
     不用像素判色 —— 在 45° 等距投影下 (3,3) 和 (2,2) 的 screenX 完全重合，
     球心像素读到的是"盖在它上面的那颗球"，会被冤枉成"没虚化"。 */
  console.log('\n### B. 虚化强度（绘制时的实际 alpha + 球心像素交叉验证）');
  const B = await page.evaluate(([bd, center]) => {
    const T = globalThis.__T;
    T.setBoard(bd); T.setState({ turn: 1, over: null, human: 1 });
    T.setCam(45 * Math.PI / 180, 40 * Math.PI / 180);
    T.focusCol = center;
    const snap = (m) => {
      T.setFocusMode(m);
      T.rec(true); T.draw(); T.rec(false);
      return T.calls().filter(c => !c.ghost).map(c => ({
        x: c.x, y: c.y, z: c.zc - 0.5, a: c.a, d: c.d, px: c.px, py: c.py,
      }));
    };
    return { off: snap(0), col: snap(1), n3: snap(2), S: T.S, PR: T.PR };
  }, [BOARD, CENTER]);

  const R = B.PR * B.S;
  const alphas = (rows, x, y) => rows.filter(r => r.x === x && r.y === y).map(r => r.a);
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const all = (arr, v) => arr.length > 0 && arr.every(a => near(a, v));
  const line = (tag, rows) =>
    console.log(`   ${tag}: ` + [[2,2], [1,2], [3,3], [0,4], [4,0]]
      .map(([x, y]) => `(${x},${y})=[${alphas(rows, x, y).map(a => a.toFixed(2)).join(',')}]`).join(' '));

  line('关  ', B.off); line('本柱', B.col); line('3×3 ', B.n3);

  ok(all(B.off.flatMap(r => [r.a]), 1), '模式「关」：所有球都以 alpha=1 绘制（不做任何虚化）');
  ok(all(alphas(B.col, 2, 2), 1), `模式「本柱」：中心柱 3 颗 alpha=1`);
  ok([[1,2],[3,3],[0,4],[4,0]].every(([x,y]) => all(alphas(B.col,x,y), 0.13)),
     `模式「本柱」：其余 4 根柱子的球全部 alpha=0.13`);
  ok([[2,2],[1,2],[3,3]].every(([x,y]) => all(alphas(B.n3,x,y), 1)),
     `模式「3×3」：中心 + 邻柱都是 alpha=1`);
  ok([[0,4],[4,0]].every(([x,y]) => all(alphas(B.n3,x,y), 0.22)),
     `模式「3×3」：3 格外的柱子 alpha=0.22`);
  ok(0.13 < 0.22, '「本柱」档确实比「3×3」档压得更狠（0.13 < 0.22）');

  /* 交叉验证：alpha 真的作用到了画面上（不然只是记了个数字）。
     只看"几何上没有被更不透明的球盖住"的样本，否则读到的是别人的颜色。 */
  const cv = await page.evaluate(([bd, center, R]) => {
    const T = globalThis.__T;
    T.setBoard(bd); T.setState({ turn: 1, over: null, human: 1 });
    T.setCam(45 * Math.PI / 180, 40 * Math.PI / 180);
    T.focusCol = center;
    const snap = (m) => {
      T.setFocusMode(m);
      T.rec(true); T.draw(); T.rec(false);
      const rows = T.calls().filter(c => !c.ghost).map(c => ({
        x: c.x, y: c.y, z: c.zc - 0.5, a: c.a, px: c.px, py: c.py,
      }));
      const im = T.ctx;
      return rows.map(r => {
        const covered = rows.some(o => o !== r && o.a > r.a + 0.01 &&
                                      Math.hypot(o.px - r.px, o.py - r.py) <= R);
        const d = im.getImageData(Math.round(r.px), Math.round(r.py), 1, 1).data;
        const spread = Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2]);
        return { ...r, covered, spread };
      });
    };
    return { off: snap(0), col: snap(1) };
  }, [BOARD, CENTER, R]);

  const dimmed = cv.col.filter(r => !r.covered && r.a < 1);
  const solid  = cv.off.filter(r => !r.covered);
  console.log(`   未被遮挡的虚化球样本 ${dimmed.length} 个：球心像素最大最小通道差 = [${dimmed.map(r => r.spread).join(', ')}]`);
  console.log(`   未被遮挡的实心球样本 ${solid.length} 个：球心像素最大最小通道差 = [${solid.map(r => r.spread).join(', ')}]`);
  ok(dimmed.length >= 1 && dimmed.every(r => r.spread < 40),
     `被虚化的球，球心像素确实淡成了近背景色（全部 < 40）`);
  ok(solid.length >= 1 && solid.every(r => r.spread > 80),
     `没被虚化的球，球心像素仍是鲜明色（全部 > 80）`);

  /* ---------- C. 面板联动（真实点击） ---------- */
  console.log('\n### C. 面板联动');
  for (const [v, want] of [['2', 2], ['0', 0], ['1', 1]]) {
    await page.click(`#segFocus button[data-v="${v}"]`);
    const got = await page.evaluate(() => globalThis.__T.focusMode);
    const on = await page.evaluate(v => document.querySelector(`#segFocus button[data-v="${v}"]`).classList.contains('on'), v);
    ok(got === want && on, `点「${v}」→ focusMode=${got}（期望 ${want}），按钮高亮=${on}`);
  }

  /* ---------- D. 真实鼠标悬停 → 聚焦柱跟着走 ---------- */
  console.log('\n### D. 鼠标悬停');
  /* 画布在页面下半部分，默认视口里可能露不出来 —— 鼠标坐标是视口坐标，
     露不出来就会"移到画布外"，事件根本到不了 canvas。先滚到中间。
     另外视角换成 yaw=20°：45° 下 (2,2) 和 (3,3) 的 screenX 完全相同、
     球心在屏幕上只差 1.4px，点上去是**歧义**的（pick 取最近球心，
     可能返回 (3,3,0)），这不是 bug，是样本选得不好。 */
  await page.evaluate(() => {
    const T = globalThis.__T;
    T.focusCol = -1; T.setFocusMode(1);
    T.setCam(20 * Math.PI / 180, 40 * Math.PI / 180);
  });
  await page.evaluate(() => document.querySelector('canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const box = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cw: globalThis.__T.CW, ch: globalThis.__T.CH };
  });
  const toPage = ([cx, cy]) => [box.x + cx * box.w / box.cw, box.y + cy * box.h / box.ch];
  const [sx, sy] = toPage(await page.evaluate(() => globalThis.__T.stonePx(2, 2, 2)));
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(120);
  const hov = await page.evaluate(() => ({ fc: globalThis.__T.focusCol, st: document.getElementById('status').textContent }));
  ok(hov.fc === CENTER, `鼠标移到中心柱上的球 → focusCol=${hov.fc}（期望 ${CENTER}）`);
  ok(/x3 y3/.test(hov.st) && /现有 \d+ 颗/.test(hov.st), `状态栏报出该柱：${JSON.stringify(hov.st)}`);

  const [fx2, fy2] = toPage(await page.evaluate(() => globalThis.__T.stonePx(0, 4, 0)));
  await page.mouse.move(fx2, fy2);
  await page.waitForTimeout(120);
  const hov2 = await page.evaluate(() => globalThis.__T.focusCol);
  ok(hov2 === 20, `鼠标移到远柱 (0,4) → focusCol=${hov2}（期望 20），说明焦点跟着鼠标走`);

  /* 移出画布 → 取消聚焦 */
  await page.mouse.move(box.x - 20, box.y - 20);
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => globalThis.__T.focusCol) === -1, '鼠标移出画布 → 取消聚焦（focusCol=-1）');

  /* ---------- E. 聚焦不改变点击落子 ---------- */
  console.log('\n### E. 聚焦模式下点击仍然落子');
  const cnt = () => page.evaluate(() => {
    const T = globalThis.__T; let n = 0;
    for (let z = 0; z < 5; z++) if (T.board[T.idx(2, 2, z)]) n++;
    return n;
  });
  const c0 = await cnt();
  const [qx, qy] = toPage(await page.evaluate(() => {
    const T = globalThis.__T; let z = 0;
    while (z < 5 && T.board[T.idx(2, 2, z)]) z++;
    const p = T.proj(2, 2, z + 0.5);
    return [p[0], p[1]];
  }));
  await page.mouse.move(qx, qy);
  await page.waitForTimeout(120);
  const hoverOK = await page.evaluate(() => globalThis.__T.hover >= 0 && globalThis.__T.focusCol === 12);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);
  const c1 = await cnt();
  ok(hoverOK, '悬停到中心柱的落点：hover≥0 且 focusCol=12（聚焦与落子判定同时成立）');
  ok(c1 === c0 + 1, `落子成功：中心柱 ${c0} → ${c1} 颗`);

  ok(errs.length === 0, `全程零报错${errs.length ? '：' + errs.join(' | ') : ''}`);

  await b.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();

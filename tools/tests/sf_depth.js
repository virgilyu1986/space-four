// 深度顺序验收 v3：每个球心单像素 == "几何上离相机最近且盖住它的那颗球"的颜色
//   - 度量说明：球心取 1 像素。密集堆叠时球心附近 10px 内就可能跨到上/下色带，
//     所以"小 patch 多数色"会误判（这是度量问题，不是渲染问题，第一版就栽在这）。
//   - 球心若落在轮廓抗锯齿/上层球落下来的接触阴影上（深色像素）→ 记为"判不清"，
//     不计错，但要报出比例。
// 用法：node sf_depth.js <file://地址> [标签]
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'file:///tmp/sf_fix.html';
const LABEL = process.argv[3] || '当前版本';
const PR = 0.32;

const P1 = 1, P2 = 2;                       // P1 = 蓝（人）, P2 = 橙（AI）
const wantName = who => who === P2 ? '橙' : '蓝';
let pass = 0, fail = 0;
function ok(c, msg){ if(c){ pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(400);
  console.log(`### 被测：${LABEL}  (${URL})\n`);

  const render = (board, yawD, pitchD) => page.evaluate(([b, y, p]) => {
    const T = globalThis.__T;
    T.setBoard(b);
    T.setState({ turn: 0, over: null });
    T.setHover(-1);
    T.setCam(y * Math.PI / 180, p * Math.PI / 180);
    T.rec(true); T.draw(); T.rec(false);        // 先画再采样，并记录真实绘制顺序
    return { S: T.S, balls: T.readCenters(), calls: T.calls().filter(c=>!c.ghost) };
  }, [board, yawD, pitchD]);

  /* 几何上"球心 p 处该看到谁"：所有圆盘盖住 p 的球里，d 最小（离相机最近）的那颗。
     边缘豁免：pitch 76° 时相邻层的球心距 21.9px ≈ 球半径 22.3px —— 上一层球的
     轮廓线正好穿过下一层的球心，采到的是抗锯齿混合像素，判色无意义。
     所以只对"最近覆盖者把该点盖进 ≥2px"的**决定性样本**做断言，边缘样本单独计数。 */
  const MARGIN = 2.0;
  function check(tag, r, verbose) {
    const R = PR * r.S;
    let bad = 0, unclear = 0, edge = 0;
    const rows = [];
    r.balls.forEach(b => {
      let winner = b;
      for (const o of r.balls) {
        if (Math.hypot(o.px-b.px, o.py-b.py) <= R && o.d < winner.d - 1e-9) winner = o;
      }
      const cover = Math.hypot(winner.px-b.px, winner.py-b.py);
      const decisive = (winner === b) || (cover <= R - MARGIN);
      const c = b.center;                       // 球心单像素 [r,g,b]
      const isOrange = c[0] > 150 && c[0]-c[2] > 45 && c[1]-c[2] > 8;
      const isBlue   = c[2] > 140 && c[2]-c[0] > 30;
      const want = winner.who === P2 ? 'orange' : 'blue';
      const got = isOrange ? 'orange' : isBlue ? 'blue' : 'unclear';
      const good = got === want;
      let mark = '·';
      if (!decisive) { edge++; mark = '∠'; }
      else if (got === 'unclear') { unclear++; mark = '~'; }
      else if (!good) { bad++; mark = '×'; }
      rows.push(`   ${mark} (x${b.x+1}y${b.y+1}z${b.z+1}) 自己是${wantName(b.who)} d=${b.d.toFixed(2)}` +
                ` 球心=${got==='orange'?'橙':got==='blue'?'蓝':'判不清'} rgb=${c}` +
                ` 期望=最近覆盖者(x${winner.x+1}y${winner.y+1}z${winner.z+1}) ${wantName(winner.who)} 盖入${(R-cover).toFixed(1)}px`);
    });
    if (verbose) rows.forEach(x => console.log(x));
    ok(bad === 0, `${tag}：${r.balls.length} 颗球，决定性球心判色 == 最近覆盖者（错 ${bad}；判不清 ${unclear}；轮廓边缘样本 ${edge}）`);
    /* 独立不变量：真实绘制调用序列必须"远→近"（d 单调不增） */
    const ds = r.calls.map(c => c.d);
    ok(ds.every((d,i)=> i===0 || ds[i-1] >= d - 1e-9), `${tag}：真实绘制顺序"远→近"（${ds.length} 颗，d ${ds[0]?.toFixed(2)} → ${ds[ds.length-1]?.toFixed(2)}）`);
    return {bad, unclear, edge, total: r.balls.length};
  }

  console.log('=== S1 同柱两层：L1 橙 + L2 蓝，俯视 84° ===');
  check('S1', await render([[2,2,0,P2],[2,2,1,P1]], 45, 84), true);

  console.log('=== S2 同柱五层（橙蓝交替），俯视 84° ===');
  check('S2', await render([[2,2,0,P2],[2,2,1,P1],[2,2,2,P2],[2,2,3,P1],[2,2,4,P2]], 45, 84), true);

  console.log('=== S3 用户截图的视角 76°：中间柱 L1 橙 + L2 蓝，四角各一根矮柱 ===');
  check('S3', await render([[2,2,0,P2],[2,2,1,P1],[0,0,0,P1],[4,4,0,P2],[0,4,0,P2],[4,0,0,P1]], 45, 76), true);

  console.log('=== S4 跨柱前后：近柱蓝 vs 远柱橙，斜视 40° ===');
  check('S4', await render([[1,1,4,P1],[2,2,3,P2]], 45, 40), true);

  console.log('=== S5 斜视 40° 20 子回归（低俯仰本来就不出问题，别改坏）===');
  const b5 = [[0,0,0,P1],[0,0,1,P2],[1,1,0,P2],[1,1,1,P1],[2,2,0,P1],[2,2,1,P1],[3,3,0,P2],
              [3,3,1,P2],[4,4,0,P1],[4,4,1,P2],[0,4,0,P2],[4,0,0,P1],[2,0,0,P1],[2,0,1,P2],
              [0,2,0,P2],[4,2,0,P1],[1,3,0,P1],[3,1,0,P2],[2,4,0,P1],[2,4,1,P2]];
  check('S5', await render(b5, 45, 40), false);

  console.log('=== S6 五根不同高度的柱子（0~4 层），俯视 76° ===');
  const b6 = [];
  for (let k=0;k<5;k++) for (let z=0;z<=k;z++) b6.push([2,k,z,(z%2)?P1:P2]);
  check('S6', await render(b6, 45, 76), false);

  console.log('=== S7 全盘 125 子（满柱），俯视 76° ===');
  const b7 = [];
  for (let x=0;x<5;x++) for (let y=0;y<5;y++) for (let z=0;z<5;z++) b7.push([x,y,z,(x+y+z)%2?P1:P2]);
  const r7 = await render(b7, 45, 76);
  const res7 = check('S7', r7, false);
  /* 这一条原来断言 edge+unclear <= 60%，但俯视 76° 满柱时相邻层球心距 21.9px ≈
     球半径 22.3px —— 上一层球的轮廓线结构性地穿过下一层球心，edge 必然很高，
     拿它当判据是错的（量的是几何，不是正确性）。改成两条真判据 + 一行观察。 */
  ok(res7.unclear <= 0.10 * res7.total,
     `S7：判不清（球心读不出颜色）比例 ${(100*res7.unclear/res7.total).toFixed(1)}% ≤ 10%（全盘满柱下仍可读）`);
  console.log(`  · 观察：轮廓边缘样本 ${res7.edge}/${res7.total} —— 俯视满柱时结构性的（球心压在上一层轮廓线上），不计成败`);

  ok(errs.length === 0, '全程无 JS 异常' + (errs.length ? ' → ' + errs[0] : ''));
  console.log(`\n${LABEL} 结果：${pass} 通过 / ${fail} 失败`);
  await browser.close();
  process.exit(0);
})();

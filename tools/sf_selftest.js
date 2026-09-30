'use strict';
/* 自检 + 基准：验证「增量状态」和「从零重算」完全一致，再测节点速度 */
const E = require('./sf_engine.js');

let bad = 0, ok = 0;
function chk(cond, msg){ if(cond){ ok++; } else { bad++; console.log('  ✗ ' + msg); } }

console.log('== 1. 规则层 ==');
console.log('   四连线 LINES =', E.NL, '(期望 302)');
chk(E.NL === 302, 'LINES 数不等于 302');
console.log('   中心格(2,2,2) 穿过的线 =', E.CELLW[E.idx(2,2,2)], ' 角格 =', E.CELLW[E.idx(0,0,0)],
            ' 底面中心(2,2,0) =', E.CELLW[E.idx(2,2,0)]);
console.log('   每手合法点数 =', E.legalMoves().length, '(期望 25)');
chk(E.legalMoves().length === 25, '初始合法点数不是 25');

/* 竖直四连线有多少条（策略讲解要用） */
let vert = 0, inplane = 0, rising = 0;
for(const L of E.LINES){
  const s = new Set(L.map(c => E.XOA[c] + ',' + E.YOA[c]));
  if(s.size === 1) vert++;
  const zs = new Set(L.map(c => E.ZOA[c]));
  if(zs.size === 1) inplane++;
  if(zs.size > 1) rising++;
}
console.log('   竖直（同一根柱子）四连线 =', vert, ' 层内水平 =', inplane, ' 跨层斜线 =', rising);
chk(inplane + rising === E.NL, '层内 + 跨层 应等于总条数');
chk(vert === 50, '竖直四连线应为 50 条（25 柱 × 2 个高度窗口）');

console.log('== 2. 增量状态 vs 从零重算 ==');
function snapshot(){
  return {
    board: Array.from(E.board), lf: Array.from(E.legalFlag), ll: Array.from(E.lineLive),
    c1: Array.from(E.LC1), c2: Array.from(E.LC2), b1: Array.from(E.BUCK[1]), b2: Array.from(E.BUCK[2]),
    cf: Array.from(E.colFill), cn1: Array.from(E.gcnt[1]), cn2: Array.from(E.gcnt[2]),
    ln: [E.ln[1], E.ln[2]],
    ga: Array.from(E.lst[1]).slice(0, E.ln[1]).sort((a,b)=>a-b),
    gb: Array.from(E.lst[2]).slice(0, E.ln[2]).sort((a,b)=>a-b),
  };
}
function diff(a, b, name){
  for(const k of Object.keys(a)){
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if(x !== y){ bad++; console.log('  ✗ 回退后 ' + name + '.' + k + ' 不一致'); return false; }
  }
  ok++; return true;
}
E.newGame();
const base = snapshot();

const badSection2 = bad;
let rndState = 12345;
const rnd = () => (rndState = (rndState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

for(let trial = 0; trial < 40; trial++){
  E.newGame();
  const played = [];
  const lim = 3 + ((rnd() * 9) | 0);
  for(let k = 0; k < lim; k++){
    const ms = [];
    for(let c = 0; c < 25; c++){ const f = E.colFill[c]; if(f < E.N) ms.push(c + f * 25); }
    if(!ms.length) break;
    const m = ms[(rnd() * ms.length) | 0];
    const who = (k % 2) + 1;
    E.putFast(m, who);
    played.push([m, who]);
    /* 不变量：legalFlag 必须等于 colTop 算出来的 */
    for(let i = 0; i < 25 * E.N; i++){
      const exp = (E.board[i] === 0 && E.colTop(E.XOA[i], E.YOA[i]) === i) ? 1 : 0;
      if(E.legalFlag[i] !== exp){ bad++; console.log('  ✗ legalFlag 不变量破了 trial=' + trial + ' k=' + k + ' cell=' + i); k = lim; break; }
    }
    /* 不变量：我的杀点列表必须等于 core 的 crit Set */
    for(let w = 1; w <= 2; w++){
      const mine = new Set();
      for(let t = 0; t < E.ln[w]; t++) if(E.gcnt[w][E.lst[w][t]] > 0) mine.add(E.lst[w][t]);
      const theirs = E.C.crit[w];
      if(mine.size !== theirs.size || [...mine].some(c => !theirs.has(c))){
        bad++; console.log('  ✗ 杀点列表与 core.crit 不一致 trial=' + trial + ' who=' + w); k = lim; break;
      }
    }
    /* 增量哈希 vs 从零重算 */
    for(let s = 0; s < 8; s++){
      const [a, b] = E.hashFromScratch(s);
      if(a !== E.h1[s] || b !== E.h2[s]){
        bad++; console.log('  ✗ Zobrist 增量 ≠ 重算 trial=' + trial + ' k=' + k + ' s=' + s); k = lim; break;
      }
    }
  }
  ok++;
  for(let k = played.length - 1; k >= 0; k--) E.liftFast(played[k][0]);
  diff(base, snapshot(), 'trial' + trial);
}
console.log('   随机回退 40 局，不变量检查' + (bad > badSection2 ? ' 有失败（见上）' : '全部通过'));

console.log('== 3. 评估表合理性 ==');
E.newGame();
const e0 = E.evalLeaf(1, 1);
console.log('   空盘 evalLeaf(1) =', e0, '(期望 0)');
chk(Math.abs(e0) < 1e-9, '空盘评估不为 0');
E.putFast(E.idx(2,2,0), 1);
const ec = E.evalLeaf(1, 1), ecc = E.evalLeaf(2, 1);
console.log('   中心底格 给了先手一个子后 evalLeaf(1) =', ec.toFixed(2), ' evalLeaf(2) =', ecc.toFixed(2));
chk(ec > 0, '中心落子后我方评估应 > 0');
E.liftFast(E.idx(2,2,0));
E.putFast(E.idx(0,0,0), 1);
const ecorner = E.evalLeaf(1, 1);
console.log('   角格底格   evalLeaf(1) =', ecorner.toFixed(2));
chk(ec > ecorner, '中心应该比角好');
E.liftFast(E.idx(0,0,0));

console.log('== 4. 首手 25 个点的静态排序（深度 2）==');
E.newGame();
let r = E.rootSearch(1, 2, 20000);
console.log('   深度', r.depth, ' 用时', r.ms + 'ms', ' 节点', r.nodes);
console.log('   前三：', r.cands.slice(0, 5).map(c => E.cellName(c.cell) + ':' + c.sc.toFixed(1)).join('  '));
console.log('   末三：', r.cands.slice(-3).map(c => E.cellName(c.cell) + ':' + c.sc.toFixed(1)).join('  '));

console.log('== 5. 速度基准（深度 6 / 8 / 10，限时 60s）==');
for(const d of [6, 8, 10]){
  E.newGame();
  E.putFast(E.idx(2,2,0), 1); E.putFast(E.idx(1,2,0), 2);
  const t0 = Date.now();
  E.rootSearch(1, d, 60000);
  const el = Date.now() - t0;
  const st = E.stats();
  console.log('   深度', d, '：', el + 'ms', ' 节点', st.nodes.toLocaleString(),
              ' =', Math.round(st.nodes / (el / 1000) / 1000) + 'k 节点/秒',
              ' TT命中', st.ttHits.toLocaleString());
  E.liftFast(E.idx(1,2,0)); E.liftFast(E.idx(2,2,0));
}

console.log('\n' + (bad ? '❌ 失败 ' + bad + ' 项 / 通过 ' + ok : '✅ 全部通过（' + ok + ' 项）'));
process.exit(bad ? 1 : 0);

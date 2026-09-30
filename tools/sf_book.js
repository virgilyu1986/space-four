'use strict';
/* ============================================================================
   用算力暴力算出一条开局棋谱，并把每一手的"为什么"拆成可讲解的数据
   ---------------------------------------------------------------------------
   用法：
     node sf_book.js --mv 40 --ms 35000 --msd 13 --out book.json
     node sf_book_tail.js 8000 10 20 40      # 接着算到分出胜负
     node sf_first_class.js                  # 补齐先手第一步 25 个点的分数
     node sf_inject.js                       # 注入 index.html
   ---------------------------------------------------------------------------
   为什么要跑十几分钟：这盘棋每手恒定 25 个合法点（每根柱子最低的那个空格），
   分支数比平面四子棋大得多，只能靠「深度 + 置换表 + D4 对称规范化」硬啃。
   每一手都用**全窗口**把 25 个落点各搜一遍 —— 分数才是可比的，
   讲解里"这手比第二名高 N 分"才站得住脚。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const E = require('./sf_engine.js');
const A = require('./sf_annotate.js');

function arg(name, dflt){
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const MAXMV = +arg('mv', 40);
const MS    = +arg('ms', 35000);
const MS2   = +arg('ms2', 8000);       // 第 31 手之后用小预算跑完
const MAXD  = +arg('maxd', 13);
const OUT   = arg('out', 'book.json');

console.log('开局棋谱计算开始：每手 ' + (MS / 1000) + ' 秒预算，最大深度 ' + MAXD + '，共 ' + MAXMV + ' 手');
E.newGame();

const moves = [];
let finished = null;
const t00 = Date.now();

for(let k = 1; k <= MAXMV; k++){
  const who = (k % 2 === 1) ? 1 : 2;
  const budget = k <= 30 ? MS : MS2;
  const r = E.rootSearch(who, MAXD, budget, { noBreak: false });
  const best = r.cands[0];
  if(!best || !(best.sc > -Infinity)){ console.log('  第' + k + '手没有合法着法，停'); break; }

  const mv = A.recordMove(k, who, best, r);
  moves.push(mv);

  const whoTxt = who === 1 ? '蓝(先)' : '红(后)';
  console.log('  #' + String(k).padStart(2) + ' ' + whoTxt + ' ' + E.cellName(best.cell).padEnd(8)
    + ' 分=' + (Math.abs(best.sc) >= E.WIN - 500 ? (best.sc > 0 ? '必胜' : '必输') : Math.round(best.sc))
    + (mv.gap2 !== null ? ' 领先下一档 ' + Math.round(mv.gap2) + '(同分 ' + mv.ties + ' 手)' : ' 唯一')
    + ' | 深度' + r.depth + ' 稳定=' + mv.stable + ' ' + r.ms + 'ms ' + r.nodes.toLocaleString() + '节点'
    + ' | ' + mv.type);

  E.putFast(best.cell, who);
  if(mv.profile.win){ finished = { winner: who, mv: k }; break; }
  if(E.legalMoves().length === 0){ finished = { winner: 0, mv: k }; break; }
}

/* 收尾：把棋子清掉，恢复初始态 */
for(let k = moves.length - 1; k >= 0; k--) E.liftFast(moves[k].cell);

/* ---------- 首手 6 个对称类 ---------- */
E.newGame();
const byClass = new Map();
for(let c = 0; c < 25; c++){
  const key = A.cellClass(c);
  if(!byClass.has(key)) byClass.set(key, []);
  byClass.get(key).push(c);
}
const firstVals = new Map();
for(const cd of (moves[0] ? moves[0].cands : [])) firstVals.set(cd.cell, cd.sc);
const classes = [];
for(const [key, cells] of byClass){
  const rep = cells[0];
  classes.push({
    key, cells,
    lines: E.CELLW[rep], rising: A.RISING[rep], inPlane: A.INPLANE[rep], vertical: A.VERT[rep],
    searchVal: firstVals.has(rep) ? firstVals.get(rep) : null,
    /* 让补算脚本能把整类都填上：只要有一个同类点出现在候选表里就有分 */
  });
}
classes.sort((a, b) => (b.searchVal ?? -1e9) - (a.searchVal ?? -1e9));

/* ---------- 统计 ---------- */
const inCenter3 = moves.filter(m => m.x >= 1 && m.x <= 3 && m.y >= 1 && m.y <= 3).length;
const layerHist = [0, 0, 0, 0, 0, 0];
for(const m of moves) layerHist[m.z + 1]++;
const typeHist = {};
for(const m of moves) typeHist[m.type] = (typeHist[m.type] || 0) + 1;
const threatTurns = moves.filter(m => m.profile.foeThreatBefore >= 1).length;
const forkTurns = moves.filter(m => m.type === 'fork').length;

const outBook = {
  meta: {
    engine: 'sf-book v1',
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    budgetMs: MS, maxDepth: MAXD, moves: moves.length,
    base: moves.length,                  // 主跑跑出来的手数，续跑从这里接
    totalMs: Date.now() - t00,
    note: '每手 25 个落点全窗口搜索；分数是同一手内 25 个落点的相对比较，不要跨手对比。|分| ≥ 999500 表示搜索树里真的出现了连四。',
  },
  board: { N: 5, lines: E.NL, vertical: 50, inPlane: 140, rising: 162 },
  classes,
  stats: { inCenter3, layerHist, typeHist, threatTurns, forkTurns },
  result: finished,
  moves,
};

const outPath = path.resolve(__dirname, OUT);
fs.writeFileSync(outPath, JSON.stringify(outBook, null, 1));
console.log('\n写好了：' + outPath + '（' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB）');
console.log('总耗时 ' + ((Date.now() - t00) / 1000).toFixed(1) + ' 秒');
console.log('结果：' + (finished ? (finished.winner === 0 ? '和棋' : (finished.winner === 1 ? '先手胜' : '后手胜') + '，第 ' + finished.mv + ' 手') : '未分出胜负（只算了 ' + moves.length + ' 手）'));
console.log('前 3 手：' + moves.slice(0, 3).map(m => (m.who === 1 ? '蓝' : '红') + ' ' + E.cellName(m.cell)).join(' → '));

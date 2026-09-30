'use strict';
/* ============================================================================
   局面标注 —— 把「一手棋改变了什么」拆成可以直接写进讲解的数字
   ---------------------------------------------------------------------------
   主跑（sf_book.js）和续跑（sf_book_tail.js）都用这一份，
   否则续跑出来的那几手会缺字段、和前面几手口径不一致（讲解就会前后打架）。
   ========================================================================== */
const E = require('./sf_engine.js');

/* D4 对称：绕竖轴 4 转 × 2 镜。俯视图 25 个落点因此只有 6 个"本质类"。 */
function permOf(x, y, s){
  switch(s){
    case 0: return [x, y];
    case 1: return [4 - y, x];
    case 2: return [4 - x, 4 - y];
    case 3: return [y, 4 - x];
    case 4: return [x, 4 - y];
    case 5: return [4 - x, y];
    case 6: return [y, x];
    default: return [4 - y, 4 - x];
  }
}
function cellClass(i){
  const x = E.XOA[i], y = E.YOA[i];
  let best = null;
  for(let s = 0; s < 8; s++){
    const p = permOf(x, y, s);
    const key = (p[0] + 1) + '-' + (p[1] + 1);
    if(best === null || key < best) best = key;
  }
  return best;
}

/* 每格的分类线数：串多少条四连线、其中层内/跨层/竖直各多少条。
   这是"这一格为什么值钱"的全部依据，纯粹由规则算出来。 */
const RISING = new Int16Array(E.SZ), INPLANE = new Int16Array(E.SZ), VERT = new Int16Array(E.SZ);
for(const L of E.LINES){
  const zs = new Set(L.map(c => E.ZOA[c]));
  const col = new Set(L.map(c => E.XOA[c] + ',' + E.YOA[c]));
  for(const c of L){
    if(zs.size === 1) INPLANE[c]++;
    else RISING[c]++;
    if(col.size === 1) VERT[c]++;
  }
}

function gapsOf(w){
  const o = [];
  for(let t = 0; t < E.ln[w]; t++){ const c = E.lst[w][t]; if(E.gcnt[w][c] > 0) o.push(c); }
  return o;
}
function liveGaps(w){ return gapsOf(w).filter(c => E.legalFlag[c]); }

function stateSnapshot(who){
  const foe = 3 - who;
  const fg = gapsOf(foe);
  return {
    lines: { c1: E.LC1.slice(), c2: E.LC2.slice() },
    myLive: liveGaps(who).length, foeLive: liveGaps(foe).length,
    myGap: gapsOf(who).length, foeGap: fg.length,
    foeLiveSet: new Set(liveGaps(foe)),
    evalMe: E.evalLeaf(who, 1),
  };
}

/* 落子前量一次、落子后再量一次 —— 全部数字来自同一次拆解 */
function profile(cell, who, before){
  const foe = 3 - who;
  const s0 = before.lines;
  const col = E.COLA[cell], fill = E.colFill[col];
  E.putFast(cell, who);
  const win = !!E.findWin(cell, who);
  const myLiveAfter = liveGaps(who).length;
  const foeLiveAfterList = liveGaps(foe);
  const myGapAfter = gapsOf(who).length;
  const foeLiveAfterSet = new Set(foeLiveAfterList);
  let blocked = 0;
  for(const c of before.foeLiveSet) if(!foeLiveAfterSet.has(c)) blocked++;

  const A = (who === 1) ? E.LC1 : E.LC2, B = (who === 1) ? E.LC2 : E.LC1;
  const a0 = (who === 1) ? s0.c1 : s0.c2, b0 = (who === 1) ? s0.c2 : s0.c1;
  let to2 = 0, to3 = 0, deadFoe = 0, selfBlocked = 0;
  for(const id of E.CELL_LINES[cell]){
    if(a0[id] === 0 && A[id] === 1) selfBlocked++;
    if(a0[id] === 1 && A[id] === 2) to2++;
    if(a0[id] === 2 && A[id] === 3) to3++;
    if(a0[id] === 3 && A[id] === 4) to3++;
    if(b0[id] >= 1 && B[id] >= 1) deadFoe++;
  }
  E.liftFast(cell);
  return {
    win, myLiveAfter, foeLiveAfter: foeLiveAfterList.length, myGapAfter,
    newGaps: myGapAfter - before.myGap, blocked, deadFoe,
    threatenedBefore: before.myLive, foeThreatBefore: before.foeLive,
    to2, to3, selfBlocked,
    linesThrough: E.CELLW[cell], rising: RISING[cell], inPlane: INPLANE[cell], vertical: VERT[cell],
    height: E.ZOA[cell] + 1, colFillBefore: fill,
    myGapBefore: before.myGap, foeGapBefore: before.foeGap,
  };
}

function classifyMove(p){
  if(p.win) return 'four';
  if(p.foeThreatBefore >= 1 && p.blocked >= 1) return 'block';
  if(p.newGaps >= 2) return 'fork';
  if(p.newGaps === 1) return 'threat';
  if(p.height > 1) return 'stack';
  if(p.to2 >= 4) return 'spread';
  return 'build';
}

/* 把一手棋做成一条完整的棋谱记录（主跑和续跑都用它，保证字段一致） */
function recordMove(k, who, best, r, extra){
  const before = stateSnapshot(who);
  const p = profile(best.cell, who, before);
  const dl = r.depthLog;
  let stable = true;
  for(let t = Math.max(1, dl.length - 3); t < dl.length; t++) if(dl[t].cell !== dl[dl.length - 1].cell) stable = false;
  const ties = r.cands.filter(x => x.sc > best.sc - 1e-6).length;
  let nxt = null;
  for(const x of r.cands) if(x.sc < best.sc - 1e-6){ nxt = x; break; }

  const cands = [];
  for(const cd of r.cands.slice(0, 6)){
    if(cd.cell === best.cell){ cands.push(Object.assign({ cell: cd.cell, sc: cd.sc, self: true, type: classifyMove(p) }, p)); continue; }
    const q = profile(cd.cell, who, stateSnapshot(who));
    cands.push(Object.assign({ cell: cd.cell, sc: cd.sc, self: false, type: classifyMove(q) }, q));
  }

  return {
    k, who, cell: best.cell,
    x: E.XOA[best.cell], y: E.YOA[best.cell], z: E.ZOA[best.cell],
    sc: best.sc, depth: r.depth, ms: r.ms, nodes: r.nodes,
    stable, gap2: nxt ? best.sc - nxt.sc : null, ties,
    second: nxt ? nxt.cell : null, secondSc: nxt ? nxt.sc : null,
    profile: p, type: classifyMove(p),
    evalBefore: before.evalMe,
    cands: cands.map(a => ({
      cell: a.cell, sc: Math.round(a.sc * 10) / 10, self: !!a.self, type: a.type,
      win: a.win, to2: a.to2, to3: a.to3, newGaps: a.newGaps, blocked: a.blocked,
      foeLiveAfter: a.foeLiveAfter, linesThrough: a.linesThrough, height: a.height,
    })),
    depthLog: dl.map(d => ({ d: d.d, cell: d.cell, sc: d.sc })),
    ...(extra || {}),
  };
}

module.exports = {
  permOf, cellClass, RISING, INPLANE, VERT,
  gapsOf, liveGaps, stateSnapshot, profile, classifyMove, recordMove,
};

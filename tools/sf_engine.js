'use strict';
/* ============================================================================
   空间四子棋 · 开局棋谱搜索引擎
   ---------------------------------------------------------------------------
   设计要点（每一条都是为了"讲得出为什么"）：
   1. 规则层**不重写** —— 直接从 index.html 里切出「棋盘数据 … AI」那一段
      （LINES / CELL_LINES / refreshLine / put / lift / findWin / isLegal），
      在 Node 里 eval 出来用。这样算出来的棋谱和页面上玩的是同一套规则，
      不存在"两个实现漂移"的可能。
   2. 评估函数换成「按线分桶」的增量式：
        BUCK[方][k*4+r] = 该方有 k 颗子、且线内还有 r 个**当前够得到**的空格
                          的线数（k=1..3，r=0..3）
      为什么必须带 r：叠放规则下"空格够不够得到"是这个游戏最核心的信息 ——
      一条两子线如果两个空位都够得到，是"活二"；只有一个够得到就是半死。
      分桶之后整张评估表是 O(1) 读出来的，搜索节点才跑得动。
   3. 杀点（三缺一）不靠 k=3 的桶，而是单独维护一张**紧凑列表** lst[who]：
      因为"三子线的缺口是否够得到"直接决定胜负，值得单算，而且要能 O(1) 遍历。
   4. Zobrist 置换表带 **D4 对称规范化**：绕竖轴转 90°/180°/270° 和四种镜像
      都是这个游戏的合法对称（重力沿 z，xy 平面内怎么翻都一样），
      所以把 8 个对称里字典序最小的那个哈希当键 —— 等效局面直接命中，
      开局阶段这一下能省掉一个数量级的搜索量。
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ---------- 1. 从 index.html 抽出规则层 ---------- */
function loadCore(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const A = '/* ================= 棋盘数据 ================= */';
  const B = '/* ============================================================================\n   3D 投影';
  const i = html.indexOf(A), j = html.indexOf(B);
  if(i < 0 || j < 0 || j <= i) throw new Error('抽规则层失败：锚点没找到 ('+i+','+j+')');
  const core = html.slice(i, j);
  return new Function("'use strict';\n" + core + "\nreturn {" +
    "N,SZ,P1,P2,idx,XO,YO,ZO,DIRS,LINES,CELL_LINES,NEIGH,STAT,NL," +
    "LC1,LC2,thrWho,thrCell,crit,critCnt,board,touch," +
    "colTop,legalMoves,isLegal,put,lift,stones,findWin,evaluate,gen,genFor," +
    "refreshLine,resetLines,SC};")();
}

const C = loadCore();
const { N, SZ, P1, P2, idx, XO, YO, ZO, LINES, CELL_LINES, STAT, NL,
        LC1, LC2, thrWho, thrCell, board, refreshLine, resetLines,
        colTop, legalMoves, isLegal, findWin } = C;

/* 坐标速查表（避免每次除以 25） */
const XOA = new Uint8Array(SZ), YOA = new Uint8Array(SZ), ZOA = new Uint8Array(SZ), COLA = new Uint8Array(SZ);
for(let i = 0; i < SZ; i++){ XOA[i] = XO(i); YOA[i] = YO(i); ZOA[i] = ZO(i); COLA[i] = XO(i) + YO(i) * N; }
const CELLW = new Uint8Array(SZ);                     // 每格穿过多少条四连线（中心性）
for(let i = 0; i < SZ; i++) CELLW[i] = CELL_LINES[i].length;
const HW = new Float32Array(SZ);                      // 静态走法排序权重
for(let i = 0; i < SZ; i++) HW[i] = CELLW[i] * 8 + STAT[i] * 3;

/* ---------- 2. 增量状态 ---------- */
const legalFlag = new Uint8Array(SZ);      // 1 = 该格是它那根柱子最低的空格（现在就能落）
const lineLive  = new Int16Array(NL);      // 每条线里"现在够得到"的空格数
const colFill   = new Uint8Array(N * N);   // 每根柱子堆了几颗
const lSide = new Uint8Array(NL), lBkt = new Uint8Array(NL);
const BUCK = [null, new Int32Array(16), new Int32Array(16)];
const st = new Int16Array(NL); let stampN = 0;

/* 杀点紧凑列表（比遍历 Set 快一个数量级） */
const mcW = new Int8Array(NL), mcC = new Int16Array(NL);
const gcnt = [null, new Int16Array(SZ), new Int16Array(SZ)];
const lst  = [null, new Int16Array(SZ), new Int16Array(SZ)];
const ln   = new Int32Array(3);
function critAdd(w, c){ if(gcnt[w][c]++ === 0) lst[w][ln[w]++] = c; }
function critDel(w, c){
  if(--gcnt[w][c] === 0){
    const L = lst[w];
    for(let t = 0; t < ln[w]; t++) if(L[t] === c){ L[t] = L[--ln[w]]; break; }
  }
}
function afterLine(id){
  const w = thrWho[id], c = thrCell[id];
  if(mcW[id]) critDel(mcW[id], mcC[id]);
  mcW[id] = w; mcC[id] = c;
  if(w) critAdd(w, c);
}

/* ---------- 3. 评估 ---------- */
const VALT = new Float64Array(16);          // 下标 k*4+r
function setV(k, r, v){ VALT[k * 4 + r] = v; }
for(let r = 0; r < 4; r++) setV(1, r, r === 0 ? 0.40 : 1);
setV(2, 0, 0.5); setV(2, 1, 3.2); setV(2, 2, 10); setV(2, 3, 11);
/* k=3 全填 0 —— 三子线的价值完全由"缺口够不够得到"决定，走杀点那套账，
   放两份会重复计分。 */
for(let r = 0; r < 4; r++) setV(3, r, 0);
const OPP = 1.06;                            // 对手线略加权重：宁可先拆别人的

function refreshBucket(id){
  const s0 = lSide[id];
  if(s0) BUCK[s0][lBkt[id]]--;
  const c1 = LC1[id], c2 = LC2[id];
  let s = 0, b = 0;
  if(c1 && c2){ /* 双方都有子 = 死线 */ }
  else if(c1 || c2){
    s = c1 ? 1 : 2;
    let k = c1 || c2; if(k > 3) k = 3;
    let r = lineLive[id]; if(r > 3) r = 3;
    b = k * 4 + r;
  }
  lSide[id] = s; lBkt[id] = b;
  if(s) BUCK[s][b]++;
}

function putFast(i, v){
  board[i] = v;
  const L = CELL_LINES[i];
  for(let t = 0; t < L.length; t++){ const id = L[t]; refreshLine(id); afterLine(id); }
  legalFlag[i] = 0;
  for(let t = 0; t < L.length; t++) lineLive[L[t]]--;
  const up = i + 25;
  let U = null;
  if(up < SZ){ legalFlag[up] = 1; U = CELL_LINES[up]; for(let t = 0; t < U.length; t++) lineLive[U[t]]++; }
  stampN++;
  for(let t = 0; t < L.length; t++){ const id = L[t]; refreshBucket(id); st[id] = stampN; }
  if(U) for(let t = 0; t < U.length; t++){ const id = U[t]; if(st[id] !== stampN){ st[id] = stampN; refreshBucket(id); } }
  colFill[COLA[i]] = ZOA[i] + 1;
  hashXor(i, v);
}
function liftFast(i){
  const v = board[i];
  legalFlag[i] = 1;
  const L = CELL_LINES[i];
  const up = i + 25;
  let U = null;
  if(up < SZ){ legalFlag[up] = 0; U = CELL_LINES[up]; }
  board[i] = 0;
  for(let t = 0; t < L.length; t++){ const id = L[t]; refreshLine(id); afterLine(id); lineLive[id]++; }
  if(U) for(let t = 0; t < U.length; t++) lineLive[U[t]]--;
  stampN++;
  for(let t = 0; t < L.length; t++){ const id = L[t]; refreshBucket(id); st[id] = stampN; }
  if(U) for(let t = 0; t < U.length; t++){ const id = U[t]; if(st[id] !== stampN){ st[id] = stampN; refreshBucket(id); } }
  colFill[COLA[i]] = ZOA[i];
  hashXor(i, v);
}

/* ---------- 4. Zobrist（D4 对称规范化） ---------- */
const PERM = [];
{
  const t = [
    (x, y) => [x, y], (x, y) => [4 - y, x], (x, y) => [4 - x, 4 - y], (x, y) => [y, 4 - x],
    (x, y) => [x, 4 - y], (x, y) => [4 - x, y], (x, y) => [y, x], (x, y) => [4 - y, 4 - x],
  ];
  for(const f of t){
    const p = new Int16Array(SZ);
    for(let i = 0; i < SZ; i++){ const q = f(XOA[i], YOA[i]); p[i] = idx(q[0], q[1], ZOA[i]); }
    PERM.push(p);
  }
}
let rng = 0x2F6E2B1;
function rnd(){ rng ^= rng << 13; rng >>>= 0; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0; return rng; }
const Z1 = new Uint32Array(SZ * 3), Z2 = new Uint32Array(SZ * 3);
for(let i = 0; i < SZ * 3; i++){ Z1[i] = rnd(); Z2[i] = rnd(); }
const ZT1 = [], ZT2 = [];
for(let s = 0; s < 8; s++){
  const a = new Uint32Array(SZ * 3), b = new Uint32Array(SZ * 3);
  for(let i = 0; i < SZ; i++) for(let v = 1; v <= 2; v++){
    a[i * 3 + v] = Z1[PERM[s][i] * 3 + v];
    b[i * 3 + v] = Z2[PERM[s][i] * 3 + v];
  }
  ZT1.push(a); ZT2.push(b);
}
const h1 = new Uint32Array(8), h2 = new Uint32Array(8);
function hashXor(i, v){
  const j = i * 3 + v;
  for(let s = 0; s < 8; s++){ h1[s] ^= ZT1[s][j]; h2[s] ^= ZT2[s][j]; }
}
let cK1 = 0, cK2 = 0;
function canon(){
  let b1 = h1[0], b2 = h2[0];
  for(let s = 1; s < 8; s++){
    const a = h1[s], b = h2[s];
    if(a < b1 || (a === b1 && b < b2)){ b1 = a; b2 = b; }
  }
  cK1 = b1; cK2 = b2;
}
/* 自检用：从零重算某个对称的哈希 */
function hashFromScratch(s){
  let a = 0, b = 0;
  for(let i = 0; i < SZ; i++){ const v = board[i]; if(!v) continue; a ^= ZT1[s][i * 3 + v]; b ^= ZT2[s][i * 3 + v]; }
  return [a >>> 0, b >>> 0];
}

/* ---------- 5. 置换表 ---------- */
const TB = 22, TSIZE = 1 << TB, TMASK = TSIZE - 1;
const ttK1 = new Uint32Array(TSIZE), ttK2 = new Uint32Array(TSIZE);
const ttD = new Int8Array(TSIZE), ttF = new Int8Array(TSIZE);
const ttV = new Float64Array(TSIZE), ttM = new Int16Array(TSIZE);
const ttUsed = new Uint8Array(TSIZE);
function ttClear(){ ttUsed.fill(0); }
let ttHits = 0, ttStores = 0;

/* ---------- 6. 初始局面 ---------- */
function newGame(){
  board.fill(0);
  resetLines();
  legalFlag.fill(0);
  colFill.fill(0);
  lSide.fill(0); lBkt.fill(0); BUCK[1].fill(0); BUCK[2].fill(0);
  gcnt[1].fill(0); gcnt[2].fill(0); ln[1] = 0; ln[2] = 0;
  mcW.fill(0); mcC.fill(0);
  h1.fill(0); h2.fill(0);
  for(let i = 0; i < SZ; i++) if(ZOA[i] === 0) legalFlag[i] = 1;
  for(let id = 0; id < NL; id++){
    let r = 0; const L = LINES[id];
    for(let t = 0; t < 4; t++) if(legalFlag[L[t]]) r++;
    lineLive[id] = r;
    refreshLine(id); afterLine(id);
    refreshBucket(id);
  }
  ttClear(); histH.fill(0); nodes = 0;
}

/* ---------- 7. 评估 ---------- */
const WIN = 1000000;
/* 叶子上的这两种情况**本身就是真胜负**，不是"形势判断"，所以必须按杀棋计分
   （WIN - ply），不能给个固定常数：
     · 轮到我走、且我有一个能落的缺口 → 我立刻连四，1 层后赢。
     · 轮到我走、对手有两个能落的缺口 → 我最多堵一个，2 层后输。
   以前这里给固定 460000，结果浅层读成"必胜"、深一层变成 999994 —— 同一手
   在相邻两层给出两种量纲的分数，根节点就会在浅层误判成"已分胜负"提前收工。 */
function evalLeaf(me, ply){
  const foe = 3 - me;
  const A = BUCK[me], B = BUCK[foe];
  let s = 0;
  for(let t = 0; t < 16; t++){ const v = A[t]; if(v) s += v * VALT[t]; }
  for(let t = 0; t < 16; t++){ const v = B[t]; if(v) s -= v * VALT[t] * OPP; }
  const LM = lst[me], nm = ln[me];
  for(let t = 0; t < nm; t++) if(legalFlag[LM[t]]) return WIN - ply - 1;
  const LF = lst[foe], nf = ln[foe];
  let fg = 0, fNear = 0;
  for(let t = 0; t < nf; t++){
    const c = LF[t];
    if(legalFlag[c]) fg++;
    else if(ZOA[c] - colFill[COLA[c]] <= 2) fNear++;
  }
  if(fg >= 2) return -(WIN - ply - 2);
  if(fg === 1) s -= 55;                          // 得花一手去堵
  let mNear = 0;
  for(let t = 0; t < nm; t++){
    const c = LM[t];
    if(!legalFlag[c] && ZOA[c] - colFill[COLA[c]] <= 2) mNear++;
  }
  return s + 7 * mNear - 6 * fNear;
}

/* ---------- 8. 走法生成与排序 ---------- */
const MBUF = []; for(let i = 0; i < 72; i++) MBUF.push(new Int16Array(32));
const histH = new Int32Array(SZ);
let nodes = 0, STOP = false, gDeadline = 0;

function genMoves(me, ply){
  const buf = MBUF[ply]; let n = 0;
  const foe = 3 - me;
  const LF = lst[foe], nf = ln[foe];
  let needBlock = 0;
  for(let t = 0; t < nf; t++) if(legalFlag[LF[t]]) needBlock++;
  if(needBlock){
    /* 对手下一步就能成四：只留「我先赢」和「必须堵」 */
    const LM = lst[me], nm = ln[me];
    for(let t = 0; t < nm; t++){ const c = LM[t]; if(legalFlag[c]) buf[n++] = c; }
    for(let t = 0; t < nf; t++){ const c = LF[t]; if(legalFlag[c]) buf[n++] = c; }
    return n;
  }
  for(let c = 0; c < 25; c++){ const f = colFill[c]; if(f < N) buf[n++] = c + f * 25; }
  return n;
}
const SKEY = []; for(let i = 0; i < 72; i++) SKEY.push(new Float32Array(32));
function sortMoves(buf, n, ttMove, ply, me){
  /* 插入排序（n≤25，且大半已经有序）：
     TT 手 > 我方杀点 > 对手杀点 > 历史启发 + 中心性 */
  const key = SKEY[ply];
  const myG = gcnt[me], foeG = gcnt[3 - me];
  for(let t = 0; t < n; t++){
    const m = buf[t];
    let k = HW[m] + histH[m];
    if(m === ttMove) k += 1e7;
    if(myG[m]) k += 3e5 + CELLW[m] * 400;       // 我这颗一落就成四
    if(foeG[m]) k += 1e5;                       // 堵对手的杀点
    key[t] = k;
  }
  for(let a = 1; a < n; a++){
    const km = key[a], vm = buf[a]; let b = a - 1;
    while(b >= 0 && key[b] < km){ key[b + 1] = key[b]; buf[b + 1] = buf[b]; b--; }
    key[b + 1] = km; buf[b + 1] = vm;
  }
  return n;
}

/* ---------- 9. 搜索 ---------- */
function search(me, depth, alpha, beta, ply){
  if((++nodes & 1023) === 0 && Date.now() > gDeadline) STOP = true;
  if(STOP) return 0;
  if(depth <= 0) return evalLeaf(me, ply);

  canon();
  const k1 = cK1, k2 = cK2, ti = k1 & TMASK;
  let ttMove = -1;
  if(ttUsed[ti] && ttK1[ti] === k1 && ttK2[ti] === k2){
    ttHits++;
    /* 杀棋分是按"距根的层数"记的（WIN - ply），而同一个局面可能在**不同层**
       被算到（迭代加深 / 不同搜索顺序）。存进去时换成"距本节点"的差，
       取出来再换回来 —— 否则浅层会拿着深层量纲的值当精确值用。 */
    const v0 = ttV[ti], f = ttF[ti];
    const v = v0 > WIN - 500 ? v0 - ply : (v0 < -(WIN - 500) ? v0 + ply : v0);
    if(ttD[ti] >= depth){
      if(f === 0) return v;
      if(f === 1 && v >= beta) return v;
      if(f === 2 && v <= alpha) return v;
    }
    ttMove = ttM[ti];
  }
  const buf = MBUF[ply];
  const n = sortMoves(buf, genMoves(me, ply), ttMove, ply, me);
  if(n === 0) return 0;                       // 棋盘满 = 和棋
  const a0 = alpha;
  let best = -Infinity, bestMv = buf[0];
  for(let t = 0; t < n; t++){
    const m = buf[t];
    putFast(m, me);
    let sc;
    if(findWin(m, me)) sc = WIN - ply;
    else sc = -search(3 - me, depth - 1, -beta, -alpha, ply + 1);
    liftFast(m);
    if(STOP) return best === -Infinity ? 0 : best;
    if(sc > best){ best = sc; bestMv = m; }
    if(best > alpha) alpha = best;
    if(alpha >= beta){
      histH[m] += depth * depth;
      break;
    }
  }
  const f = best <= a0 ? 2 : (best >= beta ? 1 : 0);
  const vv = best > WIN - 500 ? best + ply : (best < -(WIN - 500) ? best - ply : best);
  ttK1[ti] = k1; ttK2[ti] = k2; ttD[ti] = depth; ttF[ti] = f; ttV[ti] = vv; ttM[ti] = bestMv;
  ttUsed[ti] = 1; ttStores++;
  return best;
}

/* ---------- 10. 根搜索：拿到全部 25 个落点的分数 ---------- */
function rootSearch(me, maxDepth, budgetMs, opts){
  const noBreak = !!(opts && opts.noBreak);
  const t0 = Date.now();
  gDeadline = t0 + budgetMs; STOP = false;
  const root = [];
  for(let c = 0; c < 25; c++){ const f = colFill[c]; if(f < N) root.push(c + f * 25); }
  const nR = root.length;
  let order = root.slice();
  let sc = new Float64Array(nR);              // sc[t] 对应 order[t]
  for(let t = 0; t < nR; t++) sc[t] = -Infinity;
  let doneDepth = 0; const depthLog = [];
  for(let d = 1; d <= maxDepth; d++){
    const cur = new Float64Array(nR);
    let aborted = false;
    for(let t = 0; t < nR; t++){
      const m = order[t];
      putFast(m, me);
      let v;
      if(findWin(m, me)) v = WIN - 1;
      else v = -search(3 - me, d - 1, -Infinity, Infinity, 1);
      liftFast(m);
      if(STOP){ aborted = true; break; }
      cur[t] = v;
    }
    if(aborted) break;
    doneDepth = d;
    let bi = 0;
    for(let t = 1; t < nR; t++) if(cur[t] > cur[bi]) bi = t;
    depthLog.push({ d, cell: order[bi], sc: cur[bi] });
    sc = cur;
    /* 按本层分数重排，下一层先搜好的分支 —— 这是 α-β 能不能剪得动的关键 */
    const p = Array.from({ length: nR }, (_, t) => t).sort((a, b) => cur[b] - cur[a]);
    order = p.map(t => order[t]);
    sc = new Float64Array(nR); for(let t = 0; t < nR; t++) sc[t] = cur[p[t]];
    /* 只在**真的找到连四**（树里出现四子）时才提前收工，且至少跑到 8 层 ——
       浅层找到的杀棋可能不是最短杀，再深一两层能把步数压准。 */
    if(!noBreak && d >= 8 && Math.abs(sc[0]) >= WIN - 200) break;
    const el = Date.now() - t0;
    if(el > budgetMs * 0.55) break;                              // 再深一层肯定超时
  }
  const out = [];
  for(let t = 0; t < nR; t++) out.push({ cell: order[t], sc: sc[t] });
  out.sort((a, b) => b.sc - a.sc);
  return { cands: out, depth: doneDepth, depthLog,
           ms: Date.now() - t0, nodes, ttHits, ttStores, budget: budgetMs };
}

module.exports = {
  C, N, SZ, P1, P2, idx, XOA, YOA, ZOA, COLA, CELLW, HW, LINES, CELL_LINES, NL, WIN,
  board, LC1, LC2, colFill, legalFlag, lineLive, BUCK, VALT, lst, ln, gcnt,
  newGame, putFast, liftFast, evalLeaf, genMoves, search, rootSearch, canon, hashFromScratch,
  h1, h2, findWin, legalMoves, isLegal, colTop, refreshLine, resetLines,
  ttClear, ttUsed, ttM, ttD, ttV, ttF,
  get nodes(){ return nodes; }, get STOP(){ return STOP; },
  stats(){ return { nodes, ttHits, ttStores }; },
  cellName(i){ return 'x' + (XOA[i] + 1) + 'y' + (YOA[i] + 1) + 'L' + (ZOA[i] + 1); },
};

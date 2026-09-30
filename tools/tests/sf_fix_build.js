// 生成带 globalThis.__T 的调试副本：node sf_fix_build.js [源文件] [输出文件]
const fs = require('fs');
const SRC = process.argv[2] || '/Users/yu/WorkBuddy/2026-09-26-23-13-32/space-four/index.html';
const OUT = process.argv[3] || '/tmp/sf_fix.html';

let s = fs.readFileSync(SRC, 'utf8');
const ANCHOR = '\nrecenter();\nreset();\nloop();';
if (!s.includes(ANCHOR)) { console.error('锚点没找到'); process.exit(1); }

const INJ = `
/* ===== 调试注入（只存在于调试副本）===== */
/* 记录每一次 drawSphere 调用：真实绘制顺序 + 每颗球用的屏幕圆心 */
const __calls = []; let __rec = false;
const __ds0 = drawSphere;
drawSphere = function(x,y,zc,who,lit,ghost){
  if(__rec){ const p=proj(x,y,zc);
    __calls.push({x,y,zc,who,ghost:!!ghost, px:p[0], py:p[1], d:depthAt(x,y,zc),
                  a: ctx.globalAlpha}); }
  return __ds0(x,y,zc,who,lit,ghost);
};
globalThis.__T = {
  rec(on){ __rec=!!on; if(on) __calls.length=0; },
  calls(){ return __calls.slice(); },
  board, idx, XO, YO, ZO, SZ, N, put, lift, colTop, colFill,
  proj, rawProj, depthAt, PRIM, fillPrimitives, paintPrimitives, pick, draw, recenter,
  CW, CH,
  PR, RP,
  get S(){ return S; }, get OX(){ return OX; }, get OY(){ return OY; },
  get yaw(){ return yaw; }, get pitch(){ return pitch; },
  get turn(){ return turn; }, get over(){ return over; }, get human(){ return human; },
  get hover(){ return hover; }, get hoverStone(){ return hoverStone; },
  get focusCol(){ return focusCol; }, set focusCol(v){ focusCol=v; },
  get focusMode(){ return focusMode; },
  setFocusMode(m){ focusMode=m; },
  inFocus, colCount, focusOn, dimStone, dimPillar, dimTarget,
  ctx, P1, P2,
  /* 某柱上第 z 层球心的屏幕坐标（用于把鼠标移到真实球上） */
  stonePx(x,y,z){ const p=proj(x,y,z+0.5); return [p[0],p[1]]; },
  /* 球心附近最大饱和度 —— 用来量化"虚化了没有"：
     虚化后球色与米色背景混合，饱和度会塌到 0.06 以下，实心球 ≥ 0.5 */
  satAt(x,y,z){
    const p=proj(x,y,z+0.5);
    return this.satPx(p[0],p[1]);
  },
  satPx(px,py){
    const R=PR*S, rr=Math.max(2,R*0.30);
    let best=0;
    const img=ctx.getImageData(Math.round(px-rr),Math.round(py-rr),
                               Math.round(2*rr)+1,Math.round(2*rr)+1).data;
    for(let o=0;o<img.length;o+=4){
      const r=img[o],g=img[o+1],b=img[o+2];
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
      if(mx>0) best=Math.max(best,(mx-mn)/mx);
    }
    return best;
  },
  setCam(y, p){ yaw=yawT=y; pitch=pitchT=p; recenter(); },
  setState(o){ if(o.turn!==undefined) turn=o.turn; if(o.over!==undefined) over=o.over; if(o.human!==undefined) human=o.human; },
  setHover(i){ hover=i; hoverStone=(i>=0&&board[i])?i:-1; },
  setHoverBoth(h, s){ hover=h; hoverStone=s; },
  clearBoard(){ for(let i=0;i<SZ;i++) if(board[i]) lift(i); },
  setBoard(list){ this.clearBoard(); for(const [x,y,z,v] of list) put(idx(x,y,z), v); },
  /* 读出每颗球的：格号、逻辑色、投影球心、以及**球心附近小 patch 的判色**
     （单个像素会被"上层球落下来的阴影/球轮廓抗锯齿"带偏，
      所以取半径 0.45R 内所有像素投票：蓝 / 橙 / 其它） */
  readCenters(){
    const out=[];
    const R=PR*S, rr=R*0.45, rr2=rr*rr;
    for(let i=0;i<SZ;i++){
      if(!board[i]) continue;
      const p=proj(XO(i),YO(i),ZO(i)+0.5);
      const px=Math.round(p[0]), py=Math.round(p[1]);
      const r0=Math.max(0,Math.floor(px-rr)), r1=Math.min(CW-1,Math.ceil(px+rr));
      const c0=Math.max(0,Math.floor(py-rr)), c1=Math.min(CH-1,Math.ceil(py+rr));
      const img=ctx.getImageData(r0,c0,r1-r0+1,c1-c0+1).data;
      const cen=ctx.getImageData(px,py,1,1).data;
      let blue=0, orange=0, other=0;
      for(let yy=0; yy<=c1-c0; yy++) for(let xx=0; xx<=r1-r0; xx++){
        const dx=(r0+xx)-px, dy=(c0+yy)-py;
        if(dx*dx+dy*dy > rr2) continue;
        const o=(yy*(r1-r0+1)+xx)*4, r=img[o], g=img[o+1], b=img[o+2];
        if(b>140 && b-r>30) blue++;
        else if(r>150 && r-b>45 && g-b>8) orange++;
        else other++;
      }
      out.push({i, x:XO(i), y:YO(i), z:ZO(i), who:board[i], px, py,
                d:depthAt(XO(i),YO(i),ZO(i)+0.5),
                center:[cen[0],cen[1],cen[2]],
                patch:{blue, orange, other, total:blue+orange+other}});
    }
    return out;
  },
  /* PRIM 里 ord>=1（真球）的绘制顺序，用于直接验证排序方向 */
  sphereOrder(){
    return PRIM.filter(p=>p.ord>=1).map(p=>p.d);
  },
  primList(){ return PRIM.map(p=>({d:p.d, ord:p.ord})); },
  /* ===== v0.8 教学复盘 + 棋谱 ===== */
  rv, PV_CACHE, analyzeGame, enterReview, exitReview, rvGoto, rvShowTab, rvPaint,
  paneWhy, panePv, paneVal, paneRep, fillRecPane,
  classify, coachReport, reportText, DRILLS, MISS,
  cellPotential, cntLive, gapMapOf, scText, pvLine,
  buildRecord, buildRecordFile, parseRecords, parseOne, validateMoves, applyRecord,
  archiveGame, loadArch, saveArch, delArch, cellName, whoAt, rebuildBoard,
  doMove, finishGame, aiTurn, hint, undo, reset, liveFork,
  hist(){ return history.slice(); },
  setHistory(h, first, lv){
    if(first!==undefined){ humanFirst=!!first; human=humanFirst?P1:P2; ai=3-human; }
    if(lv) level=lv;
    history = h.slice();
    rebuildBoard(history.length);
  },
  get humanFirst(){ return humanFirst; }, set humanFirst(v){ humanFirst=!!v; human=v?P1:P2; ai=3-human; },
  get level(){ return level; }, set level(v){ level=v; },
  get history(){ return history.slice(); },
  setHistoryRaw(h){ history=h; },
  get rvOn(){ return rv.on; },
  get rvTab(){ return rv.tab; },
  /* ---- 开局手册 ---- */
  bk, OPENING_BOOK, bkSeq, bkName, bkShow, bkHide, bkShowTab, bkFill, bkLoad,
  bkDrillStart, bkDrillStop, bkDrillHuman, bkDrillOn, bkMarkdown, bkExportRecord,
  bkWhyHtml, bkCandHtml, bkTheoryHtml, bkMemoText, bkShortWhy, bkGaps, bkLegalIn,
  bkBuildSnapshots,
  get bkSnapshots(){ return BKS; },
  get bkState(){ return { on:bk.on, tab:bk.tab, sel:bk.sel, drill:bk.drill, i:bk.i, ok:bk.ok, wrong:bk.wrong, bad:bk.bad.slice(), paused:bk.paused, side:bk.userSide }; },
  bkDrillMsgText(){ const m=document.getElementById('bkDrillMsg'); return m?m.textContent:''; },
  bkDrillMsgHtml(){ const m=document.getElementById('bkDrillMsg'); return m?m.innerHTML:''; },
  bkClickRow(i){ const rows=document.querySelectorAll('#bkList .bk-row'); if(rows[i]) rows[i].click(); },
  bkRowClass(i){ const rows=document.querySelectorAll('#bkList .bk-row'); return rows[i]?rows[i].className:''; },
  bkDrillCheck(on){ const cb=document.getElementById('bkDrill'); cb.checked=!!on; cb.onchange({ target: cb }); },
  bkFixGo(){ const b=document.getElementById('bkFixGo'); if(b) b.click(); return !!b; },
  bkFixUndo(){ const b=document.getElementById('bkFixUndo'); if(b) b.click(); return !!b; },
  paneText(id){ const e=document.getElementById(id); return e?e.textContent:''; },
  paneHtml(id){ const e=document.getElementById(id); return e?e.innerHTML:''; },
};
`;

s = s.replace(ANCHOR, INJ + ANCHOR);
fs.writeFileSync(OUT, s);
console.log('已生成', OUT, s.length, 'bytes');

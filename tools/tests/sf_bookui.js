/* 开局手册 + 背谱模式 验收
   用法：node sf_bookui.js [file://调试副本] [标签]
   验的都是可证伪的东西：
     ① 棋谱数据自洽：每手 25 个候选项按分排序、本手必须是第一名
     ② 标签页不空不脏：4 个标签 × 全部手数，HTML 里不许出现 undefined / NaN
     ③ 摆谱必须逐字节对：摆到第 k 手之后，棋盘和 history 必须等于棋谱前 k 手
     ④ 背谱裁判正确：走对要前进、走错要点名正确手并标红
     ⑤ 导出可往返：导出的棋谱解析回来必须得到同一串手序
     ⑥ 不破坏原有功能：复盘 5 个标签仍然正常
*/
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'file:///tmp/sf_bk.html';
const TAG = process.argv[3] || 'v0.9';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await b.newPage({ viewport: { width: 980, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(500);

  console.log(`\n### ${TAG}  加载`);
  ok(errs.length === 0, `加载零报错${errs.length ? '：' + errs.join(' | ') : ''}`);
  const meta = await page.evaluate(() => {
    const B = window.__T.OPENING_BOOK;
    return B ? { n: B.moves.length, depth: B.meta.maxDepth, budget: B.meta.budgetMs,
                 result: B.result, classes: (B.classes || []).length,
                 stats: B.stats, board: B.board } : null;
  });
  ok(!!meta, '棋谱数据已经注入页面');
  if(!meta){ await b.close(); process.exit(1); }
  const resTxt = meta.result
    ? (meta.result.winner === 0 ? '和棋' : ((meta.result.winner === 1 ? '先手胜' : '后手胜') + '（第' + meta.result.mv + '手）'))
    : '未终局';
  console.log(`   棋谱 ${meta.n} 手 · 每手预算 ${Math.round(meta.budget / 1000)}s · 对称类 ${meta.classes} 个 · 结果 ${resTxt}`);
  ok(meta.n >= 20, `棋谱手数 ≥ 20（实际 ${meta.n}）`);

  console.log('\n### ① 数据自洽');
  const integ = await page.evaluate(() => {
    const B = window.__T.OPENING_BOOK;
    const bad = [];
    for(const mv of B.moves){
      if(mv.cands[0].cell !== mv.cell) bad.push('第' + mv.k + '手：候选项第一名不是本手');
      for(let i = 1; i < mv.cands.length; i++)
        if(mv.cands[i].sc > mv.cands[i - 1].sc + 1e-9) bad.push('第' + mv.k + '手：候选项没有按分降序');
      if(mv.profile.linesThrough !== mv.cands[0].linesThrough) bad.push('第' + mv.k + '手：串线数与候选表不一致');
      if(mv.type !== mv.cands[0].type) bad.push('第' + mv.k + '手：类型与候选表不一致');
    }
    return bad;
  });
  ok(integ.length === 0, `候选项排序 / 本手一致性${integ.length ? '：' + integ.slice(0, 3).join('；') : ''}`);

  const cons = await page.evaluate(() => {
    const B = window.__T.OPENING_BOOK, T = window.__T;
    const bad = [];
    let side = 1;
    const bd = new Uint8Array(125);
    for(const mv of B.moves){
      if(mv.who !== side) bad.push('第' + mv.k + '手执子方错了');
      // 叠放合法性：这一格必须是该柱最低的空格
      const z = mv.z;
      let low = 0;
      for(let zz = 0; zz < 5; zz++) if(!bd[T.idx(mv.x, mv.y, zz)]){ low = zz; break; }
      if(z !== low) bad.push('第' + mv.k + '手不满足叠放规则（该落第' + (low + 1) + '层，谱上第' + (z + 1) + '层）');
      if(bd[mv.cell]) bad.push('第' + mv.k + '手落在已有子的格上');
      if(mv.profile.colFillBefore !== z) bad.push('第' + mv.k + '手 colFillBefore 与层号不符');
      bd[mv.cell] = mv.who;
      side = 3 - side;
    }
    return bad;
  });
  ok(cons.length === 0, `叠放合法 + 执子交替 + 层号一致${cons.length ? '：' + cons.slice(0, 3).join('；') : ''}`);

  console.log('\n### ② 四个标签页');
  await page.evaluate(() => window.__T.bkShow());
  await page.waitForTimeout(150);
  ok(await page.isVisible('#bkBar'), '点开局手册后面板出现');
  const rows = await page.locator('#bkList .bk-row').count();
  ok(rows === meta.n, `清单行数 = 棋谱手数（${rows} / ${meta.n}）`);

  const sweep = await page.evaluate(() => {
    const T = window.__T, n = T.bkSeq.length;
    const bad = [];
    const tabs = ['list', 'why', 'cand', 'theory'];
    const pid = { list: 'bkList', why: 'bkWhy', cand: 'bkCand', theory: 'bkTheory' };
    for(const t of tabs){
      T.bkShowTab(t);
      const html = T.paneHtml(pid[t]);
      if(!html || html.length < 40) bad.push(t + ' 内容是空的');
      if(/undefined|NaN/.test(html)) bad.push(t + ' 出现了 undefined/NaN');
    }
    // 逐手切换"这一手的道理"和"备选对照"
    for(let k = 0; k < n; k++){
      for(const t of ['why', 'cand']){
        T.bk.sel = k; T.bkShowTab(t);
        const html = T.paneHtml(pid[t]);
        if(/undefined|NaN/.test(html)) bad.push(t + '@' + k + ' 出现 undefined/NaN');
        if(!html.includes(T.bkName(T.bkSeq[k].cell))) bad.push(t + '@' + k + ' 没提到本手坐标');
      }
    }
    T.bkShowTab('list');
    for(let i = 0; i < n; i++){ T.bkClickRow(i); if(T.bk.sel !== i) bad.push('点第 ' + i + ' 行没选中'); }
    return bad;
  });
  ok(sweep.length === 0, `4 标签 × 全部手数 无空、无脏字${sweep.length ? '：' + sweep.slice(0, 4).join('；') : ''}`);

  const candTop = await page.evaluate(() => {
    const T = window.__T; T.bk.sel = 3; T.bkShowTab('cand');
    const q = document.querySelectorAll('#bkCand table.vt tr');
    const tops = document.querySelectorAll('#bkCand table.vt tr.top').length;
    return { rows: q.length, tops, cells: q.length - 1 };
  });
  ok(candTop.tops === 1, `备选对照表恰好标出 1 个「←本手」（实际 ${candTop.tops}）`);
  ok(candTop.cells >= 4, `备选对照表有 ${candTop.cells} 行落点`);

  /* 面板可见性：内容填了但 hidden 没切 = 用户永远看不见（真实踩过的坑，innerHTML 断言抓不到） */
  const vis = await page.evaluate(() => {
    const T = window.__T, bad = [], map = { list:'bkList', why:'bkWhy', cand:'bkCand', theory:'bkTheory' };
    for(const t of Object.keys(map)){
      T.bkShowTab(t);
      for(const id of Object.values(map)){
        const el = document.getElementById(id);
        if(el.hidden !== (id !== map[t])) bad.push('tab=' + t + ' 时 ' + id + (el.hidden ? ' 被藏住' : ' 没藏住'));
      }
      if(t !== 'list'){
        const txt = document.getElementById(map[t]).textContent;
        if(!txt.includes(T.bkName(T.bkSeq[T.bk.sel].cell))) bad.push('tab=' + t + ' 可见面里没有本手坐标');
      }
    }
    T.bkShowTab('list');
    return bad;
  });
  ok(vis.length === 0, `切标签后面板可见性正确${vis.length ? '：' + vis.slice(0, 3).join('；') : ''}`);

  console.log('\n### ③ 摆谱逐字节还原');
  const replay = await page.evaluate(() => {
    const T = window.__T, B = T.OPENING_BOOK;
    const bad = [];
    for(const ply of [0, 1, 5, 10, Math.floor(B.moves.length / 2), B.moves.length]){
      T.bkLoad(ply);
      const h = T.hist();
      if(h.length !== ply) { bad.push('摆到 ' + ply + ' 手，history 长度是 ' + h.length); continue; }
      for(let t = 0; t < ply; t++) if(h[t] !== B.moves[t].cell) { bad.push('摆到 ' + ply + ' 手，第 ' + (t + 1) + ' 手不对'); break; }
      for(let i = 0; i < 125; i++){
        let exp = 0;
        for(let t = 0; t < ply; t++) if(B.moves[t].cell === i) exp = B.moves[t].who;
        if(T.board[i] !== exp) { bad.push('摆到 ' + ply + ' 手，格 ' + i + ' 颜色不对'); break; }
      }
    }
    return bad;
  });
  ok(replay.length === 0, `摆到第 k 手：history + 棋盘逐格一致${replay.length ? '：' + replay.slice(0, 3).join('；') : ''}`);

  console.log('\n### ④ 背谱裁判');
  await page.evaluate(() => { window.__T.bk.userSide = 1; window.__T.bkDrillCheck(true); });
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => window.__T.bkState);
  ok(st.drill && st.i === 0, '打开背谱模式后从第 1 手开始');
  const first = await page.evaluate(() => window.__T.bkSeq[0].cell);
  const wrongCell = await page.evaluate(() => {
    const T = window.__T, want = T.bkSeq[0].cell;
    for(let x = 0; x < 5; x++) for(let y = 0; y < 5; y++){
      const m = T.colTop(x, y);
      if(m >= 0 && m !== want) return m;
    }
    return -1;
  });
  await page.evaluate(w => window.__T.bkDrillHuman(w), wrongCell);
  await page.waitForTimeout(120);
  st = await page.evaluate(() => window.__T.bkState);
  let msg = await page.evaluate(() => window.__T.bkDrillMsgText());
  const wantName = await page.evaluate(() => window.__T.bkName(window.__T.bkSeq[0].cell));
  ok(st.wrong === 1 && st.i === 0, '走错：计数 +1 但手序不前进');
  ok(st.bad.indexOf(0) >= 0, '走错的那一手被记进 bad');
  ok(msg.includes(wantName), `走错时点名了正确手（${wantName}）`);
  ok(await page.evaluate(() => window.__T.bkRowClass(0).includes('bad')), '清单里那一行标红');

  ok(await page.evaluate(() => window.__T.bkFixUndo()), '有「再试一次」按钮');
  await page.evaluate(c => window.__T.bkDrillHuman(c), first);
  await page.waitForTimeout(2400);   // 等对手那一手自动落下（900ms 复核 + 620ms 落子）
  st = await page.evaluate(() => window.__T.bkState);
  ok(st.ok === 1, '走对：正确计数 +1');
  ok(st.i === 2, `走对后对手自动应了一手（i=${st.i}）`);
  const afterOK = await page.evaluate(() => window.__T.hist().length);
  ok(afterOK === 2, `棋盘上已有 2 颗（实际 ${afterOK}）`);

  console.log('\n### ⑤ 导出与往返');
  const md = await page.evaluate(() => window.__T.bkMarkdown());
  const allNames = await page.evaluate(() => {
    const T = window.__T; return T.bkSeq.every(m => T.bkMarkdown().includes(T.bkName(m.cell)));
  });
  ok(allNames, `Markdown 讲解里包含全部 ${meta.n} 手坐标`);
  ok(md.includes('速记表') && md.includes('六句话'), 'Markdown 里有速记表和口诀');
  ok(!/undefined|NaN/.test(md), 'Markdown 里没有 undefined/NaN');

  const rt = await page.evaluate(() => {
    const T = window.__T;
    const rec = T.bkExportRecord();
    const r = T.parseRecords(rec);
    if(!r.recs.length) return { err: '解析失败：' + r.errs.join('；') };
    const back = r.recs[0].moves;
    const want = T.bkSeq.map(m => m.cell);
    if(back.length !== want.length) return { err: '手数不符 ' + back.length + ' vs ' + want.length };
    for(let i = 0; i < want.length; i++) if(back[i] !== want[i]) return { err: '第 ' + (i + 1) + ' 手不符' };
    return { ok: true, n: back.length };
  });
  ok(rt.ok, `导出的棋谱解析回同一串手序${rt.ok ? '（' + rt.n + ' 手）' : '：' + rt.err}`);

  console.log('\n### ⑥ 原有功能未被破坏');
  await page.evaluate(() => { window.__T.bkDrillCheck(false); window.__T.bkHide(); });
  await page.waitForTimeout(100);
  const rvOk = await page.evaluate(() => {
    const T = window.__T;
    const hist = [];
    const seq = [12, 7, 8, 13, 17, 6, 11, 18];
    for(const c of seq) hist.push(c);
    T.setHistory(hist, true, 2);
    T.enterReview();
    const tabs = ['why', 'pv', 'val', 'rep', 'rec'];
    const ids = { why: 'paneWhy', pv: 'panePv', val: 'paneVal', rep: 'paneRep', rec: 'paneRec' };
    const bad = [];
    for(const t of tabs){
      T.rvShowTab(t);
      const h = T.paneHtml(ids[t]);
      if(/undefined|NaN/.test(h)) bad.push(t + ' 有脏字');
    }
    T.exitReview();
    return bad;
  });
  ok(rvOk.length === 0, `复盘 5 个标签仍然正常${rvOk.length ? '：' + rvOk.join('；') : ''}`);
  ok(await page.evaluate(() => window.__T.bkSeq.length > 0), '收起开局手册不影响数据');

  ok(errs.length === 0, `全程零报错${errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''}`);

  console.log('\n' + (fail ? `❌ 失败 ${fail} 项 / 通过 ${pass}` : `✅ 全部通过（${pass} 项）`));
  await b.close();
  process.exit(fail ? 1 : 0);
})();

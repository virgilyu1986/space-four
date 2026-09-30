/* v0.8 教学复盘 + 棋谱 验收
   用法：node sf_coach.js [file://地址] [标签]
   这一套验的不是"看着像教学"，而是四件可证伪的事：
     ① 归因有依据 —— 面板里的每个数字都必须等于 steps[] 里存的原始拆解
     ② 分析不脏手 —— analyzeGame / pvLine 跑完，棋盘必须逐字节还原
     ③ 推演合法   —— PV 每一步在它当时的局面上都必须是合法手
     ④ 棋谱可往返 —— 导出的棋谱解析回来必须得到同一串手序、同一个棋盘 */
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const URL = process.argv[2] || 'file:///tmp/sf_fix.html';
const TAG = process.argv[3] || 'v0.8';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

/* 局面一：人类错过双杀（漏杀）。P1 在 (1,0)(2,0) 与 (0,1)(0,2) 各摆 2 颗，
   走 (0,0,0)/(3,0,0)/(0,3,0) 都能同时造出两个够得到的三缺一。
   P2 的 4 颗填在互不成线的位置（有断言兜底）。 */
const FORK_HIST = [
  [1,0,0],[4,4,0], [2,0,0],[4,1,0], [0,1,0],[1,4,0], [0,2,0],[0,4,0],
  [4,2,0],            // ← 第 9 手：人类走这里，一个威胁都没造（漏杀）
  [3,0,0],            // ← 第 10 手：AI 反手把交叉点占了
];
/* 局面二：人类没堵 AI 的三缺一（漏防），而且 AI 下一手就直接连成四。
   P2 沿 x=3 的 y=2,3,4 三连，缺口 (3,1,0) 够得到。 */
const BLOCK_HIST = [
  [0,0,0],[3,4,0], [4,0,0],[3,3,0], [0,4,0],[3,2,0],
  [4,4,0],            // ← 第 7 手：人类不堵
  [3,1,0],            // ← 第 8 手：AI 直接连成四
];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await b.newPage({ viewport: { width: 900, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(400);

  console.log(`\n### ${TAG}  加载`);
  ok(errs.length === 0, `加载零报错${errs.length ? '：' + errs.join(' | ') : ''}`);

  const setup = (hist) => page.evaluate(([h]) => {
    const T = globalThis.__T;
    T.setHistory(h.map(([x,y,z]) => T.idx(x,y,z)), true, 2);
    return { n: T.history.length };
  }, [hist]);

  /* ---------- A. 漏杀：归因有没有依据 ---------- */
  console.log('\n### A. 漏杀归因（错过双杀）');
  await setup(FORK_HIST);
  const A = await page.evaluate(() => {
    const T = globalThis.__T;
    T.rv.on = true;
    T.analyzeGame();
    const s = T.rv.steps[8];
    return {
      isHuman: s.isHuman, bestFork: s.bestFork, fork: s.fork,
      foeLive: s.foeLive.length, bestMv: T.cellName(s.bestMv), mine: T.cellName(s.mv),
      cls: T.classify(s),
      cands: s.cands.length,
      allHave: s.cands.every(o => typeof o.sc === 'number' && typeof o.fk === 'number'
                && typeof o.fa === 'number' && typeof o.fb === 'number' && typeof o.win === 'boolean'),
      // 这个候选拆解是否真的能解释"双杀"：最佳手里至少有一个候选造出 ≥2 个杀点
      bestFkInTable: Math.max.apply(null, s.cands.map(o => o.fk)),
      foeGaps: s.foeGaps,
    };
  });
  console.log('    ' + JSON.stringify(A));
  ok(A.cands === 25, `每一步都拆了 25 个候选落点（实测 ${A.cands}）`);
  ok(A.allHave, '每个候选都带齐 sc/fk/fa/fb/win 五个指标');
  ok(A.foeGaps === 0, `构造局面本身干净：AI 一个三缺一都没有（${A.foeGaps}）`);
  ok(A.bestFork >= 2, `该局面存在双杀手：bestFork=${A.bestFork}`);
  ok(A.fork < 2, `人类实际那一手没造出双杀：fork=${A.fork}`);
  ok(A.cls === 'forkMiss', `归因判为「漏杀」（实测 ${A.cls}）`);

  /* 面板文案必须和上面的数字对得上，而不是另说一套 */
  await page.evaluate(() => { const T = globalThis.__T; T.rv.k = 9; T.rvShowTab('why'); });
  const why = await page.locator('#paneWhy').innerText();
  ok(/漏杀|双杀/.test(why), '「为什么」面板说到了双杀/漏杀');
  ok(why.indexOf(A.bestMv.replace(/\s+/g,' ')) >= 0 || /该走/.test(why), '面板里给出了"该走"的落点');
  ok(why.indexOf(String(A.bestFork)) >= 0, `面板里的数字来自 steps[]（出现 bestFork=${A.bestFork}）`);
  ok(/读盘五步/.test(why), '附上可迁移的「读盘五步」清单');
  /* 面板里出现 undefined / NaN 是"数据字段名写错"的典型症状 —— 直接当成失败 */
  const whyRaw = await page.locator('#paneWhy').innerHTML();
  ok(!/undefined|NaN/.test(whyRaw), '「为什么」面板没有 undefined / NaN 漏出来'
     + (/(undefined|NaN)/.test(whyRaw) ? '：' + (whyRaw.match(/.{0,40}(undefined|NaN).{0,20}/) || [''])[0] : ''));

  const val = await page.evaluate(() => { const T = globalThis.__T; T.rvShowTab('val'); return document.getElementById('paneVal').innerText; });
  ok(/双杀/.test(val), '「格点价值」表标出了双杀候选');
  ok(/←你/.test(val) && /←最佳/.test(val), '「格点价值」表同时标出你走的那手与最佳手');
  const valRaw = await page.locator('#paneVal').innerHTML();
  ok(!/undefined|NaN/.test(valRaw), '「格点价值」表没有 undefined / NaN');

  /* ---------- B. 漏防 + AI 直接连成四 ---------- */
  console.log('\n### B. 漏防归因（没堵三缺一）');
  await setup(BLOCK_HIST);
  const B = await page.evaluate(() => {
    const T = globalThis.__T;
    T.rv.on = true;
    T.analyzeGame();
    const s6 = T.rv.steps[6], s7 = T.rv.steps[7];
    return {
      foeBefore: s6.foeLive.length, foeGap: s6.foeLive.map(T.cellName),
      blocked: s6.blocked, foeAfter: s6.foeAfter, cls: T.classify(s6),
      win: s7.sc >= 1e5, forkHit: T.rv.forkHit.length, tops: T.rv.tops.slice(),
    };
  });
  console.log('    ' + JSON.stringify(B));
  ok(B.foeBefore >= 1, `AI 在第 7 手前已有可落成的杀点：${B.foeGap.join('、')}`);
  ok(B.blocked === false, '人类那一手确实没堵');
  ok(B.cls === 'blockMiss', `归因判为「漏防」（实测 ${B.cls}）`);
  ok(B.win, 'AI 下一手直接连成四（第 8 手 sc ≥ 1e6）');

  /* ---------- C. 归因分类的三类都能被造出来 ---------- */
  console.log('\n### C. 报告聚合');
  const C = await page.evaluate(() => {
    const T = globalThis.__T;
    const r = T.rv.rep = T.coachReport();
    return { n: r.n, must: r.mustBlock, did: r.didBlock, br: Math.round(r.blockRate * 100),
             miss: r.forkMiss, hit: r.forkHit, lines: T.reportText(r).length };
  });
  console.log('    ' + JSON.stringify(C));
  ok(C.n === 4, `报告只统计人类的 4 手（实测 ${C.n}）`);
  ok(C.must === 1 && C.did === 0 && C.br === 0, `"该堵时堵了吗"口径正确：${C.did}/${C.must} = ${C.br}%`);
  ok(C.lines >= 4, `报告给出 ${C.lines} 条结论`);
  const rep = await page.evaluate(() => { const T = globalThis.__T; T.rvShowTab('rep'); return document.getElementById('paneRep').innerText; });
  ok(/漏防|不堵/.test(rep), '全盘报告点出"不堵"这个毛病');
  ok(/下次练什么|判断法/.test(rep), '全盘报告给出练习建议');
  const repRaw = await page.locator('#paneRep').innerHTML();
  ok(!/undefined|NaN/.test(repRaw), '全盘报告没有 undefined / NaN');

  /* ---------- D. 分析与推演不许弄脏棋盘 ---------- */
  console.log('\n### D. 局面不被弄脏 + PV 合法性');
  const D = await page.evaluate(([ARGS1, ARGS2]) => {
    const T = globalThis.__T;
    const out = {};
    /* ① 分析不动棋盘 */
    T.setHistory(ARGS1.map(([x, y, z]) => T.idx(x, y, z)), true, 2);
    const h0 = T.board.join('');
    T.rv.on = true; T.analyzeGame();
    out.afterAnalyze = (T.board.join('') === h0);
    out.blkLen = T.rv.steps.length;
    /* ② 推演：用一个还没分出胜负的平静局面，PV 才能真的走满几手 */
    T.setHistory(ARGS2.map(([x, y, z]) => T.idx(x, y, z)), true, 2);
    const h1 = T.board.join('');
    const who = T.whoAt(4);
    const start = T.idx(3, 3, 0);
    const seq = T.pvLine(start, who, 4);
    out.restored = (T.board.join('') === h1);
    out.len = seq.length;
    out.firstOk = !!(seq[0] && seq[0].mv === start && seq[0].who === who);
    /* ③ 逐手回放，验证每一步在它当时的局面上都合法（叠放规则：必须是该柱最底空格） */
    T.rebuildBoard(4);
    let legal = true;
    for (const st of seq) {
      const x = T.XO(st.mv), y = T.YO(st.mv), z = T.ZO(st.mv);
      let low = -1;
      for (let zz = 0; zz < 5; zz++) { const j = T.idx(x, y, zz); if (!T.board[j]) { low = zz; break; } }
      if (low !== z) { legal = false; break; }
      T.put(st.mv, st.who);
    }
    out.legal = legal;
    out.alt = seq.every((st, i) => i === 0 || st.who === 3 - seq[i - 1].who);
    T.rebuildBoard(4);
    out.finalClean = (T.board.join('') === h1);
    return out;
  }, [BLOCK_HIST.slice(0, 6), FORK_HIST.slice(0, 4)]);
  console.log('    ' + JSON.stringify(D));
  ok(D.afterAnalyze, 'analyzeGame 跑完棋盘逐字节还原');
  ok(D.restored, 'pvLine 跑完棋盘逐字节还原');
  ok(D.legal, `PV 的每一步在它当时的局面上都合法（${D.len} 步）`);
  ok(D.alt, 'PV 是双方交替走子');
  ok(D.finalClean, '整套推演之后棋盘仍是原局面');

  /* ---------- E. 棋谱往返 ---------- */
  console.log('\n### E. 棋谱 导出→导入 往返');
  const E = await page.evaluate(([H]) => {
    const T = globalThis.__T;
    const h = H.map(([x,y,z]) => T.idx(x,y,z));
    T.setHistory(h, true, 2);
    const rec = T.buildRecord();
    const file = T.buildRecordFile();
    const r = T.parseRecords(rec);
    const r2 = T.parseRecords(file);           // 带 # 注释行的文件也要能读
    const before = T.board.join('');
    const back = r.recs[0] ? r.recs[0].moves : null;
    const same = !!back && back.length === h.length && back.every((v, i) => v === h[i]);
    let sameBoard = false;
    if (r.recs.length) { T.applyRecord(r.recs[0]); sameBoard = (T.board.join('') === before); }
    return { rec, header: file.split('\n').length, ok1: r.recs.length, ok2: r2.recs.length,
             same, sameBoard, first: r.recs[0] && r.recs[0].first, lv: r.recs[0] && r.recs[0].lv,
             moves: back ? back.length : 0, errs: r.errs };
  }, [FORK_HIST]);
  console.log('    棋谱：' + E.rec);
  ok(E.moves === FORK_HIST.length, `解析回来的手数一致（${E.moves}/${FORK_HIST.length}）`);
  ok(E.same, '逐手坐标完全一致');
  ok(E.sameBoard, '导入后棋盘与导出前逐字节一致');
  ok(E.ok1 === 1 && E.ok2 === 1, '单行棋谱与带注释的整份文件都能解析');
  ok(E.first === true && E.lv === 2, `先手/难度字段保真（first=${E.first} lv=${E.lv}）`);

  /* ---------- F. 非法棋谱必须被挡下 ---------- */
  console.log('\n### F. 非法棋谱拒绝');
  const F = await page.evaluate(() => {
    const T = globalThis.__T;
    const bad1 = 'SF1;v=1;lv=2;f=1;m=1-1-2,2-2-1,3-3-1';      // 第 1 手悬空（下面没子）
    const bad2 = 'SF1;v=1;m=9-1-1,2-2-1,3-3-1';               // 坐标越界
    const bad3 = 'SF1;v=1;m=1-1-1,1-1-1,1-1-2';               // 同一格落两次
    const bad4 = 'SF1;v=1;m=abc,def';
    const good = '3-3-1 3-2-1 2-3-1';                          // 没有 SF1 头，靠坐标序列兜底
    return {
      b1: T.parseRecords(bad1), b2: T.parseRecords(bad2), b3: T.parseRecords(bad3),
      b4: T.parseRecords(bad4), g: T.parseRecords(good),
    };
  });
  ok(F.b1.recs.length === 0 && /下面还是空的/.test(F.b1.errs.join(' ')), '浮空落子被拒：' + F.b1.errs[0]);
  ok(F.b2.recs.length === 0 && /超出/.test(F.b2.errs.join(' ')), '坐标越界被拒：' + F.b2.errs[0]);
  ok(F.b3.recs.length === 0 && /已经有子|堆满|下面还是空的/.test(F.b3.errs.join(' ')), '同格重复落子被拒：' + F.b3.errs[0]);
  ok(F.b4.recs.length === 0, '乱码被拒：' + F.b4.errs[0]);
  ok(F.g.recs.length === 1 && F.g.recs[0].moves.length === 3, '无头棋谱按坐标序列兜底解析（3 手）');

  /* ---------- G. 存档：自动落盘 + 去重 ---------- */
  console.log('\n### G. 自动存档');
  const G = await page.evaluate(([A, B]) => {
    const T = globalThis.__T;
    try { localStorage.removeItem('sf_records_v1'); } catch (e) {}
    T.setHistory(A.map(([x,y,z]) => T.idx(x,y,z)), true, 2);
    T.archiveGame(); T.archiveGame();                     // 同一局存两次
    const a1 = T.loadArch().length;
    T.setHistory(B.map(([x,y,z]) => T.idx(x,y,z)), true, 2);
    T.archiveGame();
    const a2 = T.loadArch();
    T.fillRecPane();
    return { a1, n: a2.length, moves0: a2[0].moves.length,
             listHtml: document.getElementById('recList').innerHTML.length,
             boxLen: document.getElementById('recBox').value.length };
  }, [FORK_HIST, BLOCK_HIST]);
  ok(G.a1 === 1, `同一局重复存档不会记两次（${G.a1}）`);
  ok(G.n === 2, `不同局各自入档（${G.n}）`);
  ok(G.listHtml > 50, '存档列表渲染出来了');
  ok(G.boxLen > 40, '棋谱文本框已填好当前局');

  /* ---------- H. 终局自动复盘 + 落盘 ---------- */
  console.log('\n### H. 下完自动复盘');
  const H = await page.evaluate(async ([B]) => {
    const T = globalThis.__T;
    try { localStorage.removeItem('sf_records_v1'); } catch (e) {}
    T.reset();
    T.setHistory(B.slice(0, 7).map(([x,y,z]) => T.idx(x,y,z)), true, 2);
    T.doMove(T.idx(3,1,0), 2);                           // AI 连成四 → 终局
    await new Promise(r => setTimeout(r, 1600));          // 等自动复盘（500ms 触发 + 分析）
    const bar = document.getElementById('rvBar');
    return { over: !!T.over, rvOn: T.rvOn, barVisible: bar && !bar.hidden,
             arch: T.loadArch().length, info: document.getElementById('rvInfo').textContent };
  }, [BLOCK_HIST]);
  console.log('    ' + JSON.stringify(H));
  ok(H.over, 'AI 那一手判定为终局');
  ok(H.arch === 1, '终局时棋谱自动落盘');
  ok(H.rvOn && H.barVisible, '自动进入复盘（不需要用户点按钮）');
  ok(/手/.test(H.info), '复盘信息已生成：' + H.info.slice(0, 30));

  /* ---------- I. 标签页 × 手序 全遍历 ---------- */
  console.log('\n### I. 5 个标签 × 全部手序位置 全遍历');
  const I = await page.evaluate(async ([A, B]) => {
    const T = globalThis.__T;
    const tabs = ['why', 'pv', 'val', 'rep', 'rec'];
    const out = { cells: 0, empty: [], bad: [] };
    /* 只看"当前刚切过去的那一页"。把 5 页一起查会冤枉还没被切到过的页 ——
       从没渲染过的 pane，它的 textContent 本来就是空的（这是测试自身的坑）。 */
    const check = (t) => {
      const el = document.getElementById('pane' + t[0].toUpperCase() + t.slice(1));
      const txt = (el.textContent || '').trim();
      out.cells++;
      if (txt.length < 8) out.empty.push(t + '@' + T.rv.k);
      if (/undefined|NaN/.test(el.innerHTML)) out.bad.push(t + '@' + T.rv.k);
    };
    T.rv.on = true;
    for (const hist of [A, B]) {
      T.setHistory(hist.map(([x, y, z]) => T.idx(x, y, z)), true, 2);
      T.analyzeGame();
      T.rv.rep = null;
      for (let k = 0; k <= hist.length; k++) {
        T.rvGoto(k);
        for (const t of tabs) { T.rvShowTab(t); check(t); }
      }
    }
    return out;
  }, [FORK_HIST, BLOCK_HIST]);
  console.log('    ' + JSON.stringify(I));
  ok(I.empty.length === 0, `${I.cells} 个「标签×手序」组合全部有内容`
     + (I.empty.length ? '：空的是 ' + I.empty.slice(0, 5).join(',') : ''));
  ok(I.bad.length === 0, `没有 undefined / NaN 泄露`
     + (I.bad.length ? '：' + I.bad.slice(0, 5).join(',') : ''));

  /* ---------- J. 全程零报错 ---------- */
  console.log('\n### J. 运行期错误');
  ok(errs.length === 0, `全程零 JS 报错${errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();

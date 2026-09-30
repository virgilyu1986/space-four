// 空间四子棋 v0.7 冒烟测试：加载 → 落子 → 撤销/提示/复盘 → 面板开关
const { chromium } = require('playwright');
// 用法：node sf_smoke.js [url 或 本地文件路径]   默认跑本地 index.html
const TARGET = process.argv[2] || '/Users/yu/WorkBuddy/2026-09-26-23-13-32/space-four/index.html';
const path = /^https?:/.test(TARGET) ? TARGET : TARGET;

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    /* 起本地文件时不会请求 favicon，跑线上 URL 会 —— 这是浏览器自动请求的
       静态资源 404，不是 JS 错误，别把它算进"页面报错" */
    if (/Failed to load resource|favicon/i.test(t)) return;
    errs.push('console: ' + t);
  });

  await page.goto(/^https?:/.test(path) ? path : 'file://' + path);
  await page.waitForTimeout(400);

  console.log('[1] 加载');
  ok(errs.length === 0, '加载无 JS 错误' + (errs.length ? ' → ' + errs[0] : ''));
  ok(await page.locator('#cv').isVisible(), 'canvas 可见');
  const box = await page.locator('#cv').boundingBox();
  ok(box && box.width > 300 && box.height > 300, `canvas 尺寸 ${box.width}x${box.height}`);

  console.log('[2] 落子（扫描点击，等待 AI 应手）');
  let moves = 0;
  const cols = 13, rows = 13;
  for (let i = 0; i < cols && moves < 6; i++) {
    for (let j = 0; j < rows && moves < 6; j++) {
      const x = box.x + box.width * (0.12 + 0.76 * i / (cols - 1));
      const y = box.y + box.height * (0.15 + 0.70 * j / (rows - 1));
      await page.mouse.click(x, y);
      await page.waitForTimeout(120);
      const st = await page.locator('#status').textContent();
      if (st && !/点空地方|已经堆满|必须先有下层子/.test(st)) {
        moves++;
        await page.waitForTimeout(600); // 等 AI 应手
      }
    }
  }
  ok(moves >= 4, `成功落子 ${moves} 手（含 AI 应手）`);
  ok(errs.length === 0, '落子阶段无 JS 错误' + (errs.length ? ' → ' + errs[0] : ''));

  console.log('[3] 按钮：撤销 / 提示');
  await page.click('#btnUndo'); await page.waitForTimeout(200);
  ok(errs.length === 0, '撤销无错误');
  await page.click('#btnHint'); await page.waitForTimeout(400);
  const hint = await page.locator('#status').textContent();
  ok(!!hint && hint.length > 0, '提示返回文案：' + (hint || '').slice(0, 28));

  console.log('[4] 复盘');
  await page.click('#btnReview'); await page.waitForTimeout(900);
  const rvVisible = await page.locator('#rvBar').isVisible();
  ok(rvVisible, '复盘条可见');
  const rvInfo = (await page.locator('#rvInfo').textContent()) || '';
  ok(rvInfo.length > 0, '复盘信息：' + rvInfo.slice(0, 40).replace(/\s+/g, ' '));
  const rvNote = (await page.locator('#rvNote').textContent()) || '';
  ok(rvNote.length > 0, '复盘批注：' + rvNote.slice(0, 40).replace(/\s+/g, ' '));
  for (const b of ['#rvNext', '#rvNext', '#rvPrev', '#rvLast', '#rvFirst']) {
    await page.click(b); await page.waitForTimeout(180);
  }
  ok(errs.length === 0, '回放跳转无错误' + (errs.length ? ' → ' + errs[0] : ''));
  const step2 = (await page.locator('#rvStep').textContent()) || '';
  ok(step2.length > 0, '回放步数文案：' + step2.slice(0, 30).replace(/\s+/g, ' '));
  await page.click('#rvExit'); await page.waitForTimeout(250);
  ok(errs.length === 0, '退出复盘无错误');

  console.log('[5] 面板开关');
  for (const id of ['#cbTri', '#cbDrop', '#cbStub', '#cbGhost', '#cbThreat', '#cbGrid', '#cbAutoRv']) {
    await page.click(id); await page.waitForTimeout(90);
    await page.click(id); await page.waitForTimeout(90);
  }
  ok(errs.length === 0, '复选框来回切换无错误' + (errs.length ? ' → ' + errs[0] : ''));
  for (const sel of ['#segView', '#segGap', '#segFocus', '#segLayer', '#segLv', '#segFirst']) {
    const btns = page.locator(sel + ' button');
    const n = await btns.count();
    for (let i = 0; i < n; i++) { await btns.nth(i).click(); await page.waitForTimeout(120); }
  }
  ok(errs.length === 0, '分段控件全量切换无错误' + (errs.length ? ' → ' + errs[0] : ''));

  console.log('[6] 新局 + 滚轮缩放');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); await page.waitForTimeout(200);
  await page.mouse.wheel(0, 800); await page.waitForTimeout(200);
  await page.click('#btnNew'); await page.waitForTimeout(400);
  ok(errs.length === 0, '新局无错误');
  const st2 = (await page.locator('#status').textContent()) || '';
  ok(st2.length > 0, '新局状态：' + st2.slice(0, 30));

  await page.screenshot({ path: '/tmp/sf_smoke.png', fullPage: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (errs.length) console.log('错误明细：\n' + errs.slice(0, 8).join('\n'));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

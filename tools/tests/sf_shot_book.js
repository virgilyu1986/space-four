// 开局手册 + 背谱模式 界面截图
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const OUT = '/Users/yu/WorkBuddy/2026-09-26-23-13-32/space-four/shots/';
const URL = process.argv[2] || 'file:///tmp/sf_bk.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await b.newPage({ viewport: { width: 1180, height: 1500 }, deviceScaleFactor: 2 });
  await page.goto(URL);
  await page.waitForTimeout(500);
  await page.evaluate(() => globalThis.__T.setCam(45 * Math.PI / 180, 34 * Math.PI / 180));
  await page.evaluate(() => globalThis.__T.bkShow());
  await page.waitForTimeout(500);
  await page.mouse.move(5, 5);

  const shot = async (tab, name, wait, sel) => {
    await page.evaluate(([t, s]) => { if (s !== null) globalThis.__T.bk.sel = s; globalThis.__T.bkShowTab(t); }, [tab, sel === undefined ? null : sel]);
    await page.waitForTimeout(wait || 400);
    await page.locator('#bkBar').screenshot({ path: OUT + name });
    console.log('  → ' + name);
  };
  await shot('list', 'book-1-list.png', 400);
  await shot('why', 'book-2-why.png', 400, 0);
  await shot('why', 'book-3-why-block.png', 400, 11);   // 找个中局的讲解
  await shot('cand', 'book-4-cand.png', 400, 11);
  await shot('theory', 'book-5-theory.png', 400);

  /* 整页：面板 + 棋盘 */
  await page.evaluate(() => { globalThis.__T.bk.sel = 0; globalThis.__T.bkShowTab('list'); globalThis.__T.bkLoad(6); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'book-6-page.png', fullPage: true });
  console.log('  → book-6-page.png');

  /* 背谱模式：走对与走错两个状态 */
  await page.evaluate(() => { globalThis.__T.bk.userSide = 1; globalThis.__T.bkDrillCheck(true); });
  await page.waitForTimeout(700);
  await page.locator('#bkBar').screenshot({ path: OUT + 'book-7-drill.png' });
  console.log('  → book-7-drill.png');
  await page.evaluate(() => {
    const T = globalThis.__T;
    let w = -1;
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) { const m = T.colTop(x, y); if (m >= 0 && m !== T.bkSeq[0].cell && w < 0) w = m; }
    T.bkDrillHuman(w);
  });
  await page.waitForTimeout(400);
  await page.locator('#bkDrillBox').screenshot({ path: OUT + 'book-8-drill-wrong.png' });
  console.log('  → book-8-drill-wrong.png');

  await b.close();
})();

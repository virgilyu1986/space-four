// v0.8 教学复盘界面截图
const { chromium } = require('playwright');
const EXE = '/Users/yu/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const OUT = '/Users/yu/WorkBuddy/2026-09-26-23-13-32/space-four/shots/';
const HS = [[1,0,0],[4,4,0],[2,0,0],[4,1,0],[0,1,0],[1,4,0],[0,2,0],[0,4,0],[4,2,0],[3,0,0]];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const page = await b.newPage({ viewport: { width: 1180, height: 1500 }, deviceScaleFactor: 2 });
  await page.goto('file:///tmp/sf_fix.html');
  await page.waitForTimeout(400);
  await page.evaluate(([h]) => {
    const T = globalThis.__T;
    T.setCam(45 * Math.PI / 180, 34 * Math.PI / 180);
    T.setHistory(h.map(([x, y, z]) => T.idx(x, y, z)), true, 2);
    T.enterReview();
  }, [HS]);
  await page.waitForTimeout(2200);
  // 停在第 9 手（人类错过双杀的那一手）
  await page.evaluate(() => globalThis.__T.rvGoto(9));
  await page.waitForTimeout(400);
  await page.mouse.move(5, 5);
  const shot = async (tab, name, wait) => {
    await page.evaluate(t => globalThis.__T.rvShowTab(t), tab);
    await page.waitForTimeout(wait || 500);
    await page.locator('#rvBar').screenshot({ path: OUT + name });
    console.log('  → ' + name);
  };
  await shot('why', 'coach-1-why.png');
  await shot('pv', 'coach-2-pv.png', 2600);      // PV 是现场搜索，要等
  await shot('val', 'coach-3-val.png');
  await shot('rep', 'coach-4-rep.png');
  await shot('rec', 'coach-5-rec.png');
  // 整页（含棋盘）
  await page.evaluate(() => globalThis.__T.rvShowTab('why'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + 'coach-6-page.png', fullPage: true });
  console.log('  → coach-6-page.png');
  // 终局条（关掉自动复盘时的样子）
  await page.evaluate(() => {
    const T = globalThis.__T;
    document.getElementById('cbAutoRv').checked = false;
    T.exitReview();
    const H = [[0,0,0],[3,4,0],[4,0,0],[3,3,0],[0,4,0],[3,2,0],[4,4,0]].map(([x,y,z]) => T.idx(x,y,z));
    T.setHistory(H, true, 2);
    T.doMove(T.idx(3,1,0), 2);
  });
  await page.waitForTimeout(600);
  await page.locator('#endBar').screenshot({ path: OUT + 'coach-7-endbar.png' });
  console.log('  → coach-7-endbar.png');
  await b.close();
})();

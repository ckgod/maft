import { chromium, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = process.env.MAFT_BASE ?? 'http://localhost:5173';
const OUT = resolve(import.meta.dirname, '../docs/img');
const VW = 1440;
const VH = 900;

const ANSWERS = [
  'State hoisting은 Composable의 상태를 부모로 끌어올려 자식 Composable을 stateless하게 만드는 패턴입니다. 이렇게 하면 같은 Composable을 다른 상태와 함께 재사용할 수 있습니다.',
  '단방향 데이터 흐름을 위해 value와 onValueChange를 함께 끌어올립니다. 이벤트는 위로, 상태는 아래로 흐르며, 상태의 소유자와 사용자가 분리됩니다. 결과적으로 테스트 가능성과 재사용성이 함께 좋아집니다.',
  '끌어올리는 위치는 그 상태를 공유해야 하는 가장 가까운 공통 조상이 좋습니다. ViewModel까지 끌어올리면 화면 회전이나 프로세스 사망 후에도 SavedStateHandle로 복원할 수 있습니다. 다만 스크롤 위치 같은 컴포저블 로컬 UI 상태는 굳이 hoist하지 않는 편이 추상화가 깔끔합니다.',
];

const SEARCH_QUERY = 'State hoisting';

async function settle(page: Page, ms = 600) {
  await page.waitForTimeout(ms);
}

async function waitForCoachCount(page: Page, n: number, timeoutMs = 90_000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.entry-coach:not(.entry-pending)').length >= expected,
    n,
    { timeout: timeoutMs },
  );
}

async function sendAnswer(page: Page, text: string, expectedCoachCount: number) {
  const textarea = page.locator('.composer textarea');
  await textarea.click();
  await textarea.fill(text);
  await page.locator('.composer button').click();
  await waitForCoachCount(page, expectedCoachCount);
  await settle(page, 1200);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  console.log(`[capture] navigating ${BASE}`);
  await page.goto(BASE);
  await page.waitForSelector('.index-row');
  await page.waitForLoadState('networkidle');
  await settle(page, 1500);

  console.log(`[capture] filtering "${SEARCH_QUERY}"`);
  await page.locator('.main-search').fill(SEARCH_QUERY);
  await page.waitForFunction(
    () => document.querySelectorAll('.index-row').length > 0,
  );
  await settle(page, 600);

  console.log('[capture] entering session');
  await page.locator('.index-row').first().click();
  await page.waitForSelector('.entry-coach:not(.entry-pending)', { timeout: 90_000 });
  await settle(page, 1500);

  for (let i = 0; i < ANSWERS.length; i++) {
    const idx = i + 1;
    console.log(`[capture] sending answer ${idx}/${ANSWERS.length}`);
    const answer = ANSWERS[i];
    if (!answer) continue;
    await sendAnswer(page, answer, idx + 1);
  }

  console.log('[capture] capturing rubric.png');
  const rubric = page.locator('.rubric-figure').first();
  if (await rubric.count()) {
    await rubric.scrollIntoViewIfNeeded();
    await settle(page, 400);
    await rubric.screenshot({ path: resolve(OUT, 'rubric.png') });
  } else {
    console.warn('[capture] rubric-figure not found, skipping rubric.png');
  }

  console.log('[capture] capturing session.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 400);
  await page.screenshot({ path: resolve(OUT, 'session.png'), fullPage: false });

  console.log('[capture] returning to index');
  await page.locator('.link-back').click();
  await page.waitForSelector('.index-row');
  await page.locator('.main-search').fill('');
  await settle(page, 1200);

  console.log('[capture] capturing index.png');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(OUT, 'index.png'), fullPage: false });

  await browser.close();
  console.log(`[capture] done — wrote ${OUT}`);
}

main().catch((err) => {
  console.error('[capture] failed:', err);
  process.exit(1);
});

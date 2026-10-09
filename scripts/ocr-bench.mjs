// OCR 정확도 비교: test/fixtures/ocr-bench/의 가상 채용공고 이미지를 웹앱의 실제 추출 코드(public/extract.js)로
// 브라우저 안에서 인식하고, 같은 기준으로 점수를 낸다. 수정 전후 비교는 두 서버 주소로 각각 실행한다.
//   node scripts/ocr-bench.mjs                       (이 폴더로 로컬 서버를 띄워 측정)
//   OCR_BENCH_BASE=http://127.0.0.1:3301 node scripts/ocr-bench.mjs   (이미 떠 있는 다른 버전 서버로 측정)
//   --json=결과.json  결과 저장, --show  인식 결과 출력(가상 문서라 출력해도 됨, 로컬 확인용), --dump=폴더  전처리 이미지 저장
//   --before=이전결과.json --md=보고서.md  수정 전후 비교표 작성
// 기준 (공백 제외):
//   글자 일치율: 정답 전체와 인식 전체의 편집거리 기반 (줄 순서가 틀리면 낮아짐)
//   줄 인식: 정답 줄과 90% 이상 같은 인식 줄이 있는 비율 (누락 확인)
//   항목명-값: '급여'와 '연봉 3,200만원 ~ 4,000만원'처럼 항목명과 값이 같은 줄에 그 순서로 정확히 있는 비율
//   숫자: 정답의 숫자 묶음(금액·날짜·시간)이 그대로 있는 비율 (예: 3,200 / 09:30 / 2027.01.04)
//   순서: 여러 장을 합친 결과에서 각 이미지의 줄이 정한 순서대로 나오는지
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const FIX = 'test/fixtures/ocr-bench';
const PORT = Number(process.env.OCR_BENCH_PORT) || 3221;
const EXTERNAL = process.env.OCR_BENCH_BASE;
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}`;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1] ?? (process.argv.includes(`--${k}`) ? true : null);
const manifest = JSON.parse(await readFile(path.join(FIX, 'manifest.json'), 'utf8'));
// 실제 서비스에서 오류가 난 캡처 (test/fixtures/ocr-real/)도 같은 기준으로 잰다
const real = JSON.parse(await readFile('test/fixtures/ocr-real/manifest.json', 'utf8').catch(() => '{"sets":[]}'));
manifest.sets.push(...real.sets);
const only = arg('sets') ? String(arg('sets')).split(',') : null;
const OPTS = arg('opts') ? JSON.parse(String(arg('opts'))) : {}; // 비교용 전처리 설정 (예: --opts={"prep":"none"})

const squeeze = (s) => s.replace(/\s/g, '');
function distance(a, b) {
  const x = [...a]; const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
const similarity = (a, b) => { const x = squeeze(a); const y = squeeze(b); return x.length || y.length ? 1 - distance(x, y) / Math.max(x.length, y.length) : 1; };
// 정답 줄과 가장 비슷한 인식 줄 (인식 줄 하나가 정답 줄을 포함하거나, 정답 줄이 두 인식 줄에 걸친 경우도 본다)
function bestLine(truthLine, ocrLines) {
  let best = { sim: 0, at: -1 };
  const t = squeeze(truthLine);
  ocrLines.forEach((line, i) => {
    const o = squeeze(line);
    const sim = o.includes(t) ? 1 : similarity(t, o);
    if (sim > best.sim) best = { sim, at: i };
  });
  return best;
}
const NUM = /\d[\d,.:~-]*\d|\d/g;

function scoreImage(img, text) {
  const ocrLines = text.split('\n').filter((l) => l.trim());
  const lines = img.lines.map((l) => ({ line: l, ...bestLine(l, ocrLines) }));
  const pairs = img.pairs.map(([k, v]) => ocrLines.some((l) => { const s = squeeze(l); const a = s.indexOf(squeeze(k)); return a >= 0 && s.indexOf(squeeze(v), a + squeeze(k).length) >= 0; }));
  const nums = img.lines.flatMap((l) => squeeze(l).match(NUM) ?? []);
  const sq = squeeze(text);
  const numsOk = nums.filter((n) => sq.includes(n));
  return {
    charAcc: similarity(img.lines.join('\n'), text),
    lineRecall: lines.filter((l) => l.sim >= 0.9).length / lines.length,
    missedLines: lines.filter((l) => l.sim < 0.9).map((l) => l.line),
    pairOk: pairs.length ? pairs.filter(Boolean).length / pairs.length : null,
    pairsTotal: pairs.length,
    pairsOk: pairs.filter(Boolean).length,
    numsTotal: nums.length,
    numsOk: numsOk.length,
    missedNums: nums.filter((n) => !sq.includes(n)),
    // 따로 한 줄씩 나와야 하는 항목(예: 2열 복리후생): 다른 항목과 한 줄로 섞이지 않고 정확히 나온 수
    itemsTotal: (img.items ?? []).length,
    itemsOk: (img.items ?? []).filter((it) => ocrLines.some((l) => {
      const s = squeeze(l);
      return s.includes(squeeze(it)) && !(img.items ?? []).some((o) => o !== it && s.includes(squeeze(o)));
    })).length,
    itemsFound: (img.items ?? []).filter((it) => sq.includes(squeeze(it))).length,
  };
}

const server = EXTERNAL ? null : spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DEMO_MODE: 'true' }, stdio: 'ignore' });
let browser;
const report = { base: BASE, opts: OPTS, sets: [] };
try {
  for (let i = 0; i < 30; i += 1) { try { await fetch(`${BASE}/api/config`); break; } catch { await sleep(500); } }
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE);
  for (const set of manifest.sets) {
    if (only && !only.includes(set.name)) continue;
    const files = await Promise.all(set.images.map(async (img) => ({ name: path.basename(img.file), b64: (await readFile(path.join(FIX, img.file))).toString('base64') })));
    const t0 = Date.now();
    const out = await page.evaluate(async ({ list, opts }) => {
      const { extractTextFromImages } = await import('/extract.js');
      const toFile = ({ name, b64 }) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg' });
      const items = [];
      const prepared = [];
      const layouts = [];
      const cellLogs = [];
      const res = await extractTextFromImages(list.map(toFile), () => {}, (i, r) => { items[i] = r; }, { ...opts, onPrepared: (c) => prepared.push(c.toDataURL('image/png')), onLayout: (l) => layouts.push(l), onCell: opts.cellLog ? (c) => cellLogs.push(c) : undefined });
      items.forEach((it, i) => { if (it && layouts[i]) it.layout = layouts[i]; });
      items.forEach((it, i) => { if (it) it.prepared = prepared[i]; });
      return { items, text: res.text, failed: res.failed, lowConfidence: res.lowConfidence, cellLogs };
    }, { list: files, opts: OPTS });
    const seconds = (Date.now() - t0) / 1000;
    if (OPTS.cellLog) for (const c of out.cellLogs) console.log(`  칸 ${c.bi}-${c.si}: 전체[${c.whole}] → 선택[${c.chosen}]`);
    if (arg('dump')) for (const [k, it] of out.items.entries()) if (it?.prepared) await writeFile(path.join(String(arg('dump')), `prep-${path.basename(set.images[k].file).replace(/\.\w+$/, '')}.png`), Buffer.from(it.prepared.split(',')[1], 'base64'));
    const images = set.images.map((img, k) => {
      const item = out.items[k] ?? {};
      return { file: img.file, ok: item.ok, quality: item.quality ?? null, confidence: Math.round(item.confidence ?? 0), ...scoreImage(img, item.ok ? item.text : ''), text: item.text, words: item.words, uncertain: item.uncertain, layout: item.layout, readLines: item.lines, inkLines: item.inkLines };
    });
    // 합친 결과의 순서: 각 이미지 첫 줄·마지막 줄의 위치가 정한 순서대로 증가하는지
    const combinedLines = out.text.split('\n').filter((l) => l.trim());
    const anchors = set.images.flatMap((img) => [img.lines[0], img.lines.at(-1)]).map((l) => bestLine(l, combinedLines));
    const ordered = anchors.every((a, i) => i === 0 || (a.at >= anchors[i - 1].at && a.sim >= 0.6));
    report.sets.push({ name: set.name, title: set.title, seconds, ordered, combinedAcc: similarity(set.images.flatMap((i) => i.lines).join('\n'), out.text), images });
  }
} finally {
  if (browser) await browser.close();
  server?.kill();
}

const pct = (v) => (v == null ? '  -  ' : `${(v * 100).toFixed(1).padStart(5)}%`);
console.log(`대상: ${BASE}${Object.keys(OPTS).length ? ` 설정 ${JSON.stringify(OPTS)}` : ''}`);
console.log('세트/이미지                    글자     줄     항목-값   숫자      신뢰도  상태');
const all = [];
for (const s of report.sets) {
  for (const im of s.images) {
    all.push(im);
    console.log(`${`${s.name}/${path.basename(im.file)}`.padEnd(30)} ${pct(im.charAcc)} ${pct(im.lineRecall)} ${im.pairsTotal ? `${im.pairsOk}/${im.pairsTotal}`.padStart(6) : '     -'}    ${`${im.numsOk}/${im.numsTotal}`.padStart(5)}    ${String(im.confidence).padStart(4)}   ${im.ok ? (im.quality ?? 'ok') : 'fail'}${im.inkLines ? ` (줄 ${im.readLines}/${im.inkLines})` : ''}`);
    if (arg('layout') && im.layout) {
      console.log(`--- 배치 (글자 줄 높이 ${im.layout.th}px)`);
      for (const b of im.layout.blocks) console.log(`  행 y${b.y0}-${b.y1}: ${b.segs.map((g) => `[x${g.x0}-${g.x1} y${g.y0}-${g.y1}]`).join(' ')}`);
      const yr = String(arg('layout')).match(/^(\d+)-(\d+)$/);
      if (yr) for (const w of im.layout.words.filter((x) => x.bbox.y1 > +yr[1] && x.bbox.y0 < +yr[2])) console.log(`    ${w.text}(${Math.round(w.confidence)}) x${Math.round(w.bbox.x0)}-${Math.round(w.bbox.x1)} y${Math.round(w.bbox.y0)}-${Math.round(w.bbox.y1)}`);
    }
    if (arg('show')) console.log(`--- 인식 결과\n${im.text}\n--- 신뢰도 70 미만 단어: ${(im.words ?? []).filter((w) => w.confidence < 70).map((w) => `${w.text}(${Math.round(w.confidence)})`).join(' ')}`);
    if (im.missedLines.length) console.log(`      놓친 줄: ${im.missedLines.join(' | ')}`);
    if (im.missedNums.length) console.log(`      틀린 숫자: ${im.missedNums.join(' ')}`);
    if (im.itemsTotal) console.log(`      따로 나온 항목: ${im.itemsOk}/${im.itemsTotal} (어디든 나온 항목 ${im.itemsFound}/${im.itemsTotal})`);
    if (im.uncertain?.length) console.log(`      확인 표시한 숫자: ${im.uncertain.join(' ')}`);
  }
  console.log(`  ${s.name}: 합친 결과 글자 ${pct(s.combinedAcc)}, 이미지 순서 ${s.ordered ? '유지' : '틀림'}, ${s.seconds.toFixed(1)}초`);
}
const sum = (f) => all.reduce((n, im) => n + f(im), 0);
const total = {
  charAcc: sum((im) => im.charAcc) / all.length,
  lineRecall: sum((im) => im.lineRecall) / all.length,
  pairs: `${sum((im) => im.pairsOk)}/${sum((im) => im.pairsTotal)}`,
  nums: `${sum((im) => im.numsOk)}/${sum((im) => im.numsTotal)}`,
  ordered: `${report.sets.filter((s) => s.ordered).length}/${report.sets.length}`,
  seconds: report.sets.reduce((n, s) => n + s.seconds, 0),
};
report.total = total;
console.log(`\n전체 ${all.length}장: 글자 ${pct(total.charAcc)}, 줄 ${pct(total.lineRecall)}, 항목-값 ${total.pairs}, 숫자 ${total.nums}, 순서 유지 ${total.ordered}세트, ${total.seconds.toFixed(0)}초`);
if (arg('json')) {
  await mkdir(path.dirname(String(arg('json'))), { recursive: true });
  await writeFile(String(arg('json')), `${JSON.stringify(report, null, 2)}\n`);
}

// --before=이전결과.json --md=보고서.md : 수정 전후를 같은 기준으로 비교한 표를 쓴다
if (arg('md') && arg('before')) {
  const before = JSON.parse(await readFile(String(arg('before')), 'utf8'));
  const p = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
  const find = (setName, file) => before.sets.find((s) => s.name === setName)?.images.find((im) => im.file === file);
  const rows = report.sets.flatMap((s) => s.images.map((im) => {
    const b = find(s.name, im.file) ?? {};
    const pair = (x) => (x.pairsTotal ? `${x.pairsOk}/${x.pairsTotal}` : '-');
    return `| ${s.name}/${path.basename(im.file)} | ${p(b.charAcc)} → **${p(im.charAcc)}** | ${p(b.lineRecall)} → ${p(im.lineRecall)} | ${pair(b)} → ${pair(im)} | ${b.numsOk}/${b.numsTotal} → ${im.numsOk}/${im.numsTotal} | ${b.ok ? (b.quality ?? '성공') : '실패'} → ${im.quality ?? '-'} |`;
  }));
  const bt = before.total;
  const md = [
    '# OCR 정확도 비교 (수정 전 → 수정 후)', '',
    `- 측정: \`node scripts/ocr-bench.mjs\` (채용공고 이미지 ${rows.length}장: 가상 이미지 test/fixtures/ocr-bench/, 실제 서비스 오류 캡처 test/fixtures/ocr-real/, 같은 기준·같은 브라우저 안 Tesseract.js)`,
    `- 수정 전: ${arg('before-label') ?? String(arg('before'))}`,
    '- 기준(공백 제외): 글자 일치율(줄 순서 포함), 줄 인식(정답 줄과 90% 이상 같은 줄), 항목명-값(같은 줄에 순서대로 정확히), 숫자(금액·날짜·시간 묶음이 그대로)',
    '- 상태: good(확인 표시 없음) / check(확인할 숫자·글자 있음) / low(일부만 읽힘·신뢰도 낮음). 상태 판단이 없던 버전은 글자가 조금이라도 나오면 \'성공\'', '',
    '| 세트 | 수정 전 | 수정 후 |', '|---|---|---|',
    `| 글자 일치율(평균) | ${p(bt.charAcc)} | **${p(total.charAcc)}** |`,
    `| 줄 인식(평균) | ${p(bt.lineRecall)} | **${p(total.lineRecall)}** |`,
    `| 항목명-값 연결 | ${bt.pairs} | **${total.pairs}** |`,
    `| 숫자(금액·날짜·시간) | ${bt.nums} | **${total.nums}** |`,
    `| 여러 장 순서 유지 | ${bt.ordered} | **${total.ordered}** |`,
    `| 걸린 시간(전체) | ${bt.seconds.toFixed(0)}초 | ${total.seconds.toFixed(0)}초 |`, '',
    '| 이미지 | 글자 | 줄 | 항목명-값 | 숫자 | 상태 |', '|---|---|---|---|---|---|', ...rows, '',
  ].join('\n');
  await writeFile(String(arg('md')), md);
  console.log(`비교 보고서: ${arg('md')}`);
}

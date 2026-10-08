// `vercel build` 결과물(.vercel/output)을 점검한다. 실제 배포 전 회귀 확인용.
//   node scripts/check-vercel-output.mjs [프로젝트 경로]   (먼저 그 경로에서 `vercel build` 실행)
// 1) 정적 파일: 화면에 필요한 파일과 vendor 파일이 static/에 있는지
// 2) 함수: 배포 때처럼 .vc-config.json의 filePathMap 파일을 함수 폴더에 모은 뒤,
//    Vercel 실행기처럼 import → default (req, res) 핸들러로 GET /, /api/config, POST /api/analyze를 호출
// 3) 함수 번들 크기와 public/vendor 제외 여부
// DEMO_MODE=true로 실행하므로 외부 API를 호출하지 않는다.
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.argv[2] ?? '.');
const OUT = path.join(ROOT, '.vercel/output');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const config = JSON.parse(await readFile(path.join(OUT, 'config.json'), 'utf8'));
console.log('routes:', JSON.stringify(config.routes));

// 1) 정적 파일
const STATIC = ['index.html', 'app.js', 'styles.css', 'upload-rules.js', 'extract.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap',
  'vendor/tesseract/tesseract.esm.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js', 'vendor/tessdata/kor.traineddata.gz', 'vendor/tessdata/eng.traineddata.gz'];
const missingStatic = STATIC.filter((f) => !existsSync(path.join(OUT, 'static', f)));
check('정적 파일(화면·업로드·vendor)이 static/에 있음', missingStatic.length === 0, missingStatic.join(', ') || `${STATIC.length}개`);

// 2) 함수를 배포 때처럼 조립
const funcDir = path.join(OUT, 'functions/index.func');
const vc = JSON.parse(await readFile(path.join(funcDir, '.vc-config.json'), 'utf8'));
const mapped = Object.entries(vc.filePathMap ?? {});
const tmp = await mkdtemp(path.join(os.tmpdir(), 'vercel-func-'));
await cp(funcDir, tmp, { recursive: true });
for (const [dest, src] of mapped) {
  await mkdir(path.dirname(path.join(tmp, dest)), { recursive: true });
  await cp(path.join(ROOT, src), path.join(tmp, dest));
}
const publicInFunc = mapped.map(([d]) => d).filter((d) => d.startsWith('public/'));
const vendorInFunc = publicInFunc.filter((d) => d.startsWith('public/vendor/'));
check('함수에 메인 화면 파일 포함 (/ 요청은 함수가 처리)', publicInFunc.includes('public/index.html'), publicInFunc.filter((d) => !d.startsWith('public/vendor/')).join(', ') || '없음');
check('함수에 vendor(약 20MB) 미포함', vendorInFunc.length === 0, `${vendorInFunc.length}개`);
let funcBytes = 0;
for (const [dest] of mapped) funcBytes += (await stat(path.join(tmp, dest))).size;
check('함수 번들 크기', funcBytes < 5 * 1024 * 1024, `${(funcBytes / 1024 / 1024).toFixed(2)}MB (node_modules 포함 추적 파일)`);

process.env.DEMO_MODE = 'true';
process.env.VERCEL = '1';
let mod = await import(pathToFileURL(path.join(tmp, vc.handler)).href);
for (let i = 0; i < 5 && mod?.default; i += 1) mod = mod.default;
check('핸들러 형태: (req, res) 함수', typeof mod === 'function');
const srv = http.createServer(mod);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
try {
  const home = await fetch(`${base}/`, { headers: { 'cache-control': 'no-cache' } });
  const homeText = await home.text();
  check('GET / → 메인 index.html', home.status === 200 && homeText.includes('<title>일단확인</title>'), `HTTP ${home.status} ${home.headers.get('content-type')}${home.status !== 200 ? ` ${homeText.slice(0, 60)}` : ''}`);
  const cfg = await fetch(`${base}/api/config`);
  check('GET /api/config', cfg.status === 200, `HTTP ${cfg.status} ${await cfg.text()}`);
  const an = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docType: 'job_posting', text: '급여: 월 250만원\n근무지: 서울 (가상 예시)' }) });
  const aj = await an.json();
  check('POST /api/analyze', an.status === 200 && aj.items?.length === 8, `HTTP ${an.status} items=${aj.items?.length}`);
} finally {
  srv.close();
  await rm(tmp, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\nVercel 빌드 결과 점검: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;

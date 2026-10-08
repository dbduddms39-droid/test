// 실제 배포 주소 점검: 새로고침(/), 정적 파일, vendor 파일, /api/config, /api/analyze
//   node scripts/smoke-deployed.mjs https://배포주소 [--skip-analyze]
// /api/analyze는 가상 문서 1건으로 Gemini 무료 등급을 1회 호출한다 (--skip-analyze로 생략).
// 출력에 API 키나 문서 원문을 남기지 않는다.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!arg) { console.error('사용법: node scripts/smoke-deployed.mjs https://배포주소 [--skip-analyze]'); process.exit(2); }
const BASE = new URL(arg).origin;
const SKIP_ANALYZE = process.argv.includes('--skip-analyze');
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const NO_CACHE = { 'cache-control': 'no-cache', pragma: 'no-cache' };
console.log(`대상: ${BASE}`);

// 1) 새로고침: 메인 화면 (캐시 없이 여러 번, 해시 경로 포함)
for (const p of ['/', '/?refresh=1', '/index.html']) {
  const res = await fetch(`${BASE}${p}`, { headers: NO_CACHE, redirect: 'follow' });
  const text = await res.text();
  const ok = res.status === 200 && /text\/html/.test(res.headers.get('content-type') ?? '') && text.includes('<title>일단확인</title>');
  const hint = res.status === 401 ? ' (Vercel Deployment Protection으로 보호된 주소일 수 있음)' : '';
  check(`GET ${p} → 메인 화면`, ok, `HTTP ${res.status} ${res.headers.get('content-type')}${ok ? '' : ` ${text.slice(0, 80)}${hint}`}`);
}

// 2) 정적 파일: 저장소 파일과 내용이 같은지 (vendor 포함)
const STATIC = [
  ['app.js', /javascript/], ['styles.css', /css/], ['upload-rules.js', /javascript/], ['extract.js', /javascript/],
  ['vendor/pdfjs/pdf.min.mjs', /javascript/], ['vendor/pdfjs/pdf.worker.min.mjs', /javascript/],
  ['vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap', /./],
  ['vendor/tesseract/tesseract.esm.min.js', /javascript/], ['vendor/tesseract/worker.min.js', /javascript/],
  ['vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js', /javascript/],
  ['vendor/tesseract-core/tesseract-core-lstm.wasm.js', /javascript/],
  ['vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js', /javascript/],
  ['vendor/tessdata/kor.traineddata.gz', /./], ['vendor/tessdata/eng.traineddata.gz', /./],
];
for (const [file, type] of STATIC) {
  const res = await fetch(`${BASE}/${file}`, { headers: NO_CACHE });
  const buf = Buffer.from(await res.arrayBuffer());
  const local = await readFile(`public/${file}`);
  // .gz 파일은 전송 중 압축 해제될 수 있어 크기 대신 존재·응답만 확인
  const same = file.endsWith('.gz') ? buf.length > 0 : sha(buf) === sha(local);
  check(`GET /${file}`, res.status === 200 && type.test(res.headers.get('content-type') ?? '') && same,
    `HTTP ${res.status} ${res.headers.get('content-type')} ${(buf.length / 1024).toFixed(0)}KB${same ? '' : ' (저장소 파일과 다름)'}`);
}

// 3) API
const cfg = await fetch(`${BASE}/api/config`, { headers: NO_CACHE });
const cfgText = await cfg.text();
check('GET /api/config', cfg.status === 200 && /"mode":"gemini"/.test(cfgText), `HTTP ${cfg.status} ${cfgText}`);
if (SKIP_ANALYZE) {
  console.log('SKIP  POST /api/analyze (--skip-analyze)');
} else {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ docType: 'job_posting', text: '[채용] 사무보조 (가상 예시)\n급여: 월 230만원\n근무지: 서울 마포구\n근무시간: 09:00~18:00' }),
  });
  const data = await res.json().catch(() => ({}));
  check('POST /api/analyze (가상 문서 1건)', res.status === 200 && data.items?.length === 8 && data.mode === 'gemini',
    `HTTP ${res.status}${data.code ? ` ${data.code}` : ''} mode=${data.mode} items=${data.items?.length ?? '-'} 분석 확인 불가=${data.items?.filter((i) => i.status === 'unavailable').length ?? '-'}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n배포 주소 점검: ${failed.length ? `실패 ${failed.length}건` : '모두 통과'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;

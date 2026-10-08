// 커밋된 public/vendor/ 파일이 package.json에 고정한 라이브러리 버전과 같은지 확인한다.
// (다르면 `npm run vendor`를 실행해 다시 커밋해야 한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

const PAIRS = [
  [path.join(pkgDir('pdfjs-dist'), 'legacy/build/pdf.min.mjs'), 'public/vendor/pdfjs/pdf.min.mjs'],
  [path.join(pkgDir('pdfjs-dist'), 'legacy/build/pdf.worker.min.mjs'), 'public/vendor/pdfjs/pdf.worker.min.mjs'],
  [path.join(pkgDir('pdfjs-dist'), 'cmaps/UniKS-UTF16-H.bcmap'), 'public/vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap'],
  [path.join(pkgDir('tesseract.js'), 'dist/tesseract.esm.min.js'), 'public/vendor/tesseract/tesseract.esm.min.js'],
  [path.join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'public/vendor/tesseract/worker.min.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'public/vendor/tesseract-core/tesseract-core-lstm.wasm.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'public/vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js'],
  [path.join(pkgDir('tesseract.js-core'), 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'public/vendor/tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [path.join(pkgDir('@tesseract.js-data/kor'), '4.0.0_best_int/kor.traineddata.gz'), 'public/vendor/tessdata/kor.traineddata.gz'],
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'public/vendor/tessdata/eng.traineddata.gz'],
];

test('커밋된 vendor 파일이 설치된 라이브러리와 같다', async () => {
  for (const [src, dest] of PAIRS) assert.equal(await sha(dest), await sha(src), dest);
});

// vercel.json excludeFiles 패턴(간단한 glob: ** 와 *)을 정규식으로 바꾼다
const globToRegExp = (g) => new RegExp(`^${g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '.*')}$`);

test('Vercel 함수 번들에서 vendor만 제외하고 메인 화면 파일은 남긴다 (/ 는 함수가 처리)', async () => {
  // 회귀: excludeFiles를 public/** 로 넓히면 함수에서 index.html이 빠져 배포 사이트의 / 가 {"error":"not found"}가 된다.
  const cfg = JSON.parse(await readFile('vercel.json', 'utf8'));
  const patterns = [].concat(cfg.functions['server.js'].excludeFiles ?? []);
  const excluded = (p) => patterns.some((g) => globToRegExp(g).test(p));
  for (const keep of ['public/index.html', 'public/styles.css', 'public/app.js', 'public/upload-rules.js', 'public/extract.js']) {
    assert.equal(excluded(keep), false, `${keep}가 함수에서 제외되면 안 됨`);
  }
  assert.equal(excluded('public/vendor/tessdata/kor.traineddata.gz'), true);
  assert.equal(excluded('public/vendor/pdfjs/pdf.min.mjs'), true);
  // 이전의 잘못된 설정은 이 검사에 걸린다
  assert.equal(globToRegExp('public/**').test('public/index.html'), true);
});

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

test('Vercel 함수 번들에서 public/을 제외한다 (정적 파일은 CDN이 제공)', async () => {
  const cfg = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.equal(cfg.functions['server.js'].excludeFiles, 'public/**');
});

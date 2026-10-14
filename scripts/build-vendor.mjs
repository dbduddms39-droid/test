// 브라우저에서 쓰는 PDF·OCR 라이브러리 파일을 node_modules에서 public/vendor/로 복사한다.
// 외부 CDN을 쓰지 않고 같은 사이트에서 제공하기 위해서다 (사용자 파일은 이 라이브러리로 브라우저 안에서만 처리).
// 결과(public/vendor/)는 git에 커밋한다: Vercel은 빌드 스크립트보다 먼저 public/을 정적 파일로 수집하므로,
// 빌드 때 만든 파일은 CDN에 올라가지 않는다. 라이브러리 버전을 바꾸면 `npm run vendor`를 다시 실행해 커밋한다.
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public', 'vendor');
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

const pdfjs = pkgDir('pdfjs-dist');
const tess = pkgDir('tesseract.js');
const core = pkgDir('tesseract.js-core');
const kor = pkgDir('@tesseract.js-data/kor');
const eng = pkgDir('@tesseract.js-data/eng');
const pretendard = pkgDir('pretendard');
const jbMono = pkgDir('@fontsource/jetbrains-mono');

const COPIES = [
  // pdf.js (구형 모바일 브라우저 호환을 위해 legacy 빌드)
  [path.join(pdfjs, 'legacy/build/pdf.min.mjs'), 'pdfjs/pdf.min.mjs'],
  [path.join(pdfjs, 'legacy/build/pdf.worker.min.mjs'), 'pdfjs/pdf.worker.min.mjs'],
  [path.join(pdfjs, 'cmaps'), 'pdfjs/cmaps'], // 한국어 등 CID 글꼴 문자 매핑
  [path.join(pdfjs, 'LICENSE'), 'pdfjs/LICENSE'],
  // Tesseract.js (LSTM 엔진만 사용)
  [path.join(tess, 'dist/tesseract.esm.min.js'), 'tesseract/tesseract.esm.min.js'],
  [path.join(tess, 'dist/worker.min.js'), 'tesseract/worker.min.js'],
  [path.join(tess, 'LICENSE.md'), 'tesseract/LICENSE.md'],
  [path.join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core/tesseract-core-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core/tesseract-core-simd-lstm.wasm.js'],
  [path.join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  [path.join(core, 'LICENSE'), 'tesseract-core/LICENSE'],
  // 언어 데이터 (best_int: 정확도와 크기의 절충)
  [path.join(kor, '4.0.0_best_int/kor.traineddata.gz'), 'tessdata/kor.traineddata.gz'],
  [path.join(eng, '4.0.0_best_int/eng.traineddata.gz'), 'tessdata/eng.traineddata.gz'],
  // 비교 결과 정리본 PDF 만들기 (브라우저에서만, MIT). 'PDF 다운로드'를 누를 때만 불러온다
  [path.join(pkgDir('pdf-lib'), 'dist/pdf-lib.min.js'), 'pdf-lib/pdf-lib.min.js'],
  [path.join(pkgDir('pdf-lib'), 'LICENSE.md'), 'pdf-lib/LICENSE-pdf-lib.md'],
  [path.join(pkgDir('@pdf-lib/fontkit'), 'dist/fontkit.umd.min.js'), 'pdf-lib/fontkit.umd.min.js'],
  // 글꼴 (SIL OFL 1.1). Pretendard는 유니코드 범위별 분할 파일이라 화면에 쓰인 글자 묶음만 내려받는다.
  [path.join(pretendard, 'dist/web/variable/pretendardvariable-dynamic-subset.css'), 'fonts/pretendard/pretendardvariable-dynamic-subset.css'],
  [path.join(pretendard, 'dist/web/variable/woff2-dynamic-subset'), 'fonts/pretendard/woff2-dynamic-subset'],
  [path.join(pretendard, 'dist/LICENSE.txt'), 'fonts/pretendard/LICENSE.txt'],
  [path.join(jbMono, 'files/jetbrains-mono-latin-400-normal.woff2'), 'fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2'],
  [path.join(jbMono, 'files/jetbrains-mono-latin-500-normal.woff2'), 'fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2'],
  [path.join(jbMono, 'LICENSE'), 'fonts/jetbrains-mono/LICENSE'],
];

await rm(OUT, { recursive: true, force: true });
for (const [src, dest] of COPIES) {
  const target = path.join(OUT, dest);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(src, target, { recursive: true });
}
console.log(`vendor 파일 ${COPIES.length}개 항목을 public/vendor/에 복사했어요.`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  detectFileKind, checkFile, pageTextFromItems, needsOcr, joinPages, tidyText, fitSize,
  MAX_FILE_BYTES, UPLOAD_MESSAGES,
} from '../public/upload-rules.js';

const head = async (name) => new Uint8Array((await readFile(`test/fixtures/upload/${name}`)).subarray(0, 16));

test('파일 시그니처로 형식 판별 (확장자는 믿지 않음)', async () => {
  assert.equal(detectFileKind(await head('contract-text.pdf')), 'pdf');
  assert.equal(detectFileKind(await head('posting-ko.png')), 'png');
  assert.equal(detectFileKind(await head('posting-ko.webp')), 'webp');
  assert.equal(detectFileKind(await head('posting-ko-photo.jpg')), 'jpeg');
  assert.equal(detectFileKind(await head('not-really.pdf')), null);
  assert.equal(detectFileKind(new TextEncoder().encode('GIF89a......')), null);
});

test('크기·빈 파일·형식 검사와 안내 문구', async () => {
  assert.deepEqual(checkFile({ size: 0, head: new Uint8Array() }), { ok: false, code: 'empty' });
  assert.deepEqual(checkFile({ size: MAX_FILE_BYTES + 1, head: await head('contract-text.pdf') }), { ok: false, code: 'too_large' });
  assert.deepEqual(checkFile({ size: 51, head: await head('not-really.pdf') }), { ok: false, code: 'unsupported_type' });
  assert.deepEqual(checkFile({ size: 1000, head: await head('posting-ko.png') }), { ok: true, kind: 'png' });
  for (const code of ['too_large', 'empty', 'unsupported_type', 'encrypted_pdf', 'invalid_pdf', 'too_many_pages', 'too_many_scanned_pages', 'no_text_found']) {
    assert.ok(UPLOAD_MESSAGES[code], code);
  }
});

test('pdf.js 텍스트 항목을 줄 단위로 합치고 줄바꿈을 보존', () => {
  const items = [
    { str: '근무장소', hasEOL: true },
    { type: 'beginMarkedContent' },
    { str: '부산광역시 해운대구', hasEOL: false }, { str: ' ', hasEOL: false }, { str: '센텀', hasEOL: true },
    { str: '임금: 시간급 10,500원  ', hasEOL: false },
  ];
  assert.equal(pageTextFromItems(items), '근무장소\n부산광역시 해운대구 센텀\n임금: 시간급 10,500원');
});

test('글자가 거의 없는 쪽은 스캔으로 보고 OCR 대상', () => {
  assert.equal(needsOcr(''), true);
  assert.equal(needsOcr('  12 \n'), true);
  assert.equal(needsOcr('고용형태: 정규직, 근무시간: 09:00~18:00'), false);
});

test('쪽 합치기·빈 줄 정리는 줄 순서와 내용을 바꾸지 않음', () => {
  assert.equal(joinPages(['가\n나', '', '  다  ']), '가\n나\n\n다');
  assert.equal(tidyText('a\n\n\n\nb\r\nc  '), 'a\n\nb\nc');
});

test('큰 이미지는 긴 변 기준으로 축소', () => {
  assert.deepEqual(fitSize(6000, 3000), { width: 3000, height: 1500, scale: 0.5 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600, scale: 1 });
});

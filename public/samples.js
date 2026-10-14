// 박람회 체험용 가상 문서 다운로드 (시작 화면 전용).
// 파일은 public/samples/에 직접 넣는다 (가상 회사·가상 근로조건 문서 3종, 앱이 만들거나 바꾸지 않는다).
// 세 파일이 모두 있을 때만 영역을 보여 주고, 하나라도 없으면 숨긴다 (깨진 링크를 보여 주지 않음).
// '전체 다운로드'는 같은 세 파일을 브라우저에서 ZIP 하나로 묶는다 (압축 없이 저장, 서버 전송 없음).

export const SAMPLE_FILES = [
  { path: 'samples/ildan-sample-1-job-posting.pdf', name: '일단확인_가상문서_1_채용공고.pdf', label: '채용공고 PDF', desc: '직무·근무지·급여 범위가 적힌 공고' },
  { path: 'samples/ildan-sample-2-offer-mail.pdf', name: '일단확인_가상문서_2_처우·근로조건안내.pdf', label: '처우·근로조건 안내 PDF', desc: '합격 후 받은 연봉·근무 조건 안내' },
  { path: 'samples/ildan-sample-3-contract.pdf', name: '일단확인_가상문서_3_근로계약서.pdf', label: '근로계약서 PDF', desc: '10가지 조건을 점검할 수 있는 계약서' },
];
export const SAMPLE_ZIP_NAME = '일단확인_가상문서_3종.zip';

// 세 파일이 모두 PDF로 응답하는지 (본문 없이 HEAD로 확인)
export async function samplesAvailable(fetchImpl = fetch) {
  try {
    const res = await Promise.all(SAMPLE_FILES.map((f) => fetchImpl(f.path, { method: 'HEAD', cache: 'no-store' })));
    return res.every((r) => r.ok && /pdf/i.test(r.headers.get('content-type') ?? ''));
  } catch {
    return false;
  }
}

// ---------- ZIP (저장 방식, 압축 없음) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// files: [{ name, bytes: Uint8Array }] → Uint8Array (ZIP). 파일 이름은 UTF-8 (일반 플래그 11번 비트)
export function buildZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = []; const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, f.bytes.length, true); local.setUint32(22, f.bytes.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true); central.setUint16(12, dosTime, true); central.setUint16(14, dosDate, true); central.setUint32(16, crc, true);
    central.setUint32(20, f.bytes.length, true); central.setUint32(24, f.bytes.length, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, f.bytes);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + f.bytes.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

// 시작 화면 영역 연결: 파일이 모두 있을 때만 개별 링크와 '전체 다운로드'를 보여 준다
export async function initSampleDownloads({ root, list, zipButton, status, el }) {
  if (!(await samplesAvailable())) { root.hidden = true; return false; }
  list.replaceChildren(...SAMPLE_FILES.map((f, i) => el('li', { class: 'sample-dl-item' },
    el('p', { class: 'sample-dl-no' }, `가상 문서 ${i + 1}`),
    el('p', { class: 'sample-dl-desc' }, f.desc ?? ''),
    el('a', { href: f.path, download: f.name, class: 'btn-secondary sample-dl-link' }, `${f.label} 다운로드`))));
  zipButton.addEventListener('click', async () => {
    zipButton.disabled = true;
    status.textContent = '파일을 묶는 중이에요…';
    try {
      const files = await Promise.all(SAMPLE_FILES.map(async (f) => {
        const r = await fetch(f.path, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch');
        return { name: f.name, bytes: new Uint8Array(await r.arrayBuffer()) };
      }));
      const url = URL.createObjectURL(new Blob([buildZip(files)], { type: 'application/zip' }));
      const a = el('a', { href: url, download: SAMPLE_ZIP_NAME });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = '';
    } catch {
      status.textContent = '전체 다운로드를 준비하지 못했어요. 문서를 하나씩 다운로드해 주세요.';
    } finally {
      zipButton.disabled = false;
    }
  });
  root.hidden = false;
  return true;
}

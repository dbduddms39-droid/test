"""비교 결과 정리본 PDF용 글꼴 만들기 (Pretendard, SIL OFL 1.1).

pdf-lib의 글꼴 부분 추출(subset)은 이 한글 글꼴에서 글자가 빠지는 문제가 있어, PDF에는 글꼴을 통째로 넣는다.
그래서 미리 크기를 줄여 둔다:
- Regular: 한글 음절 전체 + 한글 자모 + 라틴·숫자·문장부호·기호 (문서 원문 인용을 그대로 그리기 위해)
- Bold: 앱이 굵게 쓰는 고정 문구(제목·상태·조건 이름 등)의 글자만 (없는 글자는 PDF에서 Regular로 그림)
두 글꼴 모두 합성 글리프를 일반 외곽선으로 풀고(일부 뷰어의 글자 간격 문제 방지), 힌팅·조판 표를 뺀다.

실행 (fontTools 필요: pip install fonttools):
  python3 scripts/build-pdf-fonts.py
결과(public/vendor/fonts/pretendard-pdf/)는 git에 커밋한다.
"""
import glob, os, re, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import DecomposingRecordingPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'node_modules/pretendard/dist/public/static/alternative')
OUT = os.path.join(ROOT, 'public/vendor/fonts/pretendard-pdf')
BASE = 'U+0020-007E,U+00A0-00FF,U+2010-206F,U+2190-21FF,U+2460-24FF,U+25A0-25FF,U+3000-303F,U+FF01-FF5E,U+20A9,U+2116,U+2122'

def decompose(path):
    f = TTFont(path)
    glyf = f['glyf']; gs = f.getGlyphSet()
    for name in f.getGlyphOrder():
        if glyf[name].isComposite():
            rec = DecomposingRecordingPen(gs); gs[name].draw(rec)
            pen = TTGlyphPen(None); rec.replay(pen); glyf[name] = pen.glyph()
    f.save(path)

def subset(src, dst, unicodes='', text_file=None):
    cmd = [sys.executable, '-I', '-m', 'fontTools.subset', src, f'--output-file={dst}', '--no-hinting',
           '--layout-features=', '--drop-tables+=GSUB,GPOS,GDEF,kern', '--name-IDs=*', '--name-languages=*']
    if unicodes: cmd.append(f'--unicodes={unicodes}')
    if text_file: cmd.append(f'--text-file={text_file}')
    subprocess.run(cmd, check=True)
    decompose(dst)

os.makedirs(OUT, exist_ok=True)
subset(os.path.join(SRC, 'Pretendard-Regular.ttf'), os.path.join(OUT, 'Pretendard-Regular-KR.ttf'), BASE + ',U+3131-318E,U+AC00-D7A3')

# 굵은 글꼴: 앱 소스에 쓰인 한글 + 기본 문자
chars = set()
for p in glob.glob(os.path.join(ROOT, 'public/*.js')) + [os.path.join(ROOT, 'public/index.html')] + glob.glob(os.path.join(ROOT, 'src/*.js')):
    chars.update(re.findall(r'[가-힣]', open(p, encoding='utf-8').read()))
tf = os.path.join(OUT, '.bold-chars.txt')
open(tf, 'w', encoding='utf-8').write(''.join(sorted(chars)))
subset(os.path.join(SRC, 'Pretendard-Bold.ttf'), os.path.join(OUT, 'Pretendard-Bold-UI.ttf'), BASE, tf)
os.remove(tf)
print('bold hangul', len(chars))

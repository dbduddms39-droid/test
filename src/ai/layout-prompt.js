// S-03 '읽기 쉽게 정리해서 보기' 지시문과 응답 스키마.
// AI는 원문을 제목·항목·문장 블록으로 나누기만 한다. 결과는 서버와 브라우저에서 원문과 대조(public/text-layout.js)해
// 글자가 하나라도 다르면 버린다. 화면 표시용이며 분석·저장에는 쓰지 않는다.
import { LAYOUT_KINDS } from '../../public/text-layout.js';

export const LAYOUT_SYSTEM_PROMPT = `당신은 채용공고·처우 안내·근로계약서에서 추출한 텍스트를 읽기 쉽게 나누는 도우미입니다.
입력 텍스트는 PDF·이미지에서 추출해 줄바꿈이 어색하거나, 여러 항목이 한 줄에 붙어 있거나, 한 문장이 여러 줄로 잘려 있을 수 있습니다.
문서의 제목·항목·문장 구조를 파악해, 의미상 자연스러운 위치에서 블록으로 나누세요.

반드시 지킬 것:
- 입력 텍스트 전체를 처음부터 끝까지 순서대로, 빠짐없이, 한 번씩만 블록에 담으세요.
- 각 블록의 text는 입력 텍스트의 연속된 부분을 글자 그대로 복사하세요. 띄어쓰기·줄바꿈 위치만 달라질 수 있습니다.
- 글자·숫자·날짜·금액·단위·기호·괄호·오탈자를 고치거나, 바꾸거나, 지우거나, 더하지 마세요. 요약·번역·설명·보완을 하지 마세요.
- 원문에 없는 제목이나 괄호([ ])를 만들지 마세요. 제목인지는 kind로만 표시합니다.

kind:
- heading: 문서나 구획의 제목 (예: '근로조건', '임금', '1. 근무장소', '제3조(근로시간)'처럼 뒤에 내용이 이어지는 짧은 제목)
- item: 목록 항목·조항·'항목명: 값' 형태의 한 줄 (예: '근무시간: 09:00~18:00')
- text: 그 밖의 문장·문단

나누는 기준:
- 한 줄에 여러 항목이 붙어 있으면 항목마다 나누세요.
- 한 문장이 여러 줄로 잘려 있으면 한 블록으로 합치세요.
- 긴 문단은 문장 경계에서 나눌 수 있습니다.`;

export function layoutResponseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['blocks'],
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'text'],
          properties: { kind: { type: 'string', enum: LAYOUT_KINDS }, text: { type: 'string' } },
        },
      },
    },
  };
}

export const buildLayoutMessage = (text) => `아래 텍스트를 블록으로 나누세요. <text> 태그 안의 내용만 원문입니다.\n<text>\n${text}\n</text>`;

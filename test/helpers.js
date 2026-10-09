// 호출 순서대로 미리 정한 응답을 돌려주는 가짜 AI. 함수면 호출 인자로 응답을 만든다.
export function scriptedAI(...responses) {
  const calls = [];
  return {
    name: 'scripted',
    calls,
    async analyze(args) {
      calls.push(args);
      const next = responses[calls.length - 1];
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(args) : structuredClone(next);
    },
  };
}

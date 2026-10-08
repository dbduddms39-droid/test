// 메모리 기반의 간단한 요청 제한. 서버 1대 기준이며 재시작하면 초기화된다.
// - IP별: windowMs 동안 perIp회
// - 서버 전체: 1분에 globalPerMinute회, 하루(UTC 기준)에 globalPerDay회
// 분석 1건은 검증 실패 시 AI를 최대 2번 호출하므로, 무료 등급 한도의 절반 이하로 잡는 것을 권장한다.

export function createRateLimiter({
  perIp = 5,
  windowMs = 60_000,
  globalPerMinute = 4,
  globalPerDay = 100,
  now = () => Date.now(),
} = {}) {
  const ipHits = new Map();
  let minuteHits = [];
  let day = null;
  let dayCount = 0;

  return {
    // 허용되면 { ok: true }, 아니면 { ok: false, scope, retryAfterSec }
    check(ip) {
      const t = now();
      const recent = (ipHits.get(ip) ?? []).filter((x) => t - x < windowMs);
      minuteHits = minuteHits.filter((x) => t - x < 60_000);
      const today = new Date(t).toISOString().slice(0, 10);
      if (today !== day) { day = today; dayCount = 0; }

      if (recent.length >= perIp) {
        ipHits.set(ip, recent);
        return { ok: false, scope: 'ip', retryAfterSec: Math.ceil((windowMs - (t - recent[0])) / 1000) };
      }
      if (minuteHits.length >= globalPerMinute) {
        return { ok: false, scope: 'global', retryAfterSec: Math.ceil((60_000 - (t - minuteHits[0])) / 1000) };
      }
      if (dayCount >= globalPerDay) {
        const tomorrow = Date.parse(`${today}T00:00:00Z`) + 86_400_000;
        return { ok: false, scope: 'daily', retryAfterSec: Math.ceil((tomorrow - t) / 1000) };
      }
      recent.push(t);
      ipHits.set(ip, recent);
      minuteHits.push(t);
      dayCount += 1;
      // 오래된 IP 기록 정리
      if (ipHits.size > 10_000) for (const [k, v] of ipHits) if (t - v[v.length - 1] >= windowMs) ipHits.delete(k);
      return { ok: true };
    },
  };
}

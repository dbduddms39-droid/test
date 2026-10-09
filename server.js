// 일단확인 MVP 서버: 정적 파일 제공 + POST /api/analyze
// - 로컬: `node server.js` 로 직접 실행 (아래 맨 끝 블록)
// - Vercel: 루트의 server.js를 Node 서버리스 함수로 import 해서 default export (req, res) 핸들러를 호출한다.
//   public/ 정적 파일은 Vercel이 직접 제공한다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDocument } from './src/analyze.js';
import { DOC_TYPES } from './src/criteria.js';
import { createGeminiAnalyzer } from './src/ai/gemini.js';
import { createDemoAnalyzer } from './src/ai/demo.js';
import { createRateLimiter } from './src/rateLimit.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 200_000;
const MAX_TEXT_CHARS = 20_000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// AI 오류 → 사용자 안내 (키 값이나 원문은 응답·로그에 넣지 않는다)
const AI_ERROR_RESPONSES = {
  missing_key: [503, 'AI 분석이 아직 설정되지 않았어요. 관리자가 GEMINI_API_KEY를 등록해야 해요.'],
  auth_failed: [503, 'AI 분석 키 인증에 실패했어요. 관리자가 GEMINI_API_KEY를 확인해야 해요.'],
  rate_limited: [429, 'AI 무료 사용량 한도에 도달했어요. 잠시 후 또는 내일 다시 시도해 주세요.'],
  timeout: [504, 'AI 응답이 늦어져 분석을 중단했어요. 잠시 후 다시 시도해 주세요.'],
  bad_request: [502, 'AI 요청 설정에 문제가 있어 분석하지 못했어요. 관리자에게 알려 주세요.'],
  model_not_found: [502, 'AI 모델 설정에 문제가 있어 분석하지 못했어요. 관리자에게 알려 주세요.'],
};
const RATE_LIMIT_MESSAGES = {
  ip: '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.',
  global: '지금 분석 요청이 많아요. 잠시 후 다시 시도해 주세요.',
  daily: '오늘 분석 가능한 횟수를 모두 사용했어요. 내일 다시 시도해 주세요.',
};

// 원문을 포함하지 않는 메타 정보만 기록한다.
const log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

// (req, res) 요청 처리기. 로컬 http 서버와 Vercel 함수가 같은 처리기를 쓴다.
export function createHandler({ ai, limiter = createRateLimiter(), trustProxy = false }) {
  return async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/analyze') return await handleAnalyze(req, res, { ai, limiter, trustProxy });
      if (req.method === 'GET' && req.url === '/api/config') return sendJson(res, 200, { mode: ai.name });
      if (req.method === 'GET') return await serveStatic(req, res);
      sendJson(res, 405, { error: '지원하지 않는 요청이에요.' });
    } catch (err) {
      // 오류 메시지에는 입력 일부가 섞일 수 있어(예: JSON 파싱 오류) 오류 종류만 기록한다.
      log({ event: 'server_error', name: err?.name ?? 'Error', code: err?.code ?? null });
      if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

export function createServer(options) {
  const server = http.createServer(createHandler(options));
  // 요청 본문 수신 제한 시간 (AI 응답 시간은 AI_TIMEOUT_MS로 별도 제한)
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

function clientIp(req, trustProxy) {
  const fwd = trustProxy && req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

async function handleAnalyze(req, res, { ai, limiter, trustProxy }) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.code === 'too_large' ? 413 : 400, { error: err.code === 'too_large' ? '입력이 너무 길어요.' : '요청 형식이 올바르지 않아요.' });
  }
  const { docType, text } = body ?? {};
  if (!DOC_TYPES[docType]) return sendJson(res, 400, { error: '문서 유형을 선택해 주세요.' });
  if (typeof text !== 'string' || !text.trim()) return sendJson(res, 400, { error: '문서 내용을 붙여넣어 주세요.' });
  if (text.length > MAX_TEXT_CHARS) return sendJson(res, 400, { error: `문서는 ${MAX_TEXT_CHARS.toLocaleString()}자 이하로 입력해 주세요.` });

  const limit = limiter.check(clientIp(req, trustProxy));
  if (!limit.ok) {
    log({ event: 'rate_limited', scope: limit.scope });
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return sendJson(res, 429, { error: RATE_LIMIT_MESSAGES[limit.scope], code: `rate_limited_${limit.scope}` });
  }

  let result;
  try {
    result = await analyzeDocument({ text, docType, ai, log });
  } catch (err) {
    const known = AI_ERROR_RESPONSES[err.code];
    if (!known) throw err;
    return sendJson(res, known[0], { error: known[1], code: err.code });
  }
  sendJson(res, 200, { ...result, mode: ai.name });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { code: 'too_large' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const envInt = (name, fallback) => Number(process.env[name]) || fallback;

// 환경변수로 서버 구성을 만든다. 키는 서버 환경변수(GEMINI_API_KEY)에서만 읽는다.
export function configFromEnv(env = process.env) {
  // 데모 모드는 DEMO_MODE=true 로 명시했을 때만. 키가 없다고 데모로 바꾸지 않는다.
  const demo = env.DEMO_MODE === 'true';
  return {
    demo,
    ai: demo ? createDemoAnalyzer() : createGeminiAnalyzer(),
    limiter: createRateLimiter({
      perIp: envInt('RATE_LIMIT_PER_IP', 5),
      windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
      globalPerMinute: envInt('RATE_LIMIT_GLOBAL_PER_MINUTE', 4),
      globalPerDay: envInt('RATE_LIMIT_GLOBAL_PER_DAY', 100),
    }),
    // Vercel(VERCEL=1)은 프록시 뒤에서 실행되므로 X-Forwarded-For로 사용자 IP를 판단한다.
    trustProxy: env.TRUST_PROXY === 'true' || env.VERCEL === '1',
  };
}

// Vercel 함수 진입점. 첫 요청 때 구성을 만들고, 같은 인스턴스가 살아 있는 동안 재사용한다.
let vercelHandler = null;
export default async function handler(req, res) {
  vercelHandler ??= createHandler(configFromEnv());
  return vercelHandler(req, res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { demo, ai, limiter, trustProxy } = configFromEnv();
  const port = envInt('PORT', 3000);
  createServer({ ai, limiter, trustProxy }).listen(port, () => {
    const mode = demo ? 'demo (DEMO_MODE=true — AI가 아닌 키워드 규칙 결과)' : `gemini (${ai.model})`;
    console.log(`일단확인 서버: http://localhost:${port} — 분석기: ${mode}`);
    if (!demo && !process.env.GEMINI_API_KEY) console.log('경고: GEMINI_API_KEY가 없어 분석 요청은 오류로 안내됩니다.');
  });
}

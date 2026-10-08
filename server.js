// 일단확인 MVP 서버: 정적 파일 제공 + POST /api/analyze
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDocument } from './src/analyze.js';
import { DOC_TYPES } from './src/items.js';
import { createClaudeAnalyzer } from './src/ai/claude.js';
import { createDemoAnalyzer } from './src/ai/demo.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 200_000;
const MAX_TEXT_CHARS = 20_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// 원문을 포함하지 않는 메타 정보만 기록한다.
const log = (entry) => console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));

export function createServer({ ai }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/analyze') return await handleAnalyze(req, res, ai);
      if (req.method === 'GET' && req.url === '/api/config') return sendJson(res, 200, { mode: ai.name });
      if (req.method === 'GET') return await serveStatic(req, res);
      sendJson(res, 405, { error: '지원하지 않는 요청이에요.' });
    } catch (err) {
      log({ event: 'server_error', message: err.message });
      if (!res.headersSent) sendJson(res, 500, { error: '서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
    }
  });
}

async function handleAnalyze(req, res, ai) {
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

  const result = await analyzeDocument({ text, docType, ai, log });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const demo = process.env.DEMO_MODE === '1' || !process.env.ANTHROPIC_API_KEY;
  const ai = demo ? createDemoAnalyzer() : createClaudeAnalyzer();
  const port = Number(process.env.PORT) || 3000;
  createServer({ ai }).listen(port, () => {
    console.log(`일단확인 서버: http://localhost:${port} (분석기: ${ai.name}${demo ? ' — ANTHROPIC_API_KEY가 없어 데모 모드로 실행' : ''})`);
  });
}

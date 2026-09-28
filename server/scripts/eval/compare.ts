/**
 * 코치 프롬프트 비교 실험 — 기록된 실제 학습 세션의 학습자 답변을 두 파이프라인에 똑같이 넣고
 * 응답 형식·점수·어조·비용을 비교합니다.
 *
 *   legacy : Opus 4.8 시절 프롬프트(legacy-prompt.ts) + 매 턴 [필수] 리마인더 + 본문 JSON 파싱,
 *            claude -p 를 격리 플래그 없이 호출 (그때 호출 방식 그대로)
 *   new    : 현재 prompt.ts + 구조화 출력(--json-schema) + effort 명시 + 격리 플래그
 *
 * 두 arm 모두 모델은 같은 claude-opus-5-5 입니다. 차이는 프롬프트와 호출 방식뿐입니다.
 *
 * 사용: npx tsx scripts/eval/compare.ts [세션당 턴 수=4] [동시 실행=4]
 * 출력: scripts/eval/out/<timestamp>/ 에 전체 응답(raw.json)과 요약(summary.md)
 *
 * 주의: claude 호출마다 구독 사용량을 씁니다. 실제 progress.db 는 읽기만 합니다.
 */
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { callClaude, type ClaudeResult } from '../../src/claude.js';
import { WRITERSIDE_DIR } from '../../src/config.js';
import {
  buildSystemPrompt,
  conceptsFromStructured,
  evaluationFromStructured,
  EVAL_SCHEMA,
  START_SCHEMA,
  truncateRunaway,
} from '../../src/prompt.js';
import { buildDetailContent, buildTopicIndex, topicBook, type TopicNode } from '../../src/topics.js';
import * as legacy from './legacy-prompt.js';

const TURNS = Number(process.argv[2] ?? 4);
const CONCURRENCY = Number(process.argv[3] ?? 4);
const MODEL = 'claude-opus-5-5';

// 책과 성격이 섞이도록 고른 세션 (Android 프레임워크·Compose·아키텍처·Kotlin 코루틴/Flow).
const SESSION_IDS = [
  '940f2b5e-5652-48d4-b8e2-ae8d919c8d46', // Q1-Android
  '65b049f8-ef01-41b8-b861-84f0130a0ead', // Q3-Recomposition
  'f85d566c-d58d-4ef5-86e8-d9d4c4255832', // Q80-UDF-MVVM-MVI
  '70b65a66-7aff-4735-b9cb-ae59094cf069', // Q12-State-hoisting
  'cfa0f53e-80ae-4756-9daa-2b50c350eb8a', // E5-Coroutine-Structured-Concurrency
  '98e2fd3b-7561-4bcf-9394-e2227e0561fe', // E2-Kotlin-Flow
];

type Arm = 'legacy' | 'new';

interface TurnRecord {
  turn: number; // 0 = 학습 시작
  learner: string;
  message: string;
  parsed: boolean;
  runaway: boolean;
  scores: { id: string; score: number }[];
  integration: number | null;
  mastered: boolean;
  praiseOpening: boolean;
  belowBarNotice: boolean;
  tokens: number;
  cacheCreation: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  subtype?: string;
  numTurns?: number;
  error?: string;
}

interface Chain {
  sessionId: string;
  topicId: string;
  book: string;
  arm: Arm;
  concepts: string[];
  turns: TurnRecord[];
}

// 첫 문장이 동의·칭찬으로 시작하는지 — 과한 동의(sycophancy) 대리 지표.
const PRAISE_RE = /^[^.!?\n]{0,40}(좋습니다|좋은 |잘 짚|잘 설명|정확합니다|정확히 짚|훌륭|맞습니다|맞아요|좋아요|잘하셨)/;

function tokensOf(r: ClaudeResult): number {
  return r.inputTokens + r.cacheCreationTokens + r.cacheReadTokens + r.outputTokens;
}

function record(turn: number, learner: string, r: ClaudeResult, message: string, parsed: boolean,
  runaway: boolean, ev: { scores: { id: string; score: number }[]; integration: number | null; mastered: boolean }): TurnRecord {
  const low = ev.scores.some((s) => s.score < 3);
  return {
    turn, learner, message, parsed, runaway,
    scores: ev.scores, integration: ev.integration, mastered: ev.mastered,
    praiseOpening: PRAISE_RE.test(message.trim()),
    belowBarNotice: low && message.includes('합격선'),
    tokens: tokensOf(r), cacheCreation: r.cacheCreationTokens, outputTokens: r.outputTokens,
    costUsd: r.costUsd, durationMs: r.durationMs,
    subtype: (r.raw as { subtype?: string }).subtype,
    numTurns: (r.raw as { num_turns?: number }).num_turns,
  };
}

async function runChain(arm: Arm, topic: TopicNode, book: 'android' | 'kotlin', detail: string,
  learnerTurns: string[], sessionId: string): Promise<Chain> {
  const chain: Chain = { sessionId, topicId: topic.id, book, arm, concepts: [], turns: [] };
  let claudeSession: string | undefined;

  // 학습 시작
  try {
    if (arm === 'legacy') {
      const sys = legacy.buildSystemPrompt(topic, detail);
      const r = await callClaude({ prompt: legacy.withStartReminder('학습 시작'), systemPrompt: sys, model: MODEL, isolated: false });
      claudeSession = r.sessionId;
      const clean = legacy.truncateRunaway(r.text);
      const concepts = legacy.extractConceptList(clean.text);
      chain.concepts = (concepts ?? []).map((c) => c.name);
      chain.turns.push(record(0, '학습 시작', r, legacy.stripCoachJson(clean.text), !!concepts, clean.truncated,
        { scores: [], integration: null, mastered: false }));
    } else {
      const sys = buildSystemPrompt(topic, book, detail);
      const r = await callClaude({ prompt: '학습 시작', systemPrompt: sys, model: MODEL, jsonSchema: START_SCHEMA });
      claudeSession = r.sessionId;
      const parsed = conceptsFromStructured(r.structuredOutput);
      chain.concepts = (parsed?.concepts ?? []).map((c) => c.name);
      const msg = parsed ? parsed.message : r.text;
      chain.turns.push(record(0, '학습 시작', r, msg, !!parsed, truncateRunaway(msg).truncated,
        { scores: [], integration: null, mastered: false }));
    }
  } catch (e) {
    chain.turns.push({ ...emptyTurn(0, '학습 시작'), error: String(e) });
    return chain;
  }

  // 평가 턴 — 기록된 학습자 답변을 순서대로 재생
  for (let i = 0; i < learnerTurns.length; i++) {
    const learner = learnerTurns[i]!;
    try {
      if (arm === 'legacy') {
        const r = await callClaude({
          prompt: legacy.withEvalReminder(learner), sessionId: claudeSession,
          systemPrompt: legacy.buildSystemPrompt(topic), model: MODEL, isolated: false,
        });
        claudeSession = r.sessionId || claudeSession;
        const clean = legacy.truncateRunaway(r.text);
        const ev = legacy.extractEvaluation(clean.text);
        chain.turns.push(record(i + 1, learner, r, legacy.stripCoachJson(clean.text), !!ev, clean.truncated,
          { scores: ev?.scores ?? [], integration: ev?.integrationScore ?? null, mastered: ev?.mastered ?? false }));
      } else {
        const r = await callClaude({
          prompt: learner, sessionId: claudeSession,
          systemPrompt: buildSystemPrompt(topic, book), model: MODEL, jsonSchema: EVAL_SCHEMA,
        });
        claudeSession = r.sessionId || claudeSession;
        const parsed = evaluationFromStructured(r.structuredOutput);
        const msg = parsed ? parsed.message : r.text;
        chain.turns.push(record(i + 1, learner, r, msg, !!parsed, truncateRunaway(msg).truncated,
          { scores: parsed?.evaluation.scores ?? [], integration: parsed?.evaluation.integrationScore ?? null,
            mastered: parsed?.evaluation.mastered ?? false }));
      }
    } catch (e) {
      chain.turns.push({ ...emptyTurn(i + 1, learner), error: String(e) });
    }
  }
  return chain;
}

function emptyTurn(turn: number, learner: string): TurnRecord {
  return { turn, learner, message: '', parsed: false, runaway: false, scores: [], integration: null,
    mastered: false, praiseOpening: false, belowBarNotice: false, tokens: 0, cacheCreation: 0,
    outputTokens: 0, costUsd: 0, durationMs: 0 };
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }));
  return out;
}

function summarize(chains: Chain[], recorded: Map<string, number[]>): string {
  const lines: string[] = [];
  const arms: Arm[] = ['legacy', 'new'];
  const agg = (arm: Arm) => {
    const turns = chains.filter((c) => c.arm === arm).flatMap((c) => c.turns);
    const evalTurns = turns.filter((t) => t.turn > 0 && !t.error);
    const scored = evalTurns.flatMap((t) => t.scores.map((s) => s.score));
    const lowTurns = evalTurns.filter((t) => t.scores.some((s) => s.score < 3));
    const sum = (f: (t: TurnRecord) => number) => turns.reduce((a, t) => a + f(t), 0);
    return {
      calls: turns.length,
      errors: turns.filter((t) => t.error).length,
      parseRate: `${turns.filter((t) => t.parsed).length}/${turns.length}`,
      runaway: turns.filter((t) => t.runaway).length,
      meanScore: scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2) : '-',
      scoredItems: scored.length,
      praise: `${evalTurns.filter((t) => t.praiseOpening).length}/${evalTurns.length}`,
      belowBar: `${lowTurns.filter((t) => t.belowBarNotice).length}/${lowTurns.length}`,
      avgMsgChars: Math.round(sum((t) => t.message.length) / Math.max(1, turns.length)),
      avgTokens: Math.round(sum((t) => t.tokens) / Math.max(1, turns.length)),
      avgCacheCreation: Math.round(sum((t) => t.cacheCreation) / Math.max(1, turns.length)),
      avgOutput: Math.round(sum((t) => t.outputTokens) / Math.max(1, turns.length)),
      avgSec: (sum((t) => t.durationMs) / Math.max(1, turns.length) / 1000).toFixed(1),
      cost: sum((t) => t.costUsd).toFixed(2),
    };
  };
  const a = agg('legacy');
  const b = agg('new');
  lines.push('| 지표 | legacy | new |', '|---|---|---|');
  const rows: [string, keyof typeof a][] = [
    ['호출 수', 'calls'], ['호출 오류', 'errors'], ['형식 해석 성공', 'parseRate'], ['runaway 잘림', 'runaway'],
    ['평균 개념 점수', 'meanScore'], ['채점 항목 수', 'scoredItems'], ['칭찬으로 시작한 평가 턴', 'praise'],
    ['3점 미만 턴 중 합격선 안내', 'belowBar'], ['평균 본문 길이(자)', 'avgMsgChars'],
    ['평균 총 토큰/호출', 'avgTokens'], ['평균 캐시 생성 토큰/호출', 'avgCacheCreation'],
    ['평균 출력 토큰/호출', 'avgOutput'], ['평균 응답 시간(초)', 'avgSec'], ['API 환산 비용($)', 'cost'],
  ];
  for (const [label, key] of rows) lines.push(`| ${label} | ${a[key]} | ${b[key]} |`);

  lines.push('', '## 세션별 점수 (턴별 최고 개념 점수)', '', '| 토픽 | 기록(4.8) | legacy | new |', '|---|---|---|---|');
  for (const sid of new Set(chains.map((c) => c.sessionId))) {
    const cs = chains.filter((c) => c.sessionId === sid);
    const fmt = (arm: Arm) => cs.find((c) => c.arm === arm)?.turns.filter((t) => t.turn > 0)
      .map((t) => (t.error ? 'E' : t.scores.length ? Math.max(...t.scores.map((s) => s.score)) : '·')).join(' ') ?? '';
    lines.push(`| ${cs[0]!.topicId} | ${(recorded.get(sid) ?? []).join(' ')} | ${fmt('legacy')} | ${fmt('new')} |`);
  }
  return lines.join('\n');
}

async function main() {
  const index = buildTopicIndex(WRITERSIDE_DIR);
  const db = new Database(resolve(import.meta.dirname, '../../data/progress.db'), { readonly: true });
  const recorded = new Map<string, number[]>();
  const tasks: (() => Promise<Chain>)[] = [];

  for (const sid of SESSION_IDS) {
    const s = db.prepare('select topic_id from sessions where id = ?').get(sid) as { topic_id: string } | undefined;
    if (!s) continue;
    const topic = index.byId.get(s.topic_id);
    if (!topic) continue;
    const rows = db.prepare('select role, text, eval_json from turns where session_id = ? order by ts').all(sid) as
      { role: string; text: string; eval_json: string | null }[];
    const learnerTurns = rows.filter((r) => r.role === 'user').slice(0, TURNS).map((r) => r.text);
    recorded.set(sid, rows.filter((r) => r.role === 'assistant' && r.eval_json).slice(0, TURNS).map((r) => {
      const ev = JSON.parse(r.eval_json!) as { scores: { score: number }[] };
      return ev.scores.length ? Math.max(...ev.scores.map((x) => x.score)) : 0;
    }));
    const book = topicBook(index, topic);
    const detail = buildDetailContent(index, topic);
    const arms = (process.env.ARMS ?? 'legacy,new').split(',') as Arm[];
    for (const arm of arms) {
      tasks.push(() => runChain(arm, topic, book, detail, learnerTurns, sid));
    }
  }

  console.log(`chains=${tasks.length} turns/chain=${TURNS + 1} concurrency=${CONCURRENCY}`);
  const started = Date.now();
  const chains = await pool(tasks, CONCURRENCY);
  const outDir = join(import.meta.dirname, 'out', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'raw.json'), JSON.stringify(chains, null, 2));
  const summary = summarize(chains, recorded);
  writeFileSync(join(outDir, 'summary.md'), summary + '\n');
  console.log(summary);
  console.log(`\nout=${outDir} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

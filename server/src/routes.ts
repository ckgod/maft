import { Router, type RequestHandler } from 'express';
import { callClaude } from './claude.js';
import { db } from './db.js';
import { buildSystemPrompt, extractRubric, withFormatReminder } from './prompt.js';
import type { TopicIndex } from './topics.js';
import {
  appendTurn,
  createSession,
  deleteSessionsByTopic,
  getLatestSessionByTopic,
  getSession,
  listSessions,
  updateClaudeSessionId,
  updateSessionMeta,
} from './sessions.js';
import {
  deleteConceptMissesForTopic,
  getTopicStatsMap,
  getWeakPoints,
  recordMissedConcepts,
} from './stats.js';

export function createRouter(index: TopicIndex): Router {
  const router = Router();

  const getTopics: RequestHandler = (_req, res) => {
    const stats = getTopicStatsMap();
    const topics = index.questions.map((t) => {
      const s = stats.get(t.id);
      return {
        id: t.id,
        title: t.title,
        kind: t.kind,
        depth: t.depth,
        parentId: t.parentId,
        stats: s
          ? {
              attempts: s.attempts,
              bestScore: s.bestScore,
              lastScore: s.lastScore,
              mastered: s.mastered,
            }
          : { attempts: 0, bestScore: null, lastScore: null, mastered: false },
      };
    });
    const categories = [...index.byId.values()]
      .filter((n) => n.kind === 'category')
      .map((c) => ({
        id: c.id,
        title: c.title,
        depth: c.depth,
        parentId: c.parentId,
      }));
    res.json({ topics, categories });
  };

  const startSession: RequestHandler = async (req, res) => {
    const topicId = String(req.body?.topicId ?? '');
    const topic = index.byId.get(topicId);
    if (!topic) {
      res.status(404).json({ error: 'topic not found', topicId });
      return;
    }
    if (topic.kind !== 'question' && topic.kind !== 'extra') {
      res.status(400).json({ error: 'topic is not a learnable question', topicId });
      return;
    }

    try {
      const systemPrompt = buildSystemPrompt(topic);
      const result = await callClaude({ prompt: '학습 시작', systemPrompt });

      const session = createSession({
        id: result.sessionId,
        topicId: topic.id,
        createdAt: Date.now(),
        initialAssistantText: result.text,
        claudeSessionId: result.sessionId,
      });

      res.json({
        sessionId: session.id,
        topicId: session.topicId,
        topicTitle: topic.title,
        message: result.text,
        rubric: null,
        mastered: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: 'claude call failed', detail: msg });
    }
  };

  const postMessage: RequestHandler = async (req, res) => {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || !sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found', sessionId });
      return;
    }
    const userMessage = String(req.body?.message ?? '').trim();
    if (!userMessage) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const topic = index.byId.get(session.topicId);
    if (!topic) {
      res.status(500).json({ error: 'topic for session not found', topicId: session.topicId });
      return;
    }

    try {
      // `--resume` 는 대화 history 만 복원할 뿐 `--system-prompt` 는 보존하지 않습니다.
      // 따라서 매 턴 시스템 프롬프트(파인만 코치 규칙 + 토픽 원문)를 다시 주입해야
      // 채점 JSON 블록 규칙이 유지됩니다. user 메시지에는 형식 reminder 도 덧붙입니다.
      const result = await callClaude({
        prompt: withFormatReminder(userMessage),
        sessionId: session.claudeSessionId,
        systemPrompt: buildSystemPrompt(topic),
      });
      if (result.sessionId && result.sessionId !== session.claudeSessionId) {
        // claude 가 새 ID 를 돌려준 경우(예: fork) 우리 DB 의 매핑을 동기화합니다.
        updateClaudeSessionId(session.id, result.sessionId);
      }
      const rubric = extractRubric(result.text);
      const ts = Date.now();
      appendTurn(session.id, { role: 'user', text: userMessage, rubric: null, ts });
      appendTurn(session.id, {
        role: 'assistant',
        text: result.text,
        rubric,
        ts: ts + 1,
      });
      const masteredNow = session.mastered || rubric?.mastered === true;
      updateSessionMeta(session.id, {
        updatedAt: ts + 1,
        lastRubric: rubric ?? undefined,
        mastered: masteredNow,
      });
      if (rubric && rubric.missedConcepts.length > 0) {
        recordMissedConcepts(session.topicId, rubric.missedConcepts, ts + 1);
      }

      res.json({
        sessionId: session.id,
        topicId: session.topicId,
        message: result.text,
        rubric,
        mastered: masteredNow,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: 'claude call failed', detail: msg });
    }
  };

  const getSessionDetail: RequestHandler = (req, res) => {
    const sessionId = req.params.id;
    if (typeof sessionId !== 'string' || !sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found', sessionId });
      return;
    }
    res.json(session);
  };

  /**
   * 토픽의 가장 최근 세션을 hydration 형태(SessionStartResponse + turns) 로 반환합니다.
   * 클라이언트는 이 응답을 받아 화면을 복원합니다. 직전 세션이 없으면 404.
   */
  const getLastSessionForTopic: RequestHandler = (req, res) => {
    const topicId = req.params.topicId;
    if (typeof topicId !== 'string' || !topicId) {
      res.status(400).json({ error: 'topicId is required' });
      return;
    }
    const topic = index.byId.get(topicId);
    if (!topic) {
      res.status(404).json({ error: 'topic not found', topicId });
      return;
    }
    const session = getLatestSessionByTopic(topicId);
    if (!session) {
      res.status(404).json({ error: 'no session for topic', topicId });
      return;
    }
    const opening = session.history[0];
    res.json({
      sessionId: session.id,
      topicId: session.topicId,
      topicTitle: topic.title,
      message: opening?.text ?? '',
      rubric: opening?.rubric ?? null,
      mastered: session.mastered,
      turns: session.history,
    });
  };

  const listAllSessions: RequestHandler = (_req, res) => {
    res.json({ sessions: listSessions() });
  };

  /**
   * 토픽 단위 학습 데이터를 모두 삭제합니다.
   * - sessions 행 (turns 는 FK CASCADE 로 함께 삭제)
   * - concept_misses 행
   * "새 세션" 진입을 깨끗한 상태에서 시작하기 위한 의도적 reset 입니다.
   */
  const resetTopicData: RequestHandler = (req, res) => {
    const topicId = req.params.topicId;
    if (typeof topicId !== 'string' || !topicId) {
      res.status(400).json({ error: 'topicId is required' });
      return;
    }
    const topic = index.byId.get(topicId);
    if (!topic) {
      res.status(404).json({ error: 'topic not found', topicId });
      return;
    }
    const result = db.transaction(() => {
      const sessions = deleteSessionsByTopic(topicId);
      const misses = deleteConceptMissesForTopic(topicId);
      return { sessions, misses };
    })();
    res.json({ topicId, deleted: result });
  };

  const listWeakPoints: RequestHandler = (req, res) => {
    const limitRaw = req.query.limit;
    let limit = 10;
    if (typeof limitRaw === 'string') {
      const parsed = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, 50);
    }
    const rows = getWeakPoints(limit);
    const items = rows.map((r) => {
      const topic = index.byId.get(r.topicId);
      return {
        topicId: r.topicId,
        topicTitle: topic?.title ?? r.topicId,
        concept: r.concept,
        count: r.count,
        lastSeenAt: r.lastSeenAt,
      };
    });
    res.json({ weakPoints: items });
  };

  router.get('/topics', getTopics);
  router.get('/topics/:topicId/last-session', getLastSessionForTopic);
  router.delete('/topics/:topicId/data', resetTopicData);
  router.post('/sessions', startSession);
  router.get('/sessions', listAllSessions);
  router.get('/weak-points', listWeakPoints);
  router.get('/sessions/:id', getSessionDetail);
  router.post('/sessions/:id/messages', postMessage);

  return router;
}

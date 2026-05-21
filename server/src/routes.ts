import { Router, type RequestHandler } from 'express';
import { callClaude } from './claude.js';
import {
  buildSystemPrompt,
  extractConceptList,
  extractEvaluation,
  stripCoachJson,
  withEvalReminder,
  withStartReminder,
  type Evaluation,
} from './prompt.js';
import type { TopicIndex } from './topics.js';
import {
  appendTurn,
  applyEvaluation,
  createSession,
  deleteSessionsByTopic,
  getLatestSessionByTopic,
  getSession,
  listSessions,
  updateClaudeSessionId,
} from './sessions.js';
import { getTopicStatsMap, getWeakPoints } from './stats.js';

/** sparkline 용 대표 점수 — 그 턴 평가에서 가장 높은 점수 (통합 점수 포함). */
function deriveTurnScore(evaluation: Evaluation): number | null {
  const scores = evaluation.scores.map((s) => s.score);
  if (evaluation.integrationScore !== null) scores.push(evaluation.integrationScore);
  return scores.length > 0 ? Math.max(...scores) : null;
}

export function createRouter(index: TopicIndex): Router {
  const router = Router();
  // 같은 세션에 평가 요청이 동시에 들어오면 claude --resume 가 겹쳐 세션 상태가
  // 꼬일 수 있으므로, 처리 중인 세션 id 를 잠가 동시 진입을 막습니다.
  const inFlightSessions = new Set<string>();

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
              mastered: s.mastered,
              bestCleared: s.bestCleared,
              bestTotal: s.bestTotal,
            }
          : { attempts: 0, mastered: false, bestCleared: 0, bestTotal: 0 },
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
      // 개념 목록 JSON 이 누락되면 세션이 사용 불능(마스터 불가·패널 빈 상태)이 되므로,
      // 누락 시 새 claude 세션으로 한 번 재시도합니다.
      let result = await callClaude({ prompt: withStartReminder('학습 시작'), systemPrompt });
      let concepts = extractConceptList(result.text);
      if (!concepts) {
        console.warn(`[startSession] 개념 목록 JSON 누락 — 재시도. topic=${topic.id}`);
        result = await callClaude({ prompt: withStartReminder('학습 시작'), systemPrompt });
        concepts = extractConceptList(result.text);
      }
      if (!concepts) {
        console.error(`[startSession] 재시도 후에도 개념 목록 누락 — topic=${topic.id}`);
      }

      const session = createSession({
        id: result.sessionId,
        topicId: topic.id,
        createdAt: Date.now(),
        initialAssistantText: stripCoachJson(result.text),
        claudeSessionId: result.sessionId,
        concepts: concepts ?? [],
      });

      res.json({
        sessionId: session.id,
        topicId: session.topicId,
        topicTitle: topic.title,
        message: stripCoachJson(result.text),
        concepts: session.concepts,
        integrationScore: session.integrationScore,
        nextFocus: session.nextFocus,
        mastered: session.mastered,
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

    if (inFlightSessions.has(session.id)) {
      res.status(409).json({
        error: 'a response for this session is already being processed',
        sessionId: session.id,
      });
      return;
    }
    inFlightSessions.add(session.id);

    try {
      // `--resume` 는 대화 history 만 복원할 뿐 `--system-prompt` 는 보존하지 않습니다.
      // 따라서 매 턴 시스템 프롬프트(파인만 코치 규칙 + 토픽 원문)를 다시 주입해야
      // 채점 규칙이 유지됩니다. user 메시지에는 형식 reminder 도 덧붙입니다.
      const result = await callClaude({
        prompt: withEvalReminder(userMessage),
        sessionId: session.claudeSessionId,
        systemPrompt: buildSystemPrompt(topic),
      });
      if (result.sessionId && result.sessionId !== session.claudeSessionId) {
        updateClaudeSessionId(session.id, result.sessionId);
      }

      const evaluation = extractEvaluation(result.text);
      if (!evaluation) {
        console.warn(`[postMessage] 채점 JSON 누락 — session=${session.id}`);
      }

      const ts = Date.now();
      appendTurn(session.id, { role: 'user', text: userMessage, turnScore: null, evalJson: null, ts });
      appendTurn(session.id, {
        role: 'assistant',
        text: stripCoachJson(result.text),
        turnScore: evaluation ? deriveTurnScore(evaluation) : null,
        evalJson: evaluation ? JSON.stringify(evaluation) : null,
        ts: ts + 1,
      });

      const updated = evaluation
        ? applyEvaluation(session.id, evaluation, ts + 1)
        : (getSession(session.id) ?? session);

      res.json({
        sessionId: session.id,
        topicId: session.topicId,
        message: stripCoachJson(result.text),
        concepts: updated.concepts,
        integrationScore: updated.integrationScore,
        nextFocus: updated.nextFocus,
        mastered: updated.mastered,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: 'claude call failed', detail: msg });
    } finally {
      inFlightSessions.delete(session.id);
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
   * 토픽의 가장 최근 세션을 hydration 형태로 반환합니다. 직전 세션이 없으면 404.
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
      concepts: session.concepts,
      integrationScore: session.integrationScore,
      nextFocus: session.nextFocus,
      mastered: session.mastered,
      turns: session.history,
    });
  };

  const listAllSessions: RequestHandler = (_req, res) => {
    res.json({ sessions: listSessions() });
  };

  /**
   * 토픽 단위 학습 데이터를 모두 삭제합니다. sessions 행 삭제 시
   * concepts·turns 는 FK CASCADE 로 함께 정리됩니다.
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
    const sessions = deleteSessionsByTopic(topicId);
    res.json({ topicId, deleted: { sessions } });
  };

  const listWeakPoints: RequestHandler = (req, res) => {
    const limitRaw = req.query.limit;
    let limit = 10;
    if (typeof limitRaw === 'string') {
      const parsed = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, 50);
    }
    const items = getWeakPoints(limit).map((r) => {
      const topic = index.byId.get(r.topicId);
      return {
        topicId: r.topicId,
        topicTitle: topic?.title ?? r.topicId,
        concept: r.concept,
        bestScore: r.bestScore,
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

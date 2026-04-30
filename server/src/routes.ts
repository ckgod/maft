import { Router, type RequestHandler } from 'express';
import { callClaude } from './claude.js';
import { buildSystemPrompt, withFormatReminder, extractRubric } from './prompt.js';
import type { TopicIndex } from './topics.js';
import {
  appendTurn,
  createSession,
  getSession,
  listSessions,
  updateSessionMeta,
} from './sessions.js';

export function createRouter(index: TopicIndex): Router {
  const router = Router();

  const getTopics: RequestHandler = (_req, res) => {
    const topics = index.questions.map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      depth: t.depth,
      parentId: t.parentId,
    }));
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

    try {
      const result = await callClaude({
        prompt: withFormatReminder(userMessage),
        sessionId: session.id,
      });
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

  const listAllSessions: RequestHandler = (_req, res) => {
    res.json({ sessions: listSessions() });
  };

  router.get('/topics', getTopics);
  router.post('/sessions', startSession);
  router.get('/sessions', listAllSessions);
  router.get('/sessions/:id', getSessionDetail);
  router.post('/sessions/:id/messages', postMessage);

  return router;
}

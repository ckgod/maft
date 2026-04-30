import { Router, type RequestHandler } from 'express';
import { callClaude } from './claude.js';
import { buildSystemPrompt, withFormatReminder, extractRubric } from './prompt.js';
import type { TopicIndex } from './topics.js';
import { getSession, saveSession, listSessions, type Session } from './sessions.js';

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
    res.json({ topics });
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

      const session: Session = {
        id: result.sessionId,
        topicId: topic.id,
        createdAt: Date.now(),
        history: [{ role: 'assistant', text: result.text, rubric: null, ts: Date.now() }],
        lastRubric: null,
        mastered: false,
      };
      saveSession(session);

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
      session.history.push(
        { role: 'user', text: userMessage, rubric: null, ts },
        { role: 'assistant', text: result.text, rubric, ts: ts + 1 },
      );
      if (rubric) {
        session.lastRubric = rubric;
        if (rubric.mastered) session.mastered = true;
      }
      saveSession(session);

      res.json({
        sessionId: session.id,
        topicId: session.topicId,
        message: result.text,
        rubric,
        mastered: session.mastered,
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

import express from 'express';
import { WRITERSIDE_DIR } from './config.js';
import { buildTopicIndex } from './topics.js';
import { createRouter } from './routes.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json({ limit: '1mb' }));

console.log(`[server] indexing topics from ${WRITERSIDE_DIR}`);
const index = buildTopicIndex(WRITERSIDE_DIR);
console.log(`[server] indexed ${index.byId.size} topics (${index.questions.length} learnable)`);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    topics: index.byId.size,
    questions: index.questions.length,
  });
});

app.use('/api', createRouter(index));

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

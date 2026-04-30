import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TopicKind = 'category' | 'question' | 'detail' | 'extra';

export interface TopicNode {
  id: string;
  title: string;
  filePath: string;
  kind: TopicKind;
  depth: number;
  parentId: string | null;
  childrenIds: string[];
}

export interface TopicIndex {
  rootIds: string[];
  byId: Map<string, TopicNode>;
  questions: TopicNode[];
}

const QUESTION_RE = /^Q\d+-/i;
const EXTRA_RE = /^E\d+-/i;
const DETAIL_RE = /^Details-/i;

function classifyTopic(id: string): TopicKind {
  if (QUESTION_RE.test(id)) return 'question';
  if (EXTRA_RE.test(id)) return 'extra';
  if (DETAIL_RE.test(id)) return 'detail';
  return 'category';
}

interface RawItem {
  id: string;
  indent: number;
}

function parseMiTree(xml: string): RawItem[] {
  const items: RawItem[] = [];
  for (const line of xml.split('\n')) {
    const m = line.match(/^(\s*)<toc-element\s+topic="([^"]+)"/);
    if (!m) continue;
    const indent = m[1]?.length ?? 0;
    const id = m[2];
    if (!id) continue;
    items.push({ indent, id });
  }
  return items;
}

export function buildTopicIndex(writersideDir: string): TopicIndex {
  const xml = readFileSync(join(writersideDir, 'mi.tree'), 'utf8');
  const topicsDir = join(writersideDir, 'topics');
  const items = parseMiTree(xml);

  const byId = new Map<string, TopicNode>();
  const rootIds: string[] = [];
  const stack: { id: string; indent: number }[] = [];

  for (const it of items) {
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= it.indent) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]!.id : null;
    const depth = stack.length;
    const node: TopicNode = {
      id: it.id,
      title: it.id.replace(/\.md$/, '').replace(/-/g, ' '),
      filePath: join(topicsDir, it.id),
      kind: classifyTopic(it.id),
      depth,
      parentId: parent,
      childrenIds: [],
    };
    byId.set(it.id, node);
    if (parent === null) {
      rootIds.push(it.id);
    } else {
      byId.get(parent)!.childrenIds.push(it.id);
    }
    stack.push({ id: it.id, indent: it.indent });
  }

  for (const node of byId.values()) {
    if (!existsSync(node.filePath)) continue;
    const content = readFileSync(node.filePath, 'utf8');
    const m = content.match(/^#\s+(.+)$/m);
    if (m && m[1]) node.title = m[1].trim();
  }

  const questions = [...byId.values()]
    .filter((n) => n.kind === 'question' || n.kind === 'extra')
    .sort((a, b) => a.id.localeCompare(b.id, 'ko', { numeric: true }));

  return { rootIds, byId, questions };
}

export function loadTopicContent(node: TopicNode): string {
  return readFileSync(node.filePath, 'utf8');
}

import { spawn } from 'node:child_process';

export interface ClaudeCallOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  /** 지정하면 응답을 이 JSON Schema 로 강제하고 결과를 structuredOutput 으로 돌려줍니다. */
  jsonSchema?: object;
  /** false 면 코치 전용 격리 플래그를 끕니다. 비교 실험에서 옛 호출 방식을 재현할 때만 씁니다. */
  isolated?: boolean;
}

export interface ClaudeResult {
  text: string;
  sessionId: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  model: string;
  /** jsonSchema 를 넘긴 호출에서 CLI 가 돌려준 구조화 출력. 없으면 null. */
  structuredOutput: unknown;
  raw: unknown;
}

// 채점·코칭 모델과 추론 강도. 환경변수로 코드 수정 없이 바꿔 비교할 수 있습니다.
// Opus 5.5 는 생각하는 양을 effort 로만 조절하므로 기본값을 명시해 둡니다.
const DEFAULT_MODEL = process.env.MAFT_MODEL ?? 'claude-opus-5-5';
const DEFAULT_EFFORT = process.env.MAFT_EFFORT ?? 'medium';

// 코치는 도구가 필요 없는 순수 대화 역할입니다. 아래 플래그가 없으면 claude -p 가
// 사용자·워크스페이스 CLAUDE.md, MCP 서버, 스킬 목록까지 불러와 코치 컨텍스트가
// 오염되고, 호출당 수만 토큰을 추가로 씁니다 (2026-09-28 실측 ~43K → ~1K).
const ISOLATION_FLAGS = [
  '--tools', '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--setting-sources', '',
];

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const args = ['-p', opts.prompt, '--output-format', 'json', '--model', model];
  if (opts.isolated !== false) {
    args.push('--effort', opts.effort ?? DEFAULT_EFFORT, ...ISOLATION_FLAGS);
  }
  if (opts.jsonSchema) {
    args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }

  // `--resume` 와 `--system-prompt` 는 함께 쓸 수 있습니다. `--resume` 는 대화 history 만
  // 복원하고 시스템 프롬프트는 보존하지 않으므로, 두 옵션을 독립적으로 적용합니다.
  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  }
  if (opts.systemPrompt) {
    args.push('--system-prompt', opts.systemPrompt);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (d) => stdoutChunks.push(d));
    proc.stderr.on('data', (d) => stderrChunks.push(d));

    proc.on('error', reject);
    proc.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as ClaudeRawJsonOutput;
        const usage = parsed.usage ?? {};
        const modelUsage = parsed.modelUsage ?? {};
        const modelKey = Object.keys(modelUsage)[0] ?? model;
        resolve({
          text: parsed.result ?? '',
          sessionId: parsed.session_id,
          durationMs: parsed.duration_ms ?? 0,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          costUsd: parsed.total_cost_usd ?? 0,
          model: modelKey,
          structuredOutput: parsed.structured_output ?? null,
          raw: parsed,
        });
      } catch {
        reject(new Error(`Failed to parse claude output: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

interface ClaudeRawJsonOutput {
  result?: string;
  structured_output?: unknown;
  session_id: string;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

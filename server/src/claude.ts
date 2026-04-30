import { spawn } from 'node:child_process';

export interface ClaudeCallOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  model?: string;
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
  raw: unknown;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const args = ['-p', opts.prompt, '--output-format', 'json', '--model', model];

  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  } else if (opts.systemPrompt) {
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

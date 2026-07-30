import { randomUUID } from 'node:crypto';
import { readFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DigestItem } from './digest';
import { FILTER_PROMPT } from './importance';
import { acquireDirectoryLock } from './lock';
import { mergeSeenKeysIntoState } from './state';

export const AGENT_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

export type AgentInstruction = {
  source: 'built-in' | 'config' | 'flag';
  text: string;
};

export type AgentItem = {
  id: string;
  title: string;
  source: string;
  score: number;
  publishedAt: string;
  hoursAgo: number;
  importance: number;
  tier: DigestItem['tier'];
  signals: string[];
  matchedTerms: string[];
  googleUrl: string | null;
};

type AgentCandidate = {
  id: string;
  key: string;
  item: AgentItem;
};

type AgentRun = {
  version: 1;
  createdAt: string;
  expiresAt: string;
  stateFile: string;
  candidates: AgentCandidate[];
};

export type CreateAgentRunInput = {
  stateFile: string;
  digest: DigestItem[];
  now: Date;
};

export type CommitAgentRunResult = {
  runId: string;
  count: number;
  items: AgentItem[];
};

function configHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), '.config');
}

function cacheHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_CACHE_HOME ?? join(env.HOME ?? homedir(), '.cache');
}

export function agentRulesPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configHome(env), 'uae-news-digest', 'filter.md');
}

export function agentRunsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(cacheHome(env), 'uae-news-digest', 'agent-runs');
}

function runPath(runId: string, env: NodeJS.ProcessEnv): string {
  return join(agentRunsDirectory(env), `${runId}.json`);
}

function assertRunId(runId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error('Unknown or unavailable agent run. Run uae-news-digest agent collect again.');
  }
}

function isExpired(run: AgentRun, now: Date): boolean {
  return new Date(run.expiresAt).getTime() <= now.getTime();
}

async function readRun(path: string): Promise<AgentRun | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as AgentRun;
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return null;
    throw new Error(`Could not read agent run record: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function pruneExpiredAgentRuns(now: Date, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const dir = agentRunsDirectory(env);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(entries.filter((entry) => entry.endsWith('.json')).map(async (entry) => {
    const path = join(dir, entry);
    const run = await readRun(path);
    if (!run || isExpired(run, now)) await unlink(path).catch(() => {});
  }));
}

export async function loadAgentInstructions(
  filterRules: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentInstruction[]> {
  const instructions: AgentInstruction[] = [{ source: 'built-in', text: FILTER_PROMPT }];
  const path = agentRulesPath(env);
  try {
    const text = await readFile(path, 'utf8');
    instructions.push({ source: 'config', text: text.trim() });
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT') {
      throw new Error(`Could not read persistent agent filter rules at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const text of filterRules) instructions.push({ source: 'flag', text });
  return instructions;
}

async function writeRun(path: string, run: AgentRun): Promise<void> {
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await Bun.write(tempPath, JSON.stringify(run));
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function createAgentRun(
  input: CreateAgentRunInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ runId: string; candidates: AgentItem[] }> {
  await pruneExpiredAgentRuns(input.now, env);
  const runId = randomUUID();
  const candidates = input.digest.map((digestItem) => {
    const id = randomUUID();
    const item: AgentItem = {
      id,
      title: digestItem.title,
      source: digestItem.source,
      score: digestItem.score,
      publishedAt: digestItem.publishedAt.toISOString(),
      hoursAgo: Math.round((input.now.getTime() - digestItem.publishedAt.getTime()) / 3_600_000),
      importance: digestItem.importance,
      tier: digestItem.tier,
      signals: digestItem.signals,
      matchedTerms: digestItem.matchedTerms ?? [],
      googleUrl: digestItem.link ?? null,
    };
    return { id, key: digestItem.key, item };
  });
  const run: AgentRun = {
    version: 1,
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + AGENT_RUN_RETENTION_MS).toISOString(),
    stateFile: input.stateFile,
    candidates,
  };
  const dir = agentRunsDirectory(env);
  await mkdir(dir, { recursive: true });
  await writeRun(runPath(runId, env), run);
  return { runId, candidates: candidates.map((candidate) => candidate.item) };
}

export async function commitAgentRun(
  runId: string,
  keepIds: string[],
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommitAgentRunResult> {
  assertRunId(runId);
  await pruneExpiredAgentRuns(now, env);
  const path = runPath(runId, env);
  const release = await acquireDirectoryLock(`${path}.lock`, `agent run ${runId}`);
  try {
    const run = await readRun(path);
    if (!run) {
      throw new Error('Unknown or unavailable agent run. Run uae-news-digest agent collect again.');
    }
    if (isExpired(run, now)) {
      await unlink(path).catch(() => {});
      throw new Error('This agent run has expired. Run uae-news-digest agent collect again.');
    }

    const candidateById = new Map(run.candidates.map((candidate) => [candidate.id, candidate]));
    for (const keepId of keepIds) {
      if (!candidateById.has(keepId)) {
        throw new Error(`Candidate "${keepId}" is not part of run ${runId}. Review the collected IDs and try again.`);
      }
    }

    await mergeSeenKeysIntoState(run.stateFile, run.candidates.map((candidate) => candidate.key));
    await unlink(path);
    const kept = keepIds.map((keepId) => candidateById.get(keepId)!.item);
    return { runId, count: kept.length, items: kept };
  } finally {
    await release();
  }
}

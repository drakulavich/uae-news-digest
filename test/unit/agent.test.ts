import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRunsDirectory, commitAgentRun, createAgentRun } from '../../src/agent';
import { readSeenKeys } from '../../src/state';
import type { DigestItem } from '../../src/digest';

const cacheHome = mkdtempSync(join(tmpdir(), 'uae-agent-unit-'));
const env = { ...process.env, XDG_CACHE_HOME: cacheHome };
const now = new Date('2026-03-22T08:00:00Z');

function candidate(): DigestItem {
  return {
    key: 'dubai airport || reuters',
    title: 'Dubai airport reopens',
    source: 'Reuters',
    score: 9,
    importance: 2,
    signals: ['airport'],
    tier: 'impact',
    publishedAt: new Date('2026-03-22T07:00:00Z'),
  };
}

afterAll(() => {
  rmSync(cacheHome, { recursive: true, force: true });
});

describe('agent run storage', () => {
  test('commits a run when its previous owner was terminated before releasing the lock', async () => {
    const stateFile = join(cacheHome, 'seen.txt');
    const run = await createAgentRun({ stateFile, digest: [candidate()], now }, env);
    const runPath = join(agentRunsDirectory(env), `${run.runId}.json`);
    const lockDir = `${runPath}.lock`;
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999_999_999, createdAt: new Date(0).toISOString() }));

    const result = await commitAgentRun(run.runId, [], now, env);

    expect(result).toMatchObject({ runId: run.runId, count: 0, items: [] });
    expect(await Bun.file(lockDir).exists()).toBe(false);
    expect(await readSeenKeys(stateFile)).toEqual(new Set(['dubai airport || reuters']));
  });
});

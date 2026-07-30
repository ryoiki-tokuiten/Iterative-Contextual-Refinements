import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('repository agents read one pinned barrier while concurrent branch writes stay isolated', { timeout: 60_000 }, async () => {
    const repositoryId = `deepthink-snapshot-test-${Date.now()}`;
    const sessionIds = {
        setup: `${repositoryId}-setup`,
        reader: `${repositoryId}-reader`,
        writer: `${repositoryId}-writer`,
        heartbeat: `${repositoryId}-heartbeat`,
        pool: `${repositoryId}-pool`,
        permission: `${repositoryId}-permission`,
    };
    const server = await createServer({
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
    });

    const cleanup = async () => {
        await server.close();
        const temporaryRoots = [
            'iterative-studio-sandbox-repos',
            'iterative-studio-sandbox-views',
            'iterative-studio-sandbox-vfs',
            'iterative-studio-sandbox-artifacts',
        ];
        await Promise.all(temporaryRoots.flatMap(root =>
            Object.values(sessionIds).map(sessionId =>
                rm(path.join(os.tmpdir(), root, root.includes('repos') ? repositoryId : sessionId), {
                    recursive: true,
                    force: true,
                }))));
        const metadataPath = path.join(
            os.tmpdir(),
            'iterative-studio-deepthink-results',
            `${repositoryId}.json`,
        );
        const metadata: { resultPath?: string } = await readFile(metadataPath, 'utf8')
            .then(value => JSON.parse(value) as { resultPath?: string })
            .catch(() => ({} as { resultPath?: string }));
        if (metadata.resultPath) {
            await rm(metadata.resultPath, { recursive: true, force: true });
        }
        await rm(metadataPath, { force: true });
    };

    try {
        await server.listen();
        const address = server.httpServer?.address() as AddressInfo;
        const endpoint = `http://127.0.0.1:${address.port}/api/sandbox`;
        const execute = async (
            sessionId: string,
            command: string,
            repositoryAccess: Record<string, unknown>,
        ) => {
            const response = await fetch(`${endpoint}/execute`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    command,
                    timeoutMs: 10_000,
                    repositoryAccess,
                }),
            });
            const payload = await response.json() as {
                ok: boolean;
                exitCode: number;
                stdout: string;
                stderr: string;
                error?: string;
            };
            assert.equal(response.ok, true, payload.error || payload.stderr);
            return payload;
        };
        const snapshot = async (message: string) => {
            const response = await fetch(`${endpoint}/snapshot`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ repositoryId, commitMessage: message }),
            });
            const payload = await response.json() as { commit?: string; error?: string };
            assert.equal(response.ok, true, payload.error);
            assert.match(payload.commit || '', /^[0-9a-f]{40}$/i);
            return payload.commit!;
        };
        const wait = (milliseconds: number) =>
            new Promise(resolve => setTimeout(resolve, milliseconds));

        const fullWrite = { repositoryId, fullRepositoryWrite: true };
        await execute(
            sessionIds.setup,
            'mkdir -p Strategy-1 Strategy-2/SolutionPool; printf baseline > Strategy-2/marker.txt; printf pool-baseline > Strategy-2/SolutionPool/pool.txt',
            fullWrite,
        );
        const baseline = await snapshot('baseline');

        const readerAccess = {
            repositoryId,
            agentDirectory: 'Strategy-1',
            readableDirectories: ['Strategy-2'],
            revision: baseline,
        };
        const writerAccess = {
            repositoryId,
            agentDirectory: 'Strategy-2',
            revision: baseline,
        };
        const delayedRead = execute(
            sessionIds.reader,
            'sleep 1; cat /workspace/Strategy-2/marker.txt',
            readerAccess,
        );
        await wait(200);
        await execute(sessionIds.writer, 'printf concurrent > marker.txt', writerAccess);
        assert.equal((await delayedRead).stdout.trim(), 'baseline');

        const forbiddenWrite = await execute(
            sessionIds.permission,
            'printf forbidden > /workspace/Strategy-2/forbidden.txt',
            readerAccess,
        );
        assert.notEqual(forbiddenWrite.exitCode, 0);

        const poolBaseline = await snapshot('pool baseline');
        const heartbeatRead = execute(
            sessionIds.heartbeat,
            'sleep 1; cat /workspace/Strategy-2/SolutionPool/pool.txt',
            {
                repositoryId,
                fullRepositoryRead: true,
                hiddenDirectories: ['Pruned_Strategies'],
                revision: poolBaseline,
            },
        );
        await wait(200);
        await execute(
            sessionIds.pool,
            'printf pool-current > pool.txt',
            {
                repositoryId,
                agentDirectory: 'Strategy-2/SolutionPool',
                readableDirectories: ['Strategy-2'],
                revision: poolBaseline,
            },
        );
        assert.equal((await heartbeatRead).stdout.trim(), 'pool-baseline');
    } finally {
        await cleanup();
    }
});

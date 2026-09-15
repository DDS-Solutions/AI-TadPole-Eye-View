import { spawn } from 'node:child_process';
import path from 'node:path';

const childFixture = path.resolve(import.meta.dirname, 'fixtures', 'ledgerProcess.ts');

export function reserveInLedgerChild(dbPath: string, operationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childFixture, dbPath, operationId], {
      env: { ...process.env, NODE_ENV: 'test', VITEST: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Ledger child exited ${code}: ${stderr}`));
    });
  });
}

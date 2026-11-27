import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.js';

describe('Vite Dev-Server Filesystem Isolation', () => {
  it('denies serving environment files, logs, caches, dist, and sqlite databases from dev server', () => {
    const deny = viteConfig.server?.fs?.deny ?? [];
    expect(deny).toContain('.env');
    expect(deny).toContain('**/.gev-logs/**');
    expect(deny).toContain('**/.gev-cache/**');
    expect(deny).toContain('**/dist/**');
    expect(deny).toContain('**/*.db');
  });
});

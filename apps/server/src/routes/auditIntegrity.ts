import { AuditIntegrityStatusSchema } from '@gev/contracts';
import type { SqliteAuditSink } from '@gev/governance';
import { Hono } from 'hono';

export function createAuditIntegrityRouter(auditSink: SqliteAuditSink): Hono {
  const router = new Hono();

  router.get('/integrity', (context) => {
    const integrity = AuditIntegrityStatusSchema.parse(auditSink.verifyIntegrity());
    const status = integrity.status === 'valid' ? 200 : integrity.status === 'invalid' ? 409 : 503;
    return context.json(integrity, status);
  });

  return router;
}

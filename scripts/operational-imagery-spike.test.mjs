import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const evidencePath = new URL(
  '../execution/task-5.3.4/bounded-official-sample-v1.json',
  import.meta.url
);
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

test('bounded imagery evidence preserves every accepted ceiling and rejection', () => {
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.task, '5.3.4');
  assert.equal(evidence.governance.stasis_active, false);
  assert.equal(evidence.governance.server_mode, 'seed');

  assert.equal(evidence.nowcoast.request_count, 2);
  assert.deepEqual(evidence.nowcoast.dimensions, [1024, 1024]);
  assert.ok(evidence.nowcoast.payload_bytes <= evidence.constraints.nowcoast_max_bytes);
  assert.ok(evidence.nowcoast.fetch_max_ms <= evidence.constraints.timeout_ms);
  assert.equal(evidence.nowcoast.cache_replay_upstream_requests, 0);
  assert.equal(evidence.nowcoast.decision, 'planned_unavailable');

  assert.equal(evidence.goes_glm.listing_count, 2);
  assert.equal(evidence.goes_glm.granule_count, 30);
  assert.equal(evidence.goes_glm.granule_keys.length, 30);
  assert.equal(new Set(evidence.goes_glm.granule_keys).size, 30);
  assert.ok(
    evidence.goes_glm.observed_max_concurrency <= evidence.constraints.max_concurrency_per_source
  );
  assert.ok(evidence.goes_glm.payload_bytes <= evidence.constraints.goes_glm_max_total_bytes);
  assert.ok(evidence.goes_glm.granule_max_bytes <= evidence.constraints.goes_glm_max_granule_bytes);
  assert.ok(evidence.goes_glm.granule_fetch_max_ms <= evidence.constraints.timeout_ms);
  assert.equal(evidence.goes_glm.cache_replay_upstream_requests, 0);
  assert.equal(evidence.goes_glm.normalized_record_count, null);
  assert.equal(evidence.goes_glm.decision, 'planned_unavailable');

  for (const key of evidence.goes_glm.granule_keys) {
    assert.match(
      key,
      /^GLM-L2-LCFA\/2026\/249\/20\/OR_GLM-L2-LCFA_G(?:18|19)_s\d{13,16}_e\d{13,16}_c\d{13,16}\.nc$/
    );
  }
});

test('source records and accepted ADR point to the preserved evidence', () => {
  const adr = fs.readFileSync(
    new URL('../docs/adr/0048-bounded-operational-imagery-spike.md', import.meta.url),
    'utf8'
  );
  const radar = fs.readFileSync(
    new URL('../docs/data-sources/nowcoast-radar.md', import.meta.url),
    'utf8'
  );
  const glm = fs.readFileSync(new URL('../docs/data-sources/goes-glm.md', import.meta.url), 'utf8');

  assert.match(adr, /Both candidates remain `planned` and operationally `unavailable`/);
  assert.match(adr, /bounded-official-sample-v1\.json/);
  assert.match(radar, /ADR 0048/);
  assert.match(radar, /120\.6\s+minutes/);
  assert.match(glm, /ADR 0048/);
  assert.match(glm, /no accepted NetCDF4\/HDF5 decoder/);
});

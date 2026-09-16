import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

describe('Architectural Boundary Compliance (PLAN.md §2 & ADR 0052)', () => {
  it('proves zero I/O, networking, and filesystem imports across all src modules', () => {
    const forbiddenPatterns = [
      /\bfrom\s+['"]node:fs(?:\/promises)?['"]/i,
      /\bfrom\s+['"]fs(?:\/promises)?['"]/i,
      /\bfrom\s+['"]node:http['"]/i,
      /\bfrom\s+['"]http['"]/i,
      /\bfrom\s+['"]node:https['"]/i,
      /\bfrom\s+['"]https['"]/i,
      /\bfrom\s+['"]node:net['"]/i,
      /\bfrom\s+['"]net['"]/i,
      /\bfrom\s+['"]undici['"]/i,
      /\bfrom\s+['"]axios['"]/i,
      /\bfrom\s+['"]node:sqlite['"]/i,
      /\bfrom\s+['"]better-sqlite3['"]/i,
      /\bfetch\s*\(/,
    ];

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const fullPath = path.join(srcDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(content),
          `Module ${file} violates zero-I/O boundary by matching forbidden pattern: ${pattern}`
        ).toBe(false);
      }
    }
  });

  it('proves all source files are within the 500-line limit (AGENTS.md rule 15)', () => {
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const fullPath = path.join(srcDir, file);
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
      expect(
        lines.length,
        `File ${file} exceeds 500 lines limit (${lines.length} lines)`
      ).toBeLessThanOrEqual(500);
    }
  });
});

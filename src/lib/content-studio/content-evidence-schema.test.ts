import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
const migrationPath = resolve(
  'prisma/migrations/20261013104000_content_piece_evidence/migration.sql',
);

function model(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `Missing ${name} model`).not.toBeNull();
  return match![1];
}

describe('ContentPiece evidence schema contract', () => {
  it('keeps evidence and both source references nullable', () => {
    const content = model('ContentPiece');
    expect(content).toMatch(/websiteId\s+String\?/);
    expect(content).toMatch(/sourceFindingId\s+String\?/);
    expect(content).toMatch(/evidence\s+Json\?/);
    expect(content).toMatch(/@@index\(\[websiteId\]\)/);
    expect(content).toMatch(/@@index\(\[sourceFindingId\]\)/);
  });

  it('preserves website attribution and allows source findings to be deleted', () => {
    const content = model('ContentPiece');
    expect(content).toMatch(/website\s+Website\?\s+@relation\(fields: \[websiteId\], references: \[id\], onDelete: Restrict\)/);
    expect(content).toMatch(/sourceFinding\s+Finding\?\s+@relation\(fields: \[sourceFindingId\], references: \[id\], onDelete: SetNull\)/);
    expect(model('Website')).toMatch(/contentPieces\s+ContentPiece\[\]/);
    expect(model('Finding')).toMatch(/contentPieces\s+ContentPiece\[\]/);
  });

  it('adds only the approved nullable columns, indexes and foreign keys', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql.match(/ADD COLUMN/g)).toHaveLength(3);
    expect(sql).toContain('ADD COLUMN "websiteId" TEXT');
    expect(sql).toContain('ADD COLUMN "sourceFindingId" TEXT');
    expect(sql).toContain('ADD COLUMN "evidence" JSONB');
    expect(sql).toContain('CREATE INDEX "ContentPiece_websiteId_idx" ON "ContentPiece"("websiteId")');
    expect(sql).toContain('CREATE INDEX "ContentPiece_sourceFindingId_idx" ON "ContentPiece"("sourceFindingId")');
    expect(sql).toContain('REFERENCES "Website"("id") ON DELETE RESTRICT');
    expect(sql).toContain('REFERENCES "Finding"("id") ON DELETE SET NULL');
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|DEFAULT|CREATE TABLE|CREATE TYPE)\b/);
    expect(sql).not.toMatch(/ADD COLUMN[^,;]*\bNOT NULL\b/);
  });

  it('backfills website attribution only from an existing source action', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/UPDATE "ContentPiece" AS content\s+SET "websiteId" = action\."websiteId"\s+FROM "Action" AS action\s+WHERE content\."sourceActionId" IS NOT NULL\s+AND content\."sourceActionId" = action\."id";/);
    expect(sql.match(/\bUPDATE "ContentPiece"/g)).toHaveLength(1);
    expect(sql).not.toMatch(/SET "(?:sourceFindingId|evidence)"/);
  });
});

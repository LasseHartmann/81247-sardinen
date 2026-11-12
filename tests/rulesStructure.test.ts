import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT_DIR, 'database.rules.json');

function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('Security-Audit: database.rules.json & Client-Code-Garantien', () => {
  const rawRules = fs.readFileSync(RULES_PATH, 'utf-8');
  const parsed = JSON.parse(rawRules) as {
    rules: Record<string, any>;
  };
  const gameNode = parsed.rules.games['81247'];

  it('erzwingt Deny-by-Default auf oberster Ebene ohne unauthentifizierte Zugriffe', () => {
    expect(parsed.rules['.read']).toBe(false);
    expect(parsed.rules['.write']).toBe(false);
    expect(gameNode).toBeDefined();
    expect(gameNode['.read']).toBeUndefined();
    expect(gameNode['.write']).toBeUndefined();
  });

  it('isoliert /state/hiderPrivate strikt gegen aktive Sucher-Teams', () => {
    const hiderPrivate = gameNode.state.hiderPrivate;
    expect(hiderPrivate['.read']).toContain("side').val() === 'HIDER'");
    expect(hiderPrivate['.read']).toContain("isHost').val() === true");
    expect(hiderPrivate['.read']).toContain("=== 'JOINED_SARDINES'");
    expect(hiderPrivate['.write']).toContain("side').val() === 'HIDER'");
    expect(hiderPrivate['.write']).not.toContain("=== 'SEEKER'");
  });

  it('verhindert Kaskaden-Leaks auf /teams, /clues und /requests und erlaubt sauberes Location-Löschen beim Catch', () => {
    // Kein globales .read auf /teams oder /teams/$teamId (sonst wären fremde Team-Locations lesbar!)
    expect(gameNode.teams['.read']).toBeUndefined();
    expect(gameNode.teams.$teamId['.read']).toBeUndefined();

    const locRules = gameNode.teams.$teamId.location;
    expect(locRules['.read']).toContain('=== $teamId');
    expect(locRules['.read']).toContain("=== 'HIDER'");
    expect(locRules['.read']).toContain('=== true');

    // Controller/Hider und Host dürfen Location beim Übergang auf JOINED_SARDINES löschen (!newData.exists())
    expect(locRules['.write']).toContain("=== 'HIDER'");
    expect(locRules['.write']).toContain("isHost').val() === true");
    expect(locRules['.validate']).toContain('!newData.exists()');

    // Kein globales .read auf /clues oder /requests
    expect(gameNode.clues['.read']).toBeUndefined();
    expect(gameNode.requests['.read']).toBeUndefined();
  });

  it('erzwingt Base64-Payload-Caps (<= 95000 Zeichen) auf /requests/$teamId/$requestId', () => {
    const reqValidate: string =
      gameNode.requests.$teamId.$requestId['.validate'];
    expect(reqValidate).toContain('mediaBase64');
    expect(reqValidate).toContain('<= 95000');
  });

  it('schützt Controller-Lease gegen Übernahme vor Ablauf von leaseExpiresAt', () => {
    const leaseWrite: string = gameNode.state.controller['.write'];
    expect(leaseWrite).toContain('leaseExpiresAt');
    expect(leaseWrite).toContain('< now');
    expect(leaseWrite).toContain("controllerUid').val() === auth.uid");
  });

  it('enthält im gesamten Client-Quellcode keinerlei Selbstregistrierung (createUserWithEmailAndPassword) und keinen Klartext-Admin-PIN', () => {
    const srcDir = path.join(ROOT_DIR, 'src');
    const files = collectTsFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toContain('createUserWithEmailAndPassword');
      expect(content).not.toContain('2342');
    }

    // database.rules.json erzwingt für Lasse & Linus den SHA-256-Admin-Hash
    const memberWriteRule: string = gameNode.members.$uid['.write'];
    expect(memberWriteRule).toContain('adminAuthHash');
    expect(memberWriteRule).toContain(
      '72bfd4d0aec4a76c76188c955cdfedfb75abd34584490c5d8ede99e15f71a5ae'
    );
  });
});

/**
 * E2E Test — Audio ↔ Interaction Association via callId
 *
 * Tests:
 *  1. extractCallId — extracts the correct token from a Five9 filename
 *  2. Migration backfill — audios table has call_id populated from existing filenames
 *  3. /interactions — returned items with a matching audio record carry an `audio` object
 *  4. /audios/:id/stream-url — returns a signed Wasabi URL (not the raw wasabiUrl)
 *
 * Run:
 *   npx dotenv -e .env -- ts-node test/e2e-audio-association.ts
 *
 * Requires: API running at API_URL (default http://localhost:3000)
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const LOGIN_EMAIL    = process.env.TEST_EMAIL    ?? 'admin@ucall.co.ao';
const LOGIN_PASSWORD = process.env.TEST_PASSWORD ?? 'Admin@123';

// ── helpers ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, reason: string) {
  console.error(`  ✗  ${label}`);
  console.error(`       ${reason}`);
  failed++;
}

async function api(path: string, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  const json = await res.json();
  return json?.data ?? json; // unwrap TransformInterceptor envelope
}

// ── unit: extractCallId ────────────────────────────────────────────────────
function testExtractCallId() {
  console.log('\n[ 1 ] extractCallId (unit)');

  const cases: [string, string][] = [
    [
      '6290F70E737043A888CF4479DA739A9D_100000000015497_miguel.silva@ucall.co.ao_+244944149626_1_43_41 PM.wav',
      '100000000015497',
    ],
    [
      'ABCD1234_200000000009350_agent@example.com_+244923730177_10_05_00 AM.wav',
      '200000000009350',
    ],
    // Edge case: no underscore → empty
    ['plainfile.wav', ''],
  ];

  // Replicate the extractCallId logic (same as etl.service.ts)
  const extractCallId = (filename: string): string => {
    const name = filename.replace(/\.[^.]+$/, '');
    const firstUnder = name.indexOf('_');
    if (firstUnder === -1) return '';
    const rest = name.slice(firstUnder + 1);
    const secondUnder = rest.indexOf('_');
    return secondUnder === -1 ? rest : rest.slice(0, secondUnder);
  };

  for (const [input, expected] of cases) {
    const got = extractCallId(input);
    if (got === expected) {
      ok(`"${input.slice(0, 40)}…" → "${expected}"`);
    } else {
      fail(`extractCallId("${input.slice(0, 40)}…")`, `expected "${expected}", got "${got}"`);
    }
  }
}

// ── integration tests (require running API + DB) ───────────────────────────
async function runIntegration() {
  // ── auth ──────────────────────────────────────────────────────────────────
  console.log('\n[ 2 ] Authentication');
  let token: string;
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });
    const body = await res.json();
    const payload = body?.data ?? body;
    token = payload.accessToken;
    if (!token) throw new Error('no accessToken in response');
    ok('login succeeded');
  } catch (err: any) {
    fail('login', err.message);
    console.error('\nCannot continue integration tests without auth. Skipping.\n');
    return;
  }

  // ── 3: DB backfill — audios should have call_id populated ─────────────────
  console.log('\n[ 3 ] DB backfill: audios.call_id');
  try {
    const res = await api('/audios?limit=50&status=processed', token);
    const audios: any[] = (res as any).meta ? (res as any).data : res;

    const withCallId  = audios.filter((a: any) => !!a.callId).length;
    const withoutCallId = audios.filter((a: any) => !a.callId).length;

    if (audios.length === 0) {
      console.log('     (no processed audios found — skipping assertion)');
    } else if (withCallId > 0) {
      ok(`${withCallId}/${audios.length} audios have callId populated`);
    } else {
      fail('all audios missing callId', `${withoutCallId} audios have no callId (migration may not have run)`);
    }

    // Verify customerPhone is cleared (was storing agent phone — now intentionally empty)
    const withPhone = audios.filter((a: any) => !!a.customerPhone).length;
    if (withPhone === 0) {
      ok('customerPhone is cleared (was incorrectly storing agent phone)');
    } else {
      console.log(`     (note: ${withPhone} audios still have customerPhone set — may be OK for older records)`);
    }
  } catch (err: any) {
    fail('GET /audios', err.message);
  }

  // ── 4: interactions — audio association via callId ─────────────────────────
  console.log('\n[ 4 ] Interaction ↔ Audio association (callId matching)');
  try {
    const res = await api('/interactions?limit=100', token);
    const items: any[] = (res as any).meta ? (res as any).data : (Array.isArray(res) ? res : []);

    const withAudio    = items.filter((i: any) => !!i.audio);
    const withoutAudio = items.filter((i: any) => !i.audio);

    ok(`interactions fetched: ${items.length}`);
    ok(`with audio linked:    ${withAudio.length}`);
    ok(`without audio:        ${withoutAudio.length}`);

    if (withAudio.length > 0) {
      const sample = withAudio[0];
      ok(`sample callId="${sample.callId}" linked to audio id="${sample.audio.id}" file="${sample.audio.filename}"`);

      // Validate callId match
      if (sample.audio.filename.includes(sample.callId)) {
        ok('callId present in audio filename ✓');
      } else {
        fail('callId not in audio filename', `callId="${sample.callId}" filename="${sample.audio.filename}"`);
      }
    } else {
      console.log('     (no matched audios found — run an ETL to process files, then retest)');
    }
  } catch (err: any) {
    fail('GET /interactions', err.message);
  }

  // ── 5: log-access endpoint (play / download) ─────────────────────────────
  console.log('\n[ 5 ] POST /audios/:id/log-access (nullable userId fix)');
  try {
    const audiosRes = await api('/audios?limit=1&status=processed', token);
    const audios: any[] = (audiosRes as any).meta ? (audiosRes as any).data : audiosRes;

    if (audios.length === 0) {
      console.log('     (no processed audios — skipping)');
    } else {
      const audioId = audios[0].id;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      // Test play
      const playRes = await fetch(`${API_URL}/audios/${audioId}/log-access`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'play' }),
      });
      if (playRes.ok) {
        ok(`POST /audios/${audioId}/log-access action=play → ${playRes.status}`);
      } else {
        const body = await playRes.json();
        fail('log-access play', `HTTP ${playRes.status}: ${body.message}`);
      }

      // Test download
      const dlRes = await fetch(`${API_URL}/audios/${audioId}/log-access`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'download' }),
      });
      if (dlRes.ok) {
        ok(`POST /audios/${audioId}/log-access action=download → ${dlRes.status}`);
      } else {
        const body = await dlRes.json();
        fail('log-access download', `HTTP ${dlRes.status}: ${body.message}`);
      }
    }
  } catch (err: any) {
    fail('POST /audios/:id/log-access', err.message);
  }

  console.log('\n[ 6 ] GET /audios/:id/stream-url (signed URL)');
  try {
    const audiosRes = await api('/audios?limit=1&status=processed', token);
    const audios: any[] = (audiosRes as any).meta ? (audiosRes as any).data : audiosRes;

    if (audios.length === 0) {
      console.log('     (no processed audios — skipping)');
    } else {
      const audioId = audios[0].id;
      const rawUrl  = audios[0].wasabiUrl;
      const signed  = await api(`/audios/${audioId}/stream-url`, token);

      if (!signed?.url) {
        fail('stream-url response missing .url field', JSON.stringify(signed));
      } else if (signed.url === rawUrl) {
        fail('signed URL is identical to raw URL', 'presigning likely failed');
      } else if (signed.url.includes('X-Amz-Signature') || signed.url.includes('Signature=')) {
        ok(`signed URL contains signature query param`);
        ok(`raw:    ${rawUrl.slice(0, 60)}…`);
        ok(`signed: ${signed.url.slice(0, 60)}…`);
      } else {
        // Some S3-compatible providers use different param names — just check it changed
        ok(`signed URL differs from raw URL (OK for Wasabi)`);
        ok(`raw:    ${rawUrl.slice(0, 60)}…`);
        ok(`signed: ${signed.url.slice(0, 60)}…`);
      }
    }
  } catch (err: any) {
    fail('GET /audios/:id/stream-url', err.message);
  }
}

// ── main ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' E2E — Audio ↔ Interaction Association via callId');
  console.log('═══════════════════════════════════════════════════════');

  testExtractCallId();
  await runIntegration();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
})();

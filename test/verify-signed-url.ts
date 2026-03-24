const API = 'http://localhost:3000/api/v1';

async function run() {
  // login
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@uvoice.com', password: 'Admin@123456' }),
  });
  const loginBody: any = await loginRes.json();
  const token: string = loginBody.accessToken ?? loginBody.data?.accessToken;
  if (!token) { console.error('Auth failed'); process.exit(1); }
  console.log('Authenticated ✓');

  const headers: any = { Authorization: `Bearer ${token}` };

  // fetch audios — find ones with spaces (the problematic filenames)
  const audiosRes = await fetch(`${API}/audios?limit=100&status=processed`, { headers });
  const audiosBody: any = await audiosRes.json();
  const audios: any[] = audiosBody.data ?? audiosBody;

  const withSpaces = audios.filter(a => a.filename.includes(' '));
  const all        = audios;

  console.log(`Total processed audios: ${all.length}, with spaces in name: ${withSpaces.length}`);

  const targets = withSpaces.length ? withSpaces : all;
  if (!targets.length) { console.log('No audios to test'); return; }

  let ok = 0, fail = 0;

  for (const a of targets.slice(0, 5)) {
    process.stdout.write(`\nAudio: ${a.filename.slice(0, 60)}…\n`);

    const urlRes  = await fetch(`${API}/audios/${a.id}/stream-url`, { headers });
    const urlBody: any = await urlRes.json();
    // API wraps responses in { data: ..., meta: ... } via TransformInterceptor
    const signed: string = (urlBody.data?.url ?? urlBody.url) ?? '';

    if (!signed) { console.log('  ✗ no URL returned'); fail++; continue; }

    // Log the path portion of the signed URL for diagnosis
    const pathPart = signed.split('?')[0];
    console.log(`  URL path: ${pathPart}`);

    if (signed.includes('%2520')) {
      console.log('  ✗ DOUBLE ENCODING detected (%2520) — will 404');
      fail++;
      continue;
    }

    if (signed.includes('%5C') || signed.includes('%5c')) {
      console.log('  ✗ BACKSLASH in presigned URL (%5C) — server not restarted, fix not active');
      fail++;
      continue;
    }

    // HEAD request to Wasabi
    try {
      const wasabi = await fetch(signed, { method: 'HEAD' });
      if (wasabi.status === 200) {
        console.log(`  ✓ HTTP 200 — object exists, audio will play`);
        ok++;
      } else {
        console.log(`  ✗ HTTP ${wasabi.status} — ${wasabi.statusText}`);
        console.log(`    Key fragment: ${signed.split('?')[0].slice(-80)}`);
        fail++;
      }
    } catch (e: any) {
      console.log(`  ✗ Fetch error: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nResults: ${ok} OK, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });

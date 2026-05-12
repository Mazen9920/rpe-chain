// Smoke test for Suppliers M02 DoD
// Runs from backend/ with `node scripts/smoke-suppliers.js`
const BASE = 'http://localhost:3000/api';

const log = (label, ok, detail = '') => {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' :: ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

async function jsonFetch(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function login(email, password) {
  const r = await jsonFetch('POST', '/auth/login', null, { email, password });
  if (r.status !== 200 || !r.data?.token) {
    throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return r.data.token;
}

(async () => {
  console.log('--- Suppliers M02 smoke test ---');

  // 1. Login as admin/procurement and finance
  let adminToken, financeToken;
  try {
    adminToken = await login('procurement@rpechain.com', 'Admin@123');
    log('login procurement', true);
  } catch (e) {
    log('login procurement', false, e.message);
    return;
  }
  try {
    financeToken = await login('finance@rpechain.com', 'Admin@123');
    log('login finance', true);
  } catch (e) {
    log('login finance', false, e.message);
  }

  // 2. List with filters
  const list = await jsonFetch('GET', '/suppliers?search=acme&limit=5&offset=0', adminToken);
  log('GET /suppliers (filter+pagination shape)',
    list.status === 200 && Array.isArray(list.data?.data) && typeof list.data?.total === 'number',
    `status=${list.status} keys=${Object.keys(list.data || {}).join(',')}`);

  // 3. Create supplier
  const uniqueCode = 'SMK-' + Date.now();
  const create1 = await jsonFetch('POST', '/suppliers', adminToken, {
    code: uniqueCode,
    name: 'Smoke Test Supplier',
    country: 'US',
    leadTimeDays: 10,
    paymentTerms: 'NET30',
    currency: 'USD',
  });
  log('POST /suppliers (create)', create1.status === 201, `status=${create1.status}`);
  const newId = create1.data?.id;

  // 4. Duplicate code -> 409
  const create2 = await jsonFetch('POST', '/suppliers', adminToken, {
    code: uniqueCode,
    name: 'Dup',
    country: 'US',
    leadTimeDays: 7,
  });
  log('POST /suppliers duplicate code -> 409', create2.status === 409, `status=${create2.status}`);

  // 5. Finance role cannot mutate
  if (financeToken) {
    const denyCreate = await jsonFetch('POST', '/suppliers', financeToken, {
      code: 'SMK-FIN-' + Date.now(),
      name: 'should fail',
      country: 'US',
      leadTimeDays: 5,
    });
    log('RBAC: finance cannot create -> 403', denyCreate.status === 403, `status=${denyCreate.status}`);
    const allowList = await jsonFetch('GET', '/suppliers?limit=1', financeToken);
    log('RBAC: finance can list -> 200', allowList.status === 200, `status=${allowList.status}`);
  }

  // 6. Update -> audit diff
  if (newId) {
    const upd = await jsonFetch('PUT', `/suppliers/${newId}`, adminToken, {
      leadTimeDays: 14,
      paymentTerms: 'NET60',
    });
    log('PUT /suppliers/:id', upd.status === 200 && upd.data?.leadTimeDays === 14, `status=${upd.status}`);
  }

  // 7. Record performance — invalid rate
  if (newId) {
    const badPerf = await jsonFetch('POST', `/suppliers/${newId}/performance`, adminToken, {
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      onTimeRate: 1.5,
    });
    log('POST performance onTimeRate=1.5 -> 400', badPerf.status === 400, `status=${badPerf.status}`);

    const goodPerf = await jsonFetch('POST', `/suppliers/${newId}/performance`, adminToken, {
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      onTimeRate: 0.95,
      fillRate: 0.98,
      defectRate: 0.02,
      leadTimeMean: 12.5,
      leadTimeStd: 2.1,
    });
    log('POST performance valid -> 200/201', goodPerf.status === 200 || goodPerf.status === 201, `status=${goodPerf.status}`);

    // 8. GET performance with date range
    const perfRange = await jsonFetch('GET', `/suppliers/${newId}/performance?from=2025-12-01&to=2026-02-28`, adminToken);
    log('GET performance date range', perfRange.status === 200 && Array.isArray(perfRange.data), `status=${perfRange.status}`);
  }

  // 9. Soft delete -> excluded from list
  if (newId) {
    const del = await jsonFetch('DELETE', `/suppliers/${newId}`, adminToken);
    log('DELETE /suppliers/:id', del.status === 200 || del.status === 204, `status=${del.status}`);

    const afterList = await jsonFetch('GET', `/suppliers?search=${uniqueCode}`, adminToken);
    const found = (afterList.data?.data || []).some((s) => s.id === newId);
    log('soft-deleted excluded from list', !found);
  }

  console.log('--- done ---');
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

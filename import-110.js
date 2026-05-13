const BASE_URL = 'http://localhost:5001/api';
const ADMIN_EMAIL = 'nitinmishra0105@gmail.com';
const ADMIN_PASSWORD = 'Nitin@9621';

async function main() {
  console.log('Logging in...');
  const loginRes = await fetch(`${BASE_URL}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const { data: { token } } = await loginRes.json();

  console.log('Logged in! Token:', token.slice(0, 10) + '...');

  let totalImported = 0;
  // We need 110 movies. TMDB auto-import gives 20 per page. So we need about 6 pages.
  for (let page = 1; page <= 6; page++) {
    console.log(`Auto-importing movies page ${page}...`);
    const res = await fetch(`${BASE_URL}/tmdb/auto-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ type: 'movie', page })
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error('Error importing page', page, data);
      continue;
    }
    const importedCount = data.data.summary.imported.length;
    const skippedCount = data.data.summary.skipped.length;
    console.log(`Page ${page} imported ${importedCount} new movies (Skipped ${skippedCount} existing).`);
    totalImported += importedCount;
  }
  console.log(`Total new movies imported in this run: ${totalImported}`);

  console.log('Checking database...');
  // Check if mongodb has movies
  const moviesRes = await fetch(`${BASE_URL}/movies?limit=1`);
  const moviesData = await moviesRes.json();
  console.log('Total movies now in MongoDB:', moviesData.pagination?.total || 0);
  console.log('MongoDB is working perfectly!');
}

main().catch(console.error);

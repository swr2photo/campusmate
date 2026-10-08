async function scan() {
  const res = await fetch('https://www.psu.ac.th/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const regex = /(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png))["']/gi;
  let m;
  const set = new Set();
  while ((m = regex.exec(html)) !== null) {
    const full = m[1].startsWith('http') ? m[1] : new URL(m[1], 'https://www.psu.ac.th/').href;
    set.add(full);
  }
  for (const m of set) {
    if (!m.includes('logo') && !m.includes('icon') && !m.includes('course')) console.log('PSU_IMG:', m);
  }
}
scan();


















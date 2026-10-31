// 상품 이미지 프록시: 허용한 이미지 서버만 받아서 CDN에 30일 캐시해요.
const ALLOWED = [/^https:\/\/img\.danuri\.io\//, /^https:\/\/img\.danawa\.com\//, /^https:\/\/shopping-phinf\.pstatic\.net\//, /^https:\/\/[a-z0-9-]+\.coupangcdn\.com\//];

export default async function handler(req, res) {
  const u = String(req.query.u || '');
  if (!ALLOWED.some((re) => re.test(u))) {
    res.status(400).send('unsupported image host');
    return;
  }
  try {
    const r = await fetch(u, {
      headers: {
        Referer: 'https://prod.danawa.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      res.status(502).send('image fetch failed');
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send('image fetch error');
  }
}

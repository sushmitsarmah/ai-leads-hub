export interface Env {
  ai_leads_db: D1Database;
  AUTH_EMAIL: string;
  AUTH_PASSWORD: string;
  SESSION_SECRET: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return false;
    
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBuf = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuf,
      enc.encode(payloadB64)
    );
    if (!valid) return false;

    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

async function createToken(email: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = JSON.stringify({
    email,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const payloadB64 = btoa(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(payloadB64)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${payloadB64}.${sigB64}`;
}

export default {
  // CRON TRIGGER: runs daily to fetch new AI startups
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScraper(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 1. LOGIN API
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const body = await request.json() as { email?: string; password?: string };
        const allowedEmail = env.AUTH_EMAIL || 'sushmitsarmah@gmail.com';
        const allowedPassword = env.AUTH_PASSWORD;

        if (
          body.email?.trim().toLowerCase() === allowedEmail.toLowerCase() &&
          body.password === allowedPassword
        ) {
          const token = await createToken(body.email, env.SESSION_SECRET);
          return json({ success: true, token, email: body.email });
        }
        return json({ error: 'Invalid email or password' }, 401);
      } catch (err: any) {
        return json({ error: err.message }, 400);
      }
    }

    // 2. AUTH CHECK FOR PROTECTED API
    if (url.pathname.startsWith('/api/')) {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader?.replace(/^Bearer\s+/i, '');

      if (!token || !(await verifyToken(token, env.SESSION_SECRET))) {
        return json({ error: 'Unauthorized: Please log in' }, 401);
      }

      // FETCH LEADS
      if (url.pathname === '/api/leads' && request.method === 'GET') {
        const { results } = await env.ai_leads_db
          .prepare(
            'SELECT company_name as "Company Name", position as "Position", location as "Location / Remote", contact_email as "Contact / Email", website_url as "Website / Careers URL", tech_stack as "Tech Stack", overview as "Overview", stage as "Stage" FROM leads ORDER BY (CASE WHEN stage LIKE "%Seed%" THEN 0 ELSE 1 END), id DESC'
          )
          .all();
        return json({ leads: results });
      }

      // TRIGGER MANUAL SCRAPER
      if (url.pathname === '/api/scrape' && request.method === 'POST') {
        const res = await runScraper(env);
        return json(res);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

// Daily Scraper implementation inside Worker
async function runScraper(env: Env) {
  try {
    let inserted = 0;

    // 1. Query latest HN hiring threads
    const hnSearch = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=3'
    );
    const searchData: any = await hnSearch.json();
    const thread = searchData.hits?.[0];

    if (thread) {
      const commentsRes = await fetch(
        `https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.objectID}&hitsPerPage=500`
      );
      const commentsData: any = await commentsRes.json();
      const comments = commentsData.hits || [];

      const keywords = ['ai', 'llm', 'agents', 'agentic', 'inference', 'rag', 'rust', 'distributed', 'pipeline'];

      for (const c of comments) {
        const rawText = c.comment_text || '';
        const text = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const lower = text.toLowerCase();

        if (!keywords.some((kw) => lower.includes(kw))) continue;

        const parts = text.split(/\||–|-/).map((p: string) => p.trim());
        const company = parts[0]?.slice(0, 40) || 'Unknown';
        const position = parts[1]?.slice(0, 60) || 'AI / Systems Engineer';
        const location = parts[2]?.slice(0, 50) || 'Remote / Worldwide';

        const emailMatch = text.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
        const urlMatch = text.match(/https?:\/\/[^\s<>"]+/);

        const contact_email = emailMatch ? emailMatch[1] : '';
        const website_url = urlMatch ? urlMatch[0] : '';
        const overview = text.slice(0, 250);

        let stage = 'Active Hiring';
        if (/\b(seed|pre-seed)\b/i.test(text)) {
          stage = '🌱 Just Raised Seed';
        } else if (/\b(series\s+a)\b/i.test(text)) {
          stage = '🚀 Series A';
        }

        const stacks: string[] = [];
        for (const s of ['rust', 'python', 'go', 'postgres', 'clickhouse', 'kafka', 'aws', 'llm', 'rag', 'agents']) {
          if (lower.includes(s)) stacks.push(s.toUpperCase());
        }
        const tech_stack = stacks.join(', ');

        await env.ai_leads_db
          .prepare(
            'INSERT INTO leads (company_name, position, location, contact_email, website_url, tech_stack, overview, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_name) DO UPDATE SET stage=excluded.stage, updated_at=CURRENT_TIMESTAMP'
          )
          .bind(company, position, location, contact_email, website_url, tech_stack, overview, stage)
          .run();

        inserted++;
      }
    }

    // 2. Query Seed / Pre-Seed funding announcements
    const seedQueries = ['raised seed AI', 'seed round AI', 'pre-seed AI', 'closes seed AI', 'YC AI seed'];
    for (const sq of seedQueries) {
      try {
        const sRes = await fetch(
          `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(sq)}&tags=story&hitsPerPage=25`
        );
        const sData: any = await sRes.json();
        for (const h of sData.hits || []) {
          const title = h.title || '';
          const storyText = h.story_text || '';
          const urlLink = h.url || '';
          const combined = `${title} ${storyText}`;

          let comp: string | null = null;
          let roundTag = '🌱 Just Raised Seed';

          const m1 = title.match(/^(?:Show HN:\s*)?([A-Z][a-zA-Z0-9\.\-_]{1,30}(?:\s+[A-Z][a-zA-Z0-9\.\-_]{1,20}){0,2})\s+(?:raises|raised|closes|secures)\s+(\$?[0-9]+(?:\.[0-9]+)?[mMbB]?\s*(?:pre-seed|seed|round)?)/i);
          const m2 = title.match(/^(?:Show HN:\s*)?([A-Z][a-zA-Z0-9\.\-_]{1,30})\s*\((?:\$?[0-9]+(?:\.[0-9]+)?[mMbB]?\s*)?(?:pre-seed|seed)/i);

          if (m1) {
            comp = m1[1].trim();
            roundTag = `🌱 ${m1[2].trim()}`;
          } else if (m2) {
            comp = m2[1].trim();
          } else if (urlLink && /seed/i.test(title)) {
            const dm = urlLink.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+)\./);
            if (dm && !['techcrunch', 'venturebeat', 'wsj', 'bloomberg', 'forbes', 'medium', 'substack', 'github', 'youtube', 'x', 'twitter'].includes(dm[1].toLowerCase())) {
              comp = dm[1].charAt(0).toUpperCase() + dm[1].slice(1);
            }
          }

          if (!comp || comp.length < 2 || ['Show HN', 'Ask HN', 'How I', 'We', 'My Friend'].includes(comp)) continue;

          const emailMatch = combined.match(/([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
          const contact = emailMatch ? emailMatch[1] : '';
          const website = urlLink || `https://${comp.toLowerCase()}.ai`;
          const overview = (storyText || title).replace(/<[^>]+>/g, ' ').slice(0, 250);

          await env.ai_leads_db
            .prepare(
              'INSERT INTO leads (company_name, position, location, contact_email, website_url, tech_stack, overview, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_name) DO UPDATE SET stage=excluded.stage, updated_at=CURRENT_TIMESTAMP'
            )
            .bind(comp, 'Founding AI / Systems Engineer', 'Remote / US / Global', contact, website, 'LLM, Python, Cloud', overview, roundTag)
            .run();

          inserted++;
        }
      } catch {}
    }

    return { success: true, newLeadsInserted: inserted };
  } catch (err: any) {
    return { error: err.message };
  }
}

#!/usr/bin/env python3
"""
Daily Automated AI Startup Scraper for Cloudflare D1
Fetches the latest startup hiring listings, extracts AI companies,
and inserts them directly into Cloudflare D1 via Wrangler or API.
"""

import urllib.request
import json
import re
import html
import subprocess
import os

KEYWORDS = [
    'ai', 'llm', 'agents', 'agentic', 'inference', 'rag', 'rust',
    'distributed', 'pipeline', 'machine learning', 'infrastructure',
    'backend', 'founding engineer', 'systems'
]

EMAIL_REGEX = re.compile(r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)')
URL_REGEX = re.compile(r'https?://[^\s<>\"\'\)]+')

def run_daily_scraper():
    print("🚀 Starting daily AI startup scraping job...")
    
    # 1. Fetch latest hiring thread ID
    search_url = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Who%20is%20hiring&hitsPerPage=2'
    req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
    
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        thread_id = data['hits'][0]['objectID']
        thread_title = data['hits'][0]['title']

    print(f"📡 Querying thread: {thread_title} (ID: {thread_id})")

    # 2. Fetch comments (up to 1,000)
    comments_url = f'https://hn.algolia.com/api/v1/search?tags=comment,story_{thread_id}&hitsPerPage=1000'
    req = urllib.request.Request(comments_url, headers={'User-Agent': 'Mozilla/5.0'})
    
    with urllib.request.urlopen(req) as resp:
        cdata = json.loads(resp.read().decode())
        comments = cdata.get('hits', [])

    print(f"📥 Received {len(comments)} raw comments")

    inserts = []
    seen = set()

    for c in comments:
        text = c.get('comment_text', '')
        if not text:
            continue
        
        clean = html.unescape(text)
        clean = re.sub(r'<[^>]+>', ' ', clean)
        clean = re.sub(r'\s+', ' ', clean).strip()
        lower = clean.lower()

        if not any(re.search(r'\b' + re.escape(kw) + r'\b', lower) for kw in KEYWORDS):
            continue

        parts = [p.strip() for p in re.split(r'\|| - |–', clean[:180])]
        company = parts[0] if parts else 'Unknown'
        position = parts[1] if len(parts) > 1 else 'AI / Systems Engineer'
        location = parts[2] if len(parts) > 2 else 'Remote / Worldwide'

        company_clean = re.sub(r'[^\w\s]', '', company).strip()
        if not company_clean or company_clean.lower() in seen or len(company_clean) < 2:
            continue
        seen.add(company_clean.lower())

        emails = EMAIL_REGEX.findall(clean)
        valid_emails = [e.rstrip('.') for e in emails if not e.endswith(('.png', '.jpg', 'ycombinator.com', 'example.com'))]
        
        urls = URL_REGEX.findall(text)
        valid_urls = [u.rstrip('>.,);\"\'') for u in urls if 'ycombinator.com' not in u]

        contact = valid_emails[0] if valid_emails else (valid_urls[0] if valid_urls else '')
        website = valid_urls[0] if valid_urls else ''
        overview = clean[:250].replace("'", "''")

        stacks = []
        for s in ['rust', 'python', 'go', 'postgres', 'clickhouse', 'kafka', 'aws', 'llm', 'rag', 'agents']:
            if s in lower:
                stacks.append(s.upper() if s in ['llm', 'rag', 'aws'] else s.capitalize())

        tech_stack = ', '.join(stacks)

        comp_esc = company[:40].replace("'", "''")
        pos_esc = position[:60].replace("'", "''")
        loc_esc = location[:50].replace("'", "''")
        con_esc = contact.replace("'", "''")
        web_esc = website.replace("'", "''")

        sql = f"INSERT OR REPLACE INTO leads (company_name, position, location, contact_email, website_url, tech_stack, overview) VALUES ('{comp_esc}', '{pos_esc}', '{loc_esc}', '{con_esc}', '{web_esc}', '{tech_stack}', '{overview}');"
        inserts.append(sql)

    print(f"✨ Parsed {len(inserts)} relevant AI startup leads")

    # 3. Write temp sql batch
    tmp_sql = '/tmp/daily_leads_sync.sql'
    with open(tmp_sql, 'w', encoding='utf-8') as f:
        f.write('\n'.join(inserts))

    # 4. Sync to Cloudflare D1
    print("☁️ Syncing to Cloudflare D1 database (ai-leads-db)...")
    cmd = ['wrangler', 'd1', 'execute', 'ai-leads-db', f'--file={tmp_sql}', '--remote', '-y']
    res = subprocess.run(cmd, capture_output=True, text=True)
    
    if res.returncode == 0:
        print("✅ Cloudflare D1 successfully synced with fresh leads!")
    else:
        print("❌ Cloudflare D1 sync error:", res.stderr)

if __name__ == '__main__':
    run_daily_scraper()

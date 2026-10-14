#!/usr/bin/env python3
"""
Seed Round & Early Stage AI Startup Extractor
Queries Hacker News API for recent Seed, Pre-Seed, and YC funding announcements,
extracts founding contacts and company details, and syncs into Cloudflare D1.
"""

import urllib.request
import urllib.parse
import json
import re
import html
import subprocess
import os

EMAIL_REGEX = re.compile(r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)')
URL_REGEX = re.compile(r'https?://[^\s<>\"\'\)]+')

QUERIES = [
    'raised seed AI',
    'seed round AI',
    'raises seed AI',
    'pre-seed AI',
    'closes seed AI',
    'seed funding AI',
    'YC AI startup seed',
    'Show HN AI pre-seed',
    'Show HN AI seed'
]

def fetch_seed_leads():
    print("🌱 Fetching AI startups that just raised Seed / Pre-Seed capital...")
    leads = []
    seen = set()

    for q in QUERIES:
        url = f"https://hn.algolia.com/api/v1/search_by_date?query={urllib.parse.quote(q)}&tags=story&hitsPerPage=40"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                hits = data.get('hits', [])
                
                for h in hits:
                    title = html.unescape(h.get('title') or '')
                    story_text = html.unescape(h.get('story_text') or '')
                    url_link = h.get('url') or ''
                    combined = f"{title} {story_text}"
                    combined_clean = re.sub(r'<[^>]+>', ' ', combined).strip()

                    # Heuristics for company extraction
                    comp = None
                    round_tag = "🌱 Just Raised Seed"

                    # 1. "Company raises/raised $XM seed..."
                    m1 = re.search(r'^(?:Show HN:\s*)?([A-Z][a-zA-Z0-9\.\-_]{1,30}(?:\s+[A-Z][a-zA-Z0-9\.\-_]{1,20}){0,2})\s+(?:raises|raised|closes|secures)\s+(\$?[0-9]+(?:\.[0-9]+)?[mMbB]?\s*(?:pre-seed|seed|round)?)', title, re.I)
                    # 2. "Show HN: Company ($2M seed)..."
                    m2 = re.search(r'^(?:Show HN:\s*)?([A-Z][a-zA-Z0-9\.\-_]{1,30})\s*\((?:\$?[0-9]+(?:\.[0-9]+)?[mMbB]?\s*)?(?:pre-seed|seed)', title, re.I)
                    # 3. "We raised $XM..."
                    m3 = re.search(r'we(?:\x27ve|\s+have)?\s+raised\s+(\$?[0-9]+(?:\.[0-9]+)?[mMbB]?[^\.\,\n]+)', title, re.I)

                    if m1:
                        comp = m1.group(1).strip()
                        round_tag = f"🌱 {m1.group(2).strip().title()}"
                    elif m2:
                        comp = m2.group(1).strip()
                        round_tag = "🌱 Just Raised Seed"
                    elif m3 and url_link:
                        round_tag = f"🌱 {m3.group(1).strip()[:20]}"
                        domain_m = re.search(r'https?://(?:www\.)?([a-zA-Z0-9\-]+)\.', url_link)
                        if domain_m and domain_m.group(1).lower() not in ['techcrunch', 'venturebeat', 'wsj', 'bloomberg', 'forbes', 'medium', 'substack', 'github']:
                            comp = domain_m.group(1).capitalize()
                    elif 'seed' in title.lower() and url_link:
                        domain_m = re.search(r'https?://(?:www\.)?([a-zA-Z0-9\-]+)\.', url_link)
                        if domain_m and domain_m.group(1).lower() not in ['techcrunch', 'venturebeat', 'wsj', 'bloomberg', 'forbes', 'medium', 'substack', 'github', 'youtube', 'x', 'twitter']:
                            comp = domain_m.group(1).capitalize()

                    if not comp:
                        continue

                    comp_clean = re.sub(r'[^\w\s\.-]', '', comp).strip()
                    low = comp_clean.lower()
                    if low in seen or len(comp_clean) < 2 or low in ['show hn', 'ask hn', 'how i', 'we', 'why', 'what', 'meet', 'the', 'my friend']:
                        continue
                    seen.add(low)

                    # Extract emails or fallback
                    emails = EMAIL_REGEX.findall(combined_clean)
                    valid_emails = [e for e in emails if not e.endswith(('.png', '.jpg', 'ycombinator.com', 'example.com'))]
                    contact = valid_emails[0] if valid_emails else ''

                    website = url_link if url_link else f"https://{low}.ai"
                    overview = (story_text or title)[:280].replace("'", "''")

                    stacks = []
                    for s in ['rust', 'python', 'go', 'postgres', 'clickhouse', 'kafka', 'aws', 'llm', 'rag', 'agents', 'pytorch']:
                        if s in combined_clean.lower():
                            stacks.append(s.upper() if s in ['llm', 'rag', 'aws'] else s.capitalize())
                    tech_stack = ', '.join(stacks) if stacks else 'LLM, Python, Cloud'

                    position = 'Founding AI / Systems Engineer'
                    if 'cto' in combined_clean.lower():
                        position = 'Founding CTO / Lead Architect'

                    leads.append({
                        'company_name': comp_clean[:40],
                        'position': position,
                        'location': 'Remote / US / Global',
                        'contact_email': contact,
                        'website_url': website,
                        'tech_stack': tech_stack,
                        'overview': overview,
                        'stage': round_tag
                    })
        except Exception as e:
            print(f"Error querying {q}: {e}")

    print(f"✨ Discovered {len(leads)} Seed / Pre-Seed AI startup leads!")
    return leads

def sync_to_d1(leads):
    if not leads:
        return
    
    statements = []
    for l in leads:
        c = l['company_name'].replace("'", "''")
        p = l['position'].replace("'", "''")
        loc = l['location'].replace("'", "''")
        em = l['contact_email'].replace("'", "''")
        web = l['website_url'].replace("'", "''")
        stack = l['tech_stack'].replace("'", "''")
        ov = l['overview'].replace("'", "''")
        stg = l['stage'].replace("'", "''")

        sql = f"INSERT INTO leads (company_name, position, location, contact_email, website_url, tech_stack, overview, stage) VALUES ('{c}', '{p}', '{loc}', '{em}', '{web}', '{stack}', '{ov}', '{stg}') ON CONFLICT(company_name) DO UPDATE SET stage=excluded.stage, overview=excluded.overview, updated_at=CURRENT_TIMESTAMP;"
        statements.append(sql)

    tmp_file = '/tmp/seed_leads_sync.sql'
    with open(tmp_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(statements))

    print(f"☁️ Syncing {len(statements)} seed leads into Cloudflare D1...")
    res = subprocess.run(['wrangler', 'd1', 'execute', 'ai-leads-db', f'--file={tmp_file}', '--remote', '-y'], capture_output=True, text=True)
    if res.returncode == 0:
        print("✅ D1 updated successfully with Seed stage companies!")
    else:
        print("❌ D1 execution failed:", res.stderr)

if __name__ == '__main__':
    seed_leads = fetch_seed_leads()
    sync_to_d1(seed_leads)

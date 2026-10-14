import { createSignal, createMemo, onMount, For, Show } from 'solid-js';
import * as echarts from 'echarts';
import {
  Search,
  ExternalLink,
  Mail,
  MapPin,
  Building,
  Briefcase,
  Layers,
  Sparkles,
  CheckCircle2,
  Copy,
  Lock,
  LogOut,
  RefreshCw
} from 'lucide-solid';

export interface Lead {
  'Company Name': string;
  'Position': string;
  'Location / Remote': string;
  'Contact / Email': string;
  'Website / Careers URL': string;
  'Tech Stack': string;
  'Overview': string;
}

const API_BASE = 'https://ai-leads-api.sushmitsarmah.workers.dev';

export default function App() {
  const [token, setToken] = createSignal<string | null>(localStorage.getItem('ai_leads_token'));
  const [loginEmail, setLoginEmail] = createSignal('sushmitsarmah@gmail.com');
  const [loginPassword, setLoginPassword] = createSignal('');
  const [loginError, setLoginError] = createSignal<string | null>(null);
  const [loginLoading, setLoginLoading] = createSignal(false);

  const [leads, setLeads] = createSignal<Lead[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [scraping, setScraping] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [selectedStack, setSelectedStack] = createSignal('ALL');
  const [remoteOnly, setRemoteOnly] = createSignal(false);
  const [selectedLead, setSelectedLead] = createSignal<Lead | null>(null);
  const [copiedEmail, setCopiedEmail] = createSignal<string | null>(null);

  let chartRef: HTMLDivElement | undefined;
  let chartInstance: echarts.ECharts | undefined;

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail(), password: loginPassword() }),
      });
      const data = await res.json() as { token?: string; error?: string };

      if (!res.ok || !data.token) {
        throw new Error(data.error || 'Login failed');
      }

      localStorage.setItem('ai_leads_token', data.token);
      setToken(data.token);
      loadLeads(data.token);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('ai_leads_token');
    setToken(null);
    setLeads([]);
  };

  const loadLeads = async (jwt: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/leads`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json() as { leads?: Lead[] };
      const valid = data.leads || [];
      setLeads(valid);
      setLoading(false);
      setTimeout(() => initChart(valid), 100);
    } catch {
      // Fallback to local static copy if offline
      const resp = await fetch('/ai_startups_leads.csv');
      const text = await resp.text();
      const lines = text.split('\n').slice(1);
      const parsed: Lead[] = lines.filter(Boolean).map(l => {
        const parts = l.split(',');
        return {
          'Company Name': parts[0] || '',
          'Position': parts[1] || '',
          'Location / Remote': parts[2] || '',
          'Contact / Email': parts[3] || '',
          'Website / Careers URL': parts[4] || '',
          'Tech Stack': parts[5] || '',
          'Overview': parts[6] || '',
        };
      });
      setLeads(parsed);
      setLoading(false);
      setTimeout(() => initChart(parsed), 100);
    }
  };

  const triggerLiveScraper = async () => {
    const jwt = token();
    if (!jwt) return;
    setScraping(true);
    try {
      const res = await fetch(`${API_BASE}/api/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json() as any;
      if (data.success) {
        await loadLeads(jwt);
      }
    } finally {
      setScraping(false);
    }
  };

  onMount(() => {
    const saved = token();
    if (saved) {
      loadLeads(saved);
    } else {
      setLoading(false);
    }

    window.addEventListener('resize', () => {
      chartInstance?.resize();
    });
  });

  const initChart = (data: Lead[]) => {
    if (!chartRef) return;
    if (chartInstance) chartInstance.dispose();
    chartInstance = echarts.init(chartRef, 'dark');

    const counts: Record<string, number> = {};
    for (const lead of data) {
      const stacks = lead['Tech Stack'] ? lead['Tech Stack'].split(', ') : [];
      for (const s of stacks) {
        if (s.trim()) counts[s.trim()] = (counts[s.trim()] || 0) + 1;
      }
    }

    const topStacks = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    chartInstance.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      grid: { left: '3%', right: '4%', bottom: '5%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: topStacks.map((s) => s[0]),
        axisLabel: { color: '#a1a1aa' },
        axisLine: { lineStyle: { color: '#27272a' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#a1a1aa' },
        splitLine: { lineStyle: { color: '#27272a' } },
      },
      series: [
        {
          name: 'Companies',
          type: 'bar',
          data: topStacks.map((s) => s[1]),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#38bdf8' },
              { offset: 1, color: '#0284c7' },
            ]),
            borderRadius: [6, 6, 0, 0],
          },
        },
      ],
    });
  };

  const filteredLeads = createMemo(() => {
    const q = search().toLowerCase().trim();
    const st = selectedStack();
    const ro = remoteOnly();

    return leads().filter((item) => {
      const matchesSearch =
        !q ||
        item['Company Name'].toLowerCase().includes(q) ||
        item['Position'].toLowerCase().includes(q) ||
        item['Overview'].toLowerCase().includes(q) ||
        item['Location / Remote'].toLowerCase().includes(q);

      const matchesStack =
        st === 'ALL' ||
        (item['Tech Stack'] &&
          item['Tech Stack'].toLowerCase().includes(st.toLowerCase()));

      const matchesRemote =
        !ro ||
        item['Location / Remote'].toLowerCase().includes('remote') ||
        item['Location / Remote'].toLowerCase().includes('worldwide');

      return matchesSearch && matchesStack && matchesRemote;
    });
  });

  const copyToClipboard = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  return (
    <div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header class="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles class="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              AI Startup Discovery Hub
              <span class="text-xs bg-cyan-950 border border-cyan-800 text-cyan-400 px-2 py-0.5 rounded-full font-mono">
                Cloudflare D1 + SolidJS
              </span>
            </h1>
            <p class="text-xs text-zinc-400">
              Live automated scraper syncing daily to Cloudflare D1
            </p>
          </div>
        </div>

        <Show when={token()}>
          <div class="flex items-center gap-3">
            <button
              onClick={triggerLiveScraper}
              disabled={scraping()}
              class="bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/60 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 text-zinc-300 transition"
            >
              <RefreshCw class={`h-3.5 w-3.5 text-cyan-400 ${scraping() ? 'animate-spin' : ''}`} />
              <span>{scraping() ? 'Syncing...' : 'Sync Scraper Now'}</span>
            </button>
            <div class="bg-zinc-800/80 border border-zinc-700/60 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 text-zinc-300">
              <Building class="h-3.5 w-3.5 text-cyan-400" />
              <span>
                Total: <strong class="text-white font-mono">{leads().length}</strong>
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Log Out"
              class="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 p-2 rounded-lg text-rose-300 transition"
            >
              <LogOut class="h-4 w-4" />
            </button>
          </div>
        </Show>
      </header>

      {/* LOGIN MODAL (When not authenticated) */}
      <Show when={!token()}>
        <div class="flex-1 flex items-center justify-center p-6">
          <div class="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-2xl p-8 shadow-2xl flex flex-col gap-6">
            <div class="text-center">
              <div class="h-12 w-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 mx-auto mb-4">
                <Lock class="h-6 w-6 text-white" />
              </div>
              <h2 class="text-xl font-bold text-white">Private Founder & Engineer Access</h2>
              <p class="text-xs text-zinc-400 mt-1">
                Secured access restricted to authorized email
              </p>
            </div>

            <form onSubmit={handleLogin} class="flex flex-col gap-4">
              <div>
                <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={loginEmail()}
                  onInput={(e) => setLoginEmail(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-zinc-400 mb-1.5">Access Password</label>
                <input
                  type="password"
                  required
                  placeholder="Enter generated security key..."
                  value={loginPassword()}
                  onInput={(e) => setLoginPassword(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <Show when={loginError()}>
                <p class="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/60 px-3 py-2 rounded-lg">
                  {loginError()}
                </p>
              </Show>

              <button
                type="submit"
                disabled={loginLoading()}
                class="w-full mt-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold text-sm py-2.5 rounded-lg transition shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
              >
                {loginLoading() ? 'Verifying...' : 'Unlock Dashboard'}
              </button>
            </form>
          </div>
        </div>
      </Show>

      {/* DASHBOARD CONTENT (Protected) */}
      <Show when={token()}>
        <main class="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
          {/* Top Analytics Bar & Chart */}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div class="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Cloudflare D1 Pipeline
                </span>
                <h2 class="text-2xl font-bold mt-1 text-white">
                  {leads().length} Early Companies
                </h2>
                <p class="text-sm text-zinc-400 mt-2 leading-relaxed">
                  Automatically syncs every 24 hours at 06:00 UTC via Cloudflare Workers Cron Trigger into D1 database.
                </p>
              </div>

              <div class="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-zinc-800">
                <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <span class="text-xs text-zinc-400">Remote / Worldwide</span>
                  <p class="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                    {
                      leads().filter(
                        (l) =>
                          l['Location / Remote'].toLowerCase().includes('remote') ||
                          l['Location / Remote'].toLowerCase().includes('worldwide')
                      ).length
                    }
                  </p>
                </div>
                <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <span class="text-xs text-zinc-400">Rust / Systems</span>
                  <p class="text-lg font-bold font-mono text-cyan-400 mt-0.5">
                    {
                      leads().filter((l) =>
                        (l['Tech Stack'] || '').toLowerCase().includes('rust')
                      ).length
                    }
                  </p>
                </div>
              </div>
            </div>

            <div class="lg:col-span-2 bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 flex flex-col">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Layers class="h-3.5 w-3.5 text-cyan-400" /> Technology Distribution in D1
                </span>
                <span class="text-xs text-zinc-500">ECharts Live</span>
              </div>
              <div ref={chartRef} class="w-full h-44 flex-1"></div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div class="flex flex-1 items-center gap-3 min-w-[280px]">
              <div class="relative w-full max-w-md">
                <Search class="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search company, position, keyword or location..."
                  value={search()}
                  onInput={(e) => setSearch(e.currentTarget.value)}
                  class="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                />
              </div>

              <label class="flex items-center gap-2 cursor-pointer text-xs font-medium bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-lg hover:border-zinc-700 transition">
                <input
                  type="checkbox"
                  checked={remoteOnly()}
                  onChange={(e) => setRemoteOnly(e.currentTarget.checked)}
                  class="rounded border-zinc-700 text-cyan-500 focus:ring-0 bg-zinc-900"
                />
                <span class="text-zinc-300">Remote Only</span>
              </label>
            </div>

            <div class="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedStack('ALL')}
                class={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  selectedStack() === 'ALL'
                    ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-800'
                }`}
              >
                All Tech
              </button>
              <For each={['Rust', 'Python', 'Agents', 'LLM', 'RAG', 'Postgres', 'Go']}>
                {(stack) => (
                  <button
                    onClick={() => setSelectedStack(stack)}
                    class={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                      selectedStack() === stack
                        ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                        : 'bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {stack}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Table */}
          <div class="bg-zinc-900/40 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex-1 flex flex-col">
            <Show
              when={!loading()}
              fallback={
                <div class="p-16 flex flex-col items-center justify-center gap-3 text-zinc-500">
                  <div class="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                  <p class="text-sm font-medium">Querying Cloudflare D1 database...</p>
                </div>
              }
            >
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr class="border-b border-zinc-800/80 bg-zinc-900/80 text-xs font-medium uppercase tracking-wider text-zinc-400">
                      <th class="py-3 px-4 w-[220px]">Company</th>
                      <th class="py-3 px-4 w-[240px]">Role / Position</th>
                      <th class="py-3 px-4 w-[160px]">Location</th>
                      <th class="py-3 px-4 w-[180px]">Contact / Email</th>
                      <th class="py-3 px-4 w-[180px]">Stack</th>
                      <th class="py-3 px-4 text-right w-[100px]">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-800/60 font-normal">
                    <For
                      each={filteredLeads()}
                      fallback={
                        <tr>
                          <td colspan="6" class="p-12 text-center text-zinc-500 text-sm">
                            No matching startups found.
                          </td>
                        </tr>
                      }
                    >
                      {(lead) => (
                        <tr
                          onClick={() => setSelectedLead(lead)}
                          class="hover:bg-zinc-800/40 cursor-pointer transition group"
                        >
                          <td class="py-3.5 px-4 font-semibold text-white">
                            <div class="flex items-center gap-2">
                              <span class="group-hover:text-cyan-400 transition">
                                {lead['Company Name']}
                              </span>
                              <Show when={lead['Website / Careers URL']}>
                                <a
                                  href={lead['Website / Careers URL']}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  class="text-zinc-500 hover:text-cyan-400 transition"
                                >
                                  <ExternalLink class="h-3.5 w-3.5" />
                                </a>
                              </Show>
                            </div>
                          </td>

                          <td class="py-3.5 px-4 text-zinc-300">
                            <div class="line-clamp-1 flex items-center gap-1.5">
                              <Briefcase class="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                              <span>{lead['Position'] || 'Engineering'}</span>
                            </div>
                          </td>

                          <td class="py-3.5 px-4 text-xs">
                            <span
                              class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ${
                                lead['Location / Remote'].toLowerCase().includes('remote') ||
                                lead['Location / Remote'].toLowerCase().includes('worldwide')
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              <MapPin class="h-3 w-3" />
                              <span class="line-clamp-1">{lead['Location / Remote']}</span>
                            </span>
                          </td>

                          <td class="py-3.5 px-4 text-xs font-mono">
                            <Show
                              when={lead['Contact / Email'] && lead['Contact / Email'].includes('@')}
                              fallback={
                                <Show
                                  when={lead['Contact / Email']}
                                  fallback={<span class="text-zinc-600">—</span>}
                                >
                                  <a
                                    href={lead['Contact / Email']}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    class="text-indigo-400 hover:underline flex items-center gap-1"
                                  >
                                    Apply <ExternalLink class="h-3 w-3" />
                                  </a>
                                </Show>
                              }
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(lead['Contact / Email']);
                                }}
                                class="text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 px-2.5 py-1 rounded-md flex items-center gap-1.5 transition"
                              >
                                <Show
                                  when={copiedEmail() === lead['Contact / Email']}
                                  fallback={<Mail class="h-3 w-3 text-cyan-400" />}
                                >
                                  <CheckCircle2 class="h-3 w-3 text-emerald-400" />
                                </Show>
                                <span class="truncate max-w-[120px]">
                                  {lead['Contact / Email']}
                                </span>
                              </button>
                            </Show>
                          </td>

                          <td class="py-3.5 px-4">
                            <div class="flex flex-wrap gap-1">
                              <For
                                each={
                                  lead['Tech Stack']
                                    ? lead['Tech Stack'].split(', ').slice(0, 3)
                                    : []
                                }
                              >
                                {(tag) => (
                                  <span class="text-[11px] bg-zinc-800 border border-zinc-700/60 text-zinc-300 px-1.5 py-0.5 rounded">
                                    {tag}
                                  </span>
                                )}
                              </For>
                            </div>
                          </td>

                          <td class="py-3.5 px-4 text-right">
                            <button
                              onClick={() => setSelectedLead(lead)}
                              class="text-xs bg-zinc-800 hover:bg-cyan-500 hover:text-zinc-950 font-medium px-2.5 py-1 rounded transition text-zinc-300"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        </main>
      </Show>

      {/* Slide-over Detail Modal */}
      <Show when={selectedLead()}>
        <div
          class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedLead(null)}
        >
          <div
            class="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-start justify-between border-b border-zinc-800 pb-4">
              <div>
                <span class="text-xs font-mono uppercase tracking-wider text-cyan-400">
                  Company Spotlight
                </span>
                <h3 class="text-2xl font-bold text-white mt-1">
                  {selectedLead()!['Company Name']}
                </h3>
                <p class="text-sm text-zinc-400 mt-0.5">{selectedLead()!['Position']}</p>
              </div>

              <button
                onClick={() => setSelectedLead(null)}
                class="text-zinc-400 hover:text-white p-2 text-sm bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
              >
                ✕ Close
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="bg-zinc-950 border border-zinc-800/80 p-3 rounded-xl">
                <span class="text-zinc-500 block mb-1 font-semibold">Location / Setup</span>
                <p class="font-medium text-zinc-200">{selectedLead()!['Location / Remote']}</p>
              </div>
              <div class="bg-zinc-950 border border-zinc-800/80 p-3 rounded-xl">
                <span class="text-zinc-500 block mb-1 font-semibold">Tech Keywords</span>
                <p class="font-medium text-cyan-400">{selectedLead()!['Tech Stack'] || 'AI/Fullstack'}</p>
              </div>
            </div>

            <div>
              <span class="text-xs font-semibold uppercase tracking-wider text-zinc-400 block mb-2">
                About the Company & Role
              </span>
              <div class="bg-zinc-950 border border-zinc-800/80 p-4 rounded-xl text-sm leading-relaxed text-zinc-300 max-h-52 overflow-y-auto font-sans">
                {selectedLead()!['Overview']}
              </div>
            </div>

            <div class="flex items-center justify-between pt-2 border-t border-zinc-800">
              <Show when={selectedLead()!['Website / Careers URL']}>
                <a
                  href={selectedLead()!['Website / Careers URL']}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                >
                  Visit Website / Careers <ExternalLink class="h-3 w-3" />
                </a>
              </Show>

              <div class="flex items-center gap-2">
                <Show when={selectedLead()!['Contact / Email']}>
                  <button
                    onClick={() => copyToClipboard(selectedLead()!['Contact / Email'])}
                    class="bg-zinc-800 hover:bg-zinc-700 text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 transition text-zinc-200"
                  >
                    <Copy class="h-3.5 w-3.5" />
                    {copiedEmail() === selectedLead()!['Contact / Email']
                      ? 'Copied!'
                      : 'Copy Email/Link'}
                  </button>
                </Show>

                <Show when={selectedLead()!['Contact / Email'] && selectedLead()!['Contact / Email'].includes('@')}>
                  <a
                    href={`mailto:${selectedLead()!['Contact / Email']}?subject=Systems%20%26%20AI%20Infrastructure%20Engineer`}
                    class="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 transition"
                  >
                    <Mail class="h-3.5 w-3.5" /> Direct Email
                  </a>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

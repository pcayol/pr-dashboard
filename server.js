import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, extname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = process.env.PR_DASHBOARD_HOME || join(homedir(), 'Library/Application Support/fr.lefigaro.pr-dashboard');
const PORT = Number(process.env.PORT || 4300);
const REFRESH_MS = 10 * 60 * 1000;
const PLUGIN_DIR = join(ROOT, 'claude-plugin');
const DATA = join(HOME_DIR, 'data');
const REPOS = join(HOME_DIR, 'repos');
const WORKTREES = join(HOME_DIR, 'worktrees');
const STATE_FILE = join(DATA, 'state.json');
const SETTINGS_FILE = join(DATA, 'settings.json');
const LEGACY_REPO = 'lefigaro/fff';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const DEFAULT_SETTINGS = {
  repo: process.env.PR_DASHBOARD_REPO || LEGACY_REPO,
  labels: ['dynamization'],
  autoBrief: !process.env.PR_DASHBOARD_NO_AUTO,
};

const HEADLESS_RULES = [
  'Tu tournes en mode headless, sans utilisateur pour te répondre.',
  'Ne pose aucune question et ne demande aucune validation : enchaîne toutes les étapes.',
  "Ne publie rien : pas d'artifact, pas de commentaire GitHub, pas de review, pas de push.",
  "Ta réponse finale est uniquement le livrable en markdown, sans phrase d'introduction ni offre de suite.",
].join(' ');

const SKILLS = {
  brief: {
    prompt: (url) => `/pr-dashboard:pr-brief ${url}`,
    tools: ['Skill', 'Read', 'Grep', 'Glob', 'Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)'],
  },
  deep: {
    prompt: (url, n, repo) =>
      `/pr-dashboard:deep-review ${n} ${repo}\n\nPR : ${url}. Ne montre pas la worklist pour validation, enchaîne directement la passe 2. Saute entièrement l'étape 6.`,
    tools: [
      'Skill', 'Read', 'Grep', 'Glob', 'Task', 'Write',
      'Bash(gh pr view:*)', 'Bash(gh pr diff:*)', 'Bash(gh pr checks:*)',
      'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git fetch:*)', 'Bash(git merge-base:*)',
      'Bash(git rev-parse:*)', 'Bash(git symbolic-ref:*)', 'Bash(git status:*)', 'Bash(git grep:*)',
      'Bash(node:*)', 'Bash(npx jest:*)', 'Bash(*/target.sh:*)', 'Bash(bash:*)', 'Bash(grep:*)', 'Bash(rg:*)',
      'Bash(ls:*)', 'Bash(cat:*)', 'Bash(sed:*)', 'Bash(head:*)', 'Bash(wc:*)',
    ],
  },
};
const FORBIDDEN_TOOLS = ['Edit', 'NotebookEdit', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(gh pr comment:*)', 'Bash(gh pr review:*)', 'Bash(gh api:*)'];

let settings = { ...DEFAULT_SETTINGS };
let state = { me: null, prs: {}, local: {}, analyses: {}, fetchedAt: null, error: null };
const queue = [];
let running = null;
const children = new Set();

const keyOf = (repo, n) => `${repo}#${n}`;
const slug = (repo) => repo.replace('/', '__');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      children.delete(child);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args[0]} exited ${code}: ${(err || out).trim()}`));
    });
  });
}

function migrateLegacy(saved) {
  const rekey = (obj = {}) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [/^\d+$/.test(k) ? keyOf(LEGACY_REPO, k) : k, v]));
  const analyses = rekey(saved.analyses);
  for (const jobs of Object.values(analyses)) {
    for (const job of [...Object.values(jobs), ...Object.values(jobs).map((j) => j.previous)]) {
      if (job?.file && isAbsolute(job.file)) job.file = job.file.slice(job.file.lastIndexOf('/data/') + '/data/'.length);
    }
  }
  return { local: rekey(saved.local), analyses };
}

async function loadState() {
  await mkdir(DATA, { recursive: true });
  if (existsSync(SETTINGS_FILE)) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) };
  if (!existsSync(STATE_FILE)) return;
  const saved = migrateLegacy(JSON.parse(await readFile(STATE_FILE, 'utf8')));
  state.local = saved.local;
  state.analyses = saved.analyses;
  for (const a of Object.values(state.analyses)) {
    for (const job of Object.values(a)) if (job.status === 'running' || job.status === 'queued') job.status = 'interrupted';
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

let saving = Promise.resolve();
function saveState() {
  saving = saving
    .then(() => writeJson(STATE_FILE, { local: state.local, analyses: state.analyses }))
    .catch((e) => console.error('[save]', e.message));
  return saving;
}

const PR_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt updatedAt additions deletions changedFiles reviewDecision
      author { login }
      headRefOid headRefName baseRefName
      labels(first: 20) { nodes { name color } }
      commits(last: 1) { nodes { commit { committedDate } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
      reviews(last: 50) { nodes { author { login } state submittedAt commit { oid } } }
      comments(last: 50) { nodes { author { login } createdAt } }
      reviewThreads(last: 50) { nodes { isResolved comments(last: 20) { nodes { author { login } createdAt } } } }
    } }
  }
}`;

function summarize(pr, me, repo) {
  const myReviews = pr.reviews.nodes.filter((r) => r.author?.login === me && r.submittedAt);
  const last = myReviews.at(-1) || null;
  const lastCommitAt = pr.commits.nodes[0]?.commit.committedDate || pr.updatedAt;
  const othersActivity = [
    ...pr.comments.nodes,
    ...pr.reviews.nodes.filter((r) => r.submittedAt).map((r) => ({ author: r.author, createdAt: r.submittedAt })),
    ...pr.reviewThreads.nodes.flatMap((t) => t.comments.nodes),
  ].filter((c) => c.author?.login && c.author.login !== me);

  let review = 'never';
  if (last) review = last.commit?.oid === pr.headRefOid ? 'uptodate' : 'outdated';
  const since = last?.submittedAt;
  const newComments = since ? othersActivity.filter((c) => c.createdAt > since).length : 0;
  const repliesToMe = since ? pr.reviewThreads.nodes.filter((t) => {
    const cs = t.comments.nodes;
    return cs.some((c) => c.author?.login === me) && cs.at(-1)?.author?.login !== me && cs.at(-1)?.createdAt > since;
  }).length : 0;

  return {
    key: keyOf(repo, pr.number),
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login,
    isDraft: pr.isDraft,
    isMine: pr.author?.login === me,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    lastCommitAt,
    headSha: pr.headRefOid,
    branch: pr.headRefName,
    base: pr.baseRefName,
    labels: pr.labels.nodes.map(({ name, color }) => ({ name, color })),
    size: { additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles },
    reviewDecision: pr.reviewDecision,
    requested: pr.reviewRequests.nodes.some((r) => r.requestedReviewer?.login === me),
    myReview: { status: review, state: last?.state || null, at: since || null, sha: last?.commit?.oid || null },
    newComments,
    repliesToMe,
    openThreads: pr.reviewThreads.nodes.filter((t) => !t.isResolved).length,
  };
}

function searchQuery({ repo, labels }) {
  const filter = labels.length ? ` label:${labels.map((l) => JSON.stringify(l)).join(',')}` : '';
  return `repo:${repo} is:pr is:open${filter}`;
}

async function refresh() {
  const { repo } = settings;
  try {
    if (!state.me) state.me = (await run('gh', ['api', 'user', '-q', '.login'])).trim();
    const raw = await run('gh', ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `q=${searchQuery(settings)}`]);
    if (repo !== settings.repo) return;
    const nodes = JSON.parse(raw).data.search.nodes;
    state.prs = Object.fromEntries(nodes.map((pr) => [pr.number, summarize(pr, state.me, repo)]));
    state.fetchedAt = new Date().toISOString();
    state.error = null;
    dropStaleJobs();
    if (settings.autoBrief) {
      for (const pr of Object.values(state.prs)) if (!pr.isDraft && !pr.isMine) enqueue(pr.number, 'brief');
    }
  } catch (e) {
    state.error = e.message;
    console.error('[refresh]', e.message);
  }
}

function dropStaleJobs() {
  const listed = new Set(Object.values(state.prs).map((pr) => pr.key));
  for (let i = queue.length - 1; i >= 0; i--) {
    const { key, kind } = queue[i];
    if (listed.has(key)) continue;
    queue.splice(i, 1);
    const job = state.analyses[key][kind];
    if (job.previous) state.analyses[key][kind] = job.previous;
    else delete state.analyses[key][kind];
  }
  saveState();
}

function jobFor(key, kind) {
  return state.analyses[key]?.[kind];
}

function enqueue(n, kind, { force = false } = {}) {
  const pr = state.prs[n];
  if (!pr) return false;
  const { key } = pr;
  const job = jobFor(key, kind);
  if (job && job.sha === pr.headSha && !force && job.status !== 'error' && job.status !== 'interrupted') return false;
  if (queue.some((j) => j.key === key && j.kind === kind) || (running?.key === key && running.kind === kind)) return false;
  state.analyses[key] ??= {};
  state.analyses[key][kind] = { sha: pr.headSha, status: 'queued', queuedAt: new Date().toISOString(), previous: job?.status === 'done' ? job : job?.previous };
  queue.push({ key, kind, repo: pr.repo, n: pr.number, sha: pr.headSha, url: pr.url, base: pr.base });
  saveState();
  pump();
  return true;
}

async function ensureClone(repo) {
  const dir = join(REPOS, slug(repo));
  if (existsSync(join(dir, '.git'))) return dir;
  await mkdir(REPOS, { recursive: true });
  await rm(dir, { recursive: true, force: true });
  await run('gh', ['repo', 'clone', repo, dir, '--', '--filter=blob:none', '--quiet']);
  return dir;
}

async function pump() {
  if (running || queue.length === 0) return;
  running = queue.shift();
  const { key, kind, repo, n, sha, url, base } = running;
  const job = state.analyses[key][kind];
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  await saveState();

  const wt = join(WORKTREES, `${slug(repo)}-${n}-${kind}`);
  let clone = null;
  try {
    clone = await ensureClone(repo);
    await run('git', ['-C', clone, 'fetch', '--quiet', 'origin', `+pull/${n}/head:refs/pr/${n}`, base]);
    if (existsSync(wt)) await run('git', ['-C', clone, 'worktree', 'remove', '--force', wt]).catch(() => rm(wt, { recursive: true, force: true }));
    await run('git', ['-C', clone, 'worktree', 'prune']);
    await run('git', ['-C', clone, 'worktree', 'add', '--detach', '--quiet', wt, sha]);

    const skill = SKILLS[kind];
    const out = await run('claude', [
      '-p', skill.prompt(url, n, repo),
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--plugin-dir', PLUGIN_DIR,
      '--allowedTools', ...skill.tools,
      '--disallowedTools', ...FORBIDDEN_TOOLS,
      '--append-system-prompt', HEADLESS_RULES,
    ], { cwd: wt });

    const res = JSON.parse(out);
    if (res.is_error) throw new Error(res.result || 'claude returned an error');
    const file = join('analyses', slug(repo), String(n), `${sha.slice(0, 12)}-${kind}.md`);
    await mkdir(dirname(join(DATA, file)), { recursive: true });
    await writeFile(join(DATA, file), res.result);
    Object.assign(job, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      file,
      cost: res.total_cost_usd,
      durationMs: res.duration_ms,
      sessionId: res.session_id,
      error: null,
    });
    delete job.previous;
  } catch (e) {
    Object.assign(job, { status: 'error', finishedAt: new Date().toISOString(), error: e.message.slice(0, 2000) });
    console.error(`[${kind} ${key}]`, e.message);
  } finally {
    if (clone) await run('git', ['-C', clone, 'worktree', 'remove', '--force', wt]).catch(() => {});
    running = null;
    await saveState();
    pump();
  }
}

function view() {
  const strip = (j) => j && { status: j.status, sha: j.sha, finishedAt: j.finishedAt, cost: j.cost, error: j.error, hasPrevious: !!j.previous };
  return {
    me: state.me,
    settings,
    fetchedAt: state.fetchedAt,
    error: state.error,
    queue: [running, ...queue].filter(Boolean).map(({ repo, n, kind }) => ({ repo, n, kind })),
    prs: Object.values(state.prs).map((pr) => {
      const a = state.analyses[pr.key] || {};
      return { ...pr, local: state.local[pr.key] || {}, brief: strip(a.brief), deep: strip(a.deep) };
    }),
  };
}

function validSettings(input) {
  const next = { ...settings };
  if (input.repo !== undefined) {
    if (typeof input.repo !== 'string' || !REPO_PATTERN.test(input.repo.trim())) throw new Error('repo must look like owner/name');
    next.repo = input.repo.trim();
  }
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels) || input.labels.some((l) => typeof l !== 'string')) throw new Error('labels must be a list of strings');
    next.labels = [...new Set(input.labels)];
  }
  if (input.autoBrief !== undefined) next.autoBrief = !!input.autoBrief;
  return next;
}

async function listLabels(repo) {
  if (!REPO_PATTERN.test(repo)) throw new Error('repo must look like owner/name');
  const out = await run('gh', ['label', 'list', '--repo', repo, '--limit', '500', '--json', 'name,color,description']);
  return JSON.parse(out).sort((a, b) => a.name.localeCompare(b.name));
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (process.env.PR_DASHBOARD_DEBUG) console.log(req.method, req.url, req.headers['user-agent']);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') {
      const file = join(ROOT, 'public', parts.length ? parts.join('/') : 'index.html');
      if (relative(join(ROOT, 'public'), file).startsWith('..') || !existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, await readFile(file), MIME[extname(file)] || 'application/octet-stream');
    }
    if (req.method === 'GET' && parts[1] === 'prs' && parts.length === 2) return send(res, 200, view());
    if (req.method === 'POST' && parts[1] === 'refresh') {
      await refresh();
      return send(res, 200, view());
    }
    if (parts[1] === 'settings') {
      if (req.method === 'GET') return send(res, 200, settings);
      if (req.method === 'POST') {
        let next;
        try {
          next = validSettings(await readBody(req));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        const repoChanged = next.repo !== settings.repo;
        settings = next;
        await writeJson(SETTINGS_FILE, settings);
        if (repoChanged) state.prs = {};
        await refresh();
        return send(res, 200, view());
      }
    }
    if (req.method === 'GET' && parts[1] === 'labels') return send(res, 200, await listLabels(url.searchParams.get('repo') || settings.repo));
    const n = Number(parts[2]);
    if (parts[1] === 'prs' && n && state.prs[n]) {
      const { key } = state.prs[n];
      if (req.method === 'POST' && parts[3] === 'local') {
        const patch = await readBody(req);
        state.local[key] = { ...(state.local[key] || {}), ...patch };
        await saveState();
        return send(res, 200, state.local[key]);
      }
      if (req.method === 'POST' && SKILLS[parts[3]]) {
        const queued = enqueue(n, parts[3], { force: url.searchParams.has('force') });
        return send(res, 200, { queued });
      }
      if (req.method === 'GET' && SKILLS[parts[3]]) {
        const job = jobFor(key, parts[3]);
        const done = job?.status === 'done' ? job : job?.previous;
        if (!done?.file) return send(res, 404, { error: 'no analysis' });
        return send(res, 200, { sha: done.sha, finishedAt: done.finishedAt, cost: done.cost, markdown: await readFile(join(DATA, done.file), 'utf8') });
      }
    }
    send(res, 404, { error: 'unknown route' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    for (const child of children) child.kill('SIGTERM');
    process.exit(0);
  });
}

await loadState();
await mkdir(WORKTREES, { recursive: true });
server.listen(PORT, '127.0.0.1', () => console.log(`PR dashboard on http://localhost:${PORT} (data in ${HOME_DIR})`));
refresh();
setInterval(refresh, REFRESH_MS);

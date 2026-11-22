#!/usr/bin/env node
// md — render a Markdown file to a readable HTML page and open it in Chrome.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const req = (m) => require(path.join(ROOT, 'node_modules', m));
const { Marked } = req('marked');
const { gfmHeadingId, getHeadingList } = req('marked-gfm-heading-id');
const hljs = req('highlight.js');

const CACHE = path.join(os.homedir(), 'Library', 'Caches', 'md-viewer');
const ASSETS = path.join(CACHE, 'assets');
const PAGES = path.join(CACHE, 'pages');
const MD_EXT = /\.(md|markdown|mdown|mkd)$/i;
const MAX_LINKED_PAGES = 200;
const THEMES = ['light', 'dark', 'system'];
const STATIC_FILES = ['viewer.css', 'viewer.js', 'theme.js'];

const USAGE = `Usage: md [--watch] [--raw] [--theme light|dark|system] <file.md>
Run "md --help" for the full guide.`;

const HELP = `md - open a Markdown file as a clean, GitHub-style page in Chrome

Usage: md [options] <file.md>

Options:
  -w, --watch           Serve the page locally and reload it on every save of the file.
                        Runs until you press Ctrl+C.
      --raw             Open in the raw view: the Markdown source, syntax-highlighted,
                        with a "Copy all" button that copies the whole file.
      --theme <mode>    Open in the light, dark or system theme (system follows macOS).
                        Also written as --theme=<mode>.
  -h, --help            Show this guide.

Examples:
  md README.md                    Render and open
  md --watch notes.md             Live preview while you edit
  md --raw notes.md               Open the source, ready to copy
  md --watch --raw --theme dark notes.md

On the page:
  Rendered | Raw        Switch between the rendered page and the Markdown source.
                        In Raw, "Copy all" copies the whole file to the clipboard.
  Light | Dark | System Switch the color theme. The last choice is remembered.
  Contents (left)       Table of contents; the current section is highlighted.
  Copy (on code)        Hover a code block to copy just that block.

Which view and theme open:
  A choice clicked in the current tab wins (kept across --watch reloads), then the
  --raw / --theme flags, then (theme only) the last choice in any tab, then macOS.

Supports GitHub-flavored Markdown (tables, task lists, autolinks), syntax-highlighted
code, Mermaid diagrams, relative images and links. Links to other .md files open
rendered too.

Files: pages are written to ~/Library/Caches/md-viewer/, never next to your file.
       Everything is bundled, so viewing works offline.`;

function fail(msg) {
  console.error(`md: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

// ---------- assets (copied once into the cache, so viewing is offline) ----------

// Theme selectors: <html data-theme="dark"> forces dark; with no data-theme the OS decides.
// :where() keeps them at zero specificity so the light rules they override stay comparable.
const FORCED_DARK = ':where([data-theme="dark"])';
const SYSTEM_DARK = ':where(:root:not([data-theme="light"]))';

// github-markdown-css switches its color variables only on the OS setting.
// Rebuild its two variable blocks so a forced theme works too.
function themeGithubCss(css) {
  const block = (scheme) => {
    const m = css.match(new RegExp(`@media \\(prefers-color-scheme: ${scheme}\\) \\{\\s*[^{]+\\{([^}]*)\\}\\s*\\}`));
    if (!m) throw new Error(`unexpected github-markdown-css layout (no ${scheme} block)`);
    return m;
  };
  const dark = block('dark');
  const light = block('light');
  const themed = `.markdown-body {${light[1]}}
${FORCED_DARK} .markdown-body {${dark[1]}}
@media (prefers-color-scheme: dark) {
  ${SYSTEM_DARK} .markdown-body {${dark[1]}}
}`;
  return css.replace(dark[0], '').replace(light[0], () => themed);
}

// Prefix every selector of a flat (no @-rules) stylesheet, e.g. highlight.js themes.
const scopeCss = (css, scope) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/([^{}]+)\{/g, (_, sel) => `${sel.split(',').map((s) => (scope ? `${scope} ` : '') + s.trim()).join(',')}{`);

function ensureAssets() {
  const stamp = path.join(ASSETS, '.version');
  const version = ['marked', 'highlight.js', 'mermaid', 'github-markdown-css']
    .map((m) => req(`${m}/package.json`).version)
    .concat(STATIC_FILES.map((f) => fs.statSync(path.join(ROOT, 'static', f)).mtimeMs),
            fs.statSync(__filename).mtimeMs)
    .join('|');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) return;

  fs.mkdirSync(ASSETS, { recursive: true });
  const nm = (p) => path.join(ROOT, 'node_modules', p);
  fs.writeFileSync(path.join(ASSETS, 'github-markdown.css'),
    themeGithubCss(fs.readFileSync(nm('github-markdown-css/github-markdown.css'), 'utf8')));
  fs.copyFileSync(nm('mermaid/dist/mermaid.min.js'), path.join(ASSETS, 'mermaid.min.js'));
  const light = fs.readFileSync(nm('highlight.js/styles/github.min.css'), 'utf8');
  const dark = fs.readFileSync(nm('highlight.js/styles/github-dark.min.css'), 'utf8');
  fs.writeFileSync(path.join(ASSETS, 'hljs.css'), `${scopeCss(light, '')}
${scopeCss(dark, FORCED_DARK)}
@media (prefers-color-scheme: dark){${scopeCss(dark, SYSTEM_DARK)}}
`);
  for (const f of STATIC_FILES) fs.copyFileSync(path.join(ROOT, 'static', f), path.join(ASSETS, f));
  fs.writeFileSync(stamp, version);
}

// ---------- rendering ----------

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pageName(absPath) {
  const hash = crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 10);
  return `${hash}-${path.basename(absPath).replace(/[^\w.-]/g, '_')}.html`;
}

// linkMode decides how local files are addressed:
//   static → file:// URLs, linked .md files pre-rendered into the cache
//   watch  → served by the local --watch server
function makeResolver(srcFile, mode, onMdLink) {
  const dir = path.dirname(srcFile);
  return (href) => {
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
    const m = href.match(/^([^?#]*)(.*)$/);
    let rel;
    try { rel = decodeURI(m[1]); } catch { rel = m[1]; }
    const abs = path.resolve(dir, rel);
    const suffix = m[2];
    if (MD_EXT.test(abs) && fs.existsSync(abs)) {
      if (mode === 'watch') return `/__md__${encodeURI(abs)}${suffix}`;
      onMdLink(abs);
      return `${pageName(abs)}${suffix}`;
    }
    if (mode === 'watch') return `/__file__${encodeURI(abs)}${suffix}`;
    return pathToFileURL(abs).href + suffix;
  };
}

function render(srcFile, { mode = 'static', theme = null, raw: rawFlag = false, onMdLink = () => {} } = {}) {
  const resolve = makeResolver(srcFile, mode, onMdLink);
  let hasMermaid = false;

  const marked = new Marked({ gfm: true });
  marked.use(gfmHeadingId());
  marked.use({
    renderer: {
      code(code, info) {
        const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid') {
          hasMermaid = true;
          return `<pre class="mermaid">${escapeHtml(code)}</pre>\n`;
        }
        const html = lang && hljs.getLanguage(lang)
          ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
          : escapeHtml(code);
        const cls = lang ? ` class="hljs language-${escapeHtml(lang)}"` : ' class="hljs"';
        return `<pre><code${cls}>${html}</code></pre>\n`;
      },
      link(href, title, text) {
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(resolve(href))}"${t}>${text}</a>`;
      },
      image(href, title, text) {
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(resolve(href))}" alt="${escapeHtml(text)}"${t}>`;
      },
    },
  });

  const source = fs.readFileSync(srcFile, 'utf8');
  const body = marked.parse(source);
  const raw = hljs.highlight(source, { language: 'markdown', ignoreIllegals: true }).value;
  const toc = getHeadingList()
    .filter((h) => h.level <= 3)
    .map((h) => `<li class="toc-h${h.level}"><a href="#${escapeHtml(h.id)}">${h.text}</a></li>`)
    .join('\n');

  const a = mode === 'watch' ? '/__assets__/' : '../assets/';
  const title = escapeHtml(path.basename(srcFile));
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme-flag="${theme}"` : ''}${rawFlag ? ' data-view-flag="raw"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="${a}theme.js"></script>
<link rel="stylesheet" href="${a}github-markdown.css">
<link rel="stylesheet" href="${a}hljs.css">
<link rel="stylesheet" href="${a}viewer.css">
</head>
<body${toc ? '' : ' class="no-toc"'}>
<button id="toc-toggle" aria-label="Table of contents" title="Contents">☰</button>
<nav id="toc"><div class="toc-title">Contents</div><ul>${toc}</ul></nav>
<main>
<div class="page-head">
<div class="file-path" title="${escapeHtml(srcFile)}">${escapeHtml(srcFile)}</div>
<div id="view-switch" class="seg-switch" role="radiogroup" aria-label="View">
<button type="button" role="radio" data-view="rendered" title="Rendered Markdown">◧ <span>Rendered</span></button>
<button type="button" role="radio" data-view="raw" title="Raw Markdown source">&lt;/&gt; <span>Raw</span></button>
</div>
<button type="button" id="copy-raw" title="Copy the whole Markdown source">⧉ <span>Copy all</span></button>
<div id="theme-switch" class="seg-switch" role="radiogroup" aria-label="Color theme">
<button type="button" role="radio" data-mode="light" title="Light theme">☀ <span>Light</span></button>
<button type="button" role="radio" data-mode="dark" title="Dark theme">☾ <span>Dark</span></button>
<button type="button" role="radio" data-mode="system" title="Follow the macOS setting">◐ <span>System</span></button>
</div>
</div>
<article id="rendered-view" class="markdown-body">
${body}
</article>
<div id="raw-view" class="markdown-body">
<pre><code class="hljs language-markdown">${raw}</code></pre>
</div>
</main>
${hasMermaid ? `<script src="${a}mermaid.min.js"></script>` : ''}
<script src="${a}viewer.js"></script>
${mode === 'watch' ? `<script>new EventSource('/__events__').onmessage = () => location.reload();</script>` : ''}
</body>
</html>
`;
}

// Static mode: render the file plus every local .md it links to (transitively).
function renderStatic(entry, theme, raw) {
  fs.mkdirSync(PAGES, { recursive: true });
  const queue = [entry];
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift();
    const html = render(file, {
      theme,
      raw,
      onMdLink: (abs) => {
        if (!seen.has(abs) && seen.size < MAX_LINKED_PAGES) { seen.add(abs); queue.push(abs); }
      },
    });
    fs.writeFileSync(path.join(PAGES, pageName(file)), html);
  }
  return path.join(PAGES, pageName(entry));
}

// ---------- browser ----------

function openInBrowser(target) {
  const hasChrome = spawnSync('open', ['-Ra', 'Google Chrome']).status === 0;
  try {
    execFileSync('open', hasChrome ? ['-a', 'Google Chrome', target] : [target]);
  } catch (e) {
    console.error(`md: could not open browser: ${e.message}`);
    process.exit(1);
  }
}

// ---------- watch mode ----------

const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};

function watch(entry, theme, raw) {
  const clients = new Set();
  const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

  const server = http.createServer((rq, res) => {
    const url = decodeURIComponent(rq.url.split('?')[0]);
    if (url === '/') return send(res, 200, 'text/html; charset=utf-8', render(entry, { mode: 'watch', theme, raw }));
    if (url === '/__events__') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      rq.on('close', () => clients.delete(res));
      return;
    }
    let file = null;
    if (url.startsWith('/__assets__/')) file = path.join(ASSETS, path.basename(url));
    else if (url.startsWith('/__md__/')) {
      const abs = url.slice('/__md__'.length);
      if (MD_EXT.test(abs) && fs.existsSync(abs)) {
        return send(res, 200, 'text/html; charset=utf-8', render(abs, { mode: 'watch', theme, raw }));
      }
    } else if (url.startsWith('/__file__/')) file = url.slice('/__file__'.length);
    if (file && !path.basename(file).startsWith('.') && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file));
    }
    send(res, 404, 'text/plain', 'Not found');
  });

  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`md: watching ${entry}\nmd: serving at ${url}  (Ctrl+C to stop)`);
    openInBrowser(url);
  });

  // Polling survives editors that save by replacing the file.
  fs.watchFile(entry, { interval: 300 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    if (!cur.nlink) return console.error(`md: ${entry} was removed; waiting for it to come back`);
    console.log(`md: reloaded (${new Date().toLocaleTimeString()})`);
    for (const c of clients) c.write('data: reload\n\n');
  });

  process.on('SIGINT', () => { console.log('\nmd: stopped'); process.exit(0); });
}

// ---------- main ----------

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) { console.log(HELP); return; }
  let watchMode = false;
  let theme = null;
  let raw = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--watch' || arg === '-w') watchMode = true;
    else if (arg === '--raw') raw = true;
    else if (arg === '--theme') theme = argv[++i];
    else if (arg.startsWith('--theme=')) theme = arg.slice('--theme='.length);
    else if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    else args.push(arg);
  }
  if (theme !== null && !THEMES.includes(theme)) fail(`--theme must be one of: ${THEMES.join(', ')}`);
  if (args.length === 0) fail('no file given');
  if (args.length > 1) fail(`expected one file, got ${args.length}`);

  const file = path.resolve(args[0]);
  if (!fs.existsSync(file)) fail(`file not found: ${args[0]}`);
  if (!fs.statSync(file).isFile()) fail(`not a file: ${args[0]}`);

  ensureAssets();
  if (watchMode) return watch(file, theme, raw);
  const out = renderStatic(file, theme, raw);
  openInBrowser(out);
  console.log(`md: ${out}`);
}

main(process.argv.slice(2));

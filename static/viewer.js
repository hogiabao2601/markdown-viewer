(function () {
  'use strict';

  // ----- copy buttons on code blocks -----
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  // ----- raw view: one button copies the whole Markdown source -----
  var copyRaw = document.getElementById('copy-raw');
  var rawCode = document.querySelector('#raw-view code');
  if (copyRaw && rawCode) {
    var copyRawLabel = copyRaw.innerHTML;
    copyRaw.addEventListener('click', function () {
      copyText(rawCode.textContent).then(function () {
        copyRaw.innerHTML = '✓ <span>Copied</span>';
        copyRaw.classList.add('done');
        setTimeout(function () { copyRaw.innerHTML = copyRawLabel; copyRaw.classList.remove('done'); }, 1500);
      });
    });
  }

  // Per-block copy buttons on the rendered page only (the raw view has "Copy all").
  document.querySelectorAll('#rendered-view pre:not(.mermaid)').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      copyText((code || pre).innerText).then(function () {
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1500);
      });
    });
    pre.appendChild(btn);
  });

  // ----- TOC: toggle on narrow windows -----
  var body = document.body;
  var toggle = document.getElementById('toc-toggle');
  if (toggle) toggle.addEventListener('click', function () { body.classList.toggle('toc-open'); });
  document.querySelectorAll('#toc a').forEach(function (a) {
    a.addEventListener('click', function () { body.classList.remove('toc-open'); });
  });

  // ----- TOC: highlight the current section -----
  var links = {};
  document.querySelectorAll('#toc a').forEach(function (a) {
    links[decodeURIComponent(a.getAttribute('href').slice(1))] = a;
  });
  var headings = Array.prototype.filter.call(
    document.querySelectorAll('.markdown-body h1[id], .markdown-body h2[id], .markdown-body h3[id]'),
    function (h) { return links[h.id]; }
  );
  var active = null;
  function updateActive() {
    var current = headings[0];
    for (var i = 0; i < headings.length; i++) {
      if (headings[i].getBoundingClientRect().top <= 80) current = headings[i];
      else break;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = headings[headings.length - 1];
    }
    var link = current && links[current.id];
    if (link === active) return;
    if (active) active.classList.remove('active');
    if (link) {
      link.classList.add('active');
      var r = link.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) link.scrollIntoView({ block: 'nearest' });
    }
    active = link;
  }
  if (headings.length) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; updateActive(); });
    }, { passive: true });
    updateActive();
  }

  // ----- mermaid -----
  if (window.mermaid) {
    var diagrams = document.querySelectorAll('pre.mermaid');
    diagrams.forEach(function (d) { d.setAttribute('data-src', d.textContent); });

    // Re-runs on every theme change: restore each diagram's source, then let Mermaid redraw it.
    var renderMermaid = function () {
      var dark = window.mdIsDark ? window.mdIsDark() : window.matchMedia('(prefers-color-scheme: dark)').matches;
      diagrams.forEach(function (d) {
        d.removeAttribute('data-processed');
        d.textContent = d.getAttribute('data-src');
      });
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
      window.mermaid.run({ querySelector: 'pre.mermaid' });
    };
    renderMermaid();
    document.addEventListener('md:themechange', renderMermaid);
    // Diagrams drawn while the rendered view was hidden (page opened in Raw) get bad sizes; redraw.
    document.addEventListener('md:viewchange', function (e) {
      if (e.detail && e.detail.view === 'rendered') renderMermaid();
    });
  }
})();

// Color theme: light, dark, or system (follow macOS).
// Loaded in <head> so the page never paints in the wrong theme.
(function () {
  'use strict';

  var KEY = 'md-viewer-theme';
  var MODES = ['light', 'dark', 'system'];
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function read(store) {
    try { return window[store].getItem(KEY); } catch (e) { return null; }
  }
  function write(store, value) {
    try { window[store].setItem(KEY, value); } catch (e) { /* storage blocked: the choice lasts until reload */ }
  }
  function valid(mode) {
    return MODES.indexOf(mode) !== -1 ? mode : null;
  }

  // Precedence: a choice clicked in this tab (survives --watch reloads), then the --theme flag,
  // then the last choice saved in any tab, then the OS setting.
  var mode = valid(read('sessionStorage'))
    || valid(root.getAttribute('data-theme-flag'))
    || valid(read('localStorage'))
    || 'system';

  function syncButtons() {
    var buttons = document.querySelectorAll('#theme-switch button[data-mode]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-checked', String(buttons[i].getAttribute('data-mode') === mode));
    }
  }

  function apply(next, notify) {
    mode = next;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    syncButtons();
    if (notify) document.dispatchEvent(new CustomEvent('md:themechange'));
  }

  // Used by viewer.js to pick the Mermaid theme.
  window.mdIsDark = function () {
    return mode === 'dark' || (mode === 'system' && media.matches);
  };

  apply(mode, false);

  media.addEventListener('change', function () {
    if (mode === 'system') apply('system', true);
  });

  // ----- view: rendered page or raw Markdown source -----
  // Kept per tab only (sessionStorage), so it survives --watch reloads.
  // Precedence: a choice clicked in this tab, then the --raw flag, then rendered.
  var VIEW_KEY = 'md-viewer-view';
  var stored = null;
  try { stored = window.sessionStorage.getItem(VIEW_KEY); } catch (e) { /* storage blocked */ }
  var view = (stored === 'raw' || stored === 'rendered') ? stored
    : (root.getAttribute('data-view-flag') === 'raw' ? 'raw' : 'rendered');

  function applyView(next) {
    view = next;
    if (view === 'raw') root.setAttribute('data-view', 'raw');
    else root.removeAttribute('data-view');
    var buttons = document.querySelectorAll('#view-switch button[data-view]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-checked', String(buttons[i].getAttribute('data-view') === view));
    }
  }

  applyView(view);

  document.addEventListener('DOMContentLoaded', function () {
    syncButtons();
    applyView(view);

    var vs = document.getElementById('view-switch');
    if (vs) vs.addEventListener('click', function (e) {
      var button = e.target.closest('button[data-view]');
      if (!button) return;
      var next = button.getAttribute('data-view');
      try { window.sessionStorage.setItem(VIEW_KEY, next); } catch (err) { /* lasts until reload */ }
      applyView(next);
      window.scrollTo(0, 0);
      document.dispatchEvent(new CustomEvent('md:viewchange', { detail: { view: next } }));
    });

    var sw = document.getElementById('theme-switch');
    if (!sw) return;
    sw.addEventListener('click', function (e) {
      var button = e.target.closest('button[data-mode]');
      if (!button) return;
      var next = button.getAttribute('data-mode');
      write('sessionStorage', next);
      write('localStorage', next);
      apply(next, true);
    });
  });
})();

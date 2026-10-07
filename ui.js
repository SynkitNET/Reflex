(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReflexUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  let themeRuntime = null, accentColor = '#e6e6e6', accentStyle = 'minimal', tintIcons = false;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(name) {
    const img = el('img', 'icon');
    const key = typeof name === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(name) ? name : 'command';
    img.setAttribute('data-reflex-icon', key);
    img.src = themeRuntime ? themeRuntime.asset(key, accentColor, accentStyle, tintIcons) : 'assets/' + key + '.svg'; img.alt = '';
    img.setAttribute('width', '16'); img.setAttribute('height', '16');
    return img;
  }
  function button(label, iconName, callback, className) {

    const node = el('div', 'control ' + (className || 'button'));
    node.tabIndex = 0; node.title = label; node.setAttribute('aria-label', label); node.setAttribute('role', 'button');
    if (iconName) node.appendChild(icon(iconName));
    if (label && className !== 'icon-button') node.appendChild(el('span', '', label));
    node.addEventListener('click', callback);
    node.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.repeat || event.target !== node) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); callback(event);
      }
    });
    return node;
  }
  function wheelLabel(title) {
    return ({ 'Convert to Smart Object': 'Smart Object', 'Duplicate layer': 'Duplicate',
      'Add layer mask': 'Layer mask', 'Toggle layer visibility': 'Visibility', 'Toggle layer lock': 'Layer lock',
      'Group selected layers': 'Group layers', 'Merge selected layers': 'Merge layers',
      'Create clipping mask': 'Clip layer', 'Release clipping mask': 'Unclip layer',
      'Rectangular marquee': 'Marquee', 'Spot healing brush': 'Spot healing' })[title] || title;
  }
  function createController(options) {
    const { core, catalog, host, storage } = options;
    let state = core.cleanState(options.state), index = core.prepare(catalog), context = {}, status = '', errorStatus = false, quietStatus = false, indexWarning = '';
    themeRuntime = options.theme || null; accentColor = state.accent;
    function applyTheme() {
      accentColor = state.accent; accentStyle = state.accentStyle; tintIcons = state.tintIcons;
      if (!themeRuntime) return;
      const palette = themeRuntime.palette(accentColor, accentStyle);
      if (typeof document !== 'undefined' && document.documentElement?.style?.setProperty) {
        document.documentElement.style.setProperty('--ui-font', themeRuntime.fonts[state.typeface]);
        Object.keys(palette).forEach(key => document.documentElement.style.setProperty('--accent-' + key, palette[key]));
        document.querySelectorAll('img[data-reflex-icon]').forEach(img => { img.src = themeRuntime.asset(img.getAttribute('data-reflex-icon'), accentColor, accentStyle, tintIcons); });
      }
    }
    applyTheme();
    let busy = false, refreshing = null, commandRefreshTimer = null, feedbackTimer = null, panelView, panelResizeObserver, activePage = 'search';
    const views = new Set();
    function emit() { Array.from(views).forEach(view => view.update()); }
    function message(text, error) { clearTimeout(feedbackTimer); feedbackTimer = null; status = text; errorStatus = !!error; quietStatus = false; emit(); }
    function save() { if (options.onChange) options.onChange(); storage.save(state).catch(error => message('Could not save changes: ' + error.message, true)); }
    function itemById(id) { return index.find(item => item.id === id); }
    function currentWheel() { return state.wheels.find(w => w.id === state.activeWheel) || state.wheels[0]; }
    async function refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const snap = await host.snapshot(); context = snap.context;
          index = core.prepare(catalog.concat(snap.items));
          if (options.onChange) options.onChange();
          indexWarning = snap.warning || '';
          emit();
        } catch (error) { message('Could not refresh Photoshop: ' + error.message, true); }
        finally { refreshing = null; }
      })();
      return refreshing;
    }
    async function execute(id, documentId) {
      if (busy) return { ok: false, error: 'Another Reflex command is still running.' };
      const item = itemById(id), reason = core.unavailable(item, context);
      if (reason) { message(reason, true); return { ok: false, error: reason }; }
      busy = true; message('Running ' + item.title + '…', false);
      if (options.onAvailabilityChange) options.onAvailabilityChange();
      let outcome = { ok: true };
      try {
        if (item.operation === 'missingPing') {
          if (!options.showMissingPing) throw new Error('Reload the latest Reflex plugin to use Missing ping.');
          await options.showMissingPing();
        } else await host.run(item, documentId === undefined ? context.documentId : documentId);
        const usageId = item.canonicalId || id;
        state.usage[usageId] = { count: (state.usage[usageId]?.count || 0) + 1, last: Date.now() };
        save(); status = item.title; errorStatus = false;
      } catch (error) {
        const cancelled = core.isCancellation(error), detail = core.errorMessage(error);

        const unspecified = !detail && (item.interactive || item.kind === 'menu' || item.kind === 'action');
        status = cancelled ? 'Action cancelled.' : detail || 'Action not completed.';
        quietStatus = cancelled || unspecified; errorStatus = !quietStatus;
        outcome = { ok: false, error: status, ...(cancelled ? { cancelled: true } : {}) };
        if (quietStatus) feedbackTimer = setTimeout(() => { feedbackTimer = null; quietStatus = false; status = ''; emit(); }, 3000);
      }
      finally {
        busy = false;
        if (options.onAvailabilityChange) options.onAvailabilityChange();

        clearTimeout(commandRefreshTimer);
        commandRefreshTimer = setTimeout(() => { commandRefreshTimer = null; refresh(); }, 0);
        emit();
      }
      return outcome;
    }
    function mountSearch(root, settings) {
      const opts = settings || {};
      root.innerHTML = '';
      const shell = el('section', opts.floating ? 'search-view floating' : 'search-view');
      const searchHeader = el('div', 'search-header');
      if (opts.floating) {
        const bar = el('div', 'palette-bar'), brand = el('div', 'palette-brand');
        brand.appendChild(icon('reflex')); brand.appendChild(el('span', '', 'Reflex'));
        bar.appendChild(brand); bar.appendChild(el('span', 'palette-scope', 'Photoshop'));
        if (opts.close) bar.appendChild(button('Close search', 'close', () => opts.close(null), 'icon-button'));
        searchHeader.appendChild(bar);
        shell.addEventListener('keydown', event => {
          if (event.key === 'Escape' && !event.isComposing && opts.close) { event.preventDefault(); event.stopPropagation(); opts.close(null); }
        });
      }
      const field = el('div', 'search-field'); field.appendChild(icon('search'));

      const input = el('input', 'query');
      input.type = 'text'; input.setAttribute('type', 'text'); input.value = '';
      input.placeholder = opts.assign ? 'Find a Photoshop command, tool or action' : 'Search Photoshop';
      input.setAttribute('placeholder', input.placeholder);
      input.addEventListener('focus', () => searchHeader.classList.add('focused'));
      input.addEventListener('blur', () => searchHeader.classList.remove('focused'));
      input.setAttribute('aria-label', input.placeholder); input.setAttribute('autocomplete', 'off');
      input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'true');
      const unique = 'results-' + Math.random().toString(36).slice(2);
      input.setAttribute('aria-controls', unique);
      field.appendChild(input);
      const clearSearch = button('Clear search', 'close', () => { input.value = ''; selected = 0; limit = 80; render(); input.focus(); }, 'icon-button');
      field.appendChild(clearSearch);
      searchHeader.appendChild(field);
      const filters = el('div', 'filters');
      let category = 'All', onlyFavorites = false, selected = 0, results = [], limit = 80, hasMore = false;
      let renderedRows = null, favoriteNodes = [];
      const filterButtons = [];
      (opts.assign ? ['All', 'Commands', 'Menus', 'Tools', 'Actions'] : ['All', 'Commands', 'Menus', 'Tools', 'Layers', 'Actions', 'Documents']).forEach(name => {
        const b = button(name, null, () => { category = name; selected = 0; limit = 80; render(); input.focus(); }, 'filter'); filters.appendChild(b); filterButtons.push([name, b]);
      });
      searchHeader.appendChild(filters); shell.appendChild(searchHeader);
      const caption = el('div', 'list-caption'); const captionText = el('span'); caption.appendChild(captionText);
      const starToggle = button('Favorites', 'star', () => { onlyFavorites = !onlyFavorites; selected = 0; limit = 80; render(); }, 'favorites-toggle');
      starToggle.setAttribute('aria-pressed', 'false'); caption.appendChild(starToggle); shell.appendChild(caption);
      const list = el('div', 'results'); list.id = unique; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Search results'); shell.appendChild(list);
      const footer = el('div', 'search-footer');
      const hints = el('div', 'hints');
      footer.appendChild(hints);
      const feedback = el('span', 'command-notice'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
      footer.appendChild(feedback);
      if (opts.close) footer.appendChild(button('Esc', null, () => opts.close(null), 'text-button'));
      shell.appendChild(footer); root.appendChild(shell);
      const note = el('div', 'status'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); root.appendChild(note);
      function activate(item) {
        if (busy) return;
        if (core.blockedReason(item)) return;
        if (opts.assign) { opts.assign(item.id); return; }
        const reason = core.unavailable(item, context);
        if (reason) { message(reason, true); return; }
        if (opts.close) opts.close({ id: item.id, documentId: context.documentId });
        else execute(item.id, context.documentId);
      }
      function selection(scroll) {
        const nodes = list.querySelectorAll('.result');
        nodes.forEach((node, i) => { node.classList.toggle('selected', i === selected); node.setAttribute('aria-selected', String(i === selected)); });
        if (nodes[selected]) {
          input.setAttribute('aria-activedescendant', nodes[selected].id);
          if (scroll) {
            const row = nodes[selected];
            if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
            else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
          }
        } else input.removeAttribute('aria-activedescendant');
      }
      function render() {
        const previousId = results[selected]?.id;
        const searchable = opts.assign ? index.filter(item => ['command', 'action', 'menu'].includes(item.kind) && !core.blockedReason(item)) : index;
        results = core.search(searchable, input.value, { category, onlyFavorites, favorites: state.favorites, usage: state.usage, limit: limit + 1 });
        hasMore = results.length > limit; results = results.slice(0, limit);
        const retained = results.findIndex(item => item.id === previousId);
        selected = Math.max(0, Math.min(retained >= 0 ? retained : selected, results.length - 1));
        filterButtons.forEach(([name, b]) => { b.classList.toggle('active', category === name); b.setAttribute('aria-pressed', String(category === name)); });
        starToggle.classList.toggle('active', onlyFavorites); starToggle.setAttribute('aria-pressed', String(onlyFavorites));
        captionText.textContent = input.value || category !== 'All' ? results.length + (hasMore ? '+' : '') + (results.length === 1 ? ' result' : ' results') : onlyFavorites ? 'Your favorites' : 'Quick access';
        clearSearch.style.visibility = input.value ? 'visible' : 'hidden';
        const rows = results.map(item => {
          const reason = opts.assign ? '' : core.unavailable(item, context);
          const detail = reason || (item.kind === 'command' && !opts.floating ? '' : item.subtitle);
          return { item, reason, detail, favorite: [item.id, ...(item.aliasIds || [])].some(id => state.favorites.includes(id)) };
        });
        const rowsKey = JSON.stringify([onlyFavorites, hasMore, rows.map(({ item, reason, detail, favorite }) => [item.id, item.icon, item.title, item.category, reason, detail, favorite])]);

        if (rowsKey !== renderedRows) {
          const focusedIndex = favoriteNodes.findIndex(entry => entry.node === document.activeElement);
          const focusedId = favoriteNodes[focusedIndex]?.id;
          favoriteNodes = [];
          list.innerHTML = '';
          if (!results.length) {
            list.appendChild(el('div', 'empty', onlyFavorites ? 'No matching favorites. Turn off Favorites to search everything.' : 'No matches. Try a shorter name or another category.'));
          }
          rows.forEach(({ item, reason, detail, favorite: isFavorite }, i) => {
            const row = el('div', 'result' + (reason ? ' unavailable' : '')); row.id = unique + '-' + i; row.setAttribute('role', 'option');
            row.title = item.title + (detail ? ' · ' + detail : '');
            row.setAttribute('aria-disabled', String(!!reason));
            const badge = el('div', 'result-icon'); badge.appendChild(icon(item.icon)); row.appendChild(badge);
            const text = el('div', 'result-text'); text.appendChild(el('span', 'result-title', item.title));
            if (detail) text.appendChild(el('span', 'result-subtitle', detail));
            row.appendChild(text);
            if (opts.floating || item.interactive) row.appendChild(el('span', 'result-category', item.interactive ? 'Dialog' : item.category));
            const run = el('div', 'result-run'); run.appendChild(icon('enter')); row.appendChild(run);
            if (!opts.assign) {
              const favorite = button(isFavorite ? 'Remove favorite' : 'Add favorite', 'star', event => {
                event.stopPropagation();
                const ids = [item.id, ...(item.aliasIds || [])];
                state.favorites = isFavorite ? state.favorites.filter(id => !ids.includes(id)) : state.favorites.concat(item.id);
                save(); emit();
              }, 'icon-button');
              favorite.classList.toggle('is-favorite', isFavorite); row.appendChild(favorite);
              favoriteNodes.push({ id: item.id, node: favorite });
            }
            row.addEventListener('mouseenter', () => { selected = i; selection(false); });
            row.addEventListener('click', () => activate(item));
            list.appendChild(row);
          });
          if (hasMore) list.appendChild(button('Show more results', null, () => { limit += 80; render(); input.focus(); }, 'more-results'));
          renderedRows = rowsKey;
          if (focusedIndex >= 0) {
            const retainedFocus = favoriteNodes.find(entry => entry.id === focusedId) || favoriteNodes[Math.min(focusedIndex, favoriteNodes.length - 1)];
            (retainedFocus ? retainedFocus.node : input).focus();
          }
        }
        selection(false);
        const notice = (errorStatus || busy) && status ? status : indexWarning;
        note.textContent = notice; note.classList.toggle('error', errorStatus); note.classList.toggle('busy', busy); note.style.display = notice && !opts.assign ? 'block' : 'none';
        feedback.textContent = quietStatus && !opts.assign ? status : '';
        feedback.style.display = quietStatus && !opts.assign ? 'block' : 'none';
        hints.style.display = quietStatus && !opts.assign ? 'none' : 'flex';
        hints.innerHTML = '';
        if (busy) hints.appendChild(el('span', '', 'Photoshop is working…'));
        else {
          hints.appendChild(icon('arrow-up-down')); hints.appendChild(el('span', '', 'Navigate'));
          hints.appendChild(icon('enter')); hints.appendChild(el('span', '', opts.assign ? 'Assign' : 'Run'));
        }
      }
      input.addEventListener('input', () => { results = []; selected = 0; limit = 80; list.scrollTop = 0; render(); });
      input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (event.key === 'ArrowDown' && selected === results.length - 1 && hasMore) { limit += 80; render(); }
          selected = Math.max(0, Math.min(results.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); selection(true);
        }
        else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (results[selected]) activate(results[selected]); }
        else if (event.key === 'Escape' && !event.isComposing) {
          if (opts.floating && opts.close) { event.preventDefault(); event.stopPropagation(); opts.close(null); }
          else if (input.value) { event.preventDefault(); event.stopPropagation(); input.value = ''; results = []; limit = 80; render(); }
          else if (opts.close) opts.close(null);
        }
      });
      const view = { update: render, focus: () => input.focus(), dispose: () => views.delete(view) }; views.add(view); render(); return view;
    }
    function wheelStage(wheel, editing, onChoose) {
      const stage = el('div', 'wheel-stage'); const size = wheel.size;
      const background = el('img', 'wheel-bg'); background.src = 'assets/wheel-' + size + '.svg'; background.alt = ''; stage.appendChild(background);
      const highlight = el('img', 'wheel-highlight'); highlight.alt = ''; highlight.style.display = 'none'; stage.appendChild(highlight);
      const center = button('', 'reflex', () => onChoose(-1), 'wheel-center'); center.setAttribute('aria-label', editing ? 'Choose slot' : 'Cancel'); stage.appendChild(center);
      const centerLabel = el('div', 'wheel-caption', editing ? 'Select a slot to edit' : 'Choose an action');
      const slots = [];
      for (let i = 0; i < size; i++) {
        const item = itemById(wheel.slots[i]), angle = i * Math.PI * 2 / size - Math.PI / 2;
        const b = button(wheelLabel(item?.title) || (wheel.slots[i] ? 'Unavailable' : 'Empty slot'), item?.icon || 'plus', () => onChoose(i), 'wheel-slot');
        b.title = item?.title || 'Empty slot';
        b.style.left = (140 + Math.cos(angle) * 96 - 38) + 'px'; b.style.top = (140 + Math.sin(angle) * 96 - 25) + 'px';
        b.setAttribute('aria-label', 'Slot ' + (i + 1) + ': ' + (item?.title || 'Empty'));
        b.addEventListener('mouseenter', () => hover(i)); stage.appendChild(b); slots.push(b);
      }
      function hover(i) {
        slots.forEach((b, n) => b.classList.toggle('active', i === n));
        highlight.style.display = i < 0 ? 'none' : 'block';
        if (i >= 0) highlight.src = themeRuntime ? themeRuntime.asset('wheel-' + size + '-' + i, accentColor, accentStyle, tintIcons) : 'assets/wheel-' + size + '-' + i + '.svg';
        const item = itemById(wheel.slots[i]);
        centerLabel.textContent = i < 0 ? (editing ? 'Select a slot to edit' : 'Choose an action') : item?.title || 'Empty slot';
      }
      const track = event => {
          const rect = stage.getBoundingClientRect();
          return core.wheelIndex((event.clientX - rect.left) * 340 / rect.width - 170, (event.clientY - rect.top) * 340 / rect.height - 170, size, 56);
      };
      stage.addEventListener('click', event => {
        if (event.target !== stage && event.target !== background && event.target !== highlight) return;
        const i = track(event); if (i >= 0) onChoose(i);
      });
      let dispose = () => {};
      if (!editing) {
        let pressed = false, hoverIndex = -1;
        stage.addEventListener('mousemove', event => { hoverIndex = track(event); hover(hoverIndex); });

        center.addEventListener('mousedown', event => { if (event.button === 0) { pressed = true; event.preventDefault(); } });
        const move = event => { if (pressed) { hoverIndex = track(event); hover(hoverIndex); } };
        const release = event => {
          if (!pressed || event.button !== 0) return;
          pressed = false; event.preventDefault(); event.stopPropagation(); onChoose(track(event));
        };
        stage.addEventListener('mouseleave', () => { if (!pressed) { hoverIndex = -1; hover(-1); } });
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', release);
        dispose = () => { pressed = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', release); };
      }
      return { element: stage, caption: centerLabel, hover, dispose };
    }
    function mountWheel(root, opts) {
      root.innerHTML = '';
      const shell = el('section', 'wheel-dialog-content'); const wheel = currentWheel();
      const header = el('div', 'wheel-dialog-header'); header.appendChild(el('h2', '', wheel.name)); header.appendChild(button('Close wheel', 'close', () => opts.close(null), 'icon-button')); shell.appendChild(header);
      const feedback = el('div', 'status'); feedback.setAttribute('role', 'status');
      let closing = false;
      function choose(i) {
        if (closing) return;
        if (i < 0) { closing = true; opts.close(null); return; }
        const item = itemById(wheel.slots[i]);
        const reason = core.unavailable(item, context);
        if (reason) { feedback.textContent = reason; feedback.classList.add('error'); return; }
        closing = true; opts.close({ id: item.id, documentId: context.documentId });
      }
      const stage = wheelStage(wheel, false, choose); shell.appendChild(stage.element); shell.appendChild(stage.caption);
      shell.appendChild(el('p', 'wheel-help', 'Drag in a direction, even past the ring. Return to center or press Esc to cancel.')); shell.appendChild(feedback); root.appendChild(shell);
      const key = event => { if (event.key === 'Escape') choose(-1); else if (/^[1-8]$/.test(event.key) && Number(event.key) <= wheel.size) choose(Number(event.key) - 1); };
      root.addEventListener('keydown', key); shell.tabIndex = 0;
      return { update() {}, focus: () => shell.focus(), dispose: () => { stage.dispose(); root.removeEventListener('keydown', key); } };
    }
    function mountBuilder(root) {
      root.innerHTML = '';
      let slot = null, assignmentView = null;
      const shell = el('section', 'builder'); root.appendChild(shell);
      function render(focusSlot) {
        if (assignmentView) { assignmentView.dispose(); assignmentView = null; }
        shell.innerHTML = ''; const wheel = currentWheel();
        if (slot != null) {
          const editingSlot = slot;
          const heading = el('div', 'assignment-heading');
          heading.appendChild(button('Back', null, () => { slot = null; render(editingSlot); }, 'text-button'));
          heading.appendChild(el('span', '', 'Slot ' + (editingSlot + 1)));
          heading.appendChild(button('Clear slot', 'close', () => { wheel.slots[editingSlot] = null; slot = null; save(); render(editingSlot); }, 'icon-button'));
          shell.appendChild(heading);
          const assignRoot = el('div', 'assignment-search'); shell.appendChild(assignRoot);
          assignmentView = mountSearch(assignRoot, { assign: id => { wheel.slots[editingSlot] = id; slot = null; save(); render(editingSlot); } });
          assignmentView.focus(); return;
        }
        const toolbar = el('div', 'wheel-toolbar');
        const nameGroup = el('div', 'wheel-name-group');
        const name = el('input', 'wheel-name'); name.type = 'text'; name.value = wheel.name; name.maxLength = 40; name.setAttribute('aria-label', 'Wheel name'); name.title = 'Rename wheel';
        name.addEventListener('focus', () => nameGroup.classList.add('focused'));
        name.addEventListener('blur', () => nameGroup.classList.remove('focused'));
        name.addEventListener('change', () => {
          wheel.name = name.value.trim() || 'My wheel'; name.value = wheel.name;
          const active = menu.querySelector('.active');
          if (active) { active.textContent = wheel.name; active.title = wheel.name; active.setAttribute('aria-label', wheel.name); }
          save();
        }); nameGroup.appendChild(name);
        const menu = el('div', 'wheel-menu'); menu.style.display = 'none';
        const chooser = button('Choose wheel', 'chevron-down', () => {
          const open = menu.style.display === 'none'; menu.style.display = open ? 'block' : 'none'; chooser.setAttribute('aria-expanded', String(open));
          if (open) { const first = menu.querySelector('.active') || menu.firstChild; if (first) first.focus(); }
        }, 'icon-button'); chooser.setAttribute('aria-expanded', 'false');
        state.wheels.forEach(w => menu.appendChild(button(w.name, null, () => { state.activeWheel = w.id; save(); render(); }, 'wheel-menu-item' + (w.id === wheel.id ? ' active' : ''))));
        menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); menu.style.display = 'none'; chooser.setAttribute('aria-expanded', 'false'); chooser.focus(); } });
        nameGroup.appendChild(chooser); toolbar.appendChild(nameGroup);
        toolbar.appendChild(button('New wheel', 'plus', () => {
          if (state.wheels.length >= 24) { message('You can save up to 24 wheels.', true); return; }
          const w = { id: 'wheel-' + Date.now(), name: 'My wheel ' + (state.wheels.length + 1), size: 8, slots: Array(8).fill(null) };
          state.wheels.push(w); state.activeWheel = w.id; save(); render();
        }, 'icon-button'));
        toolbar.appendChild(menu); shell.appendChild(toolbar);
        const wheelOptions = el('div', 'wheel-options'), sizes = el('div', 'size-controls'); sizes.appendChild(el('span', '', 'Directions'));
        [4, 8].forEach(n => {
          const sizeButton = button(String(n), null, () => { wheel.size = n; save(); render(); }, 'size-button' + (wheel.size === n ? ' active' : ''));
          sizeButton.setAttribute('aria-label', n + ' directions'); sizeButton.setAttribute('aria-pressed', String(wheel.size === n)); sizes.appendChild(sizeButton);
        });
        wheelOptions.appendChild(sizes); wheelOptions.appendChild(button(options.nativeMode ? 'Open wheel' : 'Preview wheel', 'play', options.previewWheel || options.showWheel, 'button')); shell.appendChild(wheelOptions);
        const grid = el('div', 'slots-grid');
        for (let i = 0; i < wheel.size; i++) {
          const assigned = itemById(wheel.slots[i]), title = assigned?.title || (wheel.slots[i] ? 'Unavailable action' : 'Assign action');
          const card = button('', null, () => { slot = i; render(); }, 'slot-card' + (!assigned ? ' empty-slot' : ''));
          card.setAttribute('aria-label', 'Slot ' + (i + 1) + ': ' + title);
          const top = el('div', 'slot-top'); top.appendChild(icon(assigned?.icon || 'plus')); top.appendChild(el('span', 'slot-number', ['Up', 'Upper right', 'Right', 'Lower right', 'Down', 'Lower left', 'Left', 'Upper left'][wheel.size === 4 ? i * 2 : i]));
          card.appendChild(top); card.appendChild(el('span', 'slot-title', title)); grid.appendChild(card);
        }
        shell.appendChild(grid);
        const bottom = el('div', 'builder-bottom');
        if (state.wheels.length > 1) bottom.appendChild(button('Delete this wheel', null, () => {
          state.wheels = state.wheels.filter(w => w.id !== wheel.id); state.activeWheel = state.wheels[0].id; save(); render();
        }, 'text-button'));
        bottom.appendChild(el('span', 'muted', 'Changes save automatically')); shell.appendChild(bottom);
        if (Number.isInteger(focusSlot) && grid.children[focusSlot]) grid.children[focusSlot].focus();
      }
      render();
      const view = { update() {}, dispose() { if (assignmentView) assignmentView.dispose(); views.delete(view); } }; views.add(view); return view;
    }
    function mountSettings(root) {
      root.innerHTML = '';
      const shell = el('section', 'appearance-settings'); root.appendChild(shell);
      shell.appendChild(el('div', 'settings-eyebrow', 'MAKE IT YOURS'));
      shell.appendChild(el('h2', 'appearance-title', 'Appearance'));
      shell.appendChild(el('p', 'settings-intro', 'A quiet workspace. As much color as you want.'));
      const preview = el('div', 'appearance-preview');
      const previewTop = el('div', 'appearance-preview-top'); previewTop.appendChild(icon('reflex'));
      previewTop.appendChild(el('span', '', 'Reflex')); previewTop.appendChild(el('span', 'preview-label', 'LIVE PREVIEW')); preview.appendChild(previewTop);
      const demo = el('div', 'accent-demo'), demoIcon = el('div', 'result-icon'); demoIcon.appendChild(icon('layer-new')); demo.appendChild(demoIcon);
      const demoText = el('div', 'result-text'); demoText.appendChild(el('span', 'result-title', 'New layer')); demoText.appendChild(el('span', 'result-subtitle', 'Layers'));
      demo.appendChild(demoText); demo.appendChild(icon('enter')); preview.appendChild(demo); shell.appendChild(preview);
      shell.appendChild(el('div', 'appearance-label', 'Accent color'));
      const presets = [['Mono', '#e6e6e6'], ['Pink', '#f28fc8'], ['Ice', '#82cfff'], ['Mint', '#7de1bd'], ['Lime', '#d4ed71'], ['Amber', '#e9bb6c'], ['Coral', '#f48c7b'], ['Violet', '#b5abfa']];
      const swatches = el('div', 'accent-swatches'); swatches.setAttribute('role', 'group'); swatches.setAttribute('aria-label', 'Accent presets');
      const choices = [];
      function commit(value) {
        const clean = core.cleanAccent(value);
        if (!clean) { feedback.textContent = 'Enter a hex color, like #82CFFF.'; input.setAttribute('aria-invalid', 'true'); return; }
        state.accent = clean; input.value = clean.toUpperCase(); feedback.textContent = ''; input.setAttribute('aria-invalid', 'false');
        applyTheme(); save(); emit();
      }
      presets.forEach(([label, color]) => {
        const swatch = button('', null, () => commit(color), 'accent-swatch'); swatch.setAttribute('aria-label', label); swatch.title = label;
        const chip = el('span', 'accent-chip'); chip.style.backgroundColor = color; swatch.appendChild(chip); swatch.appendChild(el('span', 'swatch-name', label));
        choices.push([color, swatch]); swatches.appendChild(swatch);
      });
      shell.appendChild(swatches);
      shell.appendChild(el('div', 'appearance-label', 'Custom color'));
      const custom = el('div', 'accent-custom'), input = el('input', 'accent-hex');
      input.type = 'text'; input.value = state.accent.toUpperCase(); input.maxLength = 7; input.setAttribute('aria-label', 'Custom accent hex'); input.setAttribute('spellcheck', 'false');
      const sample = el('span', 'accent-sample'); sample.setAttribute('aria-hidden', 'true');
      const inputGroup = el('div', 'accent-input-group'); inputGroup.appendChild(sample); inputGroup.appendChild(input); custom.appendChild(inputGroup);
      custom.appendChild(button('Apply', null, () => commit(input.value), 'button primary')); shell.appendChild(custom);
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(input.value); } });
      const feedback = el('p', 'accent-feedback'); feedback.setAttribute('role', 'status'); shell.appendChild(feedback);
      shell.appendChild(el('div', 'appearance-label', 'Accent coverage'));
      const styles = el('div', 'accent-styles'), styleChoices = [];
      styles.setAttribute('role', 'group'); styles.setAttribute('aria-label', 'Accent coverage');
      [['minimal', 'Minimal'], ['soft', 'Soft'], ['bold', 'Bold']].forEach(([value, label]) => {
        const choice = button(label, null, () => { state.accentStyle = value; applyTheme(); save(); emit(); }, 'accent-style');
        styles.appendChild(choice); styleChoices.push([value, choice]);
      });
      shell.appendChild(styles);
      const coverageHint = el('p', 'appearance-note'); shell.appendChild(coverageHint);
      const iconRow = el('div', 'appearance-option'), iconCopy = el('div', 'appearance-option-copy');
      iconCopy.appendChild(el('span', 'appearance-label', 'Tint icons')); iconCopy.appendChild(el('span', 'appearance-note', 'Carry the accent into command icons.'));
      iconRow.appendChild(iconCopy);
      const tintToggle = button('', null, () => { state.tintIcons = !state.tintIcons; applyTheme(); save(); emit(); }, 'appearance-toggle');
      tintToggle.setAttribute('role', 'switch'); tintToggle.setAttribute('aria-label', 'Tint icons'); tintToggle.appendChild(el('span', 'toggle-mark'));
      iconRow.appendChild(tintToggle); shell.appendChild(iconRow);
      shell.appendChild(el('div', 'appearance-label', 'Typeface'));
      const fontChoices = [], fonts = el('div', 'accent-styles'); fonts.setAttribute('role', 'group'); fonts.setAttribute('aria-label', 'Typeface');
      [['neutral', 'Arial'], ['humanist', 'Trebuchet'], ['clear', 'Verdana']].forEach(([value, label]) => {
        const choice = button(label, null, () => { state.typeface = value; applyTheme(); save(); emit(); }, 'accent-style');
        if (themeRuntime) choice.style.fontFamily = themeRuntime.fonts[value];
        fonts.appendChild(choice); fontChoices.push([value, choice]);
      });
      shell.appendChild(fonts);
      const bottom = el('div', 'appearance-bottom'); bottom.appendChild(el('span', 'appearance-note', 'Saved automatically · Panel & wheel'));
      bottom.appendChild(button('Reset appearance', null, () => {
        const defaults = core.defaults(); state.accentStyle = defaults.accentStyle; state.tintIcons = defaults.tintIcons; state.typeface = defaults.typeface; commit(defaults.accent);
      }, 'text-button')); shell.appendChild(bottom);
      const view = { update() {
        choices.forEach(([color, swatch]) => { swatch.classList.toggle('active', color === state.accent); swatch.setAttribute('aria-pressed', String(color === state.accent)); });
        sample.style.backgroundColor = state.accent;
        styleChoices.forEach(([value, choice]) => { choice.classList.toggle('active', state.accentStyle === value); choice.setAttribute('aria-pressed', String(state.accentStyle === value)); });
        coverageHint.textContent = { minimal: 'Color on fine lines and focus indicators.', soft: 'A light tint on selected rows and wheel sectors.', bold: 'Stronger color on selected rows and wheel sectors.' }[state.accentStyle];
        tintToggle.setAttribute('aria-checked', String(state.tintIcons)); tintToggle.classList.toggle('active', state.tintIcons);
        fontChoices.forEach(([value, choice]) => { choice.classList.toggle('active', state.typeface === value); choice.setAttribute('aria-pressed', String(state.typeface === value)); });
        if (document.activeElement !== input) input.value = state.accent.toUpperCase();
      }, dispose: () => views.delete(view) };
      views.add(view); view.update(); return view;
    }
    function mountShortcuts(root) {
      root.innerHTML = '';
      const api = options.shortcuts;
      const shell = el('section', 'shortcut-settings'); root.appendChild(shell);
      shell.appendChild(el('h2', '', 'Your shortcuts'));
      shell.appendChild(el('p', 'settings-intro', 'Search stays centered. Hold the wheel shortcut, aim, then release.'));
      const buttons = {}, feedback = el('p', 'shortcut-feedback'); feedback.setAttribute('role', 'status');
      let recording = null, pending = null, released = false, preparing = false, ending = false, disposed = false, captureVersion = 0;
      let captureId = null, pollTimer = null, captureTimer = null;
      const capture = el('div', 'shortcut-capture'); capture.tabIndex = -1;
      const captureTitle = el('div', 'shortcut-title'), captureValue = el('div', 'capture-value');
      captureValue.setAttribute('role', 'status');
      capture.appendChild(captureTitle); capture.appendChild(captureValue);
      capture.appendChild(el('p', 'shortcut-hint', options.nativeMode ? 'Add Ctrl, Alt/Option or Shift; Command is also available on Mac. Esc cancels.' : 'Ctrl, Alt and Shift are optional. Esc cancels.'));
      const captureActions = el('div', 'capture-actions');
      const saveBinding = button('Save', null, () => {
        if (pending && released && !preparing && !ending) finish('Saved ' + api.label(pending) + '.', pending);
      }, 'button primary');
      const retryBinding = button('Record again', null, async () => {
        const name = recording;
        if (name && !preparing && !ending && await finish()) begin(name);
      }, 'text-button');
      captureActions.appendChild(saveBinding); captureActions.appendChild(retryBinding);
      captureActions.appendChild(button('Cancel', null, () => finish('Shortcut unchanged.'), 'text-button'));
      capture.appendChild(captureActions);
      async function finish(text, binding) {
        if (ending) return false;
        const name = recording, id = captureId;
        ++captureVersion; ending = true;
        recording = null; pending = null; released = false; preparing = false; captureId = null;
        clearTimeout(pollTimer); clearTimeout(captureTimer);
        if (!disposed) update();
        let succeeded = true;
        try {
          if (binding && name && id) {

            const confirmed = await options.confirmShortcutCapture(id);
            const verified = confirmed?.phase === 'confirmed' ? api.clean(confirmed.binding) : null;
            if (!verified || !api.equal(verified, binding)) throw new Error('Capture ended or changed. Record your shortcut again.');
            binding = verified;
          } else if (options.cancelShortcutCapture) await options.cancelShortcutCapture(id || undefined);
          if (binding && name) { state.shortcuts[name] = binding; save(); }
          if (!disposed && text) feedback.textContent = text;
        } catch (error) { succeeded = false; if (!disposed) feedback.textContent = error.message; }
        finally {
          try { if (options.setShortcutCapture) await options.setShortcutCapture(false); }
          catch (error) { succeeded = false; if (!disposed) feedback.textContent = error.message; }
          ending = false; if (!disposed) update();
        }
        return succeeded;
      }
      function acceptCandidate(binding, isReleased) {
        const cleaned = api.clean(binding), other = recording === 'search' ? 'wheel' : 'search';
        if (!cleaned || api.equal(cleaned, state.shortcuts[other])) {
          pending = null; released = false;
          feedback.textContent = cleaned ? 'Search and wheel need different shortcuts. Record another binding.' : 'That input is not supported.';
        } else { pending = cleaned; released = isReleased; feedback.textContent = ''; }
        update();
      }
      async function pollCapture(attempt) {
        if (disposed || attempt !== captureVersion || !captureId) return;
        try {
          const result = await options.readShortcutCapture(captureId);
          if (disposed || attempt !== captureVersion) return;
          if (result.phase === 'cancelled' || result.phase === 'expired') {
            await finish(result.phase === 'expired' ? 'Capture timed out. Shortcut unchanged.' : 'Shortcut unchanged.'); return;
          }
          if (result.binding) acceptCandidate(result.binding, result.phase === 'ready');
          if (attempt === captureVersion) pollTimer = setTimeout(() => pollCapture(attempt), 100);
        } catch (error) { if (!disposed && attempt === captureVersion) await finish(error.message); }
      }
      async function begin(name) {
        if (preparing || ending || recording || disposed) return;
        const attempt = ++captureVersion;
        preparing = true; recording = name; pending = null; released = false;
        feedback.textContent = ''; update(); capture.focus();
        try {
          if (options.setShortcutCapture) await options.setShortcutCapture(true);
          if (disposed || attempt !== captureVersion) return;
          const result = options.startShortcutCapture ? await options.startShortcutCapture() : null;
          if (disposed || attempt !== captureVersion) return;
          if (result?.phase === 'cancelled' || result?.phase === 'expired') { await finish('Shortcut unchanged.'); return; }
          captureId = result?.id || null; preparing = false; update(); capture.focus();
          captureTimer = setTimeout(() => finish('Capture timed out. Shortcut unchanged.'), 30000);
          if (captureId) pollCapture(attempt);
        } catch (error) { if (attempt === captureVersion && !disposed) await finish(error.message); }
      }
      for (const [name, title, hint] of [['search', 'Search', 'Press to open the centered palette'], ['wheel', 'Quick wheel', 'Hold, aim, release to run']]) {
        const row = el('div', 'shortcut-row'); const text = el('div', 'shortcut-description');
        text.appendChild(el('div', 'shortcut-title', title)); text.appendChild(el('p', 'shortcut-hint', hint)); row.appendChild(text);
        const b = button('', null, () => begin(name), 'shortcut-binding');
        b.setAttribute('aria-label', 'Change ' + name + ' shortcut'); buttons[name] = b; row.appendChild(b); shell.appendChild(row);
      }
      shell.appendChild(capture); shell.appendChild(feedback);
      shell.appendChild(el('p', 'shortcut-note', 'Use a key, middle click or either side button. Your chosen input replaces its usual Photoshop behavior while Reflex is connected.'));
      const connection = el('div', 'helper-connection'); connection.appendChild(el('h2', '', options.nativeMode ? 'Shortcut status' : 'Wheel helper'));
      const connectionStatus = el('p', 'helper-status'); connectionStatus.setAttribute('role', 'status'); connection.appendChild(connectionStatus);
      connection.appendChild(el('p', 'shortcut-hint', options.nativeMode ? 'Shortcuts work while Photoshop is active. Stop the old Reflex companion before using this version.' : 'Start Reflex companion on Windows, then connect its connection.json file once. Find it using the helper’s tray menu.'));
      const actions = el('div', 'helper-actions');
      actions.appendChild(button('Connect helper', null, async () => {
        try { if (options.connectHelper) await options.connectHelper(); else feedback.textContent = 'Helper connection is available inside Photoshop.'; }
        catch (error) { feedback.textContent = error.message; }
        update();
      }, 'button primary'));
      actions.appendChild(button('Disconnect', null, async () => {
        try { if (options.disconnectHelper) await options.disconnectHelper(); }
        catch (error) { feedback.textContent = error.message; }
        update();
      }, 'button'));
      if (!options.nativeMode) connection.appendChild(actions);
      shell.appendChild(connection);
      function update() {
        for (const name of ['search', 'wheel']) {
          buttons[name].textContent = api.label(state.shortcuts[name]);
          buttons[name].setAttribute('aria-disabled', String(!!recording || preparing || ending));
        }
        capture.style.display = recording ? 'block' : 'none';
        captureTitle.textContent = recording === 'search' ? 'Search shortcut' : 'Quick wheel shortcut';
        captureValue.textContent = preparing ? 'Preparing…' : pending ? api.label(pending) + (released ? '' : ' — release to continue') : 'Press a key or mouse button';
        saveBinding.setAttribute('aria-disabled', String(!pending || !released || preparing || ending));
        retryBinding.setAttribute('aria-disabled', String(preparing || ending));
        connectionStatus.textContent = options.helperStatus ? options.helperStatus().status : 'Preview — helper connects inside Photoshop';
      }
      const down = event => {
        if (!recording) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('Shortcut unchanged.'); return; }
        if (event.key === 'Tab') return;
        if (pending && released && (event.key === 'Enter' || event.key === ' ')) {

          if (event.target === capture || event.target === buttons[recording]) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Enter') finish('Saved ' + api.label(pending) + '.', pending);
          }
          return;
        }
        if (captureId || preparing) return;
        event.preventDefault(); event.stopPropagation();
        if (event.repeat || pending || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        const binding = api.fromEvent(event);
        if (!binding) { feedback.textContent = 'Use a letter, number, Space or function key with optional Ctrl, Alt and Shift. F12 is reserved.'; return; }
        acceptCandidate(binding, false);
      };
      const up = event => {
        if (!recording || !pending || captureId || preparing) return;
        const binding = api.fromEvent(event);
        if (!binding || binding.key !== pending.key) return;
        event.preventDefault(); event.stopPropagation();
        released = true; update();
      };
      const mouseDown = event => {
        if (!recording || preparing || captureId || pending) return;
        const binding = api.fromMouseEvent(event);
        if (!binding) return;
        event.preventDefault(); event.stopPropagation(); acceptCandidate(binding, false);
      };
      const mouseUp = event => {
        if (!recording || preparing || captureId || !pending || !api.isMouse(pending.key)) return;
        const binding = api.fromMouseEvent(event);
        if (!binding || binding.key !== pending.key) return;
        event.preventDefault(); event.stopPropagation(); released = true; update();
      };
      const auxClick = event => { if (recording && api.fromMouseEvent(event)) { event.preventDefault(); event.stopPropagation(); } };
      const cancelCapture = () => {
        if (!recording && !preparing) return;
        finish('Shortcut unchanged.');
      };
      const focusOut = event => {
        if (event.relatedTarget && !shell.contains(event.relatedTarget)) cancelCapture();
      };
      shell.addEventListener('keydown', down, true); shell.addEventListener('keyup', up, true);
      shell.addEventListener('mousedown', mouseDown, true); shell.addEventListener('mouseup', mouseUp, true);
      shell.addEventListener('auxclick', auxClick, true);
      shell.addEventListener('focusout', focusOut);
      window.addEventListener('blur', cancelCapture);
      const view = { update, dispose() {
        disposed = true; finish();
        shell.removeEventListener('keydown', down, true); shell.removeEventListener('keyup', up, true);
        shell.removeEventListener('mousedown', mouseDown, true); shell.removeEventListener('mouseup', mouseUp, true);
        shell.removeEventListener('auxclick', auxClick, true);
        shell.removeEventListener('focusout', focusOut); window.removeEventListener('blur', cancelCapture);
        views.delete(view);
      } };
      views.add(view); update(); return view;
    }
    function mountPanel(root) {
      root.innerHTML = '';
      if (panelResizeObserver) panelResizeObserver.disconnect();
      const fitPanel = () => root.classList.toggle('compact', root.clientHeight > 0 && root.clientHeight <= 460);
      fitPanel();
      if (typeof ResizeObserver !== 'undefined') { panelResizeObserver = new ResizeObserver(fitPanel); panelResizeObserver.observe(root); }
      const header = el('header', 'header'); const wordmark = el('div', 'wordmark'); wordmark.appendChild(icon('reflex')); wordmark.appendChild(el('span', '', 'Reflex')); header.appendChild(wordmark);
      const controls = el('div', 'header-controls'); controls.appendChild(button('Refresh Photoshop', 'refresh', refresh, 'icon-button')); controls.appendChild(button('Open search palette', 'search', options.showSearch, 'icon-button'));
      const settingsButton = button('Settings', 'settings', () => show('settings'), 'icon-button'); controls.appendChild(settingsButton); header.appendChild(controls); root.appendChild(header);
      const nav = el('nav', 'nav'); const content = el('div', 'panel-content');
      const searchButton = button('Search', 'search', () => show('search'), 'nav-button');
      const wheelButton = button('Wheels', 'wheel', () => show('wheels'), 'nav-button');
      const shortcutsButton = button('Shortcuts', 'keyboard', () => show('shortcuts'), 'nav-button');
      nav.appendChild(searchButton); nav.appendChild(wheelButton); nav.appendChild(shortcutsButton); root.appendChild(nav); root.appendChild(content);
      const bottom = el('footer', 'panel-footer'); const docLabel = el('span', 'document-name'); bottom.appendChild(docLabel); bottom.appendChild(el('span', 'muted', 'Synkit')); root.appendChild(bottom);
      function show(page) {
        activePage = page;
        if (panelView) panelView.dispose();
        searchButton.classList.toggle('active', page === 'search'); wheelButton.classList.toggle('active', page === 'wheels');
        shortcutsButton.classList.toggle('active', page === 'shortcuts');
        settingsButton.classList.toggle('active', page === 'settings'); settingsButton.setAttribute('aria-pressed', String(page === 'settings'));
        panelView = page === 'search' ? mountSearch(content) : page === 'wheels' ? mountBuilder(content) : page === 'settings' ? mountSettings(content) : mountShortcuts(content);
      }
      views.add({ update() { docLabel.textContent = context.documentName || 'Connecting to Photoshop…'; docLabel.title = docLabel.textContent; } }); show(activePage);
    }
    return { mountPanel, mountSearch, mountWheel, refresh, execute, message, refreshViews: emit, getState: () => state,
      getBridgeSnapshot: () => ({ items: index.map(({ id, title, category, icon, subtitle, requires, kind, enabled }) => ({ id, title, category, icon, subtitle, requires, kind, enabled })), context, state, suspended: busy }) };
  }
  return { createController };
});

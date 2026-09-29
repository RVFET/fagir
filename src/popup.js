const { div, span, button, input, details, summary, code, form, mark, small, strong, img, label } = van.tags;

const routesState = van.state([]);
const faviconProviderState = van.state('disabled');
const faviconCacheState = van.state({});
const activeTabState = van.state(null);
const isProbingState = van.state(false);
const probingRouteState = van.state({});

const openDetails = new Set();
const activeFetches = new Set();

const progressBar = document.getElementById('probe-progress');
const btnProbe = document.getElementById('btn-probe');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const btnReset = document.getElementById('btn-reset');
const fileInput = document.getElementById('file-import');
const formNewRoute = document.getElementById('form-new-route');
const selectFavicon = document.getElementById('select-favicon');

function setProbing(active) {
  isProbingState.val = active;
  document.body.classList.toggle('probing', active);

  btnProbe.disabled = active;
  btnImport.disabled = active;
  btnExport.disabled = active;
  btnReset.disabled = active;
  selectFavicon.disabled = active;

  formNewRoute.querySelectorAll('input, button').forEach((el) => {
    el.disabled = active;
  });

  if (active) {
    progressBar.removeAttribute('hidden');
  } else {
    progressBar.setAttribute('hidden', 'true');
    progressBar.value = 0;
  }
}

const MoveButton = ({ direction }) => {
  const container = span({ class: 'move-button-wrapper' });
  container.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="14" height="14">
      <path d="${direction === 'up' ? 'M480-528 296-344l-56-56 240-240 240 240-56 56-184-184Z' : 'M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z'}"></path>
    </svg>
  `;
  return container;
};

async function updateRoutes(mutator) {
  if (isProbingState.val) return;
  let next = JSON.parse(JSON.stringify(routesState.val));
  const res = mutator(next);
  if (res !== undefined) next = res;
  routesState.val = next;
  await browser.storage.local.set({ routes: next });
  await syncActiveTab(next);
}

function StatusBadge(status, latency) {
  const norm = ['unstable', 'alive', 'dead'].includes(status) ? status : (latency !== 'untested' ? 'alive' : 'untested');
  return mark({ class: norm }, norm);
}

function FaviconIcon(route) {
  return () => {
    const provider = faviconProviderState.val;
    const domain = route.faviconDomain?.trim();
    const fallback = span({ class: 'favicon-letter' }, (route.name?.[0] || '?').toUpperCase());

    if (provider === 'disabled' || !domain) return fallback;

    const cacheKey = `${provider}:${domain}`;
    const cached = faviconCacheState.val[cacheKey];

    if (cached) {
      return cached === 'error' ? fallback : img({ class: 'favicon-img', src: cached, alt: '' });
    }

    if (!activeFetches.has(cacheKey)) {
      activeFetches.add(cacheKey);
      const endpoint = provider === 'vemetric' ? `https://favicon.vemetric.com/${domain}` : `https://favicone.com/${domain}`;
      fetch(endpoint)
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = async () => {
            const next = { ...faviconCacheState.val, [cacheKey]: reader.result };
            faviconCacheState.val = next;
            await browser.storage.local.set({ faviconCache: next });
            activeFetches.delete(cacheKey);
          };
          reader.readAsDataURL(blob);
        })
        .catch(async () => {
          const next = { ...faviconCacheState.val, [cacheKey]: 'error' };
          faviconCacheState.val = next;
          await browser.storage.local.set({ faviconCache: next });
          activeFetches.delete(cacheKey);
        });
    }

    return fallback;
  };
}

function getNextWorkingInstance(instances, currentIdx) {
  if (instances.length <= 1) return instances[0]?.url;
  const start = currentIdx >= 0 ? currentIdx : 0;

  for (let i = 1; i < instances.length; i++) {
    const idx = (start + i) % instances.length;
    if (instances[idx].status === 'alive') return instances[idx].url;
  }
  for (let i = 1; i < instances.length; i++) {
    const idx = (start + i) % instances.length;
    if (instances[idx].status !== 'dead') return instances[idx].url;
  }
  return instances[(start + 1) % instances.length].url;
}

async function switchTab(targetUrl, markUnstable = false) {
  const ctx = activeTabState.val;
  if (!ctx || isProbingState.val) return;

  if (markUnstable && ctx.isInstance) {
    await updateRoutes((r) => {
      const inst = r[ctx.rIdx]?.instances[ctx.instIdx];
      if (inst) inst.status = 'unstable';
    });
  }

  const nextUrl = ctx.isInstance
    ? rewriteInstanceUrl(ctx.tabUrl, targetUrl)
    : resolveRedirect(ctx.tabUrl, ctx.route, targetUrl);

  await browser.tabs.update(ctx.tabId, { url: nextUrl });
  window.close();
}

async function handleProbeRoute(routeName) {
  if (isProbingState.val || probingRouteState.val[routeName]) return;
  probingRouteState.val = { ...probingRouteState.val, [routeName]: true };

  try {
    const updated = await browser.runtime.sendMessage({
      action: 'PROBE_ROUTE',
      routeName,
    });
    if (updated) {
      routesState.val = updated;
      await syncActiveTab(updated);
    }
  } finally {
    probingRouteState.val = { ...probingRouteState.val, [routeName]: false };
  }
}

function InstanceRow(rIdx, iIdx, inst, total, isAutoSorted, isCurrent) {
  return div({ class: `instance-row ${isCurrent ? 'instance-current' : ''}`.trim() },
    div({ class: 'col-order' },
      button({
        type: 'button',
        disabled: () => isProbingState.val || isAutoSorted || iIdx === 0,
        onclick: () => updateRoutes((r) => {
          const list = r[rIdx].instances;
          [list[iIdx], list[iIdx - 1]] = [list[iIdx - 1], list[iIdx]];
        }),
      }, MoveButton({ direction: 'up' })),
      button({
        type: 'button',
        disabled: () => isProbingState.val || isAutoSorted || iIdx === total - 1,
        onclick: () => updateRoutes((r) => {
          const list = r[rIdx].instances;
          [list[iIdx], list[iIdx + 1]] = [list[iIdx + 1], list[iIdx]];
        }),
      }, MoveButton({ direction: 'down' }))
    ),
    div({ class: 'col-url' },
      isCurrent ? span({ class: 'badge-current' }, 'ACTIVE') : null,
      code(inst.url)
    ),
    div({ class: 'col-status' }, StatusBadge(inst.status, inst.latency)),
    div({ class: 'col-latency' }, small(inst.latency ? `${inst.latency}ms` : 'untested')),
    div({ class: 'col-action' },
      button({
        type: 'button',
        class: 'btn-del',
        disabled: () => isProbingState.val,
        onclick: () => updateRoutes((r) => r[rIdx].instances.splice(iIdx, 1)),
      }, '✕')
    )
  );
}

function RouteCard(route, rIdx, isActive, activeInstIdx) {
  const top = route.instances[0];
  const topHostname = top ? new URL(top.url).hostname : 'none';
  const topLatency = top?.latency ? `${top.latency}ms` : 'untested';
  const inputRef = input({
    type: 'url',
    placeholder: 'https://instance...',
    required: true,
    disabled: () => isProbingState.val,
  });
  const isEnabled = route.enabled !== false;
  const isAutoSorted = !!route.autoSort;
  const isOpen = openDetails.has(route.name) || isActive;

  return details({
    class: `${isEnabled ? '' : 'route-disabled'} ${isActive ? 'route-active' : ''}`.trim(),
    open: isOpen,
    ontoggle: (e) => {
      if (e.target.open) openDetails.add(route.name);
      else openDetails.delete(route.name);
    },
  },
    summary(
      div({ class: 'summary-title' },
        input({
          type: 'checkbox',
          class: 'route-toggle',
          checked: isEnabled,
          disabled: () => isProbingState.val,
          onclick: (e) => {
            e.stopPropagation();
            if (isProbingState.val) return;
            updateRoutes((r) => { r[rIdx].enabled = e.target.checked; });
          },
        }),
        FaviconIcon(route),
        strong(route.name.toUpperCase()),
      ),
      small({ class: 'muted' }, `${topHostname}`),
      div(small({ class: 'muted' }, topLatency))
    ),
    div({ class: 'route-toolbar' },
      div({ class: 'route-toolbar-left' },
        button({
          type: 'button',
          class: 'btn-probe-route',
          disabled: () => isProbingState.val || !!probingRouteState.val[route.name],
          onclick: () => handleProbeRoute(route.name),
        },
          () => probingRouteState.val[route.name] ? 'Probing...' : 'Probe service'
        ),
      isActive ? button({
        type: 'button',
        class: 'btn-next-inst',
        disabled: () => isProbingState.val || route.instances.length <= 1,
        onclick: () => {
          if (activeInstIdx !== -1) {
            const nextUrl = getNextWorkingInstance(route.instances, activeInstIdx);
            switchTab(nextUrl, true);
          } else {
            const targetUrl = route.instances[0]?.url;
            if (targetUrl) switchTab(targetUrl, false);
          }
        },
      }, activeInstIdx !== -1 ? 'Next Instance' : 'Redirect') : null,
        label({ class: 'toggle-autosort' },
          input({
            type: 'checkbox',
            checked: isAutoSorted,
            disabled: () => isProbingState.val || !!probingRouteState.val[route.name],
            onchange: (e) => {
              updateRoutes((r) => {
                r[rIdx].autoSort = e.target.checked;
                if (e.target.checked) sortRouteInstances(r[rIdx]);
              });
            },
          }),
          span('Fastest first')
        )
      ),
    ),
    div({ class: 'instance-list' },
      route.instances.map((inst, iIdx) =>
        InstanceRow(rIdx, iIdx, inst, route.instances.length, isAutoSorted, activeInstIdx === iIdx)
      )
    ),
    form({
      class: 'form-add-inst',
      onsubmit: (e) => {
        e.preventDefault();
        if (isProbingState.val) return;
        const url = inputRef.value.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;
        updateRoutes((r) => {
          r[rIdx].instances.push({ url, status: 'untested', latency: null });
          if (r[rIdx].autoSort) sortRouteInstances(r[rIdx]);
        });
        inputRef.value = '';
      },
    },
      inputRef,
      button({ type: 'submit', disabled: () => isProbingState.val }, 'Add')
    ),
    div({ class: 'route-footer' },
      small({ class: 'pattern-tag' }, `Pattern: ${route.pattern}`),
      button({
        type: 'button',
        class: 'btn-del-route',
        disabled: () => isProbingState.val,
        onclick: () => updateRoutes((r) => r.splice(rIdx, 1)),
      }, 'Delete Route')
    )
  );
}

async function syncActiveTab(routes) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.url.startsWith('about:')) {
      activeTabState.val = null;
      return;
    }
    const tabUrl = new URL(tab.url);
    const ctx = findRouteContext(tabUrl, routes);
    activeTabState.val = ctx ? { tabId: tab.id, tabUrl, ...ctx } : null;
  } catch (_) {
    activeTabState.val = null;
  }
}

van.add(document.getElementById('routes-container'), () => {
  const routes = routesState.val;
  const ctx = activeTabState.val;

  const items = routes.map((route, rIdx) => {
    const isActive = ctx ? ctx.rIdx === rIdx : false;
    const activeInstIdx = isActive && ctx.isInstance ? ctx.instIdx : -1;
    return { route, rIdx, isActive, activeInstIdx };
  });

  if (ctx && ctx.rIdx >= 0 && ctx.rIdx < items.length) {
    const [activeItem] = items.splice(ctx.rIdx, 1);
    items.unshift(activeItem);
  }

  return div(items.map(({ route, rIdx, isActive, activeInstIdx }) =>
    RouteCard(route, rIdx, isActive, activeInstIdx)
  ));
});

async function init() {
  const { routes, faviconProvider = 'disabled', faviconCache = {} } =
    await browser.storage.local.get(['routes', 'faviconProvider', 'faviconCache']);

  const loaded = routes || DEFAULT_ROUTES;
  routesState.val = loaded;
  faviconProviderState.val = faviconProvider;
  faviconCacheState.val = faviconCache;
  selectFavicon.value = faviconProvider;

  await syncActiveTab(loaded);

  const probeStatus = await browser.runtime.sendMessage({ action: 'GET_PROBE_STATE' }).catch(() => null);
  if (probeStatus?.isProbing) {
    setProbing(true);
    progressBar.value = probeStatus.progress || 0;
  }
}

selectFavicon.addEventListener('change', async (e) => {
  if (isProbingState.val) return;
  faviconProviderState.val = e.target.value;
  await browser.storage.local.set({ faviconProvider: e.target.value });
});

btnProbe.addEventListener('click', async () => {
  if (isProbingState.val) return;
  setProbing(true);
  try {
    const updated = await browser.runtime.sendMessage({ action: 'PROBE_ALL' });
    if (updated) {
      routesState.val = updated;
      await syncActiveTab(updated);
    }
  } finally {
    setProbing(false);
  }
});

btnExport.addEventListener('click', () => {
  if (isProbingState.val) return;
  const blob = new Blob([JSON.stringify(routesState.val, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fagir-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener('click', () => {
  if (!isProbingState.val) fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  if (isProbingState.val) return;
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error();
    for (const r of imported) {
      if (!r.name || !r.pattern || !Array.isArray(r.instances)) throw new Error();
    }
    await updateRoutes(() => imported);
  } catch (_) {
    alert('Import failed: malformed JSON format.');
  } finally {
    fileInput.value = '';
  }
});

btnReset.addEventListener('click', () => {
  if (isProbingState.val) return;
  if (confirm('Heads up! This is irreversible, you\'ll lose all your changes.\n\nIt\'s advised to export your current settings before proceeding.')) {
    updateRoutes(() => DEFAULT_ROUTES);
  }
});

formNewRoute.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isProbingState.val) return;

  const name = document.getElementById('new-name').value.trim().toLowerCase();
  const pattern = document.getElementById('new-pattern').value.trim();
  const faviconDomain = document.getElementById('new-favicon-domain').value.trim();
  const url = document.getElementById('new-instance').value.trim();

  try { new RegExp(pattern); } catch (_) {
    alert('Invalid regex pattern.');
    return;
  }

  updateRoutes((r) => {
    r.push({
      name,
      enabled: true,
      autoSort: false,
      pattern,
      ...(faviconDomain ? { faviconDomain } : {}),
      instances: [{ url, status: 'untested', latency: null }],
    });
  });

  formNewRoute.reset();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'PROBE_PROGRESS') {
    progressBar.value = msg.progress;
  } else if (msg.action === 'PROBE_COMPLETE') {
    if (msg.routes) {
      routesState.val = msg.routes;
      syncActiveTab(msg.routes);
    }
    setProbing(false);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.routes) {
    routesState.val = changes.routes.newValue;
    syncActiveTab(changes.routes.newValue);
  }
  if (changes.faviconProvider) {
    faviconProviderState.val = changes.faviconProvider.newValue;
    selectFavicon.value = changes.faviconProvider.newValue;
  }
  if (changes.faviconCache) {
    faviconCacheState.val = changes.faviconCache.newValue;
  }
});

init();
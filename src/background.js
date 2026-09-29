let routes = [];
let isProbing = false;
let probeProgress = 0;

async function loadRoutingTable() {
  const stored = await browser.storage.local.get('routes');
  routes = stored.routes || DEFAULT_ROUTES;
  if (!stored.routes) await browser.storage.local.set({ routes });
}

async function probeTarget(instance) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  const start = performance.now();

  try {
    const res = await fetch(instance.url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    clearTimeout(timer);

    const latency = Math.round(performance.now() - start);
    const status = res.status === 429 ? 'unstable' : (res.status >= 200 && res.status < 400 ? 'alive' : 'dead');
    return { ...instance, status, latency: status === 'dead' ? null : latency };
  } catch (_) {
    clearTimeout(timer);
    return { ...instance, status: 'dead', latency: null };
  }
}

async function runHealthCheck() {
  if (isProbing) return routes;
  isProbing = true;
  probeProgress = 0;

  const total = routes.reduce((acc, r) => acc + r.instances.length, 0);
  let completed = 0;

  if (total === 0) {
    isProbing = false;
    return routes;
  }

  await Promise.all(
    routes.map(async (route) => {
      route.instances = await Promise.all(
        route.instances.map(async (inst) => {
          const res = await probeTarget(inst);
          completed++;
          probeProgress = Math.round((completed / total) * 100);
          browser.runtime.sendMessage({
            action: 'PROBE_PROGRESS',
            progress: probeProgress,
          }).catch(() => {});
          return res;
        })
      );
      if (route.autoSort) sortRouteInstances(route);
    })
  );

  await browser.storage.local.set({ routes });
  isProbing = false;
  browser.runtime.sendMessage({ action: 'PROBE_COMPLETE', routes }).catch(() => {});
  return routes;
}

async function probeRoute(routeName) {
  const route = routes.find((r) => r.name === routeName);
  if (!route) return routes;

  route.instances = await Promise.all(
    route.instances.map((inst) => probeTarget(inst))
  );

  if (route.autoSort) sortRouteInstances(route);

  await browser.storage.local.set({ routes });
  return routes;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = new URL(details.url);

    for (const route of routes) {
      if (!matchRoute(url, route) || !route.instances.length) continue;

      const active =
        route.instances.find((i) => i.status === 'alive') ||
        route.instances.find((i) => i.status !== 'dead') ||
        route.instances[0];

      const targetHost = new URL(active.url).hostname;
      if (url.hostname === targetHost) return {};

      return { redirectUrl: resolveRedirect(url, route, active.url) };
    }
    return {};
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] },
  ['blocking']
);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.routes) routes = changes.routes.newValue;
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'PROBE_ALL') return runHealthCheck();
  if (msg.action === 'PROBE_ROUTE') return probeRoute(msg.routeName);
  if (msg.action === 'GET_PROBE_STATE') return Promise.resolve({ isProbing, progress: probeProgress });
});

loadRoutingTable();
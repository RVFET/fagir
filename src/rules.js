const TRANSFORMS = {
  bing: (url, base) => {
    const q = url.searchParams.get('q');
    if (!q) return `${base}/`;
    return base.includes('startpage.com')
      ? `${base}/sp/search?query=${encodeURIComponent(q)}`
      : `${base}/search?q=${encodeURIComponent(q)}`;
  },
  stackexchange: (url, base) => {
    const host = url.hostname.toLowerCase();
    if (host === 'stackoverflow.com' || host === 'www.stackoverflow.com') {
      return `${base}${url.pathname}${url.search}${url.hash}`;
    }
    return `${base}/exchange/${host}${url.pathname}${url.search}${url.hash}`;
  },
};

function sortRouteInstances(route) {
  const statusOrder = { alive: 0, unstable: 1, untested: 2, dead: 3 };
  route.instances.sort((a, b) => {
    const diff = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
    if (diff !== 0) return diff;
    if (a.latency != null && b.latency != null) return a.latency - b.latency;
    if (a.latency != null) return -1;
    if (b.latency != null) return 1;
    return 0;
  });
}

function matchRoute(url, route) {
  if (route.enabled === false) return false;
  const target = route.pattern.includes('/') ? `${url.hostname}${url.pathname}` : url.hostname;
  return new RegExp(route.pattern, 'i').test(target);
}

function resolveRedirect(url, route, targetBase) {
  const cleanBase = targetBase.replace(/\/+$/, '');
  const transform = TRANSFORMS[route.name];
  return transform ? transform(url, cleanBase) : `${cleanBase}${url.pathname}${url.search}${url.hash}`;
}

function rewriteInstanceUrl(currentUrl, targetBase) {
  const base = new URL(targetBase);
  const next = new URL(currentUrl.href);
  next.protocol = base.protocol;
  next.host = base.host;
  next.port = base.port;
  if (base.pathname !== '/') {
    next.pathname = base.pathname.replace(/\/+$/, '') + '/' + next.pathname.replace(/^\/+/, '');
  }
  return next.href;
}

function findRouteContext(url, routes) {
  for (let rIdx = 0; rIdx < routes.length; rIdx++) {
    const route = routes[rIdx];
    if (route.enabled === false) continue;

    const instIdx = route.instances.findIndex((inst) => {
      try { return new URL(inst.url).hostname === url.hostname; } catch (_) { return false; }
    });

    if (instIdx !== -1) {
      return { route, rIdx, instIdx, isInstance: true };
    }

    if (matchRoute(url, route)) {
      return { route, rIdx, instIdx: -1, isInstance: false };
    }
  }
  return null;
}

const DEFAULT_ROUTES = [
  {
    name: 'x',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)(?:x|twitter)\\.com$',
    faviconDomain: 'x.com',
    instances: [
      { url: 'https://nitter.cf', status: 'alive', latency: null }
    ]
  },
  {
    name: 'instagram',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)instagram\\.com$',
    faviconDomain: 'www.instagram.com',
    instances: [
      { url: 'https://kittygram.privacyredirect.com', status: 'alive', latency: null },
      { url: 'https://kittygram.irelephant.net', status: 'alive', latency: null },
      { url: 'https://kittygr.am', status: 'alive', latency: null },
      { url: 'https://kg.meowing.de', status: 'alive', latency: null },
      { url: 'https://kittygram.nadeko.net', status: 'alive', latency: null },
    ]
  },
  {
    name: 'google search',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)google\\.[a-z.]+/search',
    faviconDomain: 'www.google.com',
    instances: [
      { url: 'https://anonsearch.win', status: 'alive', latency: null },
      { url: 'https://baresearch.org', status: 'alive', latency: null },
      { url: 'https://libresearch.space', status: 'alive', latency: null },
      { url: 'https://opnxng.com', status: 'alive', latency: null },
      { url: 'https://grep.vim.wtf', status: 'alive', latency: null },
      { url: 'https://searxng.site', status: 'alive', latency: null },
      { url: 'https://search.indst.eu', status: 'alive', latency: null },
      { url: 'https://search.inetol.net', status: 'alive', latency: null },
      { url: 'https://search.undertale.uk', status: 'alive', latency: null },
      { url: 'https://etsi.me', status: 'alive', latency: null },
      { url: 'https://xka.cz', status: 'alive', latency: null },
      { url: 'https://sx.xo.st', status: 'alive', latency: null },
      { url: 'https://priv.au', status: 'alive', latency: null },
      { url: 'https://search.sethforprivacy.com', status: 'alive', latency: null },
    ]
  },
  {
    name: 'tiktok',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)tiktok\\.com$',
    faviconDomain: 'www.tiktok.com',
    instances: [
      { url: 'https://tok.habedieeh.re', status: 'alive', latency: null },
      { url: 'https://tok.adminforge.de', status: 'alive', latency: null },
      { url: 'https://cringe.seitan-ayoub.lol', status: 'alive', latency: null },
      { url: 'https://proxitok.r4fo.com', status: 'alive', latency: null },
    ]
  },
  {
    name: 'reddit',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)reddit\\.com$',
    faviconDomain: 'www.reddit.com',
    instances: [
      { url: 'https://redlib.privacyredirect.com', status: 'alive', latency: null },
      { url: 'https://redlib.catsarch.com', status: 'alive', latency: null },
      { url: 'https://l.opnxng.com', status: 'alive', latency: null }
    ]
  },
  {
    name: 'imgur',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)imgur\\.com$',
    faviconDomain: 'www.imgur.com',
    instances: [
      { url: 'https://imgur.artemislena.eu', status: 'alive', latency: null },
      { url: 'https://rimgo.privacyredirect.com', status: 'alive', latency: null },
      { url: 'https://rimgo.hostux.net', status: 'alive', latency: null }
    ]
  },
  {
    name: 'pinterest',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)pinterest\\.(?:[a-z]{2,4}(?:\\.[a-z]{2})?)$',
    faviconDomain: 'www.pinterest.com',
    instances: [
      { url: 'https://pinterest.bunk.im', status: 'alive', latency: null },
      { url: 'https://binternet.privacyredirect.com', status: 'alive', latency: null }
    ]
  },
  {
    name: 'genius',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)genius\\.com$',
    faviconDomain: 'www.genius.com',
    instances: [
      { url: 'https://genius.fsky.io', status: 'alive', latency: null },
      { url: 'https://dumb.ducks.party', status: 'alive', latency: null }
    ]
  },
  {
    name: 'medium',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)medium\\.com$',
    faviconDomain: 'medium.com',
    instances: [
      { url: 'https://libmedium.batsense.net', status: 'alive', latency: null },
      { url: 'https://medium.hostux.net', status: 'alive', latency: null },
      { url: 'https://r.sudovanilla.org', status: 'alive', latency: null },
      { url: 'https://libmedium.ducks.party', status: 'alive', latency: null },
    ]
  },
  {
    name: 'quora',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)quora\\.com$',
    faviconDomain: 'quora.com',
    instances: [
      { url: 'https://quetre.iket.me', status: 'alive', latency: null },
      { url: 'https://quetre.tokhmi.xyz', status: 'alive', latency: null },
      { url: 'https://quetre.blackdrgn.nl', status: 'alive', latency: null },
      { url: 'https://quetre.lunar.icu', status: 'alive', latency: null },
      { url: 'https://q.opnxng.com', status: 'alive', latency: null },
      { url: 'https://ask.sudovanilla.org', status: 'alive', latency: null },
      { url: 'https://quetre.r4fo.com', status: 'alive', latency: null },
      { url: 'https://quetre.ducks.party', status: 'alive', latency: null },
      { url: 'https://quetre.jeikobu.net', status: 'alive', latency: null },
      { url: 'https://quetre.privacyredirect.com', status: 'alive', latency: null },
    ]
  },
  {
    name: 'tenor',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)tenor\\.com$',
    faviconDomain: 'www.tenor.com',
    instances: [
      { url: 'https://tenor.fsky.io', status: 'alive', latency: null }
    ]
  },
  {
    name: 'twitch',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)twitch\\.tv$',
    faviconDomain: 'www.twitch.tv',
    instances: [
      { url: 'https://safetwitch.darkness.services', status: 'alive', latency: null }
    ]
  },
  {
    name: 'tumblr',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)tumblr\\.com$',
    faviconDomain: 'www.tumblr.com',
    instances: [
      { url: 'https://priviblur.canine.tools', status: 'alive', latency: null }
    ]
  },
  {
    name: 'bing',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)bing\\.com$',
    faviconDomain: 'www.bing.com',
    instances: [
      { url: 'https://startpage.com', status: 'alive', latency: null },
      { url: 'https://searx.be', status: 'alive', latency: null }
    ]
  },
  {
    name: 'stackexchange',
    enabled: true,
    autoSort: false,
    pattern: '(?:^|\\.)(?:stackexchange|stackoverflow|superuser|serverfault|askubuntu|stackapps)\\.com$|(?:^|\\.)mathoverflow\\.net$',
    faviconDomain: 'www.stackoverflow.com',
    instances: [
      { url: 'https://overflow.hostux.net', status: 'alive', latency: null },
      { url: 'https://overflow.projectsegfau.lt', status: 'alive', latency: null },
      { url: 'https://overflow.ducks.party', status: 'alive', latency: null }
    ]
  },
  {
    name: 'translate',
    enabled: true,
    autoSort: false,
    pattern: '^translate\\.google\\.[a-z.]+$',
    faviconDomain: 'translate.google.com',
    instances: [
      { url: 'https://mozhi.canine.tools', status: 'alive', latency: null },
      { url: 'https://lingva.ml', status: 'alive', latency: null },
      { url: 'https://translate.plausibility.cloud', status: 'alive', latency: null },
      { url: 'https://lingva.lunar.icu', status: 'alive', latency: null },
      { url: 'https://translate.projectsegfau.lt', status: 'alive', latency: null },
    ]
  }
];
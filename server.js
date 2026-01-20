const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_TIMEOUT = 10000;
const CONCURRENCY = 8;

function isSkippableHref(href) {
  if (!href) return true;
  const l = href.trim().toLowerCase();
  return (
    l.startsWith('javascript:') ||
    l.startsWith('mailto:') ||
    l.startsWith('tel:') ||
    l === '#' ||
    l === ''
  );
}

async function fetchWithHeadThenGet(url) {
  const start = Date.now();
  try {
    // try HEAD first
    const headRes = await axios.head(url, { timeout: DEFAULT_TIMEOUT, maxRedirects: 5 });
    const time = Date.now() - start;
    return {
      status: 'ok',
      httpStatus: headRes.status,
      timeMs: time,
      headers: headRes.headers
    };
  } catch (headErr) {
    // If HEAD fails, try GET but don't download the whole body if possible
    const start2 = Date.now();
    try {
      const getRes = await axios.get(url, {
        timeout: DEFAULT_TIMEOUT,
        maxRedirects: 5,
        responseType: 'stream', // we only need headers/time; stream avoids full body buffering
        // Some servers may still stream; we will abort after receiving headers by destroying stream in axios response handling below.
      });
      // Stop downloading
      if (getRes && getRes.data && typeof getRes.data.destroy === 'function') {
        try { getRes.data.destroy(); } catch (e) { /* ignore */ }
      }
      const time = Date.now() - start2;
      return {
        status: 'ok',
        httpStatus: getRes.status,
        timeMs: time,
        headers: getRes.headers
      };
    } catch (getErr) {
      const time = Date.now() - start2;
      // Return error info
      let code = null;
      if (getErr.response && getErr.response.status) code = getErr.response.status;
      return {
        status: 'error',
        httpStatus: code,
        error: (getErr && getErr.message) || String(getErr),
        timeMs: time
      };
    }
  }
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return null;
  }
}

async function checkResources(resources) {
  const results = [];
  const queue = resources.slice();
  const workers = new Array(CONCURRENCY).fill(null).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      try {
        const data = await fetchWithHeadThenGet(item.resolved);
        results.push(Object.assign({}, item, data));
      } catch (e) {
        results.push(Object.assign({}, item, { status: 'error', error: String(e), timeMs: null }));
      }
    }
  });
  await Promise.all(workers);
  return results;
}

app.post('/api/analyze', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing url in request body.' });
  let parsedBase;
  try {
    parsedBase = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const pageStart = Date.now();
  let html;
  let mainFetchInfo = { status: 'error', httpStatus: null, timeMs: null, error: null };
  try {
    const response = await axios.get(url, { timeout: DEFAULT_TIMEOUT, maxRedirects: 5 });
    html = response.data;
    mainFetchInfo = { status: 'ok', httpStatus: response.status, timeMs: Date.now() - pageStart, headers: response.headers };
  } catch (err) {
    mainFetchInfo = { status: 'error', httpStatus: err.response ? err.response.status : null, timeMs: Date.now() - pageStart, error: err.message };
    return res.status(502).json({ error: 'Failed to fetch page', details: mainFetchInfo });
  }

  const $ = cheerio.load(html);
  const rawResources = [];

  // anchors
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    rawResources.push({ type: 'anchor', raw: href, text: $(el).text().trim() });
  });
  // images
  $('img[src]').each((_, el) => {
    rawResources.push({ type: 'image', raw: $(el).attr('src'), alt: $(el).attr('alt') || '' });
  });
  // scripts
  $('script[src]').each((_, el) => {
    rawResources.push({ type: 'script', raw: $(el).attr('src') });
  });
  // link rel=stylesheet
  $('link[rel="stylesheet"][href]').each((_, el) => {
    rawResources.push({ type: 'stylesheet', raw: $(el).attr('href') });
  });
  // iframes
  $('iframe[src]').each((_, el) => {
    rawResources.push({ type: 'iframe', raw: $(el).attr('src') });
  });

  // Add other useful metadata (meta refresh)
  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content') || '';
    const match = content.match(/url=(.+)/i);
    if (match) rawResources.push({ type: 'meta-refresh', raw: match[1].trim() });
  });

  // Resolve and filter
  const seen = new Map();
  const resources = rawResources.map((r, idx) => {
    const resolved = resolveUrl(parsedBase.href, r.raw);
    const skippable = isSkippableHref(r.raw);
    const key = resolved || `${r.type}:${r.raw}:${idx}`;
    const duplicateOf = seen.has(resolved) ? seen.get(resolved) : null;
    if (!seen.has(resolved)) seen.set(resolved, key);
    return {
      id: key,
      type: r.type,
      raw: r.raw,
      resolved,
      skippable,
      duplicateOf: duplicateOf
    };
  });

  // Partition resources to check: skip skippable or null resolved; still include them in results with classification
  const toCheck = resources.filter(r => r.resolved && !r.skippable);

  // Limit the number of resources to check to prevent DoS - configurable; for now check up to 300 resources
  const MAX_CHECK = 300;
  const toCheckLimited = toCheck.slice(0, MAX_CHECK);

  const checked = await checkResources(toCheckLimited);

  // Combine checked results with skipped/unresolved ones
  const checkedMap = new Map(checked.map(c => [c.resolved, c]));
  const finalResources = resources.map(r => {
    if (!r.resolved) {
      return Object.assign({}, r, { status: 'unresolved', note: 'Could not resolve URL' });
    }
    if (r.skippable) {
      return Object.assign({}, r, { status: 'skipped', note: 'Skippable (mailto/tel/javascript/#)' });
    }
    const found = checkedMap.get(r.resolved);
    if (found) {
      return Object.assign({}, r, found);
    } else {
      // Not checked due to limit
      return Object.assign({}, r, { status: 'not_checked', note: 'Not checked (limit reached or queued)' });
    }
  });

  // Compute summary and recommendations
  const total = finalResources.length;
  const broken = finalResources.filter(r => (r.status === 'error' || (r.httpStatus && r.httpStatus >= 400)));
  const slow = finalResources.filter(r => r.timeMs != null && r.timeMs > 2000); // > 2000ms
  const duplicates = [];
  const seenResolved = new Map();
  finalResources.forEach(r => {
    if (r.resolved) {
      if (seenResolved.has(r.resolved)) {
        duplicates.push({ original: seenResolved.get(r.resolved), duplicate: r.resolved, type: r.type });
      } else {
        seenResolved.set(r.resolved, r);
      }
    }
  });
  const unnecessary = finalResources.filter(r => r.skippable || (r.raw && r.raw.trim() === ''));

  const avgResponse = (() => {
    const times = finalResources.filter(r => r.timeMs != null && r.status === 'ok').map(r => r.timeMs);
    if (!times.length) return null;
    return Math.round(times.reduce((a,b)=>a+b,0)/times.length);
  })();

  res.json({
    page: {
      url: parsedBase.href,
      fetch: mainFetchInfo
    },
    summary: {
      totalResources: total,
      checked: toCheckLimited.length,
      brokenCount: broken.length,
      slowCount: slow.length,
      duplicateCount: duplicates.length,
      unnecessaryCount: unnecessary.length,
      averageResponseMs: avgResponse
    },
    recommendations: [
      ...(broken.length ? ['Fix or remove broken resources (HTTP 4xx/5xx or network errors).'] : []),
      ...(duplicates.length ? ['Remove duplicate links/resources to reduce requests.'] : []),
      ...(slow.length ? ['Investigate slow resources (>2000ms) and consider optimizing or lazy-loading them.'] : []),
      ...(unnecessary.length ? ['Remove unnecessary placeholders (javascript:, #, mailto:, tel:) or convert them to accessible buttons if they perform actions.'] : [])
    ],
    resources: finalResources
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Page Quality Analyzer running on http://localhost:${PORT}`);
});

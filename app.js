document.getElementById('analyzeBtn').addEventListener('click', analyze);
document.getElementById('urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyze();
});

async function analyze() {
  const url = document.getElementById('urlInput').value.trim();
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';
  if (!url) {
    statusEl.textContent = 'Please enter a URL (including https://).';
    return;
  }
  statusEl.textContent = 'Analyzing... (this may take a few seconds)';
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!resp.ok) {
      const err = await resp.json();
      statusEl.textContent = 'Error: ' + (err.error || resp.statusText);
      return;
    }
    const data = await resp.json();
    statusEl.textContent = '';
    renderResults(data);
  } catch (e) {
    statusEl.textContent = 'Network error: ' + e.message;
  }
}

function renderResults(data) {
  const resultsEl = document.getElementById('results');
  const s = data.summary;
  const recs = data.recommendations || [];
  const pageUrl = data.page && data.page.url ? data.page.url : '';
  const mainFetch = data.page && data.page.fetch ? data.page.fetch : {};

  const summaryHtml = `
    <div class="summary">
      <strong>Page:</strong> <a href="${escapeHtml(pageUrl)}" target="_blank">${escapeHtml(pageUrl)}</a><br/>
      <strong>Page fetch:</strong> ${mainFetch.status} ${mainFetch.httpStatus || ''} ${mainFetch.timeMs ? '(' + mainFetch.timeMs + ' ms)' : ''}<br/>
      <strong>Total resources found:</strong> ${s.totalResources}<br/>
      <strong>Checked:</strong> ${s.checked} | <strong>Broken:</strong> <span class="bad">${s.brokenCount}</span> | <strong>Slow (&gt;2s):</strong> <span class="slow">${s.slowCount}</span> | <strong>Duplicates:</strong> ${s.duplicateCount} | <strong>Unnecessary:</strong> ${s.unnecessaryCount}<br/>
      <strong>Avg response time (checked):</strong> ${s.averageResponseMs != null ? s.averageResponseMs + ' ms' : 'N/A'}
    </div>
  `;

  const recHtml = recs.length ? '<div><strong>Recommendations:</strong><ul>' + recs.map(r => '<li>' + escapeHtml(r) + '</li>').join('') + '</ul></div>' : '';

  let table = '<table class="table"><thead><tr><th>Type</th><th>Raw</th><th>Resolved URL</th><th>HTTP</th><th>Time (ms)</th><th>Note</th></tr></thead><tbody>';
  (data.resources || []).forEach(r => {
    const http = r.httpStatus ? r.httpStatus : (r.status ? r.status : '');
    const note = r.note || r.error || (r.duplicateOf ? 'duplicate' : '');
    const cls = (r.status === 'skipped') ? 'skipped' : (r.httpStatus && r.httpStatus >= 400) ? 'bad' : (r.timeMs && r.timeMs > 2000) ? 'slow' : '';
    table += `<tr class="${cls}">
      <td>${escapeHtml(r.type)}</td>
      <td>${escapeHtml(r.raw || '')}</td>
      <td>${r.resolved ? `<a href="${escapeAttr(r.resolved)}" target="_blank">${escapeHtml(r.resolved)}</a>` : ''}</td>
      <td>${escapeHtml(String(http))}</td>
      <td>${r.timeMs != null ? escapeHtml(String(r.timeMs)) : ''}</td>
      <td>${escapeHtml(note || '')}</td>
    </tr>`;
  });
  table += '</tbody></table>';

  resultsEl.innerHTML = summaryHtml + recHtml + table;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

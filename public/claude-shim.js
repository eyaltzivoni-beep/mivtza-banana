// Lets pages written for Claude artifacts run on this site:
// window.claude.use("sample") answers through the site's own /api/ai endpoint.
(function () {
  async function sample(input, opts) {
    const r = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }), signal: opts && opts.signal
    });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (!r.ok) { const e = new Error(j.error || 'ה-AI לא זמין כרגע'); e.code = r.status === 429 ? 'rate_limited' : 'upstream_error'; throw e; }
    const text = j.text || '';
    if (opts && typeof opts.onText === 'function') { try { opts.onText({ text, delta: text }); } catch (e) { } }
    return { text, truncated: false, modelTierApplied: 'default' };
  }
  sample.json = async (input, opts) => {
    const { text } = await sample(input, opts);
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    return JSON.parse(m ? m[0] : text);
  };
  sample.limits = async () => ({ maxPromptBytes: 60000 });
  window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
})();

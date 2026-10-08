import { trackerOrigin, umamiReady } from "@/lib/umami";

// The tracking script, served from our own address. Customers install this URL once,
// so moving from Umami Cloud to our own Umami server never changes their snippet.
let cached: { at: number; body: string } | null = null;

// Runs after Umami on every page: records the moments that matter in a buyer journey
// (forms, demo and pricing clicks, Calendly, email and phone, leaving the site, scroll depth).
// No setup for the customer, and nothing personal is recorded.
const ACTIONS = `;(function(){
  if (window.__awActions) return; window.__awActions = 1;
  var send = function(name, data){ var t = function(){ if (window.umami && umami.track) { try { umami.track(name, data); } catch(e){} } else if (t.n++ < 40) setTimeout(t, 250); }; t.n = 0; t(); };
  var clip = function(s){ return String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 80); };
  var CTA = /\\b(book|demo|pricing|plans|contact|quote|trial|get started|sign ?up|start free|talk to|schedule|buy now|add to cart|checkout|subscribe)\\b/i;
  document.addEventListener('submit', function(e){
    var f = e.target; if (!f || f.tagName !== 'FORM') return;
    if (f.querySelector('input[type=password]')) return;
    send('Form submit', { form: clip(f.getAttribute('name') || f.id || f.getAttribute('aria-label') || f.getAttribute('action') || location.pathname) });
  }, true);
  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('a,button,[role=button]') : null; if (!el) return;
    var href = el.getAttribute('href') || ''; var text = clip(el.innerText || el.getAttribute('aria-label') || el.value);
    if (/^mailto:/i.test(href)) return send('Email click', { to: clip(href.slice(7).split('?')[0].split('@')[1] || '') });
    if (/^tel:/i.test(href)) return send('Phone click', {});
    if (/calendly\\.com|cal\\.com|hubspot\\.com\\/meetings|savvycal|tidycal/i.test(href)) return send('Booking click', { text: text, to: clip(href.split('?')[0]) });
    var out = false; try { out = href && /^https?:/i.test(href) && new URL(href).hostname.replace(/^www\\./,'') !== location.hostname.replace(/^www\\./,''); } catch(x){}
    if (CTA.test(text) || CTA.test(href)) return send('CTA click', { text: text, to: clip(href) });
    if (out) return send('Outbound click', { to: clip(new URL(href).hostname) });
  }, true);
  var marks = {}; var path = location.pathname;
  var onScroll = function(){
    if (location.pathname !== path) { path = location.pathname; marks = {}; }
    var h = document.documentElement; var max = h.scrollHeight - h.clientHeight; if (max < 400) return;
    var p = (h.scrollTop || document.body.scrollTop) / max;
    [50, 90].forEach(function(m){ if (p * 100 >= m && !marks[m]) { marks[m] = 1; send('Scrolled ' + m + '%', { page: path }); } });
  };
  window.addEventListener('scroll', function(){ clearTimeout(onScroll.t); onScroll.t = setTimeout(onScroll, 300); }, { passive: true });
})();`;

export async function GET() {
  if (!umamiReady()) return new Response("/* Arrowsterr tracking is not set up */", { headers: { "Content-Type": "application/javascript" } });
  if (!cached || Date.now() - cached.at > 6 * 3600_000) {
    const res = await fetch(`${trackerOrigin()}/script.js`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return new Response("/* tracker unavailable */", { status: 502, headers: { "Content-Type": "application/javascript" } });
    cached = { at: Date.now(), body: await res.text() };
  }
  return new Response(cached.body + "\n" + ACTIONS, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}

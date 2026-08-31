// js/main.js

// 1. Strip Obsidian-style frontmatter (--- block) from the raw markdown
function parseFront(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (m) {
    let currentKey = null;
    m[1].split('\n').forEach(line => {
      if (line.trim().startsWith('- ')) {              // YAML list item
        if (currentKey) {
          if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
          meta[currentKey].push(line.slice(line.indexOf('-') + 1).trim());
        }
        return;
      }
      const i = line.indexOf(':');
      if (i < 0) { currentKey = null; return; }
      currentKey = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      meta[currentKey] = v === '' ? [] : v.replace(/^"|"$/g, '');   // empty = YAML list opener
    });
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

// 2. Home page: posts/index.json -> post cards
const POSTS_JSON = "https://blogarchive.orb.gay/index.json";
function slugify(s) {
  return s.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
let POSTS = [];
let currentSlug = null;
function slugToPost(slug) {
  return POSTS.find(p => (p.slug || slugify(p.file)) === slug);
}
function renderPosts(container, posts) {
  container.innerHTML = posts.map(p => `
    <a href="https://blogarchive.orb.gay/${encodeURIComponent(p.file)}"
       onclick="openPost(this.href, '${p.slug || slugify(p.file)}'); return false;">
      <div class="post btn btn-active">
        <h2>${p.title || p.title}</h2>
        <p class="secondary">${p.desc}</p>
        <hstack style="gap:8px" class="secondary">
          <i class="ti ti-calendar"></i><p>${p.date}</p>
        </hstack>
        <hstack style="gap:8px" class="secondary">
          <i class="ti ti-tag"></i>
          <tags>${(p.tags || []).map(t => `<tag>${t}</tag>`).join('')}</tags>
        </hstack>
      </div>
    </a>`).join('');
  htmx.process(container);     // REQUIRED: htmx ignores JS-injected hx-* links otherwise
}
async function loadHomePosts(container) {
  const el = container.querySelector('#posts');
  if (!el) return;
  try {
    const res = await fetch(POSTS_JSON);
    if (!res.ok) throw new Error(res.status);
    POSTS = await res.json();
    renderPosts(el, POSTS);
    syncFromHash();   // honor a deep-link (e.g. #hello-world) present on first load
  } catch (e) {
    el.innerHTML = `<p class="secondary">failed to load posts: ${e.message}</p>`;
    console.error("loadHomePosts:", e);
  }
}

// 2b. Apply a content swap with a transition (View Transitions API, CSS fade fallback).
function withTransition(update) {
  if (document.startViewTransition) {
    try {
      const t = document.startViewTransition(update);
      if (t) for (const k of ['ready', 'updateCallbackDone', 'finished']) if (t[k]) t[k].catch(() => {});
      return;
    } catch (e) { /* fall through to CSS fade */ }
  }
  const el = document.querySelector('.contents');
  el.style.opacity = '0';
  update();
  requestAnimationFrame(() => { el.style.transition = 'opacity .2s ease'; el.style.opacity = '1'; });
}

// 2c. Open a post via plain fetch (avoids htmx's HX-Request preflight, which the
//     static host won't answer with CORS headers on a cross-origin request).
async function openPost(url, slug) {
  const el = document.querySelector('.contents');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const md = await res.text();
    withTransition(() => { el.textContent = md; renderIfMarkdown(el); });
    currentSlug = slug;
    history.pushState({ slug }, '', '#' + slug);
  } catch (e) {
    console.error("openPost:", e);
    location.href = url;   // fallback: open the raw markdown directly
  }
}

// 2d. Open a post by slug (resolves its file from the loaded index); used for deep-links.
function openSlug(slug) {
  const post = slugToPost(slug);
  if (!post) { console.warn("unknown slug:", slug); return; }
  openPost('https://blogarchive.orb.gay/' + encodeURIComponent(post.file), slug);
}

// 2e. Route by URL hash: open the matching post, or return home when the hash is empty.
function syncFromHash() {
  const slug = decodeURIComponent(location.hash.slice(1));
  if (slug && slugToPost(slug)) {
    if (currentSlug !== slug) openSlug(slug);
    return;
  }
  if (currentSlug) {                       // hash cleared -> back to home
    currentSlug = null;
    const el = document.querySelector('.contents');
    fetch('/contents/home.html')
      .then(r => r.text())
      .then(h => withTransition(() => { el.innerHTML = h; loadHomePosts(el); }))
      .catch(e => console.error("home reload:", e));
  }
}

// 2f. Hash changes cover back/forward and manual edits (all nav is hash-based).
window.addEventListener('hashchange', syncFromHash);

// 3. Post view: raw markdown text -> rendered HTML
function renderIfMarkdown(el) {
  if (el.childElementCount > 0) return;
  const raw = el.textContent.trim();
  if (!raw) return;
  const { meta, body } = parseFront(raw);

  const postTitle = meta.title || (meta.name && meta.name.replace(/\.md$/, '')) || '';
  const tags = (meta.tags || []).map(t => `<tag>${t}</tag>`).join('');
  const header = `
    <h1 class="soon">${postTitle}</h1>
    ${meta.desc ? `<p class="secondary">${meta.desc}</p>` : ''}
    <hstack class="secondary" style="gap:8px;"><i class="ti ti-calendar"></i><p>${meta.date || ''}</p></hstack>
    ${tags ? `<hstack class="secondary" style="gap:8px;"><i class="ti ti-tag"></i><tags>${tags}</tags></hstack>` : ''}
    <img class="squiggle" src="squiggle.svg" aria-hidden="true">`;

  const back = `<hstack style="gap:12px">
      <a class="back" onclick="location.hash=''; return false;" href="#">
        <div class="btn-secondary">
          <i class="ti ti-arrow-left"></i>
          <p class="back-label secondary">Go back home</p>
        </div>
      </a>
    </hstack>`;
  el.innerHTML = back + header + `<div class="post-body">${marked.parse(body)}</div>`;
  if (window.hljs) hljs.highlightAll(); 
  if (postTitle) document.title = postTitle;
}

// 4. Fired after any .contents swap: render post (if markdown) or load the post list (if home)
function onContentSwap(el) {
  renderIfMarkdown(el);
  if (el.querySelector('#posts')) loadHomePosts(el);
}
// auth.js - session, profile, and multi-group context for the RowingTools
// dashboard. Requires config.js (sb, SUPABASE_ENABLED).
//
// Differs from Condit: a user belongs to MANY groups, so there is an "active
// group" (persisted in localStorage) and a header switcher to change it. Role
// is per-group, read from the active membership.

const RT = {
  session: null,
  profile: null,
  memberships: [],     // [{ group_id, role, group: {...} }]
  activeGroupId: null,
};

const ACTIVE_GROUP_KEY = 'rt_active_group';

// Redirect to login if there is no session. Returns the session or null.
async function requireAuth() {
  if (!SUPABASE_ENABLED) { document.body.innerHTML = configHint(); return null; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.replace('login.html'); return null; }
  RT.session = session;
  return session;
}

// Load profile + every group membership (with group details), then resolve the
// active group from localStorage (falling back to the first membership).
async function loadContext() {
  const uid = RT.session.user.id;

  const [{ data: profile }, { data: mems }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', uid).single(),
    sb.from('group_members').select('group_id, role, group:groups(*)').eq('profile_id', uid),
  ]);

  RT.profile = profile;
  RT.memberships = (mems || []).filter(m => m.group);

  let saved = null;
  try { saved = localStorage.getItem(ACTIVE_GROUP_KEY); } catch (e) {}
  RT.activeGroupId = (saved && RT.memberships.some(m => m.group_id === saved))
    ? saved
    : (RT.memberships[0]?.group_id || null);

  return RT;
}

function activeMembership() {
  return RT.memberships.find(m => m.group_id === RT.activeGroupId) || null;
}
function activeGroup()  { return activeMembership()?.group || null; }
function isActiveAdmin() { return activeMembership()?.role === 'admin'; }

function setActiveGroup(groupId) {
  try { localStorage.setItem(ACTIVE_GROUP_KEY, groupId); } catch (e) {}
  window.location.reload();
}

async function signOut() {
  await sb.auth.signOut();
  window.location.replace('login.html');
}

// ---- Header ----
// Pages need: <nav id="header-nav"> and <div id="header-right">.
function renderHeader(activePage) {
  const nav   = document.getElementById('header-nav');
  const right = document.getElementById('header-right');

  // Nav: only show admin-only links when admin of the active group. Stubbed
  // pages are marked soon:true and rendered as disabled until built.
  const links = [
    { href: 'index.html',     label: 'Home' },
    { href: 'results.html',   label: 'Results' },
    { href: 'analytics.html', label: 'Analytics' },
    { href: 'roster.html',    label: 'Roster' },
    { href: 'crews.html',     label: 'Crews' },
    { href: 'workspace.html', label: 'Workspace' },
    { href: 'tools.html',     label: 'Tools' },
    { href: 'members.html',   label: 'Members', soon: true, adminOnly: true },
  ];

  if (nav && activeGroup()) {
    nav.innerHTML = '';
    for (const l of links) {
      if (l.adminOnly && !isActiveAdmin()) continue;
      const a = document.createElement(l.soon ? 'span' : 'a');
      a.className = 'header-nav-link' + (activePage === l.href ? ' active' : '');
      a.textContent = l.label;
      if (l.soon) { a.style.opacity = '0.45'; a.style.cursor = 'default'; a.title = 'Coming soon'; }
      else { a.href = l.href; }
      nav.appendChild(a);
    }
  }

  if (right) {
    right.innerHTML = '';
    if (RT.memberships.length) right.appendChild(buildGroupSwitcher());
    right.appendChild(buildUserMenu());
  }
}

function buildGroupSwitcher() {
  const wrap = document.createElement('div');
  wrap.className = 'group-switcher';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-switcher-btn';
  btn.innerHTML = `<span>${escapeHtml(activeGroup()?.name || 'Select squad')}</span><span class="caret">▾</span>`;

  const menu = document.createElement('div');
  menu.className = 'group-switcher-menu';
  menu.hidden = true;

  for (const m of RT.memberships) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'group-switcher-item' + (m.group_id === RT.activeGroupId ? ' active' : '');
    item.innerHTML = `<span>${escapeHtml(m.group.name)}</span><span class="role-pill">${m.role}</span>`;
    item.addEventListener('click', () => setActiveGroup(m.group_id));
    menu.appendChild(item);
  }

  const sep = document.createElement('div');
  sep.className = 'group-switcher-sep';
  menu.appendChild(sep);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'group-switcher-add';
  add.textContent = '+ New squad';
  add.addEventListener('click', () => { window.location.href = 'index.html?new=1'; });
  menu.appendChild(add);

  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function buildUserMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'usermenu';

  const name = RT.profile?.display_name || RT.session?.user?.email || '';
  const initials = (name || '?').trim().slice(0, 1).toUpperCase();

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'usermenu-trigger';
  trigger.innerHTML = `<span class="usermenu-avatar">${escapeHtml(initials)}</span>`;

  const menu = document.createElement('div');
  menu.className = 'usermenu-menu';
  menu.hidden = true;

  const who = document.createElement('div');
  who.style.cssText = 'padding:9px 10px; font-size:13px; color:var(--ink-2); border-bottom:1px solid var(--line); margin-bottom:4px;';
  who.textContent = name;
  menu.appendChild(who);

  if (isActiveAdmin()) {
    const settings = document.createElement('a');
    settings.href = 'settings.html';
    settings.className = 'usermenu-item';
    settings.textContent = 'Settings';
    menu.appendChild(settings);
  }

  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'usermenu-item';
  out.textContent = 'Sign out';
  out.addEventListener('click', signOut);
  menu.appendChild(out);

  trigger.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  return wrap;
}

// ---- small utils ----
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function configHint() {
  return `<div style="max-width:520px;margin:80px auto;font-family:system-ui;padding:24px">
    <h1 style="font-size:20px;margin-bottom:10px">Supabase not configured</h1>
    <p style="color:#555;line-height:1.6">Fill in your project URL and anon key in
    <code>dashboard/js/config.js</code>, then reload.</p></div>`;
}

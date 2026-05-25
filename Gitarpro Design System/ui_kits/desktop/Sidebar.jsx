// Gitarpro Desktop — Sidebar component
// Shared to window so index.html can use it

const COMMITS = [
  { hash: 'a3f9c12', msg: 'add bridge riff with hammer-ons', author: 'Alex Kim', time: '2h ago', branch: 'main' },
  { hash: '8b2e047', msg: 'fix timing in chorus — bars 17–20', author: 'Alex Kim', time: '1d ago' },
  { hash: 'c1d44fa', msg: 'update bass line for verse 2', author: 'Jordan Lee', time: '2d ago' },
  { hash: 'f02b981', msg: 'add outro section', author: 'Alex Kim', time: '3d ago' },
  { hash: 'e91a330', msg: 'rework verse guitar — capo 2', author: 'Jordan Lee', time: '4d ago' },
  { hash: 'd77c102', msg: 'initial arrangement', author: 'Alex Kim', time: '5d ago' },
  { hash: 'b44f290', msg: 'init', author: 'Alex Kim', time: '6d ago' },
];

const BRANCHES = ['main', 'feature/bridge', 'feature/outro-v2', 'experiment/jazz-chord'];

const STAGED_FILES = [
  { file: 'song.gp', status: 'modified', summary: '2 bars changed in Lead Guitar' },
  { file: 'bridge.gp', status: 'added' },
];
const UNSTAGED_FILES = [
  { file: 'chorus.gp5', status: 'modified' },
];
const UNTRACKED_FILES = ['demo-v2.gp', 'scratch.gp5'];

function NavIcon({ type }) {
  const s = { width:16, height:16, stroke:'currentColor', fill:'none', strokeWidth:1.5, strokeLinecap:'round', strokeLinejoin:'round', verticalAlign:'middle', flexShrink:0 };
  if (type === 'history') return <svg viewBox="0 0 24 24" style={s}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
  if (type === 'status') return <svg viewBox="0 0 24 24" style={s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
  if (type === 'diff') return <svg viewBox="0 0 24 24" style={s}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>;
  if (type === 'merge') return <svg viewBox="0 0 24 24" style={s}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>;
  if (type === 'branch') return <svg viewBox="0 0 24 24" style={s}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
  if (type === 'folder') return <svg viewBox="0 0 24 24" style={s}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  if (type === 'chevron-down') return <svg viewBox="0 0 24 24" style={{...s, width:12, height:12}}><polyline points="6 9 12 15 18 9"/></svg>;
  if (type === 'settings') return <svg viewBox="0 0 24 24" style={s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
  return null;
}

const sidebarStyles = {
  sidebar: { width:220, background:'#141414', borderRight:'1px solid #2a2a2a', display:'flex', flexDirection:'column', flexShrink:0, height:'100%' },
  logo: { padding:'14px 16px 12px', borderBottom:'1px solid #1f1f1f', display:'flex', alignItems:'center', gap:8 },
  logoText: { fontFamily:"'Space Mono', monospace", fontWeight:700, fontSize:18, color:'#f0f0f0', letterSpacing:'-0.04em' },
  logoAccent: { color:'oklch(62% 0.18 22)' },
  repoSection: { padding:'10px 14px', borderBottom:'1px solid #2a2a2a' },
  repoLabel: { fontSize:10, color:'#484848', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:500, marginBottom:4, fontFamily:"'Space Mono', monospace" },
  repoPath: { fontSize:11, color:'#8a8a8a', fontFamily:"'Space Mono', monospace", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
  branchBtn: { marginTop:8, display:'flex', alignItems:'center', gap:6, background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, padding:'5px 8px', cursor:'pointer', width:'100%', color:'#f0f0f0', fontFamily:"'Bauhaus', sans-serif", fontSize:12, transition:'background 100ms ease' },
  nav: { flex:1, padding:'8px 0' },
  navItem: { display:'flex', alignItems:'center', gap:9, padding:'8px 14px', fontSize:13, cursor:'pointer', color:'#8a8a8a', transition:'background 100ms, color 100ms', userSelect:'none', position:'relative' },
  navItemActive: { color:'#f0f0f0', background:'#1c1c1c' },
  navActiveBorder: { position:'absolute', left:0, top:0, bottom:0, width:2, background:'oklch(62% 0.18 22)' },
  navLabel: { fontSize:10, color:'#484848', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:500, padding:'12px 14px 4px', fontFamily:"'Bauhaus', sans-serif" },
  footer: { padding:'10px 14px', borderTop:'1px solid #2a2a2a', display:'flex', alignItems:'center', justifyContent:'space-between' },
  footerText: { fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace" },
  iconBtn: { background:'none', border:'none', cursor:'pointer', color:'#484848', display:'flex', alignItems:'center', padding:4, borderRadius:2, transition:'color 100ms', outline:'none' },
};

function Sidebar({ view, setView, branch, setBranch, repoPath }) {
  const [branchOpen, setBranchOpen] = React.useState(false);
  const navItems = [
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'status',  label: 'Status', icon: 'status' },
    { id: 'diff',    label: 'Diff',   icon: 'diff' },
    { id: 'merge',   label: 'Merge',  icon: 'merge' },
  ];

  return (
    <div style={sidebarStyles.sidebar}>
      <div style={sidebarStyles.logo}>
        <span style={sidebarStyles.logoText}>gp<span style={sidebarStyles.logoAccent}>t</span></span>
      </div>

      <div style={sidebarStyles.repoSection}>
        <div style={sidebarStyles.repoLabel}>Repository</div>
        <div style={sidebarStyles.repoPath} title={repoPath}>
          <NavIcon type="folder" /> {repoPath}
        </div>
        <div style={{ position:'relative' }}>
          <button style={sidebarStyles.branchBtn} onClick={() => setBranchOpen(o => !o)}>
            <NavIcon type="branch" />
            <span style={{ flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{branch}</span>
            <NavIcon type="chevron-down" />
          </button>
          {branchOpen && (
            <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, zIndex:100, boxShadow:'0 4px 16px rgba(0,0,0,0.5)' }}>
              {BRANCHES.map(b => (
                <div key={b} onClick={() => { setBranch(b); setBranchOpen(false); }}
                  style={{ padding:'7px 10px', fontSize:12, fontFamily:"'Space Mono', monospace", color: b === branch ? '#f0f0f0' : '#8a8a8a', cursor:'pointer', background: b === branch ? '#242424' : 'transparent', borderLeft: b === branch ? '2px solid oklch(62% 0.18 22)' : '2px solid transparent', transition:'background 100ms' }}>
                  {b}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={sidebarStyles.nav}>
        <div style={sidebarStyles.navLabel}>Views</div>
        {navItems.map(item => (
          <div key={item.id}
            style={{ ...sidebarStyles.navItem, ...(view === item.id ? sidebarStyles.navItemActive : {}) }}
            onClick={() => setView(item.id)}>
            {view === item.id && <div style={sidebarStyles.navActiveBorder}/>}
            <NavIcon type={item.icon} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={sidebarStyles.footer}>
        <span style={sidebarStyles.footerText}>v0.1.0</span>
        <button style={sidebarStyles.iconBtn}><NavIcon type="settings" /></button>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, COMMITS, BRANCHES, STAGED_FILES, UNSTAGED_FILES, UNTRACKED_FILES, NavIcon });

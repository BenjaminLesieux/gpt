// Gitarpro Desktop — View components
// All main panel views: History, Status/Commit, Diff, Merge, OpenRepo

// ── Shared atoms ─────────────────────────────────────────────

function Badge({ type, children }) {
  const styles = {
    added:    { background:'oklch(58% 0.13 145 / 15%)', color:'oklch(58% 0.13 145)',  border:'1px solid oklch(58% 0.13 145 / 30%)' },
    removed:  { background:'oklch(55% 0.16 22 / 15%)',  color:'oklch(62% 0.18 22)',   border:'1px solid oklch(55% 0.16 22 / 30%)' },
    changed:  { background:'oklch(65% 0.14 60 / 15%)',  color:'oklch(65% 0.14 60)',   border:'1px solid oklch(65% 0.14 60 / 30%)' },
    neutral:  { background:'#1c1c1c', color:'#8a8a8a', border:'1px solid #2a2a2a' },
    accent:   { background:'oklch(55% 0.16 22)', color:'#f0f0f0', border:'none' },
  };
  return (
    <span style={{ display:'inline-flex', alignItems:'center', height:18, padding:'0 6px', borderRadius:2, fontSize:10, fontFamily:"'Space Mono', monospace", fontWeight:600, ...(styles[type] || styles.neutral) }}>
      {children}
    </span>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize:10, color:'#484848', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:500, padding:'10px 16px 4px', fontFamily:"'Bauhaus', sans-serif" }}>{children}</div>;
}

function PanelHeader({ title, right }) {
  return (
    <div style={{ padding:'9px 14px', borderBottom:'1px solid #2a2a2a', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
      <span style={{ fontSize:11, fontWeight:500, color:'#8a8a8a', textTransform:'uppercase', letterSpacing:'0.1em' }}>{title}</span>
      {right}
    </div>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" style={{ width:13,height:13,fill:'currentColor',stroke:'none' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>;
}
function PauseIcon() {
  return <svg viewBox="0 0 24 24" style={{ width:13,height:13,fill:'none',stroke:'currentColor',strokeWidth:2 }}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
}
function MusicIcon() {
  return <svg viewBox="0 0 24 24" style={{ width:14,height:14,fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round' }}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
}

// ── Tab Score Placeholder ─────────────────────────────────────
function TabScorePlaceholder({ title, track, playing, onTogglePlay }) {
  // Decorative staff lines + random note dots
  const bars = 8;
  const strings = 6;
  const notePositions = [
    [0,2],[1,0],[1,4],[2,3],[3,1],[3,5],[4,2],[4,4],[5,0],[5,3],[6,1],[6,5],[7,2],[7,4]
  ];
  return (
    <div style={{ flex:1, background:'#0f0f0f', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* track header */}
      <div style={{ padding:'10px 16px', borderBottom:'1px solid #1f1f1f', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <MusicIcon />
        <span style={{ fontSize:13, color:'#f0f0f0', fontWeight:500 }}>{title || 'Untitled Score'}</span>
        <span style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace" }}>Lead Guitar — Standard Tuning</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {['E','A','D','G','B','E'].map((s,i) => (
            <span key={i} style={{ fontSize:10, color:'#484848', fontFamily:"'Space Mono', monospace", background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, padding:'1px 4px' }}>{s}</span>
          ))}
        </div>
      </div>
      {/* playback bar */}
      <div style={{ padding:'6px 16px', borderBottom:'1px solid #1f1f1f', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <button onClick={onTogglePlay} style={{ background:'none', border:'none', cursor:'pointer', color: playing ? 'oklch(62% 0.18 22)' : '#8a8a8a', display:'flex', alignItems:'center', padding:0, transition:'color 100ms' }}>
          {playing ? <PauseIcon/> : <PlayIcon/>}
        </button>
        <div style={{ flex:1, height:2, background:'#1c1c1c', borderRadius:1, position:'relative' }}>
          <div style={{ width: playing ? '35%' : '0%', height:'100%', background:'oklch(55% 0.16 22)', borderRadius:1, transition: playing ? 'width 8s linear' : 'none' }}/>
        </div>
        <span style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace" }}>0:14 / 0:42</span>
      </div>
      {/* staff */}
      <div style={{ flex:1, overflowX:'auto', padding:'24px 16px', position:'relative' }}>
        <div style={{ display:'flex', gap:0, minWidth: bars * 110 }}>
          {Array.from({ length: bars }).map((_, barIdx) => (
            <div key={barIdx} style={{ flex:1, borderRight:'1px solid #2a2a2a', paddingRight:8, marginRight:8, position:'relative' }}>
              {/* bar number */}
              <div style={{ fontSize:9, color:'#333', fontFamily:"'Space Mono', monospace", marginBottom:6 }}>{barIdx + 1}</div>
              {/* string lines + fret numbers */}
              {Array.from({ length: strings }).map((_, strIdx) => {
                const note = notePositions.find(n => n[0] === barIdx && n[1] === strIdx);
                const fret = note ? (((barIdx * 3 + strIdx * 7) % 12) + 1) : null;
                return (
                  <div key={strIdx} style={{ height:20, borderBottom:'1px solid #1f1f1f', display:'flex', alignItems:'center', justifyContent: fret ? 'center' : 'flex-start', position:'relative' }}>
                    {fret && (
                      <span style={{ fontSize:11, fontFamily:"'Space Mono', monospace", color:'#f0f0f0', background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, padding:'0 4px', lineHeight:'16px', zIndex:1 }}>{fret}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* AlphaTab note */}
        <div style={{ position:'absolute', bottom:12, right:16, fontSize:10, color:'#333', fontFamily:"'Space Mono', monospace" }}>rendered via AlphaTab</div>
      </div>
    </div>
  );
}

// ── History View ─────────────────────────────────────────────
function HistoryView({ commits, selectedHash, onSelect }) {
  const [playing, setPlaying] = React.useState(false);
  const selected = commits.find(c => c.hash === selectedHash) || commits[0];
  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      {/* Commit list */}
      <div style={{ width:280, borderRight:'1px solid #2a2a2a', display:'flex', flexDirection:'column', flexShrink:0 }}>
        <PanelHeader title="History" right={<span style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace" }}>{commits.length} commits</span>} />
        <div style={{ flex:1, overflowY:'auto' }}>
          {commits.map((c, i) => (
            <div key={c.hash} onClick={() => onSelect(c.hash)}
              style={{ padding:'9px 14px', borderBottom:'1px solid #1f1f1f', cursor:'pointer', background: c.hash === (selectedHash || commits[0].hash) ? '#1c1c1c' : 'transparent', position:'relative', transition:'background 100ms' }}>
              {c.hash === (selectedHash || commits[0].hash) && <div style={{ position:'absolute', left:0, top:0, bottom:0, width:2, background:'oklch(55% 0.16 22)' }}/>}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                <span style={{ fontFamily:"'Space Mono', monospace", fontSize:11, color:'oklch(60% 0.12 230)' }}>{c.hash}</span>
                {i === 0 && <Badge type="accent">HEAD</Badge>}
                {c.branch && i === 0 && <Badge type="neutral">{c.branch}</Badge>}
              </div>
              <div style={{ fontSize:13, color: c.hash === (selectedHash || commits[0].hash) ? '#f0f0f0' : '#c0c0c0', marginBottom:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.msg}</div>
              <div style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace" }}>{c.author} · {c.time}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Tab viewer */}
      <TabScorePlaceholder title="add bridge riff with hammer-ons" playing={playing} onTogglePlay={() => setPlaying(p => !p)} />
    </div>
  );
}

// ── Status / Commit View ──────────────────────────────────────
function StatusView({ staged, unstaged, untracked }) {
  const [msg, setMsg] = React.useState('');
  const [localStaged, setLocalStaged] = React.useState(staged);
  const [localUnstaged, setLocalUnstaged] = React.useState(unstaged);
  const [localUntracked, setLocalUntracked] = React.useState(untracked);
  const [committed, setCommitted] = React.useState(false);

  function stageFile(file) {
    setLocalUnstaged(prev => prev.filter(f => f.file !== file));
    setLocalStaged(prev => [...prev, { file, status: 'modified' }]);
  }
  function unstageFile(file) {
    setLocalStaged(prev => prev.filter(f => f.file !== file));
    setLocalUnstaged(prev => [...prev, { file, status: 'modified' }]);
  }
  function doCommit() {
    if (!msg.trim() || localStaged.length === 0) return;
    setCommitted(true);
    setTimeout(() => { setCommitted(false); setMsg(''); setLocalStaged([]); }, 2000);
  }

  const statusLabel = { added: 'A', modified: 'M', deleted: 'D' };
  const statusType  = { added: 'added', modified: 'changed', deleted: 'removed' };

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      {/* Left: file lists */}
      <div style={{ flex:1, borderRight:'1px solid #2a2a2a', display:'flex', flexDirection:'column', overflowY:'auto' }}>
        {/* Staged */}
        <PanelHeader title={`Staged (${localStaged.length})`} />
        <div style={{ padding:'4px 0 8px' }}>
          {localStaged.length === 0
            ? <div style={{ padding:'8px 16px', fontSize:12, color:'#484848', fontStyle:'italic' }}>No staged changes</div>
            : localStaged.map(f => (
              <div key={f.file} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', borderBottom:'1px solid #1f1f1f' }}>
                <Badge type={statusType[f.status]}>{statusLabel[f.status]}</Badge>
                <span style={{ fontFamily:"'Space Mono', monospace", fontSize:12, color:'#c0c0c0', flex:1 }}>{f.file}</span>
                {f.summary && <span style={{ fontSize:11, color:'#484848' }}>{f.summary}</span>}
                <button onClick={() => unstageFile(f.file)} style={{ background:'none', border:'1px solid #2a2a2a', borderRadius:2, color:'#8a8a8a', fontSize:11, padding:'2px 8px', cursor:'pointer', fontFamily:"'Bauhaus', sans-serif", transition:'background 100ms' }}>Unstage</button>
              </div>
            ))
          }
        </div>

        {/* Unstaged */}
        <PanelHeader title={`Unstaged (${localUnstaged.length})`} />
        <div style={{ padding:'4px 0 8px' }}>
          {localUnstaged.length === 0
            ? <div style={{ padding:'8px 16px', fontSize:12, color:'#484848', fontStyle:'italic' }}>Working tree clean</div>
            : localUnstaged.map(f => (
              <div key={f.file} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', borderBottom:'1px solid #1f1f1f' }}>
                <Badge type={statusType[f.status]}>{statusLabel[f.status]}</Badge>
                <span style={{ fontFamily:"'Space Mono', monospace", fontSize:12, color:'#8a8a8a', flex:1 }}>{f.file}</span>
                <button onClick={() => stageFile(f.file)} style={{ background:'oklch(55% 0.16 22 / 15%)', border:'1px solid oklch(55% 0.16 22 / 30%)', borderRadius:2, color:'oklch(62% 0.18 22)', fontSize:11, padding:'2px 8px', cursor:'pointer', fontFamily:"'Bauhaus', sans-serif", transition:'background 100ms' }}>Stage</button>
              </div>
            ))
          }
        </div>

        {/* Untracked */}
        {localUntracked.length > 0 && <>
          <PanelHeader title={`Untracked (${localUntracked.length})`} />
          <div style={{ padding:'4px 0 8px' }}>
            {localUntracked.map(f => (
              <div key={f} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', borderBottom:'1px solid #1f1f1f' }}>
                <Badge type="neutral">?</Badge>
                <span style={{ fontFamily:"'Space Mono', monospace", fontSize:12, color:'#484848', flex:1 }}>{f}</span>
              </div>
            ))}
          </div>
        </>}
      </div>

      {/* Right: commit composer */}
      <div style={{ width:280, display:'flex', flexDirection:'column', flexShrink:0 }}>
        <PanelHeader title="Commit" />
        <div style={{ padding:14, flex:1, display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:500, color:'#484848', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:5, fontFamily:"'Bauhaus', sans-serif" }}>Message</div>
            <textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder="add intro riff"
              style={{ width:'100%', background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, color:'#f0f0f0', fontFamily:"'Bauhaus', sans-serif", fontSize:13, padding:'8px 10px', outline:'none', resize:'vertical', minHeight:80, lineHeight:1.5, transition:'border-color 100ms, box-shadow 100ms', boxSizing:'border-box' }}
              onFocus={e => { e.target.style.borderColor='oklch(55% 0.16 22 / 70%)'; e.target.style.boxShadow='0 0 0 2px oklch(55% 0.16 22 / 25%)'; }}
              onBlur={e => { e.target.style.borderColor='#2a2a2a'; e.target.style.boxShadow='none'; }}
            />
            <div style={{ fontSize:11, color:'#484848', marginTop:4 }}>Imperative mood — "add", "fix", "update"</div>
          </div>
          <div style={{ background:'#141414', border:'1px solid #1f1f1f', borderRadius:2, padding:'8px 10px' }}>
            <div style={{ fontSize:10, color:'#484848', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Summary</div>
            <div style={{ fontSize:12, color: localStaged.length > 0 ? '#8a8a8a' : '#484848', fontFamily:"'Space Mono', monospace" }}>
              {localStaged.length > 0 ? `${localStaged.length} file${localStaged.length > 1 ? 's' : ''} staged` : 'Nothing staged'}
            </div>
          </div>
          <button
            onClick={doCommit}
            disabled={!msg.trim() || localStaged.length === 0}
            style={{ background: committed ? 'oklch(58% 0.13 145)' : 'oklch(55% 0.16 22)', color:'#f0f0f0', border:'none', borderRadius:2, height:36, fontSize:13, fontWeight:500, fontFamily:"'Bauhaus', sans-serif", cursor: !msg.trim() || localStaged.length === 0 ? 'not-allowed' : 'pointer', opacity: !msg.trim() || localStaged.length === 0 ? 0.4 : 1, transition:'background 150ms, opacity 150ms', marginTop:'auto' }}>
            {committed ? '✓ Committed' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Diff View ─────────────────────────────────────────────────
function DiffView({ commits }) {
  const [base, setBase] = React.useState(commits[2].hash);
  const [head, setHead] = React.useState(commits[0].hash);

  const BARS = 16;
  const diffMap = { 3:  'added', 5: 'changed', 6: 'changed', 9: 'removed', 12: 'changed', 13: 'added' };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <PanelHeader title="Diff" right={
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'#484848' }}>base</span>
          <select value={base} onChange={e => setBase(e.target.value)}
            style={{ background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, color:'#8a8a8a', fontFamily:"'Space Mono', monospace", fontSize:11, padding:'3px 6px', outline:'none' }}>
            {commits.map(c => <option key={c.hash} value={c.hash}>{c.hash} — {c.msg.slice(0,24)}</option>)}
          </select>
          <span style={{ fontSize:11, color:'#484848' }}>head</span>
          <select value={head} onChange={e => setHead(e.target.value)}
            style={{ background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, color:'#8a8a8a', fontFamily:"'Space Mono', monospace", fontSize:11, padding:'3px 6px', outline:'none' }}>
            {commits.map(c => <option key={c.hash} value={c.hash}>{c.hash} — {c.msg.slice(0,24)}</option>)}
          </select>
        </div>
      } />

      <div style={{ padding:'16px 20px', flex:1, overflowY:'auto' }}>
        {/* Track: Lead Guitar */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, color:'#8a8a8a', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <MusicIcon /> Lead Guitar
            <span style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace", fontWeight:400, textTransform:'none', letterSpacing:0 }}>3 changes</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:4 }}>
            {Array.from({ length: BARS }).map((_, i) => {
              const type = diffMap[i] || 'equal';
              const sym = { added:'+', removed:'−', changed:'~', equal:'=' }[type];
              const colors = {
                added:   { bg:'oklch(58% 0.13 145 / 12%)', border:'oklch(58% 0.13 145 / 40%)', color:'oklch(58% 0.13 145)' },
                removed: { bg:'oklch(55% 0.16 22 / 12%)',  border:'oklch(55% 0.16 22 / 40%)',  color:'oklch(62% 0.18 22)' },
                changed: { bg:'oklch(65% 0.14 60 / 12%)',  border:'oklch(65% 0.14 60 / 40%)',  color:'oklch(65% 0.14 60)' },
                equal:   { bg:'#141414',                    border:'#1f1f1f',                   color:'#333' },
              }[type];
              return (
                <div key={i} style={{ height:44, background:colors.bg, border:`1px solid ${colors.border}`, borderRadius:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'opacity 100ms' }}
                  onMouseEnter={e => e.currentTarget.style.opacity='0.75'}
                  onMouseLeave={e => e.currentTarget.style.opacity='1'}>
                  <span style={{ fontSize:13, fontWeight:700, color:colors.color, fontFamily:"'Space Mono', monospace" }}>{sym}</span>
                  <span style={{ fontSize:9, color:colors.color, opacity:0.6, fontFamily:"'Space Mono', monospace" }}>{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Track: Bass */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, color:'#8a8a8a', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <MusicIcon /> Bass
            <span style={{ fontSize:11, color:'#484848', fontFamily:"'Space Mono', monospace", fontWeight:400, textTransform:'none', letterSpacing:0 }}>1 change</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:4 }}>
            {Array.from({ length: BARS }).map((_, i) => {
              const type = i === 5 ? 'changed' : 'equal';
              const colors = type === 'changed'
                ? { bg:'oklch(65% 0.14 60 / 12%)', border:'oklch(65% 0.14 60 / 40%)', color:'oklch(65% 0.14 60)' }
                : { bg:'#141414', border:'#1f1f1f', color:'#333' };
              return (
                <div key={i} style={{ height:44, background:colors.bg, border:`1px solid ${colors.border}`, borderRadius:2, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:colors.color, fontFamily:"'Space Mono', monospace" }}>{type === 'changed' ? '~' : '='}</span>
                  <span style={{ fontSize:9, color:colors.color, opacity:0.6, fontFamily:"'Space Mono', monospace" }}>{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
        {/* Legend */}
        <div style={{ display:'flex', gap:16, paddingTop:8, borderTop:'1px solid #1f1f1f' }}>
          {[['added','oklch(58% 0.13 145)','+'],['removed','oklch(62% 0.18 22)','−'],['changed','oklch(65% 0.14 60)','~'],['equal','#333','=']].map(([label,color,sym]) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#484848' }}>
              <span style={{ fontFamily:"'Space Mono', monospace", color, fontSize:12, fontWeight:700 }}>{sym}</span> {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Merge View ────────────────────────────────────────────────
function MergeView() {
  const [resolved, setResolved] = React.useState({});
  const conflicts = [
    { bar: 6, track: 'Lead Guitar' },
    { bar: 9, track: 'Lead Guitar' },
  ];
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <PanelHeader title="Merge conflicts" right={
        <span style={{ fontSize:11, color:'oklch(62% 0.18 22)', fontFamily:"'Space Mono', monospace" }}>{conflicts.length - Object.keys(resolved).length} unresolved</span>
      } />
      <div style={{ padding:20, flex:1, overflowY:'auto' }}>
        {conflicts.map((c, i) => {
          const key = `${c.track}-${c.bar}`;
          const res = resolved[key];
          return (
            <div key={key} style={{ marginBottom:16, background:'#141414', border:`1px solid ${res ? '#2a2a2a' : 'oklch(55% 0.16 22 / 40%)'}`, borderRadius:2, overflow:'hidden', opacity: res ? 0.6 : 1, transition:'opacity 150ms' }}>
              <div style={{ padding:'8px 14px', borderBottom:'1px solid #2a2a2a', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:12, color:'#8a8a8a', fontWeight:500 }}>{c.track}</span>
                <span style={{ fontFamily:"'Space Mono', monospace", fontSize:11, color:'#484848' }}>bar {c.bar}</span>
                {res && <Badge type="added">resolved — {res}</Badge>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0 }}>
                {['ours', 'base', 'theirs'].map(side => (
                  <div key={side} style={{ padding:'10px 14px', borderRight: side !== 'theirs' ? '1px solid #2a2a2a' : 'none' }}>
                    <div style={{ fontSize:10, color:'#484848', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>{side}</div>
                    {/* mini staff placeholder */}
                    <div style={{ height:60, background:'#0f0f0f', borderRadius:2, border:'1px solid #1f1f1f', display:'flex', flexDirection:'column', justifyContent:'space-around', padding:'4px 8px' }}>
                      {Array.from({length:6}).map((_,si) => (
                        <div key={si} style={{ height:1, background:'#2a2a2a', position:'relative' }}>
                          {si === 2 && side !== 'base' && <span style={{ position:'absolute', left: side==='ours' ? '30%' : '55%', top:-7, fontFamily:"'Space Mono', monospace", fontSize:10, color:'#f0f0f0', background:'#1c1c1c', border:'1px solid #2a2a2a', borderRadius:2, padding:'0 3px' }}>{side==='ours' ? '7' : '5'}</span>}
                        </div>
                      ))}
                    </div>
                    {side !== 'base' && (
                      <button onClick={() => setResolved(prev => ({ ...prev, [key]: side }))} disabled={!!res}
                        style={{ marginTop:8, width:'100%', background: res === side ? 'oklch(58% 0.13 145 / 20%)' : '#1c1c1c', border:`1px solid ${res === side ? 'oklch(58% 0.13 145 / 50%)' : '#2a2a2a'}`, borderRadius:2, color: res === side ? 'oklch(58% 0.13 145)' : '#8a8a8a', fontSize:11, padding:'4px', cursor: res ? 'default' : 'pointer', fontFamily:"'Bauhaus', sans-serif", transition:'all 100ms' }}>
                        {res === side ? '✓ chosen' : `Keep ${side}`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {Object.keys(resolved).length === conflicts.length && (
          <button style={{ background:'oklch(55% 0.16 22)', color:'#f0f0f0', border:'none', borderRadius:2, height:36, fontSize:13, fontWeight:500, padding:'0 20px', cursor:'pointer', fontFamily:"'Bauhaus', sans-serif" }}>
            Mark resolved &amp; commit merge
          </button>
        )}
      </div>
    </div>
  );
}

// ── Open Repo View ────────────────────────────────────────────
function OpenRepoView({ onOpen }) {
  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:24 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:"'Space Mono', monospace", fontWeight:700, fontSize:48, color:'#f0f0f0', letterSpacing:'-0.04em', marginBottom:8 }}>
          gp<span style={{ color:'oklch(62% 0.18 22)' }}>t</span>
        </div>
        <div style={{ fontSize:14, color:'#484848', letterSpacing:'0.04em' }}>git for musicians</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:280 }}>
        <button onClick={onOpen} style={{ background:'oklch(55% 0.16 22)', color:'#f0f0f0', border:'none', borderRadius:2, height:40, fontSize:14, fontWeight:500, cursor:'pointer', fontFamily:"'Bauhaus', sans-serif", transition:'background 150ms' }}
          onMouseEnter={e => e.target.style.background='oklch(62% 0.18 22)'}
          onMouseLeave={e => e.target.style.background='oklch(55% 0.16 22)'}>
          Open repository
        </button>
        <button style={{ background:'#1c1c1c', color:'#8a8a8a', border:'1px solid #2a2a2a', borderRadius:2, height:40, fontSize:14, fontWeight:500, cursor:'pointer', fontFamily:"'Bauhaus', sans-serif", transition:'background 150ms' }}>
          Init new repository
        </button>
      </div>
      <div style={{ fontSize:11, color:'#333', fontFamily:"'Space Mono', monospace", textAlign:'center' }}>
        gpt init &amp;&amp; gpt add song.gp &amp;&amp; gpt commit -m "init"
      </div>
    </div>
  );
}

Object.assign(window, { HistoryView, StatusView, DiffView, MergeView, OpenRepoView, Badge, SectionLabel, PanelHeader });

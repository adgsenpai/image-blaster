import { useRoomEditor } from '../store/roomEditor'
import { itemLabel, PALETTE } from '../modules/game/roomItems'

const btn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#eee',
  font: '11px ui-monospace, monospace', padding: '4px 7px', borderRadius: 4, cursor: 'pointer', textAlign: 'left',
}

/** Side panel for the in-game room editor (F2 while indoors). */
export function RoomEditorPanel() {
  const s = useRoomEditor()
  if (!s.on) return null
  const sel = s.items.find((i) => i.id === s.selected)
  const deg = (r: number) => Math.round((r * 180) / Math.PI)
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 54, right: 12, width: 250, maxHeight: 'calc(100% - 120px)', overflowY: 'auto',
        background: 'rgba(12,10,9,0.86)', border: '1px solid rgba(255,210,63,0.35)', borderRadius: 8,
        padding: 10, color: '#ddd', font: '11px ui-monospace, monospace', zIndex: 30, pointerEvents: 'auto',
      }}
    >
      <div style={{ color: '#ffd23f', fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>ROOM EDITOR</div>
      <div style={{ opacity: 0.75, marginBottom: 8 }}>{s.status}{s.dirty ? ' · unsaved' : ''}</div>

      <div style={{ marginBottom: 8, padding: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
        {sel ? (
          <>
            <div style={{ color: '#fff' }}>{itemLabel(sel)}</div>
            <div>pos {sel.at.map((v) => v.toFixed(2)).join(', ')}</div>
            <div>rot {deg(sel.rotY)}°  scale {(sel.scale ?? 1).toFixed(2)}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => s.setMode('translate')}>{s.mode === 'translate' ? '▸ ' : ''}move</button>
              <button style={btn} onClick={() => s.setMode('rotate')}>{s.mode === 'rotate' ? '▸ ' : ''}rotate</button>
              <button style={btn} onClick={() => s.update(sel.id, { at: [sel.at[0], 0, sel.at[2]] })}>to floor</button>
              <button style={btn} onClick={s.duplicate}>dup</button>
              <button style={{ ...btn, color: '#ff8a7a' }} onClick={s.remove}>delete</button>
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.7 }}>click a prop to select it</div>
        )}
      </div>

      <div style={{ color: '#ffd23f', margin: '6px 0 4px' }}>ADD</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {PALETTE.map((p) => (
          <button key={p.label} style={btn} onClick={() => s.add(p.type, p.extra)}>{p.label}</button>
        ))}
      </div>
      {s.assets.length > 0 && (
        <>
          <div style={{ color: '#ffd23f', margin: '8px 0 4px' }}>MODELS</div>
          <div style={{ display: 'grid', gap: 3 }}>
            {s.assets.map((url) => (
              <button key={url} style={btn} title={url} onClick={() => s.add('glb', { url })}>
                {url.split('/').slice(-2).join('/')}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
        <button style={{ ...btn, background: '#3b2f0b', borderColor: '#ffd23f' }} onClick={() => void s.save()}>save (ctrl+s)</button>
        <button style={btn} onClick={s.undoLast}>undo</button>
        <button style={btn} onClick={() => s.setSnap(!s.snap)}>snap {s.snap ? 'on' : 'off'}</button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.65, lineHeight: 1.5 }}>
        WASD walk · right-drag look<br />
        click select · drag gizmo<br />
        G move · R rotate · X snap · [ ] scale<br />
        Del delete · Ctrl+D dup · Ctrl+Z undo<br />
        Ctrl+S save · F2 / Esc exit
      </div>
    </div>
  )
}

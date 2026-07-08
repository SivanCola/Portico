import type { ShelfItem } from '@shared/types.js'

interface Props {
  items: ShelfItem[]
  onRepaste: (item: ShelfItem) => void
  onCopyPath: (item: ShelfItem) => void
  onClear: () => void
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function ImageShelf({ items, onRepaste, onCopyPath, onClear }: Props) {
  return (
    <aside className="shelf">
      <header>
        <h3>Image Shelf</h3>
        <button className="btn ghost" onClick={onClear} disabled={items.length === 0} title="Clear local list">
          Clear
        </button>
      </header>
      <div className="list">
        {items.length === 0 && <div className="empty">Pasted images appear here. Copy a screenshot, then ⌘⇧V.</div>}
        {items.map((item) => (
          <div key={item.id} className={`shelf-item ${item.status === 'failed' ? 'failed' : ''}`}>
            <div className="thumb">
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.remotePath} />
              ) : item.status === 'uploading' ? (
                'Uploading…'
              ) : item.status === 'failed' ? (
                'Failed'
              ) : (
                <span style={{ fontFamily: 'var(--mono)' }}>{item.ext}</span>
              )}
            </div>
            <div className="meta">
              <div className="path">{item.remotePath || '—'}</div>
              <div className="sub">
                <span>
                  {item.bytes ? fmtBytes(item.bytes) : ''}
                  {item.uploadedAt ? ` · ${new Date(item.uploadedAt).toLocaleTimeString()}` : ''}
                </span>
                <span className={`badge ${item.status}`}>{item.status}</span>
              </div>
              {item.error && <div style={{ color: 'var(--err)' }}>{item.error}</div>}
            </div>
            <div className="actions">
              <button className="btn" onClick={() => onRepaste(item)} disabled={item.status !== 'ready'}>
                Paste again
              </button>
              <button className="btn ghost" onClick={() => onCopyPath(item)} disabled={!item.remotePath}>
                Copy path
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

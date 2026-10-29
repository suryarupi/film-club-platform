import type { Seat } from '../api';

const SIZE = 36, GAP = 6;

// Each state has its own symbol and look, so nothing depends on colour alone.
const LOOK: Record<Seat['state'] | 'SELECTED', { cls: string; glyph: string; text: string }> = {
  AVAILABLE: { cls: 'border-zinc-500 bg-panel text-zinc-200 hover:border-gold', glyph: '', text: 'available' },
  SELECTED: { cls: 'border-gold bg-gold font-bold text-ink', glyph: '✓', text: 'selected' },
  BOOKED: { cls: 'border-zinc-800 bg-zinc-800 text-zinc-500', glyph: '✕', text: 'already booked' },
  DISABLED: { cls: 'border-dashed border-zinc-700 text-zinc-600', glyph: '–', text: 'not available' },
  RESERVED: { cls: 'border-dashed border-zinc-600 text-zinc-500', glyph: 'R', text: 'reserved' },
  VIP: { cls: 'border-dashed border-zinc-600 text-zinc-500', glyph: '★', text: 'reserved for guests' },
};

interface Props { seats: Seat[]; selected?: string[]; onToggle?: (s: Seat) => void }

/** Draws any layout (aisles, gaps, irregular rows) because each seat carries its own grid position. */
export default function SeatMap({ seats, selected = [], onToggle }: Props) {
  if (seats.length === 0) return null;
  const cols = Math.max(...seats.map((s) => s.x)) + 1;
  const rowLabel = new Map<number, string>();
  seats.forEach((s) => { if (!rowLabel.has(s.y)) rowLabel.set(s.y, s.row); });
  const sorted = [...seats].sort((a, b) => a.y - b.y || a.x - b.x);
  const width = 34 + cols * SIZE + (cols - 1) * GAP;

  return (
    <div>
      <div className="overflow-x-auto pb-3">
        <div className="mx-auto" style={{ width }}>
          <div aria-hidden className="mx-auto mb-8 h-2 rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" style={{ width: '80%' }} />
          <p aria-hidden className="-mt-6 mb-6 text-center text-xs tracking-[0.4em] text-muted">SCREEN</p>
          <div role="group" aria-label="Seat map" className="grid"
            style={{ gridTemplateColumns: `28px repeat(${cols}, ${SIZE}px)`, gap: GAP }}>
            {[...rowLabel.entries()].map(([y, label]) => (
              <span key={`r${y}`} aria-hidden className="flex items-center text-xs text-muted" style={{ gridColumn: 1, gridRow: y + 1 }}>{label}</span>
            ))}
            {sorted.map((s) => {
              const isSel = selected.includes(s.id);
              const look = LOOK[isSel ? 'SELECTED' : s.state];
              const pickable = !!onToggle && (s.state === 'AVAILABLE' || isSel);
              return (
                <button
                  key={s.id} type="button"
                  aria-label={`Seat ${s.label}, ${look.text}`}
                  aria-pressed={onToggle && s.state === 'AVAILABLE' ? isSel : undefined}
                  aria-disabled={!pickable}
                  tabIndex={onToggle ? undefined : -1}
                  onClick={() => pickable && onToggle!(s)}
                  className={`flex items-center justify-center rounded-md border text-[10px] transition ${look.cls} ${pickable ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{ width: SIZE, height: SIZE, gridColumn: s.x + 2, gridRow: s.y + 1 }}
                >
                  {look.glyph || s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted" aria-label="Legend">
        {(['AVAILABLE', 'SELECTED', 'BOOKED', 'DISABLED'] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] ${LOOK[k].cls}`}>{LOOK[k].glyph}</span>
            {k === 'AVAILABLE' ? 'Available' : k === 'SELECTED' ? 'Your seat' : k === 'BOOKED' ? 'Booked' : 'Not available'}
          </li>
        ))}
      </ul>
    </div>
  );
}

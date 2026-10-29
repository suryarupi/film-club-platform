import { Link } from 'react-router-dom';
import type { Screening } from '../api';
import { STATUS, fmtDay, fmtTime } from '../utils';
import Poster from './Poster';
import StatusBadge from './StatusBadge';

export default function ScreeningCard({ s }: { s: Screening }) {
  const st = STATUS[s.status];
  return (
    <Link to={`/screenings/${s.id}`} className="group block overflow-hidden rounded-xl border border-line bg-panel transition hover:-translate-y-1 hover:border-gold/60">
      <div className="overflow-hidden">
        <Poster title={s.filmName} url={s.posterUrl} className="aspect-[2/3] w-full transition duration-500 group-hover:scale-105" />
      </div>
      <div className="space-y-2 p-4">
        <StatusBadge status={s.status} />
        <h3 className="font-display text-2xl leading-tight">{s.filmName}</h3>
        <p className="text-sm text-muted">{fmtDay(s.startsAt)} · {fmtTime(s.startsAt)}<br />{s.venue.name}</p>
        <p className="text-sm">{s.booked} / {s.capacity} seats booked</p>
        {s.status === 'ALMOST_FULL' && (
          <p className="text-sm font-semibold text-amber-300">Only {s.available} seat{s.available === 1 ? '' : 's'} left</p>
        )}
        <span className={`mt-2 block rounded-lg py-2 text-center text-sm font-semibold ${st.canBook ? 'bg-gold text-ink' : 'bg-line text-muted'}`}>
          {st.canBook ? 'Book Now' : s.status === 'FULL' ? 'Fully Booked' : st.label}
        </span>
      </div>
    </Link>
  );
}

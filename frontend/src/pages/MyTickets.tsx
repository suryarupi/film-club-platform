import { Link } from 'react-router-dom';
import { fmtDate, fmtTime, getSavedTickets } from '../utils';

export default function MyTickets() {
  const tickets = getSavedTickets();
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="font-display text-6xl">My tickets</h1>
      <p className="mt-2 text-sm text-muted">Tickets booked on this device. If you booked on another phone or browser, open its ticket link there.</p>
      {tickets.length === 0 ? (
        <p className="mt-8 text-zinc-300">No tickets yet. <Link to="/screenings" className="text-gold underline">Find a screening</Link></p>
      ) : (
        <ul className="mt-8 space-y-3">
          {tickets.map((t) => (
            <li key={t.token}>
              <Link to={`/ticket/${encodeURIComponent(t.token)}`} className="block rounded-xl border border-line bg-panel p-4 transition hover:border-gold">
                <p className="font-display text-3xl">{t.film}</p>
                <p className="text-sm text-muted">{fmtDate(t.startsAt)} · {fmtTime(t.startsAt)} · Seats {t.seats.join(', ')}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

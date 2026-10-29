import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLoad } from '../hooks';
import { STATUS, fmtDate, fmtDateTime, fmtTime } from '../utils';
import { ErrorBox, Loading } from '../components/Feedback';
import Poster from '../components/Poster';
import SeatMap from '../components/SeatMap';
import StatusBadge from '../components/StatusBadge';

const isVideoFile = (u: string) => /\.(mp4|webm)(\?|$)/i.test(u);

export default function ScreeningDetail() {
  const { id = '' } = useParams();
  const sc = useLoad(() => api.getScreening(id), [id]);
  const seats = useLoad(() => api.getSeats(id), [id]);
  const s = sc.data;

  if (sc.loading) return <Loading label="Loading screening…" />;
  if (sc.error || !s) return <ErrorBox message={sc.error || 'Screening not found.'} onRetry={sc.reload} />;
  const st = STATUS[s.status];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to="/screenings" className="text-sm text-muted hover:text-gold">← All screenings</Link>
      <div className="mt-6 grid gap-8 md:grid-cols-[300px_1fr]">
        <Poster title={s.filmName} url={s.posterUrl} className="aspect-[2/3] w-full rounded-xl" />
        <div className="space-y-4">
          <StatusBadge status={s.status} />
          <h1 className="font-display text-6xl leading-none">{s.filmName}</h1>
          <p className="text-zinc-300">{s.description}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Date</dt><dd className="text-lg">{fmtDate(s.startsAt)}</dd></div>
            <div><dt className="text-muted">Time</dt><dd className="text-lg">{fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}</dd></div>
            <div><dt className="text-muted">Venue</dt><dd className="text-lg">{s.venue.name}</dd>{s.venue.description && <dd className="text-muted">{s.venue.description}</dd>}</div>
            <div><dt className="text-muted">Seats</dt><dd className="text-lg">{s.booked} / {s.capacity} booked · {s.available} available</dd></div>
          </dl>

          <div className="rounded-xl border border-line bg-panel p-4 text-sm">
            <h2 className="font-semibold">Booking rules</h2>
            <ul className="mt-2 list-inside list-disc space-y-1 text-zinc-300">
              <li>Book for {s.allowedBookingSizes.map((n) => (n === 1 ? '1 person' : `${n} people`)).join(', ')}.</li>
              <li>Booking opens {fmtDateTime(s.bookingOpensAt)} and closes {fmtDateTime(s.bookingClosesAt)}.</li>
              <li>You will get a QR ticket. Show it at the entrance.</li>
            </ul>
          </div>

          {s.trailerUrl && (isVideoFile(s.trailerUrl)
            ? <video controls preload="none" className="w-full rounded-xl border border-line" src={s.trailerUrl} />
            : <a href={s.trailerUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-line px-4 py-2 text-sm hover:border-gold">▶ Watch trailer</a>)}

          <div>
            {st.canBook
              ? <Link to={`/screenings/${s.id}/book`} className="inline-block rounded-lg bg-gold px-8 py-3 font-semibold text-ink">Book Seats</Link>
              : <span className="inline-block rounded-lg bg-line px-8 py-3 font-semibold text-muted">{s.status === 'FULL' ? 'Fully Booked' : st.label}</span>}
          </div>
        </div>
      </div>

      <section className="mt-14" aria-labelledby="seating">
        <h2 id="seating" className="mb-6 font-display text-3xl">Seating</h2>
        {seats.loading && <Loading label="Checking seat availability…" />}
        {seats.error && <ErrorBox message={seats.error} onRetry={seats.reload} />}
        {seats.data && <SeatMap seats={seats.data} />}
      </section>
    </div>
  );
}

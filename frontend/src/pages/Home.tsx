import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useLoad } from '../hooks';
import { CLUB, STATUS, fmtDate, fmtTime } from '../utils';
import { ErrorBox, Loading } from '../components/Feedback';
import Poster from '../components/Poster';
import Reveal from '../components/Reveal';
import ScreeningCard from '../components/ScreeningCard';
import StatusBadge from '../components/StatusBadge';

export default function Home() {
  const { data, error, loading, reload } = useLoad(api.getScreenings, []);
  const all = data ?? [];
  const upcoming = all.filter((s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED');
  const past = all.filter((s) => s.status === 'COMPLETED').reverse().slice(0, 8);
  const featured = upcoming.find((s) => STATUS[s.status].canBook) ?? upcoming[0];

  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="hero-glow absolute -inset-20 opacity-60"
          style={{ background: 'radial-gradient(ellipse at 20% 30%, rgba(232,182,74,.28), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(120,60,160,.22), transparent 55%)' }} />
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 sm:pt-28">
          <h1 className="font-display text-7xl leading-[0.9] sm:text-9xl">
            {['FILMS.', 'STORIES.', 'EXPERIENCES.'].map((w, i) => (
              <motion.span key={w} className={`block ${i === 2 ? 'text-gold' : ''}`}
                initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 * i, duration: 0.7 }}>{w}</motion.span>
            ))}
          </h1>
          <p className="mt-6 max-w-md text-lg text-zinc-300">Welcome to the College Film Club. Free screenings, reserved seats, and a QR ticket on your phone.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#upcoming" className="rounded-lg bg-gold px-6 py-3 font-semibold text-ink transition hover:brightness-110">Explore Screenings</a>
            <Link to="/my-tickets" className="rounded-lg border border-line px-6 py-3 font-semibold transition hover:border-gold">My tickets</Link>
          </div>
        </div>
        <div className="filmstrip" aria-hidden />
      </section>

      {loading && <Loading label="Loading screenings…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {featured && (
        <section className="mx-auto mt-16 max-w-6xl px-4" aria-labelledby="featured">
          <Reveal>
            <p className="text-sm tracking-[0.3em] text-gold">FEATURED SCREENING</p>
            <div className="mt-4 grid gap-8 overflow-hidden rounded-2xl border border-line bg-panel p-5 md:grid-cols-[320px_1fr] md:p-8">
              <Poster title={featured.filmName} url={featured.posterUrl} className="aspect-[2/3] w-full rounded-xl" />
              <div className="flex flex-col justify-center gap-4">
                <StatusBadge status={featured.status} />
                <h2 id="featured" className="font-display text-5xl sm:text-6xl">{featured.filmName}</h2>
                <p className="text-zinc-300">{featured.description}</p>
                <p className="text-muted">{fmtDate(featured.startsAt)} · {fmtTime(featured.startsAt)} · {featured.venue.name}</p>
                <p>{featured.booked} / {featured.capacity} seats booked{featured.status === 'ALMOST_FULL' ? ` — only ${featured.available} left` : ''}</p>
                <div className="flex gap-3">
                  <Link to={STATUS[featured.status].canBook ? `/screenings/${featured.id}/book` : `/screenings/${featured.id}`}
                    className="rounded-lg bg-gold px-6 py-3 font-semibold text-ink">{STATUS[featured.status].canBook ? 'Book Seats' : 'View details'}</Link>
                  <Link to={`/screenings/${featured.id}`} className="rounded-lg border border-line px-6 py-3 font-semibold hover:border-gold">Details</Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      )}

      <section id="upcoming" className="mx-auto mt-20 max-w-6xl scroll-mt-20 px-4" aria-labelledby="upcoming-h">
        <div className="flex items-end justify-between">
          <h2 id="upcoming-h" className="font-display text-5xl">Upcoming screenings</h2>
          <Link to="/screenings" className="text-sm text-gold hover:underline">See all</Link>
        </div>
        {!loading && !error && upcoming.length === 0 && <p className="mt-6 text-muted">No screenings are scheduled right now. Check back soon!</p>}
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.slice(0, 4).map((s, i) => <Reveal key={s.id} delay={i * 0.07}><ScreeningCard s={s} /></Reveal>)}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-3xl px-4 text-center" aria-labelledby="club">
        <Reveal>
          <p className="text-sm tracking-[0.3em] text-gold">THE CLUB</p>
          <h2 id="club" className="mt-2 font-display text-5xl">Lights down. Phones away.</h2>
          <p className="mt-4 text-lg text-zinc-300">{CLUB.about}</p>
        </Reveal>
      </section>

      {past.length > 0 && (
        <section className="mx-auto mt-24 max-w-6xl px-4" aria-labelledby="past">
          <h2 id="past" className="font-display text-4xl">Past screenings</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {past.map((s) => (
              <Link key={s.id} to={`/screenings/${s.id}`} className="group block" aria-label={s.filmName}>
                <Poster title={s.filmName} url={s.posterUrl} className="aspect-[2/3] w-full rounded-lg opacity-70 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

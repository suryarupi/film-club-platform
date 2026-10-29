import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorBox, Loading } from '../components/Feedback';
import ScreeningCard from '../components/ScreeningCard';

export default function Screenings() {
  const { data, error, loading, reload } = useLoad(api.getScreenings, []);
  const upcoming = (data ?? []).filter((s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED');
  const past = (data ?? []).filter((s) => s.status === 'COMPLETED' || s.status === 'CANCELLED').reverse();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-display text-6xl">Screenings</h1>
      {loading && <Loading label="Loading screenings…" />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          <h2 className="mt-10 font-display text-3xl text-gold">Upcoming</h2>
          {upcoming.length === 0 && <p className="mt-4 text-muted">No upcoming screenings yet.</p>}
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{upcoming.map((s) => <ScreeningCard key={s.id} s={s} />)}</div>
          {past.length > 0 && (
            <>
              <h2 className="mt-14 font-display text-3xl text-muted">Past</h2>
              <div className="mt-4 grid gap-5 opacity-80 sm:grid-cols-2 lg:grid-cols-4">{past.map((s) => <ScreeningCard key={s.id} s={s} />)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

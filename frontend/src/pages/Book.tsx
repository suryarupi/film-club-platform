import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, type FormField, type Seat } from '../api';
import { useLoad } from '../hooks';
import { STATUS, fmtDate, fmtTime, loadProfile, saveProfile, saveTicket, uuid } from '../utils';
import { ErrorBox, Loading } from '../components/Feedback';
import SeatMap from '../components/SeatMap';

const STEPS = ['People', 'Seats', 'Details', 'Review'];
const BASE_FIELDS: FormField[] = [
  { key: 'rollNumber', label: 'College roll number', type: 'text', required: true, validation: { pattern: '^[A-Za-z0-9-]{3,20}$' } },
  { key: 'department', label: 'Department', type: 'text', required: true, validation: { maxLength: 50 } },
];

// Friendly client-side checks. The server repeats every check and is the real authority.
function check(f: FormField, raw: string): string {
  const v = raw.trim();
  if (!v) return f.required ? 'This field is required.' : '';
  const r = f.validation;
  if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
  if (f.type === 'phone' && !/^[0-9+\-\s]{7,15}$/.test(v)) return 'Enter a valid phone number.';
  if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return 'Enter a number.';
  if (f.type === 'select' && !r.options?.includes(v)) return 'Choose one of the options.';
  if (r.minLength != null && v.length < r.minLength) return `Use at least ${r.minLength} characters.`;
  if (r.maxLength != null && v.length > r.maxLength) return `Use at most ${r.maxLength} characters.`;
  if (r.pattern && !new RegExp(r.pattern).test(v)) return 'This does not match the expected format.';
  return '';
}

function Field({ f, value, error, onChange }: { f: FormField; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `f-${f.key}`, errId = `${id}-err`;
  const cls = 'mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-base';
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {f.label}{f.required ? <span aria-hidden className="text-gold"> *</span> : <span className="text-muted"> (optional)</span>}
      </label>
      {f.type === 'select' ? (
        <select id={id} value={value} className={cls} aria-required={f.required} aria-invalid={!!error} aria-describedby={error ? errId : undefined} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {f.validation.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input id={id} value={value} className={cls} aria-required={f.required} aria-invalid={!!error} aria-describedby={error ? errId : undefined}
          type={f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'numeric' : f.type === 'email' ? 'email' : undefined}
          autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <p id={errId} role="alert" className="mt-1 text-sm text-red-300">{error}</p>}
    </div>
  );
}

export default function Book() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const sc = useLoad(() => api.getScreening(id), [id]);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [seatErr, setSeatErr] = useState('');
  const [step, setStep] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const profile = useMemo(loadProfile, []);
  const [values, setValues] = useState<Record<string, string>>({ rollNumber: profile.rollNumber ?? '', department: profile.department ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  const key = useRef(uuid()); // one key per booking attempt: double clicks and retries can never create two bookings
  const pickedRef = useRef<string[]>([]);
  pickedRef.current = picked;

  const refreshSeats = useCallback(async () => {
    try {
      const s = await api.getSeats(id);
      setSeats(s); setSeatErr('');
      const free = pickedRef.current.filter((p) => s.find((x) => x.id === p)?.state === 'AVAILABLE');
      if (free.length < pickedRef.current.length) {
        setPicked(free);
        setNotice('A seat you picked was just booked by someone else. Please choose again.');
      }
    } catch (e) { setSeatErr((e as Error).message); }
  }, [id]);
  useEffect(() => { refreshSeats(); }, [refreshSeats]);
  useEffect(() => {
    if (step !== 1) return;
    const t = setInterval(refreshSeats, 10000);
    return () => clearInterval(t);
  }, [step, refreshSeats]);

  const s = sc.data;
  const fields = useMemo(() => [...BASE_FIELDS, ...(s?.formFields ?? []).filter((f) => !BASE_FIELDS.some((b) => b.key === f.key))], [s]);

  if (sc.loading) return <Loading label="Loading…" />;
  if (sc.error || !s) return <ErrorBox message={sc.error || 'Screening not found.'} onRetry={sc.reload} />;
  if (!STATUS[s.status].canBook)
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-4xl">{STATUS[s.status].label}</h1>
        <p className="mt-2 text-muted">You can't book seats for this screening right now.</p>
        <Link to={`/screenings/${s.id}`} className="mt-6 inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink">Back to screening</Link>
      </div>
    );

  const pickedSeats = (seats ?? []).filter((x) => picked.includes(x.id)).sort((a, b) => a.y - b.y || a.x - b.x);

  const toggle = (seat: Seat) => {
    if (picked.includes(seat.id)) { setPicked(picked.filter((p) => p !== seat.id)); return; }
    if (size && picked.length >= size) { setNotice(`You can select up to ${size} seat${size > 1 ? 's' : ''}. Tap a selected seat to remove it.`); return; }
    setNotice(''); setPicked([...picked, seat.id]);
  };

  const validateDetails = () => {
    const e: Record<string, string> = {};
    for (const f of fields) { const m = check(f, values[f.key] ?? ''); if (m) e[f.key] = m; }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setSubmitting(true); setNotice('');
    const timer = setTimeout(() => setSlow(true), 3000);
    try {
      const formData: Record<string, string> = {};
      for (const f of fields) if (f.key !== 'rollNumber' && f.key !== 'department' && values[f.key]?.trim()) formData[f.key] = values[f.key]!.trim();
      const r = await api.createBooking(id, picked,
        { rollNumber: values.rollNumber!.trim(), department: values.department!.trim(), name: formData.name, email: formData.email },
        formData, key.current);
      saveProfile({ rollNumber: values.rollNumber!.trim(), department: values.department!.trim() });
      saveTicket({ token: r.ticketToken, film: s.filmName, seats: r.seats, startsAt: s.startsAt });
      nav(`/ticket/${encodeURIComponent(r.ticketToken)}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      setNotice(err.message);
      if (err.code === 'SEAT_TAKEN' || err.code === 'SEAT_NOT_BOOKABLE') { setPicked([]); await refreshSeats(); setStep(1); }
      else if (err.code === 'INVALID_FORM') setStep(2);
    } finally { clearTimeout(timer); setSubmitting(false); setSlow(false); }
  };

  const btn = 'rounded-lg px-6 py-3 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link to={`/screenings/${s.id}`} className="text-sm text-muted hover:text-gold">← {s.filmName}</Link>
      <h1 className="mt-4 font-display text-5xl">Book your seats</h1>
      <ol className="mt-6 flex gap-2 text-xs" aria-label="Progress">
        {STEPS.map((n, i) => (
          <li key={n} aria-current={i === step ? 'step' : undefined}
            className={`flex-1 rounded-full border px-3 py-1.5 text-center ${i === step ? 'border-gold bg-gold text-ink font-semibold' : i < step ? 'border-gold/50 text-gold' : 'border-line text-muted'}`}>
            {i < step ? '✓ ' : `${i + 1}. `}{n}
          </li>
        ))}
      </ol>

      <div aria-live="polite" className="mt-4 min-h-6">
        {notice && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{notice}</p>}
      </div>

      {step === 0 && (
        <section className="mt-4">
          <h2 className="text-xl font-semibold">How many people are coming?</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {s.allowedBookingSizes.map((n) => (
              <button key={n} aria-pressed={size === n} onClick={() => { setSize(n); setPicked(picked.slice(0, n)); }}
                className={`${btn} border ${size === n ? 'border-gold bg-gold text-ink' : 'border-line hover:border-gold'}`}>{n === 1 ? '1 Person' : `${n} People`}</button>
            ))}
          </div>
          <div className="mt-8"><button disabled={!size} onClick={() => { setNotice(''); setStep(1); }} className={`${btn} bg-gold text-ink`}>Choose seats</button></div>
        </section>
      )}

      {step === 1 && (
        <section className="mt-4">
          <h2 className="text-xl font-semibold">Pick {size} seat{size === 1 ? '' : 's'}</h2>
          <p className="text-sm text-muted">Selected {picked.length} of {size}{pickedSeats.length > 0 && `: ${pickedSeats.map((x) => x.label).join(', ')}`}</p>
          <div className="mt-6">
            {!seats && !seatErr && <Loading label="Checking seat availability…" />}
            {seatErr && <ErrorBox message={seatErr} onRetry={refreshSeats} />}
            {seats && <SeatMap seats={seats} selected={picked} onToggle={toggle} />}
          </div>
          <div className="mt-8 flex gap-3">
            <button onClick={() => setStep(0)} className={`${btn} border border-line`}>Back</button>
            <button disabled={picked.length !== size} onClick={() => { setNotice(''); setStep(2); }} className={`${btn} bg-gold text-ink`}>Continue</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="mt-4">
          <h2 className="text-xl font-semibold">Your details</h2>
          <div className="mt-4 space-y-4">
            {fields.map((f) => <Field key={f.key} f={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />)}
          </div>
          <div className="mt-8 flex gap-3">
            <button onClick={() => setStep(1)} className={`${btn} border border-line`}>Back</button>
            <button onClick={() => { if (validateDetails()) { setNotice(''); setStep(3); } }} className={`${btn} bg-gold text-ink`}>Review booking</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="mt-4">
          <h2 className="text-xl font-semibold">Review and confirm</h2>
          <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-panel text-sm">
            {([
              ['Film', s.filmName], ['Date', fmtDate(s.startsAt)], ['Time', fmtTime(s.startsAt)], ['Venue', s.venue.name],
              ['Seats', pickedSeats.map((x) => x.label).join(', ')],
              ...fields.map((f) => [f.label, values[f.key]?.trim() || '—'] as [string, string]),
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">This screening is free. Your QR ticket appears right after you confirm.</p>
          {slow && <p role="status" className="mt-3 text-sm text-amber-200">High traffic right now. Your request is being processed. Please don't close this page.</p>}
          <div className="mt-6 flex gap-3">
            <button disabled={submitting} onClick={() => setStep(2)} className={`${btn} border border-line`}>Back</button>
            <button disabled={submitting} onClick={submit} className={`${btn} bg-gold text-ink`}>{submitting ? 'Booking…' : 'Confirm booking'}</button>
          </div>
        </section>
      )}
    </div>
  );
}

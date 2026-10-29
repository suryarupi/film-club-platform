import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import { useLoad } from '../hooks';
import { fmtDate, fmtTime } from '../utils';
import { downloadTicketPng } from '../ticketImage';
import { ErrorBox, Loading } from '../components/Feedback';

const LOOK = {
  VALID: { text: 'VALID', cls: 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10' },
  USED: { text: 'USED · entry recorded', cls: 'text-amber-300 border-amber-500/50 bg-amber-500/10' },
  CANCELLED: { text: 'CANCELLED', cls: 'text-red-300 border-red-500/50 bg-red-500/10' },
} as const;

export default function Ticket() {
  const { token = '' } = useParams();
  const t = useLoad(() => api.getTicket(token), [token]);
  const [qr, setQr] = useState('');
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The QR holds a link to the validator page plus the secret ticket token. No student details inside.
    QRCode.toDataURL(`${window.location.origin}/validate/${encodeURIComponent(token)}`, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then(setQr).catch(() => setMsg('Could not draw the QR code. Reload the page.'));
  }, [token]);

  if (t.loading) return <Loading label="Loading your ticket…" />;
  if (t.error || !t.data) return <ErrorBox message={t.error || 'Ticket not found.'} onRetry={t.reload} />;
  const d = t.data, look = LOOK[d.status];

  const cancel = async () => {
    setBusy(true); setMsg('');
    try { await api.cancelTicket(token); setConfirming(false); t.reload(); setMsg('Your booking was cancelled and the seats were released.'); }
    catch (e) { setMsg((e as Error).message); setConfirming(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <article aria-label="Screening ticket" className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="h-2 bg-gold" />
        <div className="p-6 sm:p-8">
          <p className="text-xs tracking-[0.3em] text-gold">FILM CLUB · SCREENING TICKET</p>
          <h1 className="mt-2 font-display text-5xl leading-none">{d.filmName}</h1>
          <p className="mt-3 text-zinc-300">{fmtDate(d.startsAt)} · {fmtTime(d.startsAt)}</p>
          <p className="text-zinc-300">{d.venue}</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div><p className="text-xs text-muted">SEATS</p><p className="font-display text-4xl text-gold">{d.seats.join(' • ')}</p></div>
            <div><p className="text-xs text-muted">ROLL NO</p><p className="text-xl font-semibold">{d.rollNumber}</p></div>
          </div>
        </div>
        <div className="filmstrip" aria-hidden />
        <div className="flex flex-col items-center gap-4 p-6 sm:p-8">
          <div className={`rounded-xl bg-white p-3 ${d.status !== 'VALID' ? 'opacity-30' : ''}`}>
            {qr ? <img src={qr} alt="Ticket QR code. Show this at the entrance." width={240} height={240} /> : <div className="h-60 w-60" />}
          </div>
          <p className="text-sm text-muted">Ticket ID: {d.reference}</p>
          <p className={`rounded-full border px-4 py-1 text-sm font-semibold ${look.cls}`}>Status: {look.text}</p>
        </div>
      </article>

      <div aria-live="polite" className="mt-4 min-h-6">{msg && <p role="status" className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">{msg}</p>}</div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button disabled={!qr} onClick={() => downloadTicketPng(d, qr)} className="rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink disabled:opacity-40">Download ticket</button>
        <button onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setMsg('Ticket link copied.'))} className="rounded-lg border border-line px-5 py-2.5 hover:border-gold">Copy link</button>
        <Link to="/my-tickets" className="rounded-lg border border-line px-5 py-2.5 hover:border-gold">My tickets</Link>
      </div>
      <p className="mt-4 text-sm text-muted">Keep this page safe: anyone with this link can use the ticket. This device also remembers it under “My tickets”.</p>

      {d.status === 'VALID' && (
        <div className="mt-8 border-t border-line pt-6">
          {!confirming
            ? <button onClick={() => setConfirming(true)} className="text-sm text-red-300 underline">Cancel this booking</button>
            : (
              <div role="alertdialog" aria-label="Confirm cancellation" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
                <p>Cancel this booking and release your seats? This cannot be undone.</p>
                <div className="mt-3 flex gap-3">
                  <button disabled={busy} onClick={cancel} className="rounded-lg bg-red-500 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Cancelling…' : 'Yes, cancel'}</button>
                  <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-line px-4 py-2">Keep my booking</button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

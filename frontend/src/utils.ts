import type { Status } from './api';

// Edit these once and the whole site updates. Empty social links are simply hidden.
export const CLUB = {
  name: 'FILM CLUB',
  about: 'We are the college film club. Every screening is free for students: pick your seat, get a QR ticket, and walk in. Come for the film, stay for the conversation.',
  email: '', instagram: '', youtube: '',
};

const loc = 'en-IN';
export const fmtDate = (iso: string) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const fmtDay = (iso: string) => new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtTime = (iso: string) => new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;

// Status is always decided by the backend. The label (not just the colour) carries the meaning.
export const STATUS: Record<Status, { label: string; canBook: boolean; tone: string }> = {
  OPEN: { label: 'Booking open', canBook: true, tone: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' },
  ALMOST_FULL: { label: 'Almost full', canBook: true, tone: 'border-amber-500/40 bg-amber-500/15 text-amber-300' },
  FULL: { label: 'Fully booked', canBook: false, tone: 'border-red-500/40 bg-red-500/15 text-red-300' },
  NOT_OPEN: { label: 'Booking not open yet', canBook: false, tone: 'border-zinc-500/40 bg-zinc-500/15 text-zinc-300' },
  CLOSED: { label: 'Booking closed', canBook: false, tone: 'border-zinc-500/40 bg-zinc-500/15 text-zinc-300' },
  COMPLETED: { label: 'Screening completed', canBook: false, tone: 'border-zinc-600/40 bg-zinc-600/15 text-zinc-400' },
  CANCELLED: { label: 'Cancelled', canBook: false, tone: 'border-red-500/40 bg-red-500/15 text-red-300' },
};

// crypto.randomUUID() only exists on https/localhost; this also works when testing from a phone over http.
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Tickets are reachable only through their secret link, so remember them on this device.
export interface SavedTicket { token: string; film: string; seats: string[]; startsAt: string }
const TICKETS = 'fc_tickets', PROFILE = 'fc_profile';
export function getSavedTickets(): SavedTicket[] {
  try { return JSON.parse(localStorage.getItem(TICKETS) ?? '[]'); } catch { return []; }
}
export function saveTicket(t: SavedTicket) {
  try { localStorage.setItem(TICKETS, JSON.stringify([t, ...getSavedTickets().filter((x) => x.token !== t.token)].slice(0, 20))); } catch { /* private mode */ }
}
export function loadProfile(): { rollNumber?: string; department?: string } {
  try { return JSON.parse(localStorage.getItem(PROFILE) ?? '{}'); } catch { return {}; }
}
export function saveProfile(p: { rollNumber: string; department: string }) {
  try { localStorage.setItem(PROFILE, JSON.stringify(p)); } catch { /* private mode */ }
}

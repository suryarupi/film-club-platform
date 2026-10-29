// All talking to the backend goes through this file.
export type Status = 'NOT_OPEN' | 'OPEN' | 'ALMOST_FULL' | 'FULL' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';

export interface Screening {
  id: string; filmName: string; description: string; posterUrl: string | null; trailerUrl: string | null;
  venue: { name: string; description: string }; startsAt: string; endsAt: string;
  bookingOpensAt: string; bookingClosesAt: string; allowedBookingSizes: number[];
  capacity: number; booked: number; available: number; status: Status;
  formFields?: FormField[];
}
export interface FormField {
  key: string; label: string; type: 'text' | 'email' | 'phone' | 'number' | 'select'; required: boolean;
  validation: { pattern?: string; minLength?: number; maxLength?: number; options?: string[] };
}
export interface Seat { id: string; label: string; row: string; section: string; x: number; y: number; state: 'AVAILABLE' | 'BOOKED' | 'DISABLED' | 'RESERVED' | 'VIP' }
export interface TicketView {
  token: string; status: 'VALID' | 'USED' | 'CANCELLED'; reference: string; filmName: string; startsAt: string; endsAt: string;
  venue: string; rollNumber: string; seats: string[]; checkedInAt: string | null;
}
export interface BookingResult { bookingId: string; reference: string; seats: string[]; ticketToken: string; replayed: boolean }

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', ...init.headers } });
  } catch {
    throw ctrl.signal.aborted
      ? new ApiError('TIMEOUT', 'The server is taking too long to respond. Please try again.', 0)
      : new ApiError('NETWORK', 'Cannot reach the server. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Something went wrong. Please try again.', res.status);
  return body as T;
}

export const api = {
  getScreenings: async () => (await request<{ screenings: Screening[] }>('/api/screenings')).screenings,
  getScreening: (id: string) => request<Screening>(`/api/screenings/${id}`),
  getSeats: async (id: string) => (await request<{ seats: Seat[] }>(`/api/screenings/${id}/seats`)).seats,
  getTicket: (token: string) => request<TicketView>(`/api/tickets/${encodeURIComponent(token)}`),
  cancelTicket: (token: string) => request<{ ok: true }>('/api/tickets/cancel', { method: 'POST', body: JSON.stringify({ token }) }),
  createBooking: (
    screeningId: string, seatIds: string[],
    student: { rollNumber: string; department: string; name?: string; email?: string },
    formData: Record<string, string>, idempotencyKey: string,
  ) =>
    request<BookingResult>('/api/bookings', {
      method: 'POST', headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ screeningId, seatIds, student, formData }),
    }, 20000),
};

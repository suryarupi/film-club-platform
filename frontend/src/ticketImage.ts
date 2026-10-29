import type { TicketView } from './api';
import { fmtDate, fmtTime } from './utils';

/** Draws the ticket onto a canvas and downloads it as a PNG, so students can keep it in their gallery. */
export async function downloadTicketPng(t: TicketView, qrDataUrl: string) {
  const c = document.createElement('canvas');
  c.width = 1100; c.height = 460;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, 1100, 460);
  g.fillStyle = '#e8b64a'; g.fillRect(0, 0, 1100, 10);

  g.fillStyle = '#e8b64a'; g.font = '600 18px Inter, Arial, sans-serif';
  g.fillText('FILM CLUB  ·  SCREENING TICKET', 50, 62);

  let size = 72;
  do { g.font = `${size}px "Bebas Neue", Impact, sans-serif`; size -= 4; } while (g.measureText(t.filmName).width > 640 && size > 28);
  g.fillStyle = '#f4f4f5'; g.fillText(t.filmName.toUpperCase(), 50, 140);

  g.font = '500 24px Inter, Arial, sans-serif'; g.fillStyle = '#d4d4d8';
  g.fillText(`${fmtDate(t.startsAt)}  ·  ${fmtTime(t.startsAt)}`, 50, 195);
  g.fillText(t.venue, 50, 230);

  g.fillStyle = '#a1a1aa'; g.font = '600 15px Inter, Arial, sans-serif'; g.fillText('SEATS', 50, 290);
  g.fillStyle = '#e8b64a'; g.font = '48px "Bebas Neue", Impact, sans-serif'; g.fillText(t.seats.join('  •  '), 50, 335);
  g.fillStyle = '#a1a1aa'; g.font = '600 15px Inter, Arial, sans-serif'; g.fillText('ROLL NO', 50, 385);
  g.fillStyle = '#f4f4f5'; g.font = '500 24px Inter, Arial, sans-serif'; g.fillText(t.rollNumber, 50, 415);
  g.fillStyle = '#a1a1aa'; g.font = '500 16px Inter, Arial, sans-serif'; g.fillText(`Ticket ${t.reference}`, 760, 420);

  const img = new Image();
  img.src = qrDataUrl;
  await img.decode();
  g.fillStyle = '#ffffff'; g.fillRect(760, 70, 290, 290);
  g.drawImage(img, 770, 80, 270, 270);

  const a = document.createElement('a');
  a.download = `ticket-${t.reference}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

import { pool } from '../db.js';
import { AppError } from '../errors.js';

/** Checks the booking's extra answers against the form the admin configured for this screening.
 *  Returns only the known, trimmed answers (anything unexpected is dropped), or rejects with a friendly message. */
export async function validateFormData(screeningId: string, data: Record<string, unknown>): Promise<Record<string, string>> {
  const { rows } = await pool.query(
    `SELECT field_key, label, field_type, required, validation FROM form_fields WHERE screening_id = $1 ORDER BY sort_order`, [screeningId]);
  const clean: Record<string, string> = {};
  const bad: string[] = [];
  for (const f of rows) {
    const raw = data[f.field_key];
    const v = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    if (v === '') { if (f.required) bad.push(f.label); continue; }
    const rule = (f.validation ?? {}) as { pattern?: string; minLength?: number; maxLength?: number; options?: string[] };
    let ok = v.length <= 500; // hard cap also keeps admin-written patterns cheap to run
    if (ok && f.field_type === 'email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    if (ok && f.field_type === 'phone') ok = /^[0-9+\-\s]{7,15}$/.test(v);
    if (ok && f.field_type === 'number') ok = /^-?\d+(\.\d+)?$/.test(v);
    if (ok && f.field_type === 'select') ok = Array.isArray(rule.options) && rule.options.includes(v);
    if (ok && rule.minLength != null) ok = v.length >= rule.minLength;
    if (ok && rule.maxLength != null) ok = v.length <= rule.maxLength;
    if (ok && rule.pattern) ok = new RegExp(rule.pattern).test(v);
    if (ok) clean[f.field_key] = v; else bad.push(f.label);
  }
  if (bad.length) throw new AppError('INVALID_FORM', `Please check: ${bad.join(', ')}.`, 400);
  return clean;
}

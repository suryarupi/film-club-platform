import type { Status } from '../api';
import { STATUS } from '../utils';

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS[status].tone}`}>{STATUS[status].label}</span>;
}

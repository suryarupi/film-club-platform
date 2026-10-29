// Real poster when the admin supplies a URL, otherwise a generated cinematic gradient with the title.
// (No poster images are bundled, so there are no copyright issues: only upload posters you have permission to use.)
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export default function Poster({ title, url, className = '' }: { title: string; url: string | null; className?: string }) {
  if (url) return <img src={url} alt={`${title} poster`} loading="lazy" className={`object-cover ${className}`} />;
  const h = hue(title);
  return (
    <div
      role="img" aria-label={`${title} poster`}
      className={`flex items-end overflow-hidden ${className}`}
      style={{ background: `linear-gradient(160deg, hsl(${h} 55% 30%), hsl(${(h + 50) % 360} 60% 9%))` }}
    >
      <span className="p-4 font-display text-4xl leading-none text-white/90">{title}</span>
    </div>
  );
}

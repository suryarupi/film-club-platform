import { useEffect } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { CLUB } from './utils';
import Home from './pages/Home';
import Screenings from './pages/Screenings';
import ScreeningDetail from './pages/ScreeningDetail';
import Book from './pages/Book';
import Ticket from './pages/Ticket';
import MyTickets from './pages/MyTickets';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

const nav = ({ isActive }: { isActive: boolean }) => `rounded px-2 py-1 text-sm transition hover:text-gold ${isActive ? 'text-gold' : 'text-zinc-300'}`;

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-display text-2xl tracking-wider">
          <span aria-hidden className="inline-block h-5 w-3 rounded-sm bg-gold" />{CLUB.name}
        </Link>
        <nav aria-label="Main" className="flex gap-3">
          <NavLink to="/screenings" className={nav}>Screenings</NavLink>
          <NavLink to="/my-tickets" className={nav}>My tickets</NavLink>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const links = [['Instagram', CLUB.instagram], ['YouTube', CLUB.youtube], ['Email', CLUB.email ? `mailto:${CLUB.email}` : '']].filter(([, u]) => u);
  return (
    <footer className="mt-24">
      <div className="filmstrip" aria-hidden />
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p><span className="font-display text-xl tracking-wider text-zinc-200">{CLUB.name}</span> · Free screenings for students</p>
        <ul className="flex gap-4">
          {links.map(([label, url]) => <li key={label}><a className="hover:text-gold" href={url} target="_blank" rel="noreferrer">{label}</a></li>)}
        </ul>
      </div>
    </footer>
  );
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="font-display text-6xl">Page not found</h1>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink">Back to home</Link>
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <ScrollToTop />
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-ink">Skip to content</a>
        <Header />
        <main id="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/screenings" element={<Screenings />} />
            <Route path="/screenings/:id" element={<ScreeningDetail />} />
            <Route path="/screenings/:id/book" element={<Book />} />
            <Route path="/ticket/:token" element={<Ticket />} />
            <Route path="/my-tickets" element={<MyTickets />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </BrowserRouter>
    </MotionConfig>
  );
}

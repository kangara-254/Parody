import { useEffect, useRef, useState } from "react";
import crestMaroon from "../assets/school-crest-maroon.png";
import gallery1 from "../assets/gallery/gallery-1.jpeg";
import gallery2 from "../assets/gallery/gallery-2.jpeg";
import gallery3 from "../assets/gallery/gallery-3.jpeg";
import gallery5 from "../assets/gallery/gallery-5.jpeg";
import gallery6 from "../assets/gallery/gallery-6.jpeg";
import gallery7 from "../assets/gallery/gallery-7.jpeg";
import gallery9 from "../assets/gallery/gallery-9.jpeg";
import gallery10 from "../assets/gallery/gallery-10.jpeg";
import gallery11 from "../assets/gallery/gallery-11.jpeg";
import gallery12 from "../assets/gallery/gallery-12.jpeg";
import gallery13 from "../assets/gallery/gallery-13.jpeg";
import gallery14 from "../assets/gallery/gallery-14.jpeg";
import gallery15 from "../assets/gallery/gallery-15.jpeg";

// gallery-4 and gallery-8 are portrait-orientation photos -- the hero
// slideshow below force-crops every slide to a wide landscape box
// (object-cover), which would slice through people's heads/feet on a
// vertical photo. Left out of the rotation entirely rather than
// shown badly cropped. Still on disk in src/assets/gallery if a
// future portrait-friendly layout wants them.
const SLIDES = [gallery2, gallery3, gallery1, gallery5, gallery6, gallery7, gallery9, gallery10, gallery11, gallery12, gallery13, gallery14, gallery15];
const SLIDE_MS = 5000;

// Public landing page shown before Login. Previously the login form was
// the very first thing a visitor saw at the root URL; this gives the
// site a proper front door -- a slow crossfading slideshow of real
// school moments behind the crest and motto, with a single "Log in"
// action leading to the existing Login page.
export default function Landing({ onLogin }: { onLogin: () => void }) {
  const [active, setActive] = useState(0);
  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (reduceMotion.current) return; // static first photo, no auto-advance
    const id = setInterval(() => {
      setActive((i) => (i + 1) % SLIDES.length);
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, []);

  const facts = [
    { label: "Grades 7 – 9", detail: "Junior Secondary, single school" },
    { label: "9 Learning Areas", detail: "Math, English, Kiswahili, Pre-Tech, C/A, Agri, CRE, SST, Int-Sci" },
    { label: "CBC-Aligned", detail: "EE · ME · AE · BE performance levels" },
  ];

  return (
    <div className="min-h-screen font-body flex flex-col">
      {/* Hero: crossfading photo slideshow with a maroon scrim for legibility */}
      <div className="relative flex-1 min-h-[560px] flex items-end sm:items-center justify-center overflow-hidden">
        {SLIDES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden={i !== active}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[1400ms] ease-in-out"
            style={{ opacity: i === active ? 1 : 0 }}
          />
        ))}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(36,20,23,0.55) 0%, rgba(36,20,23,0.35) 35%, rgba(36,20,23,0.75) 100%)",
          }}
        />

        <div className="relative w-full max-w-lg text-center px-4 pb-12 pt-24 sm:py-16 landing-reveal">
          <img
            src={crestMaroon}
            alt="Kariobangi South crest"
            className="h-24 w-auto mx-auto mb-5 drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
          />
          <p className="neu-eyebrow text-parchment/80">Kariobangi South Primary &amp; Junior School</p>
          <h1 className="font-display text-3xl sm:text-4xl text-parchment mt-2 leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
            Junior School Assessment Portal
          </h1>
          <p className="text-sm text-parchment/80 mt-4 max-w-sm mx-auto leading-relaxed">
            Where teachers record marks, admins manage the school year, and
            every learner's report is built from a full, accurate history.
          </p>

          <button onClick={onLogin} className="glass-btn mt-8 px-8">
            Log in
          </button>

          <p className="font-display text-sm text-brass mt-10 tracking-wide">
            Strive for Excellence
          </p>
        </div>

        {/* Slide position dots */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: i === active ? "18px" : "6px",
                background: i === active ? "#f6f1e6" : "rgba(246,241,230,0.4)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Quick facts -- a ledger row, not feature cards */}
      <div className="border-t border-line bg-parchment/60">
        <div className="max-w-3xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {facts.map((f) => (
            <div key={f.label} className="text-center sm:text-left">
              <p className="font-display text-lg text-maroon-ink">{f.label}</p>
              <p className="text-xs text-ink/50 mt-1">{f.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-[11px] text-ink/40 py-4">
        © {new Date().getFullYear()} Made in Kariobangi South
      </p>
    </div>
  );
}

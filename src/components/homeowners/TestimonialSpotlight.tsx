"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CreditCard, Handshake } from "lucide-react";

const homeownerExperiences = [
  {
    icon: CreditCard,
    title: "Clear pricing before booking",
    description:
      "See provider-backed package pricing when available. When scope varies, Mercurius coordinates a quote for your approval before work is scheduled.",
  },
  {
    icon: Handshake,
    title: "A coordinated provider match",
    description:
      "Tell us what your home needs, and Mercurius helps confirm service fit, availability, scope, and pricing with a vetted local provider.",
  },
  {
    icon: Camera,
    title: "Updates and completion records",
    description:
      "Follow job updates and keep completion photos and service details together in your homeowner account.",
  },
];

export function TestimonialSpotlight() {
  const [current, setCurrent] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const next = useCallback(() => setCurrent((value) => (value + 1) % homeownerExperiences.length), []);
  useEffect(() => { const timer = window.setInterval(next, 5000); return () => window.clearInterval(timer); }, [next]);
  const experience = homeownerExperiences[current];
  const ExperienceIcon = experience.icon;
  return (
    <section onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMousePos({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }); }} className="bg-cta-section relative overflow-hidden py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-500" style={{ background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, hsl(150 35% 45% / 0.12) 0%, transparent 60%)` }} />
      <div className="container-wide relative z-10"><motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12 text-center"><span className="mb-4 inline-block rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80">What Homeowners Get</span><h2 className="text-3xl font-bold text-primary-foreground md:text-4xl">A Calmer, More Managed Experience</h2></motion.div>
        <div className="mx-auto flex min-h-[220px] max-w-3xl items-center justify-center text-center"><AnimatePresence mode="wait"><motion.div key={current} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.97 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}><div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 ring-1 ring-accent/30"><ExperienceIcon className="h-7 w-7 text-accent-on-dark" /></div><h3 className="mb-4 text-2xl font-semibold leading-snug text-primary-foreground md:text-3xl lg:text-4xl">{experience.title}</h3><p className="mx-auto max-w-2xl text-base leading-relaxed text-primary-foreground/70 md:text-lg">{experience.description}</p></motion.div></AnimatePresence></div>
        <div className="mt-10 flex justify-center gap-2">{homeownerExperiences.map((experienceItem, index) => <button key={experienceItem.title} type="button" aria-label={`Show homeowner experience ${index + 1}`} onClick={() => setCurrent(index)} className={`h-2 rounded-full transition-all duration-300 ${index === current ? "w-8 bg-accent" : "w-2 bg-white/25 hover:bg-white/40"}`} />)}</div>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
  { quote: "I didn't have to call, text, or negotiate with anyone. I picked a service, got a clear price, and the job was done.", author: "Sarah M.", role: "Homeowner, Fort Myers", rating: 5 },
  { quote: "My lawn guy used to ghost me for weeks. Now everything goes through Mercurius. Clear pricing, photo updates, no chasing.", author: "Michael R.", role: "Homeowner, Cape Coral", rating: 5 },
  { quote: "Finally a platform that treats homeowners like adults. Flat pricing, real communication, and the photos after every visit are a game-changer.", author: "Jessica L.", role: "Homeowner, Estero", rating: 5 },
];

export function TestimonialSpotlight() {
  const [current, setCurrent] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const next = useCallback(() => setCurrent((value) => (value + 1) % testimonials.length), []);
  useEffect(() => { const timer = window.setInterval(next, 5000); return () => window.clearInterval(timer); }, [next]);
  const testimonial = testimonials[current];
  return (
    <section onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMousePos({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }); }} className="bg-cta-section relative overflow-hidden py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-500" style={{ background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, hsl(150 35% 45% / 0.12) 0%, transparent 60%)` }} />
      <div className="pointer-events-none absolute left-8 top-8 select-none font-serif text-[12rem] leading-none text-white/[0.04] md:left-16 md:top-12 md:text-[16rem]">&quot;</div><div className="pointer-events-none absolute bottom-0 right-8 rotate-180 select-none font-serif text-[12rem] leading-none text-white/[0.04] md:right-16 md:text-[16rem]">&quot;</div>
      <div className="container-wide relative z-10"><motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12 text-center"><span className="mb-4 inline-block rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80">What Homeowners Say</span><h2 className="text-3xl font-bold text-primary-foreground md:text-4xl">Real Reviews, Real Results</h2></motion.div>
        <div className="mx-auto flex min-h-[220px] max-w-3xl items-center justify-center text-center"><AnimatePresence mode="wait"><motion.div key={current} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.97 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}><div className="mb-6 flex justify-center gap-1">{Array.from({ length: testimonial.rating }).map((_, index) => <Star key={index} className="h-5 w-5 fill-warning text-warning" />)}</div><p className="mb-8 text-2xl font-medium leading-snug text-primary-foreground md:text-3xl lg:text-4xl">&quot;{testimonial.quote}&quot;</p><p className="text-lg font-semibold text-primary-foreground">{testimonial.author}</p><p className="text-sm text-primary-foreground/60">{testimonial.role}</p></motion.div></AnimatePresence></div>
        <div className="mt-10 flex justify-center gap-2">{testimonials.map((_, index) => <button key={index} type="button" aria-label={`Show testimonial ${index + 1}`} onClick={() => setCurrent(index)} className={`h-2 rounded-full transition-all duration-300 ${index === current ? "w-8 bg-accent" : "w-2 bg-white/25 hover:bg-white/40"}`} />)}</div>
      </div>
    </section>
  );
}

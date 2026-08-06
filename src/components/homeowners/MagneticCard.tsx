"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";

interface MagneticCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: string;
}

export function MagneticCard({ children, className = "", glowColor = "150 35% 45%" }: MagneticCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ rotateX: 0, rotateY: 0 });
  const [glowPos, setGlowPos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setTransform({ rotateX: (y - 0.5) * -8, rotateY: (x - 0.5) * 8 });
    setGlowPos({ x: x * 100, y: y * 100 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTransform({ rotateX: 0, rotateY: 0 });
    setIsHovered(false);
  }, []);

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX: transform.rotateX, rotateY: transform.rotateY }}
      transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.5 }}
      className={`relative overflow-hidden ${className}`}
      style={{ perspective: 800, transformStyle: "preserve-3d" }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{ opacity: isHovered ? 1 : 0, background: `radial-gradient(300px circle at ${glowPos.x}% ${glowPos.y}%, hsl(${glowColor} / 0.12) 0%, transparent 60%)` }}
      />
      {children}
    </motion.div>
  );
}

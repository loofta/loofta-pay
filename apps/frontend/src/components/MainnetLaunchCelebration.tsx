'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

const STORAGE_KEY = 'loofta.mainnet_launch_v1';

const COLORS = ['#FF0F00', '#FF4500', '#FF8C00', '#FFD700', '#FFFFFF', '#FF6B35'];

function fireConfetti() {
  const burst = (opts: confetti.Options) =>
    confetti({ colors: COLORS, gravity: 0.85, ticks: 350, ...opts });

  // Opening center burst — big and fast
  burst({ particleCount: 120, spread: 75, startVelocity: 55, scalar: 1.1, origin: { x: 0.5, y: 0.45 } });

  // Side cannons
  setTimeout(() => {
    burst({ particleCount: 70, spread: 55, angle: 65, startVelocity: 60, origin: { x: 0, y: 0.6 } });
    burst({ particleCount: 70, spread: 55, angle: 115, startVelocity: 60, origin: { x: 1, y: 0.6 } });
  }, 300);

  // Tiny confetti layer for texture
  setTimeout(() => {
    burst({ particleCount: 80, spread: 90, startVelocity: 38, scalar: 0.6, shapes: ['circle'], origin: { x: 0.5, y: 0.4 } });
  }, 650);

  // Second center shower
  setTimeout(() => {
    burst({ particleCount: 90, spread: 110, startVelocity: 42, origin: { x: 0.5, y: 0.38 } });
  }, 900);

  // Final wide burst
  setTimeout(() => {
    burst({ particleCount: 130, spread: 130, startVelocity: 32, scalar: 0.9, origin: { x: 0.5, y: 0.32 } });
  }, 2100);
}

// Floating sparkle dot
function Spark({ x, y, delay, size = 4, color = '#FF4500' }: {
  x: string; y: string; delay: number; size?: number; color?: string;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute rounded-full"
      style={{ left: x, top: y, width: size, height: size, background: color }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 1, 0.6, 0], scale: [0, 1, 0.8, 0], y: [-0, -22, -38, -52] }}
      transition={{ duration: 2.6, delay, repeat: Infinity, repeatDelay: 1.4, ease: 'easeOut' }}
    />
  );
}

export function MainnetLaunchCelebration() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1');
      setShow(true);
    }, 600);
    return () => clearTimeout(t);
  }, []);

  // Dev: Shift+M to replay
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'M') { localStorage.removeItem(STORAGE_KEY); setShow(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!show) return;
    fireConfetti();
    const t = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(t);
  }, [show]);

  const dismiss = () => setShow(false);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="mainnet-celebration"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45 } }}
          onClick={dismiss}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.82, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: -16, transition: { duration: 0.3 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 26, delay: 0.04 }}
            onClick={(e) => e.stopPropagation()}
            className="relative mx-4 w-full max-w-[360px] overflow-hidden rounded-[28px]"
            style={{
              background: 'linear-gradient(160deg, #141414 0%, #0d0d0d 100%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 32px 64px rgba(0,0,0,0.7), 0 0 80px rgba(255,15,0,0.12)',
            }}
          >
            {/* Ambient glow blob */}
            <div
              className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 rounded-full opacity-40"
              style={{ width: 240, height: 200, background: 'radial-gradient(ellipse, #FF2200 0%, transparent 70%)', filter: 'blur(32px)' }}
            />

            {/* Floating sparks */}
            <Spark x="12%" y="62%" delay={0}    size={4} color="#FF4500" />
            <Spark x="22%" y="50%" delay={0.7}  size={3} color="#FFD700" />
            <Spark x="78%" y="55%" delay={0.3}  size={4} color="#FF4500" />
            <Spark x="88%" y="68%" delay={1.1}  size={3} color="#FFD700" />
            <Spark x="50%" y="78%" delay={0.5}  size={3} color="#FF6B35" />
            <Spark x="35%" y="72%" delay={1.4}  size={2} color="#FFFFFF" />
            <Spark x="65%" y="70%" delay={0.9}  size={2} color="#FFFFFF" />

            <div className="relative px-7 pb-8 pt-10 text-center">
              {/* Rocket */}
              <motion.div
                initial={{ scale: 0, rotate: -20, y: 10 }}
                animate={{ scale: 1, rotate: 0, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.12 }}
                className="relative mx-auto mb-6 w-fit"
              >
                {/* Glow ring behind rocket */}
                <motion.div
                  className="absolute inset-0 -m-3 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(255,60,0,0.35) 0%, transparent 70%)' }}
                  animate={{ scale: [1, 1.18, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span className="relative text-[64px] leading-none" style={{ filter: 'drop-shadow(0 0 18px rgba(255,80,0,0.7))' }}>
                  🚀
                </span>
              </motion.div>

              {/* Text block */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22, duration: 0.45 }}
              >
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.22em] text-red-500">
                  July 1, 2026
                </p>

                <h2 className="mb-1 text-[28px] font-black leading-tight tracking-tight text-white">
                  Loofta is live
                </h2>

                <h2
                  className="mb-4 text-[28px] font-black leading-tight tracking-tight"
                  style={{ background: 'linear-gradient(90deg, #FF0F00, #FF8C00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                >
                  on Mainnet
                </h2>

                <p className="mb-7 text-[13px] leading-relaxed text-white/45">
                  Private USDC payments on Solana.<br />Send to anyone. Claim anytime.
                </p>
              </motion.div>

              {/* CTA button */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.34 }}
                whileTap={{ scale: 0.97 }}
                onClick={dismiss}
                className="relative w-full overflow-hidden rounded-2xl py-3.5 text-[15px] font-bold text-white"
                style={{
                  background: 'linear-gradient(135deg, #FF1A00 0%, #FF6200 100%)',
                  boxShadow: '0 4px 24px rgba(255,30,0,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                {/* Shimmer sweep */}
                <motion.div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)' }}
                  initial={{ x: '-100%' }}
                  animate={{ x: '200%' }}
                  transition={{ delay: 0.6, duration: 0.9, repeat: Infinity, repeatDelay: 2.8 }}
                />
                Let&apos;s go 🔥
              </motion.button>
            </div>

            {/* Countdown progress bar */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 5, ease: 'linear' }}
              style={{ transformOrigin: 'left' }}
              className="absolute bottom-0 left-0 h-[3px] w-full"
              {...{ style: { background: 'linear-gradient(90deg, #FF0F00, #FFD700)', transformOrigin: 'left', height: 3 } }}
            >
              <motion.div
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: 5, ease: 'linear' }}
                style={{ transformOrigin: 'left', height: '100%', background: 'linear-gradient(90deg, #FF0F00, #FFD700)' }}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

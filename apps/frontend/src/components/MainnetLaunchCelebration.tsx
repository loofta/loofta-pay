'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

const STORAGE_KEY = 'loofta.mainnet_launch_v1';

const COLORS = ['#FF0F00', '#FF4500', '#FF8C00', '#FFD700', '#FFFFFF', '#FF6B35'];

function fireConfetti() {
  const burst = (opts: confetti.Options) =>
    confetti({ colors: COLORS, gravity: 0.85, ticks: 350, ...opts });

  burst({ particleCount: 120, spread: 75, startVelocity: 55, scalar: 1.1, origin: { x: 0.5, y: 0.45 } });

  setTimeout(() => {
    burst({ particleCount: 70, spread: 55, angle: 65, startVelocity: 60, origin: { x: 0, y: 0.6 } });
    burst({ particleCount: 70, spread: 55, angle: 115, startVelocity: 60, origin: { x: 1, y: 0.6 } });
  }, 300);

  setTimeout(() => {
    burst({ particleCount: 80, spread: 90, startVelocity: 38, scalar: 0.6, shapes: ['circle'], origin: { x: 0.5, y: 0.4 } });
  }, 650);

  setTimeout(() => {
    burst({ particleCount: 90, spread: 110, startVelocity: 42, origin: { x: 0.5, y: 0.38 } });
  }, 900);

  setTimeout(() => {
    burst({ particleCount: 130, spread: 130, startVelocity: 32, scalar: 0.9, origin: { x: 0.5, y: 0.32 } });
  }, 2100);
}

function Spark({ x, y, delay, size = 4, color = '#FF4500' }: {
  x: string; y: string; delay: number; size?: number; color?: string;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute rounded-full"
      style={{ left: x, top: y, width: size, height: size, background: color }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 1, 0.6, 0], scale: [0, 1, 0.8, 0], y: [0, -22, -38, -52] }}
      transition={{ duration: 2.6, delay, repeat: Infinity, repeatDelay: 1.4, ease: 'easeOut' }}
    />
  );
}

export function MainnetLaunchCelebration({ blockedByUpdate }: { blockedByUpdate: boolean }) {
  const [show, setShow] = useState(false);

  // Only start timer once the update check resolves with no update needed
  useEffect(() => {
    if (blockedByUpdate) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1');
      setShow(true);
    }, 700);
    return () => clearTimeout(t);
  }, [blockedByUpdate]);

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
    const t = setTimeout(() => setShow(false), 5500);
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
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          onClick={dismiss}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.84, y: 36 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -12, transition: { duration: 0.28 } }}
            transition={{ type: 'spring', stiffness: 280, damping: 24, delay: 0.04 }}
            onClick={(e) => e.stopPropagation()}
            className="relative mx-4 w-full max-w-[420px] overflow-hidden rounded-[32px]"
            style={{
              background: 'linear-gradient(160deg, #161616 0%, #0c0c0c 100%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 40px 80px rgba(0,0,0,0.75), 0 0 100px rgba(255,15,0,0.1)',
            }}
          >
            {/* Ambient glow */}
            <div
              className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 rounded-full"
              style={{ width: 300, height: 240, background: 'radial-gradient(ellipse, rgba(255,34,0,0.38) 0%, transparent 70%)', filter: 'blur(36px)' }}
            />

            {/* Floating sparks */}
            <Spark x="10%" y="60%" delay={0} size={5} color="#FF4500" />
            <Spark x="20%" y="48%" delay={0.7} size={4} color="#FFD700" />
            <Spark x="80%" y="53%" delay={0.3} size={5} color="#FF4500" />
            <Spark x="89%" y="66%" delay={1.1} size={4} color="#FFD700" />
            <Spark x="50%" y="76%" delay={0.5} size={4} color="#FF6B35" />
            <Spark x="34%" y="70%" delay={1.4} size={3} color="#FFFFFF" />
            <Spark x="66%" y="68%" delay={0.9} size={3} color="#FFFFFF" />

            <div className="relative px-8 pb-9 pt-11 text-center">
              {/* Party emoji */}
              <motion.div
                initial={{ scale: 0, rotate: -15, y: 8 }}
                animate={{ scale: 1, rotate: 0, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}
                className="relative mx-auto mb-7 w-fit"
              >
                <motion.div
                  className="absolute inset-0 -m-4 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(255,60,0,0.32) 0%, transparent 70%)' }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
                <span
                  className="relative text-[72px] leading-none"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(255,100,0,0.6))' }}
                >
                  🎉
                </span>
              </motion.div>

              {/* Text */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
              >
                <h2 className="mb-1 text-[32px] font-display font-medium leading-tight tracking-tight text-white">
                  Loofta is live
                </h2>

                <h2
                  className="mb-5 text-[32px] font-medium leading-tight tracking-tight"
                  style={{ background: 'linear-gradient(90deg, #FF0F00, #FF8C00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
                >
                  on Mainnet
                </h2>

                <p className="mb-8 text-base text-white/50 leading-relaxed">
                  Private USDC payments on Solana.<br />Send to anyone, claim anytime.
                </p>
              </motion.div>

              {/* CTA */}
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.32 }}
                whileTap={{ scale: 0.97 }}
                onClick={dismiss}
                className="relative w-full overflow-hidden rounded-2xl py-4 text-base font-medium text-white"
                style={{
                  background: 'linear-gradient(135deg, #FF1A00 0%, #FF6200 100%)',
                  boxShadow: '0 4px 28px rgba(255,30,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14)',
                }}
              >
                <motion.div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%)' }}
                  initial={{ x: '-100%' }}
                  animate={{ x: '200%' }}
                  transition={{ delay: 0.7, duration: 0.85, repeat: Infinity, repeatDelay: 3 }}
                />
                Let&apos;s go 🔥
              </motion.button>
            </div>

            {/* Progress bar */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 5.5, ease: 'linear' }}
              style={{
                transformOrigin: 'left',
                background: 'linear-gradient(90deg, #FF0F00, #FFD700)',
                height: 3,
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

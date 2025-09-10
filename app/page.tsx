"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, type SVGProps, type ComponentType } from "react";
import { motion } from "framer-motion";
import { Plus_Jakarta_Sans } from "next/font/google";

const font = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["300", "400", "600"] });

function PhoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 16.92v2a2 2 0 0 1-2.18 2c-3.19-.35-6.2-1.86-8.54-4.2s-3.85-5.35-4.2-8.54A2 2 0 0 1 9.06 6h2a2 2 0 0 1 2 1.72c.12.86.33 1.69.63 2.47a2 2 0 0 1-.45 2.11l-.7.7a16 16 0 0 0 6.29 6.29l.7-.7a2 2 0 0 1 2.11-.45c.78.3 1.61.51 2.47.63A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8z" />
      <path d="M8 9h8M8 13h6" />
    </svg>
  );
}

function Halo({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={"absolute -inset-4 rounded-full blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 " + className}
    />
  );
}

function BackgroundParticles() {
  const dots = [
    { size: 10, x: "10%", y: "15%", delay: 0 },
    { size: 8, x: "80%", y: "22%", delay: 0.4 },
    { size: 12, x: "70%", y: "70%", delay: 0.2 },
    { size: 6, x: "20%", y: "75%", delay: 0.7 },
    { size: 9, x: "45%", y: "10%", delay: 0.15 },
    { size: 7, x: "30%", y: "45%", delay: 0.55 },
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-green-500/20"
          style={{ width: d.size, height: d.size, left: d.x, top: d.y, boxShadow: "0 0 24px rgba(34,197,94,0.25)" }}
          animate={{ y: [0, -12, 0], x: [0, 6, 0], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 8 + i, repeat: Infinity, ease: "easeInOut", delay: d.delay }}
        />
      ))}

      {/* Soft gradient blobs for extra depth */}
      <motion.div
        className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-green-400/10 blur-3xl"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-green-500/10 blur-3xl"
        animate={{ rotate: -360 }}
        transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

function OptionCircle({
  href,
  label,
  subtitle,
  accent,
  gradientFrom,
  gradientTo,
  icon: Icon,
  delay = 0,
}: {
  href: string;
  label: string;
  subtitle: string;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  delay?: number;
}) {
  const accentRing = useMemo(() => accent.replace("text-", "ring-") + "/50", [accent]);
  const accentBg = useMemo(() => accent.replace("text-", "bg-") + "/10", [accent]);

  return (
    <Link href={href} className="group focus:outline-none">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 14, delay }}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.98 }}
        className="relative mx-auto"
      >
        <Halo className={accentBg} />

        <div
          className={[
            "relative w-64 h-64 md:w-80 md:h-80 rounded-full",
            "border border-gray-200",
            "bg-white backdrop-blur",
            "shadow-xl shadow-gray-200/60",
            "transition-all duration-300",
            "hover:shadow-2xl hover:shadow-gray-300/70",
            "focus-within:ring-4",
            accentRing,
            "overflow-hidden select-none",
            "flex items-center justify-center",
          ].join(" ")}
        >
          <div
            className={[
              "absolute inset-0 rounded-full",
              "bg-gradient-to-br",
              gradientFrom,
              gradientTo,
              "opacity-0 group-hover:opacity-100 transition-opacity duration-300",
            ].join(" ")}
          />

          <div className="relative z-10 flex flex-col items-center gap-4 text-center">
            <Icon className={[accent, "w-20 h-20 md:w-24 md:h-24"].join(" ")} />
            <div className="space-y-1">
              <div className="text-3xl md:text-4xl font-light text-gray-700 tracking-tight">
                {label}
              </div>
              <div className="text-base md:text-lg font-light text-gray-500">
                {subtitle}
              </div>
            </div>
          </div>

          <motion.div
            aria-hidden
            className={["absolute inset-3 rounded-full", "border-2", accentRing, "opacity-60"].join(" ")}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, ease: "linear", duration: 26 }}
            style={{ pointerEvents: "none" }}
          />
        </div>
      </motion.div>
    </Link>
  );
}

export default function Home() {
  return (
    <main className={`${font.className} relative min-h-dvh bg-white text-gray-800`}>
      {/* Floating particles */}
      <BackgroundParticles />

      <div className="relative mx-auto max-w-6xl px-6 py-12 md:py-20">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm md:text-base text-gray-500 tracking-wide uppercase">
            ZB Bank Zimbabwe • Fresh Caller Analytics
          </div>
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mt-10 md:mt-14 text-3xl md:text-5xl font-light text-center text-gray-600 tracking-tight"
        >
          What would you like to analyse today?
        </motion.h1>

        <div className="mt-14 md:mt-20 grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-16 place-items-center">
          <OptionCircle
            href="/call"
            label="Call"
            subtitle="Start a voice-call analysis"
            accent="text-green-600"
            gradientFrom="from-green-400/15"
            gradientTo="to-green-600/10"
            icon={PhoneIcon}
            delay={0.1}
          />

          <OptionCircle
            href="/chat"
            label="Chat"
            subtitle="Start a text/chat analysis"
            accent="text-green-600"
            gradientFrom="from-green-400/15"
            gradientTo="to-green-600/10"
            icon={ChatIcon}
            delay={0.18}
          />
        </div>

        <p className="mt-12 md:mt-14 text-center text-lg md:text-xl font-extralight text-gray-500">
          These options launch scorecard workflows for individual agents, teams, and the whole organisation.
        </p>
      </div>
    </main>
  );
}

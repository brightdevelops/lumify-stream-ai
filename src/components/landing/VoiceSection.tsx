import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import sample from "@/assets/voice-sample.mp3.asset.json";
import "./VoiceSection.css";

const BENEFITS = [
  "Clone your own voice — with consent, always",
  "Realistic voices across dozens of languages",
  "Download MP3 or WAV, use it anywhere",
];

const BARS = Array.from({ length: 24 }, (_, i) => ({
  delay: `${(i * 0.09).toFixed(2)}s`,
  duration: `${(1.6 + ((i * 7) % 7) * 0.1).toFixed(2)}s`,
}));

export function VoiceSection() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const stop = () => setPlaying(false);
    el.addEventListener("ended", stop);
    el.addEventListener("pause", stop);
    return () => {
      el.removeEventListener("ended", stop);
      el.removeEventListener("pause", stop);
    };
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <section className="lumi-voice-section" aria-labelledby="voice-heading">
      <div className="lumi-voice-glow" aria-hidden />
      <div className="lumi-voice-grid">
        <div>
          <span className="lumi-voice-chip">New · Lumify Voice</span>
          <h2 id="voice-heading" className="lumi-voice-h">
            Your <em>voice</em>, on demand.
          </h2>
          <p className="lumi-voice-sub">
            Clone your voice from a 15-second clip — or pick from a library of studio-quality
            voices. Type anything, hear it in seconds, download it as audio.
          </p>
          <div className="lumi-voice-benefits">
            {BENEFITS.map((b) => (
              <div key={b} className="lumi-voice-benefit">
                <span aria-hidden>✦</span> {b}
              </div>
            ))}
          </div>
          <p className="lumi-voice-price">From 15 credits per line · previews are always free.</p>
          <div className="lumi-voice-cta">
            <Link to="/signup" className="lumi-voice-btn">Try Voice Studio</Link>
            <button type="button" className="lumi-voice-ghost" onClick={toggle} aria-pressed={playing}>
              {playing ? "Playing…" : "Hear a sample"}
            </button>
            <audio ref={audioRef} src={sample.url} preload="none" />
          </div>
        </div>

        <div className="lumi-voice-card" aria-hidden>
          <div className="lumi-voice-chiprow">
            <span className="lumi-mchip lime">◉ Voice — Naira</span>
            <span className="lumi-mchip">EN</span>
            <span className="lumi-mchip right">Sonic 3.5</span>
          </div>
          <div className="lumi-voice-script">
            Welcome back to the stream, everyone — tonight is going to be special.
          </div>
          <div className="lumi-voice-player">
            <div className="lumi-voice-play">▶</div>
            <div className="lumi-eq">
              {BARS.map((b, i) => (
                <div
                  key={i}
                  className="lumi-eq-bar"
                  style={{ animationDelay: b.delay, animationDuration: b.duration }}
                />
              ))}
            </div>
            <span className="lumi-voice-time">0:07</span>
            <span className="lumi-voice-dl">⬇ MP3</span>
          </div>
        </div>
      </div>
    </section>
  );
}

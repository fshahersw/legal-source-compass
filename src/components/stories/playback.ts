/** Shared playback state for the page's motion charts. */
export const SPEEDS = [
  { id: "0.5", label: "0.5×" },
  { id: "1", label: "1×" },
  { id: "2", label: "2×" },
] as const;
export type Speed = (typeof SPEEDS)[number]["id"];

export type PlaybackControls = {
  t: number;
  playing: boolean;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  play: () => void;
  pause: () => void;
  restart: () => void;
  end: () => void;
  scrub: (t: number) => void;
};

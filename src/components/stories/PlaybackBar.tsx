/** Play, pause, restart, jump to the latest report and speed: the controls every motion chart on the page shares. */
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/enforcement/parts";
import { SPEEDS, type PlaybackControls } from "./playback";

export function PlaybackBar({
  play,
  status,
  extra,
}: {
  play: PlaybackControls;
  status: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {play.playing ? (
        <Button size="sm" variant="default" onClick={play.pause} aria-label="Pause">
          <Pause className="size-3.5" /> Pause
        </Button>
      ) : (
        <Button size="sm" variant="default" onClick={play.play} aria-label="Play">
          <Play className="size-3.5" /> Play
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={play.restart}
        aria-label="Play from the first report"
      >
        <RotateCcw className="size-3.5" />
      </Button>
      <Button size="sm" variant="outline" onClick={play.end} aria-label="Jump to the latest report">
        <SkipForward className="size-3.5" />
      </Button>
      <Segmented
        label="Playback speed"
        value={play.speed}
        options={[...SPEEDS]}
        onChange={play.setSpeed}
      />
      <span className="text-xs tabular-nums text-muted-foreground" aria-live="off">
        {status}
      </span>
      {extra}
    </div>
  );
}

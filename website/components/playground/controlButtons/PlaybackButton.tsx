import GlassButton from "./GlassButton";
import { RiPlayLine } from "@remixicon/react";

interface PlaybackButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function PlaybackButton({
  showControlPanel,
  onToggleControlPanel,
}: PlaybackButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiPlayLine size={24} />}
      tooltip="Playback episodes"
      pressed={showControlPanel}
    />
  );
}

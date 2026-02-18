import GlassButton from "./GlassButton";
import { RiVideoLine } from "@remixicon/react";

interface EpisodeButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function EpisodeButton({
  showControlPanel,
  onToggleControlPanel,
}: EpisodeButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiVideoLine size={24} />}
      tooltip="Record episodes"
      pressed={showControlPanel}
    />
  );
}

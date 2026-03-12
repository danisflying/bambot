import RobotLoader from "@/components/playground/RobotLoader";

interface PlaygroundProps {
  robotName: string;
  onBack: () => void;
}

export default function Playground({ robotName, onBack }: PlaygroundProps) {
  return (
    <div className="w-screen h-screen bg-zinc-950 overflow-hidden">
      <RobotLoader robotName={robotName} onBack={onBack} />
    </div>
  );
}

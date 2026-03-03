import RobotLoader from "@/components/playground/RobotLoader";

interface PlaygroundProps {
  robotName: string;
  onBack: () => void;
}

export default function Playground({ robotName, onBack }: PlaygroundProps) {
  return (
    <div className="relative w-screen h-screen">
      <RobotLoader robotName={robotName} />
      {/* Back button — top-left, below the header area */}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 z-50 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-white text-sm backdrop-blur border border-zinc-600 transition-colors"
      >
        ← Back
      </button>
    </div>
  );
}

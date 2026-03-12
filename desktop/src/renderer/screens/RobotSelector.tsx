import { robotConfigMap } from "@/config/robotConfig";
import { resolveStaticUrl } from "@/lib/utils";

interface RobotSelectorProps {
  onSelectRobot: (robotName: string) => void;
}

export default function RobotSelector({ onSelectRobot }: RobotSelectorProps) {
  const robots = Object.entries(robotConfigMap).map(([name, config]) => ({
    name,
    image: config.image,
  }));

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-white tracking-tight">BamBot</h1>
        <p className="text-zinc-400 mt-2">Select a robot to get started</p>
      </div>

      <div className="flex flex-wrap justify-center gap-4 max-w-2xl">
        {robots.map((robot) => (
          <button
            key={robot.name}
            onClick={() => onSelectRobot(robot.name)}
            className="group rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800/80 transition-all w-56 overflow-hidden cursor-pointer"
          >
            {robot.image && (
              <div className="aspect-[4/3] overflow-hidden">
                <img
                  src={resolveStaticUrl(robot.image)}
                  alt={robot.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            )}
            <div className="p-3 border-t border-zinc-800">
              <span className="text-sm font-medium text-white">{robot.name}</span>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}

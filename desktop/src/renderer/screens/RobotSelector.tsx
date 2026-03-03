import { robotConfigMap } from "@/config/robotConfig";

interface RobotSelectorProps {
  onSelectRobot: (robotName: string) => void;
}

export default function RobotSelector({ onSelectRobot }: RobotSelectorProps) {
  const robots = Object.entries(robotConfigMap).map(([name, config]) => ({
    name,
    image: config.image,
    assembleLink: config.assembleLink,
  }));

  return (
    <main className="relative min-h-screen bg-black">
      <div className="mt-32 mb-4 container mx-auto p-4 flex justify-center items-center relative z-10">
        <div className="text-center w-full">
          <h1 className="text-6xl mb-4 font-bold text-white">BamBot</h1>
          <p className="text-2xl mb-8 text-zinc-300">
            Select a robot to get started
          </p>
          <div className="container mx-auto p-4 flex flex-wrap justify-center gap-8 relative z-10">
            {robots.map((robot) => (
              <div
                key={robot.name}
                className="rounded-2xl shadow-lg shadow-zinc-800 border border-zinc-500 overflow-hidden w-[90%] sm:w-[40%] lg:w-[25%]"
              >
                <div className="relative z-10">
                  {robot.image && (
                    <img
                      src={robot.image}
                      alt={robot.name}
                      className="w-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />
                </div>
                <h2 className="text-xl font-semibold -mt-8 ml-2 mb-4 text-left text-white relative z-20">
                  {robot.name}
                </h2>
                <div className="flex">
                  <button
                    onClick={() => onSelectRobot(robot.name)}
                    className="bg-black text-white py-2 text-center hover:bg-zinc-800 border-t border-zinc-500 w-full cursor-pointer"
                  >
                    Play
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

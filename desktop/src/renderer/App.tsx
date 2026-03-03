import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import RobotSelector from "./screens/RobotSelector";
import Playground from "./screens/Playground";

type Screen = { type: "selector" } | { type: "playground"; robotName: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: "selector" });

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {screen.type === "selector" && (
        <RobotSelector
          onSelectRobot={(name) =>
            setScreen({ type: "playground", robotName: name })
          }
        />
      )}
      {screen.type === "playground" && (
        <Playground
          robotName={screen.robotName}
          onBack={() => setScreen({ type: "selector" })}
        />
      )}
    </ThemeProvider>
  );
}

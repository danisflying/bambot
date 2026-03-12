import { ReactNode, memo } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  RiKeyboardFill,
  RiChatAiLine,
  RiRecordCircleLine,
  RiVideoLine,
  RiPlayLine,
} from "@remixicon/react";
import {
  ExternalLink,
  MoreVertical,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export type SidebarTab =
  | "control"
  | "leader"
  | "chat"
  | "record"
  | "episodes"
  | "playback";

export type DockRegion = "left" | "right" | "bottom";

// ── Tab & Region metadata ──────────────────────────────────────────────────

export const TAB_META: { id: SidebarTab; label: string; icon: ReactNode }[] = [
  {
    id: "control",
    label: "Keyboard",
    icon: <RiKeyboardFill size={18} />,
  },
  {
    id: "leader",
    label: "Leader",
    icon: (
      <svg
        viewBox="5 10 42 40"
        xmlns="http://www.w3.org/2000/svg"
        height="18"
        width="18"
        fill="currentColor"
      >
        <circle cx="23.588" cy="38.103" r="3.601" />
        <path d="m46.73 12.567v-12.574l-9.669 8.956s-.649.558-1.813 1.108c-.447.21-1.018.341-1.384.388l-18.862.055c-1.388.013-2.069 1.051-2.389 1.993l10.071-.008c.279 0 .491.298.492.577 0 .281-.228.509-.505.509l-10.264.009c-.008 0-.015-.005-.025-.007l-3.768.007c-1.074.001-1.941.875-1.939 1.954 0 1.07.874 1.937 1.948 1.936l1.654-.001v21.448l-2.833 1.652c-.8.468-1.071 1.494-.604 2.295.466.799 1.492 1.07 2.294.603l5.152-3.004 2.1 2.073c-.084.083-.172.164-.238.249-2.782 3.354-3.906 7.617-3.906 7.617h10.733s-.003-1.571-.37-3.42l5.729 1.482c.139.036.28.053.42.053.551 0 1.08-.271 1.396-.746l4.438-6.657c.514-.771.306-1.812-.465-2.326-.765-.51-1.787-.306-2.307.445v-11.244zm-31.001 24.603c-.541-.531-1.369-.639-2.024-.255l-2.496 1.456v-20.904l7.042-.003 2.71-1.666c.233-.144.544-.07.693.17.145.24.072.55-.165.694l-1.299.798h.014l-6.199 3.793c-.91.574-1.185 1.77-.615 2.681.371.592 1.007.91 1.656.909.35 0 .704-.099 1.024-.297l.777-.476v14.204zm12.291 7.747-6.005-1.554c-.005-.001-.01-.001-.016-.002l-4.219-4.168v-15.695l5.38-3.301 7.304-.015c.465.034 1.244.213 1.303.98.065.84-.621 1.437-.621 1.437l.022-.004-2.953 3.004c-.756.767-1.153 2.44-.223 3.284.396.358 1.014.589 1.611.537.456-.032.913-.174 1.281-.491v11.503h.125z" />
      </svg>
    ),
  },
  {
    id: "record",
    label: "Record",
    icon: <RiRecordCircleLine size={18} />,
  },
  {
    id: "episodes",
    label: "Episodes",
    icon: <RiVideoLine size={18} />,
  },
  {
    id: "playback",
    label: "Playback",
    icon: <RiPlayLine size={18} />,
  },
  {
    id: "chat",
    label: "AI Chat",
    icon: <RiChatAiLine size={18} />,
  },
];

const REGION_META: { id: DockRegion; label: string; icon: ReactNode }[] = [
  { id: "left", label: "Left", icon: <PanelLeft size={14} /> },
  { id: "right", label: "Right", icon: <PanelRight size={14} /> },
  { id: "bottom", label: "Bottom", icon: <PanelBottom size={14} /> },
];

// ── Sidebar Component ──────────────────────────────────────────────────────

interface SidebarProps {
  /** Which tabs live in this dock region */
  tabs: SidebarTab[];
  activeTab: SidebarTab | null;
  onTabChange: (tab: SidebarTab) => void;
  children: ReactNode;
  /** Which dock region this sidebar represents */
  region: DockRegion;
  /** Tabs currently popped out as floating windows */
  poppedOut?: Set<SidebarTab>;
  /** Pop active tab into a floating window */
  onPopOut?: (tab: SidebarTab) => void;
  /** Move a tab to a different dock region */
  onMoveTab?: (tab: SidebarTab, to: DockRegion) => void;
}

function SidebarInner({
  tabs,
  activeTab,
  onTabChange,
  children,
  region,
  poppedOut,
  onPopOut,
  onMoveTab,
}: SidebarProps) {
  const isActivePopped = activeTab ? poppedOut?.has(activeTab) : false;
  const visibleTabs = TAB_META.filter((t) => tabs.includes(t.id));

  const borderClass =
    region === "left"
      ? "border-r border-zinc-800"
      : region === "bottom"
        ? ""
        : "border-l border-zinc-800";

  return (
    <div className={`h-full flex flex-col bg-zinc-950 ${borderClass}`}>
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800 bg-zinc-950 shrink-0">
        {visibleTabs.map((tab) => {
          const isPopped = poppedOut?.has(tab.id);
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onTabChange(tab.id)}
                  className={`relative p-1.5 rounded transition-colors ${
                    activeTab === tab.id
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                  } ${isPopped ? "opacity-50" : ""}`}
                >
                  {tab.icon}
                  {isPopped && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  {tab.label}
                  {isPopped ? " (floating)" : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Actions dropdown for the active tab */}
        {activeTab && !isActivePopped && (onPopOut || onMoveTab) && (
          <>
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                  <MoreVertical size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[150px]">
                {onPopOut && (
                  <DropdownMenuItem onClick={() => onPopOut(activeTab)}>
                    <ExternalLink size={14} className="mr-2" />
                    Pop out
                  </DropdownMenuItem>
                )}
                {onMoveTab && (
                  <>
                    {onPopOut && <DropdownMenuSeparator />}
                    {REGION_META.filter((r) => r.id !== region).map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        onClick={() => onMoveTab(activeTab, r.id)}
                      >
                        {r.icon}
                        <span className="ml-2">Move to {r.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isActivePopped ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-xs gap-2 px-4 text-center">
            <ExternalLink size={20} className="text-zinc-600" />
            <span>This panel is floating</span>
            <span className="text-zinc-600">
              Close the floating window to dock it back
            </span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export const Sidebar = memo(SidebarInner);

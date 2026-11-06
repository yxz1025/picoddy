import { PanelLeft } from "lucide-react";
import { useStore } from "../store/useStore";
import "./SidebarRevealButton.css";

export default function SidebarRevealButton() {
  const collapsed = useStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const label = collapsed ? "展开侧边栏" : "收起侧边栏";
  return (
    <button
      type="button"
      className="sidebar-reveal-btn"
      onClick={toggleSidebar}
      title={label}
      aria-label={label}
    >
      <PanelLeft size={16} strokeWidth={1.75} />
    </button>
  );
}

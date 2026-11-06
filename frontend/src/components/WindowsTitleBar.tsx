import { useEffect, useState, type MouseEvent } from "react";
import { useStore } from "../store/useStore";
import { PiLogo } from "./PiLogo";
import "./WindowsTitleBar.css";

type WindowMenuId = "edit" | "window" | "help";

interface WindowTitlebarApi {
  windowMenu?: {
    popup: (menuId: WindowMenuId, x: number, y: number) => Promise<unknown>;
  };
  windowTitlebar?: {
    setTheme: (theme: "light" | "dark") => Promise<unknown>;
  };
}

const MENU_ITEMS: ReadonlyArray<{
  id: WindowMenuId;
  label: string;
  accessKey: string;
}> = [
  { id: "edit", label: "编辑(E)", accessKey: "e" },
  { id: "window", label: "窗口(W)", accessKey: "w" },
  { id: "help", label: "帮助(H)", accessKey: "h" },
];

function getWindowTitlebarApi(): WindowTitlebarApi | undefined {
  return (window as typeof window & { electronAPI?: WindowTitlebarApi })
    .electronAPI;
}

export default function WindowsTitleBar() {
  const theme = useStore((state) => state.theme);
  const [activeMenu, setActiveMenu] = useState<WindowMenuId | null>(null);

  useEffect(() => {
    void getWindowTitlebarApi()?.windowTitlebar?.setTheme(theme);
  }, [theme]);

  const openMenu = async (
    menuId: WindowMenuId,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const api = getWindowTitlebarApi()?.windowMenu;
    if (!api) return;
    setActiveMenu(menuId);
    try {
      await api.popup(menuId, rect.left, rect.bottom);
    } finally {
      setActiveMenu(null);
    }
  };

  return (
    <header className="windows-titlebar" aria-label="应用标题栏">
      <div className="windows-titlebar-brand">
        <PiLogo size={14} />
        <span>PiCoddy</span>
      </div>
      <nav className="windows-titlebar-menus" aria-label="应用菜单">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeMenu === item.id ? "active" : ""}
            accessKey={item.accessKey}
            aria-haspopup="menu"
            aria-expanded={activeMenu === item.id}
            onClick={(event) => void openMenu(item.id, event)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="windows-titlebar-drag-space" />
    </header>
  );
}

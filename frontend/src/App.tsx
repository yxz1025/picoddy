import { useUpdateConnection } from "./store/updateStore";
import UpdateToast from "./components/UpdateToast";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "./store/useStore";
import { useStreamStore } from "./store/useStreamStore";
import { initTheme } from "./store/appStore";
import { useIPC } from "./hooks/useIPC";
import {
  authSession,
  type AuthSessionView,
} from "./api/client";
import Sidebar from "./components/Sidebar";
import WorkbenchView from "./components/WorkbenchView";
import ChatArea from "./components/ChatArea";
import Composer from "./components/Composer";
import ArtifactPanel from "./components/ArtifactPanel";
import CommandPalette from "./components/CommandPalette";
import WorkspaceModal from "./components/WorkspaceModal";
import AskUserQuestionDialog from "./components/AskUserQuestionDialog";
import ToolConfirmDialog from "./components/ToolConfirmDialog";
import SettingsModal from "./components/SettingsModal";
import AppDialog from "./components/AppDialog";

import AutomationPanel from "./components/AutomationPanel";
import ExpertPanel from "./components/ExpertPanel";
import ProjectPanel from "./components/projects/ProjectPanel";
import FloatView from "./components/FloatView";
import WindowsTitleBar from "./components/WindowsTitleBar";
import SidebarRevealButton from "./components/SidebarRevealButton";
import "./components/SidebarRevealButton.css";

const IS_ELECTRON_WINDOWS = (
  window as typeof window & { electronAPI?: { platform?: string } }
).electronAPI?.platform === "win32";

type AppAuthPhase = "checking" | "signedOut" | "signingIn" | "signedIn";

export default function App() {
  useUpdateConnection();
  useIPC();
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const showArtifacts = useStore((state) => state.showArtifacts);
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const activeCategory = useStore((state) => state.activeCategory);
  const expertPanelTab = useStore((state) => state.expertPanelTab);
  const projectTapdAuthorization = useStore((state) => state.projectTapdAuthorization);
  const artifactSidebarCollapseHandled = useRef(false);
  useEffect(() => {
    if (!showArtifacts) {
      artifactSidebarCollapseHandled.current = false;
      return;
    }
    if (artifactSidebarCollapseHandled.current) return;
    artifactSidebarCollapseHandled.current = true;
    if (!sidebarCollapsed) toggleSidebar();
  }, [showArtifacts, sidebarCollapsed, toggleSidebar]);
  useEffect(() => {
    if (projectTapdAuthorization && activeCategory !== "expert" && activeCategory !== "project") {
      useStore.setState({ projectTapdAuthorization: false });
    }
  }, [activeCategory, projectTapdAuthorization]);
  const messageCount = useStore((state) => state.messages.length);
  const hasActiveStream = useStreamStore(
    (state) => state.activeStream !== null,
  );
  const busy = useStore((state) => state.busy);
  const loadWorkspaces = useStore((state) => state.loadWorkspaces);
  const loadConversations = useStore((state) => state.loadConversations);
  const loadSettings = useStore((state) => state.loadSettings);
  const [isFloat, setIsFloat] = useState(false);
  const [authPhase, setAuthPhase] = useState<AppAuthPhase>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSessionView, setAuthSessionView] = useState<
    AuthSessionView | null
  >(null);

  useEffect(() => {
    const t = initTheme();
    useStore.setState({ theme: t });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const pollSession = async () => {
      try {
        const res = await authSession();
        if (cancelled) return;
        if (res.authenticated && res.session) {
          setAuthSessionView(res.session);
          setAuthError(null);
          setAuthPhase("signedIn");
          timer = window.setTimeout(pollSession, 60_000);
          return;
        }
        setAuthSessionView(null);
        setAuthPhase((
          current: AppAuthPhase,
        ) => (current === "signingIn" ? current : "signedOut"));
        timer = window.setTimeout(pollSession, 1500);
      } catch (error) {
        if (cancelled) return;
        setAuthError(
          error instanceof Error ? error.message : "登录状态检查失败",
        );
        setAuthPhase((
          current: AppAuthPhase,
        ) => (current === "signingIn" ? current : "signedOut"));
        timer = window.setTimeout(pollSession, 3000);
      }
    };

    pollSession();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (authPhase !== "signedIn") return;
    loadSettings();
    loadWorkspaces().then(() => loadConversations());
  }, [authPhase, loadConversations, loadSettings, loadWorkspaces]);

  useEffect(() => {
    const checkHash = () => {
      setIsFloat(
        window.location.hash === "#float" ||
          window.location.search.includes("float=true"),
      );
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  const renderDesktopFrame = (content: ReactNode) => {
    if (!IS_ELECTRON_WINDOWS) return content;
    return (
      <div className="windows-desktop-frame">
        <WindowsTitleBar />
        <div className="windows-desktop-content">{content}</div>
      </div>
    );
  };

  if (authPhase !== "signedIn") {
    return renderDesktopFrame(<div className="app-loading" role="status">{authError || '正在载入本地工作区…'}</div>);
  }

  if (isFloat) {
    return <FloatView />;
  }

  const electronPlatform = (
    window as typeof window & { electronAPI?: { platform?: string } }
  ).electronAPI?.platform;
  const isMacElectron = electronPlatform === "darwin";
  const isWelcome =
    messageCount === 0 &&
    !hasActiveStream &&
    !busy &&
    activeCategory !== "automation" &&
    activeCategory !== "expert" &&
    activeCategory !== "project" &&
    activeCategory !== "workbench";

  return renderDesktopFrame(
    <div
      className={`app-shell${isMacElectron ? " mac-window" : ""}${
        sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""
      }`}
      style={{ display: "flex", height: "100%", overflow: "hidden" }}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        showInlineToggle={!isMacElectron}
        authSession={authSessionView}
      />

      <div
        className={`app-main ${isWelcome ? "app-main--welcome" : ""}`}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          position: "relative",
        }}
      >
        {sidebarCollapsed && !isMacElectron && (
          <div className="sidebar-reveal-host sidebar-reveal-host--web">
            <SidebarRevealButton />
          </div>
        )}
        {(activeCategory === "project" || projectTapdAuthorization) && (
          <div style={{ display: activeCategory === "project" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <ProjectPanel key={authSessionView?.userId || ""} accountId={authSessionView?.userId || ""} />
          </div>
        )}
        {activeCategory === "project"
          ? null
          : activeCategory === "automation"
          ? <AutomationPanel />
          : activeCategory === "expert"
          ? <ExpertPanel key={expertPanelTab} />
          : activeCategory === "workbench"
          ? <WorkbenchView />
          : (
            <div
              className={`chat-layout ${
                isWelcome ? "chat-layout--welcome" : ""
              }`}
            >
              <ChatArea />
              <Composer />
            </div>
          )}
      </div>

      {isMacElectron && (
        <div className="sidebar-reveal-host sidebar-reveal-host--mac">
          <SidebarRevealButton />
        </div>
      )}

      <ArtifactPanel />

      <CommandPalette />
      <WorkspaceModal />
      <SettingsModal />
      <UpdateToast />
      <AskUserQuestionDialog />
      <ToolConfirmDialog />
      <AppDialog />
    </div>,
  );
}

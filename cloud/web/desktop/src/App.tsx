import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "./store/useStore";
import { taskIdFromUrl } from "./taskNavigation";
import { useStreamStore } from "./store/useStreamStore";
import { useSkillStore } from "./store/useSkillStore";
import { useAutomationStore } from "./store/automationStore";
import { initTheme } from "./store/appStore";
import { useIPC } from "./hooks/useIPC";
import AuthScreen from "./components/AuthScreen";
import {
  authLogin,
  authLogout,
  authSession,
  consumeCasCallbackError,
  requireEnterpriseLoginUrl,
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
import WindowsTitleBar from "./components/WindowsTitleBar";
import SidebarRevealButton from "./components/SidebarRevealButton";
import "./components/SidebarRevealButton.css";

const IS_ELECTRON_WINDOWS = (
  window as typeof window & { electronAPI?: { platform?: string } }
).electronAPI?.platform === "win32";

type AppAuthPhase = "checking" | "signedOut" | "signingIn" | "signedIn";

export default function App() {
  useIPC();
  const sidebarCollapsed = useStore((state) => state.sidebarCollapsed);
  const activeCategory = useStore((state) => state.activeCategory);
  const expertPanelTab = useStore((state) => state.expertPanelTab);
  const projectTapdAuthorization = useStore((state) => state.projectTapdAuthorization);
  useEffect(() => {
    if (projectTapdAuthorization && activeCategory !== "expert") {
      useStore.setState({ projectTapdAuthorization: false });
    }
    if (activeCategory === 'project') useStore.setState({ activeCategory: 'assistant' });
  }, [activeCategory, projectTapdAuthorization]);
  const messageCount = useStore((state) => state.messages.length);
  const currentConversationCategory = useStore((state) =>
    state.conversations.find((conversation) =>
      conversation.id === state.currentConvId)?.category
  );
  const hasActiveStream = useStreamStore(
    (state) => state.activeStream !== null,
  );
  const busy = useStore((state) => state.busy);
  const loadWorkspaces = useStore((state) => state.loadWorkspaces);
  const loadConversations = useStore((state) => state.loadConversations);
  const loadSettings = useStore((state) => state.loadSettings);
  const [authPhase, setAuthPhase] = useState<AppAuthPhase>("checking");
  const [authError, setAuthError] = useState<string | null>(() =>
    consumeCasCallbackError(window.location.href, (url) => {
      window.history.replaceState(window.history.state, "", url);
    })
  );
  const authenticatedUser = useRef<string | null>(null);
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
          if (authenticatedUser.current && authenticatedUser.current !== res.session.userId) {
            window.location.reload();
            return;
          }
          authenticatedUser.current = res.session.userId;
          setAuthSessionView(res.session);
          setAuthError(null);
          setAuthPhase("signedIn");
          timer = window.setTimeout(pollSession, 60_000);
          return;
        }
        if (authenticatedUser.current) {
          window.location.reload();
          return;
        }
        setAuthSessionView(null);
        useStore.getState().resetToWelcome();
        useStore.setState({ ...useStore.getInitialState(), theme: initTheme() }, true);
        useSkillStore.setState(useSkillStore.getInitialState(), true);
        useAutomationStore.setState(useAutomationStore.getInitialState(), true);
        setAuthPhase((
          current: AppAuthPhase,
        ) => (current === "signingIn" ? current : "signedOut"));
        timer = window.setTimeout(pollSession, 1500);
      } catch (error) {
        if (cancelled) return;
        if (authenticatedUser.current) {
          // A transient network/5xx failure is not evidence that the session expired.
          timer = window.setTimeout(pollSession, 3000);
          return;
        }
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
    let cancelled = false;
    const restoreTask = () => {
      if (cancelled) return;
      const id = taskIdFromUrl(window.location.href);
      const store = useStore.getState();
      if (id && id !== store.currentConvId) void store.selectConversation(id);
      else if (!id && store.currentConvId) store.resetToWelcome();
    };
    window.addEventListener('popstate', restoreTask);
    void loadWorkspaces().then(() => loadConversations()).then(restoreTask);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', restoreTask);
    };
  }, [authPhase, loadConversations, loadSettings, loadWorkspaces]);


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
    return renderDesktopFrame(
      <AuthScreen
        phase={authPhase === "checking"
          ? "checking"
          : authPhase === "signingIn"
          ? "signingIn"
          : "signedOut"}
        error={authError}
        onLogin={async () => {
          setAuthError(null);
          setAuthPhase("signingIn");
          try {
            const response = await authLogin();
            const loginUrl = requireEnterpriseLoginUrl(response.loginUrl);
            window.location.assign(loginUrl);
          } catch (error) {
            setAuthPhase("signedOut");
            setAuthError(error instanceof Error ? error.message : "企业登录发起失败，请重试。");
            throw error;
          }
        }}
      />,
    );
  }


  const electronPlatform = (
    window as typeof window & { electronAPI?: { platform?: string } }
  ).electronAPI?.platform;
  const isMacElectron = electronPlatform === "darwin";
  const isWelcome =
    currentConversationCategory !== "skill_creator" &&
    currentConversationCategory !== "expert_creator" &&
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
        onLogout={async () => {
          try {
            await authLogout();
            // A document reload drops all user-scoped stores and event subscriptions.
            window.location.reload();
          } catch (error) {
            await useStore.getState().showUiAlert(error instanceof Error ? error.message : "退出失败，请重试");
          }
        }}
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
        {activeCategory === "automation"
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
      <AskUserQuestionDialog />
      <ToolConfirmDialog />
      <AppDialog />
    </div>,
  );
}

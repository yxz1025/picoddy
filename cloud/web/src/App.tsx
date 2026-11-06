import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, errorMessage } from "./api/client";
import { ChatPanel, type ChatSelection } from "./components/ChatPanel";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { Inspector } from "./components/Inspector";
import { Login } from "./components/Login";
import { SettingsHub } from "./components/settings/SettingsHub";
import { RetryButton, StateBlock, Toast } from "./components/ui";
import { useApiResource } from "./hooks/use-api-resource";
import type { Approval, CloudFile, Connector, Conversation, Expert, InspectorTab, Model, Workspace, Run, RunEvent, Skill, User } from "./types";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setBootError(null);
    try {
      setUser(await api.get<User>("/api/auth/me"));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setUser(null);
      else {
        setUser(null);
        setBootError(errorMessage(cause));
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (user === undefined) return <div className="app-boot"><img className="brand-seal" src="/icon-128.png" alt="PiCoddy" /><p>正在打开工作台…</p></div>;
  if (!user) {
    return <>{bootError ? <div className="boot-error"><StateBlock kind="error" title="无法连接云端服务" detail={bootError} action={<RetryButton onClick={() => void bootstrap()} />} /></div> : null}<Login onAuthenticated={setUser} /></>;
  }
  return <Workspace user={user} onSessionEnded={() => setUser(null)} />;
}

function Workspace({ user, onSessionEnded }: { user: User; onSessionEnded: () => void }) {
  const conversations = useApiResource<Conversation[]>("/api/conversations", []);
  const skills = useApiResource<Skill[]>("/api/skills", []);
  const connectors = useApiResource<Connector[]>("/api/connectors", []);
  const models = useApiResource<Model[]>("/api/models", []);
  const experts = useApiResource<Expert[]>("/api/experts", []);
  const files = useApiResource<CloudFile[]>("/api/files", []);
  const workspaces = useApiResource<Workspace[]>("/api/workspaces", []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ChatSelection>({ skillIds: [], connectorIds: [], fileIds: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("files");
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && conversations.data.length) setSelectedId(conversations.data[0].id);
    if (selectedId && !conversations.data.some((item) => item.id === selectedId)) setSelectedId(conversations.data[0]?.id ?? null);
  }, [conversations.data, selectedId]);

  useEffect(() => {
    setSelection({ skillIds: [], connectorIds: [], fileIds: [] });
  }, [selectedId]);

  const selectedConversation = useMemo(
    () => conversations.data.find((item) => item.id === selectedId) ?? null,
    [conversations.data, selectedId],
  );

  const runState = useCallback((run: Run | null, nextEvents: RunEvent[], nextApprovals: Approval[]) => {
    setCurrentRun(run);
    setEvents(nextEvents);
    setApprovals(nextApprovals);
  }, []);

  function showError(cause: unknown) {
    setToast(errorMessage(cause));
  }

  async function createConversation(title: string) {
    try {
      const created = await api.post<Conversation>("/api/conversations", { title });
      await conversations.reload();
      setSelectedId(created.id);
    } catch (cause) {
      showError(cause);
      throw cause;
    }
  }

  async function renameConversation(conversation: Conversation, title: string) {
    try {
      await api.patch(`/api/conversations/${conversation.id}`, { title });
      await conversations.reload();
    } catch (cause) {
      showError(cause);
    }
  }

  async function bindConversationWorkspace(workspaceId: string | null) {
    if (!selectedConversation) return;
    await api.patch(`/api/conversations/${selectedConversation.id}`, { workspaceId });
    await conversations.reload();
  }

  async function deleteConversation(conversation: Conversation) {
    if (!window.confirm(`删除会话“${conversation.title}”？此操作无法撤销。`)) return;
    try {
      await api.delete(`/api/conversations/${conversation.id}`);
      if (selectedId === conversation.id) setSelectedId(null);
      await conversations.reload();
    } catch (cause) {
      showError(cause);
    }
  }

  async function logout() {
    try {
      await api.post("/api/auth/logout");
      onSessionEnded();
    } catch (cause) {
      showError(cause);
    }
  }

  function openInspector(tab: InspectorTab) {
    setInspectorTab(tab);
    setInspectorOpen(true);
  }

  const resourceError = skills.error ?? connectors.error ?? files.error;
  const resourceLoading = skills.loading || connectors.loading || files.loading;

  return (
    <div className="workbench">
      {(sidebarOpen || inspectorOpen) ? <button className="mobile-scrim" onClick={() => { setSidebarOpen(false); setInspectorOpen(false); }} aria-label="关闭侧栏" /> : null}
      <ConversationSidebar
        user={user}
        conversations={conversations.data}
        selectedId={selectedId}
        loading={conversations.loading}
        error={conversations.error}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        onSelect={setSelectedId}
        onCreate={createConversation}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={() => void logout()}
      />
      <ChatPanel
        key={selectedConversation?.id ?? "empty"}
        conversation={selectedConversation}
        skills={skills.data}
        connectors={connectors.data}
        experts={experts.data}
        models={models.data}
        workspaces={workspaces.data}
        selection={selection}
        onSelectionChange={setSelection}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenInspector={openInspector}
        onWorkspaceChange={bindConversationWorkspace}
        onFilesChanged={files.reload}
        onRunState={runState}
      />
      <Inspector
        open={inspectorOpen}
        tab={inspectorTab}
        onTabChange={setInspectorTab}
        onClose={() => setInspectorOpen(false)}
        files={files.data}
        skills={skills.data}
        connectors={connectors.data}
        resourcesLoading={resourceLoading}
        resourcesError={resourceError}
        selection={selection}
        onSelectionChange={setSelection}
        onReloadFiles={files.reload}
        run={currentRun}
        events={events}
      />
      <SettingsHub
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        skills={skills}
        models={models}
        connectors={connectors}
        experts={experts}
        workspaces={workspaces}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
      {approvals.length ? <span className="sr-only">当前有 {approvals.filter((item) => item.status === "pending").length} 项待审批</span> : null}
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Edit3, LogOut, MessageSquarePlus, MoreHorizontal, Search, Settings2, Trash2, X } from "lucide-react";

import type { Conversation, User } from "../types";
import { Button, Spinner, StateBlock } from "./ui";

interface Props {
  user: User;
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelect: (id: string) => void;
  onCreate: (title: string) => Promise<void>;
  onRename: (conversation: Conversation, title: string) => Promise<void>;
  onDelete: (conversation: Conversation) => Promise<void>;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export function ConversationSidebar(props: Props) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);

  const filtered = props.conversations.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await props.onCreate(title.trim());
      setTitle("");
      setCreating(false);
    } catch {
      return;
    } finally {
      setBusy(false);
    }
  }

  async function rename(conversation: Conversation) {
    const next = window.prompt("修改会话名称", conversation.title)?.trim();
    if (!next || next === conversation.title) return;
    await props.onRename(conversation, next);
    setMenuId(null);
  }

  return (
    <aside className={`sidebar ${props.mobileOpen ? "sidebar--open" : ""}`}>
      <div className="sidebar__brand">
        <img className="brand-seal" src="/icon-128.png" alt="PiCoddy" />
        <div><strong>PiCoddy</strong><small>云端工作台</small></div>
        <button className="icon-button sidebar__close" onClick={props.onCloseMobile} aria-label="关闭会话栏">
          <X size={18} />
        </button>
      </div>

      <Button variant="primary" className="sidebar__new" onClick={() => setCreating(true)}>
        <MessageSquarePlus size={17} /> 新建会话
      </Button>

      {creating ? (
        <form className="quick-create" onSubmit={create}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="这次要完成什么？" autoFocus />
          <div><Button type="submit" disabled={busy || !title.trim()}>创建</Button><Button type="button" variant="quiet" onClick={() => setCreating(false)}>取消</Button></div>
        </form>
      ) : null}

      <label className="sidebar__search">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" />
      </label>

      <div className="sidebar__section-title"><span>最近工作</span><span>{filtered.length}</span></div>
      <nav className="conversation-list" aria-label="会话列表">
        {props.loading ? <Spinner label="读取会话" /> : null}
        {props.error ? <StateBlock kind="error" title="会话读取失败" detail={props.error} /> : null}
        {!props.loading && !props.error && filtered.length === 0 ? (
          <StateBlock kind="empty" title={query ? "没有匹配的会话" : "还没有会话"} detail={query ? "换个关键词试试" : "创建一个会话开始工作"} />
        ) : null}
        {filtered.map((conversation) => (
          <div className={`conversation-item ${conversation.id === props.selectedId ? "is-active" : ""}`} key={conversation.id}>
            <button className="conversation-item__main" onClick={() => { props.onSelect(conversation.id); props.onCloseMobile(); }}>
              <span>{conversation.title}</span>
              <small>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(conversation.updatedAt))}</small>
            </button>
            <button className="conversation-item__menu" onClick={() => setMenuId(menuId === conversation.id ? null : conversation.id)} aria-label="会话操作">
              <MoreHorizontal size={16} />
            </button>
            {menuId === conversation.id ? (
              <div className="context-menu">
                <button onClick={() => void rename(conversation)}><Edit3 size={14} /> 重命名</button>
                <button className="danger" onClick={() => { setMenuId(null); void props.onDelete(conversation); }}><Trash2 size={14} /> 删除</button>
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button className="profile-button" onClick={props.onOpenSettings}>
          <span className="avatar">{props.user.name?.slice(0, 1).toUpperCase() || "J"}</span>
          <span><strong>{props.user.name}</strong><small>{props.user.email}</small></span>
          <Settings2 size={16} />
        </button>
        <button className="icon-button" onClick={props.onLogout} aria-label="退出登录"><LogOut size={17} /></button>
      </div>
    </aside>
  );
}

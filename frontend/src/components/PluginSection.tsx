import { useEffect, useRef, useState } from "react";
import { Check, Package, Plus, Search, X } from "lucide-react";
import {
  usePluginStore,
  type NpmPackageHit,
  type PluginCatalogItem,
} from "../store/usePluginStore";
import { isDocumentProcessingCapability } from "./documentProcessingModel";

function installStateLabel(
  item: { pkg: string; installed?: boolean },
  installingId: string | null,
  installedPkgs: Set<string>,
): "installed" | "installing" | "idle" {
  if (installingId === item.pkg) return "installing";
  if (item.installed ?? installedPkgs.has(item.pkg)) return "installed";
  return "idle";
}

function InstallButton({
  pkg,
  state,
  onInstall,
}: {
  pkg: string;
  state: "installed" | "installing" | "idle";
  onInstall: (pkg: string) => void;
}) {
  if (state === "installing") {
    return (
      <button className="plugin-btn installing" disabled>
        <span className="plugin-spinner" />
        安装中…
      </button>
    );
  }
  if (state === "installed") {
    return (
      <button className="plugin-btn installed" disabled>
        <Check size={13} />
        已安装
      </button>
    );
  }
  return (
    <button className="plugin-btn" onClick={() => onInstall(pkg)}>
      <Plus size={13} />
      安装
    </button>
  );
}

function CatalogCard({ item }: { item: PluginCatalogItem }) {
  const {
    plugins,
    installingId,
    install,
    uninstall,
    activeCapability,
    selectCapability,
  } = usePluginStore();
  const [confirming, setConfirming] = useState(false);
  const installed = item.installed;
  return (
    <div
      className={`ep-card featured-card plugin-card ${
        installed ? "installed" : ""
      }`}
    >
      <div className="featured-card-header">
        <div className="skill-logo">
          <Package size={18} />
        </div>
        {installed ? (
          <div className="plugin-card-actions">
            {isDocumentProcessingCapability(item.pkg) && (
              <button
                className={`plugin-btn ${activeCapability === item.pkg ? "installed" : ""}`}
                onClick={() => selectCapability(item.pkg)}
              >
                {activeCapability === item.pkg ? "已选择" : "使用"}
              </button>
            )}
            <button
              className={`plugin-btn uninstall ${confirming ? "confirming" : ""}`}
              onClick={() => {
                if (confirming) {
                  const p = plugins.find((x) => x.name === item.pkg);
                  if (p) void uninstall(p.id);
                  setConfirming(false);
                } else {
                  setConfirming(true);
                }
              }}
            >
              {confirming ? "确认卸载？" : "卸载"}
            </button>
          </div>
        ) : (
          <InstallButton
            pkg={item.pkg}
            state={installStateLabel(item, installingId, new Set())}
            onInstall={install}
          />
        )}
      </div>
      <div className="skill-meta-info">
        <div className="skill-title-row">
          <span className="skill-title">{item.name}</span>
        </div>
        <div className="skill-desc">{item.description}</div>
        <div className="plugin-pkg-name">{item.pkg}</div>
      </div>
    </div>
  );
}

function SearchResultItem({ hit }: { hit: NpmPackageHit }) {
  const { plugins, installingId, install } = usePluginStore();
  const installedPkgs = new Set(plugins.map((p) => p.name));
  const installed = installedPkgs.has(hit.name);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={`ep-card featured-card plugin-card ${installed ? "installed" : ""}`}>
      <div className="featured-card-header">
        <div className="skill-logo">
          <Package size={18} />
        </div>
        <div className="plugin-search-actions">
          {installed ? (
            <button
              className="plugin-btn uninstall"
              onClick={() => {
                if (confirming) {
                  const p = plugins.find((x) => x.name === hit.name);
                  if (p) void usePluginStore.getState().uninstall(p.id);
                  setConfirming(false);
                } else {
                  setConfirming(true);
                }
              }}
            >
              {confirming ? "确认卸载？" : "卸载"}
            </button>
          ) : (
            <InstallButton
              pkg={hit.name}
              state={installStateLabel(
                { pkg: hit.name },
                installingId,
                installedPkgs,
              )}
              onInstall={install}
            />
          )}
        </div>
      </div>
      <div className="skill-meta-info">
        <div className="skill-title-row">
          <span className="skill-title">{hit.name}</span>
          {hit.version && <span className="plugin-version">v{hit.version}</span>}
        </div>
        <div className="skill-desc">{hit.description || "（无描述）"}</div>
        {hit.publisher && (
          <div className="plugin-pkg-name">
            by {typeof hit.publisher === "string"
              ? hit.publisher
              : hit.publisher.username}
          </div>
        )}
      </div>
    </div>
  );
}

export function PluginSection() {
  const {
    catalog,
    searchResults,
    searching,
    error,
    loadPlugins,
    loadCatalog,
    search,
    install,
  } = usePluginStore();
  const [query, setQuery] = useState("");
  const [manualPkg, setManualPkg] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSearched = searchResults.length > 0 || query.trim() !== "";

  useEffect(() => {
    void loadPlugins();
    void loadCatalog();
  }, [loadPlugins, loadCatalog]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      debounceRef.current = setTimeout(() => search(""), 200);
      return;
    }
    debounceRef.current = setTimeout(() => search(q), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const handleManualInstall = (e: React.FormEvent) => {
    e.preventDefault();
    const pkg = manualPkg.trim();
    if (!pkg) return;
    void install(pkg);
    setManualPkg("");
  };

  return (
    <div className="plugin-section">
      <div className="ep-section-header">
        <span className="ep-section-title">插件推荐</span>
        <span className="plugin-section-hint">Pi 生态扩展包，安装后新对话立即生效</span>
      </div>

      <div className="plugin-toolbar">
        <div className="plugin-search-box">
          <Search size={14} className="plugin-search-icon" />
          <input
            className="plugin-search-input"
            placeholder="搜索 npm 上的 Pi 扩展包…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="plugin-search-clear"
              onClick={() => setQuery("")}
              title="清空"
            >
              <X size={12} />
            </button>
          )}
          {searching && <span className="plugin-spinner" />}
        </div>
        <form className="plugin-manual-form" onSubmit={handleManualInstall}>
          <input
            className="plugin-manual-input"
            placeholder="手动输入包名（如 pi-web-access）"
            value={manualPkg}
            onChange={(e) => setManualPkg(e.target.value)}
          />
          <button className="plugin-btn" type="submit" disabled={!manualPkg.trim()}>
            安装
          </button>
        </form>
      </div>

      {error && (
        <div className="ep-expert-error" role="alert">
          {error}
        </div>
      )}

      {hasSearched ? (
        searchResults.length > 0 ? (
          <>
            <div className="ep-section-header margin-top-lg">
              <span className="ep-section-title">搜索结果</span>
            </div>
            <div className="ep-grid featured-grid">
              {searchResults.map((hit) => (
                <SearchResultItem key={hit.name} hit={hit} />
              ))}
            </div>
          </>
        ) : (
          <div className="plugin-empty">
            未找到匹配“{query.trim()}”的扩展包
          </div>
        )
      ) : (
        <>
          <div className="ep-section-header margin-top-lg">
            <span className="ep-section-title">精选</span>
          </div>
          <div className="ep-grid featured-grid">
            {catalog.map((item) => (
              <CatalogCard key={item.pkg} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

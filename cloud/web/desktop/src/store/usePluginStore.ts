import { create } from "zustand";
import { apiGet, apiPost } from "../api/client";

export interface PluginMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  loaded: boolean;
}

export interface PluginCatalogItem {
  pkg: string;
  name: string;
  description: string;
  readOnlyTools?: string[];
  installed: boolean;
}

export interface NpmPackageHit {
  name: string;
  version: string;
  description?: string;
  publisher?: string | { username?: string };
}

interface PluginState {
  plugins: PluginMeta[];
  catalog: PluginCatalogItem[];
  searchResults: NpmPackageHit[];
  searching: boolean;
  installingId: string | null;
  error: string | null;
  activeCapability: string | null;

  loadPlugins: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  search: (q: string) => Promise<void>;
  install: (pkg: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  selectCapability: (id: string) => void;
  clearCapability: () => void;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  catalog: [],
  searchResults: [],
  searching: false,
  installingId: null,
  error: null,
  activeCapability: null,
  selectCapability: (id) => set({ activeCapability: id }),
  clearCapability: () => set({ activeCapability: null }),

  loadPlugins: async () => {
    try {
      const list = await apiGet<PluginMeta[]>("/api/plugins");
      set({ plugins: list });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  loadCatalog: async () => {
    try {
      const list = await apiGet<PluginCatalogItem[]>("/api/plugins/catalog");
      set({ catalog: list });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  search: async (q: string) => {
    const query = q.trim();
    if (!query) {
      set({ searchResults: [], searching: false });
      return;
    }
    set({ searching: true, error: null });
    try {
      const results = await apiGet<NpmPackageHit[]>(
        `/api/plugins/search?q=${encodeURIComponent(query)}`,
      );
      set({ searchResults: results });
    } catch (e) {
      set({ error: (e as Error).message, searchResults: [] });
    } finally {
      set({ searching: false });
    }
  },

  install: async (pkg: string) => {
    set({ installingId: pkg, error: null });
    try {
      await apiPost("/api/plugins/install", { package: pkg });
      await Promise.all([get().loadPlugins(), get().loadCatalog()]);
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ installingId: null });
    }
  },

  uninstall: async (id: string) => {
    set({ installingId: id, error: null });
    try {
      await apiPost("/api/plugins/uninstall", { id });
      const removed = get().plugins.find((plugin) => plugin.id === id);
      if (removed && get().activeCapability === removed.name) {
        set({ activeCapability: null });
      }
      await Promise.all([get().loadPlugins(), get().loadCatalog()]);
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ installingId: null });
    }
  },
}));

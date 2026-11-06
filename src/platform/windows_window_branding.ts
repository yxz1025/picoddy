import { win32 } from "node:path";
import { stat } from "node:fs/promises";
const platformOs = process.platform === "win32" ? "windows" : process.platform;
import { loadKoffi } from "./koffi_loader.ts";


export const WINDOWS_WINDOW_TITLE = "PiCoddy";

const WM_SETICON = 0x0080;
const ICON_SMALL = 0n;
const ICON_BIG = 1n;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const GCLP_HICON = -14;
const GCLP_HICONSM = -34;

export function windowsWindowIconCandidates(
  execPath: string,
  cwd: string,
): string[] {
  return [
    win32.join(win32.dirname(execPath), "AppIcon.ico"),
    win32.join(win32.dirname(execPath), "resources", "app-icon.ico"),
    win32.join(cwd, "resources", "app-icon.ico"),
  ];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolveWindowIconPath(): Promise<string | null> {
  for (
    const candidate of windowsWindowIconCandidates(
      process.execPath,
      process.cwd(),
    )
  ) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function wideString(value: string): Uint16Array {
  return new Uint16Array(
    [...value].map((character) => character.charCodeAt(0)).concat(0),
  );
}

interface WindowBrandingResult {
  brandedWindows: number;
  iconPath: string | null;
}

async function applyWindowsWindowBrandingOnce(
  title: string,
): Promise<WindowBrandingResult> {
  const iconPath = await resolveWindowIconPath();
  const koffi = loadKoffi();
  const lib = koffi.load("user32.dll");
  const user32 = {
    symbols: {
      EnumWindows: lib.func(
        "int32_t EnumWindows(void *callback, void *context)",
      ),
      GetWindowThreadProcessId: lib.func(
        "uint32_t GetWindowThreadProcessId(void *window, void *processId)",
      ),
      SetWindowTextW: lib.func("int32_t SetWindowTextW(void *window, void *text)"),
      LoadImageW: lib.func(
        "void *LoadImageW(void *instance, void *name, uint32_t type, int32_t width, int32_t height, uint32_t flags)",
      ),
      SendMessageW: lib.func(
        "intptr_t SendMessageW(void *window, uint32_t message, uintptr_t wparam, void *lparam)",
      ),
      SetClassLongPtrW: lib.func(
        "void *SetClassLongPtrW(void *window, int32_t index, void *value)",
      ),
    },
    close: () => lib.unload(),
  };

  const largeIcon = iconPath
    ? user32.symbols.LoadImageW(
      null,
      wideString(iconPath),
      IMAGE_ICON,
      32,
      32,
      LR_LOADFROMFILE,
    )
    : null;
  const smallIcon = iconPath
    ? user32.symbols.LoadImageW(
      null,
      wideString(iconPath),
      IMAGE_ICON,
      16,
      16,
      LR_LOADFROMFILE,
    )
    : null;

  let brandedWindows = 0;
  const processId = process.pid;
  const callback = koffi.register(
    (windowHandle: bigint | null, _context: bigint | null) => {
      const ownerProcessId = new Uint32Array(1);
      user32.symbols.GetWindowThreadProcessId(windowHandle, ownerProcessId);
      if (ownerProcessId[0] !== processId) return 1;

      user32.symbols.SetWindowTextW(windowHandle, wideString(title));
      if (largeIcon) {
        user32.symbols.SendMessageW(
          windowHandle,
          WM_SETICON,
          ICON_BIG,
          largeIcon,
        );
        user32.symbols.SetClassLongPtrW(windowHandle, GCLP_HICON, largeIcon);
      }
      if (smallIcon) {
        user32.symbols.SendMessageW(
          windowHandle,
          WM_SETICON,
          ICON_SMALL,
          smallIcon,
        );
        user32.symbols.SetClassLongPtrW(windowHandle, GCLP_HICONSM, smallIcon);
      }
      brandedWindows += 1;
      return 1;
    },
    "int32_t (void *windowHandle, void *context)",
  );

  try {
    user32.symbols.EnumWindows(callback, null);
  } finally {
    koffi.unregister(callback);
    user32.close();
  }

  return { brandedWindows, iconPath };
}

export async function applyWindowsWindowBranding(
  title = WINDOWS_WINDOW_TITLE,
): Promise<WindowBrandingResult> {
  if (platformOs !== "windows") {
    return { brandedWindows: 0, iconPath: null };
  }

  for (const delay of [0, 80, 250]) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const result = await applyWindowsWindowBrandingOnce(title);
    if (result.brandedWindows > 0) return result;
  }

  return { brandedWindows: 0, iconPath: await resolveWindowIconPath() };
}

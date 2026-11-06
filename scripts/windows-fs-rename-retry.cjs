const fs = require("node:fs/promises");

if (process.platform === "win32") {
  const originalRename = fs.rename.bind(fs);
  const originalWriteFile = fs.writeFile.bind(fs);
  const retryableCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
  const maxAttempts = 20;

  function retryDelay(attempt) {
    return new Promise((resolve) =>
      setTimeout(resolve, Math.min(100 * attempt, 1_000)),
    );
  }

  fs.rename = async function renameWithWindowsRetry(oldPath, newPath) {
    const oldPathText = String(oldPath);
    const newPathText = String(newPath);
    const isAtomicTempPromotion = oldPathText === `${newPathText}.tmp`;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await originalRename(oldPath, newPath);
      } catch (error) {
        const shouldRetry =
          isAtomicTempPromotion &&
          retryableCodes.has(error?.code) &&
          attempt < maxAttempts;

        if (!shouldRetry) {
          throw error;
        }

        if (attempt === 1) {
          console.warn(
            `[windows-fs] ${error.code}: rename 暂时被占用，将重试：${oldPathText} -> ${newPathText}`,
          );
        }
        await retryDelay(attempt);
      }
    }
  };

  fs.writeFile = async function writeFileWithWindowsRetry(file, data, options) {
    const fileText = String(file);
    const normalizedFile = fileText.replaceAll("\\", "/").toLowerCase();
    const isPackagedExecutable =
      normalizedFile.includes("/win-unpacked/") &&
      normalizedFile.endsWith(".exe");

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await originalWriteFile(file, data, options);
      } catch (error) {
        const shouldRetry =
          isPackagedExecutable &&
          retryableCodes.has(error?.code) &&
          attempt < maxAttempts;

        if (!shouldRetry) {
          throw error;
        }

        if (attempt === 1) {
          console.warn(
            `[windows-fs] ${error.code}: EXE 写入暂时被占用，将重试：${fileText}`,
          );
        }
        await retryDelay(attempt);
      }
    }
  };
}

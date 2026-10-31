/** The SDK accepts an async OS encryption provider; credentials never cross into the page. */
export function chatCredentials(safeStorage) {
  return {
    id: "codex-ui-safe-storage-async-v1",
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    async encrypt(plain) {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("OS credential protection unavailable");
      return safeStorage.encryptStringAsync(plain);
    },
    async decrypt(bytes) {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error("OS credential protection unavailable");
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(bytes));
      return result;
    },
  };
}

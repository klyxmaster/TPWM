(() => {
    "use strict";

    const api = globalThis.browser ?? globalThis.chrome;
    const STORAGE_KEY = "tpwmVault";

    async function getVault() {
        const result = await api.storage.local.get(STORAGE_KEY);
        return result[STORAGE_KEY] || null;
    }

    async function saveVault(vaultRecord) {
        await api.storage.local.set({
            [STORAGE_KEY]: structuredClone(vaultRecord)
        });

        try {
            await api.runtime.sendMessage({ type: "vaultChanged" });
        } catch {
            // The manager can save even if the background page is restarting.
        }
    }

    async function deleteVault() {
        await api.storage.local.remove(STORAGE_KEY);

        try {
            await api.runtime.sendMessage({ type: "vaultChanged" });
        } catch {
            // Nothing else is required.
        }
    }

    window.TPWMDatabase = {
        getVault,
        saveVault,
        deleteVault
    };
})();

"use strict";

if (typeof importScripts === "function") {
    importScripts("crypto.js");
}

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_IDLE_MINUTES = 10;
let memoryVault = null;
let memoryDeadline = 0;

async function getArea(area, keys) {
    return area.get(keys);
}
async function setArea(area, values) {
    return area.set(values);
}
async function removeArea(area, keys) {
    return area.remove(keys);
}

async function sessionGet(keys) {
    if (!api.storage.session) return { unlockedVault: memoryVault, lockDeadline: memoryDeadline };
    return getArea(api.storage.session, keys);
}
async function sessionSet(values) {
    if (Object.hasOwn(values, "unlockedVault")) memoryVault = values.unlockedVault;
    if (Object.hasOwn(values, "lockDeadline")) memoryDeadline = values.lockDeadline;
    if (api.storage.session) await setArea(api.storage.session, values);
}
async function sessionClear() {
    memoryVault = null;
    memoryDeadline = 0;
    if (api.storage.session) await api.storage.session.clear();
}

function normalizeHost(value) {
    return String(value || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}
function hostFromRecord(record) {
    const raw = String(record.url || "").trim();
    if (!raw) return "";
    try {
        const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
        return normalizeHost(new URL(candidate).hostname);
    } catch {
        return normalizeHost(raw.split("/")[0]);
    }
}
function hostsMatch(activeHost, recordHost) {
    const active = normalizeHost(activeHost);
    const saved = normalizeHost(recordHost);
    if (!active || !saved) return false;
    return active === saved || active.endsWith(`.${saved}`) || saved.endsWith(`.${active}`);
}

async function getUnlockedVault() {
    const session = await sessionGet(["unlockedVault", "lockDeadline"]);
    const vault = session.unlockedVault ?? memoryVault;
    const deadline = Number(session.lockDeadline ?? memoryDeadline);
    if (!vault || !deadline || Date.now() >= deadline) {
        await sessionClear();
        return null;
    }
    return vault;
}
async function touchSession(vault) {
    const minutes = Number(vault?.settings?.idleTimeoutMinutes) || DEFAULT_IDLE_MINUTES;
    const lockDeadline = Date.now() + minutes * 60 * 1000;
    await sessionSet({ unlockedVault: vault, lockDeadline });
}

async function getStatus() {
    const stored = await getArea(api.storage.local, ["tpwmVault"]);
    const vaultRecord = stored.tpwmVault || null;
    const vault = await getUnlockedVault();
    return {
        hasPackage: Boolean(vaultRecord),
        accountId: vaultRecord?.accountId || "",
        unlocked: Boolean(vault),
        websiteCount: vault?.records?.websites?.length || 0
    };
}

async function importPackage(packageData) {
    const metadata = TPWMCrypto.validatePackage(packageData);
    await setArea(api.storage.local, { tpwmVault: structuredClone(packageData.vault) });
    await sessionClear();
    return { accountId: metadata.accountId, modifiedAt: metadata.modifiedAt || "" };
}

async function unlock(password) {
    const stored = await getArea(api.storage.local, ["tpwmVault"]);
    if (!stored.tpwmVault) throw new Error("Create or import a TPWM vault first.");

    const packageData = {
        packageType: "TPWM_ENCRYPTED_VAULT",
        packageVersion: 1,
        vault: stored.tpwmVault
    };

    const vault = await TPWMCrypto.decryptPackage(packageData, password);
    await touchSession(vault);

    return {
        accountId: vault.account?.id || stored.tpwmVault.accountId,
        websiteCount: vault.records.websites.length
    };
}

async function getMatches(hostname) {
    const vault = await getUnlockedVault();
    if (!vault) throw new Error("TPWM is locked.");
    await touchSession(vault);
    return (vault.records.websites || [])
        .filter(record => hostsMatch(hostname, hostFromRecord(record)))
        .map(record => ({
            id: record.id,
            siteName: record.siteName || hostFromRecord(record) || "Website",
            loginId: record.loginId || record.emailUsed || "",
            url: record.url || ""
        }))
        .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.loginId.localeCompare(b.loginId));
}

async function getCredential(recordId) {
    const vault = await getUnlockedVault();
    if (!vault) throw new Error("TPWM is locked.");
    const record = (vault.records.websites || []).find(item => item.id === recordId);
    if (!record) throw new Error("The selected TPWM record was not found.");
    await touchSession(vault);
    return { username: record.loginId || record.emailUsed || "", password: record.password || "" };
}

function fillLoginForm(credential) {
    function isVisible(element) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 &&
            rect.width > 0 && rect.height > 0 && !element.disabled && !element.readOnly;
    }
    function scoreUsername(input) {
        const type = (input.type || "text").toLowerCase();
        const tokens = [input.name, input.id, input.autocomplete, input.placeholder,
            input.getAttribute("aria-label")].join(" ").toLowerCase();
        let score = 0;
        if (type === "email") score += 100;
        if (type === "text" || type === "tel" || type === "") score += 20;
        if (/user|login|email|phone|identifier|account/.test(tokens)) score += 80;
        if (/search|coupon|promo/.test(tokens)) score -= 100;
        if (input.autocomplete === "username") score += 120;
        return score;
    }
    function setNativeValue(input, value) {
        if (!input || !value) return false;
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        input.focus();
        if (descriptor?.set) descriptor.set.call(input, value); else input.value = value;
        for (const type of ["input", "change", "blur"]) {
            input.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        }
        return true;
    }

    const allInputs = [...document.querySelectorAll("input")].filter(isVisible);
    const passwordInputs = allInputs.filter(input => (input.type || "").toLowerCase() === "password");
    const usernameInputs = allInputs
        .filter(input => ["text", "email", "tel", ""].includes((input.type || "").toLowerCase()))
        .map(input => ({ input, score: scoreUsername(input) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.input);

    const usernameFilled = setNativeValue(usernameInputs[0], credential.username);
    const passwordFilled = setNativeValue(passwordInputs[0], credential.password);
    const target = passwordInputs[0] || usernameInputs[0];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    return {
        usernameFilled,
        passwordFilled,
        usernameFieldsFound: usernameInputs.length,
        passwordFieldsFound: passwordInputs.length
    };
}

async function fillCredential(tabId, recordId) {
    const credential = await getCredential(recordId);
    const results = await api.scripting.executeScript({
        target: { tabId, allFrames: false },
        func: fillLoginForm,
        args: [credential]
    });
    return results?.[0]?.result || {
        usernameFilled: false,
        passwordFilled: false,
        usernameFieldsFound: 0,
        passwordFieldsFound: 0
    };
}

api.runtime.onMessage.addListener(message => {
    const execute = async () => {
        switch (message?.type) {
            case "status": return getStatus();
            case "importPackage": return importPackage(message.packageData);
            case "unlock": return unlock(message.password);
            case "lock": await sessionClear(); return { locked: true };
            case "removeVault": await removeArea(api.storage.local, ["tpwmVault"]); await sessionClear(); return { removed: true };
            case "getMatches": return getMatches(message.hostname);
            case "fillCredential": return fillCredential(message.tabId, message.recordId);
            case "openManager": {
				const managerUrl = api.runtime.getURL("manager.html");
				const existingTabs = await api.tabs.query({ url: managerUrl });
				if (existingTabs.length > 0) {
					const managerTab = existingTabs[0];
					await api.tabs.update(managerTab.id, {
						active: true
					});
					await api.windows.update(managerTab.windowId, {
						focused: true
					});
					return {
						opened: false,
						reused: true
					};
				}
				await api.tabs.create({
					url: managerUrl,
					active: true
				});
				return {
					opened: true,
					reused: false
				};
			}
            case "vaultChanged":
                await sessionClear();
                return { refreshed: true };
            default: throw new Error("Unknown TPWM extension request.");
        }
    };
    return execute().then(data => ({ ok: true, data })).catch(error => ({ ok: false, error: error.message }));
});

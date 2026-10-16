/**
 * Models the account is not entitled to. `GET /models` does not report entitlements,
 * so a model is only discovered to be unusable by making a request that fails with
 * 403. Keys are `providerID/modelID`.
 */
export class Quarantine {
    #keys = new Set();
    constructor(initial = []) {
        for (const key of initial)
            this.#keys.add(key);
    }
    static keyOf(providerID, modelID) {
        return `${providerID}/${modelID}`;
    }
    has(key) {
        return this.#keys.has(key);
    }
    /** Returns true when the key was newly added, so callers persist only on change. */
    add(key) {
        if (this.#keys.has(key))
            return false;
        this.#keys.add(key);
        return true;
    }
    replace(keys) {
        this.#keys.clear();
        for (const key of keys)
            this.#keys.add(key);
    }
    list() {
        return [...this.#keys].sort();
    }
}
export function parseQuarantine(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    const record = value;
    if (typeof record.credential !== "string" || !Array.isArray(record.keys))
        return undefined;
    return {
        credential: record.credential,
        keys: record.keys.filter((entry) => typeof entry === "string" && entry !== ""),
    };
}
export function isQuarantineStatus(status) {
    return status === 403;
}
//# sourceMappingURL=quarantine.js.map
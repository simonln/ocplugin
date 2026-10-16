/**
 * Models the account is not entitled to. `GET /models` does not report entitlements,
 * so a model is only discovered to be unusable by making a request that fails with
 * 403. Keys are `providerID/modelID`.
 */
export declare class Quarantine {
    #private;
    constructor(initial?: readonly string[]);
    static keyOf(providerID: string, modelID: string): string;
    has(key: string): boolean;
    /** Returns true when the key was newly added, so callers persist only on change. */
    add(key: string): boolean;
    replace(keys: readonly string[]): void;
    list(): string[];
}
export interface StoredQuarantine {
    readonly credential: string;
    readonly keys: readonly string[];
}
export declare function parseQuarantine(value: unknown): StoredQuarantine | undefined;
export declare function isQuarantineStatus(status: number): boolean;
//# sourceMappingURL=quarantine.d.ts.map
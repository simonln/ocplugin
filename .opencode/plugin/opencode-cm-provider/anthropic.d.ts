/**
 * CC exposes an Anthropic-compatible endpoint, but it only accepts user and
 * assistant turns in `messages`. Newer OpenCode SDKs may emit a mid-conversation
 * system turn for Claude 5 models, so lower that turn before sending the request.
 */
export declare function rewriteCommandCodeMessages(request: Request): Promise<Request>;
//# sourceMappingURL=anthropic.d.ts.map
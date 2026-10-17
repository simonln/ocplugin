/**
 * CC exposes an Anthropic-compatible endpoint, but it only accepts user and
 * assistant turns in `messages`. Newer OpenCode SDKs may emit a mid-conversation
 * system turn for Claude 5 models, so lower that turn before sending the request.
 */
export async function rewriteCommandCodeMessages(request) {
    try {
        if (!new URL(request.url).pathname.endsWith("/messages"))
            return request;
    }
    catch {
        return request;
    }
    if (!request.body)
        return request;
    let body;
    try {
        body = await request.clone().json();
    }
    catch {
        return request;
    }
    if (!isRecord(body) || !Array.isArray(body.messages))
        return request;
    const messages = [];
    let changed = false;
    for (const raw of body.messages) {
        if (!isRecord(raw) || raw.role !== "system") {
            messages.push(raw);
            continue;
        }
        changed = true;
        const content = raw.content;
        if (isEmptyContent(content))
            continue;
        const previous = messages.at(-1);
        if (previous?.role === "user") {
            previous.content = mergeContent(previous.content, content);
            continue;
        }
        messages.push({ role: "user", content });
    }
    if (!changed)
        return request;
    const rewritten = { ...body, messages };
    return new Request(request, { body: JSON.stringify(rewritten) });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isEmptyContent(value) {
    if (value === undefined || value === null || value === "")
        return true;
    return Array.isArray(value) && value.length === 0;
}
function mergeContent(previous, next) {
    if (Array.isArray(previous))
        return Array.isArray(next) ? [...previous, ...next] : [...previous, next];
    if (Array.isArray(next))
        return [previous, ...next];
    return [previous, next];
}
//# sourceMappingURL=anthropic.js.map
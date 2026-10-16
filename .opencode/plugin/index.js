/**
 * Package entry point for OpenCode's plugin loader.
 *
 * OpenCode resolves a plugin package through this conventional path inside the
 * package, the same way the reference plugin (superpowers) declares
 * `"main": ".opencode/plugins/<name>.js"`. Pointing `main` at `dist/` instead
 * leaves the package unresolvable, and the loader skips it silently — no
 * "loading plugin" line and no error.
 *
 * This file stays thin on purpose: it only re-exports the compiled entry point so
 * the package keeps a single implementation in `src/` and one build output in
 * `dist/`.
 */
export { default } from "../../dist/index.js"

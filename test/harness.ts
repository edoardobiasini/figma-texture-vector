// Bundled into an IIFE and run through the figma-console Desktop Bridge (figma_execute),
// so the document half of the plugin can be exercised without closing the Bridge to run
// the real plugin. Exposes the same functions code.ts uses.
import { describe, insertResult, isolate, prepare } from '../src/document.ts'

;(globalThis as Record<string, unknown>).__ttv = { describe, insertResult, isolate, prepare }

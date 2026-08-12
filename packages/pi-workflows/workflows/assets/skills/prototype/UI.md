# UI Prototype

Use when the question is what a page, flow, or interaction should look like. Use [LOGIC.md](LOGIC.md) instead when the uncertainty is state or behavior.

## Process

1. State the question and create three structurally different variants by default; use no more than five.
2. Prefer mounting variants on the real host page so they inherit real data, density, navigation, and constraints. Create a clearly named throwaway route only when no suitable host exists.
3. Switch variants with a shareable URL parameter such as `?variant=A` and an obvious, development-only switcher. Keep existing fetching above the variant boundary.
4. Make variants differ in layout, hierarchy, or primary action—not merely colour or copy. Do not over-share layout code that would hide those differences.
5. Use read-only data or stubs for mutations. The question is visual and interaction fit, not backend correctness.
6. Capture the selected direction and why. Fold the chosen direction into real code through the normal workflow, then remove losing variants and the switcher from the main branch.

## Avoid

- Isolated blank pages when the design belongs in an existing surface.
- Variants that differ only cosmetically.
- Shipping the switcher or prototype route to production.

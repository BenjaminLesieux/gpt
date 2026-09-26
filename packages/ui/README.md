# @gpt/ui

The shadcn/ui + BaseUI primitives, the Gitarpro design tokens, and the product
components both apps render — the score player under `@gpt/ui/score/*` — shared
by the companion (Tauri) and the hub (web) so the two halves of the product
cannot drift apart. Product components take their copy as props; the apps
translate it.

## Using it

```tsx
import { Button } from '@gpt/ui/button';
import { cn } from '@gpt/ui/lib/utils';
```

Each primitive is its own subpath — there is no barrel, because
`alert-dialog` and `dialog` export overlapping names.

In CSS, after the app's own `@import 'tailwindcss'`:

```css
@import '@gpt/ui/theme.css';
```

`theme.css` pulls in `tokens.css` and maps the raw values onto shadcn's
semantic slots. It deliberately does not import Tailwind itself.

## Adding a primitive

Run the CLI from this directory, never from an app:

```sh
cd packages/ui && pnpm dlx shadcn@latest add @shadcn/<name>
```

Then rewrite the import it writes at the top of the new file — the package
uses relative imports internally so that each app's own `@/` alias stays
free:

```sh
sed -i '' -e 's#from "@/lib/utils"#from "../../lib/utils"#' \
          -e 's#from "cn"#from "../../lib/utils"#' \
          -e 's#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' \
          src/components/ui/<name>.tsx
```

The second rule is cosmetic, not a correction. Newer registry components import
`cn` from the [`cn`](https://github.com/shadcn-ui/cn) package — shadcn's own
compiled, zero-dependency replacement for `clsx + tailwind-merge` — and the CLI
adds it as a dependency, which is right. `src/lib/utils.ts` re-exports it, so
both spellings resolve to the same function; the rewrite only keeps every
component in this directory importing from one place.

## Fonts

`tokens.css` names the faces but ships none. The licensed Bauhaus family is
vendored in the companion (`apps/companion/src/styles/fonts.css`) because it
is licensed for the desktop app; the hub substitutes Space Grotesk.

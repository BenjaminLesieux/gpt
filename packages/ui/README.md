# @gpt/ui

The shadcn/ui + BaseUI primitives and the Gitarpro design tokens, shared by
the companion (Tauri) and the hub (web) so the two halves of the product
cannot drift apart.

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
          -e 's#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' \
          src/components/ui/<name>.tsx
```

## Fonts

`tokens.css` names the faces but ships none. The licensed Bauhaus family is
vendored in the companion (`apps/companion/src/styles/fonts.css`) because it
is licensed for the desktop app; the hub substitutes Space Grotesk.

# NeatSpace-Selfcare — Bridge Storefront

Spa-calm wellness storefront for the **NeatSpace Selfcare** Pinterest account.
GitHub Pages + client-side hydration from per-product JSON committed by
NeatSpace-Core's bridge (`pinner/tools/bridge.py`).

## Handshake

`/?id=<product_key>` → fetch `./products/<product_key>.json` → hydrate.
The dual-schema normalizer in `app.js` accepts **both** payload generations:
nested bridge canonical (`product.price`, `product.images[]`) and the flat
contract (`price`, `original_price`, top-level `images[]`). Prices may be
numbers or strings ("$29.90", "US $1,199").

## Files

| File | Purpose |
|---|---|
| `index.html` | Skeleton / product / 404 views, OG meta hooks |
| `style.css` | Eucalyptus mist + blush palette, glassmorphism, 1:1 gallery, ≥720px two-column |
| `app.js` | Sanitizer, dual-shape normalizer, carousel, hydration, fallback grid |
| `featured.json` *(optional)* | Up to 6 product keys for the "Rest & reset picks" fallback |

## Security posture

Untrusted marketplace text renders via `textContent`/`createElement` only (no
`innerHTML`, no eval); `?id` whitelisted to `[A-Za-z0-9._-]{1,120}`; images use
`referrerpolicy="no-referrer"`; CTAs carry `rel="nofollow sponsored noopener"`.

## Deploy

Push to `main`, enable Pages (branch: main, root). Optional custom domain goes
in Pages settings AND Atlas `accounts.site.custom_domain`.

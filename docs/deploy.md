# Deploying to Vercel and img.tanujp.com

## Vercel project

1. Push the repo to GitHub (planned for later).
2. In Vercel, choose **Add New → Project**, then import the repo.
3. Set the **Root Directory** to `web`. The framework preset is Vite, the build command is `npm run build`, and the output is `dist`. All of this is already in `web/vercel.json`.
4. Deploy. No environment variables are needed.

Without GitHub you can also deploy straight from the folder:

```bash
cd web
npx vercel        # first time: links the project
npx vercel --prod
```

## Domain

1. In Vercel, open **Project → Settings → Domains**, then add `img.tanujp.com`.
2. Wherever the DNS for `tanujp.com` is managed, add this record:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `img` | `cname.vercel-dns.com` |

3. Wait for Vercel to show **Valid Configuration**. HTTPS is issued automatically. The camera and motion sensors on phones need HTTPS.

## Headers

`web/vercel.json` sets these headers:
- `Permissions-Policy`, which allows camera and motion sensors on this origin only.
- Long-term caching for hashed assets. The OpenCV WASM chunk is about 10 MB and is downloaded once.

## Local helper and the live site

The helper's default allowed origins already include `https://img.tanujp.com`. If you ever serve the app from another domain, add it to `ASTER_ORIGINS`.

# [affinity.] live release identity receipt — October 1, 2026

Checked by 2026-10-01T18:53:00Z, the public `https://affinity.pwr-labs.ai/api/health` response was HTTP 200 with `status: ok` and `release.commit: 856d6719d368107f85a2783c795adcb46fe6d52b`, `release.branch: main`. `git ls-remote origin refs/heads/main` returned that same 40-character commit. The cache-bypassed `/api/health?deep=1` response was also HTTP 200 and reported `app: ok`, `database: ok`, `marketplaceApiKey: present`, and `marketplaceApi: ok` alongside the same release identity.

The health route reads Render's documented runtime [`RENDER_GIT_COMMIT` and `RENDER_GIT_BRANCH`](https://render.com/docs/environment-variables), validates the values before returning them, and sends `Cache-Control: no-store`. This ties the responding service to its declared source commit; a pushed commit or a successful local build alone would not do that.

This is a **time-bounded release receipt**, not a permanent pilot freeze. A subsequent push can deploy a new commit, so the final evaluation must compare the live receipt with the intended remote SHA immediately before testing. A Render control-plane deploy ID was not obtained because no workspace was selected for that read; the health endpoint does not invent one. This check does not confer UH pilot authorization or establish coverage accuracy.

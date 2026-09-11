# Recorded route responses

| Fixture                  | What it holds                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| `serving-responses.json` | Serving-endpoint responses, consumed by `insights-routes.test.ts`. |

It is captured from a running system, byte for byte. Do not hand-edit it:
a value corrected by hand stops being a record of what the route returns, which
is the only thing the file is for. Regenerate instead.

One field is substituted: `stakeholder` reads `firstname.lastname@databricks.com`
rather than the requesting engineer's address. Re-substitute it after any
regeneration or the mirror sync will refuse the push.

## Regenerating

Read-only, no side effects on the app.

```bash
APP=<the deployed app URL>
TOKEN=$(databricks auth token -p <profile> \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
curl -s -H "Authorization: Bearer $TOKEN" "$APP/api/runs"
```

An unauthenticated request is refused by the platform before it reaches the app,
so that 401 says nothing about the app's own identity handling.

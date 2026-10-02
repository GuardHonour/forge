import json, sys, urllib.request

ROOT = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data"
PORT = 62477
BASE = f"http://127.0.0.1:{PORT}"
PROJECT = "forge-ui-upgrade"

cfg = json.load(open(ROOT + "/.od/media-config.json", encoding="utf-8"))
key = cfg["providers"]["openrouter"]["apiKey"]
base_url = cfg["providers"]["openrouter"]["baseUrl"]
assert key.startswith("sk-or-v1-") and len(key) > 40

brief = open(r"C:/Users/Admin/workout-app/_od/forge-ui-upgrade-brief.txt", encoding="utf-8").read()

body = {
    "agentId": "deepseek-harness",
    "projectId": PROJECT,
    "message": brief,
    "model": "openrouter/~google/gemini-pro-latest",
    "byokProvider": {"protocol": "openai", "apiKey": key, "baseUrl": base_url},
}
req = urllib.request.Request(
    BASE + "/api/runs",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode("utf-8"))
    print("start run:", r.status, json.dumps({k: resp.get(k) for k in ("runId", "conversationId", "reused", "resumed")}))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode("utf-8", "replace")[:500])
    sys.exit(1)

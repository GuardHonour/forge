import json, sys, urllib.request

ROOT = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 62477
BASE = f"http://127.0.0.1:{PORT}"

cfg = json.load(open(ROOT + "/.od/media-config.json", encoding="utf-8"))
key = cfg["providers"]["openrouter"]["apiKey"]
base_url = cfg["providers"]["openrouter"]["baseUrl"]
assert key.startswith("sk-or-v1-") and len(key) > 40, "key shape unexpected"

brief = open(r"C:/Users/Admin/workout-app/_od/forge-ui-upgrade-brief.txt", encoding="utf-8").read()

def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:800]

# 1. create the project (idempotent-looking slug id; fall back to server id)
body = {"id": "forge-ui-upgrade", "name": "forge-ui-upgrade"}
code, resp = post("/api/projects", body)
print("create project:", code, str(resp)[:300])
pid = None
if isinstance(resp, dict):
    p = resp.get("project") or resp
    pid = p.get("id")
if not pid:
    code, resp = post("/api/projects", {"name": "forge-ui-upgrade"})
    print("create project (no id):", code, str(resp)[:300])
    p = resp.get("project") or resp if isinstance(resp, dict) else {}
    pid = p.get("id") if isinstance(p, dict) else None
if not pid:
    sys.exit("could not create project")

print("PROJECT_ID", pid)

# 2. start the run
run_body = {
    "agentId": "deepseek-harness",
    "projectId": pid,
    "message": brief,
    "model": "openrouter/~google/gemini-pro-latest",
    "byokProvider": {"protocol": "openai", "apiKey": key, "baseUrl": base_url},
}
code, resp = post("/api/runs", run_body)
print("start run:", code, str(resp)[:400])
if isinstance(resp, dict):
    rid = (resp.get("run") or resp).get("id")
    print("RUN_ID", rid)

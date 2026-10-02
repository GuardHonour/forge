import json, os, sys, time, glob

RUN_ID = sys.argv[1] if len(sys.argv) > 1 else "8be1534e-edaa-488a-9c2b-b9a204cf64a0"
BUDGET_MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 45
DATA = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data"
run_dir = f"{DATA}/runs/{RUN_ID}"
proj_dir = f"{DATA}/projects/forge-ui-upgrade"

DEADLINE = time.time() + BUDGET_MIN * 60
start = time.time()

def files(d):
    try:
        return sorted(f"{os.path.basename(p)} ({os.path.getsize(p)}b)" for p in glob.glob(d + "/*") if os.path.isfile(p))
    except FileNotFoundError:
        return []

def last_event():
    ev = f"{run_dir}/events.jsonl"
    if not os.path.exists(ev):
        return "(no events yet)"
    try:
        with open(ev, "rb") as f:
            f.seek(max(0, os.path.getsize(ev) - 4000))
            lines = [l for l in f.read().decode("utf-8", "replace").splitlines() if l.strip()]
        if not lines:
            return "(empty)"
        j = json.loads(lines[-1])
        d = j.get("data") or {}
        detail = d.get("message") or d.get("type") or d.get("status") or ""
        return f"{j.get('event')} {str(detail)[:80]}"
    except Exception as e:
        return f"(tail unreadable: {e.__class__.__name__})"

while time.time() < DEADLINE:
    el = int((time.time() - start) / 60)
    status, err = "?", ""
    sp = f"{run_dir}/state.json"
    if os.path.exists(sp):
        try:
            j = json.load(open(sp, encoding="utf-8"))
            status = j.get("status", "?")
            if j.get("error"):
                err = f" err={str(j.get('error'))[:80]}"
        except Exception:
            status = "unreadable"
    arts = files(proj_dir)
    html = [a for a in arts if a.lower().endswith(".html")]
    print(f"[{el}m] run={status}{err} ev={last_event()} | files: {', '.join(arts) if arts else '(none)'}", flush=True)
    if html:
        print("DELIVERABLE PRESENT", flush=True)
        sys.exit(0)
    if status in ("failed", "error", "cancelled", "timeout"):
        print("RUN TERMINAL-FAILED", flush=True)
        sys.exit(1)
    if status == "succeeded" and not html:
        print("RUN SUCCEEDED BUT NO ARTIFACT", flush=True)
        sys.exit(1)
    time.sleep(60)

print("TIMEOUT after ~45m — still no deliverable", flush=True)
sys.exit(2)

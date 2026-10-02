import json, re, sys, glob, os

root = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data/runs"
SECRET = re.compile(r"sk-or-v1-[\w-]+")

def mask(s):
    return SECRET.sub("sk-or-v1-REDACTED", s)

def walk(o, path=""):
    """print scalar leaves for interesting keys"""
    interesting = ("agent", "model", "status", "state", "project", "created", "provider",
                   "baseurl", "apikey", "title", "kind", "type", "prompt", "message",
                   "conversation", "cost", "error", "stage", "artifact", "outcome")
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, (dict, list)):
                walk(v, p)
            elif any(t in k.lower() for t in interesting) and not isinstance(v, (int, float)) or isinstance(v, (int, float)):
                s = str(v)
                if len(s) > 220:
                    s = s[:220] + "..."
                print(f"   {p} = {mask(s)}")
    elif isinstance(o, list):
        for i, v in enumerate(o[:4]):
            walk(v, f"{path}[{i}]")

d = sorted(glob.glob(root + "/*/state.json"), key=os.path.getmtime)[-1]
print("== " + d)
j = json.load(open(d, encoding="utf-8"))
print("TOP KEYS:", ", ".join(j.keys()))
walk(j)

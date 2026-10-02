import json, re

p = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data/.od/media-config.json"
d = json.load(open(p, encoding="utf-8"))

def shape(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            shape(v, f"{path}.{k}")
    elif isinstance(o, list):
        print(f"{path} = list[{len(o)}]")
        for i, v in enumerate(o[:2]):
            shape(v, f"{path}[{i}]")
    else:
        s = str(o)
        if re.search(r"sk-or-v1|key|token|secret", path + " " + s, re.I) and len(s) > 20:
            print(f"{path} = <redacted str len={len(s)} starts='{s[:8]}'>")
        elif len(s) > 120:
            print(f"{path} = {s[:120]}...")
        else:
            print(f"{path} = {s}")

shape(d)

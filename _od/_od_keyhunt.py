import sqlite3, json, os, re, glob

NEEDLE = "sk-or-v1"
root = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data"

print("== sqlite scan ==")
c = sqlite3.connect(f"file:{root}/app.sqlite?mode=ro", uri=True)
hits = []
for (t,) in c.execute("select name from sqlite_master where type='table'"):
    cols = [d[1] for d in c.execute(f"pragma table_info({t})")]
    for col in cols:
        try:
            q = c.execute(f"select count(*) from {t} where {col} like '%sk-or-v1%'")
            n = q.fetchone()[0]
            if n:
                hits.append((t, col, n))
        except sqlite3.Error:
            pass
print("hits:", hits or "none")

print("== json/flat files in data dir ==")
for p in glob.glob(root + "/**/*.json", recursive=True) + glob.glob(root + "/.od/**/*", recursive=True):
    if os.path.isfile(p) and os.path.getsize(p) < 2_000_000:
        try:
            s = open(p, encoding="utf-8", errors="ignore").read()
            if NEEDLE in s:
                print("HIT:", p, "count", s.count(NEEDLE))
        except Exception:
            pass

print("== env var names (values never printed) ==")
for k, v in os.environ.items():
    if re.search(r"key|token|secret", k, re.I):
        print(("CONTAINS sk-or-v1: " + k[:6] + "...") if NEEDLE in v else k)

print("== deepseek-harness shallow configs ==")
pats = [r"C:/Users/Admin/deepseek-harness/*.env", r"C:/Users/Admin/deepseek-harness/.env*",
        r"C:/Users/Admin/deepseek-harness/config*/*.json", r"C:/Users/Admin/deepseek-harness/*.json"]
seen = set()
for pat in pats:
    for p in glob.glob(pat):
        if p in seen or os.path.isdir(p):
            continue
        seen.add(p)
        try:
            s = open(p, encoding="utf-8", errors="ignore").read()
            if NEEDLE in s:
                print("HIT:", p, "count", s.count(NEEDLE))
        except Exception:
            pass
print("done")

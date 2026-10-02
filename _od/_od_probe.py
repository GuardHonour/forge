import sqlite3, re, sys

DB = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data/app.sqlite"
c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
c.row_factory = sqlite3.Row

tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' order by name")]
print("TABLES:", ", ".join(tables))

SECRET = re.compile(r"(sk-|api[_-]?key|token|secret|password|byok)", re.I)

def mask(v):
    if isinstance(v, str) and SECRET.search(v):
        return f"<redacted len={len(v)}>"
    if isinstance(v, str) and len(v) > 160:
        return v[:160] + "..."
    return v

for t in tables:
    if t.startswith("sqlite_"):
        continue
    cols = [d[1] for d in c.execute(f"pragma table_info({t})")]
    n = c.execute(f"select count(*) from {t}").fetchone()[0]
    print(f"== {t} ({n} rows) cols: {', '.join(cols)}")
    if t in ("projects", "agents") and n:
        for r in c.execute(f"select * from {t} limit 12"):
            print("   ", {k: mask(r[k]) for k in r.keys()})

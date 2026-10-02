import re, sys

f = r"C:/Users/Admin/AppData/Roaming/Open Design/namespaces/release-stable-win/data/projects/forge-ui-upgrade/forge-ui-upgrade.html"
s = open(f, encoding="utf-8").read()
print("len", len(s))
for m in re.findall(r"<(section|header|main|article)[^>]{0,120}>", s)[:14]:
    print(m)
print("--- dir classes ---")
for m in sorted(set(re.findall(r"dir-[abc][\w-]*", s))):
    print(m, s.count(m))

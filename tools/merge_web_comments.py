"""Комменты, собранные в браузере (comments_web.js → tools/comments_web.json), подмешиваются к кэшу comments.json.

С 18.11 приложение Meta удалено и Graph API не отвечает, поэтому fetch_comments.py падает и жителей не добавляет.
Этот скрипт добавляет в comments.json комменты, которых там нет (по id), и новых комментаторов
в residents.json (номера существующих жителей не трогает). Запускается в workflow после fetch_comments.py.
"""
import json
import os
from pathlib import Path

HERE = Path(__file__).parent
OWN = "ostrov.podpischikov"


def load(name, default):
    f = HERE / name
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default
    except ValueError:
        return None


def write_atomic(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def main():
    web = load("comments_web.json", {"comments": []})
    if not web or not web.get("comments"):
        print("Комментов из браузера нет — пропускаю")
        return
    comments = load("comments.json", [])
    if comments is None:
        print("comments.json повреждён — пропускаю")
        return
    have = {c.get("id") for c in comments}
    add = [c for c in web["comments"] if c.get("id") not in have]
    comments.extend(add)
    write_atomic(HERE / "comments.json", json.dumps(comments, ensure_ascii=False, indent=1))

    rows = load("residents.json", [])
    if rows is None:
        print("residents.json повреждён — жителей не трогаю")
        return
    residents = {r["nick"]: r for r in rows}
    next_no = max([r["no"] for r in rows] + [1]) + 1
    new = 0
    for c in sorted(add, key=lambda c: c["time"]):
        nick = c.get("username")
        if not nick or nick == OWN or nick in residents:
            continue
        residents[nick] = {"no": next_no, "nick": nick, "since": c["time"], "reel": c["reel"], "cid": c.get("id")}
        next_no += 1
        new += 1
    if new:
        write_atomic(HERE / "residents.json", json.dumps(sorted(residents.values(), key=lambda r: r["no"]), ensure_ascii=False, indent=1))
    print(f"Комменты из браузера ({web.get('at', '?')}): новых {len(add)}, новых жителей {new}, всего комментов {len(comments)}")


if __name__ == "__main__":
    main()

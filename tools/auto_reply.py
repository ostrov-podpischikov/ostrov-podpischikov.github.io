"""
🏝 Остров подписчиков — автоответы на комментарии.

Отвечает на первый коммент каждого жителя: «@ник, твой дом №… уже на острове». Чтобы Instagram
не принял это за спам: только первый коммент человека, несколько вариантов текста, не больше
MAX_PER_RUN ответов за запуск, старые комменты (до START) не трогает.

Работает после fetch_comments.py (берёт comments.json и residents.json рядом).
Помнит, кому уже ответил, в replied.json. Включается переменной AUTO_REPLY=on
(в GitHub: Settings → Secrets and variables → Actions → Variables).

  python auto_reply.py            # ответить (если AUTO_REPLY=on)
  python auto_reply.py --dry-run  # показать, что бы ответил, ничего не отправляя
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
MAX_PER_RUN = 15
START = os.environ.get("AUTO_REPLY_SINCE") or "2026-11-03T06:20:00"  # UTC; only comments after this get a reply
OWN = "ostrov.podpischikov"
TEMPLATES = [
    "@{nick}, твой дом №{no} уже стоит на острове 🏝 Найди его по ссылке в шапке",
    "@{nick}, добро пожаловать на остров! Ты житель №{no} 🛖 Ищи свой дом на сайте — ссылка в шапке",
    "@{nick}, шалаш №{no} готов ⛺ Посмотри, как он выглядит: ссылка в шапке",
    "@{nick}, ты с нами! Житель №{no} 🌴 Свой дом и паспорт для сторис — по ссылке в шапке",
    "@{nick}, заселили 🏝 Дом №{no} уже на карте острова — ссылка в шапке",
    "@{nick}, привет, сосед! Твой номер №{no} 🔥 Найди себя на сайте острова",
]


def token():
    if os.environ.get("IG_TOKEN"):
        return os.environ["IG_TOKEN"]
    return json.loads((HERE / "config.json").read_text(encoding="utf-8-sig"))["IG_TOKEN"]


def reply(comment_id, text, tok):
    host = "https://graph.instagram.com" if tok.startswith("IG") else "https://graph.facebook.com/v23.0"
    data = urllib.parse.urlencode({"message": text, "access_token": tok}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{host}/{comment_id}/replies", data=data), timeout=30) as r:
            return json.loads(r.read()).get("id")
    except urllib.error.HTTPError as e:
        print(f"  ✗ {comment_id}: {e.code} {e.read().decode('utf-8', 'replace')[:200]}")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if os.environ.get("AUTO_REPLY", "").lower() != "on" and not args.dry_run:
        print("Автоответы выключены (AUTO_REPLY != on)")
        return

    comments = json.loads((HERE / "comments.json").read_text(encoding="utf-8"))
    residents = {r["nick"]: r["no"] for r in json.loads((HERE / "residents.json").read_text(encoding="utf-8"))}
    state_file = HERE / "replied.json"
    raw = state_file.read_text(encoding="utf-8").strip() if state_file.exists() else ""
    replied = set(json.loads(raw)) if raw else set()

    # first comment of each person, after START, not answered yet
    first = {}
    for c in sorted(comments, key=lambda c: c["time"]):
        nick = c.get("username", "")
        if c.get("reply"):
            continue  # answer top-level comments only; a reply inside a thread can't get a nested reply
        if nick and nick != OWN and nick not in first:
            first[nick] = c
    pending = [c for nick, c in first.items()
               if c.get("id") and c["time"][:19] >= START and nick not in replied and nick in residents]
    todo = pending[:MAX_PER_RUN]

    sent = 0
    for k, c in enumerate(todo):
        nick, no = c["username"], residents[c["username"]]
        # rotate through the templates so neighbouring replies never repeat
        text = TEMPLATES[(len(replied) + k) % len(TEMPLATES)].format(nick=nick, no=no)
        if args.dry_run:
            print("  →", text)
            continue
        if reply(c["id"], text, token()):
            replied.add(nick)
            sent += 1
    if not args.dry_run:
        tmp = state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(sorted(replied), ensure_ascii=False, indent=0), encoding="utf-8")
        tmp.replace(state_file)
    print(f"Автоответы: {'показано' if args.dry_run else 'отправлено'} {len(todo) if args.dry_run else sent} (ждут очереди: {len(pending) - len(todo)})")


if __name__ == "__main__":
    main()

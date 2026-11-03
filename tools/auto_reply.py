"""
🏝 Остров подписчиков — автоответы на комментарии.

Отвечает на каждый коммент под рилсами, по смыслу:
  первый коммент человека → «участок №… готов, подпишись, если ещё нет»;
  голос в опросе          → «голос за … засчитан»;
  пожелание (флаг, лодка) → «добавим к дому №…»;
  повторный коммент       → короткое «привет, сосед».
Подписан ли человек, API Instagram не сообщает, поэтому в приветствии просьба подписаться
звучит как «если ещё не подписан».

Чтобы Instagram не принял это за спам:
  • много вариантов текста, без ссылок, всегда с ником;
  • одному человеку — не чаще раза в PER_NICK_HOURS часов (на его последний коммент);
  • не больше MAX_PER_RUN за запуск, MAX_PER_HOUR в час и MAX_PER_DAY в сутки, паузы между ответами;
  • если Instagram ответил ограничением — пауза PAUSE_HOURS часов;
  • комменты старше MAX_AGE_DAYS и ветки, где аккаунт уже ответил (в том числе вручную), не трогает.

Работает после fetch_comments.py (берёт comments.json, residents.json, polls.json рядом).
Состояние — в replied.json. Включается переменной AUTO_REPLY=on.

  python auto_reply.py            # ответить (если AUTO_REPLY=on)
  python auto_reply.py --dry-run  # показать, что бы ответил, ничего не отправляя
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from build_map import WISHES  # noqa: E402  the same wish words the island uses

OWN = "ostrov.podpischikov"
MAX_PER_RUN = 8
MAX_PER_HOUR = 30
MAX_PER_DAY = 250
PER_NICK_HOURS = 12
MAX_AGE_DAYS = 7
PAUSE_HOURS = 6
GAP_SECONDS = (15, 45)  # random pause between two replies

WELCOME = [
    "@{nick}, участок №{no} уже твой 🏝 Если ещё не подписан — подпишись, и шалаш останется за тобой",
    "@{nick}, привет! Дом №{no} готов 🛖 Ещё не подписан? Жми подписку — место на острове держим для тебя",
    "@{nick}, житель №{no}, добро пожаловать 🌴 Подписка — и дом твой. Найди его по ссылке в шапке",
    "@{nick}, место №{no} размечено и ждёт тебя 🚧 Подпишись, если ещё нет, — и заселяйся",
    "@{nick}, заселяем! Дом №{no} 🏡 Проверь, что подписан, а сам дом ищи на сайте — ссылка в шапке",
    "@{nick}, твой шалаш №{no} уже на острове ⛺ Не подписан ещё? Подпишись — участок закреплён за тобой",
    "@{nick}, ты житель №{no} 🔥 Если подписки ещё нет — подпишись, место пока держим",
    "@{nick}, дом №{no} построен 🏝 Паспорт жителя — по ссылке в шапке. И не забудь про подписку 😉",
]
WELCOME_VOTE = [
    "@{nick}, голос за «{opt}» засчитан 🗳 А ещё тебе уже готов дом №{no} — подпишись, если ещё нет",
    "@{nick}, +1 за «{opt}»! И участок №{no} теперь твой 🏝 Ещё не подписан? Подпишись, место держим",
    "@{nick}, записали: «{opt}» ✍️ Твой дом №{no} уже стоит — проверь подписку и найди его по ссылке в шапке",
    "@{nick}, «{opt}» — принято 🗳 Добро пожаловать, житель №{no}! Подпишись, если ещё не с нами",
]
WELCOME_WISH = [
    "@{nick}, дом №{no} уже строим, и {wish} добавим 🛠 Ещё не подписан? Подпишись — участок держим за тобой",
    "@{nick}, участок №{no} твой, {wish} будет 🏝 Если ещё не подписан — подпишись, чтобы дом остался за тобой",
    "@{nick}, заказ принят: {wish} к дому №{no} ✍️ Подпишись, если ещё нет, — и через 15 минут ищи себя на сайте",
]
VOTE = [
    "@{nick}, голос за «{opt}» засчитан 🗳 Итоги — в следующем рилсе",
    "@{nick}, записали: «{opt}» ✍️ Посмотрим, кто победит",
    "@{nick}, +1 за «{opt}» 🏝 Счёт голосования — на сайте по ссылке в шапке",
    "@{nick}, принято! «{opt}» 🗳 Зови друзей голосовать",
]
WISH = [
    "@{nick}, к дому №{no} добавим {wish} 🛠 Через 15 минут — на сайте",
    "@{nick}, записали: {wish} для дома №{no} ✍️",
    "@{nick}, легко! Добавим {wish} к дому №{no} 🏝",
]
AGAIN = [
    "@{nick}, рады снова видеть, сосед №{no} 🌴",
    "@{nick}, житель №{no} на связи 🔥",
    "@{nick}, спасибо! Твой дом №{no} на месте 🏝",
    "@{nick}, 🙌 дом №{no} передаёт привет",
    "@{nick}, зови друзей — пусть селятся рядом с домом №{no} 🏡",
    "@{nick}, ❤️ остров растёт благодаря тебе, житель №{no}",
]
WISH_WORDS = {"flag": "флаг 🚩", "fire": "костёр 🔥", "boat": "лодку 🛶", "pet": "питомца 🐶", "palm": "пальму 🌴",
              "lamp": "фонарь 🏮", "ball": "мяч ⚽"}
BLOCK_CODES = {4, 17, 32, 368, 613}  # rate limit / temporarily blocked


def token():
    if os.environ.get("IG_TOKEN"):
        return os.environ["IG_TOKEN"]
    return json.loads((HERE / "config.json").read_text(encoding="utf-8-sig"))["IG_TOKEN"]


def reply(comment_id, text, tok):
    """Returns (reply id or None, blocked?)."""
    host = "https://graph.instagram.com" if tok.startswith("IG") else "https://graph.facebook.com/v23.0"
    data = urllib.parse.urlencode({"message": text, "access_token": tok}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{host}/{comment_id}/replies", data=data), timeout=30) as r:
            return json.loads(r.read()).get("id"), False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(f"  ✗ {comment_id}: {e.code} {body[:200]}")
        try:
            err = json.loads(body).get("error", {})
        except ValueError:
            err = {}
        msg = (err.get("message", "") + " " + err.get("error_user_msg", "")).lower()
        return None, err.get("code") in BLOCK_CODES or "spam" in msg or "block" in msg or "limit" in msg


def load_state(path):
    raw = path.read_text(encoding="utf-8").strip() if path.exists() else ""
    data = json.loads(raw) if raw else {}
    if isinstance(data, list):  # the old format: just the nicks that got a welcome
        data = {"nicks": {n: "2026-11-03T06:20:00" for n in data}}
    data.setdefault("nicks", {})  # nick → time of our last reply to them
    data.setdefault("done", [])   # comment ids handled (answered or covered by a later reply)
    data.setdefault("sent", [])   # times of our replies, last 24 h
    data.setdefault("pause_until", "")
    return data


def find_vote(text, polls, when):
    text = text.lower().replace("ё", "е")
    words = re.findall(r"[a-zа-я]+", text)
    numbers = set(re.findall(r"(?<!\d)\d(?!\d)", text))
    for p in polls:
        if when[:10] < p.get("since", ""):
            continue
        for o in p["options"]:
            if o["key"] in numbers or any(w.startswith(k.replace("ё", "е")) for k in o.get("words", []) for w in words):
                return o["label"]
    return None


def find_wish(text):
    text = text.lower().replace("ё", "е")
    tags = [tag for tag, words in WISHES if any(w in text for w in words)]
    for t in tags:
        if t in WISH_WORDS:
            return WISH_WORDS[t]
    return "цвет крыши 🎨" if tags else None


def pick(templates, cid, offset):
    # the same comment always gets the same text; neighbours differ
    return templates[(zlib.crc32(cid.encode()) + offset) % len(templates)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if os.environ.get("AUTO_REPLY", "").lower() != "on" and not args.dry_run:
        print("Автоответы выключены (AUTO_REPLY != on)")
        return

    now = datetime.now(timezone.utc)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S")
    state_file = HERE / "replied.json"
    st = load_state(state_file)
    if st["pause_until"] > iso(now) and not args.dry_run:
        print(f"Автоответы на паузе до {st['pause_until']} UTC (Instagram ограничил)")
        return

    comments = json.loads((HERE / "comments.json").read_text(encoding="utf-8"))
    residents = {r["nick"]: r for r in json.loads((HERE / "residents.json").read_text(encoding="utf-8"))}
    polls_file = HERE / "polls.json"
    polls = json.loads(polls_file.read_text(encoding="utf-8")) if polls_file.exists() else []

    # threads where the account already answered (by this script or by hand)
    answered = {c["parent"] for c in comments if c.get("reply") and c.get("username") == OWN and c.get("parent")}
    done = set(st["done"])
    oldest = iso(now - timedelta(days=MAX_AGE_DAYS))

    # per person: their unanswered top-level comments, oldest first
    todo_by_nick = {}
    for c in sorted(comments, key=lambda c: c["time"]):
        nick = c.get("username", "")
        if c.get("reply") or not nick or nick == OWN or not c.get("id") or nick not in residents:
            continue  # a reply inside a thread can't get a nested reply
        if c["id"] in done or c["id"] in answered or c["time"][:19] < oldest or "http" in c.get("text", "").lower():
            continue
        todo_by_nick.setdefault(nick, []).append(c)

    cooldown = iso(now - timedelta(hours=PER_NICK_HOURS))
    queue = []
    for nick, cs in todo_by_nick.items():
        if st["nicks"].get(nick, "") > cooldown:
            continue  # answered this person recently; their new comments wait
        target = cs[-1]  # answer the latest one, the earlier ones count as covered
        queue.append((target, [c["id"] for c in cs[:-1]]))
    queue.sort(key=lambda q: q[0]["time"], reverse=True)  # fresh comments first

    st["sent"] = [t for t in st["sent"] if t > iso(now - timedelta(days=1))]
    hour_ago = iso(now - timedelta(hours=1))
    budget = min(MAX_PER_RUN, MAX_PER_HOUR - sum(t > hour_ago for t in st["sent"]), MAX_PER_DAY - len(st["sent"]))
    todo = queue[:max(0, budget)]

    sent = 0
    for k, (c, covered) in enumerate(todo):
        nick = c["username"]
        r = residents[nick]
        first = r.get("cid") == c["id"] or nick not in st["nicks"]
        vote, wish = find_vote(c.get("text", ""), polls, c["time"]), find_wish(c.get("text", ""))
        if first:
            tpl = pick(WELCOME_VOTE, c["id"], k) if vote else pick(WELCOME_WISH, c["id"], k) if wish else pick(WELCOME, c["id"], k)
        else:
            tpl = pick(VOTE, c["id"], k) if vote else pick(WISH, c["id"], k) if wish else pick(AGAIN, c["id"], k)
        text = tpl.format(nick=nick, no=r["no"], opt=vote, wish=wish)
        if args.dry_run:
            print(f"  «{c.get('text', '')[:40]}» → {text}")
            continue
        if k:
            time.sleep(random.uniform(*GAP_SECONDS))
        rid, blocked = reply(c["id"], text, token())
        if rid:
            sent += 1
            stamp = iso(datetime.now(timezone.utc))
            st["nicks"][nick] = stamp
            st["sent"].append(stamp)
            st["done"] += [c["id"]] + covered
        elif blocked:
            st["pause_until"] = iso(now + timedelta(hours=PAUSE_HOURS))
            print(f"⏸ Instagram ограничил ответы — пауза до {st['pause_until']} UTC")
            break

    if not args.dry_run:
        st["done"] = st["done"][-5000:]
        tmp = state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, ensure_ascii=False, indent=0), encoding="utf-8")
        tmp.replace(state_file)
    print(f"Автоответы: {'показано' if args.dry_run else 'отправлено'} {len(todo) if args.dry_run else sent} "
          f"(в очереди всего {len(queue)}, лимит этого запуска {max(0, budget)})")


if __name__ == "__main__":
    main()

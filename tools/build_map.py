"""
🏝 Остров подписчиков — данные для онлайн-карты.

Склеивает жителей из комментов Instagram (residents.json) с уровнями домов из бота
(../ostrov-bot/ostrov.db, если есть) и пишет ../ostrov-map/data/residents.json.

  python build_map.py            # обычная сборка
  python build_map.py --demo 300 # добавить 300 тестовых жителей (только для проверки карты)

Папку с данными сайта можно задать переменной OSTROV_SITE_DATA (так работает GitHub Actions).
Если жители не изменились, файл не перезаписывается (нет лишних коммитов и пересборок сайта).
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get("OSTROV_SITE_DATA") or HERE.parent / "ostrov-map" / "data") / "residents.json"
BOT_DB = HERE.parent / "ostrov-bot" / "ostrov.db"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# words in comments → details on the house (only these tags go to the site, never the text)
WISHES = [
    ("flag", ["флаг", "flag"]), ("fire", ["костер", "костр", "огонь", "огня"]), ("boat", ["лодк", "корабл", "яхт"]),
    ("pet", ["собак", "пес", "щен", "кот", "кош", "питом"]), ("palm", ["пальм"]), ("lamp", ["маяк", "фонар"]),
    ("ball", ["футбол", "мяч", "роналду", "месси", "ronaldo", "messi"]), ("horse", ["лошад", "лошак", "конь", "коня", "коник", "жеребен"]),
    ("red", ["красн"]), ("blue", ["синий", "синем", "синего", "голуб"]), ("green", ["зелен"]), ("yellow", ["желт"]),
    ("pink", ["розов"]), ("black", ["черн"]), ("purple", ["фиолет"]), ("white", ["белый", "белом", "белого"]),
    ("orange", ["оранж"]),
]


# a business instead of a hut: word starts in a comment → building type on the island (the latest request wins)
BUSINESSES = [
    ("shawarma", ["шаурм", "шаверм", "донер"]), ("pizza", ["пицц"]), ("sushi", ["суши", "ролл"]),
    ("burger", ["бургер", "фастфуд", "макдон", "kfc"]), ("icecream", ["морожен"]), ("cafe", ["кафе", "кофейн", "кофе", "ресторан", "столов"]),
    ("barber", ["барбер", "парикмахер", "салон красот"]), ("bar", ["бар", "коктейл"]), ("shop", ["магазин", "маркет", "лавк", "ларек", "супермаркет"]), ("fish", ["рыбн", "рыбак", "рыбалк"]),
    ("hotel", ["отел", "гостиниц", "хостел"]), ("cinema", ["кинотеатр", "кино"]), ("surf", ["серф", "сёрф"]), ("bank", ["банк"]),
    ("farm", ["ферм", "огород"]), ("pharmacy", ["аптек"]),
    ("gym", ["качалк", "спортзал", "фитнес"]), ("garage", ["автосервис", "автомойк", "заправк", "гараж"]),
]
BAD = ["хуй", "хуе", "пизд", "бля", "еба", "ебл", "ебу", "сука", "суки", "нахуй", "жоп", "член", "секс", "порн", "гей", "пидор", "шлюх", "fuck", "porn", "sex"]


def find_business(text):
    words = re.findall(r"[a-zа-я]+", text.lower().replace("ё", "е"))
    for kind, starts in BUSINESSES:
        if any(w.startswith(s.replace("ё", "е")) for s in starts for w in words):
            return kind
    return None


def find_brand(text):
    """A name in quotes («У Ахмеда», "Sunrise") goes on the sign — short, letters only, nothing rude."""
    m = re.search(r"[«\"“']([^»\"”']{2,40})[»\"”']", text)
    if not m:
        return None
    name = re.sub(r"[^\w\s\-&!.]", "", m.group(1)).strip()[:18]
    low = name.lower().replace("ё", "е")
    if len(name) < 2 or any(b in low for b in BAD) or "http" in low or "@" in m.group(1):
        return None
    return name


def wishes_by_nick():
    """nick → {"wish": [tags], "biz": kind, "brand": name}"""
    f = HERE / "comments.json"
    if not f.exists():
        return {}
    out = {}
    for c in sorted(json.loads(f.read_text(encoding="utf-8")), key=lambda c: c["time"]):
        raw = c.get("text", "")
        text = raw.lower().replace("ё", "е")
        tags = [tag for tag, words in WISHES if any(w in text for w in words)]
        biz = find_business(raw)
        if not tags and not biz:
            continue
        cur = out.setdefault(c["username"], {"wish": []})
        cur["wish"] += [t for t in tags if t not in cur["wish"]]
        if biz:
            cur["biz"], cur["brand"] = biz, find_brand(raw)
    return out


def quest_levels(nicks):
    """nick → extra levels earned in comments: friends who tagged them (@nick, up to 2) and reels beyond the first (up to 2)."""
    f = HERE / "comments.json"
    if not f.exists():
        return {}
    friends, reels = {}, {}
    for c in json.loads(f.read_text(encoding="utf-8")):
        who = c.get("username")
        if not who:
            continue
        reels.setdefault(who, set()).add(c.get("reel"))
        for tagged in re.findall(r"@([a-z0-9._]+)", c.get("text", "").lower()):
            tagged = tagged.rstrip(".")
            if tagged in nicks and tagged != who:
                friends.setdefault(tagged, set()).add(who)
    out = {}
    for nick in nicks:
        bonus = min(2, len(friends.get(nick, ()))) + min(2, max(0, len(reels.get(nick, ())) - 1))
        if bonus:
            out[nick] = bonus
    return out


def write_atomic(path, text):
    """Write through a temp file so a full disk never leaves a truncated file behind."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def tally_polls():
    """Votes from comments: an option number as a standalone number, or a word from the option.
    One vote per person — their latest comment that votes for something."""
    cfg_file, com_file = HERE / "polls.json", HERE / "comments.json"
    if not cfg_file.exists():
        return []
    polls = json.loads(cfg_file.read_text(encoding="utf-8"))
    comments = json.loads(com_file.read_text(encoding="utf-8")) if com_file.exists() else []
    comments.sort(key=lambda c: c["time"])
    out = []
    for p in polls:
        votes = {}
        for c in comments:
            if c["time"][:10] < p.get("since", ""):
                continue
            text = c.get("text", "").lower().replace("ё", "е")
            words = re.findall(r"[a-zа-я]+", text)
            numbers = set(re.findall(r"(?<!\d)\d(?!\d)", text))
            hit = next((o["key"] for o in p["options"] if o["key"] in numbers), None)
            hit = hit or next((o["key"] for o in p["options"]
                               if any(w.startswith(k.replace("ё", "е")) for k in o.get("words", []) for w in words)), None)
            if hit and c.get("username"):
                votes[c["username"]] = hit
        counts = {o["key"]: 0 for o in p["options"]}
        for k in votes.values():
            counts[k] += 1
        out.append({"id": p["id"], "question": p["question"], "how": p.get("how", ""), "total": len(votes),
                    "options": [{"key": o["key"], "label": o["label"], "emoji": o.get("emoji", ""), "votes": counts[o["key"]]}
                                for o in p["options"]]})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", type=int, default=0)
    args = ap.parse_args()

    src = HERE / "residents.json"
    rows = json.loads(src.read_text(encoding="utf-8")) if src.exists() else []
    residents = {r["nick"]: {"no": r["no"], "nick": r["nick"], "level": 1, "since": r.get("since", "")[:10]} for r in rows}

    # the bot knows levels, and people who linked a nick in Telegram without commenting yet
    if BOT_DB.exists():
        db = sqlite3.connect(BOT_DB)
        for nick, no, level, linked in db.execute("SELECT ig_nick, resident_no, level, linked_at FROM users WHERE ig_nick IS NOT NULL"):
            if nick in residents:
                residents[nick]["level"] = level
            else:
                residents[nick] = {"no": no, "nick": nick, "level": level, "since": (linked or "")[:10]}
        db.close()

    for nick, w in wishes_by_nick().items():
        if nick not in residents:
            continue
        if w["wish"]:
            residents[nick]["wish"] = w["wish"]
        if w.get("biz"):
            residents[nick]["biz"] = w["biz"]
            if w.get("brand"):
                residents[nick]["brand"] = w["brand"]

    # given by hand (a request from Telegram or DM, a story that tagged us):
    # gifts.json {"nick": ["horse", ...]} or {"nick": {"items": ["horse"], "levels": 1}}
    gifts_file = HERE / "gifts.json"
    gifts = json.loads(gifts_file.read_text(encoding="utf-8")) if gifts_file.exists() else {}
    for nick, g in gifts.items():
        if nick not in residents:
            continue
        g = {"items": g} if isinstance(g, list) else g
        wish = residents[nick].setdefault("wish", [])
        wish += [t for t in g.get("items", []) if t not in wish]
        if not wish:
            del residents[nick]["wish"]
        residents[nick]["level"] = residents[nick]["level"] + int(g.get("levels", 0))

    # quests from comments: a friend who tags you (+1 each, up to 2) and every extra reel you comment on (+1 each, up to 2)
    for nick, bonus in quest_levels(set(residents)).items():
        residents[nick]["level"] += bonus
    for r in residents.values():
        r["level"] = max(1, min(7, r["level"]))

    out = sorted(residents.values(), key=lambda r: r["no"])
    if args.demo:
        start = (out[-1]["no"] if out else 1) + 1
        for i in range(args.demo):
            lvl = 1 + (i * 7919 % 100 > 70) + (i * 104729 % 100 > 85) + (i % 37 == 0) * 3
            out.append({"no": start + i, "nick": f"demo_{i:04d}", "level": min(7, lvl), "since": "2026-11-03"})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    stats_file = HERE / "stats.json"
    followers = json.loads(stats_file.read_text(encoding="utf-8")).get("followers") if stats_file.exists() else None
    try:
        prev = json.loads(OUT.read_text(encoding="utf-8"))
        same = prev.get("residents") == out and prev.get("followers") == followers
    except (OSError, ValueError, AttributeError):
        same = False
    if same:
        print(f"= Карта: {len(out)} жителей, без изменений")
    else:
        write_atomic(OUT, json.dumps({"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "followers": followers,
                                      "residents": out}, ensure_ascii=False, separators=(",", ":")))
        print(f"✅ Карта: {len(out)} жителей (+ остров №1) → {OUT}")

    polls = tally_polls()
    write_atomic(OUT.parent / "polls.json", json.dumps(polls, ensure_ascii=False, separators=(",", ":")))
    for p in polls:
        print(f"🗳 {p['question']} — голосов: {p['total']} · " + ", ".join(f"{o['label']} {o['votes']}" for o in p["options"]))


if __name__ == "__main__":
    main()

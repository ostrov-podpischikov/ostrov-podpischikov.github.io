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
import hashlib
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
    ("car", ["машин", "машын", "тачк", "бмв", "bmw", "мерс", "джип", "додж", "караван", "автодом"]),
    ("pool", ["бассейн", "басейн", "бассеин", "басеин"]), ("moto", ["мотоцикл", "моточикл", "моточикол", "мотик", "байк"]),
    ("parrot", ["попуга"]),
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


OWN = {"ostrov.podpischikov"}
FRIENDS_MAX, REELS_MAX = 3, 2


def quest_levels(nicks):
    """nick → (extra levels, friends) earned in comments.
    Friends: everyone the resident tagged with @nick, plus residents who tagged them — +1 each, up to 3.
    Reels: every reel beyond the first one they commented on — +1 each, up to 2."""
    f = HERE / "comments.json"
    if not f.exists():
        return {}
    friends, reels = {}, {}
    for c in json.loads(f.read_text(encoding="utf-8")):
        who = c.get("username")
        # only residents count — the island's own auto-replies («@nick, твой дом готов») must not look like a friend
        if not who or who not in nicks:
            continue
        reels.setdefault(who, set()).add(c.get("reel"))
        for tagged in re.findall(r"@([a-z0-9._]+)", c.get("text", "").lower()):
            tagged = tagged.rstrip(".")
            if not tagged or tagged == who.lower() or tagged in OWN:
                continue
            friends.setdefault(who, set()).add(tagged)  # tagging a friend brings them to the reel
            if tagged in nicks:
                friends.setdefault(tagged, set()).add(who)
    out = {}
    for nick in nicks:
        fr = len(friends.get(nick, ()))
        bonus = min(FRIENDS_MAX, fr) + min(REELS_MAX, max(0, len(reels.get(nick, ())) - 1))
        if bonus:
            out[nick] = (bonus, fr)
    return out


def write_atomic(path, text):
    """Write through a temp file so a full disk never leaves a truncated file behind."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


LOCAL_LETTERS = str.maketrans({"қ": "к", "ғ": "г", "ү": "у", "ұ": "у", "ө": "о", "ң": "н", "ә": "а", "і": "и", "һ": "х", "ў": "у", "ҳ": "х", "ʻ": "", "'": "", "’": ""})


def tally_polls():
    """Votes from comments: an option number as a standalone number, or a word from the option.
    One vote per person — their latest comment that votes for something; a poll with "each": true counts every comment."""
    cfg_file, com_file = HERE / "polls.json", HERE / "comments.json"
    if not cfg_file.exists():
        return []
    polls = json.loads(cfg_file.read_text(encoding="utf-8"))
    comments = json.loads(com_file.read_text(encoding="utf-8")) if com_file.exists() else []
    comments.sort(key=lambda c: c["time"])
    # "follower_points": N — a comment from a follower (in followers.json) counts N, anyone else 1
    fol_file = HERE / "followers.json"
    fol_h = set(json.loads(fol_file.read_text(encoding="utf-8")).get("h", [])) if fol_file.exists() else set()
    is_fol = lambda nick: hashlib.sha1(nick.lower().encode()).hexdigest()[:12] in fol_h
    out = []
    for p in polls:
        votes = {}
        for c in comments:
            since = p.get("since", "")   # a date, or a UTC time like 2026-11-06T18:40
            if c["time"][:len(since)] < since:
                continue
            until = p.get("until", "")   # the vote closes: later comments don't count
            if until and c["time"][:len(until)] >= until:
                continue
            # Kazakh/Kyrgyz/Uzbek letters folded to Russian ones: «Қазақстан» used to split into pieces and never count
            text = c.get("text", "").lower().replace("ё", "е").translate(LOCAL_LETTERS)
            words = re.findall(r"[a-zа-я]+", text)
            numbers = set(re.findall(r"(?<!\d)\d(?!\d)", text))
            hit = next((o["key"] for o in p["options"] if o["key"] in numbers), None)
            hit = hit or next((o["key"] for o in p["options"]
                               if any(w.startswith(k.replace("ё", "е")) for k in o.get("words", []) for w in words)), None)
            # a flag emoji (🇰🇬) counts as the option whose emoji it is
            hit = hit or (next((o["key"] for o in p["options"] if p.get("each") and o.get("emoji") and o["emoji"] in c.get("text", "")), None))
            if hit and c.get("username"):
                w = p.get("follower_points", 1) if is_fol(c["username"]) else 1
                votes[c.get("id") or (c["username"], c["time"]) if p.get("each") else c["username"]] = (hit, w)
        counts = {o["key"]: 0 for o in p["options"]}
        for k, w in votes.values():
            counts[k] += w
        out.append({"id": p["id"], "question": p["question"], "how": p.get("how", ""), "total": sum(counts.values()),
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

    # quests from comments: friends tagged either way (+1 each, up to 3) and every extra reel you comment on (+1 each, up to 2)
    for nick, (bonus, fr) in quest_levels(set(residents)).items():
        residents[nick]["level"] += bonus
        if fr:
            residents[nick]["fr"] = fr
    for r in residents.values():
        r["level"] = max(1, min(7, r["level"]))

    # follow status comes from direct messages (dm_follow.py): only «not following» goes to the map — a sign on the house
    follows_file = HERE / "follows.json"
    follows = json.loads(follows_file.read_text(encoding="utf-8")) if follows_file.exists() else {}
    for nick, yes in follows.items():
        if nick in residents and yes is False:
            residents[nick]["follows"] = False

    # only followers live on the island. followers.json is a snapshot of the follower list, taken in the browser:
    # {"at": UTC time, "h": [first 12 hex of sha1(nick)]} — hashes, so the public repo doesn't list anyone.
    # People who commented after the snapshot stay until the next snapshot can check them.
    fol_file = HERE / "followers.json"
    if fol_file.exists():
        fol = json.loads(fol_file.read_text(encoding="utf-8"))
        hs, at = set(fol.get("h", [])), fol.get("at", "")
        joined = {r["nick"]: r.get("since", "") for r in rows}
        before = len(residents)
        residents = {n: r for n, r in residents.items()
                     if hashlib.sha1(n.lower().encode()).hexdigest()[:12] in hs}
        # plot numbers in joining order, so the island has no holes
        for k, r in enumerate(sorted(residents.values(), key=lambda r: r["no"])):
            r["no"] = k + 2
        houses = len(residents)
        # every follower gets a house (rule since 2026-11-07); a comment only levels it up (these nicks are public followers)
        taken, nxt = {n.lower() for n in residents}, houses + 2
        for n in fol.get("plots", []):
            if n.lower() not in taken:
                residents[n] = {"no": nxt, "nick": n, "level": 1, "since": at[:10]}
                nxt += 1
        print(f"Подписчики: домов {len(residents)} (с комментом {houses} из {before} комментаторов, без коммента {len(residents) - houses}; снимок {at[:16]})")

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

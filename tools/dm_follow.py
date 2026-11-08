"""
🏝 Остров подписчиков — личные сообщения и проверка подписки.

1. Приглашение: на первый коммент жителя — одно личное сообщение (private reply) со ссылкой на дом
   и просьбой подписаться. Включается переменной DM_INVITE=on (DM_ONLY — только тестовые ники).
2. Ответы: житель, впервые написавший в директ, получает ссылку на свой дом (один раз). Дальше бот
   отвечает только на типовые вопросы (FAQ: сторис, нет дома, паспорт, ссылка, голосование) — каждую
   тему не чаще раза в сутки; остальное молча оставляет человеку. Заодно узнаём, подписан ли житель
   (is_user_follow_business). Неподписанным — «подпишись, и дом появится».
   Статус пишется в follows.json → build_map.py ставит на карте табличку «подпишись».

Нужно разрешение instagram_manage_messages (Meta App Review). Пока его нет, сообщения работают
только для аккаунтов с ролью в приложении, а остальным скрипт тихо ничего не делает.
Работает после fetch_comments.py (берёт comments.json и residents.json рядом). Состояние — в dm.json.

  python dm_follow.py            # отправить и проверить
  python dm_follow.py --dry-run  # показать, что бы сделал, ничего не отправляя
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://graph.facebook.com/v23.0"
SITE = "https://ostrov-podpischikov.github.io/#"
IG_ID = os.environ.get("IG_USER_ID", "17841417700837854")
MAX_INVITES_PER_RUN = 5
INVITE_MAX_AGE_DAYS = 6  # Meta allows a private reply within 7 days of the comment

INVITE = "Привет! Твой дом №{no} на Острове подписчиков уже стоит 🏝 Вот он: {url}\nПодпишись на @ostrov.podpischikov, чтобы дом остался за тобой 🙏"
LINK = "Вот твой дом, житель №{no}: {url} 🏡"
# not a follower yet: no house on the map, so no number either
NO_HOUSE = "Дом на Острове подписчиков получают только подписчики 🏝\nПодпишись на @ostrov.podpischikov — и твой дом появится на карте: {url}"
# answers to common questions, by keywords in the person's last message (first match wins);
# each topic goes to the same person at most once a day, anything else is left for a human to answer
FAQ = [
    ("story", ("истори", "сторис", "stories", "репост"),
     "Конечно, можно! Выкладывай в историю и отметь @ostrov.podpischikov 🙌"),
    ("nohouse", ("нет дома", "не наш", "нету", "не вижу", "не могу найти", "не появ", "не нахож"),
     "Дом появляется у подписчиков после ночного обновления карты. Если подписался сегодня — завтра он будет на острове 🏡"),
    ("passport", ("паспорт",), "Паспорт жителя — открой свой дом по ссылке, он там 🪪"),
    ("link", ("ссылк", "мой дом", "номер", "где дом", "найти дом"), None),  # None → the personal link
    ("vote", ("голос", "стран", "второй остров", "очк", "флаг"),
     "Сейчас идёт гонка за второй остров 🏝 Пиши свою страну в комментах под последним рилсом: коммент = +1 очко, подписка = +3 ⭐"),
]


def is_bot(text):
    """Was this message written by this script (link, no-house note or a FAQ answer)?"""
    t = text or ""
    return t.startswith(("Вот твой дом", "Дом на Острове", "Привет! Твой дом")) or any(a and t == a for _, _, a in FAQ)


def faq_topic(text):
    t = (text or "").lower().replace("ё", "е")
    for topic, words, _ in FAQ:
        if any(w.replace("ё", "е") in t for w in words):
            return topic
    return None


def token():
    if os.environ.get("IG_TOKEN"):
        return os.environ["IG_TOKEN"]
    return json.loads((HERE / "config.json").read_text(encoding="utf-8-sig"))["IG_TOKEN"]


def call(path, params=None, post=None):
    """GET (params) or POST (post). Returns (json or None, error message or None)."""
    url = f"{API}/{path}"
    data = None
    if post is not None:
        data = urllib.parse.urlencode(post).encode()
    elif params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=30) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
        except ValueError:
            err = {}
        return None, f"{e.code} {err.get('code', '')} {err.get('message', '')[:160]}"


def page_token(tok):
    """The Page linked to the Instagram account and its access token (messages go through the Page)."""
    acc, err = call("me/accounts", {"fields": "id,access_token,instagram_business_account", "access_token": tok})
    if err:
        return None, None, err
    for p in acc.get("data", []):
        if (p.get("instagram_business_account") or {}).get("id") == IG_ID:
            return p["id"], p["access_token"], None
    return None, None, "страница с этим Instagram не найдена"


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except ValueError:
        return default


def save(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S")
    st = load(HERE / "dm.json", {})
    st.setdefault("invited", [])   # comment ids we sent a private reply to
    st.setdefault("answered", {})  # IGSID → time of the last message we answered
    # IGSIDs that already got their house link (everyone answered before this existed did)
    st.setdefault("linked", list(st["answered"].keys()))
    st.setdefault("topics", {})    # IGSID → {topic: time we last sent it}
    if not st.get("faq_v"):
        # the old bot answered every message with the link: look at those chats again so real questions get answers
        st["answered"], st["faq_v"] = {}, 1
    # only messages that arrive after the first run get the automatic reply — old conversations are left alone
    st.setdefault("since", now.strftime("%Y-%m-%dT%H:%M:%S+0000"))
    follows = load(HERE / "follows.json", {})  # nick → true / false
    residents = {r["nick"]: r for r in load(HERE / "residents.json", [])}
    # the number people see on the site and in the passport: followers only, from the published map
    site_no = {r["nick"]: r["no"] for r in load(HERE.parent / "data" / "residents.json", {}).get("residents", [])}

    page, ptok, err = page_token(token())
    if err:
        print(f"Личные сообщения: нет доступа к странице ({err})")
        return

    # 1) invitations: one private reply to each resident's first comment
    if os.environ.get("DM_INVITE", "").lower() == "on" or args.dry_run:
        oldest = iso(now - timedelta(days=INVITE_MAX_AGE_DAYS))
        # DM_ONLY="nick1,nick2" limits invitations to test accounts until Meta approves the permission
        only = {n.strip().lower().lstrip("@") for n in os.environ.get("DM_ONLY", "").split(",") if n.strip()}
        # one invitation per person, on their newest top-level comment (Meta allows one private reply per comment)
        invited_nicks = set(st.setdefault("invited_nicks", []))
        newest = {}
        for c in load(HERE / "comments.json", []):
            nick = c.get("username", "")
            if c.get("id") and not c.get("reply") and nick in residents and c["time"][:19] >= oldest:
                if nick not in newest or c["time"] > newest[nick]["time"]:
                    newest[nick] = c
        todo = [(residents[n], c) for n, c in newest.items() if n not in invited_nicks and c["id"] not in st["invited"]
                and (not only or n in only)]
        for r, c in todo[:MAX_INVITES_PER_RUN]:
            if r["nick"] in site_no:
                text = INVITE.format(no=site_no[r["nick"]], url=SITE + r["nick"])
            else:
                text = NO_HOUSE.format(url=SITE[:-1])
            if args.dry_run:
                print(f"  приглашение @{r['nick']}: {text}")
                continue
            _, err = call(f"{page}/messages", post={"recipient": json.dumps({"comment_id": c["id"]}), "message": json.dumps({"text": text}),
                                                    "access_token": ptok})
            if err:
                print(f"  ✗ приглашение @{r['nick']}: {err}")
                if " 10 " in f" {err} " or "permission" in err.lower():
                    break  # no instagram_manage_messages yet — stop trying this run
                continue
            st["invited"].append(c["id"])
            st["invited_nicks"].append(r["nick"])

    # 2) replies: whoever wrote to us gets the link; their follow status goes to the map
    convs, err = call(f"{page}/conversations", {"platform": "instagram", "limit": 50,
                                                 "fields": "participants,messages.limit(5){from,created_time,message}",
                                                 "access_token": ptok})
    # all recent chats, not just the first page: older unanswered ones sit further down the list
    nxt, pages = (convs or {}).get("paging", {}).get("next"), 1
    while convs and nxt and pages < 10:
        try:
            with urllib.request.urlopen(nxt, timeout=30) as r:
                more = json.loads(r.read())
        except (urllib.error.URLError, ValueError):
            break
        convs["data"] += more.get("data", [])
        nxt, pages = more.get("paging", {}).get("next"), pages + 1
    # Meta lets a page answer only within 24 h of the person's last message
    window = iso(now - timedelta(hours=23, minutes=30))
    if err:
        print(f"Личные сообщения: переписки недоступны ({err})")
    else:
        # the Actions log is public: count why conversations were skipped, details only for DM_ONLY test accounts
        only = {n.strip().lower().lstrip("@") for n in os.environ.get("DM_ONLY", "").split(",") if n.strip()}
        skipped = {}
        for conv in convs.get("data", []):
            # the API does not promise an order: take the newest of the last few messages
            msgs = (conv.get("messages") or {}).get("data") or [{}]
            ct = lambda m: m.get("created_time", "")
            # the person's newest message; if only the bot spoke after it (the old link-only reply), it still needs an answer,
            # but if a human answered from the account, leave the chat alone
            theirs = [m for m in msgs if (m.get("from") or {}).get("id") not in (None, IG_ID)]
            last = max(theirs, key=ct) if theirs else max(msgs, key=ct)
            if any((m.get("from") or {}).get("id") == IG_ID and ct(m) > ct(last) and not is_bot(m.get("message")) for m in msgs):
                skipped["ответил человек"] = skipped.get("ответил человек", 0) + 1
                continue
            sender = last.get("from") or {}
            # the other side of the chat, even when our message is the newest (for the debug line)
            other = next(((p.get("username") or "").lower() for p in (conv.get("participants") or {}).get("data", [])
                          if p.get("id") != IG_ID), "")
            if other in only and (sender.get("username") or "").lower() != other:
                print(f"  тест @{other}: новейшее сообщение наше ({last.get('created_time')})")
            igsid, nick = sender.get("id"), (sender.get("username") or "").lower()
            reason = "нет отправителя" if not igsid else "последнее — наше" if igsid == IG_ID else None
            if nick in only:
                print(f"  тест @{nick}: последнее сообщение {last.get('created_time')}, причина пропуска: {reason or 'нет'}")
            if reason:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            resident = nick in residents
            if resident:
                prof, err = call(igsid, {"fields": "username,is_user_follow_business", "access_token": ptok})
                if prof and "is_user_follow_business" in prof:
                    follows[nick] = bool(prof["is_user_follow_business"])
            created = last.get("created_time", "")
            if st["answered"].get(igsid, "") >= created or created[:19] < window:
                skipped["уже отвечено или старше суток"] = skipped.get("уже отвечено или старше суток", 0) + 1
                continue  # already answered, or out of Meta's 24-hour reply window
            st["answered"][igsid] = created  # this message is handled, whatever we decide below
            # what to answer: a known question, or the house link on a resident's very first message; else stay quiet
            topic = faq_topic(last.get("message"))
            if topic is None and resident and igsid not in st["linked"]:
                topic = "link"
            if topic == "link" and not resident:
                topic = None
            sent = st["topics"].setdefault(igsid, {})
            if topic is None or sent.get(topic, "") > iso(now - timedelta(hours=24)):
                why = "нет вопроса" if topic is None else "уже отвечали сегодня"
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if topic == "link":
                if nick in site_no and follows.get(nick) is not False:
                    text = LINK.format(no=site_no[nick], url=SITE + nick)
                else:
                    text = NO_HOUSE.format(url=SITE[:-1])
            else:
                text = next(a for k, _, a in FAQ if k == topic)
            if args.dry_run:
                print(f"  ответ @{nick} [{topic}]: {text}")
                continue
            _, err = call(f"{page}/messages", post={"recipient": json.dumps({"id": igsid}), "message": json.dumps({"text": text}),
                                                    "access_token": ptok})
            if err:
                print(f"  ✗ ответ @{nick}: {err}")
                continue
            sent[topic] = iso(now)
            if topic == "link" and igsid not in st["linked"]:
                st["linked"].append(igsid)
        print(f"  переписок: {len(convs.get('data', []))}, пропущено: {skipped or 0}")

    if not args.dry_run:
        st["invited"] = st["invited"][-5000:]
        save(HERE / "dm.json", st)
        save(HERE / "follows.json", follows)
    print(f"Личные сообщения: приглашено всего {len(st['invited'])}, известна подписка у {len(follows)} "
          f"(не подписаны: {sum(1 for v in follows.values() if v is False)})")


if __name__ == "__main__":
    main()

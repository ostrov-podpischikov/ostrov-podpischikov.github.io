"""
🏝 Остров подписчиков — личные сообщения и проверка подписки.

1. Приглашение: на первый коммент жителя — одно личное сообщение (private reply)
   «Твой дом №… готов! Ответь „да“ — пришлю ссылку». Включается переменной DM_INVITE=on.
2. Ответы: кто написал в директ — получает ссылку на свой дом; заодно узнаём, подписан ли он
   (is_user_follow_business). Неподписанным — «подпишись, чтобы сохранить дом».
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

INVITE = "Привет! Твой дом №{no} на Острове подписчиков уже стоит 🏝 Ответь «да» — пришлю ссылку на него"
LINK = "Вот твой дом, житель №{no}: {url} 🏡"
FOLLOW = "Чтобы дом остался за тобой — подпишись на @ostrov.podpischikov 🙏"


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
    # only messages that arrive after the first run get the automatic reply — old conversations are left alone
    st.setdefault("since", now.strftime("%Y-%m-%dT%H:%M:%S+0000"))
    follows = load(HERE / "follows.json", {})  # nick → true / false
    residents = {r["nick"]: r for r in load(HERE / "residents.json", [])}

    page, ptok, err = page_token(token())
    if err:
        print(f"Личные сообщения: нет доступа к странице ({err})")
        return

    # 1) invitations: one private reply to each resident's first comment
    if os.environ.get("DM_INVITE", "").lower() == "on" or args.dry_run:
        oldest = iso(now - timedelta(days=INVITE_MAX_AGE_DAYS))
        comments = {c["id"]: c for c in load(HERE / "comments.json", []) if c.get("id")}
        # DM_ONLY="nick1,nick2" limits invitations to test accounts until Meta approves the permission
        only = {n.strip().lower().lstrip("@") for n in os.environ.get("DM_ONLY", "").split(",") if n.strip()}
        todo = [r for r in residents.values() if r.get("cid") in comments and r["cid"] not in st["invited"]
                and comments[r["cid"]]["time"][:19] >= oldest and (not only or r["nick"] in only)]
        for r in todo[:MAX_INVITES_PER_RUN]:
            text = INVITE.format(no=r["no"])
            if args.dry_run:
                print(f"  приглашение @{r['nick']}: {text}")
                continue
            _, err = call(f"{page}/messages", post={"recipient": json.dumps({"comment_id": r["cid"]}), "message": json.dumps({"text": text}),
                                                    "access_token": ptok})
            if err:
                print(f"  ✗ приглашение @{r['nick']}: {err}")
                if " 10 " in f" {err} " or "permission" in err.lower():
                    break  # no instagram_manage_messages yet — stop trying this run
                continue
            st["invited"].append(r["cid"])

    # 2) replies: whoever wrote to us gets the link; their follow status goes to the map
    convs, err = call(f"{page}/conversations", {"platform": "instagram", "fields": "participants,messages.limit(5){from,created_time}",
                                                 "access_token": ptok})
    if err:
        print(f"Личные сообщения: переписки недоступны ({err})")
    else:
        # the Actions log is public: count why conversations were skipped, details only for DM_ONLY test accounts
        only = {n.strip().lower().lstrip("@") for n in os.environ.get("DM_ONLY", "").split(",") if n.strip()}
        skipped = {}
        for conv in convs.get("data", []):
            # the API does not promise an order: take the newest of the last few messages
            msgs = (conv.get("messages") or {}).get("data") or [{}]
            last = max(msgs, key=lambda m: m.get("created_time", ""))
            sender = last.get("from") or {}
            # the other side of the chat, even when our message is the newest (for the debug line)
            other = next(((p.get("username") or "").lower() for p in (conv.get("participants") or {}).get("data", [])
                          if p.get("id") != IG_ID), "")
            if other in only and (sender.get("username") or "").lower() != other:
                print(f"  тест @{other}: новейшее сообщение наше ({last.get('created_time')})")
            igsid, nick = sender.get("id"), (sender.get("username") or "").lower()
            reason = ("нет отправителя" if not igsid else "последнее — наше" if igsid == IG_ID
                      else "не житель" if nick not in residents else None)
            if nick in only:
                print(f"  тест @{nick}: последнее сообщение {last.get('created_time')}, причина пропуска: {reason or 'нет'}")
            if reason:
                skipped[reason] = skipped.get(reason, 0) + 1
                continue
            prof, err = call(igsid, {"fields": "username,is_user_follow_business", "access_token": ptok})
            if prof and "is_user_follow_business" in prof:
                follows[nick] = bool(prof["is_user_follow_business"])
            if st["answered"].get(igsid, "") >= last.get("created_time", "") or last.get("created_time", "") < st["since"]:
                skipped["уже отвечено или старое"] = skipped.get("уже отвечено или старое", 0) + 1
                continue  # already answered, or written before the replies were switched on
            r = residents[nick]
            text = LINK.format(no=r["no"], url=SITE + nick)
            if follows.get(nick) is False:
                text += "\n" + FOLLOW
            if args.dry_run:
                print(f"  ответ @{nick}: {text}")
                continue
            _, err = call(f"{page}/messages", post={"recipient": json.dumps({"id": igsid}), "message": json.dumps({"text": text}),
                                                    "access_token": ptok})
            if err:
                print(f"  ✗ ответ @{nick}: {err}")
                continue
            st["answered"][igsid] = last.get("created_time", iso(now))
        print(f"  переписок: {len(convs.get('data', []))}, пропущено: {skipped or 0}")

    if not args.dry_run:
        st["invited"] = st["invited"][-5000:]
        save(HERE / "dm.json", st)
        save(HERE / "follows.json", follows)
    print(f"Личные сообщения: приглашено всего {len(st['invited'])}, известна подписка у {len(follows)} "
          f"(не подписаны: {sum(1 for v in follows.values() if v is False)})")


if __name__ == "__main__":
    main()
